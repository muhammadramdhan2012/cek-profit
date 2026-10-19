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
  eq(r.lostCertain, 0); eq(r.kepastian.risikoBarang.kerugianTanpaNilai, 1);
  // H2-B3b: refund parsial tanpa unit yang bisa dipastikan → HPP tidak diketahui (bukan share lama 20.000), pesanan keluar dari laba.
  eq(r.totalModal, 0); eq(ck(r).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1); truthy(r.kepastian.laba.alasanTidakFinal.includes('refund_parsial_unit_tidak_diketahui'), 'alasan refund parsial');
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
  // H2-B3b: Topi direfund parsial tanpa bukti unit → HPP tidak diketahui → seluruh pesanan keluar dari laba (bukan 20.000 × 0,8).
  eq(unit.shopeeQty.hpp.tidak_diketahui, 1); eq(unit.shopeeQty.hpp.estimasi, 1); eq(unit.totalModal, 0); eq(unit.coverage, 0);
  const acuan = hitungFmt(o, [], { modalMode: 'acuan', mitra: 60, periods: [{ start: '', markup: 0, disc: 0 }] });
  // H2-B3b: reseller juga tidak memotong harga acuan menurut nominal refund parsial.
  eq(acuan.shopeeQty.metodeHpp.harga_acuan, 1); eq(acuan.shopeeQty.hpp.estimasi, 1); eq(acuan.shopeeQty.hpp.tidak_diketahui, 1, 'baris refund parsial');
  eq(acuan.totalModal, 0); eq(ck(acuan).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
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
  // Sebelum H2-B3b: HPP terjual (1 unit × porsi nominal) 10.000 + kerugian 2 unit 40.000 = 50.000 > modal 2 kaos.
  // H2-B3b: refund parsial tanpa bukti unit → HPP penjualan tidak diketahui (pesanan keluar dari laba), sehingga beban
  // yang tersisa hanya kerugian barang 40.000 = modal 2 kaos. Hitung ganda yang terdokumentasi tidak terjadi lagi.
  const r = E.compute([...filesKaos(-50000, 0, false), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 50000 }])], stUnit, { [ksKaos]: 'hilang' });
  eq(r.totalModal, 0, 'HPP refund parsial tidak dihitung menurut nominal'); eq(r.totalModal + r.lostCertain, 40000, 'tidak melebihi modal 2 kaos');
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
  eq(bu(r).status.konflik, 1); eq(bu(r).lengkap, 0); eq(r.lostCertain, 0, 'kerugian konflik tidak dihitung (H2-A)');
  // H2-B3b: sumber unit berbeda → unit refund tidak diketahui → HPP tidak diketahui, bukan 2 × 20.000 × 0,5.
  eq(r.totalModal, 0); eq(ck(r).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
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
  eq(bu(r).status.tidak_diketahui, 1); eq(bu(r).lengkap, 0);
  eq(r.totalModal, 0, 'H2-B3b: HPP tidak diketahui, bukan rumus lama'); eq(ck(r).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
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
  eq(bu(pos).status.tidak_diketahui, 1); eq(pos.totalModal, 0, 'H2-B3b: nominal tidak menentukan HPP'); eq(ck(pos).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
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
  // H2-B3b: reseller dan modal rata-rata juga tidak memakai nilai setelah refund parsial → HPP tidak diketahui.
  eq(acuan.totalModal, 0, 'reseller: bukan (harga + refund) × rasio'); eq(bu(acuan).baris, 0); eq(ck(acuan).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
  const rata = E.compute(filesB1(-50000, 1), stRata);
  eq(rata.totalModal, 0, 'modal rata-rata: bukan persen dari nilai setelah refund parsial'); eq(bu(rata).baris, 0);
  const tanpa = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund: -50000 }] }]))], stUnit);
  eq(tanpa.totalModal, 0, 'H2-B3b: tanpa export dan refund parsial → tidak diketahui, bukan 1 unit × 0,5'); eq(bu(tanpa).baris, 0);
});

/* ===== H2-B3a: kepastian.cakupan + refund penuh tanpa catatan fisik (metadata; angka tidak berubah) ===== */
/** Laporan penghasilan TikTok SINTETIS (struktur kolom saja; semua isi fiktif). */
const ttPenghasilan = (rows) => E.parseWorkbook({ name: 'tt-penghasilan-sintetis.xlsx', sheets: {
  'Detail pesanan': [['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Detail produk terjual', 'Sumber pesanan'],
  ...rows.map((x) => [x.id, 'Pesanan', '2026/01/10', '2026/01/15', x.settle, x.sales, x.sub, x.refund || 0, x.settle - x.sales, x.detail || '', 'TikTok Shop'])],
  Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.reduce((a, x) => a + x.settle, 0)]] } });
/** File retur TikTok SINTETIS dengan nomor pesanan & SKU yang bisa diatur. reason 'missing' → tidak dikirim. */
const ttRetur = (rows) => E.parseWorkbook({ name: 'tt-retur-sintetis.xlsx', sheets: { S: [['Return Order ID', 'Order ID', 'SKU ID', 'Product Name', 'SKU Name',
  'Return Quantity', 'Return unit price', 'Refund Time', 'Return Type', 'Return Reason', 'Return Logistics Tracking ID', 'Buyer Note', 'Return Status', 'Time Requested'],
...rows.map((x, i) => [x.id || `TRC${i + 1}`, x.order, x.sku, 'Kaos', 'M', x.qty, 50000, x.refundTime ?? '2026-01-12', x.type || 'Refund only', x.reason || 'Damaged', '', '', 'Completed', '2026-01-10'])] } });
function ck(r) { return r.kepastian.cakupan; }   // deklarasi fungsi (ter-hoist) agar bisa dipakai uji H2-A/H2-B1 di atas
const rtf = (r, pf) => (pf ? ck(r).refundTanpaCatatanFisik.perMarketplace[pf] : ck(r).refundTanpaCatatanFisik);
const STATUS_CK = ['terverifikasi', 'estimasi', 'estimasiMinimum', 'belum', 'tidakDiketahui'];
/** Rekonsiliasi wajib: tiap pesanan tepat satu status; jumlah status = total = totalSales (toleransi Rp1). */
const cekRekonsiliasi = (r, label = '') => {
  const c = ck(r), sum = (o) => STATUS_CK.reduce((a, k) => a + o[k], 0);
  near(sum(c.penjualan), c.penjualan.total, 1, `${label} jumlah status ≠ total`);
  near(c.penjualan.total, r.totalSales, 1, `${label} total cakupan ≠ totalSales`);
  near(c.penjualan.tidakDiketahui, r.totalSales - r.knownSales, 1, `${label} tidak diketahui ≠ penjualan tanpa modal`);
  near(c.dikeluarkan.penjualan, c.penjualan.tidakDiketahui, 1, `${label} dikeluarkan ≠ tidak diketahui`);
  eq(c.dikeluarkan.jumlahPesanan, c.jumlahPesanan.tidakDiketahui, `${label} jumlah pesanan dikeluarkan`);
  near(c.labaTerhitung.dasarPenjualan, r.knownSales, 1, `${label} dasar laba`);
  truthy(Object.is(c.labaTerhitung.nilai, r.totalMargin) || c.labaTerhitung.nilai === r.totalMargin, `${label} laba terhitung ≠ totalMargin`);
  for (const k of [...STATUS_CK, 'total']) near(c.perMarketplace.shopee.penjualan[k] + c.perMarketplace.tiktok.penjualan[k], c.penjualan[k], 1, `${label} breakdown ${k}`);
};
const kaos1 = (id, harga, refund = 0) => ({ id, items: [{ name: 'Kaos', harga, refund }] });

