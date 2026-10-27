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
const near = (a, b, tol, msg = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} ${a} ≉ ${b}`); };
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
const pdf = (r) => CekReport.html(r, { settings: {}, profile: {}, filter: {}, brand: 'Cek Untung' });
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

/* ===== UI-2: dashboard memakai metadata engine apa adanya ===== */
const dashSrc = appJs.slice(appJs.indexOf('/* ---------- ringkasan (UI-2)'), appJs.indexOf('  function nota(r) {'));
const covKeys = [...daftar('COV').matchAll(/\['(\w+)', '(\w+)', '([^']+)'/g)].map((x) => x[1]);
const kasus = {
  terverifikasi: () => [E.parseWorkbook(Sint.penghasilan([{ id: 'SA1', items: [{ name: 'Kaos', harga: 100000 }] }])), E.parseWorkbook(Sint.exportPesanan([{ order: 'SA1', name: 'Kaos', qty: 2, price: 50000 }]))],
  campuran: () => [E.parseWorkbook(Sint.penghasilan([{ id: 'SB1', items: [{ name: 'Kaos', harga: 100000 }] }, { id: 'SB2', items: [{ name: 'Topi', harga: 60000 }] }, { id: 'SB3', items: [{ name: 'Kaos', harga: 50000 }] },
    { id: 'SB4', items: [{ name: 'Kaos', harga: 100000, refund: -40000 }] }, { id: 'SB5', items: [{ name: 'Kaos', harga: 70000 }] }, { id: 'SB6', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }])),
  // H2-B3b: SB4 (refund parsial) diberi jumlah unit refund di export; tanpa itu HPP-nya tidak diketahui (bukan lagi "belum").
  E.parseWorkbook(Sint.exportPesanan([{ order: 'SB1', name: 'Kaos', qty: 2, price: 50000 }, { order: 'SB4', name: 'Kaos', qty: 2, price: 50000, returned: 1, returnStatus: 'Permintaan Disetujui' }, { order: 'SB5', name: 'Celana', qty: 1, price: 70000 }]))],
};
const stKaos = { modalMode: 'produk', catalog: [{ kode: '', nama: 'Kaos', variasi: '', cost: 20000 }], fallbackPct: 40, periods: [{ start: '', markup: 0, disc: 0 }] };
test('D1 status di kartu Kepastian Profit = semua status cakupan engine (tidak ada status buatan UI)', () => {
  const r = E.compute(kasus.campuran(), stKaos);
  const keys = Object.keys(r.kepastian.cakupan.penjualan).filter((k) => k !== 'total');
  eq(covKeys.join(','), keys.join(','), 'kunci status');
  for (const k of keys) truthy(r.kepastian.cakupan.penjualan[k] > 0, `kasus campuran punya status ${k}`);
});
test('D2 data yang dipakai dashboard tersedia dan bebas NaN/Infinity (100% terverifikasi, campuran, tanpa modal)', () => {
  for (const [nama, files, s] of [['terverifikasi', kasus.terverifikasi(), stKaos], ['campuran', kasus.campuran(), stKaos], ['tanpa modal', kasus.campuran(), { modalMode: 'produk', catalog: [] }]]) {
    const r = E.compute(files, s), K = r.kepastian;
    truthy(typeof K.laba.final === 'boolean' && Array.isArray(K.laba.alasanTidakFinal), `${nama}: status final`);
    const pakai = { cov: r.coverage, dasar: K.cakupan.labaTerhitung.dasarPenjualan, total: K.cakupan.penjualan.total, sales: r.totalSales, fees: r.totalFees, dikeluarkan: K.cakupan.dikeluarkan.danaDiterima };
    for (const [k, v] of Object.entries(pakai)) truthy(Number.isFinite(v), `${nama}: ${k} = ${v}`);
    if (nama === 'tanpa modal') eq(r.ready, false, 'tanpa modal: laba belum dapat dihitung'); else truthy(Number.isFinite(r.totalMargin), `${nama}: laba`);
  }
});
test('D3 dashboard tidak menghitung angka finansial baru dan tidak membuat skor', () => {
  truthy(dashSrc.length > 1000, 'kode dashboard ditemukan');
  for (const pola of [/totalMargin\s*\//, /netProfit\s*\//, /\/\s*r\.totalSales/, /totalFees\s*\//, /\/\s*r\.knownSales/, /\*\s*100\)\s*\}?\s*\/\s*100/])
    truthy(!pola.test(dashSrc), `pola pembagian finansial di dashboard: ${pola}`);
  truthy(!/skor|score\s*[:=]\s*[^i]/i.test(dashSrc.replace(/i\.score/g, '')), 'tidak ada skor Profit Confidence');
  truthy(/K\.laba\.final \?/.test(dashSrc), 'status "Belum final" berasal dari kepastian.laba.final engine');
  truthy(/pct\(r\.coverage, 0\)/.test(dashSrc), '"dihitung dari X% penjualan" memakai r.coverage dari engine');
});
test('D4 istilah: tidak ada "Laba bersih" yang tampil; margin hanya persen', () => {
  for (const f of ['app.js', 'report.js', 'penjelasan.js']) truthy(!/['"`>]\s*Laba bersih|laba bersih[^_]/.test(src(f).replace(/laba_bersih/g, '')), `${f} masih menampilkan "Laba bersih"`);
});

