/* Uji penggabungan pengaturan perangkat ↔ akun (assets/sinkron.js), perbaikan M2 (13 Nov 2026).
 *
 * Bagian A: kasus K1–K3 dari rencana, waktu sama persis, modal 0 vs kosong, catatan hapus 365 hari.
 * Bagian B: data lama (tanpa waktu ubah) tidak ada yang hilang saat pertama kali dibuka dengan versi baru; dibandingkan
 *           dengan SALINAN cara lama (oracle, assets/app.js commit 726ece3 baris 179–196).
 * Bagian C: field baru tidak mengubah angka laba (Engine.compute identik).
 * Bagian D: alur `sinkronkan` — baca gagal → tidak ada yang dikirim; lalu dua "perangkat" lewat server tiruan Supabase.
 *
 * Jalankan: node tests/sinkron.test.js
 */
const path = require('path');
const S = require('../assets/sinkron.js');
const Engine = require('../assets/engine.js');
const CekCloud = require('../assets/cloud.js');
const createMock = require('./mock-supabase.js');

let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const K = S.kunciModal(Engine.norm);
const T0 = Date.UTC(2026, 10, 13, 6, 0, 0);
const HARI = 24 * 3600 * 1000;
const modal = (s, kode) => (s.catalog.find((e) => e.kode === kode) || {}).cost;
const ada = (s, kode) => s.catalog.some((e) => e.kode === kode);
/** Tiru satu perangkat: simpan = tandai terhadap salinan terakhir. */
const perangkat = (awal) => {
  let dasar = JSON.parse(JSON.stringify(awal)), s = JSON.parse(JSON.stringify(awal));
  return {
    get s() { return s; },
    ubah(fn, kini) { fn(s); s = S.tandai(dasar, s, kini, K); dasar = JSON.parse(JSON.stringify(s)); },
    pakai(baru) { s = JSON.parse(JSON.stringify(baru)); dasar = JSON.parse(JSON.stringify(baru)); },
  };
};
const setModal = (kode, cost) => (s) => { s.catalog = s.catalog.filter((e) => e.kode !== kode); if (cost !== '') s.catalog.push({ kode, nama: kode, variasi: '', cost }); };
const LAMA = { modalMode: 'produk', packing: 1000, fixedCosts: [{ label: 'Gaji', amount: 500000 }], targetMargin: 15,
  catalog: [{ kode: 'A', nama: 'Buku A', variasi: '', cost: 50000 }, { kode: 'B', nama: 'Buku B', variasi: '', cost: 30000 }, { kode: 'C', nama: 'Buku C', variasi: '', cost: 20000 }] };

