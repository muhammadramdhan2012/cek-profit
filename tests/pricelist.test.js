/* Uji price list (Langkah 2a): pembacaan file (assets/pricelist.js) dan modal dari price list di mesin hitung
 * (assets/engine.js, buildCatalog). Semua data SINTETIS.
 *
 * Definisi (usulan KAMUS A.21, disetujui pemilik 13 Nov 2026; teks final menunggu persetujuan):
 *  - modal per unit = harga modal di baris price list yang cocok, atau harga sampul × (1 − diskon pemasok); tanpa pembulatan;
 *  - statusnya isian seller (sama dengan modal per produk); modal manual seller didahulukan di setiap langkah pencocokan;
 *  - hanya jalur Shopee; produk yang tidak cocok = modal belum diisi (tidak dihitung), kecuali "Modal rata-rata" diisi.
 *
 * Jalankan: node tests/pricelist.test.js
 */
const P = require('../assets/pricelist.js');
const E = require('../assets/engine.js');
const Sint = require('./fixtures/shopee-sintetis.js');
const D = require('../assets/demo.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const nan = (v, msg) => truthy(Number.isNaN(v), `${msg || ''} harus NaN, dapat ${v}`);

/* ================= A. membaca angka ================= */
test('A1 format titik (Indonesia): 45.000, 45000,00, Rp 45.000,-, 1.234.567,5', () => {
  eq(P.bacaAngka('45.000', 'titik'), 45000); eq(P.bacaAngka('45000,00', 'titik'), 45000); eq(P.bacaAngka('Rp 45.000,-', 'titik'), 45000);
  eq(P.bacaAngka('Rp45.000', 'titik'), 45000); eq(P.bacaAngka('1.234.567,5', 'titik'), 1234567.5); eq(P.bacaAngka('45000', 'titik'), 45000);
});
test('A2 format koma: 45,000, 45000.00, 1,234,567.5', () => {
  eq(P.bacaAngka('45,000', 'koma'), 45000); eq(P.bacaAngka('45000.00', 'koma'), 45000); eq(P.bacaAngka('1,234,567.5', 'koma'), 1234567.5);
});
test('A3 angka asli Excel dipakai apa adanya (format tidak berpengaruh)', () => {
  eq(P.bacaAngka(45000, 'titik'), 45000); eq(P.bacaAngka(45000.5, 'koma'), 45000.5); nan(P.bacaAngka(Infinity, 'titik'));
});
test('A4 tulisan yang tidak cocok dengan format → tidak terbaca (bukan ditebak)', () => {
  nan(P.bacaAngka('45,000', 'titik'), '"45,000" dengan format titik (koma = desimal 3 digit)');
  nan(P.bacaAngka('45.000,00', 'koma')); nan(P.bacaAngka('abc', 'titik')); nan(P.bacaAngka('', 'titik')); nan(P.bacaAngka('-45.000', 'titik'));
  nan(P.bacaAngka('45.00.0', 'titik')); nan(P.bacaAngka('45000,123', 'titik'), 'desimal 3 digit'); nan(P.bacaAngka('45000', 'xx'), 'format tidak dikenal');
});
test('A5 format salah pilih: "45.000" dengan format koma → tidak terbaca (bukan 45), ditandai "periksa" di contoh bacaan', () => {
  nan(P.bacaAngka('45.000', 'koma'));
  eq(P.bacaAngka('45.5', 'koma'), 45.5);
  const aoa = [['Kode', 'Judul', 'Harga'], ['K1', 'Buku', '45.000']];
  const c = P.contoh(aoa, { header: 0, kode: 0, nama: 1, variasi: -1, harga: 2, format: 'koma' });
  truthy(Number.isNaN(c[0].harga) && c[0].periksa, 'periksa');
  eq(P.contoh([['K', 'J', 'H'], ['K1', 'B', 50]], { header: 0, kode: 0, nama: 1, variasi: -1, harga: 2, format: 'titik' })[0].periksa, true, 'harga < Rp100 ditandai');
  eq(P.contoh(aoa, { header: 0, kode: 0, nama: 1, variasi: -1, harga: 2, format: 'titik' })[0].periksa, false);
});
test('A6 tebak format dari contoh nilai', () => {
  eq(P.tebakFormat(['45.000', '120.500', '9.000']), 'titik'); eq(P.tebakFormat(['45000,00', '1200,50']), 'titik');
  eq(P.tebakFormat(['45,000', '1,200.50']), 'koma'); eq(P.tebakFormat([45000, 12000]), null);
});

/* ================= B. kolom dan baris ================= */
const FILE = [
  ['DAFTAR HARGA PENERBIT CONTOH'], ['Periode November 2026'], [],
  ['ISBN', 'Judul Buku', 'Jenis Cover', 'Harga Sampul', 'Stok'],
  ['9786020000001', 'Belajar Python', 'Soft Cover', '100.000', 12],
  ['9786020000002', 'Belajar Python', 'Hard Cover', '150.000', 3],
  [9786020000003, 'Kamus Saku', '', 45000, 7],
  ['9786020000004', 'Buku Tanpa Harga', '', '', 1],
  ['9786020000005', 'Buku Harga Aneh', '', 'hubungi kami', 1],
  ['9786020000006', 'Buku Gratis', '', '0', 1],
  ['9786020000007', 'Atlas Dunia', '', '85.000', 1],
  ['9786020000007', 'Atlas Dunia', '', '85.000', 1],
  ['9786020000008', 'Novel Laris', '', '70.000', 1],
  ['9786020000008', 'Novel Laris (cetak ulang)', '', '75.000', 1],
  [], ['', '', '', '', ''],
];
const PETA = { header: 3, kode: 0, nama: 1, variasi: 2, harga: 3, jenis: 'sampul', format: 'titik' };
test('B1 baris judul kolom ditemukan walau tidak di baris 1', () => { eq(P.cariHeader(FILE), 3); eq(P.cariHeader([[1, 2], [3, 4]]), -1); });
test('B2 tebakan kolom (hanya saran)', () => {
  const t = P.tebakKolom(FILE[3]);
  eq([t.kode, t.nama, t.variasi, t.harga, t.jenis], [0, 1, 2, 3, 'sampul']);
  const t2 = P.tebakKolom(['SKU', 'Nama Produk', 'Harga Jual', 'Harga Netto']);
  eq([t2.harga, t2.jenis, t2.kandidatHarga], [3, 'modal', [2, 3]], 'kolom bernuansa modal didahulukan');
  eq(P.tebakKolom(['A', 'B']).harga, -1);
});
test('B3 bangun: baris sah, masalah didaftar, ganda harga sama = satu, ganda harga beda = konflik', () => {
  const h = P.bangun(FILE, PETA);
  eq(h.baris, [
    ['9786020000001', 'Belajar Python', 'Soft Cover', 100000],
    ['9786020000002', 'Belajar Python', 'Hard Cover', 150000],
    ['9786020000003', 'Kamus Saku', '', 45000],
    ['9786020000007', 'Atlas Dunia', '', 85000],
  ]);
  eq(h.masalah.map((m) => [m.baris, m.alasan]), [[8, 'harga_kosong'], [9, 'harga_tidak_terbaca'], [10, 'harga_nol_atau_negatif']]);
  eq(h.konflik, [{ kode: '9786020000008', harga: [70000, 75000], baris: [13, 14] }]);
  eq(h.jumlahBaca, 10);
});
test('B4 ISBN angka besar dari Excel ditulis utuh (tanpa notasi eksponen)', () => {
  eq(P.bangun([['Kode', 'Nama', 'Harga'], [9786020000003, 'X', 1000]], { header: 0, kode: 0, nama: 1, variasi: -1, harga: 2, jenis: 'modal', format: 'titik' }).baris[0][0], '9786020000003');
});
test('B5 pemetaan tidak lengkap ditolak dengan pesan jelas', () => {
  const salah = (p, re) => { try { P.bangun(FILE, p); } catch (e) { truthy(re.test(e.message), e.message); return; } throw new Error('harus ditolak'); };
  salah({ ...PETA, harga: -1 }, /harga/); salah({ ...PETA, kode: -1, nama: -1 }, /kode atau nama/); salah({ ...PETA, format: '' }, /belum lengkap/);
});
test('B6 simpanan: tanpa file mentah, ukuran dihitung, batas 2,9 MB', () => {
  const s = P.buatSimpanan({ hasil: P.bangun(FILE, PETA), peta: PETA, namaKolom: { kode: 'ISBN' }, namaFile: 'harga.xlsx', kini: 5 });
  eq(Object.keys(s).sort(), ['baris', 'diubah', 'format', 'jenis', 'kolom', 'konflik', 'masalah', 'namaFile', 'v'].sort());
  truthy(P.ukuran(s) > 100 && !P.terlaluBesar(s));
  const besar = { ...s, baris: Array.from({ length: 60000 }, (_, i) => [`978${i}`, `Judul Buku Nomor ${i} Untuk Uji Ukuran Data`, '', 50000]) };
  truthy(P.terlaluBesar(besar), `60.000 baris harus melewati batas (${P.ukuran(besar)} byte)`);
});
test('B7 rencana sinkron price list: terbaru menang, waktu sama = tidak ada yang dilakukan', () => {
  eq(P.rencanaSinkron({ diubah: 10 }, { diubah: 5 }), 'unggah'); eq(P.rencanaSinkron({ diubah: 5 }, { diubah: 10 }), 'unduh');
  eq(P.rencanaSinkron({ diubah: 5 }, { diubah: 5 }), 'sama'); eq(P.rencanaSinkron(null, null), 'sama'); eq(P.rencanaSinkron(null, { diubah: 1 }), 'unduh');
  eq(P.info({ dihapus: true, diubah: 9 }), { diubah: 9, jumlah: 0, dihapus: true });
  eq(P.info({ diubah: 3, jenis: 'modal', baris: [[1], [2]] }), { diubah: 3, jumlah: 2, jenis: 'modal' });
});

/* ================= C. modal dari price list di mesin hitung (Shopee) ================= */
const hitung = (orders, lines, settings) => {
  const parsed = [E.parseWorkbook(Sint.penghasilan(orders)), ...(lines ? [E.parseWorkbook(Sint.exportPesanan(lines))] : [])];
  return E.compute(parsed, { modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }], ...settings }, {});
};
const PL_SAMPUL = (baris) => ({ jenis: 'sampul', baris });
const PL_MODAL = (baris) => ({ jenis: 'modal', baris });
const prod = (r, name) => r.products.find((p) => p.name === name);

