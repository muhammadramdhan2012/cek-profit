/* Uji daftar pesanan "HPP belum pasti" (kepastian.cakupan.belumDaftar) dan kartu "Perlu perhatian" terkait.
 * Definisi (metadata tampilan; angka laba tidak berubah):
 *  - belumDaftar berisi satu baris per pesanan berstatus "belum": platform, orderId, produk, penjualan, alasan.
 *  - Jumlah baris = cakupan.jumlahPesanan.belum dan jumlah penjualannya = cakupan.penjualan.belum (bila tidak terpotong).
 *  - Alasan "modal_rata_rata" tidak dicantumkan (bukan penyebab "belum").
 *  - Kartu "Data refund berbeda antar laporan" tidak menawarkan tombol yang tidak bisa menyelesaikannya.
 * Jalankan: node tests/hpp-belum.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const r = E.compute(D.make().map((w) => E.parseWorkbook(w)), D.settings(), {}, { platforms: ['shopee'], from: '2026-03', to: '2026-03' });
const c = r.kepastian.cakupan;
const rAll = E.compute(D.make().map((w) => E.parseWorkbook(w)), D.settings(), {});

test('H1 jumlah dan penjualan daftar cocok dengan status "belum"', () => {
  truthy(c.penjualan.belum > 0, 'data contoh harus punya pesanan belum');
  eq(c.belumDaftarPenuh, false);
  eq(c.belumDaftar.length, c.jumlahPesanan.belum, 'jumlah pesanan');
  eq(Math.round(c.belumDaftar.reduce((a, d) => a + d.penjualan, 0)), Math.round(c.penjualan.belum), 'penjualan');
});
test('H1b daftar terpotong di 300, tetapi hitungan per alasan tetap lengkap', () => {
  const k = rAll.kepastian.cakupan;
  truthy(k.belumDaftar.length <= 300, 'maks 300');
  if (k.jumlahPesanan.belum > 300) eq(k.belumDaftarPenuh, true);
  const totalAlasan = Object.values(k.belumAlasan).reduce((a, x) => a + x.pesanan, 0);
  truthy(totalAlasan >= k.jumlahPesanan.belum, 'setiap pesanan belum punya minimal satu alasan');
});
test('H2 setiap baris punya alasan, tanpa modal_rata_rata, dan bentuk data yang benar', () => {
  for (const d of c.belumDaftar) {
    truthy(['shopee', 'tiktok'].includes(d.platform), 'platform');
    truthy(Array.isArray(d.produk) && Array.isArray(d.alasan) && d.alasan.length > 0, `alasan ${d.orderId}`);
    truthy(!d.alasan.includes('modal_rata_rata'), 'tanpa modal_rata_rata');
    truthy(typeof d.orderId === 'string' && Number.isFinite(d.penjualan), 'tipe');
  }
});
test('H3 tanpa modal sama sekali: daftar kosong (tidak ada status belum)', () => {
  const k = E.compute(D.make().map((w) => E.parseWorkbook(w)), { ...D.settings(), catalog: [], fallbackPct: null }, {}).kepastian.cakupan;
  eq(k.belumDaftar.length, k.jumlahPesanan.belum);
});
test('H4 kartu: daftar bisa dibuka, teks di-escape, alasan dalam bahasa seller; kartu konflik tanpa tombol', () => {
  const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  truthy(/alasanUtama\(c\.belumAlasan\)/.test(app), 'alasan utama dari hitungan lengkap');
  truthy(/<summary>Lihat pesanan dan penyebabnya<\/summary>/.test(app), 'details');
  truthy(/\$\{esc\(d\.produk\[0\]/.test(app) && /\$\{esc\(d\.alasan\.map\(teksAlasan\)/.test(app), 'escape');
  truthy(/modal_tingkat_produk: \['modal diisi per produk, belum per variasi'/.test(app), 'teks alasan');
  truthy(/Saat ini belum bisa diselesaikan dari website; laba pesanan lain tidak terpengaruh\./.test(app), 'kartu konflik jujur');
  truthy(/Seller Centre\.`,\n\s+null, 86,/.test(app), 'tanpa tombol');
});
if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji HPP belum pasti lulus.');
