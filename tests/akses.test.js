/* Uji status Pro dan akses fitur (assets/akses.js).
 *
 * Langkah 0 adalah refactor TANPA perubahan perilaku. Buktinya:
 *  - `lamaDashboard()` dan `lamaSitus*()` di bawah adalah SALINAN logika sebelum refactor (commit 607e851,
 *    assets/app.js baris 117–142 dan assets/situs.js baris 37–53). Salinan ini dibekukan sebagai acuan (oracle).
 *  - Bagian B: tabel kasus bernama, dicek terhadap harapan DAN terhadap CekAkses.
 *  - Bagian C: semua kombinasi keadaan (± 9.600) dibandingkan antara oracle dan CekAkses; harus identik.
 *  - Bagian D: temuan perbedaan antarhalaman. Dikunci apa adanya; perubahan D1/D2 dilakukan di commit terpisah.
 *
 * Jalankan: node tests/akses.test.js
 */
const fs = require('fs');
const path = require('path');
const A = require('../assets/akses.js');
const CekCloud = require('../assets/cloud.js');
const CekSitus = require('../assets/situs.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const baca = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/* ===== Oracle: salinan perilaku sebelum refactor (jangan diubah) ===== */
const TGL_ISO = /^\d{4}-\d{2}-\d{2}$/;
function lamaDashboard({ demo = false, licenseOk = false, profile = null, serverStatus = null, betaGratisSampai = '',
  perangkat, cloudEnabled = true, login = false, halaman = 'ringkasan' }) {
  const st = serverStatus && typeof serverStatus === 'object' && TGL_ISO.test(String(serverStatus.hari_ini || '')) ? serverStatus : null;   // loadStatus
  const hariIni = st ? st.hari_ini : perangkat;
  const beta = (() => {
    if (st) return st.beta_aktif === true && TGL_ISO.test(String(st.beta_gratis_sampai || '')) ? st.beta_gratis_sampai : '';
    const s = String(betaGratisSampai || '').trim();
    return TGL_ISO.test(s) && hariIni <= s ? s : '';
  })();
  const proAkun = CekCloud.isPro(profile, hariIni);
  const proSendiri = licenseOk || proAkun;
  const pro = demo || proSendiri || !!beta;
  const perluAkun = !demo && cloudEnabled && !login && ['produk', 'biaya', 'retur', 'riwayat'].includes(halaman);
  const sumber = demo ? 'contoh' : proAkun ? 'akun' : licenseOk ? 'kode' : beta ? 'beta' : null;   // urutan planText
  return { pro, proSendiri, proAkun, betaSampai: beta, hariIni, sumber, perluAkun,
    batas: { temuan: pro ? Infinity : 2, produk: pro ? Infinity : 5, riwayat: pro ? Infinity : 3 } };
}
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const lamaLabel = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
function lamaSitusBeta(cfg, hariIni) {
  const s = String((cfg && cfg.betaGratisSampai) || '').trim();
  if (!TGL_ISO.test(s)) return { aktif: false, sampai: '', label: '' };
  return { aktif: String(hariIni) <= s, sampai: s, label: lamaLabel(s) };
}
function lamaSitusServer(st) {
  if (!st || typeof st !== 'object' || !TGL_ISO.test(String(st.hari_ini || ''))) return null;
  const s = st.beta_gratis_sampai;
  if (s == null) return { aktif: false, sampai: '', label: '' };
  if (!TGL_ISO.test(String(s))) return null;
  return { aktif: st.beta_aktif === true, sampai: s, label: lamaLabel(s) };
}

/** Keadaan dashboard memakai CekAkses (cara app.js memanggilnya setelah refactor). */
function baruDashboard(x) {
  const serverStatus = A.statusServerSah(x.serverStatus);
  const s = A.status({ ...x, serverStatus });
  return { ...s, perluAkun: A.perluAkun({ demo: x.demo, cloudEnabled: x.cloudEnabled ?? true, login: x.login, halaman: x.halaman ?? 'ringkasan' }), batas: A.batas(s) };
}
const KUNCI = ['pro', 'proSendiri', 'proAkun', 'betaSampai', 'hariIni', 'sumber', 'perluAkun'];
const samaDashboard = (x) => {
  const a = lamaDashboard(x), b = baruDashboard(x);
  for (const k of KUNCI) eq(b[k], a[k], k);
  for (const k of ['temuan', 'produk', 'riwayat']) eq(b.batas[k], a.batas[k], `batas.${k}`);
  return b;
};

/* ===== A. Fungsi dasar ===== */

test('A1 pro_until hari ini masih Pro (inklusif), kemarin tidak', () => {
  eq(A.proAkun({ pro_until: '2026-12-13' }, '2026-12-13'), true);
  eq(A.proAkun({ pro_until: '2026-12-12' }, '2026-12-13'), false);
  eq(A.proAkun(null, '2026-12-13'), false);
  eq(A.proAkun({ pro_until: null }, '2026-12-13'), false);
});
test('A2 format pro_until dari Supabase: kolom bertipe date → teks "YYYY-MM-DD"', () => {
  // supabase/schema.sql: `pro_until date`. PostgREST mengirim kolom date sebagai "2026-12-13" (tanpa jam/zona).
  if (!/pro_until\s+date\b/.test(baca('supabase/schema.sql'))) throw new Error('tipe kolom pro_until berubah; periksa ulang perbandingan tanggal');
  const dariServer = JSON.parse('{"pro_until":"2026-12-13"}');
  eq(A.proAkun(dariServer, '2026-12-13'), true, 'hari terakhir');
  eq(A.proAkun(dariServer, '2026-12-14'), false, 'sehari setelahnya');
  eq(A.proAkun(dariServer, '2027-01-01'), false, 'ganti tahun');
});
test('A3 CekCloud.isPro tetap sama dengan CekAkses.proAkun', () => {
  for (const u of [null, '2026-12-12', '2026-12-13', '2026-12-14']) for (const h of ['2026-12-13', '2027-01-01']) {
    eq(A.proAkun({ pro_until: u }, h), CekCloud.isPro({ pro_until: u }, h), `${u} vs ${h}`);
  }
});
test('A4 statusServerSah: hanya jawaban dengan hari_ini bertanggal yang dipakai', () => {
  eq(A.statusServerSah(null), null);
  eq(A.statusServerSah('teks'), null);
  eq(A.statusServerSah({ hari_ini: 'kemarin' }), null);
  const ok = { hari_ini: '2026-12-01' };
  eq(A.statusServerSah(ok), ok);
});
test('A5 boleh(): fitur tidak dikenal ditolak (tidak diam-diam terbuka)', () => {
  let err = null; try { A.boleh({ pro: true }, 'tidakAda'); } catch (e) { err = e; }
  if (!err) throw new Error('harus error');
  eq(A.boleh({ pro: false }, 'pdf'), false);
  eq(A.boleh({ pro: true }, 'excel'), true);
});
test('A6 tabel FITUR Langkah 0 hanya berisi fitur yang sudah ada (tanpa kebocoran)', () => {
  eq(Object.keys(A.FITUR).sort().join(','), 'excel,pdf');
  eq('kebocoran' in A.FITUR, false);
});

/* ===== B. Tabel kasus bernama (dashboard) ===== */

const HARI = '2026-12-10';
const KASUS = [
  ['B1 tamu tanpa beta membuka Ringkasan', { perangkat: HARI }, { pro: false, perluAkun: false, sumber: null, temuan: 2, produk: 5 }],
  ['B2 tamu membuka Produk → perlu akun', { perangkat: HARI, halaman: 'produk' }, { pro: false, perluAkun: true }],
  ['B3 layanan akun mati → tidak dikunci', { perangkat: HARI, halaman: 'produk', cloudEnabled: false }, { perluAkun: false }],
  ['B4 mode contoh: Pro, tidak dikunci', { perangkat: HARI, demo: true, halaman: 'produk' }, { pro: true, perluAkun: false, sumber: 'contoh' }],
  ['B5 akun gratis', { perangkat: HARI, login: true }, { pro: false, sumber: null, temuan: 2, produk: 5, riwayat: 3 }],
  ['B6 akun Pro, pro_until hari ini', { perangkat: HARI, login: true, profile: { pro_until: HARI } }, { pro: true, sumber: 'akun', riwayat: Infinity }],
  ['B7 akun Pro kedaluwarsa kemarin', { perangkat: HARI, login: true, profile: { pro_until: '2026-12-09' } }, { pro: false, sumber: null }],
  ['B8 kode akses sah', { perangkat: HARI, licenseOk: true }, { pro: true, proSendiri: true, sumber: 'kode' }],
  ['B9 beta config, hari terakhir', { perangkat: '2026-12-13', betaGratisSampai: '2026-12-13', login: true }, { pro: true, proSendiri: false, sumber: 'beta' }],
  ['B10 beta config, sudah lewat', { perangkat: '2026-12-14', betaGratisSampai: '2026-12-13', login: true }, { pro: false, sumber: null }],
  ['B11 server beta_aktif true + tanggal sah → Pro (beta)', { perangkat: HARI, login: true,
    serverStatus: { hari_ini: HARI, beta_aktif: true, beta_gratis_sampai: '2026-12-13' } }, { pro: true, proSendiri: false, sumber: 'beta', betaSampai: '2026-12-13' }],
  ['B12 server beta_aktif false menang atas config', { perangkat: HARI, betaGratisSampai: '2026-12-31', login: true,
    serverStatus: { hari_ini: HARI, beta_aktif: false, beta_gratis_sampai: '2026-12-13' } }, { pro: false, sumber: null }],
  ['B13 Pro dinilai dengan tanggal server, bukan perangkat', { perangkat: '2026-12-09', login: true, profile: { pro_until: '2026-12-09' },
    serverStatus: { hari_ini: HARI, beta_aktif: false, beta_gratis_sampai: null } }, { pro: false }],
  ['B14 urutan label: akun Pro mengalahkan kode dan beta', { perangkat: '2026-12-13', betaGratisSampai: '2026-12-13', licenseOk: true,
    login: true, profile: { pro_until: '2027-01-01' } }, { sumber: 'akun' }],
  ['B15 jawaban server rusak (hari_ini salah) → tanggal perangkat + config', { perangkat: '2026-12-13', betaGratisSampai: '2026-12-13', login: true,
    serverStatus: { hari_ini: 'x', beta_aktif: false } }, { pro: true, sumber: 'beta', hariIni: '2026-12-13' }],
];
for (const [nama, input, harap] of KASUS) {
  test(nama, () => {
    const b = samaDashboard(input);
    for (const [k, v] of Object.entries(harap)) eq(['temuan', 'produk', 'riwayat'].includes(k) ? b.batas[k] : b[k], v, k);
  });
}

/* ===== C. Kesetaraan menyeluruh: oracle vs CekAkses ===== */

test('C1 dashboard: semua kombinasi keadaan memberi hasil identik', () => {
  const profil = [null, { pro_until: null }, { pro_until: '2026-12-09' }, { pro_until: '2026-12-10' }, { pro_until: '2026-12-11' }];
  const server = [null, 'rusak', { hari_ini: 'x' }, { hari_ini: '2026-12-10', beta_aktif: true, beta_gratis_sampai: '2026-12-13' },
    { hari_ini: '2026-12-10', beta_aktif: false, beta_gratis_sampai: '2026-12-13' }, { hari_ini: '2026-12-10', beta_aktif: true, beta_gratis_sampai: null },
    { hari_ini: '2026-12-10', beta_aktif: true, beta_gratis_sampai: 'rusak' }, { hari_ini: '2026-12-14', beta_aktif: true, beta_gratis_sampai: '2026-12-13' }];
  const config = ['', ' 2026-12-10 ', '2026-12-09', '2026-12-13', '13-12-2026'];
  let n = 0;
  for (const demo of [false, true]) for (const licenseOk of [false, true]) for (const profile of profil) for (const serverStatus of server)
    for (const betaGratisSampai of config) for (const perangkat of ['2026-12-09', '2026-12-10', '2026-12-14'])
      for (const login of [false, true]) for (const halaman of ['ringkasan', 'produk']) {
        samaDashboard({ demo, licenseOk, profile, serverStatus, betaGratisSampai, perangkat, login, halaman, cloudEnabled: true }); n++;
      }
  for (const cloudEnabled of [false, true]) for (const h of ['ringkasan', 'produk', 'biaya', 'retur', 'riwayat', 'simulator']) {
    samaDashboard({ perangkat: HARI, cloudEnabled, halaman: h }); n++;
  }
  if (n < 9000) throw new Error(`kombinasi terlalu sedikit: ${n}`);
});
test('C2 halaman publik (situs.js): betaGratis dan betaDariServer identik dengan sebelum refactor', () => {
  const sama = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);
  for (const s of ['', '2026-12-13', ' 2026-12-13 ', 'rusak', null]) for (const h of ['2026-12-12', '2026-12-13', '2026-12-14']) {
    sama(CekSitus.betaGratis({ betaGratisSampai: s }, h), lamaSitusBeta({ betaGratisSampai: s }, h), `config ${s} ${h}`);
  }
  sama(CekSitus.betaGratis(null, '2026-12-13'), lamaSitusBeta(null, '2026-12-13'), 'cfg null');
  for (const st of [null, 'x', { hari_ini: 'x' }, { hari_ini: '2026-12-01', beta_gratis_sampai: null }, { hari_ini: '2026-12-01', beta_gratis_sampai: 'rusak' },
    { hari_ini: '2026-12-01', beta_aktif: true, beta_gratis_sampai: '2026-12-13' }, { hari_ini: '2026-12-01', beta_aktif: false, beta_gratis_sampai: '2026-12-13' },
    { hari_ini: '2026-12-01', beta_aktif: 'true', beta_gratis_sampai: '2026-12-13' }]) {
    sama(CekSitus.betaDariServer(st), lamaSitusServer(st), JSON.stringify(st));
  }
});
test('C3 akses.js dimuat sebelum script yang memakainya di setiap halaman', () => {
  const urutan = { 'dashboard.html': ['akses.js', 'app.js'], 'akun.html': ['akses.js', 'akun.js'], 'admin.html': ['akses.js', 'CekAkses.proAkun'],
    'index.html': ['akses.js', 'situs.js'], 'privasi.html': ['akses.js', 'situs.js'] };
  for (const [f, [dulu, lalu]] of Object.entries(urutan)) {
    const s = baca(f), i = s.indexOf(`src="assets/${dulu}`), j = lalu.includes('.js') ? s.indexOf(`src="assets/${lalu}`) : s.indexOf(lalu);
    if (i < 0 || j < 0 || i > j) throw new Error(`${f}: ${dulu} harus sebelum ${lalu}`);
  }
  if (!baca('sw.js').includes("'assets/akses.js'")) throw new Error('akses.js belum masuk cache offline (sw.js CORE)');
});