test('C1 contoh buku: sampul Rp100.000, diskon 30%, flash sale Rp80.000 → modal Rp70.000, laba Rp10.000', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }] }],
    [{ order: 'O1', name: 'Belajar Python', qty: 1, price: 80000, skuVariant: '9786020000001' }],
    { mitra: 30, priceList: PL_SAMPUL([['9786020000001', 'Belajar Python', '', 100000]]) });
  eq(r.totalModal, 70000); eq(r.totalMargin, 10000); eq(r.coverage, 1);
  eq(prod(r, 'Belajar Python').modalSumber, 'pricelist');
  eq(r.priceList.terpakai, 1); eq(r.priceList.knownSalesShopee, 80000);
});
test('C2 harga modal langsung; 2 unit dari export → modal 2 × harga', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Kamus Saku', harga: 90000 }] }],
    [{ order: 'O1', name: 'Kamus Saku', qty: 2, price: 45000, skuVariant: 'K-1' }],
    { priceList: PL_MODAL([['K-1', 'Kamus Saku', '', 31500]]) });
  eq(r.totalModal, 63000);
});
test('C3 varian buku: soft cover dan hard cover dengan SKU berbeda → modal masing-masing', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }, { name: 'Belajar Python', harga: 130000 }] }],
    [{ order: 'O1', name: 'Belajar Python', variant: 'Soft Cover', qty: 1, price: 80000, skuVariant: 'BP-SC' },
      { order: 'O1', name: 'Belajar Python', variant: 'Hard Cover', qty: 1, price: 130000, skuVariant: 'BP-HC' }],
    { mitra: 30, priceList: PL_SAMPUL([['BP-SC', 'Belajar Python', 'Soft Cover', 100000], ['BP-HC', 'Belajar Python', 'Hard Cover', 150000]]) });
  eq(r.totalModal, 70000 + 105000);
  eq(r.shopeeQty.hpp.terverifikasi, 2, 'SKU variasi → HPP terverifikasi');
});
test('C4 varian tanpa SKU: nama + variasi persis di price list → modal variasi itu', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 130000 }] }],
    [{ order: 'O1', name: 'Belajar Python', variant: 'Hard Cover', qty: 1, price: 130000 }],
    { mitra: 30, priceList: PL_SAMPUL([['', 'Belajar Python', 'Soft Cover', 100000], ['', 'Belajar Python', 'Hard Cover', 150000]]) });
  eq(r.totalModal, 105000);
});
test('C5 varian tanpa SKU dan price list hanya punya nama produk → TIDAK dianggap berlaku untuk semua variasi', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 130000 }] }],
    [{ order: 'O1', name: 'Belajar Python', variant: 'Hard Cover', qty: 1, price: 130000 }],
    { mitra: 30, priceList: PL_SAMPUL([['', 'Belajar Python', '', 100000]]) });
  truthy(r.shopeeQty.hpp.terverifikasi === 0, 'tidak terverifikasi');
  truthy(!(r.shopeeQty.hpp.terverifikasi > 0) && r.shopeeQty.variasi.terverifikasi >= 0);
  const st = r.shopeeQty.hpp;
  truthy((st.belum || 0) + (st.estimasi || 0) + (st.tidak_diketahui || 0) >= 1, `status HPP harus belum/estimasi/tidak diketahui: ${JSON.stringify(st)}`);
});
test('C6 modal manual seller didahulukan atas price list (kunci sama)', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Kamus Saku', harga: 50000 }] }],
    [{ order: 'O1', name: 'Kamus Saku', qty: 1, price: 50000, skuVariant: 'K-1' }],
    { mitra: 30, catalog: [{ kode: 'K-1', nama: 'Kamus Saku', variasi: '', cost: 33000 }], priceList: PL_SAMPUL([['K-1', 'Kamus Saku', '', 45000]]) });
  eq(r.totalModal, 33000); eq(prod(r, 'Kamus Saku').modalSumber, 'manual'); eq(r.priceList.terpakai, 0);
});
test('C7 pencocokan lewat nama persis (tanpa SKU di toko); nama mirip TIDAK dicocokkan', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Atlas Dunia', harga: 90000 }] }, { id: 'O2', items: [{ name: 'Atlas Dunia Edisi Baru', harga: 95000 }] }],
    [{ order: 'O1', name: 'Atlas Dunia', qty: 1, price: 90000 }, { order: 'O2', name: 'Atlas Dunia Edisi Baru', qty: 1, price: 95000 }],
    { priceList: PL_MODAL([['', 'Atlas Dunia', '', 60000]]) });
  eq(r.totalModal, 60000); truthy(r.coverage < 1, 'O2 tidak bermodal');
  eq(prod(r, 'Atlas Dunia Edisi Baru').modalKnown, false);
});
test('C8 produk tidak ada di price list = modal belum diisi (tidak dihitung, tidak dianggap 0); cakupan terlihat', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }] }, { id: 'O2', items: [{ name: 'Buku Lain', harga: 20000 }] }],
    [{ order: 'O1', name: 'Belajar Python', qty: 1, price: 80000, skuVariant: 'BP' }, { order: 'O2', name: 'Buku Lain', qty: 1, price: 20000 }],
    { priceList: PL_MODAL([['BP', 'Belajar Python', '', 56000]]) });
  eq(r.totalModal, 56000); eq(r.totalMargin, 24000, 'laba hanya dari pesanan bermodal');
  eq(Math.round(r.coverage * 100), 80); eq(r.priceList.knownSalesShopee, 80000);
});
test('C9 produk tidak cocok + "Modal rata-rata" diisi seller → perkiraan, bukan price list', () => {
  const r = hitung([{ id: 'O2', items: [{ name: 'Buku Lain', harga: 20000 }] }],
    [{ order: 'O2', name: 'Buku Lain', qty: 1, price: 20000 }],
    { fallbackPct: 60, priceList: PL_MODAL([['BP', 'Belajar Python', '', 56000]]) });
  eq(r.totalModal, 12000); eq(r.priceList.knownSalesShopee, 0);
  truthy(r.shopeeQty.metodeHpp.modal_rata_rata >= 1, 'metode = modal rata-rata');
});
test('C10 harga sampul tanpa diskon pemasok → price list tidak dipakai (tidak dianggap diskon 0)', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }] }],
    [{ order: 'O1', name: 'Belajar Python', qty: 1, price: 80000, skuVariant: 'BP' }],
    { mitra: null, priceList: PL_SAMPUL([['BP', 'Belajar Python', '', 100000]]) });
  eq(r.coverage, 0); eq(r.priceList.dipakai, false);
});
test('C11 konflik di price list (kode/nama sama, harga beda) → tidak dipakai lewat kunci itu', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Novel Laris', harga: 90000 }] }],
    [{ order: 'O1', name: 'Novel Laris', qty: 1, price: 90000, skuVariant: 'NL' }],
    { priceList: PL_MODAL([['NL', 'Novel Laris', '', 50000], ['NL', 'Novel Laris', '', 52000]]) });
  eq(r.coverage, 0); eq([r.priceList.konflikKode, r.priceList.konflikNama], [1, 1]);
});
test('C12 refund parsial tetap tidak diketahui (A.19.1) walau modal dari price list', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Kamus Saku', harga: 60000, refund: -30000 }] }],
    [{ order: 'O1', name: 'Kamus Saku', qty: 2, price: 45000, skuVariant: 'K-1' }],
    { priceList: PL_MODAL([['K-1', 'Kamus Saku', '', 31500]]) });
  eq(r.coverage, 0, 'unit terjual tidak diketahui → modal tidak dihitung');
});
test('C13 harga modal Rp0 di price list tidak dipakai (bukan modal 0); modal manual Rp0 tetap 0', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'X', harga: 10000 }] }], [{ order: 'O1', name: 'X', qty: 1, price: 10000, skuVariant: 'X' }],
    { priceList: PL_MODAL([['X', 'X', '', 0]]) });
  eq(r.coverage, 0);
  const r2 = hitung([{ id: 'O1', items: [{ name: 'X', harga: 10000 }] }], [{ order: 'O1', name: 'X', qty: 1, price: 10000, skuVariant: 'X' }],
    { catalog: [{ kode: 'X', nama: 'X', variasi: '', cost: 0 }] });
  eq([r2.coverage, r2.totalModal], [1, 0]);
});
test('C14 mode harga acuan (perkiraan lama) tidak memakai price list', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }] }],
    [{ order: 'O1', name: 'Belajar Python', qty: 1, price: 80000, skuVariant: 'BP' }],
    { modalMode: 'acuan', mitra: 30, priceList: PL_SAMPUL([['BP', 'Belajar Python', '', 100000]]) });
  eq(r.totalModal, 56000, 'perilaku lama mode acuan'); eq(r.priceList.terpakai, 0);
});
test('C15 TikTok tidak memakai price list (Shopee dulu, keputusan pemilik)', () => {
  const cat = E.buildCatalog([], 0, PL_MODAL([['K-1', 'Kamus', '', 1000]]), null);
  eq(cat.find(['K-1'], 'Kamus', ''), null, 'tanpa opsi priceList (jalur TikTok)');
  eq(cat.find(['K-1'], 'Kamus', '', { priceList: true }).cost, 1000);
});
test('C16 tanpa price list: hasil data contoh IDENTIK dengan sebelumnya (regresi)', () => {
  const parsed = D.make().map((wb) => E.parseWorkbook(wb));
  const s = D.settings();
  const a = E.compute(parsed, s, {}), b = E.compute(parsed, { ...s, priceList: null }, {}), c = E.compute(parsed, { ...s, priceList: { jenis: 'modal', baris: [] } }, {});
  for (const x of [b, c]) {
    eq([x.totalSales, x.totalModal, x.totalMargin, x.netProfit, x.coverage], [a.totalSales, a.totalModal, a.totalMargin, a.netProfit, a.coverage]);
    eq(x.products.map((p) => [p.key, p.margin]), a.products.map((p) => [p.key, p.margin]));
  }
  eq(a.priceList, null);
});
test('C17 tanpa pembulatan: sampul Rp99.999, diskon 33% → 66.999,33', () => {
  const cat = E.buildCatalog([], 0, PL_SAMPUL([['K', 'B', '', 99999]]), 33);
  truthy(Math.abs(cat.find(['K'], '', '', { priceList: true }).cost - 66999.33) < 1e-6);
});

console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
process.exit(failed ? 1 : 0);
