/* Service worker: menyimpan halaman & aset agar aplikasi tetap bisa dipakai tanpa internet.
 * Strategi: jaringan dulu untuk HTML/JS/CSS (agar pembaruan langsung terlihat), cache sebagai cadangan offline.
 * Naikkan VERSION setiap rilis agar cache lama dibersihkan.
 */
const VERSION = 'cekprofit-94f98e0a66';
const CORE = ['./', 'index.html', 'dashboard.html', 'akun.html', 'privasi.html', 'icon.svg', 'icon-cek-untung.svg', 'apple-touch-icon.png',
  'assets/base.css', 'assets/app.css', 'assets/site.css', 'assets/report.css', 'assets/account.css',
  'assets/config.js', 'assets/theme.js', 'assets/motion.js', 'assets/analytics.js', 'assets/engine.js', 'assets/demo.js', 'assets/license.js', 'assets/cloud.js', 'assets/report.js', 'assets/tarif.js', 'assets/penjelasan.js', 'assets/app.js', 'assets/akun.js', 'assets/aturan-akun.js', 'assets/situs.js',
  'vendor/xlsx.full.min.js', 'fonts/jakarta.woff'];

// Cloudflare Pages mengalihkan /dashboard.html → /dashboard (308). Karena itu:
//  1. kunci cache dinormalkan ke nama file (/dashboard, /dashboard.html, /dashboard?demo → dashboard.html);
//  2. respons hasil redirect disalin ulang sebelum disimpan, sebab browser menolak respons "redirected"
//     untuk navigasi halaman (offline jadi gagal total).
// Di GitHub Pages (tanpa redirect) perilakunya sama seperti sebelumnya.
const SCOPE = new URL(self.registration ? self.registration.scope : './', self.location).pathname;
function kunci(url) {
  const u = new URL(url, self.location);
  let rel = u.pathname.startsWith(SCOPE) ? u.pathname.slice(SCOPE.length) : u.pathname.replace(/^\//, '');
  if (rel === '' || rel === 'index' || rel === 'index.html') return new URL('./', self.location.origin + SCOPE).href;
  if (!/\.[a-z0-9]+$/i.test(rel)) rel += '.html';
  return new URL(rel, self.location.origin + SCOPE).href;
}
async function bersih(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}
async function simpan(cache, url, res) { await cache.put(kunci(url), await bersih(res)); }

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(CORE.map(async (f) => {
    const res = await fetch(new Request(f, { cache: 'reload' }));
    if (!res.ok) throw new Error(`gagal menyimpan ${f}`);
    await simpan(c, res.url || new URL(f, self.location).href, res);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // akun (Supabase) & analytics tidak disentuh
  const nav = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => simpan(c, res.url || e.request.url, copy)); } return res; })
      .catch(() => caches.match(kunci(e.request.url)).then((hit) => hit || (nav ? caches.match(kunci('dashboard.html')) : Response.error())))
  );
});
