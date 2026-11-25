/* Uji Laporan Penghasilan Shopee format lama (sheet "Income", terlihat pada laporan Jan–Feb 2025). Data SINTETIS
 * dengan struktur yang sama dengan file asli seller (nama sheet, letak header, nama kolom, label Summary).
 * Definisi:
 *  - Satu baris per pesanan (tanpa kolom "Lihat berdasarkan" dan tanpa baris produk/Sku), sehingga tidak ada nama produk.
 *  - Harga produk = Harga Asli Produk + Total Diskon Produk (diskon bertanda negatif).
 *  - Ongkir, voucher, biaya admin, biaya layanan, AMS: kolom format lama dipetakan ke kelompok yang sama dengan format baru;
 *    kolom lain yang belum dikenal (Premi, Biaya Program, Kartu Kredit, Kampanye, Bea Masuk, Kompensasi) masuk selisih `lain`.
 *  - Total dicocokkan dengan Summary (1. Total Pendapatan, 2. Total Pengeluaran, 3. Total yang Dilepas).
 *  - Kolom Kompensasi bernilai ≠ 0 ditandai (perlu dicek), tidak disembunyikan.
 *  - Modal per produk tidak bisa dipakai (tanpa nama produk); tanpa modal rata-rata, laba tidak dihitung (bukan dianggap 0).
 * Jalankan: node tests/shopee-format-lama.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');
const Sint = require('./fixtures/shopee-sintetis.js');

let failed = 0;
const tanpaTampilan = (k, v) => (k === 'tglPesanan' || (k === 'shopeeFormatLama' && v === null) ? undefined : v);
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
const PS = [P('250105A'), P('250106B', { diskon: -5000, voucher: -2000, tgl: '2025-01-06' }), P('250107C', { refund: -100000, admin: 0, layanan: 0, ongkirPembeli: 0, gratisOngkir: 0, diteruskan: 0, tgl: '2025-01-07' }),
  P('250108D', { ams: -3000, premi: -500, program: -700, tgl: '2025-01-08' })];

/* ---------- pengenalan & pemetaan ---------- */
test('L1 dikenali sebagai Laporan Penghasilan Shopee (format lama); tanpa baris produk', () => {
  const p = E.parseWorkbook(lama(PS));
  eq(p.kind, 'shopee_income'); eq(p.orders.length, 4); eq(p.items.length, 0); eq(p.check.formatLama, true); eq(p.check.tanpaProduk, true);
  eq([p.check.from, p.check.to], ['2025-01-01', '2025-02-10']);
});
test('L2 harga = Harga Asli + Total Diskon; voucher penjual, ongkir, admin, layanan, AMS dipetakan; sisa → lain', () => {
  const o = E.parseWorkbook(lama(PS)).orders;
  eq(o[1].harga, 95000); eq(o[1].voucher, -2000); eq(o[1].voucherPenjual, -2000);
  eq(o[0].ship, 0, 'ongkir pembeli + gratis ongkir + diteruskan ke kurir = 0'); eq(o[0].admin, -8000); eq(o[0].xtra, -4000);
  eq(o[3].ams, -3000); eq(o[3].lain, -1200, 'premi + biaya program');
  eq(o[0].lain, 0);
});
test('L3 rekonsiliasi: penjualan, refund, potongan, dana cocok dengan Summary', () => {
  const c = E.parseWorkbook(lama(PS)).check;
  eq(c.jumlah.penjualan, c.ringkasan.penjualan); eq(c.jumlah.refund, c.ringkasan.refund);
  eq(c.jumlah.potongan, c.ringkasan.potongan); eq(c.sum, c.summaryTotal); eq(c.jumlah.dana, c.ringkasan.dana);
});
test('L4 selisih dengan Summary tetap terlihat (tidak disamakan paksa)', () => {
  const c = E.parseWorkbook(lama(PS, { ringkasan: { dilepas: 1 } })).check;
  truthy(c.sum !== c.summaryTotal);
});
test('L5 refund penuh, nilai nol, sel kosong, baris total di bawah tabel', () => {
  const ps = [P('X1', { refund: -100000, admin: 0, layanan: 0, ongkirPembeli: 0, gratisOngkir: 0, diteruskan: 0 }), P('X2', { asli: 0, ongkirPembeli: 0, gratisOngkir: 0, diteruskan: 0, admin: 0, layanan: 0 })];
  const wb = lama(ps, { tambahan: [[], ['', 'Total', '', '', '', '', '', 100000]] });
  wb.sheets.Income[6][9] = '';   // sel kosong (Jumlah Pengembalian) → 0 pada pesanan X1 menjadi tanpa refund
  const p = E.parseWorkbook(wb);
  eq(p.orders.map((o) => o.id), ['X1', 'X2']); eq(p.orders[0].refund, 0); eq(p.orders[1].harga, 0);
});
test('L6 Kompensasi ≠ 0 ditandai (jumlah pesanan dan nilainya)', () => {
  const c = E.parseWorkbook(lama([P('K1', { kompensasi: 25000 }), P('K2')])).check;
  eq(c.kompensasiLama, { baris: 1, nilai: 25000 });
});
test('L7 tanpa kolom harga produk → pesan jelas, bukan angka 0', () => {
  const wb = lama(PS); const H = wb.sheets.Income[5];
  H[H.indexOf('Harga Asli Produk')] = 'Harga X';
  let err = null; try { E.parseWorkbook(wb); } catch (e) { err = e; }
  truthy(err && /harga produk/i.test(err.message), err && err.message);
});
test('L8 sheet Income tanpa header pesanan → tidak dikenali sebagai laporan penghasilan', () => {
  const wb = lama(PS); wb.sheets.Income = [['bukan laporan']];
  eq(E.detect(wb), 'unknown');
});

