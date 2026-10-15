/* Uji teks & tampilan (UI-P0): laporan PDF dan penjelasan angka tidak membuat klaim berlebihan,
 * dan nilai yang tidak diketahui tidak tampil sebagai Rp0 / NaN / Infinity.
 * Jalankan: node tests/tampilan.test.js
 * Data di sini SINTETIS (struktur kolom saja); tidak ada data toko atau pembeli asli.
 */
const fs = require('fs');
const path = require('path');
const E = require('../assets/engine.js');
const CekReport = require('../assets/report.js');
const CekInfo = require('../assets/penjelasan.js');
const Demo = require('../assets/demo.js');
const Sint = require('./fixtures/shopee-sintetis.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${a} !== ${b}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');
const teks = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** File retur Shopee sintetis. amount '' = nominal refund kosong (tidak diketahui). */
const returShopee = (rows) => E.parseWorkbook({ name: 'retur-sintetis.xlsx', sheets: { S: [['No. Pengembalian', 'No. Pesanan', 'Nama Produk', 'Variasi',
  'Jumlah Produk Dikembalikan', 'Total Pengembalian Dana', 'Status Pembatalan/ Pengembalian', 'Solusi Pengembalian Barang/Dana', 'Alasan Pengembalian',
  'Waktu Pengembalian Diajukan', 'No. Resi Pengembalian Barang'],
...rows.map((x, i) => [x.id || `R${i + 1}`, x.order, 'Kaos', '', x.qty ?? 1, x.amount, 'Selesai', x.solusi || 'Pengembalian Barang dan Dana', x.alasan || 'Rusak', '2026-01-12', ''])] } });
const penghasilan = (refund = -100000) => E.parseWorkbook(Sint.penghasilan([{ id: 'S1', items: [{ name: 'Kaos', harga: 100000, refund }] },
  { id: 'S2', items: [{ name: 'Topi', harga: 80000 }] }]));
const stRata = { modalMode: 'produk', catalog: [], fallbackPct: 40 };
const pdf = (r) => CekReport.html(r, { settings: {}, profile: {}, filter: {}, brand: 'Cek Profit' });
/** PDF tidak boleh berisi NaN/Infinity dalam bentuk apa pun (teks maupun style), termasuk teks temuan dari engine. */
const bersih = (html, label = '') => { truthy(!/NaN|Infinity/.test(html), `${label} PDF berisi NaN/Infinity`); };
/** "Margin" hanya untuk persen: tidak boleh langsung diikuti nilai rupiah (seluruh PDF, termasuk temuan). */
const tanpaMarginRp = (html, label = '') => {
  truthy(!/Margin\s*(kotor\s*)?:?\s*−?Rp/i.test(teks(html)), `${label} masih ada "Margin Rp"`);
};