/* Cakupan ≠ kepastian: persen cakupan berarti "masuk dalam perhitungan", bukan tingkat akurasi. */
const sheetSrc = appJs.slice(appJs.indexOf("if (sheetKind === 'kepastian')"), appJs.indexOf("if (sheetKind === 'filter')"));
test('D5 teks cakupan memakai arti "masuk dalam perhitungan", bukan akurasi', () => {
  truthy(sheetSrc.length > 500, 'kode laci Kepastian Profit ditemukan');
  truthy(/pct\(r\.coverage, 0\)\} penjualan masuk dalam perhitungan/.test(dashSrc), 'hero: "X% penjualan masuk dalam perhitungan"');
  truthy(/<\/b> penjualan \(\$\{fmt\(c\.labaTerhitung\.dasarPenjualan\)\}\) masuk dalam perhitungan laba/.test(dashSrc), 'kartu: "X% penjualan (Rp…) masuk dalam perhitungan laba"');
  truthy(/penjualan masuk dalam perhitungan laba\.[^<]*Ini bukan tingkat akurasi/.test(sheetSrc), 'laci: cakupan dijelaskan bukan tingkat akurasi');
  truthy(!/Laba dihitung dari/.test(appJs), 'tidak ada lagi "Laba dihitung dari X%"');
  truthy(/Seberapa kuat data yang mendasari perhitungan laba Anda/.test(dashSrc), 'subjudul Kepastian Profit');
});
test('D6 tidak ada klaim akurasi berpersen dan tidak ada skor tunggal Profit Confidence', () => {
  for (const f of ['app.js', 'report.js', 'penjelasan.js']) {
    const s = src(f);
    truthy(!/\d+\s*%\s*akurat|\}\s*%?\s*akurat|akurasi\s*\$\{|akurasi\s+\d/i.test(s), `${f}: ada klaim "X% akurat"/"akurasi X%"`);
  }
  truthy(!/skor|score\s*[:=]\s*[^i]/i.test(sheetSrc.replace(/tidak digabung menjadi satu skor/, '').replace(/i\.score/g, '')), 'laci tidak membuat skor');
  truthy(/tidak digabung menjadi satu skor/.test(sheetSrc), 'laci menyatakan cakupan dan kualitas tidak digabung jadi satu skor');
});
test('D7 cakupan 100% + "perlu dicek" 100% tidak tampil sebagai terverifikasi', () => {
  const r = E.compute(Demo.make().map((wb) => E.parseWorkbook(wb)), Demo.settings()), c = r.kepastian.cakupan.penjualan;
  eq(r.coverage, 1, 'cakupan contoh');
  eq(c.belum, c.total, 'semua penjualan berstatus perlu dicek');
  eq(c.terverifikasi, 0, 'tidak ada yang terverifikasi');
  eq(r.kepastian.laba.final, false, 'laba belum final');
  // Lencana "Terverifikasi" hanya muncul bila engine punya penjualan terverifikasi; kalimat peringatan muncul bila ada "perlu dicek".
  truthy(/c\.penjualan\.terverifikasi > 0 \? '<div class="m-status"><span class="status verified">Terverifikasi/.test(dashSrc), 'lencana Terverifikasi bergantung pada cakupan.terverifikasi');
  truthy(/covCaveat = \(c\) => \(c\.penjualan\.belum > 0 \? ' Namun sebagian angka masih perlu diperiksa\.'/.test(dashSrc), 'peringatan "perlu diperiksa" bergantung pada cakupan.belum');
  truthy(/masuk dalam perhitungan laba\.\$\{covCaveat\(c\)\}/.test(dashSrc) && /\$\{covCaveat\(r\.kepastian\.cakupan\)\}/.test(sheetSrc), 'peringatan dipasang di kartu dan laci');
});

/* ===== UI-3: halaman Laba dan Produk memakai angka engine apa adanya ===== */
const cut = (from, to) => { const a = appJs.indexOf(from), b = appJs.indexOf(to, a + 1); truthy(a >= 0 && b > a, `bagian kode ${from}`); return appJs.slice(a, b); };
const labaSrc = cut('/* ---------- laba (UI-3)', '  /* ---------- retur ---------- */');
const prodSrc = cut('/* ---------- produk (UI-3)', '  /* ---------- laba (UI-3)');
const notaSrc = cut('  function nota(r) {', '  function facts(r) {');
test('U1 Laba/Produk/nota tidak membuat margin baru di UI', () => {
  for (const [nama, kode] of [['laba', labaSrc], ['produk', prodSrc], ['nota', notaSrc]]) {
    truthy(!/margin\s*\/|\/\s*[\w.]*knownSales|net\s*\/|netProfit\s*\/|total\s*\/\s*r\.totalSales/i.test(kode.replace(/b\.margin \/ b\.known/g, '')), `${nama}: pembagian margin/laba buatan UI`);
  }
  truthy(/trendCard\(r, \{ title: 'Tren laba', table: false \}\)/.test(labaSrc), 'halaman Laba tidak memakai tabel bulanan lama (yang memuat margin % buatan UI)');
  truthy(!/%/.test(cut('  function monthTable(r) {', '  function viewBiaya() {').replace(/style="[^"]*"/g, '')), 'tabel bulanan Laba tanpa persen');
  truthy(!/p\.\w+\s*[-+*/]\s*[\w(]/.test(cut('  function productSheet(r) {', '  /* ---------- laba (UI-3)')), 'laci produk tanpa hitungan dari field produk');
});
test('U2 nota & jejak uang: struktur, nilai belum diketahui, bukan rekonsiliasi pencairan', () => {
  for (const s of ["'Dana diterima'", "'Modal / HPP'", "'Kerugian retur'", "'Biaya operasional'", "'Laba dari data tersedia'"]) truthy(notaSrc.includes(s), `nota memuat ${s}`);
  truthy(/\+ \$\{num\(rb\.kerugianTanpaNilai\)\} kasus nilainya belum diketahui\./.test(notaSrc) && /\+ \$\{num\(rb\.kerugianTanpaNilai\)\} kasus nilainya belum diketahui\./.test(labaSrc), '"+ N kasus nilainya belum diketahui."');
  truthy(/ok\(v\) \? fmt\(v\) : '<span class="unk">Belum diketahui<\/span>'/.test(notaSrc), 'nota: nilai tidak diketahui → "Belum diketahui", bukan Rp0');
  truthy(labaSrc.includes('Berdasarkan laporan yang diunggah. Dana dilepas belum tentu sama dengan dana yang sudah masuk rekening.'), 'label jejak uang');
  truthy(!/saldo|terbaik|peringkat/i.test(labaSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'tanpa saldo/peringkat platform (di luar komentar)');
  truthy(/Refund ke pembeli sudah termasuk dalam penjualan, jadi tidak dikurangkan lagi di sini/.test(labaSrc), 'rincian biaya: refund tidak dikurangkan lagi');
});
test('MT-A1 jejak uang: status provenance, refund hanya rincian, pencairan tanpa Rp0, angka dari engine', () => {
  const tr = labaSrc.slice(labaSrc.indexOf('const TR_ST'), labaSrc.indexOf('/** Satu baris rincian biaya'));
  truthy(tr.length > 500, 'blok jejak uang ditemukan');
  for (const l of ["'Sesuai laporan dan terekonsiliasi'", "'Berdasarkan laporan, belum sepenuhnya terekonsiliasi'", "'Belum tersedia'", "'Perlu dicek'"]) truthy(tr.includes(l), `label status ${l}`);
  truthy(tr.includes('Data pencairan belum tersedia dalam analisis ini.'), 'teks pencairan persis');
  truthy(!/fmt\(J\.pencairan|val\(J\.pencairan/.test(tr), 'pencairan tidak pernah ditampilkan sebagai angka');
  truthy(/Refund tidak dikurangkan lagi\./.test(tr), 'refund dinyatakan sudah termasuk penjualan');
  // Langkah 1–3 memakai angka engine yang sama seperti sebelumnya; UI tidak menjumlah/mengurangi nilai Jejak Uang.
  for (const v of ['val(r.totalSales)', 'val(r.totalFees)', 'val(r.totalReceived)']) truthy(tr.includes(v), v);
  truthy(!/\.nilai\s*[-+*/]|[-+*/]\s*[A-Za-z.]*\.nilai\b/.test(tr), 'tanpa aritmetika atas nilai Jejak Uang di UI');
  truthy(/Basis tanggal:/.test(tr) && /tidak semua angka di atas memakai basis tanggal yang sama/.test(tr), 'basis tanggal per angka + peringatan basis berbeda');
  truthy(/esc\(why\.join/.test(tr) && /esc\(src\)/.test(tr), 'teks alasan & sumber di-escape');
  const pj = src('penjelasan.js'); truthy(/jejak_uang: \{/.test(pj), 'penjelasan jejak_uang ada');
});
test('TT-R4 tampilan: refund susulan tanpa pesanan asal punya item kepastian sendiri; Jejak uang membedakan total vs pencocokan', () => {
  truthy(/'Refund susulan belum dapat dicocokkan'/.test(appJs), 'item kepastian refund susulan');
  truthy(/Nilai refund tidak dipakai untuk menebak jumlah barang\./.test(appJs), 'tidak menebak unit dari nominal');
  truthy(/Total cocok dengan laporan, tetapi \$\{num\(rf\.susulanTidakCocok\)\} refund susulan TikTok belum dapat dicocokkan/.test(labaSrc), 'Jejak uang: total vs pencocokan transaksi');
});
test('MG-P11 tampilan: konflik antarlaporan → "Perlu rekonsiliasi", tidak memilih versi; duplikat tidak menurunkan status', () => {
  truthy(/perlu_rekonsiliasi: \['pending', 'Perlu rekonsiliasi'\]/.test(labaSrc), 'label status Perlu rekonsiliasi');
  truthy(/'Perlu rekonsiliasi: laporan berbeda'/.test(appJs) && /tidak dipilih salah satu versinya/.test(appJs), 'item kepastian konflik');
  truthy(/transaksi berbeda antarlaporan ditahan, tidak masuk angka di bawah/.test(labaSrc), 'catatan transaksi ditahan');
  truthy(!/file_tumpang_tindih/.test(labaSrc), 'alasan lama "tumpang tindih" tidak dipakai lagi');
});
test('FR-1 konflik antarlaporan: PDF, Excel, dan dashboard menyatakan total BELUM LENGKAP (bukan Rp0); tanpa konflik tidak berubah', () => {
  // Data SINTETIS: pesanan K-1 punya dua versi (biaya berbeda) di dua laporan Januari → ditahan engine.
  const H = ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran', 'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya'];
  const f = (name, rows) => E.parseWorkbook({ name, sheets: { 'Detail pesanan': [H, ...rows.map(([id, pay, sub, fee]) => [id, 'Pesanan', '2026/01/02', pay, sub + fee, sub, sub, 0, fee])],
    Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.reduce((a, r) => a + r[2] + r[3], 0)]] } });
  const st = { modalMode: 'produk', catalog: [], fallbackPct: 50, periods: [{ start: '', markup: 0, disc: 0 }], fixedCosts: [] };
  const konflik = E.compute([f('a.xlsx', [['K-1', '2026/01/05', 100000, -10000], ['K-2', '2026/01/20', 80000, -8000]]), f('b.xlsx', [['K-1', '2026/01/05', 100000, -12000], ['K-2', '2026/01/20', 80000, -8000]])], st);
  const normal = E.compute([f('a.xlsx', [['K-1', '2026/01/05', 100000, -10000], ['K-2', '2026/01/20', 80000, -8000]])], st);
  const d = CekReport.ditahan(konflik);
  eq(d.n, 1); truthy(/^Total belum lengkap\. Sebagian transaksi ditahan karena terdapat perbedaan data antar laporan\./.test(d.teks) && /tidak dihitung sebagai Rp0/.test(d.teks), d.teks);
  eq(CekReport.ditahan(normal).n, 0); eq(CekReport.ditahan(normal).teks, '');
  const html = pdf(konflik);
  truthy(html.includes(d.teks), 'PDF: keterangan di ringkasan dan di bawah laba rugi');
  truthy((html.match(/Total belum lengkap/g) || []).length >= 2, 'PDF: dua kali (ringkasan + tabel laba rugi)'); truthy(/pesanan · belum lengkap/.test(html), 'PDF: KPI penjualan');
  truthy(!/belum lengkap/i.test(pdf(normal)), 'PDF tanpa konflik tidak berubah');
  truthy(/\.map\(\(x\) => \['Status total', x\.teks\]\)/.test(appJs), 'Excel: baris "Status total" bila ada transaksi ditahan');
  truthy((appJs.match(/heldShort\(r\)/g) || []).length >= 5, 'dashboard: kartu laba, penjualan, dan nota memuat catatan');
  truthy((appJs.match(/\$\{warnTotal\(r\)\}/g) || []).length >= 2, 'dashboard: "Ke mana uang pergi" dan Jejak uang');
});
test('P13 tampilan: periode resmi vs transaksi teramati dibedakan; identitas belum pasti tidak disebut konflik', () => {
  truthy(/, periode \$\{tgl\(per\.from\)\} sampai \$\{tgl\(per\.to\)\}/.test(appJs) && /transaksi teramati \$\{tgl\(p\.check\.from\)\}/.test(appJs), 'daftar file: periode resmi vs teramati');
  truthy(/'Rekonsiliasi antarlaporan belum pasti'/.test(appJs) && /semuanya tetap dihitung apa adanya/.test(appJs), 'item kepastian identitas belum pasti');
  truthy(/'Periode laporan TikTok perlu dicek'/.test(appJs), 'item kepastian periode');
  for (const k of ['identitas_transaksi_belum_pasti', 'periode_resmi_rusak', 'baris_di_luar_periode_resmi', 'cakupan_teramati']) truthy(new RegExp(`${k}: '`).test(labaSrc), `alasan ${k} punya teks`);
});
test('AUTH-V2: tombol Google hanya bila diaktifkan; tujuan setelah masuk hanya halaman situs; tanpa log token', () => {
  const ak = src('akun.js'), cl = src('cloud.js'), html = require('fs').readFileSync(require('path').join(__dirname, '..', 'akun.html'), 'utf8');
  truthy(/const google = \(\) => \(C\.googleLogin \?/.test(ak), 'tombol Google bergantung pada config.googleLogin');
  truthy(/googleLogin: false/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'config.js'), 'utf8')), 'Google belum diaktifkan di config');
  const safe = /^[\w-]+\.html([?#][\w=&%.-]*)?$/;
  for (const bad of ['https://jahat.example/x.html', '//jahat.example/a.html', 'javascript:alert(1)', '../x.html', 'a.html#x<y']) truthy(!safe.test(bad), `next ditolak: ${bad}`);
  truthy(safe.test('dashboard.html') && safe.test('dashboard.html#riwayat') && safe.test('admin.html'), 'next sah diterima');
  truthy(ak.includes(safe.source.replace(/\\/g, '\\')) || /safeNext = \(v\) => \(\/\^\[\\w-\]\+\\\.html/.test(ak), 'akun.js memakai pola yang sama');
  for (const f of [ak, cl]) truthy(!/console\.(log|info|debug)/.test(f), 'tanpa console.log');
  truthy(!/client_secret|service_role|sb_secret/i.test(ak + cl + html), 'tanpa secret');
  truthy(/code_challenge_method=s256/.test(cl) && /grant_type=pkce/.test(cl), 'Google memakai PKCE');
  truthy(/Jika email tersebut terdaftar/.test(ak), 'lupa sandi: pesan netral');
  truthy(/prefers-reduced-motion: no-preference/.test(src('account.css')), 'animasi hanya bila gerak tidak dikurangi');
  truthy(/<label for="em">Email\$\{tanda\}<\/label>/.test(ak) && /aria-pressed="false"/.test(ak), 'label form & tombol tampilkan sandi');
});
test('P13-D peringatan total: ditahan vs ambigu, konsisten di dashboard, PDF, Excel; tanpa konflik identik', () => {
  // Data SINTETIS TikTok berperiode resmi Januari. Engine tidak diubah; yang diuji hanya penyajian metadata P11/P13.
  const H = ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran', 'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya'];
  const f = (name, rows) => E.parseWorkbook({ name, sheets: { 'Detail pesanan': [H, ...rows.map(([id, jenis, pay, settle, sales, sub, ref]) => [id, jenis, '2026/01/02', pay, settle, sales, sub, ref, settle - sales])],
    Laporan: [['', 'Periode', '', '', '', '2026/01/01-2026/01/31'], ['', 'Zona waktu', '', '', '', 'UTC+7'], ['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.reduce((a, r) => a + r[3], 0)]] } });
  const st = { modalMode: 'produk', catalog: [], fallbackPct: 50, periods: [{ start: '', markup: 0, disc: 0 }], fixedCosts: [] };
  const P = (id, pay, sub) => [id, 'Pesanan', pay, sub * 0.9, sub, sub, 0];
  const S = (id, pay, ref) => [id, 'Pesanan', pay, ref - 1000, ref, 0, ref];          // refund susulan
  const A = (id, pay, v) => [id, 'Penggantian Biaya Logistik', pay, v, 0, 0, 0];      // penyesuaian
  const CASES = {
    'refund susulan ID sama, nominal beda': [f('a', [P('X1', '2026/01/05', 100000), S('X1', '2026/01/21', -30000)]), f('b', [S('X1', '2026/01/22', -35000), P('X2', '2026/01/28', 50000)])],
    'penyesuaian ID sama, nominal beda': [f('a', [P('X1', '2026/01/05', 100000), A('ADJ-1', '2026/01/21', 5000)]), f('b', [A('ADJ-1', '2026/01/22', 6000), P('X2', '2026/01/28', 50000)])],
    'konflik ditahan': [f('a', [P('X1', '2026/01/05', 100000), P('X2', '2026/01/20', 80000)]), f('b', [[...P('X1', '2026/01/05', 100000).slice(0, 3), 88000, 100000, 100000, 0], P('X2', '2026/01/20', 80000)])],
    'tanpa konflik': [f('a', [P('X1', '2026/01/05', 100000), P('X2', '2026/01/28', 50000)]), f('a-ulang', [P('X1', '2026/01/05', 100000), P('X2', '2026/01/28', 50000)])],
  };
  const R = Object.fromEntries(Object.entries(CASES).map(([k, files]) => [k, E.compute(files, st)]));
  for (const k of ['refund susulan ID sama, nominal beda', 'penyesuaian ID sama, nominal beda']) {
    const r = R[k], w = CekReport.peringatanTotal(r), html = pdf(r), J = r.jejakUang.marketplace.tiktok;
    eq(w.ambigu.n, 1, k); eq(w.ditahan.n, 0, k);
    truthy(w.ambigu.teks.startsWith('Total perlu diverifikasi. Ada transaksi dengan identitas yang belum dapat dipastikan dan mungkin tercatat lebih dari sekali.'), w.ambigu.teks);
    truthy(html.includes(w.ambigu.teks) && /pesanan · perlu diverifikasi/.test(html), `${k}: PDF`); truthy(!/Total belum lengkap/.test(html), `${k}: bukan "ditahan"`);
    eq(r.kepastian.laba.final, false, k);
    for (const c of ['penjualan', 'refund', 'potongan', 'dana', 'penyesuaian']) truthy(J[c].status !== 'terekonsiliasi', `${k}: ${c} tidak "terekonsiliasi" (${J[c].status})`);
    eq(J.gabungan.status, 'identitas_belum_pasti', k); eq(r.kepastian.gabungan.tiktok.pesananDitahan, 0, `${k}: tidak ditahan`);
  }
  eq(R['refund susulan ID sama, nominal beda'].totalSales, 100000 - 30000 - 35000 + 50000, 'perlakuan engine tetap: kedua refund dihitung');
  eq(R['penyesuaian ID sama, nominal beda'].adjustments, 11000, 'perlakuan engine tetap: kedua penyesuaian dihitung');
  const h = R['konflik ditahan'], wh = CekReport.peringatanTotal(h);
  eq(wh.ditahan.n, 1); eq(wh.ambigu.n, 0); truthy(pdf(h).includes(wh.ditahan.teks) && /pesanan · belum lengkap/.test(pdf(h)), 'konflik: PDF');
  eq(h.jejakUang.marketplace.tiktok.penjualan.status, 'perlu_rekonsiliasi');
  const n = R['tanpa konflik'], wn = CekReport.peringatanTotal(n);
  truthy(!wn.ada && wn.teks === '' && !/belum lengkap|perlu diverifikasi/i.test(pdf(n)), 'tanpa konflik: tanpa peringatan');
  eq(n.jejakUang.marketplace.tiktok.dana.status, 'terekonsiliasi');
  // Dashboard & Excel memakai sumber peringatan yang sama.
  truthy(/const heldShort = \(r\) => \{ const w = CekReport\.peringatanTotal\(r\)/.test(appJs) && /Perlu verifikasi: \$\{num\(w\.ambigu\.n\)\} transaksi belum pasti/.test(appJs), 'kartu penjualan & laba');
  truthy(/CekReport\.peringatanTotal\(r\)\.ada \? ` \$\{esc\(CekReport\.peringatanTotal\(r\)\.teks\)\}`/.test(appJs), 'Kepastian Profit');
  truthy(/\[held\.ditahan, held\.ambigu\]\.filter\(\(x\) => x\.n\)\.map\(\(x\) => \['Status total', x\.teks\]\)/.test(appJs), 'Excel');
  truthy(/transaksi dengan identitas belum pasti tetap dihitung; total perlu diverifikasi/.test(appJs), 'Money Trace: rincian sumber');
});
test('U3 Produk: status = warna + simbol + teks; label cari/urutkan; header tabel semantik; tanpa count-up', () => {
  truthy(/HEALTH = \{ sehat: 'Sehat', tipis: 'Tipis', rugi: 'Rugi', unknown: 'Modal belum ada' \}/.test(prodSrc), 'label teks status');
  const css = src('app.css');
  for (const h of ['rugi', 'tipis', 'sehat', 'unknown']) truthy(new RegExp(`\\.chip\\.${h}::before \\{ content: "[^"]+"`).test(css), `simbol status ${h}`);
  truthy(/<label class="sr-only" for="q">/.test(prodSrc) && /<label for="sort">Urutkan<\/label>/.test(prodSrc), 'label cari & urutkan');
  truthy(/<th scope="col">Produk<\/th>/.test(prodSrc) && /<th scope="row">/.test(prodSrc), 'th scope col/row');
  truthy(/role="group" aria-label="Saring menurut status"/.test(prodSrc) && /aria-pressed="\$\{view\.prodFilter === k\}"/.test(prodSrc), 'filter: grup tombol dengan aria-pressed');
  truthy(!/requestAnimationFrame|countUp|count-up/.test(appJs), 'tanpa animasi angka (count-up)');
  truthy(/kind === 'kepastian' \|\| kind === 'produk'/.test(appJs), 'laci produk: kanan di desktop, lembar bawah di HP (dialog modal = fokus terkunci)');
});
test('U4 skenario engine untuk Laba/Produk: nilai yang dipakai UI tersedia dan bebas NaN', () => {
  const demo = E.compute(Demo.make().map((wb) => E.parseWorkbook(wb)), Demo.settings());
  const shopee = E.compute(Demo.make().slice(0, 2).map((wb) => E.parseWorkbook(wb)), Demo.settings());
  const tiktok = E.compute(Demo.make().slice(2).map((wb) => E.parseWorkbook(wb)), Demo.settings());
  for (const [nama, r] of [['multi', demo], ['shopee', shopee], ['tiktok', tiktok]]) {
    for (const v of [r.totalSales, r.totalFees, r.totalReceived, r.totalModal, r.totalMargin, r.netProfit, r.opex, r.coverage]) truthy(Number.isFinite(v), `${nama}: nilai Laba ${v}`);
    eq(['shopee', 'tiktok'].filter((k) => r.has[k]).join(), nama === 'multi' ? 'shopee,tiktok' : nama, `${nama}: platform`);
    truthy(r.months.length > 1, `${nama}: banyak bulan`);
  }
  for (const h of ['sehat', 'tipis', 'rugi']) truthy(demo.products.some((p) => p.health === h), `contoh punya produk ${h}`);
  const tanpaModal = E.compute(Demo.make().map((wb) => E.parseWorkbook(wb)), { modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }] });
  eq(tanpaModal.ready, false, 'tanpa modal: belum siap');
  truthy(tanpaModal.products.every((p) => p.health === 'unknown' && !Number.isFinite(p.margin)), 'tanpa modal: semua produk "Modal belum ada", laba tidak diketahui (bukan 0)');
});

/* ===== VISUAL-V2: sistem token & komponen (tampilan saja) ===== */
const baseCss = src('base.css'), appCss = src('app.css');
test('V1 token V2 lengkap di tema terang, dan tema gelap menimpa token utamanya', () => {
  const need = ['--brand-50', '--brand-100', '--brand-500', '--brand-900', '--surface-0', '--surface-1', '--surface-2', '--surface-raised', '--surface-hover', '--text-primary', '--text-secondary', '--text-muted',
    '--border', '--border-strong', '--success', '--warning', '--danger', '--info', '--unknown', '--shadow-xs', '--shadow-sm', '--shadow-md', '--shadow-lg', '--font-display', '--font-body',
    '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-hero', '--weight-regular', '--weight-medium', '--weight-semibold', '--weight-bold'];
  const light = baseCss.slice(baseCss.indexOf(':root {'), baseCss.indexOf('@media (prefers-color-scheme: dark)'));
  for (const t of need) truthy(new RegExp(`${t}:`).test(light), `token ${t}`);
  const dark = baseCss.slice(baseCss.indexOf(':root[data-theme="dark"] {'));
  for (const t of ['--surface-0', '--surface-1', '--text-primary', '--border', '--brand-600', '--shadow-md', '--side-bg']) truthy(new RegExp(`${t}:`).test(dark), `tema gelap menimpa ${t}`);
  truthy(/--accent: var\(--brand-600\)/.test(light) && /--ink: var\(--text-primary\)/.test(light), 'token lama menjadi alias token V2');
});
test('V2 tanpa font/CDN baru; satu keluarga huruf lokal; lapisan V2 tidak memakai warna acak', () => {
  const faces = [...baseCss.matchAll(/@font-face \{[^}]*\}/g)].map((m) => m[0]);
  eq(faces.length, 1, '@font-face'); truthy(/fonts\/jakarta\.woff/.test(faces[0]), 'Plus Jakarta Sans lokal');
  for (const f of ['base.css', 'app.css', 'site.css']) truthy(!/https?:\/\//.test(src(f).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${f}: tanpa sumber eksternal`);
  const v2 = appCss.slice(appCss.indexOf('VISUAL-V2 — lapisan tampilan'));
  truthy(v2.length > 2000, 'lapisan V2 ada');
  eq([...new Set(v2.match(/#[0-9a-fA-F]{3,8}\b/g) || [])].join(','), '#fff', 'warna di lapisan V2 memakai token (kecuali putih di atas permukaan merek)');
});
test('V3 status & ikon: simbol + teks + warna; segmen Kepastian Profit bisa difokus dan berlabel; ikon KPI hiasan', () => {
  for (const k of ['verified', 'estimate', 'minimum', 'pending', 'unknown', 'danger']) truthy(new RegExp(`\\.status\\.${k}::before \\{ content: "[^"]+"`).test(appCss), `simbol status ${k}`);
  truthy(/<button type="button" class="cov-seg \$\{p\.cls\}"[^>]*aria-label="\$\{p\.label\} \$\{pct\(p\.share\)\}\. Buka penjelasan"/.test(appJs), 'segmen = tombol berlabel');
  truthy(/class="cov-bar" role="group"/.test(appJs), 'batang = grup (bukan gambar) karena segmennya interaktif');
  truthy(/<span class="m-ic m-ic-\$\{k\}" aria-hidden="true">/.test(appJs), 'ikon KPI aria-hidden');
  truthy(/\.is-loading/.test(baseCss) && /aria-busy/.test(appJs), 'status memuat tombol');
  truthy(!/count-?up|requestAnimationFrame/i.test(appJs), 'tanpa animasi angka');
});
test('V4 gerak V2 tetap hormat "kurangi gerakan"; motion.js dimuat dashboard & ikut cache offline', () => {
  truthy(/<script src="assets\/motion\.js(\?v=[0-9a-f]+)?"><\/script>/.test(fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8')), 'dashboard memuat motion.js');
  truthy(/'assets\/motion\.js'/.test(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8')), 'motion.js di CORE sw.js');
  truthy(/--ease-spring: cubic-bezier\(\.22, 1, \.36, 1\)/.test(baseCss), 'kurva pegas tanpa memantul (nilai akhir tidak melewati 1)');
  truthy(/body\.app \{ --dur-reveal: 340ms; --reveal-y: 10px;/.test(appCss), 'gerak aplikasi lebih tenang dari halaman depan');
});

/* ===== WEB-1 / MOTION-1: halaman depan jujur, gerak ringan ===== */
const root = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const indexHtml = root('index.html');
const indexTeks = teks(indexHtml.replace(/<script[\s\S]*?<\/script>/g, ''));
const rp = (s) => +s.replace(/[^\d]/g, '') * (/[−-]Rp/.test(s) ? -1 : 1);
test('W1 halaman depan: tanpa "Laba bersih", tanpa klaim akurasi/realtime/pencairan, tanpa skor', () => {
  truthy(!/laba bersih/i.test(indexTeks), 'halaman depan masih memakai "Laba bersih"');
  truthy(!/\d+\s*%\s*akurat|akurasi\s+\d/i.test(indexTeks), 'klaim "X% akurat"/"akurasi X%"');
  truthy(!/real-?time|sinkron otomatis|terhubung otomatis ke (shopee|tiktok)/i.test(indexTeks.replace(/tidak terhubung otomatis ke marketplace/i, '')), 'klaim integrasi otomatis/realtime');
  for (const m of indexTeks.matchAll(/[^.]*pencairan[^.]*\./gi)) truthy(/belum tersedia|menyusul/.test(m[0]), `klaim pencairan dana: "${m[0].trim()}"`);
  for (const m of indexTeks.matchAll(/[^.]*\bskor\b[^.]*\./gi)) truthy(/bukan skor/i.test(m[0]), `skor Profit Confidence: "${m[0].trim()}"`);
});
test('W2 angka contoh di halaman depan diberi label fiktif/sintetis dan konsisten satu sama lain', () => {
  for (const label of ['Data fiktif', 'Contoh sintetis', 'Ilustrasi, data fiktif', 'Ilustrasi dengan data fiktif']) truthy(indexHtml.includes(label), `label "${label}"`);
  const part = (from, to) => { const a = indexHtml.indexOf(from); truthy(a >= 0, `bagian ${from}`); return indexHtml.slice(a, indexHtml.indexOf(to, a)); };
  // Ilustrasi Rp100.000: penjualan − potongan − HPP − refund & biaya = laba (17%); nota = legenda; batang = 100%
  const nota = part('class="nota r100k"', '</section>');
  const baris = [...nota.matchAll(/<dd>([^<]+)<\/dd>/g)].map((m) => rp(m[1]));
  eq(baris.join(','), '100000,-18000,-55000,-10000', 'nota Rp100.000');
  const laba = rp(nota.match(/class="big">([^<]+)</)[1]);
  eq(baris.reduce((x, y) => x + y, 0), laba, 'nota konsisten'); eq(laba, 17000, 'laba Rp17.000');
  truthy(/Margin ilustrasi 17%/.test(nota) && Math.round((laba / baris[0]) * 100) === 17, 'margin 17%');
  const vis = part('id="r100"', 'class="nota r100k"');
  eq(rp(vis.match(/data-jual>([^<]+)</)[1]), baris[0], 'penjualan legenda = nota');
  eq([...vis.matchAll(/data-v>([^<]+)</g)].map((m) => rp(m[1])).join(','), baris.slice(1).join(','), 'legenda = nota');
  eq(rp(vis.match(/data-laba>([^<]+)</)[1]), laba, 'laba legenda = nota');
  const wv = (html) => [...html.matchAll(/--w:(\d+)%/g)].map((m) => +m[1]);
  eq(wv(vis).join(','), '18,55,10,17', 'batang sesuai porsi'); eq(wv(vis).reduce((x, y) => x + y, 0), 100, 'batang = 100%');
  const w = (html) => wv(html).reduce((x, y) => x + y, 0);
  // etalase hero dan bagian "Omzet bukan laba" memakai angka yang sama
  const show = part('class="show-stage"', 'class="show-cap"'), om = part('class="omzet"', 'class="om-cap"');
  eq(rp(om.match(/om-a"><span>[^<]*<\/span><b>([^<]+)</)[1]), rp(show.match(/<span>Penjualan<\/span><b>([^<]+)</)[1]), 'omzet = penjualan di etalase');
  eq(rp(om.match(/om-b"><span>[^<]*<\/span><b>([^<]+)</)[1]), rp(show.match(/sb-hero"><span>[^<]*<\/span><b>([^<]+)</)[1]), 'laba = laba di etalase');
  eq(w(show.slice(show.indexOf('fc-seg'))), 100, 'batang Kepastian Profit etalase = 100%');
  eq(w(part('class="segbar pc-seg"', '</div>')), 100, 'batang Profit Confidence = 100%');
  // ringkasan produk: jumlah status = total, batang sebaran sesuai jumlah
  const sum = part('class="bt-sum', 'class="bt-list"');
  const n = [...sum.matchAll(/<b>(\d+)<\/b>/g)].map((m) => +m[1]);
  eq(n[1] + n[2] + n[3], n[0], 'sehat + tipis + rugi = total produk');
  eq([...sum.matchAll(/--w:(\d+)%/g)].map((m) => +m[1]).join(','), n.slice(1).map((x) => Math.round(x * 100 / n[0])).join(','), 'sebaran status = jumlah ÷ total');
});
test('W5 status Profit Confidence di halaman depan = 5 status dashboard (label dan urutan sama)', () => {
  const pc = indexHtml.slice(indexHtml.indexOf('<ul class="pc-legend">'), indexHtml.indexOf('</ul>', indexHtml.indexOf('<ul class="pc-legend">')));
  const labels = [...pc.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  const covLabels = [...daftar('COV').matchAll(/\['\w+', '\w+', '([^']+)'/g)].map((m) => m[1]);
  eq(labels.join(','), covLabels.join(','), 'label status');
  truthy(/Perkiraan minimum<\/b><span>Perkiraan konservatif/.test(pc), 'perkiraan minimum dijelaskan sebagai perkiraan konservatif');
});
test('W6 batang status: segmen boleh menyusut agar celah tidak memotong status terakhir (dashboard & halaman depan)', () => {
  truthy(/\.cov-seg \{ flex: 0 1 var\(--w\)/.test(src('app.css')), 'dashboard .cov-seg');
  truthy(/\.segbar i \{ flex: 0 1 var\(--w\)/.test(src('site.css')), 'halaman depan .segbar i');
});
test('W3 tombol daftar tetap "Daftar gratis" (CLAUDE.md §4); "Coba gratis" tidak menuju pendaftaran', () => {
  const daftar = [...indexHtml.matchAll(/<a [^>]*href="akun\.html\?mode=daftar[^"]*"[^>]*>([^<]*)/g)].map((m) => m[1].trim());
  truthy(daftar.length >= 4 && daftar.every((t) => t === 'Daftar gratis'), `label tombol daftar: ${daftar}`);
  for (const m of indexHtml.matchAll(/<a [^>]*href="([^"]+)"[^>]*>Coba gratis/g)) eq(m[1], 'dashboard.html', 'Coba gratis menuju dashboard');
});
test('W4 gerak: hanya transform/opacity, tanpa pustaka/scroll listener, isi tampil tanpa JS atau saat kurangi gerakan', () => {
  const css = src('site.css') + src('base.css');
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
    const props = [...m[2].matchAll(/([\w-]+)\s*:/g)].map((x) => x[1]);
    truthy(props.every((p) => p === 'opacity' || p === 'transform'), `@keyframes ${m[1]} menganimasikan ${props}`);
  }
  truthy(!/\[data-reveal\][^{]*\{[^}]*opacity:\s*0/.test(css.replace(/\.motion \[data-reveal\][^{]*\{[^}]*\}/g, '')), 'status tersembunyi hanya di bawah .motion');
  const motion = src('motion.js');
  truthy(/prefers-reduced-motion: reduce/.test(motion) && /if \(canReveal\) root\.classList\.add\('motion'\)/.test(motion), 'kelas motion hanya bila gerak diizinkan');
  truthy(/IntersectionObserver/.test(motion) && !/addEventListener\('scroll'/.test(motion + indexHtml), 'IntersectionObserver, bukan event scroll');
  truthy(!/<script[^>]+src="https?:/.test(indexHtml) && !/eval\(|new Function/.test(motion), 'tanpa skrip eksternal / eval');
  truthy(/prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after, ::backdrop \{ transition: none !important; animation: none !important/.test(src('base.css')), 'aturan kurangi gerakan global');
  truthy(/'assets\/motion\.js'/.test(root('sw.js')), 'motion.js ikut cache offline (sw.js CORE)');
});

test('B3b UI: label Beta export pesanan + alasan refund parsial tampil (bukan Rp0 untuk HPP tidak diketahui)', () => {
  const note = 'Format export marketplace dapat berubah. Hasil pencocokan ditandai bila belum dapat diverifikasi.';
  truthy(appJs.includes(note), 'helper Beta di dashboard');
  truthy(/f\.kind === 'shopee_orders' \|\| f\.kind === 'tiktok_orders' \? `<span class="ftag beta-tag"/.test(appJs), 'tag Beta pada file export pesanan');
  truthy(/orders: \{ st: 'beta', kind: 'shopee_orders'/.test(appJs) && /orders: \{ st: 'beta', kind: 'tiktok_orders'/.test(appJs), 'Pusat Data: export pesanan bertanda Beta');
  truthy(/export pesanan \(Beta\)/.test(src('../index.html')), 'FAQ halaman depan menyebut Beta');
  truthy(/'Refund parsial: jumlah unit belum diketahui'/.test(appJs), 'item kepastian refund parsial');
  truthy(appJs.includes('Sebagian penjualan tidak masuk dalam perhitungan laba karena jumlah unit pada refund parsial belum dapat diverifikasi.'), 'teks refund parsial sesuai keputusan pemilik');
  truthy(/'Data refund perlu dicek'/.test(appJs) && /rpx\.konflik/.test(appJs), 'item terpisah untuk bukti unit yang bertentangan');
  truthy(!/laba (akan )?naik|menaikkan laba/i.test(appJs + src('penjelasan.js')), 'tidak ada klaim "laba naik"');
  truthy(!/Laporan Penghasilan[^'`]*Beta/.test(appJs), 'Laporan Penghasilan tidak diberi label Beta');
});
/* ===== P0 rilis: HPP yang belum diketahui tidak tampil sebagai Rp0 (PDF, Excel, tabel Laba dashboard) ===== */
const ttMini = (rows) => E.parseWorkbook({ name: 'tt-sintetis.xlsx', sheets: {
  'Detail pesanan': [['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Detail produk terjual', 'Sumber pesanan'],
  ...rows.map((x) => [x.id, 'Pesanan', '2026/01/10', '2026/01/15', x.settle, x.sales, x.sales, 0, x.settle - x.sales, x.detail, 'TikTok Shop'])],
  Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.reduce((a, x) => a + x.settle, 0)]] } });
const katalog = (items) => ({ modalMode: 'produk', catalog: items.map(([nama, cost, kode = '']) => ({ kode, nama, variasi: '', cost })) });
/** Baris "Modal barang" di tabel laba PDF, sebagai teks. */
const barisModal = (h) => ([...teks(h).matchAll(/Modal barang ((?:Belum diketahui|−?Rp)[^]*?) (?:Packing|Dana dari pesanan|Barang retur|Laba setelah modal)/g)][0] || [])[1] || '';
test('P0 PDF: HPP semua tidak diketahui / sebagian / lengkap / benar-benar Rp0', () => {
  const inc = penghasilan(0);
  const semua = pdf(E.compute([inc], katalog([])));
  truthy(/^Belum diketahui/.test(barisModal(semua)), `semua tidak diketahui: "${barisModal(semua)}"`); truthy(!/Rp0/.test(barisModal(semua)), 'tidak boleh Rp0');
  const sebagian = pdf(E.compute([inc], katalog([['Kaos', 20000]])));
  truthy(/^−Rp20\.000/.test(barisModal(sebagian)), `sebagian: "${barisModal(sebagian)}"`); truthy(/Dana dari pesanan tanpa modal/.test(teks(sebagian)), 'sebagian: pesanan tanpa modal disebut');
  const lengkap = pdf(E.compute([inc], katalog([['Kaos', 20000], ['Topi', 10000]])));
  truthy(/^−Rp30\.000/.test(barisModal(lengkap)), `lengkap: "${barisModal(lengkap)}"`);
  const nol = pdf(E.compute([inc], katalog([['Kaos', 0], ['Topi', 0]])));
  truthy(/^Rp0/.test(barisModal(nol)), `HPP memang 0 tetap Rp0: "${barisModal(nol)}"`);
  // Dua platform: Shopee bermodal, TikTok belum → kolom TikTok "Belum diketahui", bukan Rp0.
  const dua = pdf(E.compute([inc, ttMini([{ id: '8801', settle: 90000, sales: 100000, detail: '5550001 * 2;' }])], katalog([['Kaos', 20000], ['Topi', 10000]])));
  truthy(/^−Rp30\.000 Belum diketahui −Rp30\.000/.test(barisModal(dua)), `dua platform: "${barisModal(dua)}"`);
  truthy(/Laba setelah modal Rp[\d.]+ Belum diketahui/.test(teks(dua)), 'laba TikTok belum diketahui, bukan —/Rp0');
  for (const h of [semua, sebagian, lengkap, nol, dua]) bersih(h, 'P0');
});
test('P0 Excel & dashboard: memakai status HPP dari engine, bukan Rp0/0 untuk HPP tidak diketahui', () => {
  const appJs = src('app.js');
  truthy(/const RH = \(k, v\) => \(known\(k\) && ok\(v\) \? Math\.round\(v\) : UNK\);/.test(appJs), 'Excel: helper RH');
  truthy(/\['Modal', \.\.\.plats\.map\(\(k\) => RH\(k, -r\[k\]\.modal\)\), RH\('total', -r\.totalModal\)\]/.test(appJs), 'Excel: baris Modal');
  truthy(/p\.modalKnown \? R\(p\.modal\) : UNK/.test(appJs), 'Excel: modal produk tidak diketahui');
  truthy(/\['Modal \/ HPP', \(P, k\) => \(hppOk\(k\) \?/.test(appJs), 'tabel Laba dashboard: status per kolom');
  truthy(!/\['Modal', \.\.\.plats\.map\(\(k\) => R\(-r\[k\]\.modal\)\)/.test(appJs), 'pola lama Excel tidak ada lagi');
});
test('P0 Pro: tanpa kontak pembayaran, CTA bayar tidak tampil dan status "Segera hadir"; kode lama tetap ada', () => {
  const appJs = src('app.js'), idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), akun = src('akun.js'), cfg = src('config.js');
  truthy(/const PAY_READY = !!C\.whatsapp;/.test(appJs), 'dashboard: status siap bayar dari config');
  truthy(/if \(!PAY_READY\) action = pending \?/.test(appJs) && /Segera hadir/.test(appJs), 'dialog Pro: Segera hadir saat belum siap');
  truthy(/\$\{pending \|\| !PAY_READY \? '' : `<div class="plans">/.test(appJs), 'pilihan paket disembunyikan saat belum siap');
  truthy(/id="req-upgrade">Lanjut ke pembayaran/.test(appJs) && /t\.id === 'req-upgrade'/.test(appJs), 'alur pembayaran lama tetap ada');
  truthy(/data-pay="pro"/.test(idx) && /if \(!C\.whatsapp\) \{[^]*?'Segera hadir'/.test(idx), 'halaman depan: tombol Pro → Segera hadir');
  truthy(/C\.whatsapp \? '<a class="btn sm" href="dashboard\.html#upgrade">Upgrade<\/a>' : '<span class="badge">Pro segera hadir<\/span>'/.test(akun), 'halaman akun');
  // Harga Pro sekali bayar (keputusan pemilik 21 Okt 2026); pembelian tetap tertutup karena whatsapp kosong.
  truthy(/prices: \{[^}]*pro: 'Rp149\.000',\s*proUnit: 'sekali bayar'/.test(cfg) && /whatsapp: '',/.test(cfg), 'harga Pro sekali bayar, kontak pembayaran tetap kosong');
  for (const lama of ['Rp49.000', 'Rp399.000', 'Berlangganan Pro', 'data-price="proUnit">/ bulan', 'Jasa laporan</h3>', 'Rp299.000']) truthy(!idx.includes(lama) && !cfg.includes(`'${lama}'`), `tanpa harga/teks lama: ${lama}`);
  truthy(/data-price="pro">Rp149\.000</.test(idx) && /data-price="proUnit">sekali bayar</.test(idx), 'halaman depan: Rp149.000 sekali bayar');
});
test('P0 laba bulanan PDF: Belum diketahui / sebagian (*) / Rp0 aktual / lengkap; tanpa NaN', () => {
  const inc = E.parseWorkbook(Sint.penghasilan([
    { id: 'B-JAN', orderDate: '2026-01-10 10:00', items: [{ name: 'Kaos', harga: 100000 }] },
    { id: 'B-FEB', orderDate: '2026-02-10 10:00', items: [{ name: 'Topi', harga: 100000 }] },
    { id: 'B-MAR1', orderDate: '2026-03-10 10:00', items: [{ name: 'Kaos', harga: 100000 }] },
    { id: 'B-MAR2', orderDate: '2026-03-11 10:00', items: [{ name: 'Topi', harga: 100000 }] },
    { id: 'B-APR', orderDate: '2026-04-10 10:00', items: [{ name: 'Gelas', harga: 100000 }] }]));
  const h = pdf(E.compute([inc], katalog([['Kaos', 20000], ['Gelas', 100000]]))), t = teks(h);
  truthy(/Januari 2026 1 Rp100\.000 Rp0 -0,0% Rp80\.000 80,0%/.test(t), 'Jan lengkap');
  truthy(/Februari 2026 1 Rp100\.000 Rp0 -0,0% Belum diketahui — /.test(t), 'Feb belum diketahui, bukan Rp0');
  truthy(/Maret 2026 2 Rp200\.000 Rp0 -0,0% Rp80\.000\* 80,0%/.test(t), 'Mar sebagian bertanda *');
  truthy(/April 2026 1 Rp100\.000 Rp0 -0,0% Rp0 0,0%/.test(t), 'Apr laba Rp0 aktual tetap Rp0');
  truthy(/\* Laba bulan itu hanya dari penjualan yang modalnya diketahui/.test(t) && /\? = laba belum diketahui/.test(t), 'catatan & legenda');
  bersih(h, 'bulanan');
  const appJs = src('app.js');
  truthy(/const mStat = \(t\) => \(!t \|\| !t\.orders \? 'kosong' : t\.statusHpp \|\| 'lengkap'\);/.test(appJs), 'dashboard: status bulan dari engine');
  truthy(/<td>\$\{lab\(m, m\.total\.margin\)\}<\/td>/.test(appJs) && /<td>\$\{mLaba\(r\.ready, m\.total, m\.total\.margin\)\}<\/td>/.test(appJs), 'dashboard: tabel bulanan');
  truthy(/const RM = \(t, v\) => \(!r\.ready \|\| mStat\(t\) === 'kosong' \? '' : mKnown\(t\) \? R\(v\) : UNK\);/.test(appJs), 'Excel per bulan');
  truthy(/margin: mKnown\(m\.total\) \? R\(m\.total\.margin\) : null/.test(appJs), 'ringkasan riwayat tidak menyimpan 0 untuk laba tidak diketahui');
});
/* ===== Patch PDF: "Laba per bulan" di sampul tidak boleh ekstrapolasi data < 1 bulan ===== */
/** Laporan TikTok sintetis: satu pesanan per tanggal dana diterima (laba 80.000 per pesanan dengan modal 20.000 × 1). */
const ttTanggal = (dates) => E.parseWorkbook({ name: 'tt-periode-sintetis.xlsx', sheets: {
  'Detail pesanan': [['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Detail produk terjual', 'Sumber pesanan'],
  ...dates.map((d, i) => [String(8900 + i), 'Pesanan', d, d, 100000, 100000, 100000, 0, 0, '5550009 * 1;', 'TikTok Shop'])],
  Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', dates.length * 100000]] } });
const stPeriode = katalog([['', 20000, '5550009']]);
const sampul = (h) => (teks(h).match(/Laba setelah modal (\S+) .*?(Laba per bulan|Laba periode data) (\S+) (.*?) Ringkasan/) || []);
test('Patch PDF: data 1 hari → tanpa "Laba per bulan", tampil laba periode data', () => {
  const r = E.compute([ttTanggal(['2026/01/15'])], stPeriode);
  truthy(r.perMonth > r.totalMargin * 20, 'prasyarat: engine memang mengekstrapolasi (angka engine tidak diubah)');
  const m = sampul(pdf(r));
  eq(m[2], 'Laba periode data', 'label'); eq(m[3], 'Rp80.000', 'nilai = laba periode, bukan ekstrapolasi'); truthy(/dari 1 hari data/.test(m[4]), m[4]);
  truthy(!/Laba per bulan/.test(teks(pdf(r))), 'metrik ekstrapolasi tidak tampil');
});
test('Patch PDF: data beberapa hari (7 hari) → laba periode, bukan ×4', () => {
  const r = E.compute([ttTanggal(['2026/01/10', '2026/01/13', '2026/01/16'])], stPeriode);
  eq(r.days, 7); const m = sampul(pdf(r));
  eq(m[2], 'Laba periode data'); eq(m[3], 'Rp240.000', '3 × 80.000'); truthy(/dari 7 hari data/.test(m[4]), m[4]);
});
test('Patch PDF: data satu bulan penuh (31 hari) → "Laba per bulan" tetap tampil dari engine', () => {
  const r = E.compute([ttTanggal(['2026/01/01', '2026/01/31'])], stPeriode);
  truthy(r.monthsSpan >= 1, 'prasyarat'); const m = sampul(pdf(r));
  eq(m[2], 'Laba per bulan'); const v = `Rp${Math.round(r.perMonth).toLocaleString('id-ID')}`; eq(m[3], v, 'nilai engine');
  truthy(r.perMonth <= r.totalMargin, 'rata-rata tidak melebihi laba periode'); truthy(/rata-rata 1 bulan data/.test(m[4]), m[4]);
  // Biaya operasional diisi → sampul tetap memakai laba dari data tersedia (perilaku lama).
  const op = E.compute([ttTanggal(['2026/01/15'])], { ...stPeriode, fixedCosts: [{ label: 'Gaji', amount: 300000 }] });
  truthy(/Laba dari data tersedia/.test(teks(pdf(op))), 'cabang biaya operasional tidak berubah');
});
/* ===== Patch dashboard: kartu "Rata-rata per bulan" memakai aturan yang sama dengan sampul PDF ===== */
const LB = CekReport.labaBulanan;
const ttTanggalModal = (rows) => E.parseWorkbook({ name: 'tt-periode2-sintetis.xlsx', sheets: {
  'Detail pesanan': [['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Detail produk terjual', 'Sumber pesanan'],
  ...rows.map(([d, sku], i) => [String(8950 + i), 'Pesanan', d, d, 100000, 100000, 100000, 0, 0, `${sku} * 1;`, 'TikTok Shop'])],
  Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.length * 100000]] } });
test('Patch dashboard: laba bulanan 1 hari / 7 hari / 31 hari / beberapa bulan', () => {
  const satu = E.compute([ttTanggal(['2026/01/15'])], stPeriode), l1 = LB(satu);
  eq(l1.jenis, 'periode'); eq(l1.label, 'Laba periode data'); eq(l1.nilai, satu.totalMargin, 'laba periode dari engine'); truthy(satu.perMonth > l1.nilai * 20, 'bukan ekstrapolasi engine');
  const tujuh = E.compute([ttTanggal(['2026/01/10', '2026/01/16'])], stPeriode), l7 = LB(tujuh);
  eq(tujuh.days, 7); eq(l7.jenis, 'periode'); eq(l7.nilai, 160000);
  const bulan = E.compute([ttTanggal(['2026/01/01', '2026/01/31'])], stPeriode), l31 = LB(bulan);
  eq(l31.jenis, 'rata'); eq(l31.label, 'Rata-rata per bulan'); eq(l31.nilai, bulan.perMonth, 'nilai engine'); truthy(l31.nilai <= bulan.totalMargin, 'tidak lebih besar dari laba periode');
  const multi = E.compute([ttTanggal(['2026/01/01', '2026/02/15', '2026/03/31'])], stPeriode), lm = LB(multi);
  eq(lm.jenis, 'rata'); eq(lm.nilai, multi.perMonth); near(lm.nilai * multi.monthsSpan, multi.totalMargin, 1, 'rata-rata × bulan = laba periode');
});
test('Patch dashboard: HPP belum diketahui / sebagian / laba Rp0 aktual', () => {
  const unk = LB(E.compute([ttTanggalModal([['2026/01/01', '5559999'], ['2026/01/31', '5559999']])], stPeriode));
  eq(unk.jenis, 'belum'); truthy(Number.isNaN(unk.nilai), 'bukan 0');
  const seb = E.compute([ttTanggalModal([['2026/01/01', '5550009'], ['2026/01/31', '5559999']])], stPeriode);
  eq(seb.statusHpp.total, 'sebagian'); eq(LB(seb).jenis, 'rata'); eq(LB(seb).nilai, seb.perMonth);
  const nol = E.compute([ttTanggal(['2026/01/15'])], katalog([['', 100000, '5550009']]));
  eq(nol.totalMargin, 0); eq(LB(nol).jenis, 'periode'); eq(LB(nol).nilai, 0, 'Rp0 aktual tetap 0');
});
test('Patch dashboard: biaya operasional tersedia vs tidak', () => {
  const op = { ...stPeriode, fixedCosts: [{ label: 'Sewa', amount: 304000 }] };
  const pendek = E.compute([ttTanggal(['2026/01/15'])], op), lp = LB(pendek);
  eq(lp.jenis, 'periode'); eq(lp.dasar, 'laba_dari_data_tersedia'); eq(lp.nilai, pendek.netProfit);
  const panjang = E.compute([ttTanggal(['2026/01/01', '2026/03/31'])], op), ll = LB(panjang);
  eq(ll.jenis, 'rata'); near(ll.nilai, panjang.netProfit / panjang.monthsSpan, 0.001, 'sama dengan cara lama dashboard');
  eq(LB(E.compute([ttTanggal(['2026/01/15'])], stPeriode)).dasar, 'laba_setelah_modal');
  const appJs = src('app.js');
  truthy(/const lb = CekReport\.labaBulanan\(r\)/.test(appJs) && /<span>\$\{lb\.label\}\$\{qi\('rata_bulan'\)\}<\/span>/.test(appJs), 'kartu dashboard memakai aturan bersama');
  truthy(!/r\.netProfit \/ Math\.max\(r\.monthsSpan, 1\) : r\.perMonth/.test(appJs), 'rumus lama di UI tidak dipakai lagi');
  truthy(/lb\.jenis === 'belum' \? '<span class="unk">Belum diketahui<\/span>'/.test(appJs), 'belum diketahui, bukan Rp0');
  truthy(/const perMonthOk = !hasOpex && labaBulanan\(r\)\.jenis === 'rata';/.test(src('report.js')), 'PDF memakai aturan yang sama');
});
/* ===== UX P0: pengalaman seller pemula (teks & struktur; perilaku diuji di QA browser) ===== */
test('UX P0 unggah: status jelas, CTA ke Ringkasan, terbaca ≠ tervalidasi', () => {
  const a = src('app.js');
  truthy(/<div id="upload-status" aria-live="polite"><\/div>/.test(a), 'kotak status setelah daftar file');
  truthy(/File terbaca, tetapi belum cukup untuk analisis laba/.test(a) && /Laporan Penghasilan dari Seller Centre masih dibutuhkan/.test(a), 'hanya export pesanan');
  truthy(/Laba belum bisa dihitung karena modal barang \(HPP\) belum diisi/.test(a), 'tanpa HPP');
  truthy(/const HASIL = '<button class="btn primary" type="button" data-go="ringkasan">Lihat hasil analisis<\/button>'/.test(a), 'CTA utama ke Ringkasan');
  truthy(/"Terbaca" berarti format file dikenali/.test(a), 'terbaca bukan berarti tervalidasi');
  truthy(!/laba (sudah )?final|laba pasti|laba akurat/i.test(a.slice(a.indexOf('function uploadStatus'), a.indexOf('function renderFiles'))), 'tanpa klaim laba final');
  truthy(/Dipakai untuk: \$\{FILE_USE\[f\.kind\]\}/.test(a), 'kegunaan tiap file');
});
test('UX P0 pengaturan: grup wajib/opsional, identitas PDF terpisah, input & kunci simpan tetap', () => {
  const a = src('app.js');
  for (const t of ['Laporan utama', 'Wajib untuk laba', 'Pengaturan harga reseller', "optSec('biaya', '4', 'Biaya tambahan'", "optSec('target', '5', 'Target bisnis'", "'Identitas laporan PDF (opsional)'"]) truthy(a.includes(t), t);
  truthy(/<p class="note-box">Informasi ini hanya digunakan sebagai identitas pada laporan PDF\. Tidak memengaruhi perhitungan laba\.<\/p>/.test(a) && /Tidak memengaruhi perhitungan laba\.',/.test(a), 'keterangan identitas PDF (di dalam dan di judul bagian)');
  for (const id of ['s-packing', 's-target', 's-tprofit', 'fc-add', 'pf-store', 'pf-owner', 'pf-logo', 's-mitra', 's-coret', 'add-period']) truthy(a.includes(`id="${id}"`), `input ${id} tetap ada`);
  truthy(/else if \(id === 'pf-store' \|\| id === 'pf-owner'\) \{ profile\[id === 'pf-store' \? 'store' : 'owner'\] = v; saveProfile\(\); return; \}/.test(a), 'identitas tetap disimpan di profil (tidak di pengaturan hitung)');
  truthy(/view\.openSec\[e\.target\.dataset\.sec\] = e\.target\.open/.test(a), 'bagian terbuka tidak tertutup saat render ulang');
});
test('UX P0 halaman depan: ilustrasi Rp100 berlabel contoh, bukan data seller', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  truthy(/<span class="ilus-tag">Contoh ilustrasi<\/span>/.test(idx) && /bukan data penjualan Anda<\/b> dan bukan margin rata-rata seller/.test(idx), 'label contoh + bukan data');
  truthy(/CONTOH ILUSTRASI<br>bukan data asli/.test(idx), 'label di nota');
  truthy(/Di toko Anda bisa lebih besar, lebih kecil, atau rugi/.test(idx), 'margin tidak berlaku umum');
  truthy(/Contoh: dari Rp100\.000 penjualan, ke mana uangnya\?/.test(idx), 'judul');
  truthy(/Laba bukan saldo kas\./.test(idx) && /Data yang belum ada tidak dianggap nol\./.test(idx), 'laba ≠ kas; belum ada ≠ nol');
});
test('Branding: favicon Cek Untung (URL baru), apple-touch-icon, PDF tanpa logo lama', () => {
  const root = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['index.html', 'dashboard.html', 'akun.html', 'admin.html', 'privasi.html', 'app.html']) {
    truthy(/<link rel="icon" href="icon-cek-untung\.svg" type="image\/svg\+xml">/.test(root(f)), `${f}: favicon Cek Untung`);
    truthy(!/href="icon\.svg"/.test(root(f)), `${f}: tidak lagi memakai URL favicon lama`);
  }
  for (const f of ['index.html', 'dashboard.html', 'akun.html', 'admin.html', 'privasi.html']) truthy(/<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(root(f)), `${f}: apple-touch-icon`);
  eq(root('icon-cek-untung.svg'), root('icon.svg'), 'favicon baru = logo resmi (icon.svg)');
  truthy(/viewBox="0 0 16 16"/.test(root('icon.svg')) && /#f4c542/.test(root('icon.svg')), 'logo resmi grid 16');
  const png = fs.readFileSync(path.join(__dirname, '..', 'apple-touch-icon.png'));
  eq(png.readUInt32BE(16), 180); eq(png.readUInt32BE(20), 180);
  truthy(/'icon-cek-untung\.svg', 'apple-touch-icon\.png'/.test(root('sw.js')), 'ikon ikut cache offline');
  truthy(!/M7 20\.5l5-5/.test(src('report.js')) && /viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="4\.5" fill="#0f6e56"/.test(src('report.js')), 'sampul PDF memakai logo Cek Untung');
});
test('Landing: panah "Omzet bukan untung" di baris angka, tanpa angka ajaib', () => {
  const css = src('site.css');
  truthy(/\.om-a, \.om-b \{ display: contents; \}/.test(css) && /\.om-arrow \{ grid-column: 2; grid-row: 2;/.test(css), 'panah di kolom tengah, baris angka');
  truthy(!/\.om-arrow \{[^}]*padding-bottom/.test(css), 'tidak lagi memakai padding-bottom tetap');
  truthy(/\.om-arrow svg \{ width: 40px; transform: rotate\(90deg\); \}/.test(css), 'HP: panah ke bawah');
});
test('Formulir: contoh bukan nilai, nilai bawaan yang memengaruhi modal disebut jelas', () => {
  const a = src('app.js');
  for (const ph of ['Misalnya 30', 'Misalnya 2000', 'Misalnya 5000000']) truthy(a.includes(`placeholder="${ph}"`), ph);
  truthy(/Memakai nilai bawaan: harga coret = harga acuan, harga jual Shopee = harga acuan\. Nilai ini ikut menentukan perkiraan modal\./.test(a), 'reseller: nilai bawaan diungkap');
  truthy(/\(nilai bawaan\)/.test(a), 'target margin bawaan ditandai');
});
/* ===== V1A: sumber pesanan Tokopedia di Laporan Penghasilan TikTok (data engine apa adanya; data SINTETIS) ===== */
/** rows: [id, sumber, tanggal pesanan, penjualan, detail] */
const ttSumber = (rows) => E.parseWorkbook({ name: 'tt-sumber-sintetis.xlsx', sheets: {
  'Detail pesanan': [['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran',
    'Total Pendapatan', 'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Detail produk terjual', 'Sumber pesanan'],
  ...rows.map(([id, src, d, sales, det, pay]) => [id, 'Pesanan', d, pay || d, sales - 10000, sales, sales, 0, -10000, det ?? '5550009 * 1;', src])],
  Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', rows.reduce((a, x) => a + x[3] - 10000, 0)]] } });
const bsSum = (r) => Object.values(r.tiktok.bySource).reduce((a, v) => a + v.sales, 0);
const tanpaBs = (r) => JSON.stringify(r, (k, v) => (k === 'bySource' ? undefined : typeof v === 'number' && !isFinite(v) ? String(v) : v));
test('V1A sumber: Tokopedia + TikTok / hanya Tokopedia / hanya TikTok / kosong; total TikTok tidak berubah', () => {
  const st0 = katalog([['', 20000, '5550009']]);
  const dua = E.compute([ttSumber([['9101', 'TikTok Shop', '2026/01/10', 100000], ['9102', 'Tokopedia', '2026/01/11', 300000]])], st0);
  eq(Object.keys(dua.tiktok.bySource).sort().join(), 'TikTok Shop,Tokopedia'); eq(bsSum(dua), dua.tiktok.sales); eq(dua.tiktok.sales, 400000, 'Tokopedia bukan penjualan tambahan');
  eq(dua.tiktok.bySource.Tokopedia.sales, 300000); eq(dua.tiktok.bySource.Tokopedia.orders, 1);
  // Kolom sumber dikosongkan: total keuangan identik (sumber hanya pengelompokan).
  const kosong = E.compute([ttSumber([['9101', '', '2026/01/10', 100000], ['9102', '', '2026/01/11', 300000]])], st0);
  eq(Object.keys(kosong.tiktok.bySource).join(), 'Lainnya', 'sumber kosong tidak ditebak'); eq(tanpaBs(kosong.tiktok), tanpaBs(dua.tiktok), 'angka TikTok identik');
  eq(Object.keys(E.compute([ttSumber([['9103', 'Tokopedia', '2026/01/10', 100000]])], st0).tiktok.bySource).join(), 'Tokopedia');
  eq(Object.keys(E.compute([ttSumber([['9104', 'TikTok Shop', '2026/01/10', 100000]])], st0).tiktok.bySource).join(), 'TikTok Shop');
});
test('V1A sumber: filter periode, baris dengan nomor pesanan sama, HPP tidak diketahui/perkiraan', () => {
  const f = ttSumber([['9201', 'Tokopedia', '2026/01/10', 100000], ['9202', 'TikTok Shop', '2026/02/10', 200000], ['9203', 'Tokopedia', '2026/02/12', 50000]]);
  const feb = E.compute([f], katalog([['', 20000, '5550009']]), {}, { from: '2026-02', to: '2026-02' });
  eq(bsSum(feb), feb.tiktok.sales, 'mengikuti filter'); eq(feb.tiktok.bySource.Tokopedia.sales, 50000);
  // Nomor pesanan sama di dua baris (tanggal dana berbeda): dihitung sebagai 2 BARIS pesanan, bukan pesanan unik.
  const dup = E.compute([ttSumber([['9301', 'Tokopedia', '2026/01/10', 100000, undefined, '2026/01/15'], ['9301', 'Tokopedia', '2026/01/10', 100000, undefined, '2026/01/20']])], katalog([['', 20000, '5550009']]));
  eq(dup.tiktok.bySource.Tokopedia.orders, 2, 'definisi: baris pesanan'); eq(dup.tiktok.orders, 2, 'sama dengan definisi "Pesanan terjual" TikTok');
  // HPP tidak diketahui / perkiraan tidak mengubah penjualan per sumber.
  const unk = E.compute([f], katalog([])), est = E.compute([f], { modalMode: 'produk', catalog: [], fallbackPct: 40 });
  eq(JSON.stringify(Object.entries(unk.tiktok.bySource).map(([k, v]) => [k, v.sales, v.orders])), JSON.stringify(Object.entries(est.tiktok.bySource).map(([k, v]) => [k, v.sales, v.orders])));
});
test('V1A tampilan: tanpa laba/modal per sumber, keterangan wajib, aturan sembunyi', () => {
  const a = src('app.js'), fn = a.slice(a.indexOf('function sourceBlock'), a.indexOf('/** Tabel bulanan'));
  truthy(!/v\.margin|dengan laba|\.modal|feeTotal|received/.test(fn), 'tidak ada laba/modal/potongan/dana per sumber');
  truthy(!/\$\{num\(v\.orders\)\} pesanan\$\{r\.ready \? ` dengan laba/.test(a), 'kalimat laba per sumber lama sudah dihapus');
  truthy(fn.includes('Pesanan Tokopedia dalam bagian ini sudah termasuk total Laporan Penghasilan TikTok Shop, bukan penjualan tambahan.'), 'keterangan termasuk');
  truthy(fn.includes('Laba dan modal per sumber belum ditampilkan karena data belum cukup untuk memastikan kelengkapannya.'), 'keterangan laba');
  truthy(/Math\.abs\(sum - r\.tiktok\.sales\) > 1\) return '<p class="small muted">Rincian penjualan per sumber pesanan tidak ditampilkan/.test(fn), 'tidak cocok → disembunyikan');
  truthy(/if \(all\.length === 1\)/.test(fn) && /'Tanpa keterangan sumber'/.test(a), 'satu sumber tanpa tabel; sumber kosong tidak ditebak');
  truthy(/<th scope="col">Baris pesanan<\/th>/.test(fn), 'label jujur: baris pesanan');
  truthy(/Tidak perlu mengunggah laporan Tokopedia terpisah untuk pesanan yang sama\./.test(a) && !/Tokopedia (sudah )?didukung/i.test(a), 'status unggah; tanpa klaim Tokopedia mandiri');
});
/* ===== Auth V3, bantuan WhatsApp, pindah alamat, service worker Cloudflare ===== */
test('AUTH-V3 form: placeholder, kolom daftar lengkap, konfirmasi sandi, masuk tanpa aturan sandi baru', () => {
  const ak = src('akun.js'), html = fs.readFileSync(path.join(__dirname, '..', 'akun.html'), 'utf8');
  for (const ph of ['Masukkan email Anda', 'Masukkan kata sandi', 'Masukkan nama lengkap', 'contoh@email.com', 'Contoh: 081234567890', 'Buat kata sandi', 'Ulangi kata sandi']) truthy(ak.includes(ph), `placeholder ${ph}`);
  truthy(/<label for="hp">Nomor HP\/WhatsApp\$\{REQ\}<\/label>/.test(ak) && /const REQ = ' <span class="req" aria-hidden="true">\*<\/span>';/.test(ak) && !/opsional/i.test(ak) && /'Konfirmasi kata sandi'/.test(ak), 'label daftar');
  truthy(/id="nm" [^>]*required/.test(ak) && /id="hp" [^>]*required/.test(ak), 'daftar email: nama dan nomor HP wajib');
  truthy(/<label for="nm">Nama lengkap\$\{REQ\}<\/label>/.test(ak) && /emailField\('contoh@email\.com', REQ\)/.test(ak) && /pwField\('pw', `Kata sandi\$\{REQ\}`/.test(ak) && /confirmField\('pw2', 'pw', REQ\)/.test(ak), 'daftar: kelima kolom wajib bertanda *');
  truthy(/: emailField\(\)\}/.test(ak) && /pwField\('pw', 'Kata sandi', 'current-password'/.test(ak) && /confirmField\('pw1b', 'pw1'\)/.test(ak), 'form masuk & ganti sandi tanpa tanda *');
  truthy(/case 'hp': return !v\.trim\(\) \? 'Nomor HP\/WhatsApp wajib diisi untuk mendaftar dengan email\.' : A\.normalisasiHp\(v\)\.ok \? '' : A\.PESAN_HP;/.test(ak), 'nomor wajib + validasi format');
  truthy(/case 'pf-wa': return v\.trim\(\) === input\.dataset\.awal \? ''/.test(ak), 'halaman Akun: nomor tidak dipaksa (pengguna Google/lama)');
  truthy(!/user_metadata[^;]*whatsapp[^;]*return 'Nomor/.test(ak) && !/signIn[^;]*whatsapp/.test(ak), 'masuk tidak mensyaratkan nomor');
  truthy(/confirmField\('pw2', 'pw', REQ\)/.test(ak) && /confirmField\('pw1b', 'pw1'\)/.test(ak), 'konfirmasi di daftar & ganti sandi');
  truthy(/pwField\('pw', 'Kata sandi', 'current-password', 'Masukkan kata sandi'\)/.test(ak), 'form masuk: tanpa data-baru (sandi lama tidak dicek aturan baru)');
  truthy(/return v \? '' : 'Kata sandi wajib diisi\.';/.test(ak), 'kolom sandi masuk hanya wajib diisi');
  truthy(/<script src="assets\/aturan-akun\.js\?v=\w+"><\/script>\s*<script src="assets\/situs\.js\?v=\w+" defer><\/script>\s*<script src="assets\/akun\.js/.test(html), 'aturan dimuat sebelum akun.js');
});
test('AUTH-V3 privasi data: sandi tidak masuk draft/profil/log; nomor hanya ke metadata lalu profiles.whatsapp', () => {
  const ak = src('akun.js'), cl = src('cloud.js');
  truthy(/const DRAFT_IDS = \['em', 'nm', 'hp'\];/.test(ak), 'draft tanpa kata sandi');
  truthy(!/console\.(log|info|debug|warn)/.test(ak + cl + src('aturan-akun.js') + src('situs.js')), 'tanpa log');
  truthy(/const data = \{ full_name: fullName \|\| '' \};\s*if \(whatsapp\) data\.whatsapp = whatsapp;/.test(cl), 'metadata daftar: nama + nomor saja');
  truthy(/if \(!saved \|\| saved\.whatsapp !== n\.nilai\) return \{ status: 'gagal', nomor \};/.test(ak), 'salin: hasil dicek dari respons server');
  truthy(/catch \(e\) \{ return \{ status: 'gagal', nomor \}; \}\s*\/\/[^\n]*\n\s*try \{ await cloud\.auth\.updateMetadata\(\{ whatsapp: null \}\);/.test(ak), 'metadata dihapus hanya setelah profil tersimpan');
  truthy(/if \(r\.status === 'gagal'\) \{ message = null; render\(\); return; \}/.test(ak), 'gagal salin: tidak diam-diam ke dashboard');
  truthy(/belum tersimpan ke akun Anda\. Periksa nomor di bawah, lalu tekan Simpan profil\./.test(ak) && /value="\$\{esc\(waIsi\)\}" data-awal="\$\{esc\(wa\)\}"/.test(ak), 'status gagal + nomor diisikan ulang untuk disimpan');
  truthy(/saved\.whatsapp !== patch\.whatsapp\)\) throw/.test(ak), 'simpan profil: nomor dicek dari respons server');
  truthy(/if \(wa\.value\.trim\(\) !== wa\.dataset\.awal\) patch\.whatsapp/.test(ak), 'nomor lama tak berformat tidak diubah/diblokir bila tidak disunting');
  truthy(/id="wa-ajak"/.test(ak), 'ajakan melengkapi nomor (pengguna Google/lama)');
});
test('waSupport: kunci config terpisah & kosong; pembayaran tetap bergantung pada whatsapp; tautan tersembunyi bawaan', () => {
  const cfg = src('config.js'), appJs = src('app.js');
  truthy(/waSupport: '',/.test(cfg) && /domainResmi: '',/.test(cfg), 'kosong (tanpa nomor fiktif)');
  truthy(/const PAY_READY = !!C\.whatsapp;/.test(appJs) && !/waSupport/.test(appJs), 'alur pembayaran tidak membaca waSupport');
  const pages = { 'index.html': 'Beranda', 'dashboard.html': 'Dashboard', 'akun.html': 'Akun' };
  for (const [f, nama] of Object.entries(pages)) {
    const h = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const links = [...h.matchAll(/<a [^>]*data-wa-support="([^"]+)"[^>]*>/g)];
    truthy(links.length >= 1 && links.every((m) => m[1] === nama && / hidden[ >]/.test(m[0]) && !/href=/.test(m[0])), `${f}: tautan bantuan tersembunyi tanpa href`);
    truthy(/<script src="assets\/situs\.js\?v=\w+" defer><\/script>/.test(h), `${f}: memuat situs.js`);
  }
});
test('Privasi: nomor HP & tujuannya, Cloudflare, Supabase, Resend; paragraf Google hanya bila aktif', () => {
  const pv = fs.readFileSync(path.join(__dirname, '..', 'privasi.html'), 'utf8');
  truthy(/Nomor wajib diisi bila Anda mendaftar dengan email dan kata sandi/.test(pv) && /nomor tidak wajib untuk masuk/.test(pv) && /mengubah atau menghapus nomor di halaman Akun kapan saja; menghapus nomor tidak menghalangi Anda masuk/.test(pv) && /Bila pemindahan gagal, halaman Akun memberi tahu Anda/.test(pv) && !/opsional/i.test(pv), 'aturan wajib/opsional');
  truthy(/<h2>Nomor HP\/WhatsApp<\/h2>/.test(pv) && /tidak dipakai untuk iklan, tidak dijual, dan tidak dipakai sebagai kode verifikasi \(OTP\)/.test(pv) && /tidak diverifikasi otomatis/.test(pv), 'nomor HP');
  for (const s of ['<b>Cloudflare</b>', '<b>Supabase</b>', '<b>Resend</b>']) truthy(pv.includes(s), s);
  truthy(/<li id="google-note" hidden>/.test(pv) && /getElementById\('google-note'\)\.hidden = !C\.googleLogin;/.test(pv), 'Google hanya bila googleLogin aktif');
});
test('Service worker Cloudflare: kunci cache /x, /x.html, /x?q sama; respons redirect dibersihkan; fallback hanya navigasi', () => {
  const vm = require('vm'), code = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const make = (origin, scope) => { const ctx = { self: { location: new URL(`${origin}${scope}sw.js`), registration: { scope: `${origin}${scope}` }, addEventListener() {} }, URL, Response: class {} }; ctx.location = ctx.self.location; vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };
  const cf = make('https://cekuntung.id', '/');
  for (const u of ['/dashboard', '/dashboard.html', '/dashboard?demo', '/dashboard.html#x']) eq(cf.kunci(`https://cekuntung.id${u}`), 'https://cekuntung.id/dashboard.html', u);
  for (const u of ['/', '/index', '/index.html', '/?x=1']) eq(cf.kunci(`https://cekuntung.id${u}`), 'https://cekuntung.id/', u);
  eq(cf.kunci('https://cekuntung.id/assets/app.css?v=1'), 'https://cekuntung.id/assets/app.css');
  eq(cf.kunci('dashboard.html'), 'https://cekuntung.id/dashboard.html', 'nama file CORE');
  const gh = make('https://x.github.io', '/cek-profit/');
  eq(gh.kunci('https://x.github.io/cek-profit/akun.html?mode=daftar'), 'https://x.github.io/cek-profit/akun.html');
  eq(gh.kunci('https://x.github.io/cek-profit/'), 'https://x.github.io/cek-profit/');
  eq(gh.kunci('./'), 'https://x.github.io/cek-profit/', 'CORE ./');
  truthy(/if \(!res\.redirected\) return res;/.test(code) && /nav \? caches\.match\(kunci\('dashboard\.html'\)\) : Response\.error\(\)/.test(code), 'redirect dibersihkan; fallback dashboard hanya untuk navigasi');
  truthy(/'assets\/aturan-akun\.js', 'assets\/situs\.js'/.test(code), 'file baru ikut cache offline');
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;

test('Batch 2 Pusat Data Marketplace V2: kategori lengkap, tombol unggah hanya untuk parser yang ada', () => {
  const appJs = src('app.js');
  const blok = appJs.slice(appJs.indexOf('const SUMBER = {'), appJs.indexOf('const PERAN = {'));
  const kat = [...appJs.slice(appJs.indexOf('const KATEGORI = ['), appJs.indexOf('const PERLU = {')).matchAll(/\['(\w+)', '([^']+)'/g)].map((m) => m[1]);
  eq(kat.join(','), 'income,orders,ads,return,balance,payout,product,modal', '8 kategori tetap tercatat');
  for (const mp of ['shopee', 'tiktok', 'tokopedia', 'lazada']) truthy(new RegExp(`\\b${mp}: \\{`).test(blok), `marketplace ${mp}`);
  const kinds = [...blok.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
  for (const k of kinds) truthy(['shopee_income', 'shopee_orders', 'shopee_return', 'shopee_balance', 'tiktok_income', 'tiktok_orders', 'tiktok_return', 'modal_template'].includes(k), `kind dikenal engine: ${k}`);
  truthy(!/kind: '(tokopedia|lazada)/.test(blok), 'tanpa parser Tokopedia/Lazada');
  truthy(!/payout: \{[^}]*kind:/.test(blok) && !/ads: \{[^}]*kind:/.test(blok) && !/product: \{[^}]*kind:/.test(blok), 'iklan, pencairan, produk tanpa parser');
  truthy(/Pencairan dana tidak pernah dihitung sebagai penjualan/.test(blok), 'pencairan bukan penjualan');
  truthy(/const bisa = \(cat\) => \['ok', 'beta'\]\.includes\(S\[cat\]\.st\) && S\[cat\]\.kind;/.test(appJs), 'baris unggah hanya untuk Didukung/Beta');
  truthy(/const PERAN = \{ income: 'utama', modal: 'utama', orders: 'pendukung', return: 'pendukung' \}/.test(appJs) && /Wajib untuk laba/.test(appJs), 'wajib: Laporan Penghasilan + modal; pesanan & retur opsional');
  truthy(/id="file-input" type="file" multiple/.test(appJs) && /id="drop"/.test(appJs), 'unggah massal tetap ada (satu area)');
  truthy(/File kosong: tidak ada data yang bisa dibaca\./.test(appJs), 'file kosong ditolak');
  truthy(/Dipilih untuk \$\{esc\(KIND\[f\.expect\]/.test(appJs), 'file salah kategori diberi tahu');
  for (const s of ["`Berhasil dibaca", "'Duplikat diabaikan'", "'Perlu diperiksa'", "`Format tidak sesuai"]) truthy(appJs.includes(s), `status ringkas ${s}`);
});
