/* Uji isi PDF laporan (assets/report.js) untuk cakupan modal. Data SINTETIS format lama Shopee.
 * Definisi yang diuji (tampilan saja, rumus laba tidak berubah):
 *  - Bila ada dana yang tidak masuk laba (modal tidak diketahui, mis. refund sebagian), baris
 *    "Dana dari pesanan tanpa modal (tidak dihitung)" selalu tampil, berapa pun porsinya, sehingga
 *    dana diterima − modal − packing − dana tidak dihitung = laba setelah modal.
 *  - Persen "modal diketahui" tidak dibulatkan ke atas (99,8% bukan 100%).
 *  - Modal dari perkiraan (modal rata-rata) diberi label perkiraan di kartu laba, ringkasan, dan metode.
 *  - Judul tabel 10 produk teratas mengikuti isinya: semua rugi → "rugi terkecil".
 *  - Hasil engine (laba) tidak berubah.
 * Jalankan: node tests/laporan-pdf.test.js
 */
const E = require('../assets/engine.js');
const C = require('../assets/report.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };

const HEAD = ['No.', 'No. Pesanan', 'No. Pengajuan', 'Username (Pembeli)', 'Waktu Pesanan Dibuat', 'Metode pembayaran pembeli', 'Tanggal Dana Dilepaskan',
  'Harga Asli Produk', 'Total Diskon Produk', 'Jumlah Pengembalian Dana ke Pembeli', 'Diskon Produk dari Shopee', 'Diskon Voucher Ditanggung Penjual',
  'Cashback Koin yang Ditanggung Penjual', 'Ongkir Dibayar Pembeli', 'Diskon Ongkir Ditanggung Jasa Kirim', 'Gratis Ongkir dari Shopee',
  'Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim', 'Ongkos Kirim Pengembalian Barang', 'Pengembalian Biaya Kirim', 'Biaya Komisi AMS',
  'Biaya Administrasi', 'Biaya Layanan (termasuk PPN 11%)', 'Premi', 'Biaya Program', 'Biaya Kartu Kredit', 'Biaya Kampanye', 'Bea Masuk, PPN & PPh',
  'Total Penghasilan', 'Kode Voucher', 'Kompensasi', 'Promo Gratis Ongkir dari Penjual', 'Jasa Kirim', 'Nama Kurir'];
/** Satu pesanan. Total Penghasilan dihitung dari komponennya (seperti laporan asli), kecuali diberikan. */
const P = (id, o = {}) => {
  const x = { asli: 100000, diskon: 0, refund: 0, dShopee: 0, voucher: 0, koin: 0, ongkirPembeli: 10000, gratisOngkir: 5000, diteruskan: -15000,
    ams: 0, admin: -8000, layanan: -4000, premi: 0, program: 0, kompensasi: 0, tgl: '2025-01-05', cair: '2025-01-12', ...o };
  const total = x.total ?? x.asli + x.diskon + x.refund + x.dShopee + x.voucher + x.koin + x.ongkirPembeli + x.gratisOngkir + x.diteruskan + x.ams + x.admin + x.layanan + x.premi + x.program;
  return { id, ...x, total };
};
const baris = (p, i) => [i + 1, p.id, '', 'pembeli' + i, p.tgl, 'ShopeePay', p.cair, p.asli, p.diskon, p.refund, p.dShopee, p.voucher, p.koin, p.ongkirPembeli, 0,
  p.gratisOngkir, p.diteruskan, 0, 0, p.ams, p.admin, p.layanan, p.premi, p.program, 0, 0, 0, p.total, '', p.kompensasi, 0, 'Reguler', 'SPX Standard'];
const sum = (ps, f) => ps.reduce((a, p) => a + f(p), 0);
/** Workbook format lama. `ringkasan` menimpa angka Summary (untuk uji selisih). */
function lama(ps, { ringkasan = {}, tambahan = [] } = {}) {
  const pend = sum(ps, (p) => p.asli + p.diskon + p.refund + p.dShopee + p.voucher + p.koin);
  const kel = sum(ps, (p) => p.ams + p.admin + p.layanan + p.premi + p.program);
  const R = { pendapatan: pend, pengeluaran: kel, dilepas: sum(ps, (p) => p.total), ...ringkasan };
  const Summary = [['Laporan Penghasilan'], [], [], [], ['Rincian Laporan'], ['Username (Penjual)', 'toko-sintetis'], ['Dari', '2025-01-01'], ['ke', '2025-02-10'], [],
    ['Ringkasan Penghasilan', null, null, 'Rp'], ['1. Total Pendapatan', null, null, R.pendapatan], ['Subtotal Pesanan', null, null, 0],
    ['Harga Asli Produk', null, null, sum(ps, (p) => p.asli)], ['Total Diskon Produk', null, null, sum(ps, (p) => p.diskon)],
    ['Jumlah Pengembalian Dana ke Pembeli', null, null, sum(ps, (p) => p.refund)], [], ['2. Total Pengeluaran', null, null, R.pengeluaran],
    ['Biaya Administrasi', null, null, sum(ps, (p) => p.admin)], [], ['3. Total yang Dilepas', null, null, R.dilepas]];
  const Income = [['Username (Penjual)', 'Dari', 'ke'], ['toko-sintetis', '2025-01-01', '2025-02-10'], [], [], ['total(Rp)'], [...HEAD], ...ps.map(baris), ...tambahan];
  return { name: 'Income.sudah dilepas.id.20250101_20250210.xlsx',
    sheets: { Summary, Income, 'Service Fee Details': [['Biaya Layanan'], ['No.', 'No. Pesanan', 'Biaya Layanan Gratis Ongkir XTRA']] } };
}
const ST = (extra = {}) => ({ modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }], ...extra });