test('C1 semua transaksi terverifikasi → cakupan terverifikasi = total, tidak ada yang dikeluarkan', () => {
  const r = hitung([kaos1('SINT-C1', 100000)], [{ order: 'SINT-C1', name: 'Kaos', qty: 2, price: 50000 }], stUnit);
  eq(r.shopeeQty.hpp.terverifikasi, 1, 'prasyarat: baris terverifikasi');
  cekRekonsiliasi(r, 'C1');
  eq(ck(r).penjualan.terverifikasi, 100000); eq(ck(r).jumlahPesanan.terverifikasi, 1);
  eq(ck(r).dikeluarkan.jumlahPesanan, 0); eq(rtf(r).jumlahPesanan, 0); eq(ck(r).dasar, 'penjualan_bersih_per_pesanan');
});
test('C2 HPP estimasi (modal rata-rata) → estimasi; angka HPP tetap', () => {
  const r = hitung([kaos1('SINT-C2', 100000)], [{ order: 'SINT-C2', name: 'Kaos', qty: 2, price: 50000 }], stRata);
  cekRekonsiliasi(r, 'C2'); eq(ck(r).penjualan.estimasi, 100000); eq(r.totalModal, 40000);
});
test('C3 Shopee tanpa export (anggap 1 unit) → estimasiMinimum; rumus HPP dan metadata lama tidak berubah', () => {
  const r = hitung([kaos1('SINT-C3', 100000)], null, stUnit);
  cekRekonsiliasi(r, 'C3');
  eq(ck(r).penjualan.estimasiMinimum, 100000); eq(ck(r).penjualan.estimasi, 0);
  eq(r.totalModal, 20000, 'tetap 1 unit'); eq(r.kepastian.penjualan.estimasi, 100000, 'kepastian.penjualan lama tetap "estimasi"');
  // H2-B3b: refund parsial tanpa export → HPP tidak diketahui; pesanan dikeluarkan dengan alasan refund parsial.
  const p = hitung([kaos1('SINT-C3b', 100000, -40000)], null, stUnit);
  cekRekonsiliasi(p, 'C3b'); eq(ck(p).penjualan.tidakDiketahui, 60000); eq(ck(p).penjualan.belum, 0); eq(ck(p).penjualan.estimasiMinimum, 0);
  eq(ck(p).dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1); eq(ck(p).dikeluarkan.refundParsial.jumlahPesanan, 1); eq(ck(p).dikeluarkan.refundParsial.penjualan, 60000);
  eq(ck(p).refundParsialTanpaUnit.jumlahPesanan, 0, 'tidak ada lagi laba yang memakai porsi nominal'); eq(p.totalModal, 0);
});
test('C4 modal tidak diketahui → tidakDiketahui, dikeluarkan beserta alasan (modal kosong, A1)', () => {
  const r = hitung([kaos1('SINT-C4', 100000)], null, ST([]));
  cekRekonsiliasi(r, 'C4');
  eq(ck(r).penjualan.tidakDiketahui, 100000); eq(ck(r).dikeluarkan.danaDiterima, 100000); eq(ck(r).dikeluarkan.alasan.modal_belum_diisi, 1);
  truthy(Number.isNaN(ck(r).labaTerhitung.nilai), 'laba belum dapat dihitung → NaN, bukan 0');
  // A1: pesanan ada di export tetapi baris tidak cocok.
  const a1 = hitung([kaos1('SINT-C4b', 100000)], [{ order: 'SINT-C4b', name: 'Celana', qty: 1, price: 100000 }], stUnit);
  cekRekonsiliasi(a1, 'C4b'); eq(ck(a1).dikeluarkan.alasan.kuantitas_tidak_diketahui, 1);
});
test('C5 refund penuh dengan tanda seller (Shopee & TikTok) → tidak masuk exposure; angka tetap', () => {
  const kembali = E.compute([...filesB1(-100000, 2), retKaos(2)], stUnit, { 'S|RT1|Kaos|': 'kembali' });
  eq(rtf(kembali).jumlahPesanan, 0); eq(kembali.totalModal, 0);
  // TikTok: setiap SKU di detail punya kasus retur barang yang sudah ditandai seller.
  const tt = E.compute([ttPenghasilan([{ id: '5801', settle: 0, sales: 0, sub: 100000, refund: -100000, detail: '1234567 * 2;' }]),
    ttRetur([{ id: 'TRK', order: '5801', sku: '1234567', qty: 2, type: 'Return and refund' }])], ST([cat('', '', 20000, '1234567')]), { 'T|TRK|1234567': 'kembali' });
  eq(tt.cases[0].cat, 'retur_barang', 'prasyarat kategori'); eq(rtf(tt, 'tiktok').jumlahPesanan, 0);
  eq(rtf(tt, 'tiktok').kondisiDiketahui.sumberKondisi.tanda_seller, 1);
});
test('C6 refund penuh tanpa kondisi fisik → exposure dicatat (bukan kerugian); laba, kerugian, dan risiko lama tetap', () => {
  const r = E.compute(filesB1(-100000, 2), stUnit);
  const x = rtf(r, 'shopee');
  eq(x.jumlahPesanan, 1); eq(x.jumlahUnitDiketahui, 2); eq(x.nilaiModalDiketahui, 40000); eq(x.kasusModalTidakDiketahui, 0);
  eq(x.sumberQty.export, 1); eq(x.kondisi.tanpa_kasus_retur, 1); eq(x.tumpangTindih.bukuUnit, bu(r).lengkap);
  eq(r.totalModal, 0); eq(r.lostCertain, 0); eq(r.unknownRisk, 0, 'exposure tidak masuk risiko lama');
  // Ada kasus retur yang belum dicek → kondisi "kasus_belum_dicek", ditandai tumpang tindih dengan risiko kasus lama.
  const b = E.compute([...filesB1(-100000, 2), retKaos(2)], stUnit);
  eq(rtf(b).kondisi.kasus_belum_dicek, 1); eq(rtf(b).tumpangTindih.risikoKasusBelumDicek, 1);
  // TikTok: unit dari "Detail produk terjual", modal dari daftar modal.
  const tt = E.compute([ttPenghasilan([{ id: '5802', settle: -5000, sales: 0, sub: 100000, refund: -100000, detail: '1234567 * 2;' }])], ST([cat('', '', 20000, '1234567')]));
  const t = rtf(tt, 'tiktok');
  eq(t.jumlahPesanan, 1); eq(t.jumlahUnitDiketahui, 2); eq(t.nilaiModalDiketahui, 40000); eq(t.sumberQty.detail_produk, 1);
  eq(tt.totalModal, 0, 'HPP penjualan refund penuh tetap 0');
  // Kasus "batal" (pengajuan dibatalkan/ditolak) tidak menjelaskan nasib barang.
  const bt = E.compute([ttPenghasilan([{ id: '5802', settle: -5000, sales: 0, sub: 100000, refund: -100000, detail: '1234567 * 2;' }]),
    ttRetur([{ order: '5802', sku: '1234567', qty: 2, refundTime: '' }])], ST([cat('', '', 20000, '1234567')]));
  eq(bt.cases[0].cat, 'batal', 'prasyarat kategori'); eq(rtf(bt, 'tiktok').kondisi.kasus_tidak_menjelaskan, 1);
});
test('C7 refund penuh tanpa modal / tanpa jumlah unit → kasus modal tidak diketahui (tidak dianggap 0)', () => {
  const r = hitung([kaos1('SINT-C7', 100000, -100000)], null, ST([]));
  const x = rtf(r, 'shopee');
  eq(x.jumlahPesanan, 1); eq(x.kasusModalTidakDiketahui, 1); eq(x.transaksiUnitTidakDiketahui, 1); eq(x.nilaiModalDiketahui, 0);
  eq(x.sumberQty.tidak_diketahui, 1, 'tanpa export: anggapan 1 unit tidak dihitung sebagai unit diketahui');
  // Modal ada tetapi unit tidak diketahui (tanpa export) → tetap tidak diketahui.
  const m1 = hitung([kaos1('SINT-C7b', 100000, -100000)], null, stUnit);
  eq(rtf(m1).kasusModalTidakDiketahui, 1); eq(rtf(m1).jumlahUnitDiketahui, 0);
  // Mode reseller/modal rata-rata tidak punya modal per unit → tidak diketahui, bukan nominal × rasio.
  const ac = E.compute(filesB1(-100000, 2), { modalMode: 'acuan', mitra: 30, periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(rtf(ac).kasusModalTidakDiketahui, 1); eq(rtf(ac).jumlahUnitDiketahui, 0, 'reseller: catatan baris tidak memuat jumlah');
});
test('C8 dana diterima NEGATIF pada transaksi yang dikeluarkan dicatat apa adanya', () => {
  const r = E.compute([ttPenghasilan([
    { id: '5803', settle: -15000, sales: 0, sub: 50000, refund: -50000 },   // refund penuh, potongan tetap → dana negatif
    { id: '5804', settle: 40000, sales: 50000, sub: 50000 }])], ST([]));
  cekRekonsiliasi(r, 'C8');
  const d = ck(r).perMarketplace.tiktok.dikeluarkan;
  eq(d.jumlahPesanan, 2); eq(d.danaDiterima, 25000, 'negatif tidak dibulatkan ke 0'); eq(d.alasan.tanpa_rincian_produk, 2);
  const neg = E.compute([ttPenghasilan([{ id: '5803', settle: -15000, sales: 0, sub: 50000, refund: -50000 }])], ST([]));
  eq(ck(neg).dikeluarkan.danaDiterima, -15000);
});
test('C9 tidak ada double counting: tiap pesanan satu status, jumlah status = total di semua mode', () => {
  const files = [E.parseWorkbook(Sint.penghasilan([kaos1('SINT-M1', 100000), kaos1('SINT-M2', 80000), kaos1('SINT-M3', 60000, -60000),
    { id: 'SINT-M4', items: [{ name: 'Kaos', harga: 50000 }, { name: 'Topi', harga: 30000, refund: -10000 }] }])),
  E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-M1', name: 'Kaos', qty: 2, price: 50000 }])),
  ttPenghasilan([{ id: '5810', settle: 40000, sales: 50000, sub: 50000, detail: '1234567 * 1;' },
    { id: '5811', settle: 20000, sales: 30000, sub: 60000, refund: -30000, detail: '1234567 * 2;' },
    { id: '5812', settle: -5000, sales: 0, sub: 50000, refund: -50000 },
    { id: '5813', settle: 30000, sales: 40000, sub: 40000 }])];
  const modes = [ST([cat('Kaos', '', 20000), cat('', '', 15000, '1234567')]), ST([]), stRata, ST([cat('Kaos', '', 20000)], { fallbackPct: 30 }),
    { modalMode: 'acuan', mitra: 30, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }] }, { modalMode: 'acuan', periods: [{ start: '', markup: 0, disc: 0 }] }];
  for (const [i, s] of modes.entries()) {
    const r = E.compute(files, s);
    cekRekonsiliasi(r, `mode ${i}`);
    eq(STATUS_CK.reduce((a, k) => a + ck(r).jumlahPesanan[k], 0), 4 + 4, `mode ${i}: setiap pesanan tepat sekali`);
  }
  // H2-B3b: refund parsial TikTok (5811) tanpa bukti unit → tidak diketahui (dikeluarkan), bukan persen dari nilai setelah refund.
  const rata = E.compute(files, stRata);
  eq(ck(rata).perMarketplace.tiktok.refundParsialTanpaUnit.jumlahPesanan, 0);
  eq(ck(rata).perMarketplace.tiktok.penjualan.tidakDiketahui, 30000); eq(ck(rata).perMarketplace.tiktok.dikeluarkan.alasan['refund_parsial_unit_tidak_diketahui'], 1);
  const lama = E.compute(files, stRata, {}, { platforms: ['tiktok'] }).kepastian.penjualan;
  eq(lama.estimasi, 90000, 'kepastian.penjualan: 5811 pindah ke tidak_diketahui'); eq(lama.tidak_diketahui, 30000); eq(lama.belum, 0);
});
test('C10 breakdown Shopee + TikTok = total; filter platform hanya mengisi platform itu', () => {
  const files = [E.parseWorkbook(Sint.penghasilan([kaos1('SINT-B1', 100000, -100000), kaos1('SINT-B2', 70000)])),
    ttPenghasilan([{ id: '5820', settle: -3000, sales: 0, sub: 50000, refund: -50000, detail: '1234567 * 1;' }, { id: '5821', settle: 40000, sales: 50000, sub: 50000 }])];
  const r = E.compute(files, ST([cat('Kaos', '', 20000)]));
  const c = ck(r), s = c.perMarketplace.shopee, t = c.perMarketplace.tiktok;
  cekRekonsiliasi(r, 'C10');
  near(s.dikeluarkan.danaDiterima + t.dikeluarkan.danaDiterima, c.dikeluarkan.danaDiterima, 1e-9);
  eq(s.dikeluarkan.jumlahPesanan + t.dikeluarkan.jumlahPesanan, c.dikeluarkan.jumlahPesanan);
  const f = c.refundTanpaCatatanFisik, fs_ = f.perMarketplace;
  for (const k of ['jumlahPesanan', 'jumlahTransaksi', 'jumlahUnitDiketahui', 'nilaiModalDiketahui', 'kasusModalTidakDiketahui', 'transaksiUnitTidakDiketahui'])
    eq(fs_.shopee[k] + fs_.tiktok[k], f[k], `refund fisik ${k}`);
  eq(fs_.shopee.jumlahPesanan, 1); eq(fs_.tiktok.jumlahPesanan, 1);
  const hanyaShopee = E.compute(files, ST([cat('Kaos', '', 20000)]), {}, { platforms: ['shopee'] });
  cekRekonsiliasi(hanyaShopee, 'C10 filter'); eq(ck(hanyaShopee).perMarketplace.tiktok.penjualan.total, 0); eq(rtf(hanyaShopee, 'tiktok').jumlahPesanan, 0);
});
test('C11 dua urutan unggah → cakupan identik', () => {
  const a = [E.parseWorkbook(Sint.penghasilan([kaos1('SINT-K1', 100000, -100000), kaos1('SINT-U2', 50000)])), retKaos(2),
    E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-K1', name: 'Kaos', qty: 2, price: 50000, returned: 2, returnStatus: 'Permintaan Disetujui' }])),
    ttPenghasilan([{ id: '5830', settle: -2000, sales: 0, sub: 40000, refund: -40000, detail: '1234567 * 1;' }])];
  for (const s of [stUnit, stRata, ST([])]) {
    const x = E.compute(a, s), y = E.compute([...a].reverse(), s);
    eq(JSON.stringify(ck(x)), JSON.stringify(ck(y)), 'cakupan bergantung urutan unggah');
  }
});

const kaosDuaVariasiRefund = () => [E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-V1', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }, { name: 'Kaos', harga: 60000, refund: -60000 }] }])),
  E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-V1', name: 'Kaos', variant: 'M', qty: 1, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' },
    { order: 'SINT-V1', name: 'Kaos', variant: 'L', qty: 1, price: 60000, returned: 1, returnStatus: 'Permintaan Disetujui' }]))];
