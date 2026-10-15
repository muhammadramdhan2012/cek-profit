/* Uji mesin hitung dengan data contoh (fiktif). Jalankan: node tests/engine.test.js
 * Data penjualan asli tidak disimpan di repo; uji dengan file asli dilakukan terpisah.
 */
const E = require('../assets/engine.js');
const Demo = require('../assets/demo.js');

let failed = 0;
const R = (x) => Math.round(x);
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${a} !== ${b}`); };
const near = (a, b, tol, msg = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} ${a} ≉ ${b} (±${tol})`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };

const wbs = Demo.make();
const parsed = wbs.map((wb) => E.parseWorkbook(wb));
const st = Demo.settings();

test('deteksi semua jenis file contoh', () => {
  eq(parsed.map((p) => p.kind).join(','), 'shopee_income,shopee_orders,tiktok_income,tiktok_orders,tiktok_return');
});
test('total penghasilan cocok dengan ringkasan', () => {
  eq(R(parsed[0].check.sum), R(parsed[0].check.summaryTotal), 'Shopee');
  eq(R(parsed[2].check.sum), R(parsed[2].check.reportSettle), 'TikTok');
});
test('export TikTok: baris keterangan ke-2 diabaikan', () => eq(parsed[3].lines.length, 520));

const r = E.compute(parsed, st);
test('modal per produk lengkap → coverage 100%', () => near(r.coverage, 1, 1e-9));
test('margin = dana diterima − modal − packing − retur hilang', () => {
  near(r.totalMargin, r.totalReceived - r.totalModal - r.totalPacking - r.lostCertain, 1);
});
test('rekonsiliasi: dana diterima (pesanan bermodal) − modal − packing − retur hilang = margin', () => {
  for (const cov of [st, { ...st, catalog: st.catalog.slice(0, 12) }]) {
    const x = E.compute(parsed, cov);
    near(x.knownReceived - x.totalModal - x.knownPacking - x.lostCertain, x.totalMargin, 1);
  }
});
test('modal Shopee memakai jumlah dari export pesanan', () => {
  eq(r.qtyAssumed, 0, 'qtyAssumed');
  // modal manual: Σ qty × modal untuk pesanan yang tidak direfund
  const cost = Object.fromEntries(Demo.PRODUCTS.map((p) => [p[0], p[2]]));
  const ord = parsed[1].lines.filter((l) => l.status !== 'Batal');
  near(r.shopee.modal, ord.reduce((a, l) => a + cost[l.name] * l.qty, 0), 1, 'modal Shopee');
});
test('tanpa export pesanan Shopee → jumlah dianggap 1 dan ditandai', () => {
  const r2 = E.compute(parsed.filter((p) => p.kind !== 'shopee_orders'), st);
  truthy(r2.qtyAssumed > 0, 'qtyAssumed harus > 0');
});
test('tanpa export TikTok → pesanan tanpa rincian produk tidak dihitung', () => {
  const r2 = E.compute(parsed.filter((p) => p.kind !== 'tiktok_orders'), st);
  truthy(r2.tiktok.coverage > 0.3 && r2.tiktok.coverage < 0.7, `coverage TikTok ${r2.tiktok.coverage}`);
  truthy(r2.ttNoDetail > 0, 'ttNoDetail');
});
test('modal kosong tidak dianggap 0', () => {
  const r2 = E.compute(parsed, { ...st, catalog: [] });
  eq(r2.ready, false); truthy(isNaN(r2.totalMargin), 'margin harus NaN');
  eq(R(r2.totalSales), R(r.totalSales), 'penjualan tetap');
});
test('modal rata-rata (%) sebagai cadangan', () => {
  const r2 = E.compute(parsed, { ...st, catalog: [], fallbackPct: 50 });
  near(r2.coverage, 1, 1e-9);
});
test('filter bulan: jumlah per bulan = total', () => {
  const sum = r.allMonths.reduce((a, mo) => a + E.compute(parsed, st, {}, { from: mo, to: mo }).totalMargin, 0);
  near(sum, r.totalMargin, 1);
});
test('filter platform', () => {
  const s = E.compute(parsed, st, {}, { platforms: ['shopee'] });
  near(s.totalMargin, r.shopee.margin - r.cases.filter((c) => c.platform === 'shopee' && c.state === 'hilang').reduce((a, c) => a + c.estModal, 0), 1);
  eq(s.has.tiktok, false);
});
test('biaya operasional → laba bersih', () => {
  near(r.netProfit, r.totalMargin - 1400000 * r.monthsSpan, 1);
});
test('retur "hilang" mengurangi margin sebesar modal', () => {
  const c = r.cases.find((x) => x.needsCheck);
  const r2 = E.compute(parsed, st, { [c.key]: 'hilang' });
  near(r.totalMargin - r2.totalMargin, c.estModal, 1);
  truthy(c.estModal > 0, 'estModal > 0');
});
test('produk rugi terdeteksi (kaos kaki di TikTok: harga setelah diskon < titik impas)', () => {
  const p = r.products.find((x) => x.platform === 'tiktok' && /Kaos Kaki/.test(x.name));
  eq(p.health, 'rugi');
  truthy(p.avgPrice < p.breakEven, `harga ${p.avgPrice} < impas ${p.breakEven}`);
});
test('temuan otomatis menyebut kenaikan potongan & produk rugi', () => {
  const t = r.insights.map((i) => i.title).join(' | ');
  truthy(/produk merugi/.test(t), t);
  truthy(/Potongan platform naik/.test(t), t);
});
test('template modal: ekspor → impor kembali menghasilkan coverage sama', () => {
  const rows = E.templateRows(r);
  const back = E.parseWorkbook({ name: 't.xlsx', sheets: { Modal: rows } });
  eq(back.kind, 'modal_template');
  const r2 = E.compute(parsed, { ...st, catalog: back.entries });
  near(r2.coverage, 1, 1e-9);
  near(r2.totalMargin, r.totalMargin, 1);
});
test('simulasi harga', () => {
  const s = E.simulate({ listPrice: 100000, disc: 10, cost: 60000, feePct: 15, feeFixed: 1250, packing: 1500 });
  eq(R(s.price), 90000); eq(R(s.margin), 90000 - 13500 - 1250 - 60000 - 1500);
  near(s.breakEvenPrice * 0.85 - 1250 - 60000 - 1500, 0, 1e-6);
});
test('biaya kulakan: modal per produk naik sesuai persen, angka isian tetap', () => {
  const x = E.compute(parsed, { ...st, extraCostPct: 10 });
  near(x.totalModal, r.totalModal * 1.1, 1);
  const p = x.products.find((q) => Number.isFinite(q.unitCost));
  near(p.unitCost, p.baseCost * 1.1, 1e-6);
  const back = E.parseWorkbook({ name: 't.xlsx', sheets: { Modal: E.templateRows(x) } });
  const orig = E.parseWorkbook({ name: 't.xlsx', sheets: { Modal: E.templateRows(r) } });
  eq(JSON.stringify(back.entries), JSON.stringify(orig.entries), 'template memakai modal yang diisi, bukan modal + kulakan');
});
test('tarif efektif: persen + biaya tetap per pesanan membentuk ulang total potongan', () => {
  for (const k of ['shopee', 'tiktok']) {
    const f = r.feeModel[k], X = r[k];
    truthy(f && f.pct > 0 && f.fixed >= 0, `${k} feeModel`);
    near(f.pct * X.sales + f.fixed * X.orders, -X.feeTotal, 1, k);
  }
  eq(E.compute(parsed, st, {}, { platforms: ['shopee'] }).feeModel.tiktok, null);
});
test('HPP produsen', () => {
  eq(E.hpp({ bahan: 500000, tenaga: 200000, overhead: 100000, hasil: 100, kemasan: 1500 }), 9500);
  truthy(Number.isNaN(E.hpp({ bahan: 1000, hasil: 0 })), 'hasil 0 → NaN');
  eq(E.hpp({ bahan: '', tenaga: -5, hasil: 10, kemasan: 0 }), 0);
});
/* ---------- Fase 1 H1/H3: parser export Shopee + pencocok (data SINTETIS) ---------- */
const Sint = require('./fixtures/shopee-sintetis.js');
const items = (inc, id) => inc.items.filter((it) => it.orderId === id);
const ordersOf = (exp) => exp.lines;
/** Bantu: parse fixture lalu jalankan pencocok untuk satu pesanan. */
const cocokkan = (orders, lines, id, format) => {
  const inc = E.parseWorkbook(Sint.penghasilan(orders));
  const exp = E.parseWorkbook(Sint.exportPesanan(lines, format));
  return { inc, exp, m: E.matchShopeeOrder(id, items(inc, id), ordersOf(exp)) };
};
const unitTerhitung = (m) => {   // jumlah unit yang dianggap pasti, per baris laporan + per kelompok ambigu
  let n = 0; const g = new Set();
  for (const r of m.items) if (r.qtyStatus === 'terverifikasi') { if (r.groupId === null) n += r.qty; else if (!g.has(r.groupId)) { g.add(r.groupId); n += m.groups[r.groupId].qtyTotal; } }
  return n;
};