test('C4 app.js: hariIni/betaGratis/proAkun yang masih ditulis di app.js sama dengan oracle (penjaga teks)', () => {
  // Tiga fungsi ini belum dipindah ke CekAkses di commit ini (teksnya dikunci tests/tampilan.test.js). Bila app.js
  // diubah, C1 tidak lagi membuktikan dashboard; test ini gagal agar perubahan itu disadari.
  const app = baca('assets/app.js');
  for (const baris of [
    "const hariIni = () => (serverStatus ? serverStatus.hari_ini : new Date().toLocaleDateString('sv-SE'));",
    "if (serverStatus) return serverStatus.beta_aktif === true && TGL_ISO.test(String(serverStatus.beta_gratis_sampai || '')) ? serverStatus.beta_gratis_sampai : '';",
    "return TGL_ISO.test(s) && hariIni() <= s ? s : '';",
    'const proAkun = (p = account.profile) => CekCloud.isPro(p, hariIni());',
    'const proSendiri = () => license.ok || proAkun();',
    'const isPro = () => demo || proSendiri() || !!betaGratis();',
    'serverStatus = CekAkses.statusServerSah(st);',
    "const perluAkun = (v = viewName) => CekAkses.perluAkun({ demo, cloudEnabled: cloud.enabled, login: !!account.user, halaman: v });",
  ]) if (!app.includes(baris)) throw new Error(`app.js berubah: ${baris.slice(0, 70)}`);
});