/* ================= A. aturan penggabungan ================= */
test('K1: modal diubah offline, akun masih nilai lama → nilai offline menang', () => {
  const hp = perangkat(LAMA);
  hp.ubah(setModal('A', 55000), T0);
  const g = S.gabung(hp.s, LAMA, T0 + 1000, K);
  eq(modal(g.settings, 'A'), 55000); eq(g.kalah, 0, 'tidak ada yang kalah');
});
test('K2: dua perangkat mengubah modal berbeda → keduanya bertahan', () => {
  const laptop = perangkat(LAMA), hp = perangkat(LAMA);
  laptop.ubah(setModal('A', 55000), T0);
  const akun = S.gabung(laptop.s, LAMA, T0, K).settings;        // laptop mengirim
  hp.ubah(setModal('B', 33000), T0 + 5000);                      // HP masih memegang data lama
  const g = S.gabung(hp.s, akun, T0 + 6000, K);
  eq(modal(g.settings, 'A'), 55000, 'perubahan laptop tetap ada'); eq(modal(g.settings, 'B'), 33000, 'perubahan HP tetap ada');
  eq(g.kalah, 1, 'modal A di HP (nilai lama) diganti isian terbaru');
});
test('K2b: dua perangkat mengubah modal yang sama → yang terbaru menang, perangkat yang kalah diberi tahu', () => {
  const laptop = perangkat(LAMA), hp = perangkat(LAMA);
  hp.ubah(setModal('A', 52000), T0);
  laptop.ubah(setModal('A', 58000), T0 + 9000);
  const akun = S.gabung(laptop.s, LAMA, T0 + 9000, K).settings;
  const g = S.gabung(hp.s, akun, T0 + 10000, K);
  eq(modal(g.settings, 'A'), 58000); eq(g.kalah, 1);
  const g2 = S.gabung(laptop.s, S.gabung(hp.s, LAMA, T0, K).settings, T0 + 10000, K);   // urutan kirim dibalik
  eq(modal(g2.settings, 'A'), 58000, 'hasil sama apa pun urutan kirimnya'); eq(g2.kalah, 0);
});
test('K3: modal dihapus di satu perangkat → tidak muncul lagi dari perangkat lain', () => {
  const laptop = perangkat(LAMA), hp = perangkat(LAMA);
  laptop.ubah(setModal('C', ''), T0);
  eq(laptop.s.catalogHapus.map((h) => h.k), ['k:c'], 'catatan hapus dibuat');
  const akun = S.gabung(laptop.s, LAMA, T0, K).settings;
  const g = S.gabung(hp.s, akun, T0 + 1000, K);
  truthy(!ada(g.settings, 'C'), 'C tidak muncul lagi'); eq(g.kalah, 1, 'modal C di HP terhapus → diberi tahu');
  truthy(!g.settings.catalog.some((e) => e.k), 'catatan hapus tidak masuk catalog');
});
test('K3b: modal yang dihapus lalu diisi lagi → isian baru menang, catatan hapus dibuang', () => {
  const laptop = perangkat(LAMA), hp = perangkat(LAMA);
  laptop.ubah(setModal('C', ''), T0);
  const akun = S.gabung(laptop.s, LAMA, T0, K).settings;
  hp.ubah(setModal('C', 21000), T0 + 1000);
  const g = S.gabung(hp.s, akun, T0 + 2000, K);
  eq(modal(g.settings, 'C'), 21000); eq(g.settings.catalogHapus, []);
  laptop.ubah(setModal('C', 22000), T0 + 3000);
  eq(laptop.s.catalogHapus, [], 'diisi lagi di perangkat yang sama → catatan hapus hilang');
});
test('Waktu ubah sama persis: isian di akun dipertahankan (modal, pengaturan, profil, hapus vs isi)', () => {
  const a = perangkat(LAMA), b = perangkat(LAMA);
  a.ubah((s) => { setModal('A', 51000)(s); s.packing = 1500; }, T0);
  b.ubah((s) => { setModal('A', 59000)(s); s.packing = 2500; }, T0);
  const akun = S.gabung(a.s, LAMA, T0, K).settings;
  const g = S.gabung(b.s, akun, T0, K);
  eq(modal(g.settings, 'A'), 51000, 'modal: akun'); eq(g.settings.packing, 1500, 'pengaturan: akun'); eq(g.kalah, 1);
  const c = perangkat(LAMA); c.ubah(setModal('B', ''), T0);   // hapus di akun vs isi di perangkat, waktu sama
  const d = perangkat(LAMA); d.ubah(setModal('B', 31000), T0);
  const akun2 = S.gabung(c.s, LAMA, T0, K).settings;
  truthy(!ada(S.gabung(d.s, akun2, T0, K).settings, 'B'), 'hapus di akun dipertahankan');
  truthy(ada(S.gabung(c.s, S.gabung(d.s, LAMA, T0, K).settings, T0, K).settings, 'B'), 'isi di akun dipertahankan');
  const pA = S.tandaiProfil({ store: 'Lama' }, { store: 'Toko A' }, T0), pB = S.tandaiProfil({ store: 'Lama' }, { store: 'Toko B' }, T0);
  eq(S.gabungProfil(pB, pA).store, 'Toko A', 'profil: akun');
});
test('Modal Rp0 tetap tersimpan sebagai 0; kosong = dihapus, bukan 0', () => {
  const hp = perangkat(LAMA);
  hp.ubah(setModal('A', 0), T0);
  eq(modal(hp.s, 'A'), 0); eq(hp.s.catalogHapus, []);
  const g = S.gabung(hp.s, LAMA, T0, K); eq(modal(g.settings, 'A'), 0, 'Rp0 dari perangkat menang atas Rp50.000 lama');
  hp.ubah(setModal('A', ''), T0 + 1);
  const g2 = S.gabung(hp.s, g.settings, T0 + 2, K);
  truthy(!ada(g2.settings, 'A'), 'kosong → tidak ada entri (tidak dianggap 0)');
});
test('Pengaturan per kunci: packing di perangkat A dan biaya operasional di B → keduanya bertahan', () => {
  const a = perangkat(LAMA), b = perangkat(LAMA);
  a.ubah((s) => { s.packing = 2000; }, T0);
  const akun = S.gabung(a.s, LAMA, T0, K).settings;
  b.ubah((s) => { s.fixedCosts[0].amount = 750000; }, T0 + 1000);   // diubah di tempat, seperti di app.js
  const g = S.gabung(b.s, akun, T0 + 2000, K).settings;
  eq(g.packing, 2000); eq(g.fixedCosts[0].amount, 750000); eq(g.targetMargin, 15);
});
test('Profil per kunci: nama toko di A, logo di B → keduanya bertahan', () => {
  const awal = { store: 'Toro', owner: '', logo: '' };
  const a = S.tandaiProfil(awal, { ...awal, store: 'Torobooks' }, T0);
  const b = S.tandaiProfil(awal, { ...awal, logo: 'data:image/png;base64,AA' }, T0 + 1000);
  const g = S.gabungProfil(b, S.gabungProfil(a, awal));
  eq([g.store, g.logo], ['Torobooks', 'data:image/png;base64,AA']);
});
test('Catatan hapus dibuang setelah 365 hari', () => {
  const hp = perangkat(LAMA);
  hp.ubah(setModal('C', ''), T0);
  hp.ubah((s) => { s.packing = 1; }, T0 + 364 * HARI);
  eq(hp.s.catalogHapus.length, 1, 'hari ke-364 masih ada');
  hp.ubah((s) => { s.packing = 2; }, T0 + 366 * HARI);
  eq(hp.s.catalogHapus.length, 0, 'hari ke-366 dibuang');
  eq(S.gabung({ catalog: [], catalogHapus: [{ k: 'k:c', diubah: T0 }] }, {}, T0 + 366 * HARI, K).settings.catalogHapus, [], 'gabung juga memangkas');
});
test('Modal yang tidak diubah tidak diberi waktu baru; isi sama dengan objek baru (impor template) juga tidak', () => {
  const hp = perangkat(LAMA);
  hp.ubah(setModal('A', 55000), T0);
  hp.ubah((s) => { s.packing = 9; }, T0 + 1000);
  eq(hp.s.catalog.find((e) => e.kode === 'A').diubah, T0, 'A tetap T0');
  truthy(hp.s.catalog.find((e) => e.kode === 'B').diubah === undefined, 'B lama tetap tanpa waktu');
  hp.ubah((s) => { s.catalog = s.catalog.map((e) => ({ kode: e.kode, nama: e.nama, variasi: e.variasi, cost: e.cost })); }, T0 + 2000);
  eq(hp.s.catalog.find((e) => e.kode === 'A').diubah, T0, 'impor dengan nilai sama → waktu tidak berubah');
});
test('Data kosong: akun kosong, perangkat kosong, null', () => {
  const g = S.gabung({}, {}, T0, K); eq(g.settings.catalog, []); eq(g.kalah, 0);
  eq(S.gabung(null, null, T0, K).settings.catalog, []);
  eq(S.gabungProfil(null, null), { diubahKunci: {} });
});