test('C12 kategori teks "tidak dikirim" tanpa tanda seller → kondisi fisik tetap belum diketahui; indikasi tercatat', () => {
  const r = E.compute([...filesB1(-100000, 2), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 2, amount: 100000, solusi: 'Pengembalian Dana', alasan: 'Barang tidak lengkap' }])], stUnit);
  eq(r.cases[0].cat, 'tidak_dikirim', 'prasyarat kategori');
  const x = rtf(r, 'shopee');
  eq(x.jumlahPesanan, 1); eq(x.kondisi.kasus_tidak_menjelaskan, 1); eq(x.indikasi.tidak_dikirim, 1);
  eq(x.kondisiDiketahui.jumlahTransaksi, 0); eq(rtf(r).kondisiFisikStatus, 'belum_diketahui');
  eq(r.totalModal, 0); eq(r.lostCertain, 0, 'indikasi bukan kerugian');
  const tt = E.compute([ttPenghasilan([{ id: '5805', settle: 0, sales: 0, sub: 100000, refund: -100000, detail: '1234567 * 2;' }]),
    ttRetur([{ order: '5805', sku: '1234567', qty: 2, reason: 'Item missing' }])], ST([cat('', '', 20000, '1234567')]));
  eq(tt.cases[0].cat, 'tidak_dikirim'); eq(rtf(tt, 'tiktok').jumlahPesanan, 1); eq(rtf(tt, 'tiktok').indikasi.tidak_dikirim, 1);
});
test('C13 seller menandai "kembali" → kondisi fisik diketahui (sumber: tanda seller)', () => {
  const r = E.compute([...filesB1(-100000, 2), retKaos(2)], stUnit, { 'S|RT1|Kaos|': 'kembali' });
  eq(rtf(r).jumlahTransaksi, 0); eq(rtf(r, 'shopee').kondisiDiketahui.jumlahTransaksi, 1); eq(rtf(r, 'shopee').kondisiDiketahui.sumberKondisi.tanda_seller, 1);
  eq(r.lostCertain, 0);
});
test('C14 seller menandai "hilang" → kondisi fisik diketahui; kerugian lama tetap dari alur retur', () => {
  const r = E.compute([...filesB1(-100000, 2), retKaos(2)], stUnit, { 'S|RT1|Kaos|': 'hilang' });
  eq(rtf(r).jumlahTransaksi, 0); eq(rtf(r, 'shopee').kondisiDiketahui.sumberKondisi.tanda_seller, 1);
  eq(r.lostCertain, 40000, 'kerugian = modal 2 unit, tidak berubah oleh metadata');
});
test('C15 dua variasi produk sama, kasus retur hanya menyebut nama → ambigu, tidak memilih variasi', () => {
  const r = E.compute([...kaosDuaVariasiRefund(), returShopee([{ order: 'SINT-V1', product: 'Kaos', qty: 1, amount: 50000 }])],
    ST([cat('Kaos', 'M', 20000), cat('Kaos', 'L', 25000)]), { 'S|RT1|Kaos|': 'kembali' });
  const x = rtf(r, 'shopee');
  eq(x.jumlahTransaksi, 2, 'kedua baris tetap exposure'); eq(x.kondisi.retur_item_ambigu, 2); eq(x.kondisiDiketahui.jumlahTransaksi, 0);
  eq(x.jumlahPesanan, 1);
  // Satu baris laporan tetapi export punya dua variasi bernama sama → tetap ambigu.
  const satuBaris = E.compute([E.parseWorkbook(Sint.penghasilan([kaos1('SINT-V2', 50000, -50000)])),
    E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-V2', name: 'Kaos', variant: 'M', qty: 1, price: 50000 }, { order: 'SINT-V2', name: 'Kaos', variant: 'L', qty: 1, price: 50000 }])),
    returShopee([{ order: 'SINT-V2', product: 'Kaos', qty: 1, amount: 50000 }])], stUnit, { 'S|RT1|Kaos|': 'kembali' });
  eq(rtf(satuBaris).kondisi.retur_item_ambigu, 1);
});
test('C16 pesanan + produk dengan kandidat tunggal → pencocokan retur tetap bekerja', () => {
  const r = E.compute([...filesB1(-100000, 2, 'baru', 'M'), retKaos(2, 'M')], ST([cat('Kaos', 'M', 20000)]), { 'S|RT1|Kaos|M': 'kembali' });
  eq(rtf(r).jumlahTransaksi, 0); eq(rtf(r, 'shopee').kondisiDiketahui.jumlahTransaksi, 1);
  // Produk lain di pesanan yang sama tidak membuat pencocokan ambigu.
  const dua = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund: -100000 }, { name: 'Topi', harga: 30000 }] }])),
    E.parseWorkbook(Sint.exportPesanan([{ order: 'SINT-K1', name: 'Kaos', qty: 2, price: 50000, returned: 2, returnStatus: 'Permintaan Disetujui' }, { order: 'SINT-K1', name: 'Topi', qty: 1, price: 30000 }])),
    retKaos(2)], ST([cat('Kaos', '', 20000), cat('Topi', '', 10000)]), { 'S|RT1|Kaos|': 'kembali' });
  eq(rtf(dua).jumlahTransaksi, 0); eq(rtf(dua, 'shopee').kondisiDiketahui.jumlahTransaksi, 1);
});

/* ===== Temuan otomatis (insights): nilai yang tidak diketahui tidak menghasilkan NaN; "margin" hanya persen ===== */
const insRefund = (amounts) => {
  const inc = E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-I1', items: [{ name: 'Kaos', harga: 100000, refund: -100000 }] }, { id: 'SINT-I2', items: [{ name: 'Topi', harga: 400000 }] }]));
  const r = E.compute([inc, returShopee(amounts.map((amount, i) => ({ id: `RI${i}`, order: 'SINT-I1', product: 'Kaos', qty: 1, amount })))], stRata);
  return { r, ins: r.insights.find((i) => /^Retur & refund/.test(i.title)) };
};
const insTeks = (r) => r.insights.map((i) => `${i.title} ${i.detail} ${i.action}`).join(' | ');
test('I1 insight refund, semua nominal diketahui → persentase & total seperti sebelumnya', () => {
  const { r, ins } = insRefund([100000]);
  truthy(ins, 'insight ada'); eq(ins.title, 'Retur & refund 25,0% dari penjualan', 'sama dengan cara lama: 100.000 ÷ 400.000'); eq(ins.detail.startsWith('1 kasus senilai Rp100.000.'), true, ins.detail);
  truthy(!/NaN|Infinity/.test(insTeks(r)), 'tanpa NaN/Infinity');
});
test('I2 insight refund campuran diketahui + tidak diketahui → tanpa persentase, kasus tanpa nilai disebut', () => {
  const { r, ins } = insRefund([100000, '']);
  eq(ins.title, 'Retur & refund senilai Rp100.000 dari kasus yang memiliki nilai');
  truthy(ins.detail.includes('1 kasus senilai Rp100.000, ditambah 1 kasus yang nilainya belum diketahui.'), ins.detail);
  truthy(!/%/.test(ins.title), 'tidak ada persentase dari total yang tidak lengkap'); eq(ins.level, 'info');
  truthy(!/NaN|Infinity/.test(insTeks(r)), 'tanpa NaN/Infinity');
});
test('I3 insight refund, semua nominal tidak diketahui → "nilainya belum diketahui", bukan Rp0', () => {
  const { r, ins } = insRefund(['', '']);
  eq(ins.title, 'Retur & refund: 2 kasus, nilainya belum diketahui');
  truthy(!/Rp0|NaN|Infinity/.test(`${ins.title} ${ins.detail}`), ins.detail);
  truthy(!/NaN|Infinity/.test(insTeks(r)), 'tanpa NaN/Infinity');
});
test('I4–I5 seluruh insight data contoh & variasi mode tanpa NaN/Infinity', () => {
  for (const s of [st, ST([]), stRata, { modalMode: 'acuan', mitra: 30, periods: [{ start: '', markup: 0, disc: 0 }] }]) {
    const t = insTeks(E.compute(parsed, s)); truthy(!/NaN|Infinity/.test(t), t.slice(0, 200));
  }
});
test('I6 insight bulan dengan laba tertinggi tidak memakai "Margin Rp"; nilainya tetap', () => {
  const ins = r.insights.find((i) => /^Laba tertinggi di /.test(i.title));
  truthy(ins, 'insight bulan ada');
  const ms = r.months.filter((x) => x.total.sales > 0), best = ms.reduce((a, x) => (x.total.margin > a.total.margin ? x : a));
  truthy(ins.detail.startsWith(`Laba setelah modal ${best.total.margin < 0 ? '−' : ''}Rp${Math.abs(Math.round(best.total.margin)).toLocaleString('id-ID')}`), ins.detail);
  truthy(!/Margin\s*−?Rp/.test(insTeks(r)), 'masih ada "Margin Rp"');
});

test('I7 insight biaya operasional memakai istilah laba (level, skor, dan nilai tetap)', () => {
  const insOpex = (amount) => E.compute(parsed, { ...st, fixedCosts: [{ label: 'Gaji', amount }] }).insights.find((i) => i.score === 92);
  const untung = insOpex(100000), rugi = insOpex(1e9);
  eq(untung.title, 'Laba menutup biaya operasional'); eq(untung.level, 'good');
  eq(rugi.title, 'Laba belum menutup biaya operasional'); eq(rugi.level, 'bad');
  truthy(/^Butuh tambahan laba −?Rp/.test(rugi.action), rugi.action);
  for (const i of [untung, rugi]) truthy(!/Margin|margin\s*−?Rp|Laba bersih/.test(`${i.title} ${i.detail} ${i.action}`), `${i.title} ${i.detail} ${i.action}`);
  truthy(untung.detail.includes('Laba dari data tersedia periode ini'), untung.detail);
});

test('angka format Indonesia di CSV', () => {
  eq(E.num('Rp1.234.567'), 1234567); eq(E.num('-1.250'), -1250); eq(E.num('12,5'), 125); eq(E.num('/'), 0);
});
/* ===== H2-B3b: refund parsial — nominal refund TIDAK menentukan unit/HPP (data SINTETIS) =====
 * Definisi: refund parsial = ada refund dan sisa nilai pesanan > 0. HPP baris itu = modal × unit terjual bersih,
 * HANYA bila unit yang direfund terbukti dari field jumlah (export/file retur). Tanpa bukti → HPP tidak diketahui:
 * pesanan keluar dari laba (alasan refund_parsial_unit_tidak_diketahui), bukan pro-rata, bukan 1 unit, bukan 0. */
