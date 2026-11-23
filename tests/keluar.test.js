/* Uji M3: pilihan "hapus data toko di browser ini" saat keluar. Data SINTETIS.
 * Definisi:
 *  - Data toko = modal & pengaturan (cekprofit.v3), nama toko & logo (cekprofit.profile), price list, catatan retur,
 *    dan catatan status sinkron. Tema dan kode akses lama TIDAK dihapus.
 *  - Ditanya hanya bila ada data toko di browser. Dicentang otomatis hanya bila semua sudah tersimpan di akun dan tidak
 *    ada catatan retur (catatan retur hanya ada di browser ini). Bila belum tersimpan: tidak dicentang + peringatan.
 * Jalankan: node tests/keluar.test.js
 */
const S = require('../assets/sinkron.js');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'harus benar'); };
const mem = (isi = {}) => { const m = new Map(Object.entries(isi)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const LENGKAP = { 'cekprofit.v3': '{"catalog":[]}', 'cekprofit.profile': '{"store":"Toko A","logo":"data:image/png;base64,xx"}', 'cekprofit.pricelist': '{"baris":[]}',
  'cekprofit.theme': 'dark', 'cekprofit.license': '"CP1.kode"', 'cekprofit.session': '{}', 'cekprofit.ingat': '1' };

test('K1 semua tersimpan, tanpa catatan retur → ditanya, dicentang otomatis', () => {
  eq(S.pilihanKeluar(mem(LENGKAP), true), { tanya: true, centang: true, belumTersimpan: false, catatanRetur: 0 });
});
test('K2 ada perubahan belum tersimpan → tidak dicentang + peringatan', () => {
  const p = S.pilihanKeluar(mem(LENGKAP), false);
  eq([p.centang, p.belumTersimpan], [false, true]);
  truthy(S.teksKeluar(p).catatan.some((c) => c.jenis === 'warn' && /belum tersimpan/.test(c.teks)));
  truthy(!S.teksKeluar(p).catatan.some((c) => /tetap aman/.test(c.teks)), 'tidak boleh menjanjikan data aman di akun');
});
test('K3 ada catatan retur (hanya di browser) → tidak dicentang + jumlahnya disebut', () => {
  const p = S.pilihanKeluar(mem({ ...LENGKAP, 'cekprofit.cases': '{"A1":"kembali","A2":"","A3":"hilang"}' }), true);
  eq([p.centang, p.catatanRetur], [false, 2]);
  truthy(S.teksKeluar(p).catatan.some((c) => /2 catatan retur/.test(c.teks)));
});
test('K4 tidak ada data toko → tidak ditanya (langsung keluar)', () => {
  eq(S.pilihanKeluar(mem({ 'cekprofit.theme': 'dark', 'cekprofit.session': '{}', 'cekprofit.sinkron': '1' }), true).tanya, false);
});
test('K5 halaman Akun membaca status dari catatan dashboard; tanpa catatan = dianggap belum tersimpan', () => {
  eq(S.pilihanKeluar(mem({ ...LENGKAP, 'cekprofit.sinkron': '1' })).centang, true);
  eq(S.pilihanKeluar(mem({ ...LENGKAP, 'cekprofit.sinkron': '0' })).belumTersimpan, true);
  eq(S.pilihanKeluar(mem(LENGKAP)).belumTersimpan, true);
});
test('K6 hapus hanya data toko; tema, kode akses, pilihan ingat tetap', () => {
  const st = mem({ ...LENGKAP, 'cekprofit.cases': '{"A1":"x"}', 'cekprofit.sinkron': '1' });
  eq(S.hapusDataToko(st), 5);
  eq([...st.m.keys()].sort(), ['cekprofit.ingat', 'cekprofit.license', 'cekprofit.session', 'cekprofit.theme']);
});
test('K7 penyimpanan diblokir / catatan retur rusak → tidak error', () => {
  const rusak = { getItem: () => { throw new Error('diblokir'); }, removeItem: () => { throw new Error('diblokir'); } };
  eq(S.pilihanKeluar(rusak, true).tanya, false); eq(S.hapusDataToko(rusak), 0);
  eq(S.pilihanKeluar(mem({ ...LENGKAP, 'cekprofit.cases': '{rusak' }), true).catatanRetur, 0);
});
test('K8 teks: semua tersimpan → "tetap aman di akun"; label menyebut data yang dihapus', () => {
  const t = S.teksKeluar(S.pilihanKeluar(mem(LENGKAP), true));
  truthy(/modal, nama toko, logo, price list/.test(t.label)); eq(t.catatan.map((c) => c.jenis), ['info']);
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji keluar lulus');
process.exit(failed ? 1 : 0);
