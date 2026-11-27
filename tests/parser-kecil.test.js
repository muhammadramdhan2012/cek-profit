/* Uji perbaikan parser kecil (24 Nov 2026). Data SINTETIS.
 * L3 — sheet Adjustment Shopee:
 *   - baris kosong di tengah tabel dilewati (dulu: pembacaan berhenti, penyesuaian sesudahnya hilang);
 *   - baris "Total…"/"Jumlah…" di bawah tabel = akhir tabel (tidak terhitung dobel);
 *   - baris hanya dihitung bila punya jenis penyesuaian DAN nominal angka.
 * Tanggal:
 *   - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy dan yyyy-mm-dd dikenali (urutan bulan/tanggal gaya Amerika belum, lihat P2);
 *   - tanggal mustahil (bulan 13, 31 Februari) → kosong, bukan tanggal rusak.
 * Jalankan: node tests/parser-kecil.test.js
 */
const fs = require('fs');
const E = require('../assets/engine.js');
const D = require('../assets/demo.js');
const Sint = require('./fixtures/shopee-sintetis.js');

let failed = 0;
// Data tampilan (tglPesanan, 24 Nov 2026) tidak dipakai dalam rumus; diabaikan saat membandingkan angka.
const tanpaTampilan = (k, v) => (k === 'tglPesanan' || k === 'belumDaftar' || k === 'belumDaftarPenuh' || k === 'belumAlasan' || k === 'dikeluarkanDaftar' || k === 'dikeluarkanDaftarPenuh' || k === 'dasarBulan' || k === 'pemasukanLain' || k === 'labaSetelahIsian' || (k === 'shopeeFormatLama' && v === null) ? undefined : v);
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const KOMP = 'Kompensasi atas pesanan hilang';
const HEAD = ['No.', 'Tanggal Penyesuaian Dibuat', 'Tipe Penyesuaian | Deskripsi', 'Alasan Penyesuaian', 'Biaya Penyesuaian', 'No. Pesanan Terhubung'];
/** Laporan penghasilan Shopee + sheet Adjustment. `baris` = baris tabel apa adanya; `total` = angka di ringkasan sheet. */
const laporan = (baris, total) => {
  const wb = Sint.penghasilan([{ id: 'SINT-1', items: [{ name: 'Buku', harga: 100000 }] }]);
  wb.sheets.Adjustment = [['Ringkasan Biaya Penyesuaian'], ['Total Penyesuaian', null, null, null, total], [], HEAD, ...baris];
  return E.parseWorkbook(wb);
};
const r = (no, tgl, tipe, nominal, order = '') => [no, tgl, tipe, '', nominal, order];

