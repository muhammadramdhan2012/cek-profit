/* Uji penyimpanan hasil olahan laporan di perangkat (assets/simpan-lokal.js) — keputusan pemilik 27 Nov 2026.
 * Definisi:
 *  - Yang disimpan hasil olahan (parsed), bukan file asli; teks bebas pembeli (catatan retur) dikosongkan.
 *  - Simpan → buka menghasilkan angka laba yang identik.
 *  - Hanya untuk akun (tanpa userId tidak disimpan); data akun lain, format lain, atau versi mesin hitung lain ditolak.
 *  - File gagal baca dan template modal tidak disimpan.
 *  - Keluar / tombol hapus / tanpa akun menghapus data (diperiksa pada sumber app.js dan akun.js).
 * Jalankan: node tests/simpan-lokal.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');
const L = require('../assets/simpan-lokal.js');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };

const files = D.make().map((w) => { const p = E.parseWorkbook(w); return { name: w.name, kind: p.kind, parsed: p }; });
const ctx = { userId: 'u-1', versiMesin: 'abc123', waktu: '2026-11-27T01:00:00.000Z' };
const hitung = (fs_) => E.compute(fs_.filter((f) => f.parsed.kind !== 'modal_template').map((f) => f.parsed), D.settings(), {});
// Angka saja: catatan pembeli memang sengaja tidak disimpan.
const angka = (r) => JSON.stringify(r, (k, v) => (k === 'note' ? undefined : v));

test('S1 simpan → buka: angka laba identik (lewat JSON seperti di IndexedDB)', () => {
  const rec = JSON.parse(JSON.stringify(L.bungkus(files, ctx)));
  const b = L.buka(rec, ctx);
  truthy(b.files && b.files.length === files.length, 'semua file kembali');
  eq(b.waktu, ctx.waktu);
  truthy(angka(hitung(b.files)) === angka(hitung(files)), 'hasil hitung berbeda');
});
test('S2 catatan bebas pembeli tidak disimpan; data asli di memori tidak berubah', () => {
  const adaCatatan = files.some((f) => (f.parsed.cases || []).some((c) => c.note));
  truthy(adaCatatan, 'data contoh harus punya catatan retur');
  const rec = L.bungkus(files, ctx);
  for (const f of rec.files) for (const c of f.parsed.cases || []) eq(c.note, '', 'note');
  truthy(files.some((f) => (f.parsed.cases || []).some((c) => c.note)), 'objek asli tidak boleh ikut berubah');
});
test('S3 penolakan: tanpa akun, akun lain, format lain, versi mesin lain, kosong', () => {
  eq(L.bungkus(files, { ...ctx, userId: '' }), null, 'tamu');
  const rec = L.bungkus(files, ctx);
  eq(L.buka(rec, { ...ctx, userId: 'u-2' }).tolak, 'akun_lain');
  eq(L.buka({ ...rec, format: 99 }, ctx).tolak, 'format');
  eq(L.buka(rec, { ...ctx, versiMesin: 'lain' }).tolak, 'versi_mesin');
  eq(L.buka(null, ctx).tolak, 'kosong');
  eq(L.buka({ ...rec, files: [] }, ctx).tolak, 'kosong');
});
test('S4 file gagal baca dan template modal tidak disimpan; hanya itu → tidak ada yang disimpan', () => {
  const gagal = { name: 'x.xlsx', kind: 'unknown', error: 'File kosong' };
  const tpl = { name: 'modal.xlsx', kind: 'modal_template', parsed: { kind: 'modal_template', entries: [] } };
  eq(L.bungkus([gagal, tpl], ctx), null);
  eq(L.bungkus([...files, gagal, tpl], ctx).files.length, files.length);
});
test('S5 penghapusan terpasang: keluar, tanpa akun, tombol hapus, hapus data browser, halaman akun', () => {
  const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  const akun = fs.readFileSync(require.resolve('../assets/akun.js'), 'utf8');
  truthy(/account\.user = null;[^\n]*\n\s+await hapusLokal\(\);[^\n]*\n\s+await cloud\.auth\.signOut\(\);/.test(app), 'keluar menghapus sebelum signOut');
  truthy(/if \(!account\.user\) \{ await CekSimpanLokal\.hapus\(\);/.test(app), 'tanpa akun → hapus');
  truthy(/t\.id === 'hapus-lokal'\) \{ files = \[\]; resetView\(\); await hapusLokal\(\);/.test(app), 'tombol hapus');
  truthy(/await hapusLokal\(\); files = \[\]; resetView\(\);/.test(app), 'hapus data di browser ini');
  truthy(/hapusLokal\(\); renderAccount\(\); loadStatus\(\);/.test(app), 'sesi berakhir');
  truthy(/await CekSimpanLokal\.hapus\(\);\n\s+const ok = await cloud\.auth\.signOut/.test(akun), 'keluar dari halaman akun');
  truthy(/if \(typeof CekSimpanLokal === 'undefined' \|\| demo \|\| !account\.user\) return;/.test(app), 'mode contoh & tamu tidak menyimpan');
});
if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji simpan di perangkat lulus.');
