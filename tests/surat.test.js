/* Uji Generator Surat PMK 37/2025 (assets/surat.js) dengan identitas SINTETIS. Jalankan: node tests/surat.test.js */
const S = require('../assets/surat.js');
const fs = require('fs'), path = require('path');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };
const DASAR = { nama: 'Budi Contoh', nomor: '1234.5678.9012.3456', alamat: 'Jl. Contoh No. 1, Kota Contoh', kedudukan: 'wp', pilihan: 'sampai',
  kota: 'Kota Contoh', tanggal: '2026-10-27', jenisWp: 'op', konfirmasi: { seluruhUsaha: true, benar: true } };

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
// Kalimat resmi Lampiran A PMK 37/2025 hal. 14 (disalin dari PDF resmi). Surat harus memuat persis kalimat ini.
const RESMI = ['SURAT PERNYATAAN', 'Saya yang bertanda tangan di bawah ini:',
  'dengan ini menyatakan bahwa Wajib Pajak yang disebutkan di atas merupakan Wajib Pajak yang memiliki peredaran bruto atas penghasilan dari usaha',
  'Rp500.000.000,00 (lima ratus juta rupiah).',
  'Saya bersedia menerima akibat hukum apabila ternyata di kemudian hari Surat Pernyataan ini terbukti tidak benar, termasuk penerapan sanksi sesuai ketentuan peraturan perundang-undangan di bidang perpajakan yang berlaku.',
  'Demikian Surat Pernyataan ini dibuat dengan sebenar-benarnya tanpa ada tekanan atau paksaan dari pihak manapun.',
  'Wajib Pajak', 'Wakil/Kuasa dari Wajib Pajak', 'Meterai'];
const teks = (h) => h.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
test('U7 teks resmi: semua kalimat Lampiran A ada persis; tidak ada judul peraturan/kalimat tambahan', () => {
  eq(S.tersedia(), true); const t = teks(S.html(DASAR));
  for (const k of RESMI) truthy(t.includes(k), `kalimat resmi hilang: ${k.slice(0, 50)}`);
  truthy(!/LAMPIRAN|CONTOH FORMAT|PERATURAN MENTERI/.test(t), 'judul lampiran tidak dicetak');
  // Seluruh teks = kalimat resmi + isian pengguna saja (tanpa kalimat buatan).
  const potong = [...RESMI, 'Nama', 'NPWP/NIK', 'Alamat', 'Selaku', ':', 'sampai dengan', DASAR.nama, DASAR.nomor, DASAR.alamat, 'Kota Contoh, 27 Oktober 2026', '✓'];
  let sisa = t; for (const k of potong.sort((a, b) => b.length - a.length)) sisa = sisa.split(k).join(' ');   // frasa terpanjang dulu
  eq(sisa.replace(/[\s.,]/g, ''), '', 'ada teks di luar format resmi');
});
test('U9 (7) "sampai dengan" vs "melebihi" tercetak sesuai pilihan', () => {
  truthy(/dari usaha sampai dengan Rp500\.000\.000,00/.test(teks(S.html(DASAR))), 'sampai dengan');
  const m = teks(S.html({ ...DASAR, pilihan: 'melebihi' })); truthy(/dari usaha melebihi Rp500\.000\.000,00/.test(m) && !/sampai dengan/.test(m), 'melebihi');
});
test('U10 wajib pajak sendiri: (4)–(6) kosong; kuasa: (4)–(6) identitas WP; (9) nama terang penandatangan', () => {
  const sendiri = S.html(DASAR);
  eq((sendiri.match(/class="sd-dot"/g) || []).length, 3, '(4)–(6) dibiarkan kosong'); truthy(/sd-box[^>]*>✓<\/span> Wajib Pajak/.test(sendiri), 'kotak Wajib Pajak dicentang');
  const K = { ...DASAR, kedudukan: 'kuasa', nama: 'Kuasa Contoh', wp: { nama: 'Wajib Pajak Contoh', nomor: '123456789012345', alamat: 'Jl. WP 2' } };
  const k = S.html(K), tk = teks(k);
  truthy(/sd-box[^>]*>✓<\/span> Wakil\/Kuasa dari Wajib Pajak/.test(k) && !/sd-box[^>]*>✓<\/span> Wajib Pajak </.test(k), 'kotak kuasa dicentang');
  truthy(tk.includes('Wajib Pajak Contoh') && tk.includes('123456789012345') && tk.includes('Jl. WP 2'), '(4)–(6)');
  truthy(/<p class="sd-nama">Kuasa Contoh<\/p>/.test(k), '(9) nama terang wakil/kuasa yang menandatangani');
  eq((k.match(/class="sd-dot"/g) || []).length, 0);
});
test('U11 (8) kota, tanggal, bulan, tahun; isian di-escape (tanpa HTML dari pengguna)', () => {
  truthy(teks(S.html({ ...DASAR, tanggal: '2026-01-05' })).includes('Kota Contoh, 5 Januari 2026'), 'format tanggal');
  const x = S.html({ ...DASAR, nama: '<img src=x onerror=alert(1)>' }); truthy(!/<img/.test(x) && /&lt;img/.test(x), 'escape');
});
test('U12 kesesuaian dengan kalkulator (omzet yang sudah terjadi)', () => {
  truthy(S.validasi({ ...DASAR, kondisiKalkulator: 'melebihi' }).galat.pilihan, 'sudah melebihi → "sampai dengan" ditolak');
  truthy(S.validasi({ ...DASAR, pilihan: 'melebihi', kondisiKalkulator: 'sampai' }).galat.pilihan, 'belum melebihi → "melebihi" ditolak');
  eq(S.validasi({ ...DASAR, kondisiKalkulator: null }).ok, true, 'tidak dapat dicocokkan → tidak memblokir');
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
