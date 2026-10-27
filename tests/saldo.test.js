/* Uji Money Trace Shopee v1 (assets/saldo.js) dengan data SINTETIS. Jalankan: node tests/saldo.test.js
 * File saldo asli seller tidak disimpan di repo; hasil terhadap file asli diperiksa terpisah (angka agregat saja).
 */
const C = require('../assets/saldo.js');
const E = require('../assets/engine.js');
const Demo = require('../assets/demo.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };

const HEAD = ['Tanggal Transaksi', 'Tipe Transaksi', 'Deskripsi', 'No. Pesanan', 'Jenis Transaksi', 'Jumlah', 'Status', 'Saldo Akhir'];
/** Bangun sheet saldo sintetis dari baris kronologis [waktu, tipe, ref, jumlah]; saldo akhir dihitung berantai dari `awal`. */
function saldoSheet(baris, { awal = 0, dari = '2026-01-01', ke = '2026-01-31', putusDi = -1, ringkasan = true, status = {} } = {}) {
  let s = awal;
  const rows = baris.map(([w, tipe, ref, j], i) => {
    s += j; if (i === putusDi) s += 1000;   // saldo tidak berantai (sengaja)
    return [w, tipe, tipe === 'Penarikan Dana' ? 'Penarikan Dana' : `${tipe} #${ref}`, ref || '-', j >= 0 ? 'Transaksi Masuk' : 'Transaksi Keluar', j, status[i] || 'Transaksi Selesai', s];
  });
  const masuk = baris.filter((b) => b[3] > 0), keluar = baris.filter((b) => b[3] < 0);
  const top = [['Laporan'], [], ['Username (Penjual)', 'toko_uji'], ['Dari', dari], ['Ke', ke], [],
    ...(ringkasan ? [['Ringkasan', '', '', '', '$', 'Mata Uang', 'Jumlah Transaksi'],
      ['Total Saldo Masuk', '', '', '', masuk.reduce((a, b) => a + b[3], 0), 'IDR', masuk.length],
      ['Total Saldo Keluar', '', '', '', keluar.reduce((a, b) => a + b[3], 0), 'IDR', keluar.length]] : []), [], ['Rincian Transaksi'], HEAD];
  return { 'Transaction Report': [...top, ...rows.reverse()] };   // Shopee: baris terbaru lebih dulu
}
/** Laporan Penghasilan Shopee sintetis dalam bentuk hasil parser engine (hanya bidang yang dipakai saldo.js). */
const income = (orders, adj = [], from = '2026-01-01', to = '2026-01-31') => ({ kind: 'shopee_income',
  orders: orders.map(([id, payDate, total]) => ({ id, payDate, total })),
  adjustments: adj.map(([date, amount, orderId, type = 'Kompensasi']) => ({ key: `${date}|${type}|${amount}|${orderId}`, date, amount, orderId, type })),
  check: { from, to } });

const DASAR = [
  ['2026-01-05 10:00:00', 'Penghasilan dari Pesanan', 'A1', 100000],
  ['2026-01-06 11:00:00', 'Penghasilan dari Pesanan', 'A2', 50000],
  ['2026-01-07 09:00:00', 'Penghasilan dari Pesanan', 'A3', -12800],     // pesanan bernilai negatif
  ['2026-01-08 08:00:00', 'Penyesuaian', 'A9', 44100],
  ['2026-01-10 12:00:00', 'Penarikan Dana', '', -150000],
];
const INC = income([['A1', '2026-01-05', 100000], ['A2', '2026-01-06', 50000], ['A3', '2026-01-07', -12800]], [['2026-01-08', 44100, 'A9']]);
const T = (baris = DASAR, opt, inc = [INC]) => C.trace([C.parse(saldoSheet(baris, opt))], inc);
const st = (t, sumber = 'saldo') => Object.fromEntries(Object.entries(t.status[sumber]).map(([k, v]) => [k, v.n]));

test('S1 baca saldo: kolom, periode, ringkasan resmi cocok, urutan kronologis', () => {
  const p = C.parse(saldoSheet(DASAR));
  eq(p.rows.length, 5); eq(p.rows[0].ref, 'A1', 'baris pertama kronologis'); eq(p.meta.dari, '2026-01-01'); eq(p.meta.ke, '2026-01-31');
  eq(p.cocokRingkasan, true); eq(p.rantai.berantai, true); eq(p.rows[4].ref, '', 'penarikan tanpa referensi ("-")');
});
test('S2 normal: pesanan, pesanan negatif, penyesuaian cocok 1:1; penarikan = tidak cukup data (tanpa data bank)', () => {
  const t = T();
  eq(JSON.stringify(st(t)), JSON.stringify({ cocok: 4, di_luar_periode: 0, belum_direkonsiliasi: 0, tidak_cukup_data: 1 }));
  eq(t.item.find((x) => x.ref === 'A3').status, 'cocok', 'pesanan negatif −Rp12.800');
  const w = t.item.find((x) => x.jenis === 'penarikan'); eq(w.status, 'tidak_cukup_data'); eq(w.alasan, 'tanpa_data_bank');
});
test('S3 saldo awal + masuk + keluar = saldo akhir (berantai); kelompok terpisah', () => {
  const t = T(DASAR, { awal: 25000 });
  eq(t.saldo.awal, 25000); eq(t.saldo.masuk, 194100); eq(t.saldo.keluar, -162800); eq(t.saldo.akhir, 56300); eq(t.saldo.persamaan, true); eq(t.saldo.berantai, true);
  eq(t.kelompok.pesanan.jumlah, 137200); eq(t.kelompok.penyesuaian.jumlah, 44100); eq(t.kelompok.penarikan.jumlah, -150000);
});
test('S4 unggah ganda (file sama 2x) dan file tumpang tindih: baris dihitung sekali, hasil sama', () => {
  const a = C.parse(saldoSheet(DASAR)), b = C.parse(saldoSheet(DASAR.slice(0, 3)));
  const t1 = C.trace([a], [INC]), t2 = C.trace([a, a], [INC, INC]), t3 = C.trace([b, a], [INC]);
  eq(t2.file.identik, 1); eq(t2.file.barisGanda, 5); eq(t3.file.barisGanda, 3);
  for (const t of [t2, t3]) { eq(JSON.stringify(t.saldo), JSON.stringify(t1.saldo)); eq(JSON.stringify(t.status), JSON.stringify(t1.status)); }
});
test('S5 satu pesanan muncul 2x di saldo (bukan unggah ganda): hanya satu yang cocok, sisanya belum direkonsiliasi', () => {
  const t = T([...DASAR.slice(0, 1), ['2026-01-05 10:05:00', 'Penghasilan dari Pesanan', 'A1', 100000]]);
  const a1 = t.item.filter((x) => x.ref === 'A1' && x.sumber === 'saldo');
  eq(a1.filter((x) => x.status === 'cocok').length, 1); eq(a1.filter((x) => x.alasan === 'pasangan_sudah_dipakai').length, 1);
});
test('S6 nominal beda Rp1 TIDAK cocok (tanpa toleransi); tanggal beda juga tidak cocok', () => {
  const t = T(DASAR, {}, [income([['A1', '2026-01-05', 100001], ['A2', '2026-01-07', 50000], ['A3', '2026-01-07', -12800]], [['2026-01-08', 44100, 'A9']])]);
  eq(t.item.find((x) => x.ref === 'A1' && x.sumber === 'saldo').alasan, 'nominal_berbeda');
  eq(t.item.find((x) => x.ref === 'A2' && x.sumber === 'saldo').alasan, 'tanggal_berbeda');
  eq(t.status.penghasilan.belum_direkonsiliasi.n, 2, 'sisi penghasilan juga ditandai, tidak dianggap hilang');
});
test('S7 periode berbeda: saldo di luar periode Laporan Penghasilan → di luar periode (bukan hilang)', () => {
  const t = T([...DASAR, ['2026-02-03 10:00:00', 'Penghasilan dari Pesanan', 'B1', 70000]], { ke: '2026-02-28' });
  const b1 = t.item.find((x) => x.ref === 'B1'); eq(b1.status, 'di_luar_periode'); eq(b1.alasan, 'di_luar_periode_penghasilan');
  const inc2 = income([['A1', '2026-01-05', 100000], ['Z9', '2026-03-02', 9000]], [], '2026-01-01', '2026-03-31');
  const z9 = T(DASAR.slice(0, 1), {}, [inc2]).item.find((x) => x.ref === 'Z9'); eq(z9.status, 'di_luar_periode'); eq(z9.alasan, 'di_luar_periode_saldo');
});
test('S8 penyesuaian tanpa pasangan: belum direkonsiliasi, selisih ditampilkan, tidak dibuat penyesuaian otomatis', () => {
  const t = T([...DASAR.slice(0, 4), ['2026-01-09 08:00:00', 'Penyesuaian', 'A8', 42000], ['2026-01-09 09:00:00', 'Penyesuaian', 'A7', 60060], DASAR[4]]);
  eq(t.saldo.berantai, true);
  eq(t.penyesuaian.saldo, 146160); eq(t.penyesuaian.cocok, 44100); eq(t.penyesuaian.belumTerjelaskan, 102060);
  eq(t.item.filter((x) => x.alasan === 'penyesuaian_tanpa_pasangan').length, 2);
  eq(t.saldo.akhir, 137200 + 44100 - 150000 + 42000 + 60060, 'saldo akhir tetap dari laporan, tanpa koreksi');
});
test('S9 saldo tidak berantai: ditandai, persamaan tidak diklaim', () => {
  const t = T(DASAR, { putusDi: 2 });
  eq(t.saldo.berantai, false); eq(t.saldo.putus, 1); eq(t.saldo.persamaan, false);
});
test('S10 tanpa Laporan Penghasilan: pesanan & penyesuaian = tidak cukup data, saldo tetap dibaca', () => {
  const t = T(DASAR, {}, []);
  eq(st(t).tidak_cukup_data, 5); eq(t.item[0].alasan, 'laporan_penghasilan_tidak_ada'); eq(t.saldo.akhir, 31300);
});
test('S11 versi penghasilan berbeda untuk nomor sama (dua file): tidak dipaksa cocok', () => {
  const t = T(DASAR, {}, [INC, income([['A1', '2026-01-05', 90000]])]);
  eq(t.item.find((x) => x.ref === 'A1' && x.sumber === 'saldo').alasan, 'versi_penghasilan_berbeda');
});
test('S12 pesanan Rp0 tanpa mutasi saldo: tidak cukup data (bukan hilang); hari terakhir periode diberi alasan khusus', () => {
  const t = T([...DASAR, ['2026-01-31 22:00:00', 'Penghasilan dari Pesanan', 'C1', 8000]], {}, [income([...INC.orders.map((o) => [o.id, o.payDate, o.total]), ['N0', '2026-01-20', 0]], [['2026-01-08', 44100, 'A9']])]);
  eq(t.item.find((x) => x.ref === 'N0').alasan, 'nilai_nol_tanpa_mutasi');
  const c1 = t.item.find((x) => x.ref === 'C1'); eq(c1.status, 'belum_direkonsiliasi'); eq(c1.alasan, 'tidak_ada_di_penghasilan_hari_terakhir');
});
test('S13 status selain "Transaksi Selesai" dan tipe tak dikenal → tidak cukup data', () => {
  const t = T([...DASAR, ['2026-01-11 10:00:00', 'Isi Ulang Saldo', '', 5000]], { status: { 0: 'Sedang Diproses' } });
  eq(t.item.find((x) => x.ref === 'A1').alasan, 'status_belum_selesai'); eq(t.item.find((x) => x.jenis === 'lain').alasan, 'jenis_belum_dikenali');
});
test('S14 format salah / kosong / ringkasan tidak cocok: pesan jelas, bukan saldo Rp0', () => {
  let m = ''; try { C.parse({ Sheet1: [['a']] }); } catch (e) { m = e.message; } truthy(/Transaction Report/.test(m), 'tanpa sheet');
  m = ''; try { C.parse({ 'Transaction Report': [['Tanggal Transaksi', 'Jumlah']] }); } catch (e) { m = e.message; } truthy(/Kolom laporan saldo tidak lengkap/.test(m), 'kolom kurang');
  m = ''; try { C.parse({ 'Transaction Report': [HEAD] }); } catch (e) { m = e.message; } truthy(/tidak berisi transaksi/.test(m), 'kosong');
  const sh = saldoSheet(DASAR); sh['Transaction Report'][7][4] += 1;   // Total Saldo Masuk resmi diubah
  eq(C.parse(sh).cocokRingkasan, false); eq(C.trace([C.parse(sh)], [INC]).file.cocokRingkasan, false);
});
test('S15 laba tidak berubah: Engine.compute dengan/tanpa file saldo identik', () => {
  const parsed = Demo.make().map((wb) => E.parseWorkbook(wb));
  const sal = E.parseWorkbook({ name: 'saldo.xlsx', sheets: saldoSheet(DASAR) });
  eq(sal.kind, 'shopee_balance');
  // Satu-satunya perbedaan yang diizinkan: catatan sumber data "saldo" (tidak ada → diunggah). Selain itu harus identik.
  const norm = (r) => JSON.stringify(r).replace(/"saldo":"[^"]*"/, '"saldo":"-"');
  const a = E.compute(parsed, {}), b = E.compute([...parsed, sal], {});
  for (const k of ['totalSales', 'totalFees', 'totalReceived', 'totalModal', 'totalMargin', 'knownSales', 'coverage']) {
    truthy(a[k] !== undefined, `kunci ${k} ada`); eq(JSON.stringify(b[k]), JSON.stringify(a[k]), k);
  }
  truthy(JSON.stringify(a) !== JSON.stringify(b), 'catatan saldo memang berubah (bukti file saldo masuk ke engine)');
  eq(norm(b), norm(a), 'seluruh hasil identik kecuali catatan sumber data saldo');
});
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA OK');
process.exit(failed ? 1 : 0);