/* ---------- perhitungan ---------- */
test('L9 tanpa modal: penjualan/potongan/dana dihitung, laba TIDAK dihitung (modal tidak dianggap 0)', () => {
  const r = E.compute([E.parseWorkbook(lama(PS))], ST(), {});
  eq(r.ready, false); truthy(!isFinite(r.totalMargin)); eq(r.products.length, 0);
  eq(r.totalReceived, sum(PS, (p) => p.total));
});
test('L10 modal rata-rata (%): laba dihitung dari penjualan pesanan', () => {
  const r = E.compute([E.parseWorkbook(lama(PS))], ST({ fallbackPct: 60 }), {});
  eq(r.ready, true); truthy(r.coverage > 0); truthy(isFinite(r.totalMargin));
  truthy(r.kepastian.laba.final === false, 'modal rata-rata = perkiraan, laba tidak final');
});
test('L11 file yang sama diunggah dua kali tidak dihitung dobel', () => {
  const a = E.compute([E.parseWorkbook(lama(PS))], ST({ fallbackPct: 60 }), {});
  const b = E.compute([E.parseWorkbook(lama(PS)), E.parseWorkbook(lama(PS))], ST({ fallbackPct: 60 }), {});
  eq([b.totalSales, b.totalReceived, b.totalMargin], [a.totalSales, a.totalReceived, a.totalMargin]);
});

/* ---------- regresi ---------- */
test('L12 format baru tetap dikenali seperti biasa; data contoh identik dengan sebelum perubahan', () => {
  const p = E.parseWorkbook(D.make().find((w) => w.sheets.Penghasilan));
  eq(p.kind, 'shopee_income'); truthy(!p.check.formatLama); truthy(p.items.length > 0);
  const acuan = '/tmp/sebelum-demo.json';
  if (!fs.existsSync(acuan)) { console.log('      (lewati perbandingan snapshot: tidak ada di mesin ini)'); return; }
  const hasil = JSON.stringify(E.compute(D.make().map((w) => E.parseWorkbook(w)), D.settings(), {}), tanpaTampilan);
  if (hasil !== JSON.stringify(JSON.parse(fs.readFileSync(acuan, 'utf8')), tanpaTampilan)) throw new Error('hasil data contoh berubah');
});

/* ---------- Tahap 2: produk dari Export Pesanan (aturan disetujui pemilik 25 Nov 2026) ----------
 * Uang pesanan dibagi ke baris export (bukan Batal): jumlah nilai = harga laporan → nilai baris apa adanya ('tepat');
 * berbeda → sebanding ('perkiraan'). Refund penuh → semua baris penuh; refund sebagian → dibagi sebanding (uang),
 * HPP mengikuti aturan refund parsial (A.19.1). Pesanan tanpa baris export: tetap di total toko, dicatat per bulan. */
const EXP = (lines) => E.parseWorkbook(Sint.exportPesanan(lines, 'lama'));
const prod = (r, nama) => r.products.find((p) => p.name === nama);
const ORD2 = [P('A1', { asli: 80000, tgl: '2025-01-05' }), P('B2', { asli: 150000, tgl: '2025-01-06' }), P('C3', { asli: 50000, tgl: '2024-12-20' })];
const LINES2 = [{ order: 'A1', name: 'Buku Python', qty: 1, price: 80000 },
  { order: 'B2', name: 'Buku Python', qty: 1, price: 80000 }, { order: 'B2', name: 'Kamus Saku', qty: 2, price: 35000 },
  { order: 'Z9', name: 'Buku Batal', qty: 1, price: 40000, status: 'Batal' }];