test('1 refund belum dicek dengan nominal diketahui → risiko bernilai, tanpa NaN', () => {
  const r = E.compute([penghasilan(), returShopee([{ order: 'S1', amount: 100000 }])], stRata);
  truthy(r.unknownRisk > 0, 'prasyarat: ada risiko bernilai');
  const h = pdf(r); bersih(h, '1');
  truthy(teks(h).includes('risiko Rp40.000'), 'risiko bernilai tetap ditampilkan');
});
test('2–3 refund tanpa nominal (risikoTanpaNilai > 0) → bukan "risiko Rp0", disebut kasus tanpa nilai', () => {
  const r = E.compute([penghasilan(), returShopee([{ order: 'S1', amount: '' }])], stRata);
  eq(r.kepastian.risikoBarang.risikoTanpaNilai, 1, 'prasyarat');
  const t = teks(pdf(r));
  bersih(pdf(r), '2');
  truthy(!t.includes('risiko Rp0'), 'tidak boleh "risiko Rp0"');
  truthy(t.includes('risiko belum bisa dihitung: 1 kasus tanpa nilai'), 'kasus tanpa nilai disebut');
  truthy(t.includes('nilainya belum diketahui'), 'nominal refund tidak dijumlahkan sebagai Rp0');
});
test('4 kerugianTanpaNilai > 0 → tidak ditulis sebagai Rp0 yang sudah dikurangkan', () => {
  const r = E.compute([penghasilan(), returShopee([{ id: 'RH', order: 'S1', amount: '' }])], stRata, { 'S|RH|Kaos|': 'hilang' });
  eq(r.kepastian.risikoBarang.kerugianTanpaNilai, 1, 'prasyarat');
  const h = pdf(r), t = teks(h); bersih(h, '4');
  truthy(t.includes('1 kasus tanpa nilai belum dikurangkan'), 'baris laba rugi menyebut kasus tanpa nilai');
  truthy(!t.includes('modal Rp0 sudah dikurangkan'), 'tidak boleh "modal Rp0 sudah dikurangkan"');
});
test('5 amountUnknown > 0 → batang kategori tanpa angka palsu, label "tanpa nilai"', () => {
  const r = E.compute([penghasilan(), returShopee([{ order: 'S1', amount: '' }, { order: 'S1', amount: 50000 }])], stRata);
  const cat = r.catSummary.find((c) => c.cat === 'retur_barang');
  eq(cat.amountUnknown, 1, 'prasyarat'); truthy(Number.isNaN(cat.amount), 'prasyarat: total kategori NaN');
  const h = pdf(r), t = teks(h); bersih(h, '5');
  truthy(t.includes('1 tanpa nilai'), 'label kategori menyebut kasus tanpa nilai');
  truthy(t.includes('ditambah 1 kasus yang nilainya belum diketahui'), 'total refund tidak menggabungkan yang tidak diketahui');
  // Hanya nominal yang diketahui yang dijumlahkan (Rp50.000), bukan dibaca sebagai total lengkap.
  truthy(t.includes('senilai Rp50.000'), 'jumlah yang diketahui');
});
test('6 PDF tanpa NaN/Infinity: kategori dengan SEMUA nominal tidak diketahui tidak diberi batang', () => {
  const r = E.compute([penghasilan(), returShopee([{ order: 'S1', amount: '' }])], stRata);
  const h = pdf(r); bersih(h, '6');
  truthy(teks(h).includes('Nilai belum diketahui'), 'baris batang menyebut nilai belum diketahui');
});
test('6b data contoh & modal tidak diketahui: PDF tetap tanpa NaN/Infinity', () => {
  const parsed = Demo.make().map((wb) => E.parseWorkbook(wb));
  bersih(pdf(E.compute(parsed, Demo.settings())), 'contoh');
  bersih(pdf(E.compute(parsed, { modalMode: 'produk', catalog: [] })), 'tanpa modal');
});
test('7 "Margin" tidak dipakai untuk nilai rupiah di PDF', () => {
  const parsed = Demo.make().map((wb) => E.parseWorkbook(wb));
  tanpaMarginRp(pdf(E.compute(parsed, Demo.settings())), 'contoh');
  tanpaMarginRp(pdf(E.compute([penghasilan(0)], stRata)), 'sintetis');
  for (const f of ['app.js', 'report.js']) truthy(!/Margin kotor|Margin setelah modal|Margin per (unit|pesanan|bulan)/.test(src(f)), `${f} masih memakai label "Margin" untuk rupiah`);
});
test('8 tidak ada teks "benar-benar tersisa"; penjelasan laba menyebut perkiraan, bukan kas', () => {
  for (const f of ['app.js', 'report.js', 'penjelasan.js']) truthy(!/benar-benar tersisa/.test(src(f)), `${f}`);
  const lb = CekInfo.get('laba_bersih', null);
  truthy(/Perkiraan laba dari data yang tersedia/.test(lb.a) && /bukan saldo kas/.test(lb.a), 'penjelasan laba bersih');
  truthy(!/pasti/.test(CekInfo.get('modal_rata', null).b), 'modal rata-rata tidak menjanjikan hasil pasti');
});
test('9 "tidak dikirim" tidak ditulis sebagai fakta', () => {
  for (const f of ['app.js', 'report.js', 'penjelasan.js']) {
    const s = src(f);
    truthy(!/tidak memakan modal/.test(s), `${f}: "tidak memakan modal"`);
    truthy(!/stok kosong\) tidak perlu dicek/.test(s), `${f}: "tidak perlu dicek"`);
  }
  const r = E.compute([penghasilan(), returShopee([{ order: 'S1', amount: 100000, solusi: 'Pengembalian Dana', alasan: 'Barang tidak lengkap' }])], stRata);
  eq(r.cases[0].cat, 'tidak_dikirim', 'prasyarat');
  const t = teks(pdf(r));
  truthy(t.includes('Terindikasi tidak dikirim (menurut alasan di marketplace)'), 'label indikasi di PDF');
  truthy(t.includes('kondisi barangnya belum dipastikan'), 'keterangan indikasi di PDF');
});
test('10 penjelasan angka: semua entri bisa dibaca (r = null maupun hasil hitung)', () => {
  const r = E.compute(Demo.make().map((wb) => E.parseWorkbook(wb)), Demo.settings());
  for (const k of CekInfo.keys()) { const a = CekInfo.get(k, null), b = CekInfo.get(k, r); truthy(a && a.t && a.a && b && b.t, k); truthy(!/NaN|Infinity/.test(`${b.a}${b.h}${b.b}${b.d}`), `${k}: NaN`); }
});

