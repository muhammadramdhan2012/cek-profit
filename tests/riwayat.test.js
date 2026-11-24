/* Uji riwayat modal (modal per tanggal, Langkah R1, KAMUS A.23). Data SINTETIS.
 * Tingkat 1 (tanpa jumlah): modal = catatan terakhir dengan tanggal mulai ≤ tanggal pesanan.
 * Tingkat 2 (semua catatan sampai tanggal itu punya jumlah): rata-rata tertimbang kumulatif.
 * Sebelum catatan pertama: modal awal (isian lama) bila ada, selain itu tidak diketahui. Selalu "perkiraan".
 * Jalankan: node tests/riwayat.test.js
 */
const E = require('../assets/engine.js');
const Sint = require('./fixtures/shopee-sintetis.js');
const D = require('../assets/demo.js');
const S = require('../assets/sinkron.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const near = (a, b, msg = '') => truthy(Math.abs(a - b) < 1e-6, `${msg} ${a} ≈ ${b}`);

/** Dua pesanan Buku A (1 unit): tanggal 20 dan 27 November. */
const ORD = (d1 = '2026-11-20 10:00', d2 = '2026-11-27 10:00') => [{ id: 'O1', orderDate: d1, items: [{ name: 'Buku A', harga: 30000 }] }, { id: 'O2', orderDate: d2, items: [{ name: 'Buku A', harga: 30000 }] }];
const EXP = [{ order: 'O1', name: 'Buku A', qty: 1, price: 30000, skuVariant: 'A' }, { order: 'O2', name: 'Buku A', qty: 1, price: 30000, skuVariant: 'A' }];
const hitung = (catalog, extra = {}, orders = ORD(), lines = EXP) => E.compute([E.parseWorkbook(Sint.penghasilan(orders)), E.parseWorkbook(Sint.exportPesanan(lines))],
  { modalMode: 'produk', catalog, periods: [{ start: '', markup: 0, disc: 0 }], ...extra }, {});
const A = (riwayat, base = {}) => [{ kode: 'A', nama: 'Buku A', variasi: '', ...base, riwayat }];

test('R1 Tingkat 1 (contoh customer): 10 Nov Rp10.000, 25 Nov Rp15.000 → pesanan 20 Nov = 10.000, 27 Nov = 15.000', () => {
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000 }, { mulai: '2026-11-25', cost: 15000 }]));
  eq(r.totalModal, 25000); eq(r.coverage, 1);
  eq(r.products[0].modalRiwayat, 'tanggal');
  const satu = hitung(A([{ mulai: '2026-11-10', cost: 10000 }, { mulai: '2026-11-25', cost: 15000 }]), {}, ORD('2026-11-27 10:00', '2026-11-27 10:00'));
  eq(satu.totalModal, 30000, 'dua-duanya setelah 25 Nov');
});
test('R2 Tingkat 2: 20 × 10.000 + 10 × 15.000 → pesanan 27 Nov = 11.666,67; pesanan 20 Nov = 10.000', () => {
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000, jumlah: 20 }, { mulai: '2026-11-25', cost: 15000, jumlah: 10 }]));
  near(r.totalModal, 10000 + 350000 / 30); eq(r.products[0].modalRiwayat, 'rata');
});
test('R3 catatan campuran (salah satu tanpa jumlah) → Tingkat 1 (harga terakhir)', () => {
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000, jumlah: 20 }, { mulai: '2026-11-25', cost: 15000 }]));
  eq(r.totalModal, 25000, '20 Nov: satu catatan berjumlah (rata-rata = 10.000); 27 Nov: campuran → harga terakhir 15.000');
});
test('R4 pesanan sebelum catatan pertama: pakai modal awal bila ada; tanpa modal awal → tidak dihitung (bukan 0, bukan catatan pertama)', () => {
  const awal = hitung(A([{ mulai: '2026-11-25', cost: 15000 }], { cost: 9000 }));
  eq(awal.totalModal, 9000 + 15000);
  const tanpa = hitung(A([{ mulai: '2026-11-25', cost: 15000 }]));
  eq(tanpa.totalModal, 15000); eq(tanpa.coverage, 0.5, 'pesanan 20 Nov tidak dihitung');
});
test('R5 tanggal sama dengan tanggal mulai → catatan itu berlaku', () => {
  eq(hitung(A([{ mulai: '2026-11-20', cost: 12000 }]), {}, ORD('2026-11-20 08:00', '2026-11-20 23:59')).totalModal, 24000);
});
test('R6 catatan harga sampul memakai diskon pemasok; tanpa diskon → tidak diketahui (tidak memakai catatan lain)', () => {
  eq(hitung(A([{ mulai: '2026-11-10', sampul: 20000 }, { mulai: '2026-11-25', sampul: 25000 }]), { mitra: 30 }).totalModal, 14000 + 17500);
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000 }, { mulai: '2026-11-25', sampul: 25000 }]), { mitra: null });
  eq(r.totalModal, 10000); eq(r.coverage, 0.5);
});
test('R7 status "perkiraan": modal dari riwayat tidak terverifikasi', () => {
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000 }]));
  eq(r.shopeeQty.hpp.terverifikasi || 0, 0); truthy((r.shopeeQty.hpp.estimasi || 0) >= 2, JSON.stringify(r.shopeeQty.hpp));
  const biasa = hitung([{ kode: 'A', nama: 'Buku A', variasi: '', cost: 10000 }]);
  truthy((biasa.shopeeQty.hpp.terverifikasi || 0) >= 2, 'tanpa riwayat tetap terverifikasi (regresi)');
  const awalSaja = hitung(A([{ mulai: '2027-01-01', cost: 99999 }], { cost: 10000 }));
  truthy((awalSaja.shopeeQty.hpp.terverifikasi || 0) >= 2, 'catatan belum berlaku → modal awal, status tidak diturunkan');
});
test('R8 modal manual ber-riwayat menang atas price list; tanpa modal pada tanggal itu → TIDAK diganti price list', () => {
  const pl = { jenis: 'modal', baris: [['A', 'Buku A', '', 8000]] };
  eq(hitung(A([{ mulai: '2026-11-10', cost: 10000 }]), { priceList: pl }).totalModal, 20000);
  const r = hitung(A([{ mulai: '2026-11-25', cost: 15000 }]), { priceList: pl });
  eq([r.totalModal, r.coverage], [15000, 0.5]);
});
test('R9 refund parsial tetap tidak diketahui (A.19.1)', () => {
  const r = hitung(A([{ mulai: '2026-11-10', cost: 10000 }]), {}, [{ id: 'O1', orderDate: '2026-11-20 10:00', items: [{ name: 'Buku A', harga: 30000, refund: -15000 }] }],
    [{ order: 'O1', name: 'Buku A', qty: 2, price: 22500, skuVariant: 'A' }]);
  eq(r.coverage, 0);
});
test('R10 data rusak diabaikan: tanggal salah, harga kosong/negatif, jumlah 0 → bukan Tingkat 2', () => {
  const c = E.buildCatalog(A([{ mulai: '20-11-2026', cost: 1 }, { mulai: '2026-11-10', cost: -5 }, { mulai: '2026-11-10' }, { mulai: '2026-11-12', cost: 10000, jumlah: 0 }]), 0);
  const e = c.find(['A'], '', '');
  eq(e.riwayat.length, 1); eq(e.riwayat[0].jumlah, null);
  eq(c.pada(e, '2026-11-20').metodeRiwayat, 'tanggal'); eq(c.pada(e, null), null, 'tanpa tanggal → tidak diketahui');
  eq(E.buildCatalog(A([]), 0).find(['A'], '', ''), null, 'riwayat kosong tanpa modal awal → tidak ada entri');
});
test('R11 regresi: data contoh tanpa riwayat identik; riwayat yang belum berlaku = modal awal (Shopee + TikTok)', () => {
  const parsed = D.make().map((wb) => E.parseWorkbook(wb));
  const s = D.settings();
  const a = E.compute(parsed, s, {});
  const nanti = E.compute(parsed, { ...s, catalog: s.catalog.map((e) => ({ ...e, riwayat: [{ mulai: '2099-01-01', cost: 1 }] })) }, {});
  eq([a.totalModal, a.totalMargin, a.coverage, a.tiktok.modal, a.shopee.modal], [nanti.totalModal, nanti.totalMargin, nanti.coverage, nanti.tiktok.modal, nanti.shopee.modal]);
  const ganda = E.compute(parsed, { ...s, catalog: s.catalog.map((e) => ({ ...e, riwayat: [{ mulai: '2000-01-01', cost: e.cost * 2 }] })) }, {});
  const dobel = E.compute(parsed, { ...s, catalog: s.catalog.map((e) => ({ ...e, cost: e.cost * 2 })) }, {});
  eq([Math.round(ganda.tiktok.modal), Math.round(ganda.shopee.modal)], [Math.round(dobel.tiktok.modal), Math.round(dobel.shopee.modal)], 'riwayat berlaku untuk semua pesanan = ganti modal (TikTok juga)');
  truthy(ganda.tiktok.modal > a.tiktok.modal, 'jalur TikTok memakai riwayat');
});
test('R12 sinkron M2: riwayat bagian dari entri modal (menambah catatan = perubahan entri)', () => {
  const K = S.kunciModal(E.norm);
  const awal = { catalog: [{ kode: 'A', nama: 'Buku A', variasi: '', cost: 10000 }] };
  const b = S.tandai(awal, { catalog: [{ ...awal.catalog[0], riwayat: [{ mulai: '2026-11-25', cost: 15000 }] }] }, 77, K);
  eq([b.catalog[0].diubah, b.catalogHapus.length], [77, 0]);
  eq(S.gabung(b, awal, 80, K).settings.catalog[0].riwayat.length, 1);
});

