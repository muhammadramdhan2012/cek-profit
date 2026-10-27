/* Uji Generator Surat PMK 37/2025 (assets/surat.js) dengan identitas SINTETIS. Jalankan: node tests/surat.test.js */
const S = require('../assets/surat.js');
const fs = require('fs'), path = require('path');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };
const DASAR = { nama: 'Budi Contoh', nomor: '1234.5678.9012.3456', alamat: 'Jl. Contoh No. 1, Kota Contoh', kedudukan: 'wp', pilihan: 'sampai',
  tahun: 2026, kota: 'Kota Contoh', tanggal: '2026-10-27', jenisWp: 'op', konfirmasi: { seluruhUsaha: true, benar: true } };

test('U1 surat "sampai dengan Rp500 juta" oleh wajib pajak sendiri: valid', () => { const v = S.validasi(DASAR); eq(v.ok, true, JSON.stringify(v.galat)); });
test('U2 surat "melebihi Rp500 juta": valid', () => eq(S.validasi({ ...DASAR, pilihan: 'melebihi' }).ok, true));
test('U3 wakil/kuasa: identitas wajib pajak yang diwakili wajib & diperiksa formatnya', () => {
  const v = S.validasi({ ...DASAR, kedudukan: 'kuasa' });
  eq(v.ok, false); truthy(v.galat.wpNama && v.galat.wpNomor && v.galat.wpAlamat, 'semua identitas WP diwajibkan');
  eq(S.validasi({ ...DASAR, kedudukan: 'kuasa', wp: { nama: 'Ani Contoh', nomor: '12345', alamat: 'Jl. Lain 2' } }).galat.wpNomor.includes('Format'), true);
  eq(S.validasi({ ...DASAR, kedudukan: 'kuasa', wp: { nama: 'Ani Contoh', nomor: '123456789012345', alamat: 'Jl. Lain 2' } }).ok, true, 'NPWP 15 digit');
});
test('U4 NPWP/NIK kosong atau format salah ditolak; hanya format yang diperiksa', () => {
  eq(S.validasi({ ...DASAR, nomor: '' }).galat.nomor, 'NPWP/NIK wajib diisi.');
  for (const x of ['12345', '12345678901234567', '1234abcd90123456']) truthy(/Format NPWP\/NIK/.test(S.validasi({ ...DASAR, nomor: x }).galat.nomor || ''), x);
  eq(S.formatNomorOk('12.345.678.9-012.345'), true, 'tanda baca NPWP lama diabaikan');
});
test('U5 kesesuaian jenis: "sampai dengan Rp500 juta" hanya untuk orang pribadi (PMK 37/2025 Ps. 10(1)a)', () => {
  truthy(S.validasi({ ...DASAR, jenisWp: 'pp' }).galat.jenisWp, 'perseroan perorangan ditolak');
  eq(S.validasi({ ...DASAR, jenisWp: 'badan', pilihan: 'melebihi' }).ok, true);
});
test('U6 konfirmasi seluruh usaha & kebenaran wajib', () => {
  const v = S.validasi({ ...DASAR, konfirmasi: {} }); truthy(v.galat.seluruhUsaha && v.galat.benar, 'dua konfirmasi');
});
test('U7 tanpa teks resmi: surat TIDAK dibuat (tidak dikarang)', () => {
  eq(S.tersedia(), false); eq(S.html(DASAR), null);
});
test('U8 privasi: modul surat tidak menyimpan/mengirim/mencatat identitas', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'surat.js'), 'utf8');
  truthy(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\.|sendBeacon/.test(src), 'tanpa penyimpanan/jaringan/log');
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
  const blok = app.slice(app.indexOf('/* Generator surat pernyataan PMK 37/2025.'), app.indexOf('  function renderPajakOut() {'));
  truthy(blok.length > 500 && !/store\.set|localStorage|CekCloud|track\(|fetch\(/.test(blok), 'UI surat tidak menyimpan/mengirim');
});
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA OK');
process.exit(failed ? 1 : 0);
