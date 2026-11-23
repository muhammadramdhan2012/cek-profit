/* Uji harga sampul per produk (Langkah 2b, KAMUS A.21). Data SINTETIS.
 * Definisi: entri modal boleh berisi `sampul` (harga sampul/katalog) alih-alih `cost` (harga beli).
 * Modal per unit = sampul × (100 − diskon pemasok) / 100, tanpa pembulatan; diskon kosong → tidak dipakai (bukan 0%).
 * Isian sampul adalah modal manual: menang atas price list. Satu entri per produk: isian terakhir menggantikan yang lama.
 * Jalankan: node tests/sampul.test.js
 */
const E = require('../assets/engine.js');
const Sint = require('./fixtures/shopee-sintetis.js');
const D = require('../assets/demo.js');
const S = require('../assets/sinkron.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const hitung = (orders, lines, settings) => E.compute([E.parseWorkbook(Sint.penghasilan(orders)), ...(lines ? [E.parseWorkbook(Sint.exportPesanan(lines))] : [])],
  { modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }], ...settings }, {});
const BUKU = [{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }] }];
const BUKU_EXP = [{ order: 'O1', name: 'Belajar Python', qty: 1, price: 80000, skuVariant: 'BP' }];
const SAMPUL = (v, extra = {}) => [{ kode: 'BP', nama: 'Belajar Python', variasi: '', sampul: v, ...extra }];