/* ================= B. data lama tidak hilang ================= */
// Oracle: salinan cara lama (jangan diubah).
const lamaKunci = (e) => (e.kode ? `k:${Engine.norm(e.kode)}` : `n:${Engine.norm(`${e.nama} ${e.variasi || ''}`)}`);
const lamaUnion = (base, extra) => { const m = new Map(base.map((e) => [lamaKunci(e), e])); for (const e of extra) if (!m.has(lamaKunci(e))) m.set(lamaKunci(e), e); return [...m.values()]; };
const tanpaMeta = (s) => { const { catalogHapus, diubahKunci, ...r } = s; return { ...r, catalog: r.catalog.map(({ diubah, ...e }) => e) }; };
test('Kunci modal sama dengan kunci lama', () => {
  for (const e of [...LAMA.catalog, { kode: '', nama: 'Kaos  Polos', variasi: 'XL' }, { nama: 'Buku', variasi: '' }]) eq(K(e), lamaKunci(e));
});
test('Pertama kali dibuka dengan versi baru (satu perangkat, data sama): hasil = isi akun, tidak ada yang hilang', () => {
  const g = S.gabung(LAMA, LAMA, T0, K);
  eq(tanpaMeta(g.settings), { ...LAMA, catalog: LAMA.catalog }); eq(g.kalah, 0);
});
test('Pertama kali dibuka: setiap modal & pengaturan di akun tetap utuh; modal yang hanya di perangkat ikut disimpan', () => {
  const akun = { ...LAMA, targetMargin: 20, catalog: [...LAMA.catalog, { kode: '', nama: 'Kaos', variasi: 'XL', cost: 40000 }] };
  const lokal = { ...LAMA, packing: 3000, catalog: [{ kode: 'A', nama: 'Buku A', variasi: '', cost: 99999 }, { kode: 'D', nama: 'Buku D', variasi: '', cost: 15000 }] };
  const g = S.gabung(lokal, akun, T0, K).settings;
  for (const e of akun.catalog) eq(g.catalog.find((x) => K(x) === K(e)).cost, e.cost, `modal ${K(e)} di akun utuh`);
  for (const k of Object.keys(akun)) if (k !== 'catalog') eq(g[k], akun[k], `pengaturan ${k} di akun utuh`);
  eq(modal(g, 'D'), 15000, 'modal yang hanya di perangkat tetap ikut');
  eq(g.catalog.map(lamaKunci), lamaUnion(akun.catalog, lokal.catalog).map(lamaKunci), 'isi dan urutan modal = cara lama');
});
test('Ribuan modal lama (3.000 produk): semua tetap utuh', () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ kode: `SKU-${i}`, nama: `Judul ${i}`, variasi: '', cost: 1000 + i }));
  const g = S.gabung({ catalog: [] }, { ...LAMA, catalog: big }, T0, K).settings;
  eq(g.catalog.length, 3000); truthy(big.every((e, i) => g.catalog[i].cost === e.cost && g.catalog[i].kode === e.kode));
});