/* ===== UI-1: kerangka aplikasi (pemeriksaan statis, tanpa browser) ===== */
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const appJs = src('app.js');
/** Ambil daftar VIEWS dan NAV dari app.js tanpa menjalankannya (app.js butuh DOM). */
const daftar = (nama) => { const m = appJs.match(new RegExp(`const ${nama} = \\[([\\s\\S]*?)\\n  \\];`)); truthy(m, `${nama} tidak ditemukan`); return m[1]; };
test('S1 menu: semua label wajib ada dan setiap menu menuju tampilan yang sudah ada', () => {
  const views = [...daftar('VIEWS').matchAll(/\['(\w+)', '/g)].map((x) => x[1]);
  eq(views.join(','), 'ringkasan,produk,biaya,retur,simulator,riwayat,data', 'tampilan lama tetap ada');
  const nav = [...daftar('NAV').matchAll(/\['(\w+)', '([^']+)', '(\w+)'(?:, '(\w+)')?\]/g)].map((x) => ({ k: x[1], label: x[2], view: x[3], section: x[4] }));
  eq(nav.map((n) => n.label).join(' | '), 'Ringkasan | Laba | Produk | Retur & refund | Simulator harga | Laporan & riwayat | Unggah data | Modal & HPP | Pengaturan');
  for (const n of nav) truthy(views.includes(n.view), `menu ${n.label} menuju tampilan yang tidak ada: ${n.view}`);
  for (const n of nav.filter((x) => x.section)) truthy(appJs.includes(`id="sec-${n.section}"`), `bagian #sec-${n.section} tidak ada di tampilan Data`);
  for (const g of ['Utama', 'Data & laporan', 'Lainnya']) truthy(daftar('NAV').includes(`['${g}',`), `kelompok ${g}`);
});
test('S2 bilah bawah HP: 4 menu utama + "Lainnya" yang berisi sisa menu; lembar memakai <dialog>', () => {
  truthy(/const BOTTOM = \['ringkasan', 'laba', 'produk', 'retur'\]/.test(appJs), 'isi bilah bawah');
  truthy(/data-sheet="more"/.test(appJs) && /Lainnya/.test(appJs), 'tombol Lainnya');
  truthy(/<nav class="bnav[^"]*" id="bnav"/.test(html), 'wadah bilah bawah di dashboard.html');
  truthy(/<dialog id="sheet" class="dialog sheet"/.test(html), 'lembar memakai dialog bawaan');
});
test('S3 aksesibilitas: #view tanpa aria-live; area status selalu ada (tidak hidden)', () => {
  truthy(!/id="view"[^>]*aria-live/.test(html), '#view masih memakai aria-live');
  const t = html.match(/<div id="toast"[^>]*>/); truthy(t, 'toast ada');
  truthy(/role="status"/.test(t[0]) && /aria-live="polite"/.test(t[0]) && !/\shidden/.test(t[0]), `toast: ${t[0]}`);
  truthy(!/t\.hidden = /.test(appJs), 'toast tidak boleh disembunyikan dengan atribut hidden');
});
test('S4 gerak: semua animasi/transisi dimatikan bila pengguna memilih kurangi gerakan', () => {
  const base = src('base.css');
  truthy(/prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after, ::backdrop \{ transition: none !important; animation: none !important;/.test(base), 'aturan reduced-motion');
  truthy(/--dur-fast: 150ms; --dur: 200ms; --dur-slow: 250ms;/.test(base), 'durasi gerak 150–250 ms');
  truthy(/reducedMotion\(\)/.test(appJs), 'penutupan lembar menghormati reduced-motion');
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
