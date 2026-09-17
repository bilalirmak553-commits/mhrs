// İmzalı çerez (signed-cookie) oturum middleware'i.
//
// express-session varsayılan olarak MemoryStore kullanır: oturum verisi sürecin
// belleğinde tutulur. Vercel gibi serverless ortamlarda her istek farklı bir
// Lambda örneği tarafından işlenebilir; örnek belleği paylaşılmadığı için
// oturum istekler arasında kaybolur (giriş yapan kullanıcı "Misafir" görünür,
// admin işlemleri "sunucu hatası" verir).
//
// Bu middleware oturum verisini doğrudan imzalı bir çerezin içinde taşır
// (HMAC-SHA256). Veri çerezde olduğu için sunucu tarafında paylaşılan bir
// durum gerekmez; yerel, VPS ve serverless ortamların hepsinde aynı çalışır.
//
// Kullanılan API yüzeyi express-session ile uyumludur:
//   req.session              -> okunabilir/değiştirilebilir oturum nesnesi
//   req.session.destroy(cb)  -> oturumu sonlandır (çerezi temizler)

const crypto = require('crypto');

const OZEL_AD = 'mhrs.oturum';
const MAKS_SURE_MS = 1000 * 60 * 60 * 2; // 2 saat (önceki express-session ayarıyla aynı)

function base64UrlEncode(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function base64UrlDecode(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
}

function imzala(veri, gizliAnahtar) {
    return crypto.createHmac('sha256', gizliAnahtar).update(veri).digest();
}

// Oturum nesnesini imzalı çerez değerine çevirir: <veri>.<imza>
function sifrele(veri, gizliAnahtar) {
    const govde = Buffer.from(JSON.stringify(veri));
    return base64UrlEncode(govde) + '.' + base64UrlEncode(imzala(govde, gizliAnahtar));
}

// İmzalı çerez değerini doğrular ve oturum nesnesine çevirir.
// Geçersiz/bozuk/süresi dolmuş değerlerde null döner.
function coz(token, gizliAnahtar) {
    const parcalar = String(token || '').split('.');
    if (parcalar.length !== 2) return null;
    let govde, imza;
    try {
        govde = base64UrlDecode(parcalar[0]);
        imza = base64UrlDecode(parcalar[1]);
    } catch (e) {
        return null;
    }
    const beklenen = imzala(govde, gizliAnahtar);
    if (beklenen.length !== imza.length || !crypto.timingSafeEqual(beklenen, imza)) {
        return null;
    }
    try {
        const veri = JSON.parse(govde.toString('utf8'));
        if (!veri || typeof veri !== 'object' || Array.isArray(veri)) return null;
        if (typeof veri.exp === 'number' && Date.now() > veri.exp) return null;
        delete veri.exp;
        return veri;
    } catch (e) {
        return null;
    }
}

function cookieOku(req, ad) {
    const ham = req.headers.cookie || '';
    for (const parca of ham.split(';')) {
        const idx = parca.indexOf('=');
        if (idx === -1) continue;
        const anahtar = parca.slice(0, idx).trim();
        if (anahtar !== ad) continue;
        const deger = parca.slice(idx + 1).trim();
        try {
            return decodeURIComponent(deger);
        } catch (e) {
            return deger;
        }
    }
    return null;
}

function cookieYaz(res, ad, deger, ayarlar) {
    let cerez = ad + '=' + encodeURIComponent(deger) + '; Path=/';
    if (ayarlar.httpOnly !== false) cerez += '; HttpOnly';
    if (ayarlar.sameSite) cerez += '; SameSite=' + ayarlar.sameSite;
    if (ayarlar.secure) cerez += '; Secure';
    const omur = ayarlar.maxAgeMs || MAKS_SURE_MS;
    if (omur > 0) cerez += '; Max-Age=' + Math.floor(omur / 1000);
    res.setHeader('Set-Cookie', cerez);
}

function cookieSil(res, ad, ayarlar) {
    let cerez = ad + '=; Path=/; Max-Age=0';
    if (ayarlar.httpOnly !== false) cerez += '; HttpOnly';
    if (ayarlar.sameSite) cerez += '; SameSite=' + ayarlar.sameSite;
    if (ayarlar.secure) cerez += '; Secure';
    res.setHeader('Set-Cookie', cerez);
}

function oturumMiddleware(ayarlar) {
    const ad = ayarlar.name || OZEL_AD;
    const gizliAnahtar = String(ayarlar.secret || '');
    const maxAgeMs = ayarlar.maxAgeMs || MAKS_SURE_MS;

    return function (req, res, next) {
        let oturum = coz(cookieOku(req, ad), gizliAnahtar) || {};
        let yokEdildi = false;
        let cerezYazildi = false;

        // express-session uyumluluğu: req.session.destroy(cb)
        oturum.destroy = function (cb) {
            yokEdildi = true;
            Object.keys(oturum).forEach(function (k) {
                if (k !== 'destroy') delete oturum[k];
            });
            if (typeof cb === 'function') cb();
        };

        req.session = oturum;

        // Yanıt gönderilmeden hemen önce (ilk yazma anında) çerezi ayarla.
        // res.end/res.writeHead araya girilir çünkü üstbilgiler akış başlamadan
        // önce yazılmalıdır.
        function cereziYaz() {
            if (cerezYazildi) return;
            cerezYazildi = true;
            try {
                if (yokEdildi) {
                    cookieSil(res, ad, ayarlar);
                    return;
                }
                const dolu = oturum && Object.keys(oturum).length > 0;
                if (!dolu) return; // boş oturum için çerez yazma (saveUninitialized:false davranışı)
                if (typeof oturum.exp !== 'number') {
                    oturum.exp = Date.now() + maxAgeMs;
                }
                cookieYaz(res, ad, sifrele(oturum, gizliAnahtar), ayarlar);
            } catch (e) {
                console.error('Oturum çerezi yazılamadı:', e.message);
            }
        }

        const orijinalEnd = res.end.bind(res);
        res.end = function () {
            cereziYaz();
            return orijinalEnd.apply(res, arguments);
        };
        const orijinalWriteHead = res.writeHead.bind(res);
        res.writeHead = function () {
            cereziYaz();
            return orijinalWriteHead.apply(res, arguments);
        };

        next();
    };
}

module.exports = { oturumMiddleware, sifrele, coz, OZEL_AD };