test('S1 sampul Rp100.000 + diskon 30%, flash sale Rp80.000 → modal Rp70.000, laba Rp10.000', () => {
  const r = hitung(BUKU, BUKU_EXP, { mitra: 30, catalog: SAMPUL(100000) });
  eq([r.totalModal, r.totalMargin, r.coverage], [70000, 10000, 1]);
  const p = r.products[0]; eq([p.baseCost, p.hargaSampul, p.modalSumber], [70000, 100000, 'manual']);
  truthy(r.shopeeQty.metodeHpp.modal_per_unit >= 1, 'metode = modal per unit (isian seller)');
});
test('S2 diskon diubah 25% → modal ikut berubah Rp75.000', () => {
  eq(hitung(BUKU, BUKU_EXP, { mitra: 25, catalog: SAMPUL(100000) }).totalModal, 75000);
});
test('S3 diskon kosong → tidak dihitung (bukan diskon 0%), dicatat sampulTanpaDiskon', () => {
  const r = hitung(BUKU, BUKU_EXP, { mitra: null, catalog: SAMPUL(100000) });
  eq([r.coverage, r.sampulTanpaDiskon], [0, 1]);
  eq(hitung(BUKU, BUKU_EXP, { mitra: 0, catalog: SAMPUL(100000) }).totalModal, 100000, 'diskon 0% yang DIISI seller tetap sah');
});
test('S4 sampul 0 / negatif / kosong tidak dipakai; harga beli Rp0 tetap 0', () => {
  for (const v of [0, -5, null, NaN]) eq(hitung(BUKU, BUKU_EXP, { mitra: 30, catalog: SAMPUL(v) }).coverage, 0, `sampul ${v}`);
  eq(hitung(BUKU, BUKU_EXP, { mitra: 30, catalog: [{ kode: 'BP', nama: 'Belajar Python', variasi: '', cost: 0 }] }).totalModal, 0);
});
test('S5 tanpa pembulatan: sampul 99.999, diskon 33% → 66.999,33', () => {
  truthy(Math.abs(E.buildCatalog(SAMPUL(99999), 0, null, 33).find(['BP'], '', '').cost - 66999.33) < 1e-6);
});
test('S6 isian sampul = modal manual: menang atas price list, beda angka masuk daftar', () => {
  const r = hitung(BUKU, BUKU_EXP, { mitra: 30, catalog: SAMPUL(100000), priceList: { jenis: 'sampul', baris: [['BP', 'Belajar Python', '', 110000]] } });
  eq(r.totalModal, 70000); eq(r.priceList.bedaManual.length, 1); eq([r.priceList.bedaManual[0].manual, r.priceList.bedaManual[0].priceList], [70000, 77000]);
});
test('S7 varian: sampul per variasi (soft/hard cover) dengan SKU berbeda', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000 }, { name: 'Belajar Python', harga: 130000 }] }],
    [{ order: 'O1', name: 'Belajar Python', variant: 'Soft Cover', qty: 1, price: 80000, skuVariant: 'BP-SC' },
      { order: 'O1', name: 'Belajar Python', variant: 'Hard Cover', qty: 1, price: 130000, skuVariant: 'BP-HC' }],
    { mitra: 30, catalog: [{ kode: 'BP-SC', nama: 'Belajar Python', variasi: 'Soft Cover', sampul: 100000 }, { kode: 'BP-HC', nama: 'Belajar Python', variasi: 'Hard Cover', sampul: 150000 }] });
  eq(r.totalModal, 175000);
});
test('S8 refund parsial tetap tidak diketahui (A.19.1)', () => {
  const r = hitung([{ id: 'O1', items: [{ name: 'Belajar Python', harga: 80000, refund: -40000 }] }],
    [{ order: 'O1', name: 'Belajar Python', qty: 2, price: 60000, skuVariant: 'BP' }], { mitra: 30, catalog: SAMPUL(100000) });
  eq(r.coverage, 0);
});
test('S9 regresi: isian harga beli lama dan data contoh identik', () => {
  const parsed = D.make().map((wb) => E.parseWorkbook(wb));
  const s = D.settings(); const a = E.compute(parsed, s, {}), b = E.compute(parsed, { ...s, mitra: 30 }, {});
  eq([a.totalModal, a.totalMargin, a.coverage], [b.totalModal, b.totalMargin, b.coverage], 'diskon pemasok tidak memengaruhi harga beli');
  eq(a.sampulTanpaDiskon, 0);
});
test('S10 TikTok: entri sampul berlaku lewat SKU seperti modal manual', () => {
  const cat = E.buildCatalog([{ kode: 'SKU-T', nama: 'Buku T', variasi: '', sampul: 50000 }], 0, null, 20);
  eq(cat.find(['SKU-T'], '', '').cost, 40000);
});
test('S11 template: kolom Harga sampul baru; template lama tetap terbaca; Modal diisi didahulukan', () => {
  const H = ['Platform', 'Kode', 'Nama produk', 'Variasi', 'Terjual', 'Harga jual rata-rata (Rp)', 'Modal per unit (Rp)', 'Harga sampul (Rp)'];
  const wb = { name: 't.xlsx', sheets: { Modal: [H, ['Shopee', 'A', 'Buku A', '', 1, 1, '', 100000], ['Shopee', 'B', 'Buku B', '', 1, 1, 30000, 50000], ['Shopee', 'C', 'Buku C', '', 1, 1, '', ''], ['Shopee', 'D', 'Buku D', '', 1, 1, '', 0]] } };
  const p = E.parseWorkbook(wb);
  eq(p.kind, 'modal_template');
  eq(p.entries, [{ kode: 'A', nama: 'Buku A', variasi: '', sampul: 100000 }, { kode: 'B', nama: 'Buku B', variasi: '', cost: 30000 }]);
  const lama = E.parseWorkbook({ name: 'l.xlsx', sheets: { Modal: [H.slice(0, 7), ['Shopee', 'A', 'Buku A', '', 1, 1, 25000]] } });
  eq(lama.entries, [{ kode: 'A', nama: 'Buku A', variasi: '', cost: 25000 }]);
});
test('S12 templateRows: produk dari sampul → kolom sampul terisi, kolom modal kosong (unggah ulang tetap ikut diskon)', () => {
  const r = hitung(BUKU, BUKU_EXP, { mitra: 30, catalog: SAMPUL(100000) });
  const rows = E.templateRows(r);
  eq(rows[0].slice(-2), ['Modal per unit (Rp)', 'Harga sampul (Rp)']); eq(rows[1].slice(-2), ['', 100000]);
  const round = E.parseWorkbook({ name: 'r.xlsx', sheets: { Modal: rows } });
  eq(round.entries[0].sampul, 100000);
  const r2 = hitung(BUKU, BUKU_EXP, { catalog: [{ kode: 'BP', nama: 'Belajar Python', variasi: '', cost: 60000 }] });
  eq(E.templateRows(r2)[1].slice(-2), [60000, '']);
});
test('S13 sinkron M2: ganti harga beli → harga sampul = perubahan satu entri (yang terakhir diisi menang)', () => {
  const K = S.kunciModal(E.norm);
  const a = { catalog: [{ kode: 'BP', nama: 'Belajar Python', variasi: '', cost: 60000 }] };
  const b = S.tandai(a, { catalog: SAMPUL(100000) }, 50, K);
  eq([b.catalog.length, b.catalog[0].diubah, b.catalogHapus.length], [1, 50, 0]);
  eq(S.gabung(b, a, 60, K).settings.catalog[0].sampul, 100000, 'isian terbaru menang atas harga beli lama di akun');
});

console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
process.exit(failed ? 1 : 0);
