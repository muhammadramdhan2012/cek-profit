/* Uji dasar bulan untuk biaya operasional & rata-rata per bulan (A.13, DITETAPKAN pemilik 26 Nov 2026), judul periode PDF,
 * dan daftar pesanan yang tidak dihitung dalam laba. Data SINTETIS format lama Shopee.
 * Definisi:
 *  - Ada filter bulan pesanan → jumlah bulan = bulan kalender yang dipilih (Jan = 1; Jan–Mar = 3); biaya operasional =
 *    biaya per bulan × jumlah itu; rata-rata per bulan = laba ÷ jumlah itu.
 *  - Tanpa filter → lama data menurut tanggal dana dilepas ÷ 30,4 hari (tidak berubah).
 *  - Pesanan yang dikeluarkan dari laba tercantum di kepastian.cakupan.dikeluarkanDaftar (dana & alasan) dan jumlah
 *    dananya = cakupan.dikeluarkan.danaDiterima.
 *  - PDF dengan filter: judul "Pesanan <bulan>", tanggal dana cair sebagai keterangan, daftar pesanan tidak dihitung.
 * Jalankan: node tests/periode-bulan.test.js
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

const ST = (extra = {}) => ({ modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }], fallbackPct: 60, fixedCosts: [{ label: 'gaji', amount: 3000000 }], ...extra });
// Pesanan Januari yang dananya cair sampai awal Februari, ditambah satu pesanan Maret; satu refund sebagian.
const PS = [P('250105A', { tgl: '2025-01-05', cair: '2025-01-06' }), P('250128B', { tgl: '2025-01-28', cair: '2025-02-06' }),
  P('250130R', { tgl: '2025-01-30', cair: '2025-02-08', refund: -40000 }), P('250310C', { tgl: '2025-03-10', cair: '2025-03-15' })];
const hitung = (filter = {}, st = ST()) => E.compute([E.parseWorkbook(lama(PS))], st, {}, filter);
const teks = (r, filter) => C.html(r, { settings: ST(), profile: {}, filter, brand: 'Cek Untung' }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('B1 filter Januari: 1 bulan; biaya operasional tepat 1 × biaya per bulan (bukan lama dana cair)', () => {
  const r = hitung({ from: '2025-01', to: '2025-01' });
  eq(r.monthsSpan, 1); eq(r.dasarBulan, { jenis: 'bulan_pesanan', dari: '2025-01', sampai: '2025-01' });
  eq(r.opex, 3000000);
  truthy(r.days > 31, `dana cair lebih dari sebulan (${r.days} hari)`);
  eq(Math.round(r.perMonth), Math.round(r.totalMargin), 'rata-rata = laba ÷ 1');
});
test('B2 filter Januari–Maret: 3 bulan kalender, termasuk Februari tanpa pesanan', () => {
  const r = hitung({ from: '2025-01', to: '2025-03' });
  eq(r.monthsSpan, 3); eq(r.opex, 9000000);
});
test('B3 filter satu sisi: batas lain dari bulan pesanan data', () => {
  eq(hitung({ from: '2025-02' }).monthsSpan, 2, 'Feb–Mar');
  eq(hitung({ to: '2025-01' }).monthsSpan, 1, 'Jan–Jan');
});
test('B4 tanpa filter: cara lama (hari dana cair ÷ 30,4), regresi', () => {
  const r = hitung();
  eq(r.dasarBulan, { jenis: 'tanggal_dana' });
  eq(r.monthsSpan, r.days / 30.4);
  truthy(Math.abs(r.opex - 3000000 * r.days / 30.4) < 1e-6, 'opex cara lama');
});
test('B5 tanpa biaya operasional: laba tidak berubah oleh filter (hanya opex yang memakai jumlah bulan)', () => {
  const a = hitung({ from: '2025-01', to: '2025-01' }, ST({ fixedCosts: [] }));
  eq(a.opex, 0); eq(a.netProfit, a.totalMargin);
});
test('K1 daftar pesanan tidak dihitung: cocok dengan total, ada alasan', () => {
  const k = hitung().kepastian.cakupan;
  eq(k.dikeluarkanDaftar.length, k.dikeluarkan.jumlahPesanan);
  eq(Math.round(k.dikeluarkanDaftar.reduce((a, d) => a + d.dana, 0)), Math.round(k.dikeluarkan.danaDiterima));
  eq(k.dikeluarkanDaftar[0].orderId, '250130R');
  truthy(k.dikeluarkanDaftar[0].alasan.includes('refund_parsial_unit_tidak_diketahui'), 'alasan refund parsial');
  truthy(E.ALASAN_KELUAR.refund_parsial_unit_tidak_diketahui, 'teks alasan');
});
test('P1 PDF dengan filter: judul bulan pesanan, dana cair sebagai keterangan, daftar pesanan tidak dihitung', () => {
  const f = { from: '2025-01', to: '2025-01' }, h = teks(hitung(f), f);
  truthy(/Toko Anda Pesanan Januari 2025 Shopee · dana cair 6 Januari 2025 – 8 Februari 2025/.test(h), 'judul');
  truthy(h.includes('Untuk pesanan Januari 2025 (dana cair'), 'ringkasan');
  truthy(/Pesanan yang tidak dihitung dalam laba: .*250130R, dana Rp[\d.]+: refund sebagian/.test(h), 'daftar');
  truthy(h.includes('× 1 bulan pesanan yang dipilih'), 'metode biaya operasional');
});
test('P2 PDF tanpa filter: judul tetap rentang tanggal dana', () => {
  const h = teks(hitung(), {});
  truthy(/Toko Anda 6 Januari 2025 – 15 Maret 2025/.test(h), 'judul lama');
  truthy(!h.includes('Untuk pesanan'), 'tanpa kalimat bulan pesanan');
});
if (failed) { console.log(`\n${failed} uji GAGAL`); process.exit(1); }
console.log('\nSemua uji dasar bulan lulus.');
