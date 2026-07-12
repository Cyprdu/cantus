const CACHE_NAME = 'cantus-app-shell-v1';
const PDF_CACHE_NAME = 'cantus-pdfs-v1'; // Géré dans le main script, déclaré ici pour éviter son effacement

// Ressources de base à télécharger et garder en cache pour l'interface
const ASSETS = [
    '/',
    '/index.html',
    '/favicon.ico',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js'
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
    // Nettoyer les anciens caches si on change de version (ex: v2)
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

// Stratégie "Cache First" pour les assets de l'app, et les PDF
self.addEventListener('fetch', (event) => {
    // Ne pas intercepter les requêtes API Github pour toujours avoir la liste fraîche si on a le net
    if (event.request.url.includes('api.github.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            // Si pas en cache, chercher sur le réseau
            return fetch(event.request).then((networkResponse) => {
                return networkResponse;
            }).catch(() => {
                // Optionnel: Retourner une page d'erreur si la ressource échoue et n'est pas en cache
                console.error("Réseau indisponible et ressource non trouvée en cache :", event.request.url);
            });
        })
    );
});
