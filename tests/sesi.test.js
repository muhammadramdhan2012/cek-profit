/* Uji M4: sesi tidak hilang karena gangguan jaringan saat token diperbarui.
 * Definisi: sesi dihapus HANYA bila server menolak refresh token (400/401/403). Gagal jaringan, 429, atau 5xx →
 * sesi dipertahankan, permintaan gagal dengan status 0 ("Tidak bisa terhubung ke server"), dan dicoba lagi nanti.
 * Token baru dari URL tetap ketat: tidak bisa diverifikasi → sesi dihapus (keamanan didahulukan).
 * fetch diganti tiruan; tanpa jaringan sungguhan. Jalankan: node tests/sesi.test.js
 */
const CekCloud = require('../assets/cloud.js');

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };

const now = () => Math.floor(Date.now() / 1000);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const SESI = (extra = {}) => ({ access_token: 'lama', refresh_token: 'rt-1', expires_at: now() - 30, user: { id: 'u1', email: 'a@b.id' }, last_active: now(), ...extra });

/** Siapkan klien dengan sesi kedaluwarsa dan fetch tiruan. `refresh` = perilaku endpoint refresh token. */
function siapkan(refresh, { sesi = SESI() } = {}) {
  const store = mem(); store.setItem('cekprofit.session', JSON.stringify(sesi));
  const panggilan = [];
  global.fetch = async (url, opt = {}) => {
    panggilan.push({ url, auth: (opt.headers || {}).Authorization || '' });
    if (url.includes('grant_type=refresh_token')) return refresh();
    // Endpoint lain: token kedaluwarsa → 401, token baru → 200.
    if ((opt.headers || {}).Authorization === 'Bearer lama') return jawab(401, { message: 'JWT expired' });
    if (url.includes('/auth/v1/user')) return jawab(200, { id: 'u1', email: 'a@b.id' });
    return jawab(200, [{ settings: {}, profile: {}, updated_at: '2026-11-24' }]);
  };
  const c = CekCloud.init({ url: 'https://contoh.supabase.co', key: 'anon', store, tabStore: mem() });
  return { c, store, panggilan };
}
const jawab = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const putus = () => { throw new TypeError('Failed to fetch'); };
const sesiAda = (store) => !!store.getItem('cekprofit.session');

test('S1 jaringan putus saat token diperbarui → sesi tetap ada, permintaan gagal "tidak terhubung"', async () => {
  const { c, store, panggilan } = siapkan(putus);
  let err = null; try { await c.db.loadData(); } catch (e) { err = e; }
  truthy(err && err.status === 0, `harus gagal status 0, dapat ${err && err.status}`);
  truthy(/Tidak bisa terhubung/.test(err.message), err.message);
  truthy(sesiAda(store) && c.auth.user(), 'sesi harus tetap ada');
  eq(panggilan.filter((x) => x.auth === 'Bearer lama').length, 0, 'token kedaluwarsa tidak boleh dikirim');
});
test('S2 server gangguan (503) dan terlalu banyak permintaan (429) → sesi tetap ada', async () => {
  for (const st of [503, 500, 429]) {
    const { c, store } = siapkan(() => jawab(st, { message: 'gangguan' }));
    try { await c.db.loadData(); } catch (e) { /* diharapkan gagal */ }
    truthy(sesiAda(store) && c.auth.user(), `status ${st}: sesi harus tetap ada`);
  }
});
test('S3 server menolak refresh token (400/401/403) → sesi dihapus (keluar)', async () => {
  for (const st of [400, 401, 403]) {
    const { c, store } = siapkan(() => jawab(st, { error_description: 'Invalid Refresh Token' }));
    try { await c.db.loadData(); } catch (e) { /* abaikan */ }
    truthy(!sesiAda(store) && !c.auth.user(), `status ${st}: sesi harus dihapus`);
  }
});
test('S4 setelah jaringan kembali, sesi yang dipertahankan diperbarui dan permintaan berhasil', async () => {
  let online = false;
  const { c, store } = siapkan(() => (online ? jawab(200, { access_token: 'baru', refresh_token: 'rt-2', expires_in: 3600, user: { id: 'u1' } }) : putus()));
  try { await c.db.loadData(); } catch (e) { /* offline */ }
  online = true;
  const d = await c.db.loadData();
  truthy(d, 'data terbaca'); eq(JSON.parse(store.getItem('cekprofit.session')).access_token, 'baru');
});
test('S5 token masih berlaku: tidak ada refresh, permintaan langsung jalan (regresi)', async () => {
  const { c, panggilan } = siapkan(putus, { sesi: SESI({ access_token: 'baru', expires_at: now() + 3000 }) });
  await c.db.loadData();
  eq(panggilan.filter((x) => x.url.includes('refresh_token')).length, 0);
});
test('S6 regresi keamanan: 401 dengan token yang masih berlaku (dicabut di server) → sesi dihapus', async () => {
  const { c, store } = siapkan(putus, { sesi: SESI({ access_token: 'lama', expires_at: now() + 3000 }) });
  try { await c.db.loadData(); } catch (e) { /* 401 */ }
  truthy(!sesiAda(store), 'sesi yang ditolak server harus dihapus');
});
test('S7 token dari URL yang tidak bisa diverifikasi tetap ditolak (ketat, demi keamanan)', async () => {
  const { c, store } = siapkan(putus, { sesi: null });
  global.fetch = async () => putus();
  let err = null; try { await c.auth.fromUrlHash('#access_token=x&refresh_token=y&expires_in=3600'); } catch (e) { err = e; }
  truthy(err, 'harus gagal'); truthy(!sesiAda(store), 'sesi tidak boleh tersimpan');
});
test('S8 keluar saat offline: sesi di perangkat tetap dihapus (regresi)', async () => {
  const { c, store } = siapkan(putus, { sesi: SESI({ expires_at: now() + 3000 }) });
  global.fetch = async () => putus();
  const ok = await c.auth.signOut();
  eq(ok, false); truthy(!sesiAda(store));
});

(async () => {
  for (const [name, fn] of tests) { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } }
  console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji sesi lulus');
  process.exit(failed ? 1 : 0);
})();