/* ===== D. Temuan: perbedaan antarhalaman (dikunci apa adanya di commit ini) ===== */

test('D1 TEMUAN: dashboard memakai tanggal server, halaman Akun/Admin memakai tanggal perangkat', () => {
  const profil = { pro_until: '2026-12-13' };
  const dashboard = baruDashboard({ perangkat: '2026-12-13', login: true, profile: profil,
    serverStatus: { hari_ini: '2026-12-14', beta_aktif: false, beta_gratis_sampai: null } });
  eq(dashboard.pro, false, 'dashboard');
  eq(A.proAkun(profil, '2026-12-13'), true, 'akun/admin (tanggal perangkat)');
  if (!baca('assets/akun.js').includes('CekAkses.proAkun(p, CekAkses.tanggalPerangkat())')) throw new Error('akun.js berubah');
  if (!baca('admin.html').includes('CekAkses.proAkun(p, CekAkses.tanggalPerangkat())')) throw new Error('admin.html berubah');
});
test('D2 TEMUAN: tanggal beta rusak dari server → dashboard mematikan beta, situs.js kembali ke config', () => {
  const st = { hari_ini: HARI, beta_aktif: true, beta_gratis_sampai: 'rusak' };
  eq(baruDashboard({ perangkat: HARI, betaGratisSampai: '2026-12-31', serverStatus: st }).betaSampai, '', 'dashboard');
  eq(CekSitus.betaDariServer(st), null, 'situs (null = pakai config)');
});
test('D3 TEMUAN (dibiarkan, keputusan pemilik): kode akses memakai tanggal UTC', () => {
  if (!baca('assets/license.js').includes("const today = () => new Date().toISOString().slice(0, 10);")) throw new Error('license.js berubah');
});

console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
process.exitCode = failed ? 1 : 0;