test('E1 laporan lama + export: produk muncul dengan nama dan jumlah dari export; pembagian tepat', () => {
  const r = E.compute([E.parseWorkbook(lama(ORD2)), EXP(LINES2)], ST(), {});
  eq(r.products.map((p) => p.name).sort(), ['Buku Python', 'Kamus Saku']);
  eq(prod(r, 'Buku Python').sales, 160000); eq(prod(r, 'Buku Python').qty, 2); eq(prod(r, 'Kamus Saku').sales, 70000); eq(prod(r, 'Kamus Saku').qty, 2);
  eq(r.shopeeFormatLama, { pesanan: 3, dariExport: 2, tepat: 2, perkiraan: 0, tanpaExport: 1, bulanTanpaExport: { '2024-12': 1 } });
});
test('E2 nilai export ≠ laporan → dibagi sebanding, berlabel perkiraan; jumlah per produk = harga pesanan', () => {
  const r = E.compute([E.parseWorkbook(lama([P('B2', { asli: 140000 })])), EXP(LINES2)], ST(), {});
  eq(r.shopeeFormatLama.perkiraan, 1);
  const a = prod(r, 'Buku Python').sales, b = prod(r, 'Kamus Saku').sales;
  truthy(Math.abs(a + b - 140000) < 1e-6, `${a} + ${b}`); truthy(Math.abs(a - 140000 * 80 / 150) < 1e-6);
});
test('E3 total toko tidak berubah dengan/tanpa export (penjualan, dana, laba modal rata-rata)', () => {
  const st = ST({ fallbackPct: 70 });
  const a = E.compute([E.parseWorkbook(lama(ORD2))], st, {}), b = E.compute([E.parseWorkbook(lama(ORD2)), EXP(LINES2)], st, {});
  eq([b.totalSales, b.totalFees, b.totalReceived], [a.totalSales, a.totalFees, a.totalReceived]);
  truthy(Math.abs(a.totalMargin - b.totalMargin) < 1e-6, `${a.totalMargin} vs ${b.totalMargin}`);
});
test('E4 tanpa export sama sekali: tanpa produk, semua pesanan tercatat "belum ada di export" per bulan', () => {
  const r = E.compute([E.parseWorkbook(lama(ORD2))], ST(), {});
  eq(r.products.length, 0); eq(r.shopeeFormatLama.tanpaExport, 3); eq(r.shopeeFormatLama.bulanTanpaExport, { '2025-01': 2, '2024-12': 1 });
});
test('E5 baris export berstatus Batal tidak dipakai', () => {
  const r = E.compute([E.parseWorkbook(lama([P('Z9', { asli: 40000 })])), EXP(LINES2)], ST(), {});
  eq(r.products.length, 0); eq(r.shopeeFormatLama.tanpaExport, 1);
});
test('E6 modal per produk dari isian seller: modal = harga beli × jumlah export', () => {
  const cat = [{ kode: '', nama: 'Buku Python', variasi: '', cost: 50000 }, { kode: '', nama: 'Kamus Saku', variasi: '', cost: 20000 }];
  const r = E.compute([E.parseWorkbook(lama(ORD2.slice(0, 2))), EXP(LINES2)], ST({ catalog: cat }), {});
  eq(prod(r, 'Buku Python').modal, 100000); eq(prod(r, 'Kamus Saku').modal, 40000); eq(r.coverage, 1);
});
test('E7 refund penuh → penjualan produk 0, modal tidak dihitung dobel; refund sebagian pesanan banyak produk → HPP tidak diketahui', () => {
  const cat = [{ kode: '', nama: 'Buku Python', variasi: '', cost: 50000 }, { kode: '', nama: 'Kamus Saku', variasi: '', cost: 20000 }];
  const penuh = E.compute([E.parseWorkbook(lama([P('A1', { asli: 80000, refund: -80000, admin: 0, layanan: 0, ongkirPembeli: 0, gratisOngkir: 0, diteruskan: 0 })])), EXP(LINES2)], ST({ catalog: cat }), {});
  eq(prod(penuh, 'Buku Python').sales, 0);
  const sebagian = E.compute([E.parseWorkbook(lama([P('B2', { asli: 150000, refund: -35000 })])), EXP(LINES2)], ST({ catalog: cat }), {});
  truthy(!prod(sebagian, 'Buku Python').modalKnown || !prod(sebagian, 'Kamus Saku').modalKnown, 'refund sebagian: HPP tidak boleh dihitung dari nominal refund');
  truthy(sebagian.coverage < 1, 'pesanan refund sebagian keluar dari laba');
});
test('E8 export diunggah dua kali tidak membuat produk dobel', () => {
  const a = E.compute([E.parseWorkbook(lama(ORD2)), EXP(LINES2)], ST(), {}), b = E.compute([E.parseWorkbook(lama(ORD2)), EXP(LINES2), EXP(LINES2)], ST(), {});
  eq(b.products.map((p) => [p.name, p.sales, p.qty]), a.products.map((p) => [p.name, p.sales, p.qty]));
});
test('E9 format baru + export: tidak ada data format lama, perilaku lama tetap', () => {
  const r = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'N1', items: [{ name: 'Buku Python', harga: 80000 }] }])), EXP([{ order: 'N1', name: 'Buku Python', qty: 1, price: 80000 }])], ST(), {});
  eq(r.shopeeFormatLama, null); eq(r.products.length, 1);
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji Shopee format lama lulus');
process.exit(failed ? 1 : 0);
