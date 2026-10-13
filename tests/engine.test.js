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
test('angka format Indonesia di CSV', () => {
  eq(E.num('Rp1.234.567'), 1234567); eq(E.num('-1.250'), -1250); eq(E.num('12,5'), 125); eq(E.num('/'), 0);
});
test('tanggal dd/mm/yyyy dan serial Excel', () => { eq(E.date('05/06/2026'), '2026-06-05'); eq(E.date(46023), '2026-01-01'); });

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
