/* Uji teks halaman Retur untuk kasus yang tidak perlu ditandai (tampilan saja; angka laba tidak berubah).
 * Definisi:
 *  - "Terindikasi tidak dikirim" → status "Tidak perlu ditandai", dengan penjelasan arti bagi laba dan tindakan.
 *  - Pengajuan batal → status "Dibatalkan", "Tidak ada refund dan laba tidak terpengaruh".
 *  - Perkiraan modal kasus tersebut tidak ditampilkan seperti angka yang dipakai: "tidak dikurangkan dari laba" / "Tidak dipakai".
 *  - Label lama yang membingungkan ("Belum bisa ditandai", "Pengajuan batal") tidak dipakai lagi.
 * Jalankan: node tests/retur-teks.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
const pj = fs.readFileSync(require.resolve('../assets/penjelasan.js'), 'utf8');

test('R1 label lama tidak dipakai lagi', () => {
  for (const t of ['Belum bisa ditandai', 'Pengajuan batal']) truthy(!app.includes(`'${t}'`), t);
  truthy(!/belum bisa ditandai/.test(pj), 'penjelasan');
});
test('R2 label dan arti baru untuk kedua kategori', () => {
  truthy(/tidak_dikirim: \{ lbl: 'Tidak perlu ditandai'/.test(app), 'tidak dikirim');
  truthy(/batal: \{ lbl: 'Dibatalkan', arti: '[^']*Tidak ada refund dan laba tidak terpengaruh/.test(app), 'batal');
  truthy(/<b>Artinya:<\/b> \$\{esc\(info\.arti\)\} \$\{esc\(info\.aksi\)\}/.test(app), 'teks di-escape');
});
test('R3 perkiraan modal kasus informasi tidak tampil sebagai angka yang dipakai', () => {
  truthy(/tidak dikurangkan dari laba<\/span>/.test(app) && /'<span class="faint">Tidak dipakai<\/span>'/.test(app), 'label');
});
test('R4 kategori yang tidak perlu ditandai tetap sama di engine (regresi)', () => {
  truthy(/const CHECK_CATS = new Set\(\['retur_barang', 'paket_bermasalah', 'refund_tanpa_retur'\]\)/.test(fs.readFileSync(require.resolve('../assets/engine.js'), 'utf8')), 'CHECK_CATS');
  truthy(E.CAT_LABEL && E.CAT_LABEL.tidak_dikirim, 'label kategori');
});
if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji teks retur lulus.');
