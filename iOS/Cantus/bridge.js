// Injecté par l'app iOS dans cantus-app.fr avant tout script de la page.
// Branche les API web absentes ou limitées de WKWebView sur le natif et applique l'habillage
// iOS (skin.css, fourni par le natif dans window.__cantusCSS), sans rien changer à index.html :
// la PWA du site reste strictement identique pour les navigateurs.
(function () {
    const post = (msg) => { try { window.webkit.messageHandlers.cantus.postMessage(msg); } catch (e) {} };

    // Premier lancement : le thème suit celui de l'iPhone (clair/sombre) au lieu du sombre imposé.
    try { if (!localStorage.getItem('cantus_settings')) localStorage.setItem('cantus_settings', '{"theme":"system"}'); } catch (e) {}

    // L'app est installée : l'onboarding saute l'étape « Ajouter à l'écran d'accueil ».
    try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch (e) {}

    // navigator.vibrate n'existe pas sur iOS → retour haptique natif.
    navigator.vibrate = (p) => {
        const isPattern = Array.isArray(p) && p.length > 1;
        post({ type: 'vibrate', ms: Array.isArray(p) ? p[0] || 0 : Number(p) || 0, pattern: isPattern });
        return true;
    };

    // Maintien de l'écran allumé pendant le jeu des partitions (Wake Lock) → idleTimer natif.
    const sentinel = {
        released: false, type: 'screen', onrelease: null,
        release() { this.released = true; post({ type: 'wake', on: false }); return Promise.resolve(); },
        addEventListener() {}, removeEventListener() {}
    };
    try {
        Object.defineProperty(navigator, 'wakeLock', { value: {
            request() { sentinel.released = false; post({ type: 'wake', on: true }); return Promise.resolve(sentinel); }
        } });
    } catch (e) {}

    // Petit retour haptique sur chaque élément tactile, comme dans une app native.
    // 'click' plutôt que 'pointerdown' : un doigt posé pour faire défiler une liste ne vibre pas.
    const TAPPABLE = 'button, a[href], [onclick], [role="button"], .btn, select, label, input[type="checkbox"], input[type="radio"], summary';
    document.addEventListener('click', (e) => {
        const el = e.target instanceof Element && e.target.closest(TAPPABLE);
        if (el && !el.disabled && el !== document.body) post({ type: 'tap' });
    }, { capture: true, passive: true });

    // ─── Vues : la barre d'onglets native pilote showView(), et inversement ───
    // Grand titre serif et surtitre de chaque onglet (maquette Figma).
    const TITLES = { library: 'Bibliothèque', playlist: 'Playlists', planner: 'Messes', favorites: 'Ma musique', history: 'Ma musique', live: 'Live' };
    const EYEBROWS = { playlist: 'Vos collections', planner: 'Célébrations', favorites: 'Retrouvez vos chants', history: 'Retrouvez vos chants', live: 'Chantez ensemble' };
    // Couleurs des vignettes de chants, une par catégorie (stable d'un lancement à l'autre).
    const TILE_COLORS = ['#7a9e86', '#7489a3', '#c1a05f', '#b07a7a', '#5f8f8a', '#8c7ba3', '#a08a6e'];
    let currentView = 'library';

    function eyebrow() {
        if (currentView !== 'library') return EYEBROWS[currentView] || '';
        try { return state.songs.length + ' chants'; } catch (e) { return 'Partitions'; }
    }

    function tileColor(label) {
        let h = 0;
        for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return TILE_COLORS[h % TILE_COLORS.length];
    }

    function decorate() {
        const c = document.getElementById('content');
        if (!c) return;

        // Vignette colorée devant chaque chant
        for (const card of c.querySelectorAll('.card:not([data-ios])')) {
            card.dataset.ios = '1';
            const badge = card.querySelector('.cat-badge:not(.local-badge)');
            card.insertAdjacentHTML('afterbegin', `<div class="ios-tile" style="--tile:${tileColor(badge ? badge.textContent : '')}"><svg class="icon"><use href="#ico-music"/></svg></div>`);
        }

        // Catégories : le menu déroulant devient une rangée de puces
        for (const select of c.querySelectorAll('select.search-input:not(.ios-hidden)')) {
            select.classList.add('ios-hidden');
            const chips = document.createElement('div');
            chips.className = 'ios-chips';
            chips.innerHTML = [...select.options].map(o =>
                `<button data-v="${o.value}" class="${o.value === select.value ? 'active' : ''}">${o.value ? o.textContent : 'Tous'}</button>`).join('');
            chips.addEventListener('click', (e) => {
                const b = e.target.closest('button');
                if (!b) return;
                chips.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
                select.value = b.dataset.v;
                select.dispatchEvent(new Event('change'));
            });
            select.after(chips);
        }

        const title = c.querySelector(':scope > .ios-large-title');
        if (title) {
            const eb = c.querySelector(':scope > .ios-eyebrow');
            if (eb && eb.textContent !== eyebrow()) eb.textContent = eyebrow();
            return;
        }
        // Pas de grand titre sur les écrans de détail (éditeurs), qui ont leur propre en-tête.
        if (c.querySelector('.editor-head, .coll-editor, .live-topbar')) return;
        let html = `<div class="ios-eyebrow">${eyebrow()}</div><h1 class="ios-large-title">${TITLES[currentView] || ''}</h1>`;
        if (currentView === 'favorites' || currentView === 'history') {
            html += `<div class="segmented ios-seg">
                <button class="${currentView === 'favorites' ? 'active' : ''}" onclick="showView('favorites')">Favoris</button>
                <button class="${currentView === 'history' ? 'active' : ''}" onclick="showView('history')">Historique</button>
            </div>`;
        }
        c.insertAdjacentHTML('afterbegin', html);
    }

    function hookShowView() {
        if (typeof window.showView !== 'function' || window.showView.__ios) return;
        const original = window.showView;
        let booted = false;
        window.showView = function (v, from) {
            // Au démarrage la page affiche la Bibliothèque : on rouvre plutôt le dernier onglet.
            // (from === 'native' : appui sur la barre d'onglets, toujours respecté.)
            if (from === 'native') booted = true;
            if (!booted) {
                booted = true;
                let saved = null;
                try { saved = window.__cantusTab || localStorage.getItem('cantus_ios_tab'); } catch (e) {}
                if (v === 'library' && saved && TITLES[saved]) v = saved;
            }
            try { localStorage.setItem('cantus_ios_tab', v); } catch (e) {}
            const changed = v !== currentView;
            currentView = v;
            document.body.dataset.view = v;
            const r = original.call(this, v);
            decorate();
            if (changed) window.scrollTo(0, 0);
            post({ type: 'view', view: v });
            return r;
        };
        window.showView.__ios = true;
    }

    // ─── Écrans plein écran (visionneuse, feuilles, modales…) : on masque les barres natives ───
    function overlayOpen() {
        for (const el of document.querySelectorAll('body > *, #app > *')) {
            if (el.id === 'app' || el.id === 'content' || el.id === 'toast-container') continue;
            const s = getComputedStyle(el);
            if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.width >= innerWidth * .9 && r.height >= innerHeight * .9) return true;
        }
        return false;
    }
    // Visionneuse ou annotation : plein écran total (barre d'état et barre d'accueil masquées).
    function immersiveOpen() {
        const perf = document.getElementById('performance-mode');
        return !!(perf && getComputedStyle(perf).display !== 'none') ||
            !!document.querySelector('#annot-editor.open');
    }
    let lastState = '', pending = false;
    function checkOverlay() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            const open = overlayOpen(), immersive = immersiveOpen();
            if (open + '/' + immersive === lastState) return;
            lastState = open + '/' + immersive;
            post({ type: 'overlay', open, immersive });
        });
    }

    function init() {
        // Plein écran bord à bord : la page gère déjà env(safe-area-inset-*).
        const vp = document.querySelector('meta[name="viewport"]');
        if (vp && !/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';

        const style = document.createElement('style');
        style.id = 'cantus-ios-skin';
        style.textContent = (window.__cantusCSS || '') +
            '*{-webkit-tap-highlight-color:transparent}a,button,img{-webkit-touch-callout:none}';
        document.head.appendChild(style);

        // Le document défile désormais (et non plus <main>) : la page mémorise/restaure sa
        // position via #content.scrollTop, qu'on redirige vers le défilement de la fenêtre.
        const content = document.getElementById('content');
        if (content) {
            Object.defineProperty(content, 'scrollTop', {
                get: () => window.scrollY,
                set: (v) => window.scrollTo(0, v)
            });
        }

        hookShowView();
        document.body.dataset.view = currentView;
        new MutationObserver(() => { decorate(); checkOverlay(); })
            .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
        decorate();

        // Thème clair/sombre de l'app → apparence des barres natives et de la barre d'état.
        const html = document.documentElement;
        const syncTheme = () => post({ type: 'theme', dark: html.getAttribute('data-theme') !== 'light' });
        new MutationObserver(syncTheme).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
        syncTheme();

        // État de synchro (« À jour » / « Hors-ligne ») et accès admin → barre native.
        const sync = document.getElementById('sync-text');
        const dash = document.getElementById('header-dash-btn');
        const syncChrome = () => post({
            type: 'chrome',
            status: sync ? sync.textContent : '',
            admin: !!(dash && dash.classList.contains('visible'))
        });
        if (sync) new MutationObserver(syncChrome).observe(sync, { childList: true, characterData: true, subtree: true });
        if (dash) new MutationObserver(syncChrome).observe(dash, { attributes: true, attributeFilter: ['class'] });
        syncChrome();
        checkOverlay();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
