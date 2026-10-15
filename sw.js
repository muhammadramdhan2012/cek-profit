/* Service worker: menyimpan halaman & aset agar aplikasi tetap bisa dipakai tanpa internet.
 * Strategi: jaringan dulu untuk HTML/JS/CSS (agar pembaruan langsung terlihat), cache sebagai cadangan offline.
 * Naikkan VERSION setiap rilis agar cache lama dibersihkan.
 */
const VERSION = 'cekprofit-d60a9df610';
const CORE = ['./', 'index.html', 'dashboard.html', 'akun.html', 'privasi.html', 'icon.svg',
  'assets/base.css', 'assets/app.css', 'assets/site.css', 'assets/report.css', 'assets/account.css',
  'assets/config.js', 'assets/theme.js', 'assets/motion.js', 'assets/analytics.js', 'assets/engine.js', 'assets/demo.js', 'assets/license.js', 'assets/cloud.js', 'assets/report.js', 'assets/tarif.js', 'assets/penjelasan.js', 'assets/app.js', 'assets/akun.js',
  'vendor/xlsx.full.min.js', 'fonts/jakarta.woff'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // akun (Supabase) & analytics tidak disentuh
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('dashboard.html')))
  );
});
