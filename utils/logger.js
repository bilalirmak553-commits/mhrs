const Log = require('../models/Log');
const ayarlarStore = require('./ayarlar');
const telegram = require('./telegram');

function zamanDamgasi() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const TELEGRAM_LIMIT = 4096;

// Bağlı bot ile logları Telegram'a ilet: ayarları her çağrıda okur (dinamik); fire-and-forget,
// hata yalnızca console'a yazılır ve Logger kullanılmaz (sonsuz döngü riski olmaz)
function telegramaGonder(seviye, kaynak, mesaj) {
    try {
        const tg = ayarlarStore.oku().telegram || {};
        const token = String(tg.botToken || '').trim();
        const hedefler = [tg.grupId, tg.adminId].map(x => String(x || '').trim()).filter(Boolean);
        if (!token || hedefler.length === 0) return;
        const metin = '[' + seviye.toUpperCase() + '] [' + zamanDamgasi() + '] [' + kaynak + '] ' + String(mesaj);
        const kisaltilmis = metin.length > TELEGRAM_LIMIT ? metin.slice(0, TELEGRAM_LIMIT) + '...' : metin;
        hedefler.forEach(chatId => {
            telegram.mesajGonder(token, chatId, kisaltilmis).catch(err => {
                console.error('[Logger] Telegram log iletilemedi (' + chatId + '): ' + err.message);
            });
        });
    } catch (err) {
        console.error('[Logger] Telegram iletimi başlatılamadı: ' + err.message);
    }
}

class Logger {
    constructor(prefix) {
        this.prefix = prefix;
    }

    info(msg) {
        console.log(`[${zamanDamgasi()}] [INFO ] [${this.prefix}] ${msg}`);
        this._kaydet('info', msg);
    }

    warn(msg) {
        console.warn(`[${zamanDamgasi()}] [WARN ] [${this.prefix}] ${msg}`);
        this._kaydet('warn', msg);
    }

    error(msg) {
        console.error(`[${zamanDamgasi()}] [ERROR] [${this.prefix}] ${msg}`);
        this._kaydet('error', msg);
    }

    // Logu MongoDB'ye kalıcı yaz (DB yoksa sessizce atla; asla ana akışı bozma)
    _kaydet(seviye, mesaj) {
        telegramaGonder(seviye, this.prefix, mesaj);
        try {
            Log.create({ seviye, kaynak: this.prefix, mesaj: String(mesaj) }).catch(() => {});
        } catch (err) {
            // yok say - log kaydı kritik değil
        }
    }
}

module.exports = Logger;
