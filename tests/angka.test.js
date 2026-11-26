/* Uji pembaca angka (KNOWN_ISSUES P1) dan isian template modal yang tidak terbaca. Data SINTETIS.
 * Definisi:
 *  - Koma diikuti 1–2 digit di akhir = koma desimal ("45000,00" = 45.000; "12,5" = 12,5).
 *  - Titik ribuan + koma desimal ("45.000,50") dan koma ribuan gaya Inggris ("1,234") tetap seperti sebelumnya.
 *  - Isian modal/sampul di template yang tidak terbaca ("45rb", "45.000.00", teks) atau negatif TIDAK dianggap Rp0:
 *    produk itu = modal belum diisi, dan dilaporkan di `tidakTerbaca`. Modal 0 yang sengaja diisi tetap 0.
 * Jalankan: node tests/angka.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');

let failed = 0;
// Data tampilan (tglPesanan, 24 Nov 2026) tidak dipakai dalam rumus; diabaikan saat membandingkan angka.
const tanpaTampilan = (k, v) => (k === 'tglPesanan' || k === 'belumDaftar' || k === 'belumDaftarPenuh' || k === 'belumAlasan' || k === 'dikeluarkanDaftar' || k === 'dikeluarkanDaftarPenuh' || k === 'dasarBulan' || (k === 'shopeeFormatLama' && v === null) ? undefined : v);
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };

const HEADER = ['Platform', 'Kode', 'Nama produk', 'Variasi', 'Terjual', 'Harga jual rata-rata (Rp)', 'Modal per unit (Rp)', 'Harga sampul (Rp)'];
const template = (rows) => E.parseWorkbook({ name: 'modal.xlsx', sheets: { Modal: [HEADER, ...rows.map(([kode, nama, modal, sampul]) => ['Shopee', kode, nama, '', 1, 50000, modal, sampul])] } });

/* ---------- num: format angka ---------- */
test('A1 koma desimal tanpa titik ribuan: "45000,00" = 45.000 (dulu 4.500.000)', () => eq(E.num('45000,00'), 45000));
test('A2 "12,5" = 12,5 (dulu 125)', () => eq(E.num('12,5'), 12.5));
test('A3 "Rp45000,5" dan "-45000,50"', () => { eq(E.num('Rp45000,5'), 45000.5); eq(E.num('-45000,50'), -45000.5); });
test('A4 regresi: titik ribuan / koma desimal tetap', () => { eq(E.num('45.000'), 45000); eq(E.num('45.000,50'), 45000.5); eq(E.num('1.234.567'), 1234567); eq(E.num('Rp 1.234'), 1234); });
test('A5 regresi: koma ribuan gaya Inggris tetap', () => { eq(E.num('1,234'), 1234); eq(E.num('1,234,567.89'), 1234567.89); eq(E.num('45,000'), 45000); });
test('A6 regresi: angka murni, number, kosong, tanda strip', () => {
  eq(E.num('45000'), 45000); eq(E.num(45000), 45000); eq(E.num(-1500.5), -1500.5); eq(E.num('12.5'), 12.5);
  eq(E.num(''), 0); eq(E.num(null), 0); eq(E.num('-'), 0); eq(E.num(0), 0);
});
test('A7 num tetap mengembalikan 0 untuk teks tak terbaca (perilaku laporan marketplace tidak berubah)', () => { eq(E.num('abc'), 0); eq(E.num(NaN), 0); });

/* ---------- angkaIsian: isian seller ---------- */
test('B1 angkaIsian membaca format wajar', () => {
  eq(E.angkaIsian('45000'), 45000); eq(E.angkaIsian('45.000'), 45000); eq(E.angkaIsian('45000,00'), 45000);
  eq(E.angkaIsian('Rp 45.000'), 45000); eq(E.angkaIsian('Rp. 45.000'), 45000); eq(E.angkaIsian(45000), 45000); eq(E.angkaIsian('0'), 0);
});
test('B2 angkaIsian: tidak terbaca → NaN (bukan 0)', () => {
  for (const v of ['45rb', '45 ribu', 'empat puluh', '45.000.00', '1e5', '0x10', 'Infinity', '45k']) truthy(Number.isNaN(E.angkaIsian(v)), `"${v}" harus NaN, dapat ${E.angkaIsian(v)}`);
});

