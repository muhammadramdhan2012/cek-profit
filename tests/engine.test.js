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
test('T16 jalur produksi belum memakai pencocok: compute Shopee dengan export tetap seperti sebelumnya', () => {
  // Perilaku LAMA (masih bermasalah, H1/H3) sengaja dipertahankan di Fase 1: baris variasi pertama
  // mengambil semua jumlah bernama sama. Tes ini memastikan Fase 1 tidak mengubah angka produksi.
  const orders = [{ id: 'SINT-16', items: [{ name: 'Kaos', productId: 'P1', harga: 50000 }, { name: 'Kaos', productId: 'P1', harga: 60000 }] }];
  const lines = [{ order: 'SINT-16', name: 'Kaos', variant: 'S', qty: 1, price: 50000 }, { order: 'SINT-16', name: 'Kaos', variant: 'L', qty: 1, price: 60000 }];
  const st0 = { modalMode: 'produk', catalog: [{ kode: 'P1', nama: '', variasi: '', cost: 10000 }], periods: [{ start: '', markup: 0, disc: 0 }] };
  const r0 = E.compute([E.parseWorkbook(Sint.penghasilan(orders)), E.parseWorkbook(Sint.exportPesanan(lines))], st0);
  eq(r0.totalModal, 30000, 'perilaku lama: 2 unit + 1 unit asumsi = 3 × 10.000 (diperbaiki di Fase 2)');
  eq(r0.qtyAssumed, 1);
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

test('angka format Indonesia di CSV', () => {
  eq(E.num('Rp1.234.567'), 1234567); eq(E.num('-1.250'), -1250); eq(E.num('12,5'), 125); eq(E.num('/'), 0);
});
test('tanggal dd/mm/yyyy dan serial Excel', () => { eq(E.date('05/06/2026'), '2026-06-05'); eq(E.date(46023), '2026-01-01'); });

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
