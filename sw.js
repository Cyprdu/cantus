const CACHE_NAME = 'cantus-app-shell-v4';
const PDF_CACHE_NAME = 'cantus-pdfs-v1';

// Les fichiers essentiels de l'application à mettre en cache obligatoirement à l'installation
const ASSETS = [
    '/',
    '/index.html',
    '/index2.html',
    '/index3.html',
    '/favicon.ico',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
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

// 3. Interception robuste (Cache First avec repli intelligent)
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Ne pas intercepter l'API GitHub pour le listing brut en ligne
    if (url.includes('api.github.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Retourne la ressource du cache si elle existe
                return cachedResponse;
            }

            // Sinon, essaie de la récupérer sur le réseau
            return fetch(event.request).then((networkResponse) => {
                // Si la requête réseau réussit, on met la réponse en cache à la volée
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    const targetCache = url.includes('.pdf') ? PDF_CACHE_NAME : CACHE_NAME;
                    caches.open(targetCache).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // SI ON EST HORS-LIGNE et que la ressource n'est pas dans le cache principal :
                // On redirige intelligemment vers index.html pour éviter le message d'erreur brut
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
                
                return new Response("Fichier non disponible hors-ligne", {
                    status: 404,
                    statusText: "Not Found"
                });
            });
        })
    );
});