/* ---------- jumlah pesanan per periode harga (tampilan riwayat, 24 Nov 2026) ----------
 * Definisi: pesanan masuk ke catatan terakhir yang mulai pada/sebelum tanggal pesanannya (sama dengan A.23); pesanan
 * sebelum catatan pertama = "sebelum"; tanpa tanggal dihitung terpisah. Satu pesanan dihitung sekali per produk. */
test('P1 tglPesanan per produk dari laporan: 2 pesanan, 2 tanggal', () => {
  const p = hitung(A([{ mulai: '2026-11-25', cost: 15000 }], { cost: 10000 })).products.find((x) => x.name === 'Buku A');
  eq(p.tglPesanan, { '2026-11-20': 1, '2026-11-27': 1 });
});
test('P2 pesanan dengan dua baris produk yang sama dihitung sekali', () => {
  const ord = [{ id: 'O1', orderDate: '2026-11-20 10:00', items: [{ name: 'Buku A', harga: 30000 }, { name: 'Buku A', harga: 30000 }] }];
  const p = hitung(A([], { cost: 10000 }), {}, ord, [{ order: 'O1', name: 'Buku A', qty: 2, price: 30000, skuVariant: 'A' }]).products.find((x) => x.name === 'Buku A');
  eq(p.tglPesanan, { '2026-11-20': 1 });
});
test('P3 pesananPerPeriode: batas tanggal inklusif, sebelum catatan pertama, tanpa tanggal, urutan bebas', () => {
  const t = { '2026-11-01': 2, '2026-11-08': 3, '2026-11-14': 1, '2026-11-15': 4, '2026-11-30': 1, '': 2 };
  eq(E.pesananPerPeriode(t, ['2026-11-15', '2026-11-08']), { sebelum: 2, periode: [4, 5], tanpaTanggal: 2 });
});
test('P4 pesananPerPeriode: tanpa catatan / tanpa pesanan / tanggal catatan rusak diabaikan', () => {
  eq(E.pesananPerPeriode({ '2026-11-01': 2 }, []), { sebelum: 2, periode: [], tanpaTanggal: 0 });
  eq(E.pesananPerPeriode({}, ['2026-11-01']), { sebelum: 0, periode: [0], tanpaTanggal: 0 });
  eq(E.pesananPerPeriode(null, ['rusak', '2026-11-01']), { sebelum: 0, periode: [0], tanpaTanggal: 0 });
});
test('P5 pesananAntara: [dari, sampai) dan tanpa batas akhir; tanpa tanggal tidak dihitung', () => {
  const t = { '2026-11-01': 2, '2026-11-08': 3, '2026-11-15': 4, '': 9 };
  eq(E.pesananAntara(t, '2026-11-08', '2026-11-15'), 3);
  eq(E.pesananAntara(t, '2026-11-08'), 7);
  eq(E.pesananAntara(t, ''), 9);
});
test('P6 konsisten dengan modal per tanggal: jumlah per periode = pesanan yang memakai harga itu', () => {
  const r = hitung(A([{ mulai: '2026-11-25', cost: 15000 }], { cost: 10000 }));
  const p = r.products.find((x) => x.name === 'Buku A');
  eq(E.pesananPerPeriode(p.tglPesanan, ['2026-11-25']), { sebelum: 1, periode: [1], tanpaTanggal: 0 });
  eq(p.modal, 25000, 'modal 20 Nov = 10.000 (awal), 27 Nov = 15.000');
});

console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
process.exit(failed ? 1 : 0);