/* ================= C. angka laba tidak berubah ================= */
test('Engine.compute identik dengan dan tanpa field baru (data contoh: Shopee + TikTok + retur)', () => {
  const D = require('../assets/demo.js');
  const parsed = D.make().map((wb) => Engine.parseWorkbook(wb));
  const polos = D.settings();
  truthy(polos.catalog.length > 0, 'data contoh punya modal');
  const bertanda = S.tandai({ ...polos, catalog: [] }, polos, T0, K);
  bertanda.catalogHapus = [{ k: 'k:hilang', diubah: T0 }];
  bertanda.diubahKunci = { packing: T0 };
  truthy(bertanda.catalog.every((e) => e.diubah === T0), 'semua bertanda');
  const r1 = Engine.compute(parsed, polos, {}), r2 = Engine.compute(parsed, bertanda, {});
  truthy(r1.totalModal > 0, 'modal terhitung');
  eq([r1.totalSales, r1.totalModal, r1.totalMargin, r1.netProfit, r1.coverage], [r2.totalSales, r2.totalModal, r2.totalMargin, r2.netProfit, r2.coverage]);
  eq(r1.products.map((p) => [p.key, p.margin, p.baseCost]), r2.products.map((p) => [p.key, p.margin, p.baseCost]));
});

/* ================= D. alur sinkron ================= */
test('Baca akun gagal (offline/error) → TIDAK ada yang dikirim, status tunda', async () => {
  let kirim = 0;
  const r = await S.sinkronkan({ baca: async () => { throw new Error('Failed to fetch'); }, kirim: async () => { kirim++; },
    settings: LAMA, profile: {}, kini: T0, kunci: K });
  eq(r.status, 'tunda'); eq(kirim, 0);
});
test('Baca berhasil, kirim gagal → status gagal-kirim; hasil gabungan tetap dikembalikan untuk disimpan di perangkat', async () => {
  const r = await S.sinkronkan({ baca: async () => ({ settings: { ...LAMA, packing: 7 }, profile: {} }), kirim: async () => { throw new Error('500'); },
    settings: LAMA, profile: {}, kini: T0, kunci: K });
  eq(r.status, 'gagal-kirim'); eq(r.settings.packing, 7);
});
test('Akun belum punya data (null) → isi perangkat dikirim', async () => {
  let dikirim = null;
  const r = await S.sinkronkan({ baca: async () => null, kirim: async (d) => { dikirim = d; }, settings: LAMA, profile: { store: 'X' }, kini: T0, kunci: K });
  eq(r.status, 'terkirim'); eq(modal(dikirim.settings, 'A'), 50000); eq(dikirim.profile.store, 'X');
});
test('Sudah sama dengan akun → tidak mengirim ulang (urutan kunci tidak berpengaruh)', async () => {
  const g = S.gabung(LAMA, LAMA, T0, K).settings;
  const akun = Object.fromEntries(Object.entries(g).reverse());
  let kirim = 0;
  const r = await S.sinkronkan({ baca: async () => ({ settings: akun, profile: { diubahKunci: {} } }), kirim: async () => { kirim++; }, settings: g, profile: {}, kini: T0, kunci: K });
  eq(r.status, 'sama'); eq(kirim, 0);
});
test('Dua perangkat lewat server tiruan Supabase: K2 + K3, offline lalu menyusul', async () => {
  const mock = createMock({ tokenTtl: 3600 });
  await new Promise((res) => mock.server.listen(0, res));
  const url = `http://127.0.0.1:${mock.server.address().port}`;
  const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  try {
    mock.addUser('seller@toko.id', 'sandiku123', {});
    const masuk = async () => { const c = CekCloud.init({ url, key: 'anon', store: memStore() }); await c.auth.signIn({ email: 'seller@toko.id', password: 'sandiku123' }); return c; };
    const laptopC = await masuk(), hpC = await masuk();
    await laptopC.db.saveData({ settings: LAMA, profile: { store: 'Toro' } });   // data lama di akun (versi sebelumnya)
    const putaran = (c, dev, profile, kini, gagalBaca = false) => S.sinkronkan({
      baca: gagalBaca ? async () => { throw new Error('offline'); } : () => c.db.loadData(), kirim: (d) => c.db.saveData(d),
      settings: dev.s, profile, kini, kunci: K }).then((r) => { if (r.settings) dev.pakai(r.settings); return r; });
    const laptop = perangkat(LAMA), hp = perangkat(LAMA);
    eq((await putaran(laptopC, laptop, { store: 'Toro' }, T0)).status, 'terkirim', 'pertama kali: field baru ditambahkan');
    eq(tanpaMeta((await laptopC.db.loadData()).settings), LAMA, 'data lama di akun utuh setelah dibuka versi baru');
    laptop.ubah(setModal('A', 55000), T0 + 1000); laptop.ubah(setModal('C', ''), T0 + 1000);
    await putaran(laptopC, laptop, { store: 'Toro' }, T0 + 2000);
    hp.ubah(setModal('B', 33000), T0 + 3000);
    const off = await putaran(hpC, hp, { store: 'Toro' }, T0 + 3500, true);
    eq(off.status, 'tunda'); eq(modal((await hpC.db.loadData()).settings, 'B'), 30000, 'offline: akun tidak berubah');
    const r = await putaran(hpC, hp, { store: 'Toro' }, T0 + 4000);
    const akhir = (await hpC.db.loadData()).settings;
    eq([modal(akhir, 'A'), modal(akhir, 'B'), ada(akhir, 'C')], [55000, 33000, false]);
    eq(r.kalah, 2, 'HP diberi tahu: A diperbarui, C dihapus dari perangkat lain');
    await putaran(laptopC, laptop, { store: 'Toro' }, T0 + 5000);
    eq(modal(laptop.s, 'B'), 33000, 'laptop menerima perubahan HP');
  } finally { mock.server.close(); }
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); }
  }
  console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
  process.exit(failed ? 1 : 0);
})();
