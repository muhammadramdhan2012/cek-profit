/* Uji peringatan isian modal rata-rata yang tidak wajar (Engine.periksaModalRata) dan ajakan isi modal per produk.
 * Definisi (hanya peringatan; angka laba tidak berubah):
 *  - 'pasti_rugi'    : modal% + potongan marketplace% (dari laporan) ≥ 100% → setiap penjualan yang memakai angka itu pasti rugi.
 *  - 'terlalu_rendah': modal rata-rata < 20% dari harga jual (ambang tampilan, usulan) → mungkin salah isi.
 *  - kosong / 0 / tidak terbaca → tidak ada peringatan (bukan dianggap angka).
 *  - potongan tidak diketahui → hanya pemeriksaan "terlalu rendah" yang berlaku.
 * Jalankan: node tests/modal-rata.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };

test('M1 modal 95% + potongan 11,9% → pasti rugi', () => {
  const c = E.periksaModalRata(95, 0.119);
  eq(c.jenis, 'pasti_rugi'); eq(c.modalPct, 95); eq(Math.round(c.potonganPct * 10) / 10, 11.9);
});
test('M2 batas tepat 100% termasuk pasti rugi; di bawahnya tidak', () => {
  eq(E.periksaModalRata(88, 0.12).jenis, 'pasti_rugi');
  eq(E.periksaModalRata(87, 0.12), null);
});
test('M3 modal wajar (83,6%) → tanpa peringatan', () => eq(E.periksaModalRata(83.6, 0.119), null));
test('M4 modal < 20% → terlalu rendah; 20% tepat → tidak', () => {
  eq(E.periksaModalRata(8, 0.118).jenis, 'terlalu_rendah');
  eq(E.periksaModalRata(19.9, 0.1).jenis, 'terlalu_rendah');
  eq(E.periksaModalRata(20, 0.1), null);
});
test('M5 kosong, 0, NaN, negatif → tanpa peringatan (tidak dianggap angka)', () => {
  for (const v of [null, undefined, NaN, 0, -5, '']) eq(E.periksaModalRata(v, 0.12), null, String(v));
});
test('M6 potongan tidak diketahui / nol → hanya cek terlalu rendah', () => {
  eq(E.periksaModalRata(95, NaN), null);
  eq(E.periksaModalRata(95, 0), null);
  eq(E.periksaModalRata(10, NaN).jenis, 'terlalu_rendah');
});
test('M8 dashboard: peringatan di isian modal rata-rata dan daftar perhatian; ajakan modal per produk naik bila ≥ 50% perkiraan', () => {
  const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  truthy(/Engine\.periksaModalRata\(s\.fallbackPct, -r\.totalFees \/ r\.totalSales\)/.test(app), 'memakai engine');
  truthy(/tersimpan, tetapi membuat penjualan yang memakainya rugi/.test(app) && /tersimpan, tetapi tampak sangat rendah/.test(app), 'teks dua jenis');
  truthy((app.match(/Angka ini tetap dipakai dalam perhitungan\./g) || []).length === 2, 'menegaskan angka tetap dipakai');
  truthy(/note-box warn" role="status"><b>\$\{esc\(w\.judul\)\}/.test(app), 'peringatan di bawah isian, di-escape');
  truthy(/add\('danger', wModal\.judul/.test(app), 'masuk daftar perhatian');
  truthy(/besar \? 'Laba ini masih perkiraan'/.test(app) && /besar \? 80 : 40/.test(app), 'ajakan naik prioritas');
});

if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji modal rata-rata lulus.');
