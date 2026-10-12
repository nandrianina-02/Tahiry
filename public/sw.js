// Service worker de Tahiry.
// Rôle : (1) rendre l'app installable (critère requis par Chrome/Edge/Android),
// (2) permettre à l'app de se charger même sans connexion (les données, elles,
// passent par IndexedDB — voir index.html — pas par ce cache).
//
// Stratégie : "stale-while-revalidate" pour la coquille de l'app (HTML/manifest/icônes) —
// on sert immédiatement la version en cache si elle existe, tout en la rafraîchissant en
// arrière-plan. Les requêtes vers /api/* ne sont JAMAIS mises en cache : les données
// doivent toujours être fraîches (ou gérées par la logique hors-ligne dédiée du frontend).

const CACHE_NAME = 'tahiry-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne touche jamais aux requêtes non-GET (POST/PUT/DELETE) : elles doivent
  // toujours passer directement par le réseau (création/modification de données).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Jamais de cache pour l'API : les données doivent toujours être à jour.
  if (url.pathname.startsWith('/api/')) return;

  // Autres domaines (CDN Chart.js, polices Google, etc.) : on laisse passer normalement,
  // sans les mettre en cache ici (évite de gonfler le cache avec des librairies tierces).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // hors-ligne et pas en cache : on n'a rien de mieux à proposer

      return cached || networkFetch;
    })
  );
});
