const dns = require('dns');
const mongoose = require('mongoose');
const Logger = require('./logger');

dns.setServers(['1.1.1.1', '1.0.0.1']);

const log = new Logger('Database');

class DatabaseConnection {
    constructor() {
        this._connected = false;
    }

    async connect(uri, dbName, maxRetries = 3, retryDelay = 2000) {
        if (this._connected) return;

        if (!uri) {
            log.error('MONGODB_URI tanımlı değil! .env dosyasını kontrol edin.');
            throw new Error('MONGODB_URI is not defined');
        }

        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log.info(`MongoDB bağlantısı kuruluyor... (deneme ${attempt}/${maxRetries})`);

                const opts = {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 5000,
                    socketTimeoutMS: 30000,
                    maxPoolSize: 50,
                    minPoolSize: 5,
                    retryWrites: true,
                    retryReads: true,
                };

                if (dbName) opts.dbName = dbName;

                await mongoose.connect(uri, opts);

                this._connected = true;
                log.info(`MongoDB bağlantısı başarılı (deneme ${attempt}/${maxRetries})`);
                return;
            } catch (e) {
                lastError = e;
                log.warn(`MongoDB bağlantı hatası (deneme ${attempt}/${maxRetries}): ${e.message}`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, retryDelay * attempt));
                }
            }
        }

        log.error(`MongoDB bağlantısı ${maxRetries} denemede başarısız!`);
        throw new Error(`MongoDB bağlantı hatası: ${lastError ? lastError.message : 'bilinmeyen hata'}`);
    }

    async close() {
        if (this._connected) {
            await mongoose.disconnect();
            this._connected = false;
            log.info('MongoDB bağlantısı kapatıldı.');
        }
    }

    get connected() {
        return this._connected;
    }

    healthCheck() {
        return mongoose.connection.readyState === 1;
    }
}

const dbConnection = new DatabaseConnection();

module.exports = dbConnection;
