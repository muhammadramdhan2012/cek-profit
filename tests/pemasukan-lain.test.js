/* Uji pemasukan di luar marketplace (A.25, DITETAPKAN pemilik 27 Nov 2026 — "setuju jalan tengah").
 * Definisi:
 *  - settings.pemasukanLain = [{ bulan:'YYYY-MM', label, amount }], diisi seller.
 *  - Masuk bila bulan di antara bulan pesanan yang dipilih (tanpa filter: bulan pesanan pertama–terakhir di data).
 *  - Nominal harus > 0; bulan/nominal kosong, nol, negatif, atau tak terbaca tidak dihitung (bukan dianggap 0).
 *  - Laba utama (laba setelah modal, laba dari data tersedia) TIDAK berubah.
 *  - labaSetelahIsian = laba dari data tersedia + total pemasukan; tidak ada pemasukan → tidak dihitung (NaN).
 * Jalankan: node tests/pemasukan-lain.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');
const C = require('../assets/report.js');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const parsed = D.make().map((w) => E.parseWorkbook(w));
const hitung = (pl, filter = {}) => E.compute(parsed, { ...D.settings(), pemasukanLain: pl }, {}, filter);
const dasar = (filter = {}) => E.compute(parsed, D.settings(), {}, filter);
const bulan = dasar().allMonths;

test('P1 tanpa isian: tidak ada pemasukan; laba utama sama dengan tanpa kunci pengaturan', () => {
  const r = hitung([]), b = dasar();
  eq(r.pemasukanLain.total, 0); truthy(Number.isNaN(r.labaSetelahIsian), 'NaN');
  eq(r.totalMargin, b.totalMargin); eq(r.netProfit, b.netProfit);
});
test('P2 isian bulan yang dipilih: dijumlahkan; laba utama tidak berubah', () => {
  const m = bulan[1], f = { from: m, to: m };
  const r = hitung([{ bulan: m, label: 'Penggantian AMS', amount: 506000 }], f), b = dasar(f);
  eq(r.pemasukanLain.total, 506000); eq(r.pemasukanLain.rincian[0].label, 'Penggantian AMS');
  eq(r.totalMargin, b.totalMargin, 'laba setelah modal'); eq(r.netProfit, b.netProfit, 'laba dari data tersedia');
  eq(r.labaSetelahIsian, b.netProfit + 506000);
});
test('P3 bulan di luar pilihan tidak dihitung', () => {
  const r = hitung([{ bulan: bulan[0], label: 'x', amount: 100000 }], { from: bulan[2], to: bulan[3] });
  eq(r.pemasukanLain.total, 0);
});
test('P4 isian tidak sah tidak dihitung (nol, negatif, kosong, tak terbaca, bulan salah)', () => {
  const m = bulan[0];
  const r = hitung([{ bulan: m, amount: 0 }, { bulan: m, amount: -5000 }, { bulan: m, amount: null }, { bulan: m, amount: NaN },
    { bulan: '', amount: 1000 }, { bulan: '2026-1', amount: 1000 }, null, { bulan: m, amount: 2500 }]);
  eq(r.pemasukanLain.total, 2500); eq(r.pemasukanLain.rincian.length, 1);
});
test('P5 tanpa filter: hanya bulan dalam rentang bulan pesanan data', () => {
  const r = hitung([{ bulan: bulan[0], amount: 1000 }, { bulan: bulan[bulan.length - 1], amount: 2000 }, { bulan: '2020-01', amount: 9999 }, { bulan: '2099-12', amount: 9999 }]);
  eq(r.pemasukanLain.total, 3000);
});
test('P6 PDF dan dashboard: baris terpisah berlabel isian Anda, teks di-escape', () => {
  const m = bulan[1], f = { from: m, to: m }, st = { ...D.settings(), pemasukanLain: [{ bulan: m, label: '<b>AMS</b>', amount: 506000 }] };
  const r = E.compute(parsed, st, {}, f);
  const h = C.html(r, { settings: st, profile: {}, filter: f, brand: 'Cek Untung' });
  truthy(h.includes('Pemasukan di luar marketplace (isian Anda)') && h.includes('Laba setelah isian Anda'), 'baris PDF');
  truthy(h.includes('&lt;b&gt;AMS&lt;/b&gt;') && !h.includes('<b>AMS</b>'), 'escape');
  const tanpa = C.html(dasar(f), { settings: D.settings(), profile: {}, filter: f, brand: 'Cek Untung' });
  truthy(!tanpa.includes('Laba setelah isian Anda'), 'tanpa isian tidak muncul');
  const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  truthy(/\$\{esc\(pl\.rincian\.map/.test(app) && /value="\$\{esc\(x\.label \|\| ''\)\}"/.test(app), 'dashboard escape');
  truthy(/pemasukanLain: \[\],/.test(app), 'nilai bawaan pengaturan');
});
if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji pemasukan di luar marketplace lulus.');
