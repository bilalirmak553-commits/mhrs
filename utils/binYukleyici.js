const fs = require('fs');
const path = require('path');
const Bin = require('../models/Bin');
const Logger = require('./logger');

const log = new Logger('Bin');

const BIN_SQL_DOSYA = path.join(__dirname, '..', 'bin.sql');

// MySQL dump satırı:
// INSERT INTO `bins` (`id`, `vpos_id`, `bank_code`, `bank_name`, `bin_number`, `card_type`, `organization`, `is_commercial_card`, `is_support_installment`) VALUES (252, 3, 64, 'T. İŞ BANKASI A.Ş.', 113064, 'creditcard', 'AMEX', 0, 0);
const KAYIT_DESENI = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;

function kartTuruCevir(tur) {
    if (tur === 'creditcard') return 'KREDİ';
    if (tur === 'debit') return 'BANKA';
    return String(tur || '').toUpperCase();
}

function markaCevir(marka) {
    if (marka === 'MASTER') return 'MASTERCARD';
    if (marka === 'GARANTI') return 'GARANTİ';
    return String(marka || '').toUpperCase();
}

function binKayitlariniOku() {
    if (!fs.existsSync(BIN_SQL_DOSYA)) return null;
    const icerik = fs.readFileSync(BIN_SQL_DOSYA, 'utf8');
    const kayitlar = [];
    let eslesme;
    while ((eslesme = KAYIT_DESENI.exec(icerik)) !== null) {
        kayitlar.push({
            bin: String(eslesme[5]).padStart(6, '0'),
            banka: eslesme[4],
            kartTuru: kartTuruCevir(eslesme[6]),
            marka: markaCevir(eslesme[7])
        });
    }
    return kayitlar;
}

async function binYukle() {
    const kayitlar = binKayitlariniOku();
    if (kayitlar === null) {
        log.warn('bin.sql bulunamadı; BIN verisi yüklenmedi.');
        return 0;
    }
    if (kayitlar.length === 0) {
        log.warn('bin.sql içinde geçerli BIN kaydı bulunamadı.');
        return 0;
    }
    const mevcut = await Bin.estimatedDocumentCount().catch(() => -1);
    if (mevcut > 0) {
        log.info('BIN verisi zaten yüklü (' + mevcut + ' kayıt); atlandı.');
        return mevcut;
    }
    for (let i = 0; i < kayitlar.length; i += 500) {
        const parca = kayitlar.slice(i, i + 500);
        await Bin.bulkWrite(parca.map(k => ({
            updateOne: {
                filter: { bin: k.bin },
                update: { $set: k },
                upsert: true
            }
        })));
    }
    log.info(kayitlar.length + " BIN kaydı MongoDB'ye yüklendi (bins koleksiyonu).");
    return kayitlar.length;
}

module.exports = { binYukle, binKayitlariniOku };
