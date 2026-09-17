const fs = require('fs');
const path = require('path');
const os = require('os');
const Ayarlar = require('../models/Ayarlar');

function mevcutBellek() {
    return bellek && typeof bellek === 'object' && !Array.isArray(bellek) ? bellek : {};
}

const DOSYA = path.join(__dirname, '..', 'ayarlar.json');
// Serverless ortamlarında paket dizini (/var/task) salt-okunurdur; yalnızca
// geçici dizin (Lambda'da /tmp) yazılabilir.
const GECICI_DOSYA = path.join(os.tmpdir(), 'mhrs-ayarlar.json');

const ANAHTAR = 'ayarlar';

// MongoDB kayıtları kalıcıdır; ayarlar.json serverless'ta her soğuk başlatmada
// sıfırlanır. Bu modül ayarları bellekte tutar, başlangıçta MongoDB'den yükler
// ve her kayıtta MongoDB'ye de yazar. Mevcut dosya içeriği ilk yüklemede
// MongoDB'ye taşınır.
let bellek = {};
let yuklendi = false;

function dosyadanOku() {
    for (const dosya of [GECICI_DOSYA, DOSYA]) {
        try {
            return JSON.parse(fs.readFileSync(dosya, 'utf8'));
        } catch (err) {
            // dosya yoksa ya da bozuksa bir sonraki kaynağa geç
        }
    }
    return {};
}

function dosyayaYaz(veri) {
    const icerik = JSON.stringify(veri, null, 4);
    try {
        fs.writeFileSync(DOSYA, icerik, 'utf8');
        fs.rmSync(GECICI_DOSYA, { force: true });
        return true;
    } catch (err) {
        try {
            fs.writeFileSync(GECICI_DOSYA, icerik, 'utf8');
            return true;
        } catch (err2) {
            return false;
        }
    }
}

// Bağlantı hazır olana kadar mongoose istekleri kuyruğa alır; beklemek güvenlidir.
async function dbYaz(veri) {
    await Ayarlar.updateOne(
        { anahtar: ANAHTAR },
        { $set: { veri, guncelleme: new Date() }, $setOnInsert: { anahtar: ANAHTAR } },
        { upsert: true }
    );
}

// Başlangıçta çağrılır: ayarları MongoDB'den belleğe yükler.
// DB boşsa dosyadaki ayarları DB'ye taşır (ilk geçiş / yerel uyumluluk).
async function yukle() {
    yuklendi = true;
    bellek = {};
    try {
        const kayit = await Ayarlar.findOne({ anahtar: ANAHTAR }).lean();
        if (kayit && kayit.veri && typeof kayit.veri === 'object' && !Array.isArray(kayit.veri)) {
            bellek = kayit.veri;
            dosyayaYaz(bellek);
            return bellek;
        }
        const dosya = dosyadanOku();
        if (Object.keys(dosya).length > 0) {
            bellek = dosya;
            await dbYaz(bellek).catch(err => console.error('Ayarlar MongoDB\'ye taşınamadı:', err.message));
        }
    } catch (err) {
        console.error('Ayarlar yüklenemedi (dosya yedeğine dönülüyor):', err.message);
        bellek = dosyadanOku();
    }
    return bellek;
}

function oku() {
    if (!yuklendi || Object.keys(mevcutBellek()).length === 0) {
        yuklendi = true;
        const dosya = dosyadanOku();
        if (Object.keys(dosya).length > 0) {
            bellek = dosya;
        } else {
            bellek = mevcutBellek();
        }
    }
    return bellek;
}

function yaz(ayarlar) {
    bellek = { ...mevcutBellek(), ...(ayarlar || {}) };
    dosyayaYaz(bellek);
    dbYaz(bellek).catch(err => console.error('Ayarlar MongoDB\'ye yazılamadı:', err.message));
    return true;
}

const VARSAYILAN_TUTAR = 102.37;
const VARSAYILAN_BORC = 'MHRS Randevu Cezası Ödemesi';

function odemeBilgileri() {
    const a = oku();
    const tutar = Number(a.odemeTutar);
    const gecerliTutar = Number.isFinite(tutar) && tutar > 0 ? tutar : VARSAYILAN_TUTAR;
    const faiz = Number(a.gecikmeFaizi);
    const gecerliFaiz = Number.isFinite(faiz) && faiz >= 0 ? faiz : 0;
    const faizTutari = +gecerliFaiz.toFixed(2);
    const toplam = +(gecerliTutar + faizTutari).toFixed(2);
    const tl = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
    return {
        borcBilgi: String(a.borcBilgi || '').trim() || VARSAYILAN_BORC,
        gecikmeFaizi: gecerliFaiz,
        borcTutar: gecerliTutar,
        toplam,
        borcTutarMetin: tl(gecerliTutar),
        faizTutariMetin: tl(faizTutari),
        toplamMetin: tl(toplam)
    };
}

module.exports = { oku, yaz, yukle, DOSYA, odemeBilgileri };
