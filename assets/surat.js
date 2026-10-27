/* Cek Untung — Generator Surat Pernyataan Peredaran Bruto (PMK 37/2025, lampiran).
 *
 * Murni (tanpa DOM), diuji di Node: tests/surat.test.js. Semua data identitas diproses di browser saja; modul ini tidak
 * menyimpan, mengirim, atau mencatat apa pun.
 *
 * TEKS berisi teks lampiran resmi PMK 37/2025 (format surat halaman 14, petunjuk pengisian (1)–(9) halaman 15), disalin
 * kata demi kata dari PDF resmi. Selama TEKS = null (PDF resmi belum terbaca), pratinjau dan PDF TIDAK dibuat: isi surat
 * tidak boleh dikarang atau diparafrasakan.
 */
const CekSurat = (() => {
  const TEKS = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bersih = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  /** NPWP (15/16 digit) atau NIK (16 digit). Hanya FORMAT yang diperiksa; keberadaannya di DJP tidak bisa dipastikan di sini. */
  const nomor = (s) => String(s ?? '').replace(/[\s.\-]/g, '');
  const formatNomorOk = (s) => /^\d{15}$|^\d{16}$/.test(nomor(s));

  /**
   * @param {object} f
   *  nama, nomor, alamat (penanda tangan); kedudukan 'wp'|'kuasa'; wp: { nama, nomor, alamat } bila kuasa;
   *  pilihan 'sampai'|'melebihi'; tahun; kota; tanggal ('YYYY-MM-DD'); jenisWp ('op'|lainnya);
   *  konfirmasi: { seluruhUsaha, benar, sendiri } (boolean).
   * @returns {{ ok: boolean, galat: Object<string,string> }}
   */
  function validasi(f) {
    const g = {};
    const wajib = (k, v, label) => { if (!bersih(v)) g[k] = `${label} wajib diisi.`; };
    wajib('nama', f.nama, 'Nama'); wajib('alamat', f.alamat, 'Alamat');
    if (!bersih(f.nomor)) g.nomor = 'NPWP/NIK wajib diisi.';
    else if (!formatNomorOk(f.nomor)) g.nomor = 'Format NPWP/NIK tidak sesuai: isi 15 atau 16 angka.';
    if (!['wp', 'kuasa'].includes(f.kedudukan)) g.kedudukan = 'Pilih kedudukan: wajib pajak atau wakil/kuasa.';
    if (f.kedudukan === 'kuasa') {
      const w = f.wp || {};
      wajib('wpNama', w.nama, 'Nama wajib pajak yang diwakili'); wajib('wpAlamat', w.alamat, 'Alamat wajib pajak yang diwakili');
      if (!bersih(w.nomor)) g.wpNomor = 'NPWP/NIK wajib pajak yang diwakili wajib diisi.';
      else if (!formatNomorOk(w.nomor)) g.wpNomor = 'Format NPWP/NIK wajib pajak yang diwakili tidak sesuai: isi 15 atau 16 angka.';
    }
    if (!['sampai', 'melebihi'].includes(f.pilihan)) g.pilihan = 'Pilih: peredaran bruto sampai dengan atau melebihi Rp500.000.000,00.';
    if (!/^\d{4}$/.test(String(f.tahun || ''))) g.tahun = 'Tahun pajak tidak valid.';
    wajib('kota', f.kota, 'Kota'); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.tanggal || ''))) g.tanggal = 'Tanggal wajib diisi.';
    // Pengecualian pungutan karena peredaran bruto ≤ Rp500 juta hanya untuk wajib pajak orang pribadi (PMK 37/2025 Ps. 10(1)a).
    if (f.pilihan === 'sampai' && f.jenisWp && f.jenisWp !== 'op') g.jenisWp = 'Surat "sampai dengan Rp500 juta" hanya untuk wajib pajak orang pribadi.';
    const k = f.konfirmasi || {};
    if (!k.seluruhUsaha) g.seluruhUsaha = 'Nyatakan bahwa peredaran bruto mencakup seluruh usaha.';
    if (!k.benar) g.benar = 'Nyatakan bahwa isi surat sesuai keadaan sebenarnya.';
    return { ok: !Object.keys(g).length, galat: g };
  }

  /** HTML surat (A4) dari TEKS resmi. null bila TEKS belum tersedia atau isian belum valid. */
  function html(f) {
    if (!TEKS || !validasi(f).ok) return null;
    return TEKS.render(f, { esc, bersih, nomor });
  }

  return { validasi, html, formatNomorOk, nomor, tersedia: () => !!TEKS };
})();
if (typeof module !== 'undefined') module.exports = CekSurat;