/* ---------- L3: sheet Adjustment ---------- */
test('L3-1 baris kosong di tengah tabel: penyesuaian sesudahnya tetap terbaca', () => {
  const p = laporan([r(1, '2026-01-25', KOMP, 50000, 'A1'), [], [null, null, null, null, null, null], r(2, '2026-02-03', 'Logistik', -12000, 'A2')], 38000);
  eq(p.adjustments.map((a) => a.amount), [50000, -12000]);
  eq(p.check.jumlah.penyesuaian, p.check.ringkasan.penyesuaian, 'harus cocok dengan Total Penyesuaian');
});
test('L3-2 baris total di bawah tabel tidak ikut terhitung', () => {
  const p = laporan([r(1, '2026-01-25', KOMP, 50000, 'A1'), r(2, '2026-01-26', 'Logistik', -12000, 'A2'), [], ['', '', 'Total', '', 38000, ''], ['', '', 'Jumlah penyesuaian', '', 38000, '']], 38000);
  eq(p.adjustments.length, 2); eq(p.check.jumlah.penyesuaian, 38000);
});
test('L3-3 baris tanpa nominal angka (catatan) tidak dihitung', () => {
  const p = laporan([r(1, '2026-01-25', KOMP, 50000, 'A1'), ['', '', 'Catatan: penyesuaian diproses 3–5 hari', '', '', ''], ['', '', 'Lihat detail', '', 'di Seller Centre', '']], 50000);
  eq(p.adjustments.map((a) => a.type), [KOMP]);
});
test('L3-4 regresi: tabel normal tanpa baris kosong tetap sama; nominal 0 tetap dihitung', () => {
  const p = laporan([r(1, '2026-01-25', KOMP, 50000, 'A1'), r(2, '2026-01-26', 'Logistik', 0, 'A2')], 50000);
  eq(p.adjustments.map((a) => [a.date, a.type, a.amount, a.orderId]), [['2026-01-25', KOMP, 50000, 'A1'], ['2026-01-26', 'Logistik', 0, 'A2']]);
});
test('L3-5 sheet Adjustment tanpa baris data: 0 penyesuaian, tidak error', () => { eq(laporan([], 0).adjustments, []); eq(laporan([[], []], 0).adjustments, []); });
test('L3-6 nominal teks format Indonesia terbaca', () => { eq(laporan([r(1, '25/01/2026', KOMP, 'Rp50.000', 'A1')], 50000).adjustments[0].amount, 50000); });
test('L3-7 penyesuaian sesudah baris kosong ikut ke perhitungan (kompensasi tercatat di hasil)', () => {
  const st = { modalMode: 'produk', catalog: [], periods: [{ start: '', markup: 0, disc: 0 }] };
  const dulu = E.compute([laporan([r(1, '2026-01-25', KOMP, 50000, 'A1')], 50000)], st, {});
  const kini = E.compute([laporan([r(1, '2026-01-25', KOMP, 50000, 'A1'), [], r(2, '2026-01-27', KOMP, 30000, 'A3')], 80000)], st, {});
  eq(kini.adjustments - dulu.adjustments, 30000);
});

/* ---------- tanggal ---------- */
test('T1 format tanggal yang dikenali', () => {
  for (const [v, h] of [['05/11/2026', '2026-11-05'], ['05-11-2026', '2026-11-05'], ['5.11.2026', '2026-11-05'], ['2026-11-05', '2026-11-05'],
    ['2026/11/5 10:00', '2026-11-05'], ['05/11/2026 13:45:00', '2026-11-05'], ['05-11-2026 08:00', '2026-11-05'], ['2026-11-05T10:00:00', '2026-11-05'], ['29/02/2028', '2028-02-29']]) eq(E.date(v), h, v);
});
test('T2 tanggal mustahil → kosong', () => { for (const v of ['35/13/2026', '31/02/2026', '29/02/2026', '2026-13-01', '2026-02-30', '00/01/2026']) eq(E.date(v), '', v); });
test('T3 pemisah campur / teks lain → kosong', () => { for (const v of ['05-11/2026', '20261105', 'kemarin', '5 Nov 2026', '']) eq(E.date(v), '', v); });
test('T4 regresi: angka seri Excel dan objek Date tetap', () => { eq(E.date(46000), '2025-12-09'); eq(E.date(new Date(2026, 10, 5)), '2026-11-05'); eq(E.date(null), ''); });

/* ---------- regresi data contoh ---------- */
test('D1 hasil hitung data contoh sama persis dengan sebelum perubahan', () => {
  const acuan = '/tmp/sebelum-demo.json';
  if (!fs.existsSync(acuan)) { console.log('      (lewati: snapshot sebelum perubahan tidak ada di mesin ini)'); return; }
  const hasil = JSON.stringify(E.compute(D.make().map((w) => E.parseWorkbook(w)), D.settings(), {}), tanpaTampilan);
  if (hasil !== JSON.stringify(JSON.parse(fs.readFileSync(acuan, 'utf8')), tanpaTampilan)) throw new Error('hasil data contoh berubah');
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji parser kecil lulus');
process.exit(failed ? 1 : 0);