const RP = 'refund_parsial_unit_tidak_diketahui';
const SKU = '1234567', stTT = ST([cat('', '', 20000, SKU)]);
/** Pesanan TikTok 2 unit @50.000; refund = nominal refund (negatif). */
const ttOrder = (id, refund, detail = `${SKU} * 2;`) => ({ id, settle: 100000 + refund - 10000, sales: 100000 + refund, sub: 100000, refund, detail });
const normalTT = { id: '5999', settle: 90000, sales: 100000, sub: 100000, detail: `${SKU} * 2;` };
test('B3b-1 refund parsial + unit diketahui (file retur) → HPP = modal × unit terjual bersih; status belum', () => {
  const r = E.compute([ttPenghasilan([ttOrder('5901', -50000)]), ttRetur([{ order: '5901', sku: SKU, qty: 1 }])], stTT);
  cekRekonsiliasi(r, 'B3b-1');
  eq(r.totalModal, 20000, '2 unit − 1 unit direfund = 1 × 20.000'); eq(r.coverage, 1);
  eq(ck(r).penjualan.belum, 50000); eq(ck(r).dikeluarkan.refundParsial.jumlahPesanan, 0);
  eq(r.products[0].qty, 1); truthy(Number.isInteger(r.products[0].qty), 'unit bulat, bukan 1,0 dari nominal');
  // Shopee: unit dari export (buku unit) tetap dipakai, sama seperti H2-B1.
  eq(E.compute(filesB1(-50000, 1), stUnit).totalModal, 20000);
});
test('B3b-2 refund parsial + unit TIDAK diketahui → HPP tidak diketahui, pesanan keluar dari laba, laba tidak final', () => {
  const kecil = E.compute([ttPenghasilan([ttOrder('5902', -20000), normalTT])], stTT);
  const besar = E.compute([ttPenghasilan([ttOrder('5902', -70000), normalTT])], stTT);
  cekRekonsiliasi(kecil, 'B3b-2a'); cekRekonsiliasi(besar, 'B3b-2b');
  // Nominal refund (20% vs 70%) tidak mengubah HPP maupun laba yang dihitung: keduanya hanya berisi pesanan normal.
  eq(kecil.totalModal, 40000); eq(besar.totalModal, 40000, 'hanya pesanan normal 2 × 20.000');
  eq(kecil.totalMargin, besar.totalMargin, 'laba tidak bergantung nominal refund parsial'); eq(kecil.totalMargin, 90000 - 40000);
  const d = ck(kecil).dikeluarkan;
  eq(d.alasan[RP], 1); eq(d.refundParsial.jumlahPesanan, 1); eq(d.refundParsial.penjualan, 80000); eq(d.refundParsial.danaDiterima, 70000);
  eq(kecil.kepastian.laba.final, false); truthy(kecil.kepastian.laba.alasanTidakFinal.includes(RP), 'alasan tercatat');
  truthy(kecil.coverage < 1, 'tidak tampil 100% terhitung');
  const p = kecil.products.find((x) => x.code === SKU); eq(p.qtyKnown, false, 'unit terjual produk tidak diketahui, bukan pecahan'); eq(p.modalKnown, false);
  // Hanya pesanan refund parsial → laba belum dapat dihitung (NaN), bukan 0.
  const sendiri = E.compute([ttPenghasilan([ttOrder('5902', -20000)])], stTT);
  truthy(Number.isNaN(sendiri.totalMargin), 'laba NaN, bukan 0'); eq(sendiri.ready, false);
  // Bukti unit tidak sah → tetap tidak diketahui: kasus SKU lain, kasus "batal", unit = seluruh pesanan (bertentangan).
  for (const [lbl, ret] of [['SKU lain', [{ order: '5902', sku: '7654321', qty: 1 }]], ['batal', [{ order: '5902', sku: SKU, qty: 1, refundTime: '' }]], ['semua unit', [{ order: '5902', sku: SKU, qty: 2 }]], ['jumlah kosong', [{ order: '5902', sku: SKU, qty: '' }]]]) {
    const x = E.compute([ttPenghasilan([ttOrder('5902', -20000)]), ttRetur(ret)], stTT);
    eq(ck(x).dikeluarkan.alasan[RP], 1, `${lbl}: tetap tidak diketahui`); eq(x.totalModal, 0, lbl);
  }
  // Mode reseller dan modal rata-rata: juga tidak dipotong menurut nominal.
  const acuan = E.compute([ttPenghasilan([ttOrder('5902', -20000)])], { modalMode: 'acuan', mitra: 30, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(ck(acuan).dikeluarkan.alasan[RP], 1); eq(acuan.totalModal, 0);
  const rata = E.compute([ttPenghasilan([ttOrder('5902', -20000, '')])], stRata);
  eq(ck(rata).dikeluarkan.alasan[RP], 1, 'tanpa rincian + modal rata-rata'); eq(rata.totalModal, 0);
});
test('B3b-3 refund penuh → perilaku lama tetap (HPP penjualan 0, exposure fisik dicatat), bukan alasan refund parsial', () => {
  const r = E.compute([ttPenghasilan([{ id: '5903', settle: -5000, sales: 0, sub: 100000, refund: -100000, detail: `${SKU} * 2;` }])], stTT);
  eq(r.totalModal, 0); eq(ck(r).dikeluarkan.refundParsial.jumlahPesanan, 0); eq(ck(r).dikeluarkan.alasan[RP], undefined);
  eq(rtf(r, 'tiktok').jumlahPesanan, 1, 'kondisi fisik tetap terpisah (exposure)'); eq(r.lostCertain, 0);
  const s = E.compute(filesB1(-100000, 2), stUnit); eq(s.totalModal, 0); eq(ck(s).dikeluarkan.refundParsial.jumlahPesanan, 0);
});
test('B3b-4/5 tanpa refund dan refund nominal 0 → HPP penuh, tidak dianggap refund parsial', () => {
  const r = E.compute([ttPenghasilan([normalTT])], stTT); eq(r.totalModal, 40000); eq(ck(r).dikeluarkan.jumlahPesanan, 0);
  const nol = E.compute([ttPenghasilan([ttOrder('5905', 0)])], stTT); eq(nol.totalModal, 40000); eq(ck(nol).dikeluarkan.jumlahPesanan, 0);
  const s = E.compute(filesB1(0, 0, 'lama'), stUnit); eq(s.totalModal, 40000);
});
test('B3b-6 nilai refund di file retur tidak diketahui → bukan 0; unit tetap dari field jumlah', () => {
  const r = E.compute([...filesB1(-50000, 1), returShopee([{ order: 'SINT-K1', product: 'Kaos', qty: 1, amount: '' }])], stUnit);
  truthy(Number.isNaN(r.cases[0].amount), 'nilai refund NaN'); truthy(Number.isNaN(r.catSummary[0].amount), 'total kategori tidak tampil Rp0');
  eq(r.totalModal, 20000, 'unit dari export + file retur (sama-sama 1)'); eq(bu(r).status.terverifikasi, 1);
});
test('B3b-7/8/9 kondisi fisik: belum diketahui = risiko; kembali = tanpa kerugian; hilang = kerugian tanpa hitung ganda', () => {
  const files = [ttPenghasilan([ttOrder('5907', -50000)]), ttRetur([{ id: 'TR7', order: '5907', sku: SKU, qty: 1 }])];
  const k = `T|TR7|${SKU}`;
  const belum = E.compute(files, stTT);
  eq(belum.lostCertain, 0, 'kondisi belum diketahui ≠ kerugian'); eq(belum.unknownRisk, 20000); eq(belum.totalModal, 20000);
  const kembali = E.compute(files, stTT, { [k]: 'kembali' });
  eq(kembali.lostCertain, 0); eq(kembali.unknownRisk, 0); eq(kembali.totalModal, 20000);
  const hilang = E.compute(files, stTT, { [k]: 'hilang' });
  eq(hilang.lostCertain, 20000); eq(hilang.totalModal, 20000);
  eq(hilang.totalModal + hilang.lostCertain, 40000, 'HPP 1 unit terjual + 1 unit hilang = modal 2 unit, tidak lebih');
  eq(hilang.totalMargin, 40000 - 20000 - 20000, 'dana diterima − HPP − kerugian');
});
test('B3b-10 file retur diunggah dua kali → unit refund dan HPP sama', () => {
  const ret = ttRetur([{ order: '5910', sku: SKU, qty: 1 }]);
  const a = E.compute([ttPenghasilan([ttOrder('5910', -50000)]), ret], stTT), b = E.compute([ttPenghasilan([ttOrder('5910', -50000)]), ret, ret], stTT);
  eq(JSON.stringify([a.totalModal, a.cases.length, ck(a).penjualan]), JSON.stringify([b.totalModal, b.cases.length, ck(b).penjualan]));
  eq(b.totalModal, 20000, 'unit tidak terhitung dua kali');
});
test('B3b-11 laporan penghasilan TikTok tumpang tindih → tidak dihitung ganda; status refund parsial tetap', () => {
  const f1 = ttPenghasilan([ttOrder('5911', -20000), normalTT]), f2 = ttPenghasilan([normalTT]);
  const a = E.compute([f1], stTT), b = E.compute([f1, f2, f1], stTT);
  eq(b.dupes, 3, 'f2 (1 baris) + f1 kedua (2 baris)'); eq(b.totalSales, a.totalSales); eq(b.totalModal, a.totalModal); eq(ck(b).dikeluarkan.refundParsial.jumlahPesanan, 1);
});
test('B3b-12 HPP tidak diketahui karena modal kosong → alasan modal, bukan refund parsial; tidak dianggap 0', () => {
  const r = E.compute([ttPenghasilan([ttOrder('5912', -20000), normalTT])], ST([]));
  eq(ck(r).dikeluarkan.alasan.modal_belum_diisi, 2); eq(ck(r).dikeluarkan.alasan[RP], undefined);
  truthy(Number.isNaN(r.totalMargin), 'laba belum dapat dihitung, bukan 0');
});
/* Ketiga mode modal (per produk, harga acuan/reseller, modal rata-rata) memakai prinsip yang sama: refund parsial tanpa
 * unit yang sah → HPP tidak diketahui. Harga acuan dan modal rata-rata dihitung dari NILAI penjualan, bukan per unit, jadi
 * bukti unit pun tidak bisa dipakai di dua mode itu: refund parsial selalu dikeluarkan (keputusan H2-B3b). */
const MODE_B3B = { produk: stTT, acuan: { modalMode: 'acuan', mitra: 30, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }] }, rata: null };
test('B3b-13 tiga mode modal × dua marketplace: nominal refund tidak pernah menentukan HPP', () => {
  MODE_B3B.rata = stRata;
  for (const [mode, s] of Object.entries(MODE_B3B)) {
    // TikTok tanpa bukti unit: 20% vs 70% → sama-sama dikeluarkan; HPP/laba hanya dari pesanan normal.
    const kecil = E.compute([ttPenghasilan([ttOrder('5913', -20000), normalTT])], s);
    const besar = E.compute([ttPenghasilan([ttOrder('5913', -70000), normalTT])], s);
    for (const x of [kecil, besar]) {
      cekRekonsiliasi(x, `B3b-13 ${mode}`);
      eq(ck(x).dikeluarkan.alasan[RP], 1, `${mode}: alasan refund parsial`); eq(ck(x).dikeluarkan.refundParsial.jumlahPesanan, 1, mode);
      eq(ck(x).refundParsialTanpaUnit.jumlahPesanan, 0, `${mode}: tidak ada laba yang memakai porsi nominal`);
      eq(x.kepastian.laba.final, false, mode);
    }
    eq(kecil.totalModal, besar.totalModal, `${mode}: HPP tidak bergantung nominal refund`);
    eq(kecil.totalMargin, besar.totalMargin, `${mode}: laba tidak bergantung nominal refund`);
    // Shopee: refund parsial tanpa sumber unit.
    const sh = (refund) => E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K1', items: [{ name: 'Kaos', harga: 100000, refund }] }]))], s.modalMode === 'acuan' ? s : s === stRata ? stRata : stUnit);
    const a = sh(-20000), b = sh(-70000);
    eq(a.totalModal, 0, `${mode} Shopee`); eq(b.totalModal, 0, `${mode} Shopee`);
    eq(ck(a).dikeluarkan.alasan[RP], 1, `${mode} Shopee: alasan refund parsial`); eq(ck(a).refundParsialTanpaUnit.jumlahPesanan, 0);
  }
  // Dengan bukti unit yang sah: hanya mode per produk yang bisa memakainya (modal × unit terjual bersih).
  const files = [ttPenghasilan([ttOrder('5913', -50000)]), ttRetur([{ order: '5913', sku: SKU, qty: 1 }])];
  eq(E.compute(files, MODE_B3B.produk).totalModal, 20000, 'per produk: 1 unit terjual × 20.000');
  for (const mode of ['acuan', 'rata']) {
    const x = E.compute(files, MODE_B3B[mode]);
    eq(x.totalModal, 0, `${mode}: modal dari nilai penjualan tidak bisa dipotong per unit`); eq(ck(x).dikeluarkan.alasan[RP], 1, mode);
  }
  eq(E.compute(filesB1(-50000, 1), stUnit).totalModal, 20000, 'Shopee per produk + buku unit');
  for (const s of [MODE_B3B.acuan, stRata]) eq(ck(E.compute(filesB1(-50000, 1), s)).dikeluarkan.alasan[RP], 1, 'Shopee acuan/rata: dikeluarkan');
});
const SKU2 = '7654321', stTT2 = ST([cat('', '', 20000, SKU), cat('', '', 10000, SKU2)]);
test('B3b-14 multi-SKU: bukti unit harus ada untuk SETIAP SKU (SKU yang tidak muncul di file retur ≠ 0 unit)', () => {
  const ord = ttOrder('5914', -30000, `${SKU} * 2;${SKU2} * 1;`);
  const satu = E.compute([ttPenghasilan([ord]), ttRetur([{ order: '5914', sku: SKU, qty: 1 }])], stTT2);
  eq(satu.totalModal, 0, 'hanya SKU pertama punya kasus → unit SKU kedua tidak diketahui'); eq(ck(satu).dikeluarkan.alasan[RP], 1);
  eq(ck(satu).dikeluarkan.refundParsial.konflik, 0, 'bukan konflik, hanya bukti tidak lengkap');
  const dua = E.compute([ttPenghasilan([ord]), ttRetur([{ order: '5914', sku: SKU, qty: 1 }, { order: '5914', sku: SKU2, qty: 1 }])], stTT2);
  eq(dua.totalModal, 20000, 'SKU1: 2−1 unit × 20.000; SKU2: 1−1 unit × 10.000'); eq(ck(dua).dikeluarkan.jumlahPesanan, 0);
  eq(ck(dua).penjualan.belum, ord.sales, 'unit dari satu sumber → belum, bukan terverifikasi');
});
test('B3b-15 konflik: file retur menyebut SELURUH unit direfund, laporan penghasilan refund parsial → perlu dicek, HPP tidak terverifikasi', () => {
  const tt = E.compute([ttPenghasilan([ttOrder('5915', -20000), normalTT]), ttRetur([{ order: '5915', sku: SKU, qty: 2 }])], stTT);
  cekRekonsiliasi(tt, 'B3b-15');
  const d = ck(tt).dikeluarkan;
  eq(d.alasan[RP], 1); eq(d.alasan.unit_retur_bertentangan_dengan_refund_parsial, 1); eq(d.refundParsial.konflik, 1); eq(d.refundParsial.penjualanKonflik, 80000);
  eq(tt.totalModal, 40000, 'hanya pesanan normal; pesanan konflik bukan HPP 0 dan bukan 2 × 20.000');
  eq(ck(tt).penjualan.terverifikasi, 0); eq(tt.kepastian.laba.final, false);
  // Multi-SKU: semua SKU direfund seluruhnya menurut file retur → konflik juga.
  const multi = E.compute([ttPenghasilan([ttOrder('5915', -30000, `${SKU} * 2;${SKU2} * 1;`)]),
    ttRetur([{ order: '5915', sku: SKU, qty: 2 }, { order: '5915', sku: SKU2, qty: 1 }])], stTT2);
  eq(ck(multi).dikeluarkan.refundParsial.konflik, 1); eq(multi.totalModal, 0);
  // Shopee: export (dan file retur) menyebut 2 dari 2 unit direfund, laporan penghasilan refund parsial.
  for (const [lbl, files] of [['export saja', filesB1(-50000, 2)], ['export + file retur', [...filesB1(-50000, 2), retKaos(2)]]]) {
    const s = E.compute(files, stUnit);
    eq(bu(s).lengkap, 0, `${lbl}: buku unit tidak dipakai`); eq(s.totalModal, 0, `${lbl}: bukan HPP 0 yang terverifikasi`);
    eq(ck(s).dikeluarkan.refundParsial.konflik, 1, lbl); eq(ck(s).dikeluarkan.alasan[RP], 1, lbl);
    eq(ck(s).penjualan.terverifikasi, 0, lbl); truthy(Number.isNaN(s.totalMargin), `${lbl}: laba belum dapat dihitung, bukan dari HPP 0`);
  }
});
test('B3b-16 semantik metadata: A ditemukan = B (laba memakai nominal) + C (dikeluarkan) + unit terbukti + alasan lain', () => {
  const files = [ttPenghasilan([ttOrder('5916', -50000), ttOrder('5917', -20000), ttOrder('5918', -20000), normalTT,
    { id: '5919', settle: -5000, sales: 0, sub: 100000, refund: -100000, detail: `${SKU} * 2;` }]),
  ttRetur([{ order: '5916', sku: SKU, qty: 1 }, { order: '5918', sku: SKU, qty: 2 }])];
  const r = E.compute(files, stTT), c = ck(r);
  cekRekonsiliasi(r, 'B3b-16');
  const A = c.refundParsialDitemukan.jumlahPesanan, B = c.refundParsialTanpaUnit.jumlahPesanan, C = c.dikeluarkan.refundParsial.jumlahPesanan;
  eq(A, 3, 'A: 5916 (unit terbukti), 5917 (tanpa bukti), 5918 (konflik); refund penuh dan normal bukan refund parsial');
  eq(B, 0, 'B: tidak ada lagi laba yang memakai porsi nominal');
  eq(C, 2, 'C: 5917 + 5918'); eq(c.dikeluarkan.refundParsial.konflik, 1);
  eq(A - B - C, 1, 'sisanya dihitung dengan unit yang terbukti'); eq(c.refundParsialDitemukan.penjualan, 50000 + 80000 + 80000);
  // Gabungan dan per marketplace konsisten.
  eq(c.perMarketplace.tiktok.refundParsialDitemukan.jumlahPesanan, 3); eq(c.perMarketplace.shopee.refundParsialDitemukan.jumlahPesanan, 0);
  const s = ck(E.compute([...filesB1(-50000, 1), E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-K2', items: [{ name: 'Kaos', harga: 100000, refund: -20000 }] }]))], stUnit));
  eq(s.refundParsialDitemukan.jumlahPesanan, 2); eq(s.dikeluarkan.refundParsial.jumlahPesanan, 1); eq(s.refundParsialTanpaUnit.jumlahPesanan, 0);
  // Refund parsial tanpa rincian produk dan tanpa modal rata-rata: ditemukan (A), dikeluarkan karena alasan lain (bukan C).
  const lain = ck(E.compute([ttPenghasilan([ttOrder('5920', -20000, '')])], stTT));
  eq(lain.refundParsialDitemukan.jumlahPesanan, 1); eq(lain.dikeluarkan.refundParsial.jumlahPesanan, 0); eq(lain.dikeluarkan.alasan.tanpa_rincian_produk, 1);
});
/* ===== P0 rilis: metadata refund konsisten di ketiga mode + status HPP untuk tampilan (data SINTETIS) ===== */
test('P0-1 konflik bukti unit dinilai konsisten: hanya bila HPP memakai modal per unit (ketiga mode, dua marketplace)', () => {
  const ttFiles = [ttPenghasilan([ttOrder('5921', -20000)]), ttRetur([{ order: '5921', sku: SKU, qty: 2 }])];
  const shFiles = [...filesB1(-50000, 2), retKaos(2)];
  const MODE = { produk: [stTT, stUnit], acuan: [MODE_B3B.acuan, MODE_B3B.acuan], rata: [stRata, stRata] };
  for (const [mode, [sT, sS]] of Object.entries(MODE)) {
    for (const [pf, x] of [['tiktok', E.compute(ttFiles, sT)], ['shopee', E.compute(shFiles, sS)]]) {
      const rp = ck(x).perMarketplace[pf].dikeluarkan.refundParsial;
      eq(rp.jumlahPesanan, 1, `${mode}/${pf}: tetap dikeluarkan sebagai refund parsial`);
      eq(rp.konflik, mode === 'produk' ? 1 : 0, `${mode}/${pf}: konflik hanya bila bukti unit dipakai`);
      eq(x.totalModal, 0, `${mode}/${pf}: HPP tetap tidak diketahui`);
      truthy(rp.konflik <= rp.jumlahPesanan, 'konflik bagian dari C');
    }
  }
  // TikTok modal per produk tetapi SKU tanpa modal (memakai modal rata-rata) → bukan konflik, tetap refund parsial.
  const campur = E.compute([ttPenghasilan([ttOrder('5922', -20000)]), ttRetur([{ order: '5922', sku: SKU, qty: 2 }])], ST([], { fallbackPct: 40 }));
  eq(ck(campur).dikeluarkan.refundParsial.konflik, 0); eq(ck(campur).dikeluarkan.refundParsial.jumlahPesanan, 1);
});
test('P0-2 refund bernilai positif (anomali) bukan refund parsial: tidak masuk A maupun B; angka tidak berubah', () => {
  const pos = [E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-P1', items: [{ name: 'Kaos', harga: 100000, refund: 10000 }] }]))];
  for (const [mode, s] of [['produk', stUnit], ['acuan', MODE_B3B.acuan], ['rata', stRata]]) {
    const r = E.compute(pos, s), c = ck(r);
    eq(c.refundParsialDitemukan.jumlahPesanan, 0, `${mode}: A`); eq(c.refundParsialTanpaUnit.jumlahPesanan, 0, `${mode}: B`);
    eq(c.dikeluarkan.refundParsial.jumlahPesanan, 0, `${mode}: C`);
    truthy(c.refundParsialTanpaUnit.jumlahPesanan <= c.refundParsialDitemukan.jumlahPesanan, `${mode}: B ⊆ A`);
  }
  // Angka modal anomali ini tetap seperti sebelumnya (tidak diubah oleh perbaikan metadata).
  eq(E.compute(pos, stRata).totalModal, 110000 * 0.4); eq(E.compute(pos, stUnit).totalModal, 20000, 'baris tanpa export: estimasi 1 unit (perilaku lama)');
});
test('P0-3 statusHpp: semua tidak diketahui / sebagian / lengkap / HPP benar-benar Rp0', () => {
  const semua = E.compute([ttPenghasilan([normalTT])], ST([]));
  eq(semua.statusHpp.total, 'tidak_diketahui'); eq(semua.statusHpp.tiktok, 'tidak_diketahui'); eq(semua.totalModal, 0, 'modal 0 di objek BUKAN HPP Rp0');
  const sebagian = E.compute([ttPenghasilan([normalTT, ttOrder('5923', 0, '5550001 * 2;')])], stTT);
  eq(sebagian.statusHpp.total, 'sebagian'); eq(sebagian.statusHpp.tiktok, 'sebagian');
  const lengkap = E.compute([ttPenghasilan([normalTT])], stTT);
  eq(lengkap.statusHpp.total, 'lengkap'); eq(lengkap.totalModal, 40000);
  const nol = E.compute([ttPenghasilan([normalTT])], ST([cat('', '', 0, SKU)]));
  eq(nol.statusHpp.total, 'lengkap', 'modal 0 dari isian seller = HPP diketahui'); eq(nol.totalModal, 0); eq(nol.ready, true);
  // Per platform: Shopee bermodal, TikTok tanpa modal → status per platform berbeda.
  const pl = E.compute([E.parseWorkbook(Sint.penghasilan([{ id: 'SINT-Q1', items: [{ name: 'Kaos', harga: 100000, refund: 0 }] }])), ttPenghasilan([normalTT])], stUnit);
  eq(pl.statusHpp.shopee, 'lengkap'); eq(pl.statusHpp.tiktok, 'tidak_diketahui'); eq(pl.statusHpp.total, 'sebagian');
});
/** Empat bulan sintetis: Jan modal lengkap, Feb tanpa modal, Mar sebagian, Apr laba benar-benar Rp0. */
const bulanP0 = () => [E.parseWorkbook(Sint.penghasilan([
  { id: 'B-JAN', orderDate: '2026-01-10 10:00', items: [{ name: 'Kaos', harga: 100000 }] },
  { id: 'B-FEB', orderDate: '2026-02-10 10:00', items: [{ name: 'Topi', harga: 100000 }] },
  { id: 'B-MAR1', orderDate: '2026-03-10 10:00', items: [{ name: 'Kaos', harga: 100000 }] },
  { id: 'B-MAR2', orderDate: '2026-03-11 10:00', items: [{ name: 'Topi', harga: 100000 }] },
  { id: 'B-APR', orderDate: '2026-04-10 10:00', items: [{ name: 'Gelas', harga: 100000 }] }]))];
const stBulan = ST([cat('Kaos', '', 20000), cat('Gelas', '', 100000)]);
test('P0-4 laba bulanan: status per bulan (lengkap / belum diketahui / sebagian / Rp0 aktual); angka bulan tidak berubah', () => {
  const r = E.compute(bulanP0(), stBulan), by = Object.fromEntries(r.months.map((m) => [m.month, m.total]));
  eq(by['2026-01'].statusHpp, 'lengkap'); eq(by['2026-01'].margin, 80000);
  eq(by['2026-02'].statusHpp, 'tidak_diketahui', 'Feb tanpa modal'); eq(by['2026-02'].margin, 0, 'nilai objek tetap 0 (rumus tidak diubah), tetapi statusnya belum diketahui');
  eq(by['2026-03'].statusHpp, 'sebagian'); eq(by['2026-03'].margin, 80000);
  eq(by['2026-04'].statusHpp, 'lengkap', 'laba Rp0 aktual tetap diketahui'); eq(by['2026-04'].margin, 0);
  eq(r.months.find((m) => m.month === '2026-02').shopee.statusHpp, 'tidak_diketahui', 'status per platform juga ada');
  // Temuan bulan tertinggi/terendah tidak memilih bulan yang labanya belum diketahui.
  const ins = r.insights.find((i) => /^Laba tertinggi di /.test(i.title));
  truthy(ins && !/Februari/.test(ins.title), ins && ins.title); truthy(/terendah di April/.test(ins.title), ins.title);
});
/* ---------- Money Trace A1: refund sebagai rincian penjualan + status rekonsiliasi (data SINTETIS) ----------
 * Definisi yang diuji (docs/KAMUS_ANGKA.md, Money Trace A1):
 *  Shopee  penjualan = Harga Produk + Jumlah Pengembalian Dana ke Pembeli + voucher; refund = kolom pengembalian (≤ 0).
 *  TikTok  penjualan = Total Pendapatan = Subtotal setelah diskon penjual + Total pengembalian dana setelah diskon.
 *  Refund SUDAH termasuk penjualan → hanya rincian, tidak dikurangkan lagi. Angka lain = angka engine yang sudah ada. */
const A1sh = (orders, { summary = {}, adj = null, withRefundCol = true, name = 'sh-a1.xlsx' } = {}) => {
  const head = ['No.', 'Lihat berdasarkan', 'No. Pesanan', 'Waktu Pesanan Dibuat', 'Tanggal Dana Dilepaskan', 'Total Penghasilan', 'Harga Produk',
    ...(withRefundCol ? ['Jumlah Pengembalian Dana ke Pembeli'] : []), 'Biaya Administrasi'];
  const rows = [head, ...orders.map((o, i) => [i + 1, 'Order', o.id, o.date || '2026-01-10 10:00', '2026-01-20', o.harga + o.refund + o.admin, o.harga,
    ...(withRefundCol ? [o.refund] : []), o.admin])];
  const sum = (f) => orders.reduce((a, o) => a + f(o), 0);
  const v = { pendapatan: sum((o) => o.harga + o.refund), refund: sum((o) => o.refund), pengeluaran: sum((o) => o.admin), dilepas: sum((o) => o.harga + o.refund + o.admin), ...summary };
  const Summary = [['Dari', '2026-01-01'], ['ke', '2026-03-31'],
    ...(v.pendapatan === null ? [] : [['1. Total Pendapatan', null, null, v.pendapatan]]),
    ...(v.refund === null ? [] : [[null, 'Jumlah Pengembalian Dana ke Pembeli', v.refund]]),
    ...(v.pengeluaran === null ? [] : [['2. Total Pengeluaran', null, null, v.pengeluaran]]),
    ['3. Total yang Dilepas', null, null, v.dilepas]];
  const sheets = { Summary, Penghasilan: rows };
  if (adj) sheets.Adjustment = [['Ringkasan Biaya Penyesuaian'], ['Total Penyesuaian', null, null, null, adj.total ?? adj.rows.reduce((a, x) => a + x.amount, 0)], [],
    ['No.', 'Tanggal Penyesuaian Dibuat', 'Tipe Penyesuaian | Deskripsi', 'Alasan Penyesuaian', 'Biaya Penyesuaian', 'No. Pesanan Terhubung'],
    ...adj.rows.map((x, i) => [i + 1, x.date || '2026-01-25', x.type || 'Kompensasi atas pesanan hilang', '', x.amount, x.order || ''])];
  return E.parseWorkbook({ name, sheets });
};
// TikTok: sub = Subtotal setelah diskon penjual; refund = Total pengembalian dana setelah diskon; full = refund penuh (pre = 0).
const A1tt = (rows, { laporan = {}, cols = true, subCol = true, name = 'tt-a1.xlsx' } = {}) => {
  const head = ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran', 'Total Pendapatan',
    ...(subCol ? ['Subtotal setelah diskon penjual'] : []), ...(cols ? ['Total pengembalian dana setelah diskon'] : []), 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya'];
  const R = rows.map((x) => { const sales = x.sales ?? (x.sub || 0) + (x.refund || 0); return { ...x, jenis: x.jenis || 'Pesanan', sales, settle: sales + (x.biaya || 0) + (x.lain || 0) }; });
  const aoa = [head, ...R.map((x) => [x.id, x.jenis, x.date || '2026/01/10', x.pay || '2026/01/15', x.settle, x.sales, ...(subCol ? [x.sub || 0] : []), ...(cols ? [x.refund || 0] : []),
    x.jenis === 'Pesanan' ? x.preGross ?? x.sub : 0, x.full ? -(x.preGross ?? x.sub) : 0, x.biaya || 0])];
  const sum = (f) => R.reduce((a, x) => a + f(x), 0);
  const v = { settle: sum((x) => x.settle), sales: sum((x) => x.sales), refund: sum((x) => x.refund || 0), biaya: sum((x) => x.biaya || 0), ...laporan };
  const Laporan = [['', 'Jumlah penyelesaian pembayaran', '', '', '', v.settle], ['', 'Total Pendapatan', '', '', '', v.sales],
    ...(v.refund === null ? [] : [['', 'Total pengembalian dana setelah diskon', '', '', '', v.refund]]), ['', 'Total Biaya', '', '', '', v.biaya]];
  return E.parseWorkbook({ name, sheets: { 'Detail pesanan': aoa, Laporan } });
};
const A1ST = { modalMode: 'produk', catalog: [], fallbackPct: 50, periods: [{ start: '', markup: 0, disc: 0 }], fixedCosts: [] };
const A1_SH = [{ id: 'A1-S1', harga: 100000, refund: 0, admin: -10000 }, { id: 'A1-S2', harga: 80000, refund: -30000, admin: -8000 },
  { id: 'A1-S3', harga: 50000, refund: -50000, admin: -2000 }, { id: 'A1-S4', harga: 60000, refund: 0, admin: -6000, date: '2026-02-05 09:00' }];
const A1_TT = [{ id: 'A1-T1', sub: 100000, refund: 0, biaya: -12000 }, { id: 'A1-T2', sub: 90000, refund: -40000, biaya: -9000 },
  { id: 'A1-T3', sub: 70000, refund: -70000, biaya: -1000, full: true }, { id: 'A1-T4', sub: 50000, refund: 0, biaya: -5000, date: '2026/02/03' }];
const ju = (files, f = {}) => { const r = E.compute(files, A1ST, {}, f); return { r, J: r.jejakUang }; };
/** Angka Jejak Uang harus SAMA dengan angka engine yang sudah ada (tidak ada rumus baru). */
const a1Identik = (r, label = '') => {
  const T = r.jejakUang.total;
  near(T.penjualan.nilai, r.totalSales, 0, `${label} penjualan`); near(T.potongan.nilai, r.totalFees, 0, `${label} potongan`);
  near(T.dana.nilai, r.totalReceived, 0, `${label} dana`); near(T.penyesuaian.nilai, r.adjustments, 0, `${label} penyesuaian`);
};
test('MT-A1 refund nol terverifikasi: Rp0 dengan status terekonsiliasi, bukan "belum tersedia"', () => {
  const { r, J } = ju([A1sh([A1_SH[0]]), A1tt([A1_TT[0]])]);
  for (const pf of ['shopee', 'tiktok']) { eq(J.marketplace[pf].refund.nilai, 0, pf); eq(J.marketplace[pf].refund.status, 'terekonsiliasi', pf); eq(J.marketplace[pf].refund.jumlahPesanan, 0); }
  eq(J.total.refund.nilai, 0); a1Identik(r);
});
test('MT-A1 refund sudah termasuk penjualan: tidak dikurangkan lagi, dana = penjualan + potongan', () => {
  const { r, J } = ju([A1sh(A1_SH), A1tt(A1_TT)]);
  eq(J.marketplace.shopee.refund.nilai, -80000); eq(J.marketplace.tiktok.refund.nilai, -110000);
  eq(J.marketplace.shopee.refund.termasukPenjualan, true); eq(J.marketplace.tiktok.refund.termasukPenjualan, true);
  eq(r.shopee.sales, 290000 - 80000, 'Shopee: harga + refund'); eq(r.tiktok.sales, 310000 - 110000, 'TikTok: Total Pendapatan');
  near(r.totalReceived, r.totalSales + r.totalFees, 0, 'refund tidak dikurangkan dua kali');
  for (const k of ['penjualan', 'refund', 'potongan', 'dana']) eq(J.total[k].status, 'terekonsiliasi', k);
  a1Identik(r);
});
test('MT-A1 refund penuh dan parsial dihitung terpisah (jumlah pesanan), tanpa mengubah jumlah pesanan terjual', () => {
  const { r, J } = ju([A1sh(A1_SH), A1tt(A1_TT)]);
  const s = J.marketplace.shopee.refund, t = J.marketplace.tiktok.refund;
  eq(`${s.jumlahPesanan}/${s.penuh}/${s.parsial}`, '2/1/1', 'Shopee'); eq(`${t.jumlahPesanan}/${t.penuh}/${t.parsial}`, '2/1/1', 'TikTok');
  eq(J.total.refund.jumlahPesanan, 4); eq(r.shopee.orders, 3); eq(r.tiktok.orders, 3);
});
test('MT-A1 penyesuaian terpisah: Shopee dicocokkan dengan Total Penyesuaian, TikTok bersama dana; laba tidak berubah', () => {
  const adj = { rows: [{ amount: 25000, order: 'A1-S1' }, { amount: -5000, date: '2026-02-11' }] };
  const base = ju([A1sh(A1_SH), A1tt(A1_TT)]).r;
  const { r, J } = ju([A1sh(A1_SH, { adj }), A1tt(A1_TT)]);
  eq(J.marketplace.shopee.penyesuaian.nilai, 20000); eq(J.marketplace.shopee.penyesuaian.jumlah, 2); eq(J.marketplace.shopee.penyesuaian.status, 'terekonsiliasi');
  eq(J.marketplace.shopee.penyesuaian.termasukLaba, false);
  near(r.totalMargin, base.totalMargin, 0, 'laba tidak memuat penyesuaian'); near(r.totalReceived, base.totalReceived, 0, 'dana pesanan tidak memuat penyesuaian');
  // TikTok: baris non-pesanan bernilai → penyesuaian; dana pesanan + penyesuaian = penyelesaian di sheet Laporan.
  const x = ju([A1tt([...A1_TT, { id: 'A1-ADJ2', jenis: 'Kompensasi', sales: 0, lain: 15000, pay: '2026/01/20' }])]);
  eq(x.J.marketplace.tiktok.penyesuaian.nilai, 15000); eq(x.J.marketplace.tiktok.dana.status, 'terekonsiliasi'); eq(x.J.marketplace.tiktok.penyesuaian.status, 'terekonsiliasi');
  near(x.r.totalReceived, ju([A1tt(A1_TT)]).r.totalReceived, 0, 'dana pesanan TikTok tetap'); a1Identik(x.r);
  // Ringkasan Total Penyesuaian tidak cocok → perlu dicek; sheet tidak ada → belum bisa dicocokkan.
  eq(ju([A1sh(A1_SH, { adj: { ...adj, total: 99 } })]).J.marketplace.shopee.penyesuaian.status, 'perlu_dicek');
  const tanpa = ju([A1sh(A1_SH)]).J.marketplace.shopee.penyesuaian;
  eq(tanpa.status, 'berdasarkan_laporan'); truthy(tanpa.alasan.includes('sheet_penyesuaian_tidak_ada'), tanpa.alasan.join());
});
test('MT-A1 potongan marketplace: cocok dengan ringkasan; ringkasan berbeda → "perlu dicek", angka tidak diubah', () => {
  const ok1 = ju([A1sh(A1_SH)]);
  eq(ok1.J.marketplace.shopee.potongan.status, 'terekonsiliasi'); eq(ok1.J.marketplace.shopee.potongan.nilai, -26000);
  const bad = ju([A1sh(A1_SH, { summary: { pengeluaran: -25000 } }), A1tt(A1_TT, { laporan: { biaya: -1 } })]);
  eq(bad.J.marketplace.shopee.potongan.status, 'perlu_dicek'); eq(bad.J.marketplace.tiktok.potongan.status, 'perlu_dicek');
  eq(bad.J.total.potongan.status, 'perlu_dicek'); truthy(bad.J.marketplace.shopee.potongan.alasan.includes('tidak_cocok_ringkasan'), 'alasan');
  near(bad.r.totalFees, ju([A1sh(A1_SH), A1tt(A1_TT)]).r.totalFees, 0, 'angka potongan sama');
});
test('MT-A1 data tidak lengkap: kolom refund tidak ada → belum tersedia (NaN, bukan 0); ringkasan tidak ada → berdasarkan laporan', () => {
  const tanpaKolom = ju([A1sh(A1_SH), A1tt(A1_TT, { cols: false, laporan: { refund: null } })]);
  const t = tanpaKolom.J.marketplace.tiktok.refund;
  truthy(Number.isNaN(t.nilai) && Number.isNaN(t.jumlahPesanan), 'refund TikTok NaN'); eq(t.status, 'belum_tersedia');
  truthy(Number.isNaN(tanpaKolom.J.total.refund.nilai) && Number.isNaN(tanpaKolom.J.total.refund.jumlahPesanan), 'total refund NaN, bukan Rp0');
  eq(tanpaKolom.J.marketplace.shopee.refund.nilai, -80000, 'Shopee tetap tersedia');
  near(tanpaKolom.r.totalSales, ju([A1sh(A1_SH), A1tt(A1_TT)]).r.totalSales, 0, 'penjualan tetap = Total Pendapatan');
  const shTanpa = ju([A1sh(A1_SH, { withRefundCol: false, summary: { refund: null } })]).J.marketplace.shopee.refund;
  eq(shTanpa.status, 'belum_tersedia'); truthy(Number.isNaN(shTanpa.nilai), 'Shopee tanpa kolom refund → NaN');
  const tanpaRingkasan = ju([A1sh(A1_SH, { summary: { pendapatan: null, refund: null, pengeluaran: null } })]).J.marketplace.shopee;
  for (const k of ['penjualan', 'refund', 'potongan']) { eq(tanpaRingkasan[k].status, 'berdasarkan_laporan', k); truthy(tanpaRingkasan[k].alasan.includes('ringkasan_resmi_tidak_ada'), k); }
  eq(tanpaRingkasan.dana.status, 'terekonsiliasi', 'dana tetap dicocokkan dengan Total yang Dilepas');
  // Subtotal setelah diskon tidak ada → hubungan refund–penjualan belum terbukti → tidak disebut terekonsiliasi.
  const tanpaSub = ju([A1tt(A1_TT, { subCol: false })]).J.marketplace.tiktok.refund;
  eq(tanpaSub.status, 'berdasarkan_laporan'); truthy(tanpaSub.alasan.includes('hubungan_refund_belum_terbukti'), tanpaSub.alasan.join());
});
test('MT-A1 tanda/identitas refund tidak wajar → "perlu dicek"', () => {
  const pos = ju([A1sh([{ id: 'A1-P', harga: 50000, refund: 5000, admin: -1000 }])]).J.marketplace.shopee.refund;
  eq(pos.status, 'perlu_dicek'); truthy(pos.alasan.includes('tanda_refund_tidak_wajar'), pos.alasan.join());
  const idt = ju([A1tt([{ id: 'A1-I', sub: 90000, refund: -10000, sales: 85000, biaya: -1000 }])]).J.marketplace.tiktok.refund;
  eq(idt.status, 'perlu_dicek'); truthy(idt.alasan.includes('identitas_refund_tidak_cocok'), idt.alasan.join());
});
test('MT-A1 unggah berulang: file sama diabaikan, angka tetap dan tetap terekonsiliasi; file tumpang tindih → berdasarkan laporan', () => {
  const one = ju([A1sh(A1_SH), A1tt(A1_TT)]);
  const two = ju([A1sh(A1_SH), A1tt(A1_TT), A1sh(A1_SH, { name: 'ulang.xlsx' }), A1tt(A1_TT, { name: 'ulang-tt.xlsx' })]);
  eq(two.J.marketplace.shopee.file.identik, 1); eq(two.J.marketplace.tiktok.file.identik, 1);
  for (const k of ['penjualan', 'refund', 'potongan', 'dana']) { near(two.J.total[k].nilai, one.J.total[k].nilai, 0, k); eq(two.J.total[k].status, 'terekonsiliasi', k); }
  const over = ju([A1sh(A1_SH.slice(0, 2)), A1sh(A1_SH.slice(1), { name: 'feb.xlsx' })]);
  eq(over.J.marketplace.shopee.file.tumpangTindih, 1); eq(over.J.marketplace.shopee.refund.nilai, -80000, 'pesanan sama dihitung sekali');
  eq(over.J.marketplace.shopee.penjualan.status, 'berdasarkan_laporan'); truthy(over.J.marketplace.shopee.penjualan.alasan.includes('file_tumpang_tindih'), 'alasan');
  a1Identik(two.r); a1Identik(over.r);
});
test('MT-A1 filter marketplace dan tanggal: hanya data terpilih; filter tanggal tidak pernah "terekonsiliasi"', () => {
  const tt = ju([A1sh(A1_SH), A1tt(A1_TT)], { platforms: ['tiktok'] });
  eq(tt.J.marketplace.shopee, null); eq(tt.J.total.refund.nilai, -110000); eq(tt.J.total.refund.status, 'terekonsiliasi'); a1Identik(tt.r, 'tiktok');
  const jan = ju([A1sh(A1_SH), A1tt(A1_TT)], { from: '2026-01', to: '2026-01' });
  eq(jan.J.filterTanggal, true); eq(jan.J.total.refund.nilai, -190000, 'semua refund ada di Januari');
  near(jan.J.total.penjualan.nilai, 210000 - 60000 + 200000 - 50000, 0, 'pesanan Februari tidak ikut');
  for (const k of ['penjualan', 'refund', 'potongan', 'dana']) { eq(jan.J.total[k].status, 'berdasarkan_laporan', k); truthy(jan.J.marketplace.shopee[k].alasan.includes('filter_tanggal'), k); }
  a1Identik(jan.r, 'jan');
});
test('MT-A1 pencairan belum diproses: selalu "belum tersedia", nilai bukan Rp0; data contoh tetap konsisten', () => {
  for (const files of [[A1sh(A1_SH)], [A1tt(A1_TT)], parsed]) {
    const J = E.compute(files, A1ST).jejakUang;
    eq(J.pencairan.status, 'belum_tersedia'); truthy(Number.isNaN(J.pencairan.nilai), 'pencairan NaN');
  }
  const d = E.compute(parsed, st); a1Identik(d, 'demo');
  eq(d.jejakUang.marketplace.tiktok.refund.status, 'belum_tersedia', 'data contoh TikTok tidak punya kolom refund setelah diskon');
  eq(d.jejakUang.marketplace.shopee.dana.status, 'terekonsiliasi', 'contoh Shopee: Total yang Dilepas cocok');
});

/* ---------- R4: refund/biaya susulan TikTok (baris "Pesanan" kedua dengan ID yang sama), data SINTETIS ----------
 * Aturan (KAMUS B.1c): baris susulan tetap masuk penjualan/potongan/dana apa adanya; untuk HPP dinilai bersama pesanan
 * asalnya sebagai SATU pesanan (aturan H2-B3b); tidak dihitung sebagai pesanan baru; tanpa pesanan asal → HPP tidak
 * diketahui. Nominal refund tidak pernah dipakai untuk unit HPP. */
const susulan = (id, refund, fee = -2000) => ({ id, settle: refund + fee, sales: refund, sub: 0, refund, detail: '' });
const biayaSusulan = (id, fee) => ({ id, settle: fee, sales: 0, sub: 0, refund: 0, detail: '' });
const stAcuanR4 = { modalMode: 'acuan', mitra: 30, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }], fixedCosts: [] };
const stRataR4 = ST([], { fallbackPct: 50 });
const R4m = (r) => r.kepastian.refundTiktok;
/** Angka laporan (penjualan, potongan, dana) selalu = jumlah semua baris, apa pun aturan HPP-nya. */
const r4Laporan = (r, rows) => {
  eq(r.tiktok.sales, rows.reduce((a, x) => a + x.sales, 0), 'penjualan = Σ baris');
  eq(r.tiktok.received, rows.reduce((a, x) => a + x.settle, 0), 'dana = Σ baris');
  eq(r.tiktok.feeTotal, rows.reduce((a, x) => a + x.settle - x.sales, 0), 'potongan = Σ baris');
};
test('TT-R4-1 refund parsial di baris asal: perilaku H2-B3b tetap; tercatat sebagai refund baris asal', () => {
  const r = E.compute([ttPenghasilan([ttOrder('6101', -50000)])], stTT);
  cekRekonsiliasi(r, 'R4-1'); eq(ck(r).dikeluarkan.alasan[RP], 1); eq(R4m(r).refundSusulanCocok.baris, 0);
  eq(R4m(r).refundParsialUnitBelumDiketahui, 1);
});
test('TT-R4-2/3/8 refund parsial pada baris susulan (file sama, tanpa bukti unit) = sama dengan refund di baris asal', () => {
  const rows = [ttOrder('6102', 0), susulan('6102', -50000), normalTT];
  const r = E.compute([ttPenghasilan(rows)], stTT);
  const inRow = E.compute([ttPenghasilan([ttOrder('6102', -50000), normalTT])], stTT);
  cekRekonsiliasi(r, 'R4-2'); r4Laporan(r, rows);
  eq(r.totalModal, inRow.totalModal, 'HPP sama dengan refund di baris asal'); eq(r.totalModal, 40000, 'hanya pesanan normal');
  truthy(r.totalModal >= 0, 'HPP tidak dikurangi nominal refund');
  eq(r.tiktok.orders, 2, 'baris susulan bukan pesanan baru'); eq(ck(r).jumlahPesanan.tidakDiketahui, 1, 'cakupan: 1 pesanan, bukan 2');
  eq(ck(r).dikeluarkan.alasan[RP], 1); eq(ck(r).dikeluarkan.refundParsial.jumlahPesanan, 1);
  eq(ck(r).dikeluarkan.penjualan, 100000 - 50000, 'penjualan pesanan (asal + susulan) keluar dari laba');
  eq(ck(r).dikeluarkan.danaDiterima, inRow.kepastian.cakupan.dikeluarkan.danaDiterima - 2000, 'dana asal + susulan (biaya susulan ikut)');
  eq(R4m(r).refundSusulanCocok.baris, 1); eq(R4m(r).refundSusulanCocok.nilai, -50000); eq(R4m(r).refundParsialUnitBelumDiketahui, 1);
  eq(r.jejakUang.marketplace.tiktok.refund.pencocokanTransaksi.status, 'lengkap');
  const p = r.products.find((x) => x.code === SKU); eq(p.qtyKnown, false); eq(p.modalKnown, false);
});
test('TT-R4-4 refund susulan di file berbeda dicocokkan sama seperti di file yang sama', () => {
  const satu = E.compute([ttPenghasilan([ttOrder('6104', 0), susulan('6104', -50000)])], stTT);
  const dua = E.compute([ttPenghasilan([ttOrder('6104', 0)]), ttPenghasilan([susulan('6104', -50000)])], stTT);
  for (const k of ['totalSales', 'totalReceived', 'totalModal', 'orders']) eq(dua[k], satu[k], k);
  eq(JSON.stringify(ck(dua).dikeluarkan), JSON.stringify(ck(satu).dikeluarkan), 'cakupan sama');
  eq(R4m(dua).refundSusulanCocok.baris, 1);
  // R1–R3 belum diterapkan: overlap ID antar file tetap menurunkan status Jejak uang (konservatif).
  eq(dua.jejakUang.marketplace.tiktok.penjualan.status, 'berdasarkan_laporan');
});
test('TT-R4-5 refund penuh susulan = refund penuh di baris asal (pesanan tidak terjual, HPP 0, kondisi fisik dicatat)', () => {
  const rows = [ttOrder('6105', 0), susulan('6105', -100000)];
  const r = E.compute([ttPenghasilan(rows)], stTT), inRow = E.compute([ttPenghasilan([ttOrder('6105', -100000)])], stTT);
  r4Laporan(r, rows); cekRekonsiliasi(r, 'R4-5');
  eq(r.orders, 0, 'tidak terhitung terjual'); eq(r.orders, inRow.orders); eq(r.totalModal, inRow.totalModal); eq(r.totalModal, 0);
  eq(ck(r).refundTanpaCatatanFisik.jumlahPesanan, 1, 'kondisi fisik belum diketahui tetap dicatat, tidak ditebak');
  eq(ck(r).refundTanpaCatatanFisik.jumlahPesanan, ck(inRow).refundTanpaCatatanFisik.jumlahPesanan);
});
test('TT-R4-6 refund tanpa pesanan asal → HPP tidak diketahui (bukan 0, bukan pengurang HPP); pencocokan belum lengkap', () => {
  for (const [lbl, st] of [['produk', stTT], ['acuan', stAcuanR4], ['rata', stRataR4]]) {
    const r = E.compute([ttPenghasilan([susulan('6106', -40000), normalTT])], st);
    const base = E.compute([ttPenghasilan([normalTT])], st);
    eq(r.totalModal, base.totalModal, `${lbl}: HPP tidak berubah oleh refund tanpa pesanan asal`);
    eq(r.totalMargin, base.totalMargin, `${lbl}: laba hanya dari pesanan yang diketahui`);
    eq(ck(r).dikeluarkan.alasan.refund_susulan_tanpa_pesanan_asal, 1, lbl);
    eq(R4m(r).refundSusulanTidakCocok.baris, 1, lbl); eq(R4m(r).refundSusulanTidakCocok.nilai, -40000, lbl);
    eq(r.tiktok.sales, 100000 - 40000, `${lbl}: refund tetap masuk penjualan`);
  }
  const only = E.compute([ttPenghasilan([susulan('6106', -40000)])], stTT);
  truthy(Number.isNaN(only.totalMargin), 'laba NaN, bukan 0'); eq(only.orders, 0);
});
test('TT-R4-6b Money Trace: total cocok dengan laporan, tetapi pencocokan transaksi belum lengkap', () => {
  const r = E.compute([A1tt([{ id: 'R4-X', sub: 0, refund: -30000, biaya: -1000 }, { id: 'R4-N', sub: 50000, refund: 0, biaya: -5000 }])], A1ST);
  const rf = r.jejakUang.marketplace.tiktok.refund;
  eq(rf.status, 'terekonsiliasi', 'total refund tetap cocok dengan laporan');
  eq(rf.pencocokanTransaksi.status, 'belum_lengkap'); eq(rf.pencocokanTransaksi.refundSusulanTidakCocok, 1);
  eq(r.jejakUang.total.refund.susulanTidakCocok, 1);
});
test('TT-R4-7 refund susulan dengan bukti unit valid (file retur) → HPP = unit terjual bersih × modal', () => {
  const r = E.compute([ttPenghasilan([ttOrder('6107', 0), susulan('6107', -50000)]), ttRetur([{ order: '6107', sku: SKU, qty: 1 }])], stTT);
  cekRekonsiliasi(r, 'R4-7');
  eq(r.totalModal, 20000, '2 unit − 1 unit terbukti direfund'); eq(r.coverage, 1); eq(R4m(r).refundParsialUnitTerverifikasi, 1);
  eq(r.products[0].qty, 1); eq(ck(r).penjualan.belum, 50000, 'status belum (satu sumber bukti), bukan terverifikasi');
  // Bukti unit tidak sah → tetap tidak diketahui (aturan ketat H2-B3b berlaku juga untuk susulan).
  const lain = E.compute([ttPenghasilan([ttOrder('6107', 0), susulan('6107', -50000)]), ttRetur([{ order: '6107', sku: '7654321', qty: 1 }])], stTT);
  eq(ck(lain).dikeluarkan.alasan[RP], 1, 'SKU lain bukan bukti');
});
test('TT-R4-9 beberapa refund susulan untuk pesanan yang sama: dijumlahkan per pesanan', () => {
  const rows = [ttOrder('6109', 0), susulan('6109', -20000), susulan('6109', -30000, -1000)];
  const r = E.compute([ttPenghasilan(rows), ttRetur([{ order: '6109', sku: SKU, qty: 1 }])], stTT);
  r4Laporan(r, rows); eq(r.totalModal, 20000); eq(r.orders, 1); eq(R4m(r).refundSusulanCocok.baris, 2);
  const penuh = E.compute([ttPenghasilan([ttOrder('6109', 0), susulan('6109', -60000), susulan('6109', -40000, -1000)])], stTT);
  eq(penuh.orders, 0, 'jumlah susulan = seluruh nilai → refund penuh'); eq(penuh.totalModal, 0);
  // Refund per pesanan di Jejak uang (A1): satu pesanan meski ada dua baris refund.
  const j = E.compute([A1tt([{ id: 'R4-M', sub: 90000, refund: 0, biaya: -9000 }, { id: 'R4-M', sub: 0, refund: -20000, biaya: -1000 }, { id: 'R4-M', sub: 0, refund: -10000, biaya: -500 }])], A1ST);
  eq(j.jejakUang.marketplace.tiktok.refund.jumlahPesanan, 1); eq(j.jejakUang.marketplace.tiktok.refund.parsial, 1); eq(j.jejakUang.marketplace.tiktok.refund.nilai, -30000);
});
test('TT-R4-10 biaya logistik susulan: biaya sah sesuai laporan, bukan refund barang, bukan pesanan baru', () => {
  const rows = [ttOrder('6110', 0), biayaSusulan('6110', -15000)];
  for (const [lbl, st] of [['produk', stTT], ['acuan', stAcuanR4], ['rata', stRataR4]]) {
    const r = E.compute([ttPenghasilan(rows)], st), base = E.compute([ttPenghasilan([ttOrder('6110', 0)])], st);
    r4Laporan(r, rows); cekRekonsiliasi(r, `R4-10 ${lbl}`);
    eq(r.totalModal, base.totalModal, `${lbl}: HPP tidak berubah`); eq(r.orders, 1, lbl);
    eq(r.totalMargin, base.totalMargin - 15000, `${lbl}: biaya susulan mengurangi laba sebesar biayanya`);
    eq(R4m(r).biayaSusulan.baris, 1, lbl); eq(R4m(r).refundSusulanCocok.baris, 0, lbl); eq(ck(r).refundParsialDitemukan.jumlahPesanan, 0, `${lbl}: bukan refund parsial`);
  }
});
test('TT-R4-11 tiga mode modal: refund susulan tanpa bukti unit tidak pernah mengurangi HPP secara proporsional', () => {
  for (const [lbl, st] of [['produk', stTT], ['acuan', stAcuanR4], ['rata', stRataR4]]) {
    const rows = [ttOrder('6111', 0), susulan('6111', -50000), normalTT];
    const r = E.compute([ttPenghasilan(rows)], st), base = E.compute([ttPenghasilan([normalTT])], st);
    const inRow = E.compute([ttPenghasilan([ttOrder('6111', -50000), normalTT])], st);
    eq(r.totalModal, base.totalModal, `${lbl}: pesanan refund parsial keluar dari HPP, tidak diprorata`);
    eq(r.totalModal, inRow.totalModal, `${lbl}: sama dengan refund di baris asal`); eq(r.totalMargin, inRow.totalMargin, `${lbl}: laba sama (pesanan keluar dari laba)`);
    eq(ck(r).dikeluarkan.alasan[RP], 1, lbl);
    // Mode harga acuan & modal rata-rata tidak memakai unit, jadi bukti unit pun tidak membuat HPP dihitung.
    if (lbl !== 'produk') eq(ck(E.compute([ttPenghasilan(rows), ttRetur([{ order: '6111', sku: SKU, qty: 1 }])], st)).dikeluarkan.alasan[RP], 1, `${lbl}: tetap tidak diketahui`);
  }
});
test('TT-R4-12 unggah ulang file identik: hasil sama dengan sekali unggah', () => {
  const f = () => ttPenghasilan([ttOrder('6112', 0), susulan('6112', -50000), biayaSusulan('6112', -3000)]);
  const a = E.compute([f(), ttRetur([{ order: '6112', sku: SKU, qty: 1 }])], stTT), b = E.compute([f(), f(), ttRetur([{ order: '6112', sku: SKU, qty: 1 }])], stTT);
  for (const k of ['totalSales', 'totalReceived', 'totalModal', 'totalMargin', 'orders']) eq(b[k], a[k], k);
  eq(JSON.stringify(R4m(b)), JSON.stringify(R4m(a)), 'metadata R4 sama'); eq(JSON.stringify(ck(b)), JSON.stringify(ck(a)), 'cakupan sama');
});

test('tanggal dd/mm/yyyy dan serial Excel', () => { eq(E.date('05/06/2026'), '2026-06-05'); eq(E.date(46023), '2026-01-01'); });

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
