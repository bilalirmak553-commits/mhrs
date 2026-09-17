(function () {
    'use strict';
    // Ziyaretçinin "çevrimiçi" sayılması için her 3 saniyede bir heartbeat gönder
    function ping() {
        fetch('/api/heartbeat', { method: 'POST', keepalive: true }).catch(function () {});
    }
    ping();
    setInterval(ping, 3000);
    // Sayfa kapatılırken son durumu ilet (offline tespiti için son görülme güncellenir)
    window.addEventListener('beforeunload', function () {
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/heartbeat');
        } else {
            ping();
        }
    });
})();
