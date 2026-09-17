require('dotenv').config();

const express = require('express');
const path = require('path');
const { execSync } = require('child_process');
const bcrypt = require('bcryptjs');
const Logger = require('./utils/logger');
const dbConnection = require('./utils/db');
const ayarlarStore = require('./utils/ayarlar');
const { binYukle } = require('./utils/binYukleyici');
const { oturumMiddleware } = require('./utils/oturum');

const pagesRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const Admin = require('./models/Admin');

const app = express();
const PORT = process.env.PORT || 3000;
// ayarlar.json (admin panelinden değiştirilebilir) .env'den önceliklidir
const kayitliAyarlar = ayarlarStore.oku();
const MONGO_URI = kayitliAyarlar.mongoUri || process.env.MONGODB_URI;
const DB_NAME = kayitliAyarlar.dbName || process.env.DB_NAME || 'mhrs_demo';
const ROOT = __dirname;
const log = new Logger('Server');

async function adminOlustur() {
    try {
        const mevcut = await Admin.findOne({ kullaniciAdi: 'admin' });
        if (!mevcut) {
            const sifreHash = await bcrypt.hash('admin123', 10);
            await Admin.create({ kullaniciAdi: 'admin', sifreHash });
            log.info('Varsayılan admin oluşturuldu -> kullanıcı: admin / şifre: admin123');
        }
    } catch (err) {
        log.error('Admin oluşturulamadı: ' + err.message);
    }
}

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

// Vercel gibi ters vekil (proxy) arkasında req.secure / req.ip doğruluğu için.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(oturumMiddleware({
    name: 'mhrs.oturum',
    secret: process.env.SESSION_SECRET || 'mhrs-demo-gizli-anahtar',
    maxAgeMs: 1000 * 60 * 60 * 2,
    sameSite: 'lax'
}));

// Serverless'te baslat() çalışmaz; ilk istek bağlantıyı kurar (yerelde etkisizdir).
// Başarısız bir hazırlık örneği kalıcı bozuk bırakmasın: 15 sn sonra tekrar denenir.
let hazirlikBasladi = false;
let hazirlikSonDeneme = 0;
const HAZIRLIK_TEKRAR_MS = 15000;
app.use(async (req, res, next) => {
    if (hazirlikBasladi) return next();
    const simdi = Date.now();
    if (simdi - hazirlikSonDeneme < HAZIRLIK_TEKRAR_MS) return next();
    hazirlikSonDeneme = simdi;
    hazirlikBasladi = true;
    try {
        await dbConnection.connect(MONGO_URI, DB_NAME);
        await ayarlarStore.yukle();
        await binYukle();
        await adminOlustur();
    } catch (err) {
        log.error('Başlangıç hazırlığı hatası: ' + err.message);
        hazirlikBasladi = false;
    }
    next();
});

app.use('/', pagesRoutes);
app.use('/api', apiRoutes);
app.use('/SADSDAFHBEUBCE', adminRoutes);

app.use(express.static(path.join(ROOT, 'public')));

app.use((req, res) => {
    res.status(404).render('404');
});

function portuKapat(port) {
    let kapatilan = 0;
    try {
        const komut = process.platform === 'win32'
            ? `netstat -ano | findstr :${port}`
            : `lsof -ti:${port}`;
        const cikti = execSync(komut, { encoding: 'utf8' });
        const pids = new Set();
        cikti.split('\n').forEach(satir => {
            if (process.platform === 'win32') {
                if (/LISTENING/.test(satir)) {
                    const pid = satir.trim().split(/\s+/).pop();
                    if (pid && pid !== '0') pids.add(pid);
                }
            } else {
                const pid = satir.trim();
                if (pid) pids.add(pid);
            }
        });
        pids.forEach(pid => {
            try {
                const cmd = process.platform === 'win32'
                    ? `taskkill /PID ${pid} /F`
                    : `kill -9 ${pid}`;
                execSync(cmd, { stdio: 'ignore' });
                kapatilan++;
                log.warn(`Port ${port} uzerindeki eski surec (PID ${pid}) kapatildi`);
            } catch (e) {}
        });
    } catch (e) {}
    return kapatilan > 0;
}

async function baslat() {
    await dbConnection.connect(MONGO_URI, DB_NAME);
    await ayarlarStore.yukle();
    await binYukle();
    await adminOlustur();
    const sunucu = app.listen(PORT, () => {
        log.info(`MHRS demo sunucusu calisiyor: http://localhost:${PORT}`);
    });
    sunucu.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            log.error(`Port ${PORT} dolu. Eski surec kapatilip tekrar deneniyor...`);
            if (portuKapat(PORT)) {
                setTimeout(baslat, 700);
            } else {
                log.error(`Port ${PORT} kapatilamadi. Lutfen elle kontrol edin.`);
                process.exit(1);
            }
        } else {
            log.error('Sunucu hatasi: ' + err.message);
            process.exit(1);
        }
    });
}

// Vercel serverless girişi (api/index.js) uygulamayı buradan alır.
module.exports = app;

if (require.main === module) {
    baslat().catch(err => {
        log.error(err.message);
        process.exit(1);
    });
}
