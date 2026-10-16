// Injecté par l'app iOS dans cantus-app.fr avant tout script de la page.
// Branche les API web absentes ou limitées de WKWebView sur le natif, sans rien changer à
// index.html : la PWA du site reste strictement identique pour les navigateurs.
(function () {
    const post = (msg) => { try { window.webkit.messageHandlers.cantus.postMessage(msg); } catch (e) {} };

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
    const TAPPABLE = 'button, a[href], [onclick], [role="button"], .btn, select, label, input[type="checkbox"], input[type="radio"], summary';
    // 'click' plutôt que 'pointerdown' : un doigt posé pour faire défiler une liste ne vibre pas.
    document.addEventListener('click', (e) => {
        const el = e.target instanceof Element && e.target.closest(TAPPABLE);
        if (el && !el.disabled) post({ type: 'tap' });
    }, { capture: true, passive: true });

    document.addEventListener('DOMContentLoaded', () => {
        // Plein écran bord à bord : la page gère déjà env(safe-area-inset-*).
        const vp = document.querySelector('meta[name="viewport"]');
        if (vp && !/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';

        // Pas de surbrillance grise ni de menu « copier/ouvrir le lien » au toucher long.
        const style = document.createElement('style');
        style.textContent = '*{-webkit-tap-highlight-color:transparent}a,button,img{-webkit-touch-callout:none}';
        document.head.appendChild(style);

        // Couleur de la barre d'état synchronisée avec le thème clair/sombre de l'app.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            const sync = () => post({ type: 'theme', color: meta.getAttribute('content') });
            new MutationObserver(sync).observe(meta, { attributes: true, attributeFilter: ['content'] });
            sync();
        }
    });
})();
