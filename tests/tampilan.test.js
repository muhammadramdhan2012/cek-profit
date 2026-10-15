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

/* ===== UI-2: dashboard memakai metadata engine apa adanya ===== */
const dashSrc = appJs.slice(appJs.indexOf('/* ---------- ringkasan (UI-2)'), appJs.indexOf('  function nota(r) {'));
const covKeys = [...daftar('COV').matchAll(/\['(\w+)', '(\w+)', '([^']+)'/g)].map((x) => x[1]);
const kasus = {
  terverifikasi: () => [E.parseWorkbook(Sint.penghasilan([{ id: 'SA1', items: [{ name: 'Kaos', harga: 100000 }] }])), E.parseWorkbook(Sint.exportPesanan([{ order: 'SA1', name: 'Kaos', qty: 2, price: 50000 }]))],
  campuran: () => [E.parseWorkbook(Sint.penghasilan([{ id: 'SB1', items: [{ name: 'Kaos', harga: 100000 }] }, { id: 'SB2', items: [{ name: 'Topi', harga: 60000 }] }, { id: 'SB3', items: [{ name: 'Kaos', harga: 50000 }] },
    { id: 'SB4', items: [{ name: 'Kaos', harga: 100000, refund: -40000 }] }, { id: 'SB5', items: [{ name: 'Kaos', harga: 70000 }] }, { id: 'SB6', items: [{ name: 'Kaos', harga: 50000, refund: -50000 }] }])),
  E.parseWorkbook(Sint.exportPesanan([{ order: 'SB1', name: 'Kaos', qty: 2, price: 50000 }, { order: 'SB5', name: 'Celana', qty: 1, price: 70000 }]))],
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
  for (const m of indexTeks.matchAll(/[^.]*\bskor\b[^.]*\./gi)) truthy(/bukan skor/.test(m[0]), `skor Profit Confidence: "${m[0].trim()}"`);
});
test('W2 angka contoh di halaman depan diberi label fiktif/sintetis dan konsisten satu sama lain', () => {
  for (const label of ['Data fiktif', 'Contoh sintetis', 'Ilustrasi, data fiktif', 'Ilustrasi dengan data fiktif']) truthy(indexHtml.includes(label), `label "${label}"`);
  const nota = indexHtml.slice(indexHtml.indexOf('class="pv-nota'), indexHtml.indexOf('class="pv-float'));
  const baris = [...nota.matchAll(/<dd>([^<]+)<\/dd>/g)].map((m) => rp(m[1]));
  const laba = rp(nota.match(/class="big">([^<]+)</)[1]);
  eq(baris.length, 4, 'baris nota'); eq(baris.reduce((a, b) => a + b, 0), laba, 'nota: penjualan − potongan − modal − refund & biaya = laba');
  const alur = [...indexHtml.slice(indexHtml.indexOf('class="flow"'), indexHtml.indexOf('id="flow-cap"')).matchAll(/<b>([^<]+)<\/b>/g)].map((m) => rp(m[1]));
  eq(alur.slice(0, 4).reduce((a, b) => a + b, 0), alur[4], 'alur uang: jumlah komponen = laba');
  eq(alur.join(','), [...baris, laba].join(','), 'alur uang sama dengan nota hero');
  const seg = (sel) => [...indexHtml.match(new RegExp(`class="segbar ${sel}"[^>]*>([\\s\\S]*?)</div>`))[1].matchAll(/--w:(\d+)%/g)].reduce((a, m) => a + +m[1], 0);
  eq(seg('pv-seg'), 100, 'batang status hero = 100%'); eq(seg('pc-seg'), 100, 'batang status Profit Confidence = 100%');
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

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