test('F1 parser export baru: kolom tambahan terbaca, field lama tidak berubah', () => {
  const p = E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-1', name: 'Kaos Polos', variant: 'M', qty: 2, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' }]));
  eq(p.kind, 'shopee_orders');
  const l = p.lines[0];
  eq(l.qty, 2); eq(l.unitPrice, 50000); eq(l.subtotal, 100000); eq(l.priceAfterDisc, 50000);
  eq(l.returnedQty, 1); eq(l.returnStatus, 'Permintaan Disetujui'); eq(l.sku, ''); eq(l.skuVariant, ''); eq(l.skuParent, '');
  eq('skuFilled' in l, false, 'field gabungan SKU dihapus saat audit');
  eq(E.shopeeLineValue(l), 100000);
});
test('F2 parser export format lama (tanpa Subtotal/Returned): tetap terbaca, nilai = jumlah × harga setelah diskon', () => {
  const p = E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-1', name: 'Kaos Polos', qty: 3, price: 40000 }], 'lama'));
  eq(p.lines.length, 1);
  truthy(Number.isNaN(p.lines[0].subtotal) && Number.isNaN(p.lines[0].returnedQty), 'kolom yang tidak ada → NaN, bukan 0');
  eq(E.shopeeLineValue(p.lines[0]), 120000);
});
test('F3 SKU opsional: SKU variasi dan SKU induk disimpan terpisah; field sku lama tidak berubah', () => {
  const p = E.parseWorkbook(Sint.exportPesanan([
    { order: 'SINT-1', name: 'A', qty: 1, price: 1000, skuParent: 'INDUK-1' },
    { order: 'SINT-1', name: 'B', qty: 1, price: 2000, skuVariant: 'VAR-B', skuParent: 'INDUK-2' },
  ]));
  eq(p.lines[0].sku, '', 'perilaku lama: kolom Nomor Referensi SKU kosong tetap terbaca kosong');
  eq(p.lines[0].skuParent, 'INDUK-1'); eq(p.lines[0].skuVariant, '', 'SKU induk TIDAK mengisi SKU variasi');
  eq(p.lines[1].skuVariant, 'VAR-B'); eq(p.lines[1].skuParent, 'INDUK-2'); eq(p.lines[1].sku, 'VAR-B');
});
test('F4 kolom Subtotal berisi teks tanpa angka ("-") → NaN, bukan 0 diam-diam', () => {
  const p = E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-1', name: 'Kaos', qty: 1, price: 50000, subtotal: '-' }]));
  truthy(Number.isNaN(p.lines[0].subtotal), 'subtotal "-" → NaN');
  eq(E.shopeeLineValue(p.lines[0]), 50000, 'jatuh ke jumlah × harga setelah diskon');
});
test('T1 satu unit, nilai sama → M1 terverifikasi; produk tanpa variasi = tidak_relevan', () => {
  const { m } = cocokkan([{ id: 'SINT-1', items: [{ name: 'Buku Catatan', harga: 25000 }] }], [{ order: 'SINT-1', name: 'Buku Catatan', qty: 1, price: 25000 }], 'SINT-1');
  eq(m.items[0].rule, 'M1'); eq(m.items[0].qtyStatus, 'terverifikasi'); eq(m.items[0].qty, 1); eq(m.items[0].variantStatus, 'tidak_relevan');
  eq(m.unusedLines.length, 0);
});
test('T2 multi-unit → jumlah dari export (3), bukan 1', () => {
  const { m } = cocokkan([{ id: 'SINT-2', items: [{ name: 'Pulpen', harga: 15000 }] }], [{ order: 'SINT-2', name: 'Pulpen', qty: 3, price: 5000 }], 'SINT-2');
  eq(m.items[0].qty, 3); eq(m.items[0].qtyStatus, 'terverifikasi');
});
test('T3 variasi harga berbeda → masing-masing pasti, tiap baris export dipakai sekali (tanpa hitung ganda)', () => {
  const lines = [{ order: 'SINT-3', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-3', name: 'Kaos', variant: 'XL', qty: 2, price: 60000 }];
  const { m, exp } = cocokkan([{ id: 'SINT-3', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 120000 }] }], lines, 'SINT-3');
  eq(m.items.map((r) => r.rule).join(), 'M2,M2'); eq(m.items.map((r) => r.qty).join(), '1,2');
  eq(m.items.map((r) => r.variantStatus).join(), 'terverifikasi,terverifikasi');
  eq(exp.lines[m.items[0].lineIdx[0]].variant, 'S'); eq(exp.lines[m.items[1].lineIdx[0]].variant, 'XL');
  eq(unitTerhitung(m), 3, 'unit pasti = total jumlah export');
});
test('T4 variasi harga kembar, jumlah sama → jumlah pasti, variasi AMBIGU, kelompok lengkap', () => {
  const lines = [{ order: 'SINT-4', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-4', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }];
  const { m } = cocokkan([{ id: 'SINT-4', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }], lines, 'SINT-4');
  eq(m.items.map((r) => r.rule).join(), 'M2_ambigu,M2_ambigu');
  eq(m.items.map((r) => r.qtyStatus).join(), 'terverifikasi,terverifikasi');
  eq(m.items.map((r) => r.variantStatus).join(), 'ambigu,ambigu');
  eq(m.items[0].lineIdx.length, 0, 'tidak ada pasangan per baris yang ditebak');
  eq(m.groups.length, 1); eq(m.groups[0].complete, true); eq(m.groups[0].qtyTotal, 2);
  eq(unitTerhitung(m), 2); eq(m.unusedLines.length, 0);
});
test('T5 nilai kembar tetapi jumlah berbeda (1×100rb vs 2×50rb) → jumlah BELUM, variasi ambigu', () => {
  const lines = [{ order: 'SINT-5', name: 'Paket', variant: 'Besar', qty: 1, price: 100000 }, { order: 'SINT-5', name: 'Paket', variant: 'Kecil', qty: 2, price: 50000 }];
  const { m } = cocokkan([{ id: 'SINT-5', items: [{ name: 'Paket', harga: 100000 }, { name: 'Paket', harga: 100000 }] }], lines, 'SINT-5');
  eq(m.items.map((r) => r.qtyStatus).join(), 'belum,belum'); eq(m.items[0].qty, null); eq(m.items[0].variantStatus, 'ambigu');
  eq(unitTerhitung(m), 0);
});
test('T6 nama berbeda → tidak dicocokkan (M3 belum aktif); baris export tercatat tidak terpakai', () => {
  const { m } = cocokkan([{ id: 'SINT-6', items: [{ name: 'Novel Edisi Lama', harga: 80000 }] }], [{ order: 'SINT-6', name: 'Novel Edisi Baru', qty: 1, price: 80000 }], 'SINT-6');
  eq(m.items[0].rule, 'nama_tidak_ditemukan'); eq(m.items[0].qtyStatus, 'belum'); eq(m.unusedLines.length, 1);
});
test('T7 pesanan tidak ada di export → M0, belum', () => {
  const { m } = cocokkan([{ id: 'SINT-7', items: [{ name: 'Map', harga: 9000 }] }], [{ order: 'SINT-LAIN', name: 'Map', qty: 1, price: 9000 }], 'SINT-7');
  eq(m.items[0].rule, 'M0'); eq(m.items[0].qtyStatus, 'belum'); eq(m.ignored.lines, 1, 'baris pesanan lain diabaikan');
});
test('T8 tidak lintas pesanan: baris bernama & bernilai sama di pesanan lain tidak dipakai', () => {
  const orders = [{ id: 'SINT-8A', items: [{ name: 'Stiker', harga: 5000 }] }, { id: 'SINT-8B', items: [{ name: 'Stiker', harga: 5000 }] }];
  const { m } = cocokkan(orders, [{ order: 'SINT-8B', name: 'Stiker', qty: 1, price: 5000 }], 'SINT-8A');
  eq(m.items[0].rule, 'M0'); eq(m.ignored.lines, 1);
});
test('T9 nilai tidak sama → belum (toleransi 0)', () => {
  const { m } = cocokkan([{ id: 'SINT-9', items: [{ name: 'Tas', harga: 100000 }] }], [{ order: 'SINT-9', name: 'Tas', qty: 1, price: 99999 }], 'SINT-9');
  eq(m.items[0].rule, 'nilai_tidak_cocok'); eq(m.items[0].qtyStatus, 'belum');
});
test('T10 export ganda: jumlah tidak berlipat (pencocok konservatif + dedup produksi tetap sama)', () => {
  const line = { order: 'SINT-10', name: 'Topi', qty: 2, price: 30000 };
  const orders = [{ id: 'SINT-10', items: [{ name: 'Topi', harga: 60000 }] }];
  const inc = E.parseWorkbook(Sint.penghasilan(orders));
  const exp = E.parseWorkbook(Sint.exportPesanan([line]));
  const m = E.matchShopeeOrder('SINT-10', items(inc, 'SINT-10'), [...exp.lines, ...exp.lines]);
  truthy(m.items[0].qty === null || m.items[0].qty === 2, 'tidak pernah 4');
  truthy(unitTerhitung(m) <= 2, 'unit pasti tidak melebihi satu salinan export');
  // Jalur produksi (merge) tetap membuang salinan export yang sama: hasil compute identik.
  const st0 = { modalMode: 'produk', catalog: [{ kode: '', nama: 'Topi', variasi: '', cost: 10000 }], periods: [{ start: '', markup: 0, disc: 0 }] };
  const a = E.compute([inc, exp], st0), b = E.compute([inc, exp, exp], st0);
  eq(a.totalModal, b.totalModal); eq(a.qtyAssumed, b.qtyAssumed);
});
test('T11 jumlah baris laporan ≠ jumlah kandidat bernilai sama → belum, baris export tidak dipakai', () => {
  const lines = [{ order: 'SINT-11', name: 'Kaos', variant: 'A', qty: 1, price: 50000 }, { order: 'SINT-11', name: 'Kaos', variant: 'B', qty: 1, price: 50000 }];
  const { m } = cocokkan([{ id: 'SINT-11', items: [{ name: 'Kaos', harga: 50000 }] }], lines, 'SINT-11');
  eq(m.items[0].qtyStatus, 'belum'); eq(m.items[0].variantStatus, 'ambigu'); eq(m.unusedLines.length, 2);
});
test('T12 export format lama → tetap bisa terverifikasi lewat jumlah × harga setelah diskon', () => {
  const { m } = cocokkan([{ id: 'SINT-12', items: [{ name: 'Gantungan', harga: 24000 }] }], [{ order: 'SINT-12', name: 'Gantungan', qty: 2, price: 12000 }], 'SINT-12', 'lama');
  eq(m.items[0].rule, 'M1'); eq(m.items[0].qty, 2);
});
test('T13 hanya ada Harga Awal → tidak bisa dibandingkan, belum', () => {
  const { m } = cocokkan([{ id: 'SINT-13', items: [{ name: 'Kalender', harga: 30000 }] }], [{ order: 'SINT-13', name: 'Kalender', qty: 1, price: 30000 }], 'SINT-13', 'harga_awal');
  eq(m.items[0].qtyStatus, 'belum');
});
test('T14 pencocok murni: input tidak diubah', () => {
  const inc = E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-14', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }]));
  const exp = E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-14', name: 'Kaos', variant: 'A', qty: 1, price: 50000 }, { order: 'SINT-14', name: 'Kaos', variant: 'B', qty: 1, price: 50000 }]));
  const before = JSON.stringify([inc.items, exp.lines]);
  E.matchShopeeOrder('SINT-14', items(inc, 'SINT-14'), exp.lines);
  eq(JSON.stringify([inc.items, exp.lines]), before);
});
test('T15 SKU kosong maupun terisi tidak mengubah hasil pencocokan (SKU opsional)', () => {
  const base = { order: 'SINT-15', name: 'Kaos', variant: 'S', qty: 1, price: 50000 };
  const a = cocokkan([{ id: 'SINT-15', items: [{ name: 'Kaos', harga: 50000 }] }], [base], 'SINT-15').m;
  const b = cocokkan([{ id: 'SINT-15', items: [{ name: 'Kaos', harga: 50000 }] }], [{ ...base, skuVariant: 'KS-S' }], 'SINT-15').m;
  eq(JSON.stringify(a.items), JSON.stringify(b.items));
});
test('T16 (diperbarui Fase 2) variasi bernama sama tidak lagi dihitung ganda; modal tingkat produk ditandai', () => {
  // Fase 1 mencatat perilaku lama 30.000 (2 unit + 1 unit asumsi). Fase 2 sengaja mengubahnya: 1 + 1 unit = 20.000.
  const orders = [{ id: 'SINT-16', items: [{ name: 'Kaos', productId: 'P1', harga: 50000 }, { name: 'Kaos', productId: 'P1', harga: 60000 }] }];
  const lines = [{ order: 'SINT-16', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-16', name: 'Kaos', variant: 'L', qty: 1, price: 60000 }];
  const st0 = { modalMode: 'produk', catalog: [{ kode: 'P1', nama: '', variasi: '', cost: 10000 }], periods: [{ start: '', markup: 0, disc: 0 }] };
  const r0 = E.compute([E.parseWorkbook(Sint.penghasilan(orders)), E.parseWorkbook(Sint.exportPesanan(lines))], st0);
  eq(r0.totalModal, 20000, 'unit = isi export (2), bukan 3');
  eq(r0.qtyAssumed, 0);
  eq(r0.shopeeQty.hpp.belum, 2, 'satu modal untuk produk bervariasi belum terbukti berlaku untuk tiap variasi (E2)');
});
/* ---------- Tes tambahan dari audit akhir Fase 1 ---------- */
test('T17 kelompok tidak lengkap: 2 baris laporan bernilai sama, hanya 1 baris export → belum, tidak ada yang dianggap pasti', () => {
  const { m } = cocokkan([{ id: 'SINT-17', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }],
    [{ order: 'SINT-17', name: 'Kaos', variant: 'A', qty: 1, price: 50000 }], 'SINT-17');
  eq(m.items.map((r) => r.qtyStatus).join(), 'belum,belum');
  eq(m.items.map((r) => r.rule).join(), 'jumlah_kandidat_beda,jumlah_kandidat_beda');
  eq(m.groups.length, 0, 'tidak ada kelompok lengkap'); eq(unitTerhitung(m), 0); eq(m.unusedLines.length, 1);
});
test('T18 Subtotal & Harga Setelah Diskon kosong/teks → nilai tidak diketahui, belum (bukan 0)', () => {
  const { exp, m } = cocokkan([{ id: 'SINT-18', items: [{ name: 'Kaos', harga: 50000 }] }],
    [{ order: 'SINT-18', name: 'Kaos', qty: 1, price: 50000, subtotal: '-', afterDisc: '' }], 'SINT-18');
  truthy(Number.isNaN(exp.lines[0].subtotal) && Number.isNaN(exp.lines[0].priceAfterDisc), 'kosong/teks → NaN');
  truthy(Number.isNaN(E.shopeeLineValue(exp.lines[0])), 'nilai baris NaN');
  eq(m.items[0].qtyStatus, 'belum'); eq(m.items[0].qty, null);
});
test('T19 status selain "Selesai" ditandai di nonCompletedLines (tidak dikecualikan diam-diam)', () => {
  const { m } = cocokkan([{ id: 'SINT-19', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Topi', harga: 20000 }] }],
    [{ order: 'SINT-19', name: 'Kaos', qty: 1, price: 50000 }, { order: 'SINT-19', name: 'Topi', qty: 1, price: 20000, status: 'Batal' }], 'SINT-19');
  eq(m.nonCompletedLines.join(), '1', 'baris berstatus Batal ditandai');
  eq(m.items[1].lineIdx.join(), '1', 'tetap dicocokkan; keputusan status diserahkan ke Fase berikutnya');
});
test('T20 status kosong tidak ditandai sebagai non-Selesai', () => {
  const { m } = cocokkan([{ id: 'SINT-20', items: [{ name: 'Kaos', harga: 50000 }] }],
    [{ order: 'SINT-20', name: 'Kaos', qty: 1, price: 50000, status: '' }], 'SINT-20');
  eq(m.nonCompletedLines.length, 0);
});
test('T21 SKU induk sama untuk dua variasi tidak memengaruhi pencocokan (bukan identitas variasi)', () => {
  const orders = [{ id: 'SINT-21', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }];
  const tanpa = [{ order: 'SINT-21', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-21', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }];
  const dengan = tanpa.map((l) => ({ ...l, skuParent: 'INDUK-KAOS' }));
  const a = cocokkan(orders, tanpa, 'SINT-21').m, b = cocokkan(orders, dengan, 'SINT-21').m;
  eq(JSON.stringify(a), JSON.stringify(b));
  eq(b.items.map((r) => r.variantStatus).join(), 'ambigu,ambigu', 'SKU induk tidak "memecahkan" ambiguitas variasi');
});

/* ---------- Fase 2 H1/H3: pencocok dipakai menghitung modal Shopee mode per produk (data SINTETIS) ---------- */
const ST = (catalog, extra = {}) => ({ modalMode: 'produk', catalog, periods: [{ start: '', markup: 0, disc: 0 }], ...extra });
const cat = (nama, variasi, cost, kode = '') => ({ kode, nama, variasi, cost });
/** Bantu: hitung laba dari fixture Laporan Penghasilan (+ export pesanan bila `lines` diberikan). */
const hitung = (orders, lines, st, salinanExport = 1) => {
  const files = [E.parseWorkbook(Sint.penghasilan(orders))];
  for (let k = 0; k < salinanExport && lines; k++) files.push(E.parseWorkbook(Sint.exportPesanan(lines)));
  return E.compute(files, st);
};
const kaosDuaVariasi = (h1, h2, id = 'SINT-P') => [{ id, items: [{ name: 'Kaos', productId: 'P', harga: h1 }, { name: 'Kaos', productId: 'P', harga: h2 }] }];

test('P1 variasi harga berbeda + modal berbeda (nama + variasi, tanpa SKU) → modal per variasi, terverifikasi', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'XL', qty: 2, price: 60000 }];
  const r = hitung(kaosDuaVariasi(50000, 120000), lines, ST([cat('Kaos', 'S', 20000), cat('Kaos', 'XL', 25000)]));
  eq(r.totalModal, 70000, '1×20.000 + 2×25.000');
  eq(r.qtyAssumed, 0); eq(r.shopeeQty.hpp.terverifikasi, 2); eq(r.shopeeQty.unitTerverifikasi, 3);
  eq(r.products[0].qty, 3); eq(r.products[0].statusShopee.hppTerverifikasi, 2);
});
test('P2 variasi harga sama + modal berbeda → total kelompok pasti, rincian per variasi tidak diklaim', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }];
  const r = hitung(kaosDuaVariasi(50000, 50000), lines, ST([cat('Kaos', 'Merah', 20000), cat('Kaos', 'Biru', 30000)]));
  eq(r.totalModal, 50000, '20.000 + 30.000, dihitung sekali per kelompok');
  eq(r.shopeeQty.hpp.terverifikasi_kelompok, 2); eq(r.shopeeQty.variasi.ambigu, 2); eq(r.shopeeQty.unitTerverifikasi, 2);
  const sama = hitung(kaosDuaVariasi(50000, 50000), lines, ST([cat('Kaos', 'Merah', 20000), cat('Kaos', 'Biru', 20000)]));
  eq(sama.shopeeQty.hpp.terverifikasi, 2, 'modal semua kandidat sama → per baris juga pasti (A.19.5)');
});
test('P3 kelompok ambigu dengan modal tidak lengkap → tidak diketahui (bukan 0, bukan modal variasi lain)', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }];
  const r = hitung(kaosDuaVariasi(50000, 50000), lines, ST([cat('Kaos', 'Merah', 20000)]));
  eq(r.coverage, 0, 'pesanan keluar dari "modal diketahui"'); eq(r.shopeeQty.hpp.tidak_diketahui, 2); eq(r.linesWithoutCost, 2);
  const f = hitung(kaosDuaVariasi(50000, 50000), lines, ST([cat('Kaos', 'Merah', 20000)], { fallbackPct: 40 }));
  eq(f.totalModal, 40000, 'memakai persen modal rata-rata (cara lama)'); eq(f.shopeeQty.hpp.estimasi, 2, 'modal rata-rata = estimasi');
  eq(f.shopeeQty.metodeHpp.modal_rata_rata, 2);
});
test('P4 multi-unit produk tanpa variasi, modal tingkat produk → jumlah dari export, terverifikasi', () => {
  const r = hitung([{ id: 'SINT-P4', items: [{ name: 'Pulpen', productId: 'PP', harga: 15000 }] }],
    [{ order: 'SINT-P4', name: 'Pulpen', qty: 3, price: 5000 }], ST([cat('', '', 2000, 'PP')]));
  eq(r.totalModal, 6000); eq(r.shopeeQty.hpp.terverifikasi, 1); eq(r.qtyAssumed, 0);
});
test('P5 SKU variasi terisi didahulukan; variasi tanpa SKU memakai modal produk lama dan ditandai', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'XL', qty: 2, price: 60000, skuVariant: 'KS-XL' }];
  const r = hitung(kaosDuaVariasi(50000, 120000), lines, ST([cat('', '', 10000, 'P'), cat('', '', 25000, 'KS-XL')]));
  eq(r.totalModal, 60000, 'S: 1×10.000 (modal produk lama), XL: 2×25.000 (SKU variasi)');
  eq(r.shopeeQty.hpp.terverifikasi, 1); eq(r.shopeeQty.hpp.belum, 1);
});
test('P6 SKU induk tanpa SKU variasi tidak dipakai sebagai identitas variasi', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'S', qty: 1, price: 50000, skuParent: 'INDUK-KAOS' }, { order: 'SINT-P', name: 'Kaos', variant: 'XL', qty: 2, price: 60000, skuParent: 'INDUK-KAOS' }];
  const r = hitung(kaosDuaVariasi(50000, 120000), lines, ST([cat('', '', 15000, 'INDUK-KAOS')]));
  eq(r.shopeeQty.hpp.tidak_diketahui, 2); eq(r.coverage, 0);
});
test('P7 A1: pesanan ADA di export tetapi baris tidak cocok → HPP tidak diketahui (bukan estimasi 1 unit, bukan 0)', () => {
  // Nama berbeda (M3 belum aktif) → tidak ada pasangan.
  const a = hitung([{ id: 'SINT-P7', items: [{ name: 'Novel Lama', harga: 80000 }] }], [{ order: 'SINT-P7', name: 'Novel Baru', qty: 2, price: 40000 }], ST([cat('Novel Lama', '', 30000)]));
  eq(a.coverage, 0, 'pesanan keluar dari "modal diketahui"'); eq(a.totalModal, 0); eq(a.qtyAssumed, 0);
  eq(a.shopeeQty.hpp.tidak_diketahui, 1); eq(a.shopeeQty.kuantitasTidakDiketahui, 1); eq(a.products[0].modalKnown, false);
  truthy(Number.isNaN(a.products[0].margin), 'margin produk tidak dihitung');
  // Nilai tidak cocok: cara lama 80.000 (jumlah 2), Fase 2 awal 40.000 (estimasi 1). Sekarang tidak diketahui.
  const b = hitung([{ id: 'SINT-P7', items: [{ name: 'Tas', harga: 100000 }] }], [{ order: 'SINT-P7', name: 'Tas', qty: 2, price: 49999 }], ST([cat('Tas', '', 40000)]));
  eq(b.coverage, 0); eq(b.shopeeQty.hpp.tidak_diketahui, 1);
  truthy(Number.isNaN(b.totalMargin), 'tidak ada laba yang dihitung dari pesanan ini');
});
test('P7b A1: kuantitas tidak bisa dipastikan (1 baris laporan, 2 kandidat bernilai sama) → tidak diketahui', () => {
  const r = hitung([{ id: 'SINT-P7B', items: [{ name: 'Kaos', harga: 50000 }] }],
    [{ order: 'SINT-P7B', name: 'Kaos', variant: 'A', qty: 1, price: 50000 }, { order: 'SINT-P7B', name: 'Kaos', variant: 'B', qty: 1, price: 50000 }], ST([cat('Kaos', '', 20000)]));
  eq(r.shopeeQty.hpp.tidak_diketahui, 1); eq(r.coverage, 0);
});
test('P7c A1: satu item tidak cocok membuat SELURUH pesanan keluar dari laba; pesanan lain tetap dihitung', () => {
  const orders = [{ id: 'SINT-C1', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Novel Lama', harga: 80000 }] }, { id: 'SINT-C2', items: [{ name: 'Topi', harga: 40000 }] }];
  const lines = [{ order: 'SINT-C1', name: 'Kaos', qty: 1, price: 50000 }, { order: 'SINT-C1', name: 'Novel Baru', qty: 2, price: 40000 }, { order: 'SINT-C2', name: 'Topi', qty: 1, price: 40000 }];
  const r = hitung(orders, lines, ST([cat('Kaos', '', 20000), cat('Novel Lama', '', 30000), cat('Topi', '', 15000)]));
  eq(r.totalModal, 15000, 'hanya pesanan Topi'); eq(r.totalMargin, 25000); eq(r.knownSales, 40000);
  eq(r.totalReceived - r.knownReceived, 130000, 'dana pesanan tanpa modal lengkap tidak masuk laba');
});
test('P7d A1 hanya untuk modal per unit: modal rata-rata (dari nilai penjualan) tetap dipakai; modal per unit tidak diganti modal rata-rata', () => {
  const orders = [{ id: 'SINT-D', items: [{ name: 'Novel Lama', harga: 80000 }] }];
  const lines = [{ order: 'SINT-D', name: 'Novel Baru', qty: 2, price: 40000 }];
  eq(hitung(orders, lines, ST([], { fallbackPct: 40 })).totalModal, 32000, 'tanpa modal per unit: 40% × 80.000 seperti sebelumnya');
  const r = hitung(orders, lines, ST([cat('Novel Lama', '', 30000)], { fallbackPct: 40 }));
  eq(r.coverage, 0, 'ada modal per unit tetapi jumlah tidak diketahui → tidak diketahui'); eq(r.shopeeQty.hpp.tidak_diketahui, 1);
});
test('P7e pesanan TIDAK ada di export → estimasi 1 unit tetap (kompatibel) dengan status "estimasi"', () => {
  const r = hitung([{ id: 'SINT-E', items: [{ name: 'Topi', harga: 50000 }] }], [{ order: 'SINT-LAIN', name: 'Topi', qty: 3, price: 50000 }], ST([cat('Topi', '', 20000)]));
  eq(r.totalModal, 20000); eq(r.qtyAssumed, 1); eq(r.shopeeQty.hpp.estimasi, 1); eq(r.shopeeQty.hpp.terverifikasi, 0);
  // Direfund penuh dan tidak ada di export: modal 0 dari rumus refund lama, status estimasi (bukan pasti).
  const c = hitung([{ id: 'SINT-E', items: [{ name: 'Topi', harga: 50000, refund: -50000 }] }], [{ order: 'SINT-LAIN', name: 'Topi', qty: 1, price: 50000 }], ST([cat('Topi', '', 20000)]));
  eq(c.totalModal, 0); eq(c.shopeeQty.refundPenuhTanpaKuantitas, 1); eq(c.shopeeQty.estimasiSatuUnit, 0);
  eq(c.shopeeQty.hpp.belum, 1, 'H2-A: estimasi + refund belum terselesaikan → belum, bukan estimasi biasa');
  eq(c.shopeeQty.unitTerverifikasi, 0, 'nol unit TERVERIFIKASI, bukan nol unit terjual');
});
test('P7f A1: refund penuh pada pesanan yang ada di export tetapi tidak cocok → tidak diketahui (bukan 0)', () => {
  const r = hitung([{ id: 'SINT-F', items: [{ name: 'Novel Lama', harga: 80000, refund: -80000 }] }], [{ order: 'SINT-F', name: 'Novel Baru', qty: 1, price: 80000 }], ST([cat('Novel Lama', '', 30000)]));
  eq(r.shopeeQty.hpp.tidak_diketahui, 1); eq(r.totalModal, 0, 'tidak ada modal yang ikut dihitung'); eq(r.knownSales, 0);
});

/* ---------- A3: deduplikasi export pesanan Shopee di merge() ---------- */
/** Bantu: hitung dengan beberapa FILE export terpisah (masing-masing daftar baris). */
const hitungFiles = (orders, fileLines, st) => E.compute([E.parseWorkbook(Sint.penghasilan(orders)), ...fileLines.map((ls) => E.parseWorkbook(Sint.exportPesanan(ls)))], st);
const kembar = { order: 'SINT-K', name: 'Kaos', variant: 'M', qty: 2, price: 30000 };
const ordersKembar = [{ id: 'SINT-K', items: [{ name: 'Kaos', harga: 60000 }, { name: 'Kaos', harga: 60000 }] }];
const stKembar = ST([cat('Kaos', 'M', 10000)]);
test('P8 file export identik diunggah dua kali → angka dan status identik dengan sekali', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }];
  const st = ST([cat('Kaos', 'Merah', 20000), cat('Kaos', 'Biru', 30000)]);
  const a = hitung(kaosDuaVariasi(50000, 50000), lines, st), b = hitung(kaosDuaVariasi(50000, 50000), lines, st, 2);
  eq(JSON.stringify([a.totalModal, a.qtyAssumed, a.shopeeQty]), JSON.stringify([b.totalModal, b.qtyAssumed, b.shopeeQty]));
  eq(b.shopeeQty.exportBerbeda, 0);
});
test('P9 A3: dua baris sah identik dalam SATU file → keduanya dipakai (4 unit), terverifikasi', () => {
  const r = hitung(ordersKembar, [kembar, kembar], stKembar);
  eq(r.shopeeQty.unitTerverifikasi, 4); eq(r.totalModal, 40000, '2 baris × 2 unit × 10.000');
  eq(r.shopeeQty.kuantitas.terverifikasi, 2); eq(r.shopeeQty.variasi.ambigu, 2, 'dua baris identik tidak bisa dibedakan satu per satu');
  // File yang sama diunggah dua kali: tetap 4 unit, tidak menjadi 8.
  const dua = hitung(ordersKembar, [kembar, kembar], stKembar, 2);
  eq(dua.shopeeQty.unitTerverifikasi, 4); eq(dua.totalModal, 40000); eq(dua.shopeeQty.exportBerbeda, 0);
});
test('P9b A3: dua file dengan periode tumpang tindih → pesanan yang sama tidak digandakan', () => {
  const orders = [{ id: 'SINT-1', items: [{ name: 'Topi', harga: 20000 }] }, { id: 'SINT-2', items: [{ name: 'Kaos', harga: 60000 }] }, { id: 'SINT-3', items: [{ name: 'Pulpen', harga: 15000 }] }];
  const l1 = { order: 'SINT-1', name: 'Topi', qty: 1, price: 20000 }, l2 = { order: 'SINT-2', name: 'Kaos', qty: 2, price: 30000 }, l3 = { order: 'SINT-3', name: 'Pulpen', qty: 3, price: 5000 };
  const st = ST([cat('Topi', '', 5000), cat('Kaos', '', 10000), cat('Pulpen', '', 1000)]);
  const r = hitungFiles(orders, [[l1, l2], [l2, l3]], st);
  eq(r.shopeeQty.unitTerverifikasi, 6, '1 + 2 + 3, pesanan SINT-2 tidak dihitung dua kali'); eq(r.totalModal, 28000); eq(r.shopeeQty.exportBerbeda, 0);
});
test('P9c A3: file sama dengan urutan baris berbeda → hasil sama, tidak dianggap berbeda', () => {
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'XL', qty: 2, price: 60000 }];
  const st = ST([cat('Kaos', 'S', 20000), cat('Kaos', 'XL', 25000)]);
  const a = hitungFiles(kaosDuaVariasi(50000, 120000), [lines], st), b = hitungFiles(kaosDuaVariasi(50000, 120000), [lines, [...lines].reverse()], st);
  const c = hitungFiles(kaosDuaVariasi(50000, 120000), [[...lines].reverse()], st);
  eq(JSON.stringify([a.totalModal, a.shopeeQty]), JSON.stringify([b.totalModal, b.shopeeQty]));
  eq(JSON.stringify([a.totalModal, a.shopeeQty]), JSON.stringify([c.totalModal, c.shopeeQty]));
});
test('P9d A3: file kedua punya LEBIH BANYAK baris identik → pesanan ditandai export berbeda, jumlah tidak diklaim pasti', () => {
  const r = hitungFiles(ordersKembar, [[kembar], [kembar, kembar]], stKembar);
  eq(r.shopeeQty.exportBerbeda, 2); eq(r.shopeeQty.hpp.tidak_diketahui, 2); eq(r.shopeeQty.unitTerverifikasi, 0);
  eq(r.coverage, 0, 'tidak ada laba final dari pesanan ini');
  const balik = hitungFiles(ordersKembar, [[kembar, kembar], [kembar]], stKembar);
  eq(balik.shopeeQty.exportBerbeda, 2, 'urutan unggah tidak mengubah kesimpulan'); eq(balik.coverage, 0);
});
/* ---------- Fase 2.1: identitas bertingkat & konflik status antar export (dua urutan unggah) ---------- */
/** Bantu: hitung dengan file export [baris, format] dalam urutan yang diberikan. */
const hitungFmt = (orders, files, st) => E.compute([E.parseWorkbook(Sint.penghasilan(orders)), ...files.map(([ls, fmt]) => E.parseWorkbook(Sint.exportPesanan(ls, fmt)))], st);
const ringkas = (r) => JSON.stringify([r.totalModal, r.coverage, r.totalMargin, r.shopeeQty, r.products.map((p) => [p.key, p.qty, p.qtyKnown, p.modal, p.modalKnown])], (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NaN' : v));
/** Jalankan dua urutan unggah (A,B) dan (B,A); keduanya WAJIB identik. Mengembalikan hasil urutan pertama. */
const duaUrutan = (orders, fileA, fileB, st) => {
  const ab = hitungFmt(orders, [fileA, fileB], st), ba = hitungFmt(orders, [fileB, fileA], st);
  eq(ringkas(ab), ringkas(ba), 'hasil tidak boleh bergantung urutan unggah');
  return ab;
};
const satu = [{ id: 'SINT-S', items: [{ name: 'Kaos', harga: 50000 }] }];
const bs = { order: 'SINT-S', name: 'Kaos', variant: 'M', qty: 1, price: 50000 };
const stSku = ST([cat('', '', 10000, 'KS-M'), cat('', '', 30000, 'KS-X'), cat('Kaos', 'M', 20000)]);

test('Q1 SKU sama di dua export → bukan konflik, HPP terverifikasi lewat SKU', () => {
  const r = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[{ ...bs, skuVariant: 'KS-M' }], 'baru'], stSku);
  eq(r.totalModal, 10000); eq(r.shopeeQty.hpp.terverifikasi, 1); eq(r.shopeeQty.identitasBerbeda, 0);
});
test('Q2 SKU berbeda, finansial sama → konflik identitas: kuantitas tetap terverifikasi, HPP tidak diketahui', () => {
  const r = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[{ ...bs, skuVariant: 'KS-X' }]], stSku);
  eq(r.shopeeQty.identitasBerbeda, 1); eq(r.shopeeQty.kuantitas.terverifikasi, 1); eq(r.shopeeQty.hpp.tidak_diketahui, 1);
  eq(r.coverage, 0, 'pesanan keluar dari "modal diketahui"');
});
test('Q3 SKU hanya di satu export → bukan konflik; modal lewat SKU itu berstatus belum', () => {
  const r = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[bs]], stSku);
  eq(r.totalModal, 10000, 'SKU dari export yang punya tetap dipakai, apa pun urutannya'); eq(r.shopeeQty.identitasBerbeda, 0);
  eq(r.shopeeQty.identitasSebagian, 1); eq(r.shopeeQty.hpp.belum, 1);
  // Tanpa modal SKU, modal lewat nama + variasi tidak bergantung SKU → tetap terverifikasi.
  const n = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[bs]], ST([cat('Kaos', 'M', 20000)]));
  eq(n.totalModal, 20000); eq(n.shopeeQty.hpp.terverifikasi, 1);
});
test('Q4 subtotal hanya di satu export (format lama + baru) → bukan konflik, bukan 0, kuantitas terverifikasi', () => {
  const r = duaUrutan(satu, [[bs], 'lama'], [[bs], 'baru'], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.exportBerbeda, 0); eq(r.shopeeQty.kuantitas.terverifikasi, 1); eq(r.totalModal, 20000); eq(r.coverage, 1);
  eq(r.shopeeQty.infoReturTidakTersedia, 0, 'export baru punya info retur');
  eq(r.shopeeQty.hpp.terverifikasi, 1);
});
test('Q5 SKU dan subtotal berbeda → konflik finansial: kuantitas belum, HPP tidak diketahui', () => {
  const r = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[{ ...bs, skuVariant: 'KS-X', subtotal: 45000 }]], stSku);
  eq(r.shopeeQty.exportBerbeda, 1); eq(r.shopeeQty.kuantitas.belum, 1); eq(r.shopeeQty.hpp.tidak_diketahui, 1); eq(r.coverage, 0);
  const harga = duaUrutan(satu, [[bs]], [[{ ...bs, afterDisc: 45000, subtotal: 50000 }]], stSku);
  eq(harga.shopeeQty.exportBerbeda, 1, 'harga setelah diskon berbeda juga konflik finansial');
});
test('Q6 dua baris sah identik → dipertahankan; unggah ulang tidak menggandakan (dua urutan)', () => {
  const r = duaUrutan(ordersKembar, [[kembar, kembar]], [[kembar, kembar]], stKembar);
  eq(r.shopeeQty.unitTerverifikasi, 4); eq(r.totalModal, 40000);
  const d = duaUrutan(ordersKembar, [[kembar]], [[kembar, kembar]], stKembar);
  eq(d.shopeeQty.exportBerbeda, 2, 'jumlah baris kembar berbeda → konflik finansial'); eq(d.coverage, 0);
});
test('Q7 dua variasi nama & harga sama, SKU berbeda → tidak tertukar: total kelompok = modal A + modal B', () => {
  const orders = [{ id: 'SINT-V', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }];
  const la = { order: 'SINT-V', name: 'Kaos', qty: 1, price: 50000, skuVariant: 'KS-M' }, lb = { ...la, skuVariant: 'KS-X' };
  const st = ST([cat('', '', 10000, 'KS-M'), cat('', '', 30000, 'KS-X')]);
  const satuFile = hitungFmt(orders, [[[la, lb]]], st);
  eq(satuFile.totalModal, 40000); eq(satuFile.shopeeQty.hpp.terverifikasi_kelompok, 2);
  const r = duaUrutan(orders, [[la, lb]], [[lb, la]], st);
  eq(r.totalModal, 40000, 'urutan baris berbeda, multiset SKU sama'); eq(r.shopeeQty.identitasBerbeda, 0);
  const tukar = duaUrutan(orders, [[la, lb]], [[la, { ...lb, skuVariant: 'KS-Z' }]], st);
  eq(tukar.shopeeQty.identitasBerbeda, 2, 'multiset SKU berbeda → konflik identitas'); eq(tukar.coverage, 0);
});
test('Q8 status retur berbeda, finansial sama → konflik status: kuantitas terverifikasi, HPP belum, modal sama', () => {
  const r = duaUrutan(satu, [[bs]], [[{ ...bs, returned: 1, returnStatus: 'Permintaan Disetujui' }]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.statusExportBerbeda, 1); eq(r.shopeeQty.refundBelumJelas, 1); eq(r.shopeeQty.kuantitas.terverifikasi, 1);
  eq(r.shopeeQty.hpp.belum, 1); eq(r.totalModal, 20000); eq(r.coverage, 1);
});
test('Q9 hanya returnedQty berbeda → konflik status, HPP belum', () => {
  const r = duaUrutan(satu, [[bs]], [[{ ...bs, returned: 1 }]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.statusExportBerbeda, 1); eq(r.shopeeQty.hpp.belum, 1); eq(r.shopeeQty.kuantitas.terverifikasi, 1);
});
test('Q10 Status Pesanan berbeda → konflik status + status belum selesai, HPP belum', () => {
  const r = duaUrutan(satu, [[bs]], [[{ ...bs, status: 'Sedang Dikirim' }]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.statusExportBerbeda, 1); eq(r.shopeeQty.statusBelumDivalidasi, 1); eq(r.shopeeQty.hpp.belum, 1);
});
test('Q11 hanya export format lama (tanpa kolom retur) → info retur tidak tersedia, bukan "tidak ada retur"', () => {
  const p = E.parseWorkbook(Sint.exportPesanan([bs], 'lama'));
  eq(p.lines[0].returnStatus, null, 'kolom tidak ada → null'); eq(E.parseWorkbook(Sint.exportPesanan([bs])).lines[0].returnStatus, '', 'kolom ada tetapi kosong → ""');
  const r = hitungFmt(satu, [[[bs], 'lama']], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.infoReturTidakTersedia, 1); eq(r.shopeeQty.hpp.belum, 1); eq(r.totalModal, 20000, 'angka tidak berubah');
  const dua = duaUrutan(satu, [[bs], 'lama'], [[bs], 'lama'], ST([cat('Kaos', 'M', 20000)]));
  eq(dua.shopeeQty.infoReturTidakTersedia, 1);
});
test('Q12 kelompok multi-baris dengan identitas sebagian → tidak digabung lintas baris, HPP belum (dua urutan)', () => {
  const orders = [{ id: 'SINT-V', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }];
  const l = { order: 'SINT-V', name: 'Kaos', qty: 1, price: 50000 };
  const st = ST([cat('', '', 10000, 'KS-M'), cat('', '', 30000, 'KS-X'), cat('Kaos', '', 20000)]);
  const r = duaUrutan(orders, [[{ ...l, skuVariant: 'KS-M' }, l]], [[l, { ...l, skuVariant: 'KS-X' }]], st);
  eq(r.shopeeQty.identitasSebagian, 2); eq(r.shopeeQty.hpp.terverifikasi + r.shopeeQty.hpp.terverifikasi_kelompok, 0);
  eq(r.shopeeQty.unitTerverifikasi, 2, 'jumlah barang tetap terbukti');
});
test('Q13 refund penuh + status berbeda antar export → modal 0 rumus lama (H2), HPP belum, sama di dua urutan', () => {
  const o = [{ id: 'SINT-S', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }];
  const r = duaUrutan(o, [[bs]], [[{ ...bs, returned: 1, returnStatus: 'Permintaan Disetujui' }]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.totalModal, 0); eq(r.shopeeQty.hpp.belum, 1); eq(r.shopeeQty.kuantitas.terverifikasi, 1, 'refund ≠ jumlah dipesan 0');
});
test('Q14 regresi: file tunggal format baru tanpa tanda retur tetap terverifikasi (perilaku Fase 2)', () => {
  const r = hitungFmt(satu, [[[bs]]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.hpp.terverifikasi, 1); eq(r.shopeeQty.infoReturTidakTersedia, 0); eq(r.totalModal, 20000);
});
/* ---------- Fase 2.1: metadata HPP modal rata-rata (hppMethod + status estimasi) ---------- */
const stRata = ST([], { fallbackPct: 40 });
/** Angka keuangan yang TIDAK boleh berubah hanya karena status: modal, laba, cakupan, unit, tabel produk. */
const angka = (r) => JSON.stringify([r.totalModal, r.totalMargin, r.coverage, r.knownSales, r.shopeeQty.unitTerverifikasi, r.shopeeQty.kuantitas,
  r.products.map((p) => [p.qty, p.modal, p.margin])], (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NaN' : v));
test('R1 modal rata-rata tanpa konflik → estimasi, metode modal_rata_rata', () => {
  const r = hitungFmt(satu, [[[bs]]], stRata);
  eq(r.shopeeQty.hpp.estimasi, 1); eq(r.shopeeQty.metodeHpp.modal_rata_rata, 1); eq(r.shopeeQty.metodeHpp.modal_per_unit, 0);
  eq(r.totalModal, 20000); eq(r.totalMargin, 30000); eq(r.coverage, 1);
});
test('R2 modal rata-rata + konflik SKU → tetap estimasi, alasan identitas tercatat, angka sama (dua urutan)', () => {
  const r = duaUrutan(satu, [[{ ...bs, skuVariant: 'KS-M' }]], [[{ ...bs, skuVariant: 'KS-X' }]], stRata);
  eq(r.shopeeQty.hpp.estimasi, 1); eq(r.shopeeQty.identitasBerbeda, 1); eq(r.shopeeQty.kuantitas.terverifikasi, 1);
  eq(angka(r), angka(hitungFmt(satu, [[[bs]]], stRata)), 'konflik SKU tidak mengubah angka modal rata-rata');
});
test('R3 modal rata-rata + konflik status retur → belum, metode tetap modal_rata_rata (dua urutan)', () => {
  const r = duaUrutan(satu, [[bs]], [[{ ...bs, returned: 1, returnStatus: 'Permintaan Disetujui' }]], stRata);
  eq(r.shopeeQty.hpp.belum, 1); eq(r.shopeeQty.hpp.estimasi, 0); eq(r.shopeeQty.metodeHpp.modal_rata_rata, 1);
  eq(r.shopeeQty.statusExportBerbeda, 1); eq(angka(r), angka(hitungFmt(satu, [[[bs]]], stRata)));
});
test('R4 modal rata-rata + info retur tidak tersedia (format lama) → belum', () => {
  const r = hitungFmt(satu, [[[bs], 'lama']], stRata);
  eq(r.shopeeQty.hpp.belum, 1); eq(r.shopeeQty.infoReturTidakTersedia, 1); eq(r.shopeeQty.metodeHpp.modal_rata_rata, 1);
  eq(r.totalModal, 20000);
});
test('R5 modal rata-rata + identitas sebagian → belum (dua urutan)', () => {
  const orders = [{ id: 'SINT-V', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Kaos', harga: 50000 }] }];
  const l = { order: 'SINT-V', name: 'Kaos', qty: 1, price: 50000 };
  const r = duaUrutan(orders, [[{ ...l, skuVariant: 'KS-M' }, l]], [[l, { ...l, skuVariant: 'KS-X' }]], stRata);
  eq(r.shopeeQty.identitasSebagian, 2); eq(r.shopeeQty.hpp.belum, 2); eq(r.shopeeQty.hpp.estimasi, 0); eq(r.totalModal, 40000);
});
test('R6 konflik finansial: modal per unit → tidak_diketahui; modal rata-rata tetap terhitung tetapi belum (bukan estimasi)', () => {
  const unit = duaUrutan(satu, [[bs]], [[{ ...bs, afterDisc: 45000, subtotal: 50000 }]], ST([cat('Kaos', 'M', 20000)]));
  eq(unit.shopeeQty.hpp.tidak_diketahui, 1); eq(unit.shopeeQty.metodeHpp.modal_per_unit, 1); eq(unit.coverage, 0);
  const rata = duaUrutan(satu, [[bs]], [[{ ...bs, afterDisc: 45000, subtotal: 50000 }]], stRata);
  eq(rata.shopeeQty.hpp.belum, 1, 'konflik finansial tidak disembunyikan di balik label estimasi'); eq(rata.shopeeQty.kuantitas.belum, 1);
  eq(rata.totalModal, 20000, 'persen dari Laporan Penghasilan tetap bisa dihitung');
});
test('R7 metadata tidak mengubah angka: modal per unit + campuran status → angka sama dengan sebelum metadata', () => {
  const r = hitungFmt(satu, [[[bs]]], ST([cat('Kaos', 'M', 20000)]));
  eq(r.shopeeQty.metodeHpp.modal_per_unit, 1); eq(r.shopeeQty.hpp.terverifikasi, 1, 'jalur modal per unit tidak berubah');
  eq(r.totalModal, 20000); eq(r.totalMargin, 30000);
});
test('P10 refund parsial & penuh pada pasangan terverifikasi → kuantitas pasti, HPP belum (menunggu H2), rumus refund lama tetap', () => {
  // H2-B1: unit refund berasal dari returnedQty (1 dari 2), bukan dari nominal → HPP 1 unit terjual = 20.000.
  const parsial = hitung([{ id: 'SINT-PA', items: [{ name: 'Kaos', harga: 100000, refund: -50000 }] }], [{ order: 'SINT-PA', name: 'Kaos', qty: 2, price: 50000, returned: 1 }], ST([cat('Kaos', '', 20000)]));
  eq(parsial.totalModal, 20000, '1 unit terjual × 20.000 (buku unit)');
  eq(parsial.shopeeQty.kuantitas.terverifikasi, 1); eq(parsial.shopeeQty.hpp.belum, 1); eq(parsial.shopeeQty.refundBelumJelas, 1);
  const penuh = hitung([{ id: 'SINT-PB', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }], [{ order: 'SINT-PB', name: 'Kaos', qty: 1, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' }], ST([cat('Kaos', '', 20000)]));
  eq(penuh.totalModal, 0); eq(penuh.shopeeQty.hpp.belum, 1); eq(penuh.shopeeQty.kuantitas.terverifikasi, 1);
  // Satu baris kelompok direfund → seluruh kelompok belum terverifikasi (D1).
  const g = hitung([{ id: 'SINT-P', items: [{ name: 'Kaos', productId: 'P', harga: 50000 }, { name: 'Kaos', productId: 'P', harga: 50000, refund: -50000 }] }],
    [{ order: 'SINT-P', name: 'Kaos', variant: 'Merah', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000 }],
    ST([cat('Kaos', 'Merah', 20000), cat('Kaos', 'Biru', 30000)]));
  eq(g.shopeeQty.hpp.belum, 2); eq(g.totalModal, 25000, '50.000 ÷ 2 × porsi tidak direfund (1 dan 0)');
  // Tanda retur di export walau Laporan Penghasilan tidak mencatat refund → tetap ditandai.
  const tanda = hitung([{ id: 'SINT-PC', items: [{ name: 'Kaos', harga: 50000 }] }], [{ order: 'SINT-PC', name: 'Kaos', qty: 1, price: 50000, returned: 1 }], ST([cat('Kaos', '', 20000)]));
  eq(tanda.shopeeQty.refundBelumJelas, 1); eq(tanda.totalModal, 20000);
});
test('P11 status pesanan selain "Selesai" → angka tetap, HPP belum terverifikasi', () => {
  const r = hitung([{ id: 'SINT-P11', items: [{ name: 'Kaos', harga: 50000 }] }], [{ order: 'SINT-P11', name: 'Kaos', qty: 1, price: 50000, status: 'Batal' }], ST([cat('Kaos', '', 20000)]));
  eq(r.totalModal, 20000); eq(r.shopeeQty.hpp.belum, 1); eq(r.shopeeQty.statusBelumDivalidasi, 1);
});
test('P12 regresi: tanpa export, modal rata-rata, dan harga acuan tidak berubah', () => {
  const orders = kaosDuaVariasi(50000, 60000);
  const lines = [{ order: 'SINT-P', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-P', name: 'Kaos', variant: 'L', qty: 1, price: 60000 }];
  const tanpa = hitung(orders, null, ST([cat('', '', 10000, 'P')]));
  eq(tanpa.totalModal, 20000, 'estimasi 1 unit per baris seperti sebelumnya'); eq(tanpa.qtyAssumed, 2); eq(tanpa.shopeeQty.estimasiSatuUnit, 2);
  eq(tanpa.shopeeQty.hpp.estimasi, 2, 'status estimasi, bukan terverifikasi');
  for (const ex of [null, lines]) {
    eq(hitung(orders, ex, ST([], { fallbackPct: 40 })).totalModal, 44000, 'modal rata-rata 40% × 110.000');
    const acuan = hitung(orders, ex, { modalMode: 'acuan', mitra: 30, periods: [{ start: '', markup: 0, disc: 0 }] });
    eq(acuan.totalModal, 77000, 'harga acuan: 70% × 110.000');
    eq(acuan.shopeeQty.metodeHpp.harga_acuan, 2, 'H2-A: metode harga_acuan'); eq(acuan.shopeeQty.hpp.estimasi, 2);
  }
});

/* ---------- H2-A: jumlah retur, rekonsiliasi unit, kasus tanpa nilai, status, kepastian (data SINTETIS) ---------- */
/** File retur Shopee sintetis. kolomQty: 'Jumlah Produk Dikembalikan' (format asli), 'Jumlah' (lama), atau null (tidak ada). */
const returShopee = (rows, kolomQty = 'Jumlah Produk Dikembalikan') => {
  const cols = ['No. Pengembalian', 'No. Pesanan', 'Nama Produk', 'Variasi', ...(kolomQty ? [kolomQty] : []), 'Total Pengembalian Dana',
    'Status Pembatalan/ Pengembalian', 'Solusi Pengembalian Barang/Dana', 'Alasan Pengembalian', 'Waktu Pengembalian Diajukan', 'No. Resi Pengembalian Barang'];
  return E.parseWorkbook({ name: 'retur-sintetis.xlsx', sheets: { Sheet1: [cols, ...rows.map((x) => [x.id || 'RT1', x.order, x.product, x.variant || '',
    ...(kolomQty ? [x.qty] : []), x.amount, 'Selesai', x.solusi || 'Pengembalian Barang dan Dana', x.alasan || 'Barang rusak', '2026-01-12', ''])] } });
};
const returTiktok = (rows) => E.parseWorkbook({ name: 'tt-retur.xlsx', sheets: { Sheet1: [['Return Order ID', 'Order ID', 'SKU ID', 'Product Name', 'SKU Name',
  'Return Quantity', 'Return unit price', 'Refund Time', 'Return Type', 'Return Reason', 'Return Logistics Tracking ID', 'Buyer Note', 'Return Status', 'Time Requested'],
  ...rows.map((x) => [x.id || 'TR1', 'TT-O1', 'SKU1', 'Kaos', 'M', x.qty, 50000, '2026-01-12', 'Return and refund', 'Damaged', 'RESI', '', 'Completed', '2026-01-10'])] } });
const ksKaos = 'S|RT1|Kaos|';
const stUnit = ST([cat('Kaos', '', 20000)]);
/** Satu pesanan 2 kaos @50.000 (+ export) dengan refund & returnedQty yang diberikan. */
const filesKaos = (refund, returned, withExport = true) => [E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund }] }])),
  ...(withExport ? [E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-K1', name: 'Kaos', qty: 2, price: 50000, returned, returnStatus: refund ? 'Permintaan Disetujui' : '' }]))] : [])];

test('H1 parser retur Shopee: 3, 1, kosong, tidak ada, teks, nol, kolom lama', () => {
  const q = (qty, kol) => returShopee([{ order: 'X', product: 'Kaos', qty, amount: 1 }], kol).cases[0];
  eq(q(3).qty, 3); eq(q(3).qtyInfo, 'ada'); eq(q(1).qty, 1);
  truthy(Number.isNaN(q('').qty) && q('').qtyInfo === 'kosong', 'kosong → tidak diketahui, bukan 1');
  const tidakAda = q(1, null); truthy(Number.isNaN(tidakAda.qty) && tidakAda.qtyInfo === 'tidak_ada', 'kolom tidak ada → tidak diketahui');
  truthy(Number.isNaN(q('-').qty) && q('-').qtyInfo === 'tidak_valid', 'teks → tidak valid');
  truthy(Number.isNaN(q(-1).qty) && q(-1).qtyInfo === 'tidak_valid', 'negatif → tidak valid');
  eq(q(0).qty, 0, 'nol eksplisit tetap 0'); eq(q(0).qtyInfo, 'ada');
  eq(q(2, 'Jumlah').qty, 2, 'format lama kolom "Jumlah" tetap didukung');
});
test('H2 parser retur TikTok: 3, kosong, teks, nol; nilai refund tidak diketahui bila jumlah tidak diketahui; kategori tetap', () => {
  const t = (qty) => returTiktok([{ qty }]).cases[0];
  eq(t(3).qty, 3); eq(t(3).amount, 150000); eq(t(3).cat, 'retur_barang');
  const kosong = t(''); truthy(Number.isNaN(kosong.qty) && Number.isNaN(kosong.amount), 'jumlah kosong → jumlah & nilai refund tidak diketahui');
  eq(kosong.qtyInfo, 'kosong'); eq(kosong.cat, 'retur_barang', 'kategori tidak bergantung pada jumlah');
  eq(t('x').qtyInfo, 'tidak_valid'); eq(t(0).qty, 0);
});
test('H3 refund 1 unit tetapi file retur 2 unit → konflik, kerugian tidak dihitung (tanpa hitung ganda), laba tidak final', () => {
  const r = E.compute([...filesKaos(-50000, 1), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  const c = r.cases[0];
  eq(c.unitStatus, 'konflik'); truthy(Number.isNaN(c.estModal), 'bukan min/maks, tidak dipaksakan');
  eq(r.lostCertain, 0); eq(r.kepastian.risikoBarang.kerugianTanpaNilai, 1); eq(r.totalModal, 20000, 'HPP penjualan tidak berubah (share lama)');
  eq(r.kepastian.laba.final, false); truthy(r.kepastian.laba.alasanTidakFinal.includes('kerugian_retur_tanpa_nilai'), 'alasan tercatat');
});
test('H4 refund 2 unit, barang hilang: 2 unit hanya bila file retur & export sama; satu sumber tetap dihitung tetapi bukan terverifikasi', () => {
  const ok = E.compute([...filesKaos(-100000, 2), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(ok.cases[0].unitStatus, 'terverifikasi'); eq(ok.lostCertain, 40000, 'parser lama membaca 1 unit = 20.000');
  const satu = E.compute([...filesKaos(-100000, 2, false), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(satu.cases[0].unitStatus, 'satu_sumber'); eq(satu.cases[0].unitSource, 'file_retur'); eq(satu.lostCertain, 40000);
  truthy(satu.kepastian.laba.alasanTidakFinal.includes('jumlah_retur_belum_terverifikasi'), 'satu sumber → tidak final');
  // Jumlah retur kosong, export menyebut 2 → pakai export (satu sumber).
  const ex = E.compute([...filesKaos(-100000, 2), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: '', amount: 100000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(ex.cases[0].unitSource, 'export'); eq(ex.lostCertain, 40000);
});
test('H5 refund nominal tanpa jumlah unit di mana pun → jumlah tidak ditebak dari nominal', () => {
  const r = E.compute([...filesKaos(-50000, 0, false), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: '', amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(r.cases[0].unitStatus, 'tidak_diketahui'); truthy(Number.isNaN(r.cases[0].units), 'bukan 1 dan bukan 50.000 ÷ harga');
  eq(r.cases[0].estReason, 'jumlah_tidak_diketahui'); eq(r.lostCertain, 0); eq(r.kepastian.risikoBarang.kerugianTanpaNilai, 1);
  // returnedQty 0 eksplisit tetapi file retur 1 → konflik (0 bukan bukti kompensasi).
  const nol = E.compute([...filesKaos(-50000, 0), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 1, amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(nol.cases[0].unitStatus, 'konflik');
});
test('H6 retur tanpa modal → kasus tanpa nilai bertambah, bukan risiko nol yang menyesatkan', () => {
  const r = E.compute([...filesKaos(-50000, 1), returShopee([{ order: 'SINT-K1', product: 'Kaos Edisi Lain', qty: 1, amount: 50000 }])], stUnit);
  eq(r.cases[0].state, 'belum'); eq(r.unknownRisk, 0); eq(r.kepastian.risikoBarang.risikoTanpaNilai, 1);
  eq(r.cases[0].estReason, 'modal_tidak_ditemukan'); eq(r.cases[0].unitStatus, 'tidak_cocok', 'produk tidak ditemukan di export pesanan itu');
});
test('H7 retur variasi tanpa modal sendiri → modal variasi lain TIDAK dipakai', () => {
  const st = ST([cat('Kaos', 'Merah', 20000)]);
  const files = [E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-V1', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }])),
    E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-V1', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' }])),
    returShopee([{ order: 'SINT-V1', product: 'Kaos', variant: 'Biru', qty: 1, amount: 50000 }])];
  const r = E.compute(files, st, { 'S|RT1|Kaos|Biru': 'hilang' });
  truthy(Number.isNaN(r.cases[0].estModal), 'cara lama memakai modal Merah 20.000'); eq(r.lostCertain, 0); eq(r.cases[0].unitStatus, 'terverifikasi');
  eq(r.kepastian.risikoBarang.kerugianTanpaNilai, 1);
});
test('H8 kasus retur sama di dua file dengan isi berbeda → hasil identik untuk dua urutan, ditandai konflik', () => {
  const a = returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 1, amount: 50000 }]), b = returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 50000 }]);
  const ab = E.compute([...filesKaos(-50000, 1), a, b], stUnit, { [ksKaos]: 'hilang' }), ba = E.compute([...filesKaos(-50000, 1), b, a], stUnit, { [ksKaos]: 'hilang' });
  const sig = (r) => JSON.stringify([r.lostCertain, r.unknownRisk, r.cases.map((c) => [c.qty, c.unitStatus, c.estModal]), r.kepastian]);
  eq(sig(ab), sig(ba)); eq(ab.cases[0].unitStatus, 'konflik'); eq(ab.lostCertain, 0);
});
test('H9 status HPP: estimasi 1 unit + refund → belum; reseller → harga_acuan estimasi; angka tidak berubah', () => {
  const o = [{ id: 'SINT-E', items: [{ name: 'Topi', harga: 50000, refund: -10000 }, { name: 'Kaos', harga: 50000 }] }];
  const unit = hitungFmt(o, [], ST([cat('Topi', '', 20000), cat('Kaos', '', 20000)]));
  eq(unit.shopeeQty.hpp.belum, 1); eq(unit.shopeeQty.hpp.estimasi, 1); eq(unit.totalModal, 20000 * 0.8 + 20000);
  const acuan = hitungFmt(o, [], { modalMode: 'acuan', mitra: 60, periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(acuan.shopeeQty.metodeHpp.harga_acuan, 2); eq(acuan.shopeeQty.hpp.estimasi, 1); eq(acuan.shopeeQty.hpp.belum, 1, 'baris dengan refund');
  eq(acuan.totalModal, 0.4 * 90000);
});
test('H10 kepastian: HPP per status = total modal; modal diketahui ≠ terverifikasi; laba tidak pernah final selama periode belum divalidasi', () => {
  const r = hitungFmt(satu, [[[bs]]], ST([cat('Kaos', 'M', 20000)]));
  const k = r.kepastian;
  eq(k.hpp.terverifikasi + k.hpp.estimasi + k.hpp.belum, r.totalModal); eq(k.hpp.terverifikasi, 20000); eq(r.coverage, 1);
  eq(k.laba.dariDataTersedia, r.totalMargin); eq(k.laba.final, false); eq(k.laba.alasanTidakFinal.join(), 'periode_belum_divalidasi');
  const rata = hitungFmt(satu, [[[bs]]], stRata);
  eq(rata.coverage, 1, 'modal "diketahui" 100%'); eq(rata.kepastian.hpp.terverifikasi, 0); eq(rata.kepastian.hpp.estimasi, 20000);
  truthy(rata.kepastian.laba.alasanTidakFinal.includes('hpp_estimasi'), 'estimasi tercatat sebagai alasan');
  const kosong = E.compute([E.parseWorkbook(Sint.penghasilan(satu))], ST([]));
  eq(kosong.kepastian.baris.tidak_diketahui, 1); truthy(kosong.kepastian.laba.alasanTidakFinal.includes('laba_belum_dapat_dihitung'), 'tanpa modal');
});
test('H11 regresi H2-A: angka data contoh tidak berubah; total HPP per status sama dengan total modal', () => {
  const r = E.compute(Demo.make().map((w) => E.parseWorkbook(w)), Demo.settings());
  const k = r.kepastian;
  truthy(Math.abs(k.hpp.terverifikasi + k.hpp.estimasi + k.hpp.belum - r.totalModal) < 1, 'jumlah HPP per status = totalModal');
  eq(k.laba.final, false);
});

/* ---------- H2-A patch P1–P5: nominal refund, ringkasan kategori, kepastian kerugian (data SINTETIS) ---------- */
/** File retur TikTok sintetis dengan kolom jumlah/harga yang bisa dihilangkan (null = kolom tidak ada). */
const ttFile = (rows, { withQty = true, withPrice = true } = {}) => {
  const cols = ['Return Order ID', 'Order ID', 'SKU ID', 'Product Name', 'SKU Name', ...(withQty ? ['Return Quantity'] : []), ...(withPrice ? ['Return unit price'] : []),
    'Refund Time', 'Return Type', 'Return Reason', 'Return Logistics Tracking ID', 'Buyer Note', 'Return Status', 'Time Requested'];
  return E.parseWorkbook({ name: 'tt.xlsx', sheets: { S: [cols, ...rows.map((x, i) => [x.id || `TR${i + 1}`, 'TT-O1', 'SKU1', 'Kaos', 'M', ...(withQty ? [x.qty] : []),
    ...(withPrice ? [x.price] : []), '2026-01-12', 'Return and refund', 'Damaged', 'RESI', '', 'Completed', '2026-01-10'])] } });
};
test('H12 TikTok: jumlah 0/kosong/tidak ada/1 dan harga kosong/tidak valid/nol eksplisit → nominal tidak pernah dipalsukan', () => {
  const c = (qty, price, opt) => ttFile([{ qty, price }], opt).cases[0];
  eq(c(1, 50000).amount, 50000); eq(c(1, 50000).amountSource, 'harga_satuan_x_jumlah');
  const nol = c(0, 50000); truthy(Number.isNaN(nol.amount), 'jumlah 0 bukan refund Rp0'); eq(nol.amountInfo, 'jumlah_nol'); eq(nol.cat, 'retur_barang');
  const kosong = c('', 50000); truthy(Number.isNaN(kosong.amount), 'jumlah kosong'); eq(kosong.amountInfo, 'jumlah_kosong');
  const tanpaKolom = c(undefined, 50000, { withQty: false }); truthy(Number.isNaN(tanpaKolom.amount), 'kolom jumlah tidak ada'); eq(tanpaKolom.amountInfo, 'jumlah_tidak_ada');
  const hargaKosong = c(1, ''); truthy(Number.isNaN(hargaKosong.amount), 'harga kosong bukan Rp0'); eq(hargaKosong.amountInfo, 'harga_kosong');
  const hargaTeks = c(1, 'gratis'); truthy(Number.isNaN(hargaTeks.amount), 'harga tidak valid'); eq(hargaTeks.amountInfo, 'harga_tidak_valid');
  eq(c(2, 0).amount, 0, 'harga 0 eksplisit tetap 0'); eq(c(2, 0).amountInfo, 'ada');
  eq(c(3, 50000).qty, 3, 'jumlah tidak diturunkan dari nominal'); eq(c(3, 50000).amount, 150000);
  // Mode reseller: nominal tidak diketahui → risiko tanpa nilai, bukan risiko Rp0.
  const r = E.compute([ttFile([{ qty: 0, price: 50000 }])], { modalMode: 'acuan', mitra: 60, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(r.unknownRisk, 0); eq(r.kepastian.risikoBarang.risikoTanpaNilai, 1);
});
test('H13 Shopee: nominal refund kosong/tidak valid → tidak diketahui; nol eksplisit tetap 0', () => {
  const amt = (amount) => returShopee([{ order: 'X', product: 'Kaos', qty: 1, amount }]).cases[0];
  truthy(Number.isNaN(amt('').amount) && amt('').amountInfo === 'kosong', 'kosong bukan Rp0');
  truthy(Number.isNaN(amt('-').amount) && amt('-').amountInfo === 'tidak_valid', 'teks');
  eq(amt(0).amount, 0); eq(amt(0).amountInfo, 'ada'); eq(amt(25000).amount, 25000); eq(amt(25000).amountSource, 'file_retur');
  const r = E.compute([returShopee([{ order: 'X', product: 'Kaos', qty: 1, amount: '' }])], { modalMode: 'acuan', mitra: 60, periods: [{ start: '', markup: 0, disc: 0 }] });
  truthy(Number.isNaN(r.cases[0].estModal), 'mode reseller tanpa nominal → perkiraan modal tidak diketahui'); eq(r.kepastian.risikoBarang.risikoTanpaNilai, 1);
});
test('H14 ringkasan kategori: campuran nilai diketahui & tidak diketahui → total tidak disajikan seolah lengkap', () => {
  const r = E.compute([ttFile([{ qty: 1, price: 50000 }, { qty: '', price: 50000 }, { qty: 2, price: 30000 }])], ST([]));
  const k = r.catSummary.find((x) => x.cat === 'retur_barang');
  eq(k.count, 3); eq(k.amountKnown, 110000); eq(k.amountUnknown, 1); truthy(Number.isNaN(k.amount), 'total kategori tidak diketahui');
  const lengkap = E.compute([ttFile([{ qty: 1, price: 50000 }])], ST([])).catSummary[0];
  eq(lengkap.amount, 50000); eq(lengkap.amountKnown, 50000); eq(lengkap.amountUnknown, 0);
});
test('H15 kepastian kerugian: 2 sumber cocok → terverifikasi; 1 sumber → sementara; konflik → tanpa nilai; reseller/modal rata-rata → sementara', () => {
  const sum = (r) => r.kepastian.risikoBarang.kerugianTerverifikasi + r.kepastian.risikoBarang.kerugianSementara;
  const dua = E.compute([...filesKaos(-100000, 2), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(dua.cases[0].lossCertainty, 'terverifikasi'); eq(dua.cases[0].lossBasis, 'modal_per_unit'); eq(dua.cases[0].modalSource, 'modal_per_unit:produk');
  eq(dua.kepastian.risikoBarang.kerugianTerverifikasi, 40000); eq(dua.kepastian.risikoBarang.kerugianSementara, 0); eq(sum(dua), dua.lostCertain);
  const satuSumber = E.compute([...filesKaos(-100000, 2, false), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(satuSumber.cases[0].lossCertainty, 'sementara'); eq(satuSumber.cases[0].lossReason, 'jumlah_satu_sumber'); eq(satuSumber.cases[0].unitSource, 'file_retur');
  eq(satuSumber.kepastian.risikoBarang.kerugianSementara, 40000); eq(sum(satuSumber), satuSumber.lostCertain);
  truthy(satuSumber.kepastian.laba.alasanTidakFinal.includes('kerugian_retur_sementara'), 'alasan eksplisit'); eq(satuSumber.kepastian.laba.final, false);
  const konflik = E.compute([...filesKaos(-50000, 1), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(konflik.cases[0].lossCertainty, 'tidak_diketahui'); eq(konflik.kepastian.risikoBarang.kerugianTerverifikasi, 0); eq(sum(konflik), konflik.lostCertain);
  for (const st of [stRata, { modalMode: 'acuan', mitra: 60, periods: [{ start: '', markup: 0, disc: 0 }] }]) {
    const r = E.compute([...filesKaos(-100000, 2), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000 }])], st, { [ksKaos]: 'hilang' });
    eq(r.cases[0].lossBasis, 'nilai_refund_x_rasio'); eq(r.cases[0].lossCertainty, 'sementara', 'estimasi bukan terverifikasi walau unit cocok');
    eq(r.kepastian.risikoBarang.kerugianTerverifikasi, 0); eq(sum(r), r.lostCertain); truthy(r.lostCertain > 0, 'angka lama tetap masuk laba');
  }
  // Modal tingkat produk untuk retur variasi → sementara.
  const prodLevel = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-V1', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }])),
    E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-V1', name: 'Kaos', variant: 'Biru', qty: 1, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' }])),
    returShopee([{ order: 'SINT-V1', product: 'Kaos', variant: 'Biru', qty: 1, amount: 50000 }])], ST([cat('Kaos', '', 20000)]), { 'S|RT1|Kaos|Biru': 'hilang' });
  eq(prodLevel.cases[0].lossCertainty, 'sementara'); eq(prodLevel.cases[0].lossReason, 'modal_tingkat_produk');
});
test('H16 KETERBATASAN (H2-B): hitung ganda tanpa export tetap mungkin → kerugian sementara, laba tidak final', () => {
  // Refund 50.000 (setara 1 unit) tetapi file retur menyebut 2 unit hilang; tanpa export tidak ada pembanding unit.
  // HPP terjual (estimasi 1 unit × porsi tidak direfund) 10.000 + kerugian 2 unit 40.000 = 50.000, padahal 2 kaos = 40.000.
  const r = E.compute([...filesKaos(-50000, 0, false), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(r.totalModal + r.lostCertain, 50000, 'beban total melebihi modal 2 kaos (hitung ganda terdokumentasi)');
  eq(r.cases[0].lossCertainty, 'sementara'); eq(r.kepastian.risikoBarang.kerugianTerverifikasi, 0);
  eq(r.kepastian.laba.final, false); truthy(r.kepastian.laba.alasanTidakFinal.includes('kerugian_retur_sementara'), 'alasan');
});

/* ---------- H2-B1: buku unit, modal per unit, Shopee dengan export (data SINTETIS) ---------- */
/** 1 pesanan 2 kaos @50.000; export format `fmt` ('baru' punya Returned quantity, 'lama' tidak). */
const filesB1 = (refund, returned, fmt = 'baru', variant = '') => [E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund }] }])),
  E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-K1', name: 'Kaos', variant, qty: 2, price: 50000, returned, returnStatus: refund ? 'Permintaan Disetujui' : '' }], fmt))];
const retKaos = (qty, variant = '') => returShopee([{ order: 'SINT-K1', product: 'Kaos', variant, qty, amount: 50000 * (Number(qty) || 1) }]);
const bu = (r) => r.kepastian.bukuUnit;

test('U1 2 unit tanpa refund → buku unit lengkap, HPP 2 unit, unit tidak diketahui 0', () => {
  const r = E.compute(filesB1(0, 0), stUnit);
  eq(r.totalModal, 40000); eq(bu(r).lengkap, 1); eq(bu(r).unitBelumDiketahui, 0); eq(bu(r).status.satu_sumber, 1, 'hanya returnedQty export (0)');
  eq(bu(r).invariantGagal, 0); eq(r.products[0].qty, 2);
});
test('U2 refund penuh 2 unit, unit terverifikasi 2 sumber → HPP 0; 2 unit kondisi fisik belum diketahui (risiko, bukan kerugian)', () => {
  const r = E.compute([...filesB1(-100000, 2), retKaos(2)], stUnit);
  eq(r.totalModal, 0); eq(bu(r).status.terverifikasi, 1); eq(bu(r).unitBelumDiketahui, 2); eq(bu(r).nilaiUnitBelumDiketahui, 40000);
  eq(r.lostCertain, 0); truthy(r.kepastian.laba.alasanTidakFinal.includes('kondisi_fisik_unit_refund_belum_diketahui'), 'alasan');
});
test('U3–U6 refund 1 dari 2 unit: HPP = 1 unit terjual; hilang/kembali/belum diketahui → satu perlakuan per unit', () => {
  const base = E.compute([...filesB1(-50000, 1), retKaos(1)], stUnit);
  eq(base.totalModal, 20000); eq(base.products[0].qty, 1);
  const hilang = E.compute([...filesB1(-50000, 1), retKaos(1)], stUnit, { [ksKaos]: 'hilang' });
  eq(hilang.totalModal, 20000); eq(hilang.lostCertain, 20000); eq(hilang.totalModal + hilang.lostCertain, 40000, '2 unit, masing-masing sekali');
  eq(bu(hilang).unitBelumDiketahui, 0);
  const kembali = E.compute([...filesB1(-50000, 1), retKaos(1)], stUnit, { [ksKaos]: 'kembali' });
  eq(kembali.totalModal, 20000); eq(kembali.lostCertain, 0); eq(bu(kembali).unitBelumDiketahui, 0);
  eq(bu(base).unitBelumDiketahui, 1, 'belum dicek → qtyUnknown'); eq(bu(base).nilaiUnitBelumDiketahui, 20000);
});
test('U7 export 1 unit vs file retur 2 unit → konflik → buku unit tidak dipakai (rumus lama), ditandai', () => {
  const r = E.compute([...filesB1(-50000, 1), retKaos(2)], stUnit, { [ksKaos]: 'hilang' });
  eq(bu(r).status.konflik, 1); eq(bu(r).lengkap, 0); eq(r.totalModal, 20000, 'rumus lama 2 × 20.000 × 0,5'); eq(r.lostCertain, 0, 'kerugian konflik tidak dihitung (H2-A)');
});
test('U8 hanya satu sumber (export) → buku unit dipakai dengan status satu_sumber', () => {
  const r = E.compute(filesB1(-50000, 1), stUnit);
  eq(bu(r).status.satu_sumber, 1); eq(bu(r).lengkap, 1); eq(r.totalModal, 20000); eq(bu(r).unitBelumDiketahui, 1);
  // returnedQty 0 + refund nominal (mis. kompensasi) → unit tetap terjual; nominal tidak mengurangi HPP.
  const komp = E.compute(filesB1(-10000, 0), stUnit);
  eq(komp.totalModal, 40000, 'cara lama 36.000'); eq(komp.products[0].qty, 2, 'bukan 1,8');
});
test('U9 jumlah refund kosong di semua sumber → tidak diketahui → rumus lama', () => {
  const r = E.compute([...filesB1(-50000, 0, 'lama'), retKaos('')], stUnit);
  eq(bu(r).status.tidak_diketahui, 1); eq(bu(r).lengkap, 0); eq(r.totalModal, 20000, 'rumus lama, ditandai');
});
test('U10 kasus retur variasi lain tidak dipakai untuk baris variasi ini', () => {
  const r = E.compute([...filesB1(-50000, 1, 'baru', 'Merah'), retKaos(2, 'Biru')], ST([cat('Kaos', 'Merah', 20000)]));
  eq(bu(r).status.satu_sumber, 1, 'hanya export; kasus Biru bukan pembanding'); eq(r.totalModal, 20000);
});
test('U11 dua urutan unggah → hasil dan buku unit identik', () => {
  const files = [...filesB1(-50000, 1), retKaos(1)];
  const a = E.compute(files, stUnit, { [ksKaos]: 'hilang' }), b = E.compute([...files].reverse(), stUnit, { [ksKaos]: 'hilang' });
  eq(JSON.stringify([a.totalModal, a.lostCertain, a.kepastian]), JSON.stringify([b.totalModal, b.lostCertain, b.kepastian]));
});
test('U12–U13 tanpa sumber unit: refund Rp0 TIDAK berarti 0 unit; refund positif tidak dijadikan unit', () => {
  const nol = E.compute(filesB1(0, 0, 'lama'), stUnit);
  eq(bu(nol).status.tidak_diketahui, 1, 'bukan qtyRefunded = 0'); eq(bu(nol).lengkap, 0); eq(nol.totalModal, 40000);
  const pos = E.compute(filesB1(-50000, 0, 'lama'), stUnit);
  eq(bu(pos).status.tidak_diketahui, 1); eq(pos.totalModal, 20000, 'rumus lama, bukan unit dari nominal');
  // Export menyebut 1 unit direfund, tetapi Laporan Penghasilan belum mencatat refund → tidak dipakai (laba tak dibesarkan).
  const beda = E.compute(filesB1(0, 1), stUnit);
  eq(bu(beda).lengkap, 0); eq(beda.totalModal, 40000);
});
test('U14 tabel produk: unit terjual bilangan bulat untuk baris buku unit', () => {
  const r = E.compute([...filesB1(-50000, 1), retKaos(1)], stUnit);
  eq(r.products[0].qty, 1); truthy(Number.isInteger(r.products[0].qty), 'bukan pecahan');
});
test('U15–U18 regresi: reseller, modal rata-rata, Shopee tanpa export tidak memakai buku unit', () => {
  const acuan = E.compute(filesB1(-50000, 1), { modalMode: 'acuan', mitra: 60, periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(acuan.totalModal, 0.4 * 50000, 'reseller: (harga + refund) × rasio, tidak berubah'); eq(bu(acuan).baris, 0);
  const rata = E.compute(filesB1(-50000, 1), stRata);
  eq(rata.totalModal, 0.4 * 50000, 'modal rata-rata tidak berubah'); eq(bu(rata).baris, 0);
  const tanpa = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund: -50000 }] }]))], stUnit);
  eq(tanpa.totalModal, 10000, 'tanpa export: estimasi 1 unit × 0,5 (cara lama)'); eq(bu(tanpa).baris, 0);
});

test('angka format Indonesia di CSV', () => {
  eq(E.num('Rp1.234.567'), 1234567); eq(E.num('-1.250'), -1250); eq(E.num('12,5'), 125); eq(E.num('/'), 0);
});
test('tanggal dd/mm/yyyy dan serial Excel', () => { eq(E.date('05/06/2026'), '2026-06-05'); eq(E.date(46023), '2026-01-01'); });

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
