const CACHE_NAME = 'cantus-app-shell-v2';
const PDF_CACHE_NAME = 'cantus-pdfs-v1';

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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('api.github.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                return networkResponse;
            }).catch(() => {
                // S'assure de ne jamais renvoyer undefined/null pour éviter le crash Safari
                return new Response("Ressource hors-ligne non disponible", {
                    status: 404,
                    statusText: "Not Found"
                });
            });
        })
    );
});