/* ---------- template modal ---------- */
test('C1 template: "45rb" tidak menjadi modal 0, dilaporkan tidak terbaca', () => {
  const p = template([['K1', 'Buku A', '45rb', '']]);
  eq(p.entries, []); eq(p.tidakTerbaca, [{ kode: 'K1', nama: 'Buku A', variasi: '', isi: '45rb' }]);
});
test('C2 template: "45000,00" terbaca 45.000', () => eq(template([['K1', 'Buku A', '45000,00', '']]).entries[0].cost, 45000));
test('C3 template: modal 0 yang sengaja diisi tetap 0 (barang gratis/hadiah)', () => {
  const p = template([['K1', 'Buku A', 0, ''], ['K2', 'Buku B', '0', '']]);
  eq(p.entries.map((e) => e.cost), [0, 0]); eq(p.tidakTerbaca, []);
});
test('C4 template: modal negatif ditolak dan dilaporkan', () => { const p = template([['K1', 'Buku A', '-5000', '']]); eq(p.entries, []); eq(p.tidakTerbaca.length, 1); });
test('C5 template: modal tak terbaca TIDAK diganti harga sampul (bukan tebakan)', () => {
  const p = template([['K1', 'Buku A', '45rb', 90000]]);
  eq(p.entries, []); eq(p.tidakTerbaca[0].isi, '45rb');
});
test('C6 template: harga sampul tak terbaca atau 0 dilaporkan; yang terbaca tetap dipakai', () => {
  const p = template([['K1', 'Buku A', '', 'sembilan puluh'], ['K2', 'Buku B', '', 0], ['K3', 'Buku C', '', '90.000']]);
  eq(p.entries, [{ kode: 'K3', nama: 'Buku C', variasi: '', sampul: 90000 }]); eq(p.tidakTerbaca.map((x) => x.kode), ['K1', 'K2']);
});
test('C7 template: kosong di kedua kolom = belum diisi, tidak dilaporkan', () => { const p = template([['K1', 'Buku A', '', '']]); eq(p.entries, []); eq(p.tidakTerbaca, []); });
test('C8 template lama tanpa kolom sampul tetap terbaca', () => {
  const lama = HEADER.slice(0, 7);
  const p = E.parseWorkbook({ name: 'modal.xlsx', sheets: { Modal: [lama, ['Shopee', 'K1', 'Buku A', '', 1, 50000, '30.000'], ['Shopee', 'K2', 'Buku B', '', 1, 50000, 'abc']] } });
  eq(p.kind, 'modal_template'); eq(p.entries.map((e) => e.cost), [30000]); eq(p.tidakTerbaca.map((x) => x.kode), ['K2']);
});
test('C9 produk dengan isian tak terbaca dihitung "modal belum diketahui", bukan laba penuh', () => {
  const p = template([['K1', 'Buku A', '45rb', '']]);
  const cat = E.buildCatalog(p.entries, 0);
  eq(cat.find(['K1'], 'Buku A', ''), null);
});

/* ---------- regresi data contoh ---------- */
test('D1 hasil hitung data contoh sama persis dengan sebelum perubahan', () => {
  const r = E.compute(D.make().map((w) => E.parseWorkbook(w)), D.settings(), {});
  const acuan = '/tmp/sebelum-demo.json';
  if (!fs.existsSync(acuan)) { console.log('      (lewati: snapshot sebelum perubahan tidak ada di mesin ini)'); return; }
  truthy(JSON.stringify(r, tanpaTampilan) === JSON.stringify(JSON.parse(fs.readFileSync(acuan, 'utf8')), tanpaTampilan), 'hasil data contoh berubah');
});

console.log(failed ? `\n${failed} tes GAGAL` : '\nSemua tes angka lulus');
process.exit(failed ? 1 : 0);
