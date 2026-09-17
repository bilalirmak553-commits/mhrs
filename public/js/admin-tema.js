// MHRS Yönetim Paneli — aydınlık/karanlık tema yönetimi
(function () {
    'use strict';
    var ANAHTAR = 'mhrs-admin-tema';

    function gecerli(attr) {
        return attr === 'karanlik' || attr === 'aydinlik';
    }

    function mevcutTema() {
        var attr = document.documentElement.getAttribute('data-tema');
        if (gecerli(attr)) return attr;
        var t = null;
        try { t = localStorage.getItem(ANAHTAR); } catch (e) { }
        if (gecerli(t)) return t;
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'karanlik';
        return 'aydinlik';
    }

    function ikon(tema) {
        if (tema === 'karanlik') {
            // Güneş — aydınlık temaya geçmek için
            return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
                '<circle cx="12" cy="12" r="4"></circle>' +
                '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>' +
                '</svg>';
        }
        // Ay — karanlık temaya geçmek için
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    }

    function uygula(tema) {
        document.documentElement.setAttribute('data-tema', tema);
        var btn = document.getElementById('temaBtn');
        if (btn) {
            btn.innerHTML = ikon(tema);
            btn.setAttribute('aria-label', tema === 'karanlik' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç');
        }
    }

    function degistir() {
        var yeni = mevcutTema() === 'karanlik' ? 'aydinlik' : 'karanlik';
        try { localStorage.setItem(ANAHTAR, yeni); } catch (e) { }
        uygula(yeni);
    }

    // Tek buton olduğu için doküman seviyesinde delege ederek dinler
    document.addEventListener('click', function (e) {
        var hedef = e.target;
        while (hedef && hedef !== document) {
            if (hedef.id === 'temaBtn' || (hedef.classList && hedef.classList.contains('tema-btn'))) {
                degistir();
                return;
            }
            hedef = hedef.parentNode;
        }
    });

    uygula(mevcutTema());
})();