const teks = (r, st) => C.html(r, { settings: st, profile: {}, filter: {}, brand: 'Cek Untung' }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// 40 pesanan normal + 1 pesanan refund sebagian (jumlah barang yang dikembalikan tidak diketahui).
const normal = Array.from({ length: 40 }, (_, i) => P(`2501${String(10 + i).padStart(2, '0')}N`));
const parsial = P('250150R', { refund: -40000 });
const hitung = (ps, st) => E.compute([E.parseWorkbook(lama(ps))], st, {});

test('T1 dana dari pesanan tanpa modal tampil walau cakupan ≥ 98%, dan tabel bisa dijumlahkan', () => {
  const st = ST({ fallbackPct: 60, packing: 1000 }), r = hitung([...normal, parsial], st);
  truthy(r.coverage >= 0.98 && r.coverage < 1, `cakupan ${r.coverage}`);
  const keluar = r.kepastian.cakupan.dikeluarkan.danaDiterima;
  truthy(keluar > 0, 'ada dana dikeluarkan');
  eq(Math.round(r.totalReceived - r.totalModal - r.knownPacking - keluar - r.lostCertain), Math.round(r.totalMargin), 'jumlah tabel');
  const h = teks(r, st);
  truthy(h.includes('Dana dari pesanan tanpa modal (tidak dihitung)'), 'baris tampil');
  truthy(/Catatan: 1 pesanan dengan dana Rp[\d.]+ belum dihitung dalam laba karena modalnya belum diketahui \(refund sebagian/.test(h), 'catatan');
});
test('T2 persen cakupan tidak dibulatkan ke 100%', () => {
  const st = ST({ fallbackPct: 60 }), r = hitung([...normal, parsial], st), h = teks(r, st);
  truthy(!/Modal diketahui untuk 100%/.test(h), 'tidak boleh 100%');
  truthy(/Modal diketahui untuk 9\d,\d% penjualan/.test(h), 'persen satu desimal');
});
test('T3 modal rata-rata diberi label perkiraan', () => {
  const st = ST({ fallbackPct: 60 }), r = hitung(normal, st), h = teks(r, st);
  truthy(h.includes('perkiraan · margin'), 'kartu laba');
  truthy(/Laba ini perkiraan : modal untuk 100% penjualan berasal dari perkiraan \(termasuk modal rata-rata 60% dari harga jual\)/.test(h), 'ringkasan');
  truthy(h.includes('(semuanya perkiraan)'), 'metode');
});
test('T4 tanpa dana dikeluarkan: baris dan catatan tidak muncul', () => {
  const st = ST({ fallbackPct: 60 }), r = hitung(normal, st), h = teks(r, st);
  truthy(!h.includes('Dana dari pesanan tanpa modal'), 'tanpa baris');
  truthy(!h.includes('Catatan: '), 'tanpa catatan');
  eq(r.coverage, 1);
});
test('T5 judul tabel produk: semua rugi → rugi terkecil; ada untung → laba terbesar', () => {
  const rugi = ST({ fallbackPct: 95 }), r1 = hitung(normal, rugi);
  truthy(r1.totalMargin < 0, 'harus rugi');
  truthy(!teks(r1, rugi).includes('produk dengan laba terbesar'), 'judul rugi');
  const untung = ST({ fallbackPct: 40 }), r2 = hitung(normal, untung);
  truthy(r2.totalMargin > 0, 'harus untung');
  truthy(!teks(r2, untung).includes('produk dengan rugi terkecil'), 'judul untung');
});
test('T6 laba engine tidak berubah oleh perubahan tampilan (regresi)', () => {
  const st = ST({ fallbackPct: 60, packing: 1000 }), r = hitung([...normal, parsial], st);
  const pesanan = normal.length, jual = 100000, modal = 0.6 * jual;
  const dana = normal.reduce((a, p) => a + p.total, 0);
  eq(Math.round(r.totalMargin), Math.round(dana - pesanan * modal - pesanan * 1000), 'laba = dana pesanan bermodal − modal − packing');
});

if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji laporan PDF lulus.');
