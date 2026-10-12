// Offline shell: the app's static files are cached so it opens even when the local server
// is stopped (it then shows how to start it). API calls are never cached.
const CACHE = 'balancer-shell-v4';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'api.js', 'backup.js', 'ui.js', 'charts.js', 'shell.js',
  'views/home.js', 'views/month.js', 'views/transactions.js', 'views/budget.js', 'views/more.js',
  'views/trends.js', 'views/recurring.js', 'views/accounts.js', 'views/settings.js', 'views/prefs.js', 'views/categories.js', 'views/flow.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first (always the latest code), cache as fallback when the server is down
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then(hit => hit || (event.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
