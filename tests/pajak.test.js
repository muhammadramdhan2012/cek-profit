/* Uji Pajak Seller (assets/pajak.js) dengan angka SINTETIS. Jalankan: node tests/pajak.test.js
 * Semua hasil adalah simulasi; uji memastikan aturan tidak ditebak dan data kosong tidak dianggap nol.
 */
const P = require('../assets/pajak.js');
const E = require('../assets/engine.js');
const Demo = require('../assets/demo.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };
const JT = 1000000;
/** 12 bulan omzet marketplace yang sama tiap bulan; usaha lain = 0 kecuali diberi. */
const bulan = (mpPerBulan, lainPerBulan = 0) => Array.from({ length: 12 }, () => ({ marketplace: mpPerBulan, lain: lainPerBulan }));
// hariIni setelah 2026 → semua bulan 2026 sudah terjadi (uji proyeksi ada di T15). Cakupan dikonfirmasi kecuali diuji sebaliknya.
const OP = (extra = {}) => ({ tahun: 2026, jenis: 'op', rezim: 'final', syaratFinal: true, surat: 'sudah', sampai: 12, bulan: bulan(30 * JT), hariIni: '2027-01-15', cakupanDikonfirmasi: true, ...extra });

test('T1 OP omzet < Rp500 juta setahun: PPh final Rp0, tidak ada PPh 22 bila surat sudah disampaikan', () => {
  const h = P.hitung(OP());   // 30 jt × 12 = 360 jt
  eq(h.omzet.total, 360 * JT); eq(h.terutang.status, 'simulasi'); eq(h.terutang.nilai, 0); eq(h.terutang.dasarKenaPajak, 0);
  eq(h.pph22.nilai, 0); eq(h.bulanLewat500, null);
});
test('T2 omzet TEPAT Rp500 juta: belum melewati batas → PPh final Rp0, PPh 22 tidak dipungut', () => {
  const b = bulan(0); b[0].marketplace = 500 * JT;
  const h = P.hitung(OP({ bulan: b }));
  eq(h.terutang.nilai, 0); eq(h.pph22.nilai, 0); eq(h.bulanLewat500, null);
});
test('T3 omzet > Rp500 juta: hanya bagian di atas Rp500 juta yang dikenai 0,5% (kumulatif sejak Januari)', () => {
  const h = P.hitung(OP({ bulan: bulan(50 * JT) }));   // 600 jt setahun; Okt tepat 500 jt (belum lewat), lewat di Nov (550 jt)
  eq(h.terutang.dasarKenaPajak, 100 * JT); eq(h.terutang.nilai, 500000); eq(h.bulanLewat500, 11);
  eq(h.pph22.mulaiDipungutBulan, 12, 'surat > Rp500 juta di Nov → dipungut mulai Des'); eq(h.pph22.nilai, 50 * JT * 0.005);
  const r = h.terutang.perBulan; eq(r[8].pajak, 0, 'Sep: kumulatif 450 jt'); eq(r[9].dasarKenaPajak, 0, 'Okt: kumulatif tepat 500 jt'); eq(r[10].dasarKenaPajak, 50 * JT, 'Nov'); eq(r[11].dasarKenaPajak, 50 * JT, 'Des');
});
test('T4 mendekati lalu melewati batas di tengah bulan: hanya porsi di atas batas yang dikenai', () => {
  const b = bulan(40 * JT); // kumulatif Des = 480 jt
  b[11].marketplace = 70 * JT; // Des: 440 + 70 = 510 jt → 10 jt kena
  const h = P.hitung(OP({ bulan: b }));
  eq(h.terutang.perBulan[11].dasarKenaPajak, 10 * JT); eq(h.terutang.nilai, 50000);
  eq(h.bulanLewat500, 12); eq(h.pph22.nilai, 0, 'lewat di Des → pungutan mulai Jan tahun berikutnya, di luar periode');
});
test('T5 orang pribadi vs badan: badan tidak memakai Rp500 juta; PPh terutang badan "belum didukung"', () => {
  const op = P.hitung(OP()), badan = P.hitung({ ...OP(), jenis: 'badan' });
  eq(badan.terutang.status, 'belum_didukung'); eq(badan.terutang.alasan, 'badan_belum_didukung'); eq(badan.terutang.nilai, null);
  eq(badan.pph22.skenario, 'bukan_orang_pribadi'); eq(badan.pph22.nilai, 2 * 30 * JT * 0.005, 'badan dipungut Nov–Des tanpa pengecualian Rp500 juta');
  eq(op.pph22.nilai, 0, 'OP dengan surat dan omzet ≤ Rp500 juta tidak dipungut');
});
test('T6 beberapa marketplace + usaha lain: batas memakai seluruh usaha; PPh 22 hanya atas omzet marketplace', () => {
  const h = P.hitung(OP({ bulan: bulan(20 * JT, 30 * JT) }));   // total 50 jt/bln → lewat Nov (marketplace saja baru 220 jt)
  eq(h.omzet.marketplace, 240 * JT); eq(h.omzet.lain, 360 * JT); eq(h.bulanLewat500, 11);
  eq(h.pph22.mulaiDipungutBulan, 12); eq(h.pph22.nilai, 20 * JT * 0.005, 'Des × omzet marketplace saja');
  eq(h.terutang.nilai, 100 * JT * 0.005, 'PPh final dari seluruh usaha');
});
test('T7 omzet usaha lain belum diisi: tidak dianggap 0 → PPh final belum lengkap, PPh 22 dengan surat belum lengkap', () => {
  const b = bulan(30 * JT, null);
  const h = P.hitung(OP({ bulan: b }));
  eq(h.omzet.lengkap, false); eq(h.terutang.status, 'belum_lengkap'); eq(h.terutang.nilai, null);
  eq(h.pph22.status, 'belum_lengkap'); truthy(h.catatan.some((c) => /usaha lain belum diisi/.test(c)), 'catatan');
  const nyata = P.hitung(OP({ bulan: b, tanpaUsahaLain: true }));
  eq(nyata.terutang.status, 'simulasi', 'pengguna menyatakan tidak ada usaha lain');
  const kosong = bulan(30 * JT); kosong[3].marketplace = null;
  eq(P.hitung(OP({ bulan: kosong })).terutang.status, 'belum_lengkap', 'bulan marketplace kosong ≠ Rp0');
});
test('T8 refund sudah termasuk penjualan: tidak dikurangi lagi; nilai negatif ditandai, bukan dihitung', () => {
  const b = bulan(30 * JT); b[2].marketplace = -5 * JT;
  const h = P.hitung(OP({ bulan: b }));
  eq(h.omzet.negatif, true); eq(h.terutang.status, 'belum_lengkap'); truthy(h.catatan.some((c) => /negatif/.test(c)), 'catatan negatif');
});
test('T9 pungutan aktual berbeda dari simulasi: dicatat terpisah, selisih ditampilkan, tidak dicampur dengan terutang', () => {
  const h = P.hitung({ ...OP(), jenis: 'badan', dipungutAktual: 250000 });
  eq(h.pph22.nilai, 300000); eq(h.aktual.nilai, 250000); eq(P.selisih(h), -50000); eq(h.terutang.nilai, null, 'terutang badan tetap belum didukung');
  eq(P.selisih(P.hitung(OP())), null, 'aktual kosong → tidak ada selisih');
});
test('T10 tahun sebelum aturan / tahun lain: belum didukung; bulan sebelum 1 Nov 2026 tidak dipungut', () => {
  const t25 = P.hitung({ ...OP(), tahun: 2025 });
  eq(t25.terutang.status, 'belum_didukung'); eq(t25.pph22.status, 'belum_didukung');
  const sampaiOkt = P.hitung({ ...OP(), jenis: 'badan', sampai: 10 });
  eq(sampaiOkt.pph22.nilai, 0, 'Jan–Okt 2026: pemungutan belum berlaku'); eq(sampaiOkt.pph22.omzetSebelumBerlaku, 300 * JT);
});
test('T11 syarat & rezim: Rp500 juta tidak otomatis', () => {
  eq(P.hitung(OP({ syaratFinal: false })).terutang.alasan, 'syarat_belum_dikonfirmasi');
  eq(P.hitung(OP({ rezim: 'umum' })).terutang.alasan, 'rezim_umum_belum_didukung');
  eq(P.hitung(OP({ bulan: bulan(450 * JT) })).terutang.alasan, 'melebihi_batas_4_8_miliar');
});
test('T12 status surat: belum disampaikan → dipungut sejak berlaku; tidak tahu → rentang, bukan satu angka', () => {
  eq(P.hitung(OP({ surat: 'belum' })).pph22.nilai, 2 * 30 * JT * 0.005);
  const tt = P.hitung(OP({ surat: 'tidak_tahu' }));
  eq(tt.pph22.status, 'rentang'); eq(tt.pph22.nilai, null); eq(tt.pph22.minimal, 0); eq(tt.pph22.maksimal, 300000);
});
test('T13 pajak tidak mengubah laba: Engine.compute identik, engine tidak memakai CekPajak', () => {
  const parsed = Demo.make().map((wb) => E.parseWorkbook(wb));
  const a = JSON.stringify(E.compute(parsed, {}));
  P.hitung(OP());
  eq(JSON.stringify(E.compute(parsed, {})), a);
  truthy(!/CekPajak/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'engine.js'), 'utf8')), 'engine bebas modul pajak');
});
test('T14 status data: "lengkap" hanya bila semua terisi DAN cakupan seluruh usaha dikonfirmasi', () => {
  const blm = P.hitung(OP({ cakupanDikonfirmasi: false }));
  eq(blm.omzet.status, 'cakupan_belum_dipastikan'); eq(blm.omzet.lengkap, false); eq(blm.terutang.nilai, null); eq(blm.terutang.alasan, 'cakupan_belum_dipastikan');
  eq(blm.pph22.status, 'belum_lengkap', 'OP dengan surat butuh cakupan seluruh usaha');
  eq(P.hitung(OP()).omzet.status, 'lengkap_menurut_isian', 'bukan "terverifikasi"');
});
test('T15 bulan mendatang = proyeksi, bukan transaksi aktual; bulan berjalan ditandai', () => {
  const h = P.hitung(OP({ hariIni: '2026-10-27' }));
  eq(h.perBulan[8].waktu, 'terjadi'); eq(h.perBulan[9].waktu, 'berjalan'); eq(h.perBulan[10].waktu, 'mendatang');
  eq(h.omzet.proyeksi.join(), '11,12'); eq(h.terutang.proyeksi, true); eq(h.pph22.proyeksi, true);
  truthy(h.catatan.some((c) => /belum terjadi\. Angkanya proyeksi/.test(c)) && h.catatan.some((c) => /masih berjalan/.test(c)), 'catatan proyeksi & berjalan');
  const sampaiSep = P.hitung(OP({ hariIni: '2026-10-27', sampai: 9 }));
  eq(sampaiSep.terutang.proyeksi, false, 'Jan–Sep: semua sudah terjadi');
});
test('T16 omzet dari laporan (setelah diskon) → PPh 22 ditandai perkiraan, bukan dasar resmi', () => {
  const b = bulan(30 * JT); b[10].sumber = 'laporan';
  const h = P.hitung({ ...OP({ bulan: b }), jenis: 'badan' });
  eq(h.pph22.dasarSetelahDiskon, true); eq(h.omzet.dariLaporan.join(), '11');
  truthy(h.catatan.some((c) => /setelah diskon penjual.*perkiraan, bukan dasar pungutan yang terverifikasi/.test(c)), 'catatan dasar');
  eq(P.hitung({ ...OP(), jenis: 'badan' }).pph22.dasarSetelahDiskon, false, 'isian manual tidak ditandai');
});
test('T17 jenis WP terpisah (PP 20/2026): OP, perseroan perorangan, koperasi, badan lain', () => {
  const pp = P.hitung(OP({ jenis: 'pp' }));   // 360 jt setahun, tanpa bagian Rp500 juta
  eq(pp.terutang.status, 'simulasi'); eq(pp.terutang.tidakKenaPajak, 0); eq(pp.terutang.nilai, 360 * JT * 0.005, 'perseroan perorangan: 0,5% × seluruh omzet');
  eq(pp.pph22.skenario, 'bukan_orang_pribadi'); eq(pp.pph22.nilai, 2 * 30 * JT * 0.005, 'tidak ada pengecualian surat Rp500 juta');
  eq(P.hitung(OP()).terutang.nilai, 0, 'OP 360 jt: Rp0');
  eq(P.hitung(OP({ jenis: 'koperasi' })).terutang.alasan, 'koperasi_belum_didukung');
  eq(P.hitung(OP({ jenis: 'badan' })).terutang.alasan, 'badan_belum_didukung');
});
test('T18 PPh final terutang, estimasi PPh 22, dan PPh 22 aktual tetap tiga angka terpisah', () => {
  const h = P.hitung(OP({ bulan: bulan(50 * JT), dipungutAktual: 260000 }));
  eq(h.terutang.nilai, 500000); eq(h.pph22.nilai, 250000); eq(h.aktual.nilai, 260000); eq(P.selisih(h), 10000);
  truthy(h.terutang.nilai !== h.aktual.nilai && !('dipungut' in h.terutang), 'terutang tidak dikurangi pungutan');
});
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA OK');
process.exit(failed ? 1 : 0);
