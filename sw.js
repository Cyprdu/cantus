const CACHE_NAME = 'cantus-app-shell-v24';
const PDF_CACHE_NAME = 'cantus-pdfs-v1';

// Les fichiers essentiels de l'application à mettre en cache obligatoirement à l'installation
// (les anciennes versions v1/v2/v3, déplacées dans autre/, ne sont plus l'application servie :
// elles n'ont plus à être pré-cachées)
const ASSETS = [
    // 'index.html' n'est volontairement PAS pré-caché ici : sur cet hébergeur (Cloudflare Pages),
    // cette URL fait l'objet d'une redirection HTTP 308 automatique vers './'. La précacher aurait
    // stocké une Response marquée "redirected", ce que Safari refuse de servir pour une navigation
    // (voir stripRedirectFlag plus bas) — c'est précisément ce qui bloquait l'app en relance PWA
    // depuis l'écran d'accueil (dont le raccourci pointait vers .../index.html). './' suffit et
    // pointe directement vers l'URL canonique, sans jamais passer par la redirection.
    './',
    'favicon.ico',
    // Librairies tierces : servies localement depuis bibliotheque/ (téléchargées une fois pour
    // toutes dans le dépôt) plutôt que depuis un CDN externe, pour que l'app reste fonctionnelle
    // même si ce CDN venait à disparaître ou à être injoignable.
    'bibliotheque/pdfjs/pdf.min.js',
    'bibliotheque/pdfjs/pdf.worker.min.js',
    'bibliotheque/sortable/Sortable.min.js',
    'bibliotheque/lz-string/lz-string.min.js',
    'bibliotheque/qrious/qrious.min.js',
    'bibliotheque/jsqr/jsQR.js'
    // Les scripts MediaPipe (camera_utils, face_mesh) ne sont pas pré-cachés ici (gros fichiers
    // .wasm/.data inutiles à la quasi-totalité des utilisateurs) : ils sont chargés à la demande
    // par ensureFaceMeshEngine() uniquement si la reconnaissance faciale est activée, puis mis en
    // cache à la volée par le fetch handler ci-dessous comme le reste. Ils sont servis depuis
    // bibliotheque/mediapipe/ au lieu d'un CDN externe.
];

// 1. Installation : Télécharge et met en cache l'application de base
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// 2. Activation : Nettoyage des anciennes versions du cache
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key !== PDF_CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Safari refuse de terminer une navigation si le service worker répond avec une Response
// dont le flag interne "redirected" est true ("Response served by service worker as
// redirection"). On reconstruit alors une Response neuve à partir du corps pour effacer
// ce marqueur avant de la mettre en cache ou de la renvoyer.
async function stripRedirectFlag(response) {
    if (!response || !response.redirected) return response;
    const body = await response.clone().arrayBuffer();
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

// 3. Interception robuste (Cache First avec repli intelligent)
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Ne pas intercepter l'API GitHub pour le listing brut en ligne
    if (url.includes('api.github.com')) {
        return;
    }

    // Ni les registres JSON du dépôt (catégories, playlists et messes publiques…) lus sur
    // raw.githubusercontent.com : en cache-first, l'app relisait indéfiniment leur première
    // version — nouvelles photos de playlist invisibles, modifications des admins ignorées.
    if (url.includes('raw.githubusercontent.com') && url.split('?')[0].endsWith('.json')) {
        return;
    }

    // Ne jamais mettre en cache version.json : il doit toujours être lu depuis le réseau
    // pour que la vérification de mise à jour de l'app fonctionne.
    if (url.includes('version.json')) {
        return;
    }

    event.respondWith((async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
            // Retourne la ressource du cache si elle existe
            return cachedResponse;
        }

        try {
            // Sinon, essaie de la récupérer sur le réseau
            const networkResponse = await fetch(event.request);
            if (networkResponse && networkResponse.status === 200) {
                // Le bufferisage complet (stripRedirectFlag) n'est nécessaire que pour les
                // navigations : c'est le seul cas où Safari refuse une Response "redirected".
                // Pour tout le reste (PDF, JS, images...), on laisse la réponse streamer
                // normalement afin de ne pas ralentir les téléchargements.
                const safeResponse = event.request.mode === 'navigate'
                    ? await stripRedirectFlag(networkResponse)
                    : networkResponse;
                const responseToCache = safeResponse.clone();
                const targetCache = url.includes('.pdf') ? PDF_CACHE_NAME : CACHE_NAME;
                caches.open(targetCache).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return safeResponse;
            }
            return networkResponse;
        } catch (err) {
            // SI ON EST HORS-LIGNE et que la ressource n'est pas dans le cache principal :
            // On redirige intelligemment vers la page d'accueil pour éviter le message d'erreur
            // brut. On matche './' (toujours précaché, jamais sujet à la redirection 308 de
            // l'hébergeur) plutôt que 'index.html'.
            if (event.request.mode === 'navigate') {
                return caches.match('./');
            }

            return new Response("Fichier non disponible hors-ligne", {
                status: 404,
                statusText: "Not Found"
            });
        }
    })());
});