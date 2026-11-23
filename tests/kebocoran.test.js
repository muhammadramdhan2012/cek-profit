/* Uji laporan kebocoran untung (Langkah 3, KAMUS A.22). Data SINTETIS.
 * Jalankan: node tests/kebocoran.test.js
 */
const E = require('../assets/engine.js');
const A = require('../assets/akses.js');
const Sint = require('./fixtures/shopee-sintetis.js');
const D = require('../assets/demo.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const near = (a, b, msg = '') => truthy(Math.abs(a - b) < 1e-6, `${msg} ${a} ≈ ${b}`);

/** Workbook penghasilan Shopee sintetis dengan potongan (admin) dan voucher per pesanan. */
function penghasilan(orders) {
  const header = ['No.', 'Lihat berdasarkan', 'No. Pesanan', 'ID Produk', 'Nama Produk', 'Waktu Pesanan Dibuat', 'Tanggal Dana Dilepaskan', 'Total Penghasilan',
    'Harga Produk', 'Jumlah Pengembalian Dana ke Pembeli', 'Biaya Administrasi', 'Voucher disponsor oleh Penjual', 'Diskon Produk dari Shopee'];
  const rows = [['Laporan Penghasilan (sintetis)'], [], header];
  let no = 1, total = 0;
  for (const o of orders) {
    const harga = o.items.reduce((a, it) => a + it.harga, 0), admin = o.admin || 0, v = o.voucher || 0, ds = o.diskonShopee || 0;
    const tot = harga + admin + v + ds;
    rows.push([no++, 'Order', o.id, '', '', '2026-01-10 10:00', '2026-01-15', tot, harga, 0, admin, v, ds]);
    total += tot;
    for (const it of o.items) rows.push([no++, 'Sku', o.id, it.productId || '', it.name, '2026-01-10 10:00', '2026-01-15', it.harga, it.harga, 0, '', '', '']);
  }
  return { name: 'p.xlsx', sheets: { Summary: [['Dari', '2026-01-01'], ['ke', '2026-01-31'], ['Total yang Dilepas', total]], Penghasilan: rows } };
}
const hitung = (orders, lines, catalog, extra = {}) => E.compute([E.parseWorkbook(penghasilan(orders)), E.parseWorkbook(Sint.exportPesanan(lines))],
  { modalMode: 'produk', catalog, periods: [{ start: '', markup: 0, disc: 0 }], targetMargin: 15, ...extra }, {});

test('K1 jual Rp100.000, potongan Rp20.000, modal Rp85.000 → rugi −Rp5.000, masuk kerugian, tindakan naik ke harga impas', () => {
  const r = hitung([{ id: 'O1', admin: -20000, items: [{ name: 'Buku A', harga: 100000 }] }], [{ order: 'O1', name: 'Buku A', qty: 1, price: 100000, skuVariant: 'A' }],
    [{ kode: 'A', nama: 'Buku A', variasi: '', cost: 85000 }]);
  const k = r.kebocoran;
  eq(r.totalMargin, -5000, 'laba total');
  eq(k.kerugian.total, 5000); eq(k.kerugian.produk.map((p) => [p.name, p.nilai]), [['Buku A', 5000]]);
  eq(k.potensi.total, 0);
  eq(k.tindakan.length, 1); eq(k.tindakan[0].jenis, 'naikkan_ke_impas'); eq(k.tindakan[0].dampak, 5000);
  near(k.tindakan[0].ke, 85000 / 0.8, 'harga impas = modal / (1 − 20% potongan)'); eq(k.tindakan[0].dari, 100000);
});
test('K2 margin tipis (di bawah target 15%) → potensi, bukan kerugian; dampak = target × penjualan − laba', () => {
  const r = hitung([{ id: 'O1', admin: -10000, items: [{ name: 'Buku B', harga: 100000 }] }], [{ order: 'O1', name: 'Buku B', qty: 1, price: 100000, skuVariant: 'B' }],
    [{ kode: 'B', nama: 'Buku B', variasi: '', cost: 80000 }]);
  const k = r.kebocoran;
  eq([k.kerugian.total, k.potensi.total], [0, 5000]);   // laba 10.000; target 15.000
  eq(k.tindakan[0].jenis, 'naikkan_ke_target'); eq(k.tindakan[0].dampak, 5000);
});
test('K3 voucher seller tercatat sebagai info; TIDAK mengubah total penjualan, laba, atau kerugian', () => {
  const o = [{ id: 'O1', admin: -10000, items: [{ name: 'Buku C', harga: 100000 }] }];
  const ov = [{ id: 'O1', admin: -10000, voucher: -5000, diskonShopee: -2000, items: [{ name: 'Buku C', harga: 100000 }] }];
  const L = [{ order: 'O1', name: 'Buku C', qty: 1, price: 100000, skuVariant: 'C' }], C = [{ kode: 'C', nama: 'Buku C', variasi: '', cost: 50000 }];
  const a = hitung(o, L, C), b = hitung(ov, L, C);
  eq(b.kebocoran.voucher.penjual, 5000); eq(b.kebocoran.voucher.diskonShopee, -2000); eq(b.kebocoran.voucher.diskonShopeeStatus, 'menunggu_kepastian');
  eq(b.totalSales, a.totalSales - 7000, 'perilaku lama: voucher + diskon Shopee tetap mengurangi penjualan (tidak berubah)');
  eq(b.shopee.voucher, -7000, 'total voucher lama utuh');
  eq(b.kebocoran.kerugian.total + b.kebocoran.potensi.total, 0, 'voucher tidak ditambahkan ke kebocoran');
});
test('K4 produk tanpa modal tidak dinilai (tidak dianggap 0), disebut terpisah', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Buku D', harga: 50000 }] }, { id: 'O2', admin: -20000, items: [{ name: 'Buku E', harga: 100000 }] }],
    [{ order: 'O1', name: 'Buku D', qty: 1, price: 50000, skuVariant: 'D' }, { order: 'O2', name: 'Buku E', qty: 1, price: 100000, skuVariant: 'E' }],
    [{ kode: 'E', nama: 'Buku E', variasi: '', cost: 85000 }]);
  const k = r.kebocoran;
  eq(k.belumDinilai, { produk: 1, sales: 50000 }); eq(k.dinilai, 1);
  truthy(!k.kerugian.produk.some((p) => p.name === 'Buku D') && !k.potensi.produk.some((p) => p.name === 'Buku D'));
});
test('K5 data kosong / tidak ada masalah → tidak ada tindakan', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Buku F', harga: 100000 }] }], [{ order: 'O1', name: 'Buku F', qty: 1, price: 100000, skuVariant: 'F' }],
    [{ kode: 'F', nama: 'Buku F', variasi: '', cost: 10000 }]);
  eq([r.kebocoran.kerugian.total, r.kebocoran.potensi.total, r.kebocoran.tindakan.length], [0, 0, 0]);
  const kosong = E.kebocoran({ products: [], has: {}, shopee: {}, target: 0.15 });
  eq([kosong.tindakan.length, kosong.voucher, kosong.dinilai], [0, null, 0]);
});
test('K6 tindakan maks. 5, rugi dulu lalu tipis, urut dampak terbesar; rugi tanpa harga impas → "tinjau produk rugi"', () => {
  const prod = (i, margin, extra = {}) => ({ key: `k${i}`, name: `P${i}`, platform: 'shopee', sales: 100000, margin, pct: margin / 100000, avgPrice: 100000, breakEven: 100000 - margin, targetPrice: 120000, qtyKnown: true, qty: 1, ...extra });
  const k = E.kebocoran({ target: 0.15, has: {}, products: [prod(1, -1000), prod(2, -9000), prod(3, -5000, { breakEven: NaN }), prod(4, 1000), prod(5, 2000), prod(6, 3000), prod(7, 4000)] });
  eq(k.tindakan.length, 5);
  eq(k.tindakan.map((t) => [t.jenis, t.dampak]), [['naikkan_ke_impas', 9000], ['tinjau_produk_rugi', 5000], ['naikkan_ke_impas', 1000],
    ['naikkan_ke_target', 14000], ['naikkan_ke_target', 13000]], 'rugi dulu (kerugian nyata), lalu tipis; masing-masing dampak terbesar');
  const tinjau = E.kebocoran({ target: 0.15, has: {}, products: [prod(3, -5000, { breakEven: NaN })] }).tindakan[0];
  eq([tinjau.jenis, tinjau.dampak, tinjau.asumsi], ['tinjau_produk_rugi', 5000, 'berhenti_menjual_rugi']);
});
test('K7 regresi: angka laba data contoh identik (kebocoran hanya membaca)', () => {
  const parsed = D.make().map((wb) => E.parseWorkbook(wb));
  const r = E.compute(parsed, D.settings(), {});
  const { kebocoran: k, ...tanpa } = r;
  truthy(k && k.kerugian && k.tindakan.length <= 5);
  const r2 = E.compute(parsed, D.settings(), {});
  eq([r.totalSales, r.totalModal, r.totalMargin, r.netProfit, r.coverage], [r2.totalSales, r2.totalModal, r2.totalMargin, r2.netProfit, r2.coverage]);
  eq(r.kebocoran.kerugian.total, r.products.filter((p) => p.margin < 0).reduce((a, p) => a - p.margin, 0));
  truthy(r.shopee.voucherPenjual + r.shopee.diskonShopee === r.shopee.voucher, 'rincian voucher = total voucher lama');
});
test('K8 akses: kebocoran = fitur Pro (lengkap); gratis tetap melihat ringkasan 3/3', () => {
  eq(A.FITUR.kebocoran, 'pro'); eq(A.boleh({ pro: false }, 'kebocoran'), false); eq(A.boleh({ pro: true }, 'kebocoran'), true);
  eq(A.BATAS_KEBOCORAN_GRATIS, 3);
});

console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
process.exit(failed ? 1 : 0);
