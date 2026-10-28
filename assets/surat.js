/* Cek Untung — Generator Surat Pernyataan Peredaran Bruto (PMK 37/2025, lampiran).
 *
 * Murni (tanpa DOM), diuji di Node: tests/surat.test.js. Semua data identitas diproses di browser saja; modul ini tidak
 * menyimpan, mengirim, atau mencatat apa pun.
 *
 * TEKS berisi teks lampiran resmi PMK 37/2025 (format surat halaman 14, petunjuk pengisian (1)–(9) halaman 15), disalin
 * kata demi kata dari PDF resmi. Isi surat tidak boleh dikarang atau diparafrasakan; ubah hanya bila lampiran resmi berubah.
 */
const CekSurat = (() => {
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const titik = '<span class="sd-dot" aria-hidden="true"></span>';
  /*
   * Teks dan susunan menurut Lampiran A PMK 37/2025 hal. 14 (contoh format) dan hal. 15 (petunjuk pengisian (1)–(9)),
   * dari PDF resmi yang dilampirkan pemilik 28 Okt 2026. Judul lampiran dan "A. CONTOH FORMAT …" adalah judul peraturan,
   * bukan isi surat, sehingga tidak dicetak. Nomor (1)–(9) diganti isian sesuai petunjuk; tidak ada kalimat tambahan.
   *  (1)–(3) penandatangan · (4)–(6) Wajib Pajak, hanya bila penandatangan wakil/kuasa (selain itu dibiarkan kosong)
   *  (7) "sampai dengan" / "melebihi" · (8) kota, tanggal, bulan, tahun · (9) nama terang Wajib Pajak atau wakil/kuasa.
   */
  const TEKS = {
    sumber: 'Lampiran A PMK 37 Tahun 2025, hal. 14–15',
    render(f, { esc, bersih }) {
      const isi = (v) => (bersih(v) ? esc(bersih(v)) : titik);
      const kuasa = f.kedudukan === 'kuasa', w = f.wp || {};
      const kotak = (on) => `<span class="sd-box" aria-hidden="true">${on ? '✓' : ''}</span>`;
      const [y, m, d] = String(f.tanggal).split('-').map(Number);
      const baris = (k, v) => `<tr><td class="sd-k">${k}</td><td class="sd-c">:</td><td>${v}</td></tr>`;
      const sub = (k, v) => `<tr><td class="sd-k">${k}</td><td class="sd-c">:</td><td>${v}</td></tr>`;
      return `<article class="surat-doc" lang="id">
  <h1 class="sd-judul">SURAT PERNYATAAN</h1>
  <p>Saya yang bertanda tangan di bawah ini:</p>
  <table class="sd-tab">
    ${baris('Nama', isi(f.nama))}
    ${baris('NPWP/NIK', isi(f.nomor))}
    ${baris('Alamat', isi(f.alamat))}
    <tr><td class="sd-k">Selaku</td><td class="sd-c">:</td><td>
      <div class="sd-pil">${kotak(!kuasa)} Wajib Pajak <span class="sr-only">${!kuasa ? '(dipilih)' : ''}</span></div>
      <div class="sd-pil">${kotak(kuasa)} Wakil/Kuasa dari Wajib Pajak <span class="sr-only">${kuasa ? '(dipilih)' : ''}</span></div>
      <table class="sd-tab sd-sub">
        ${sub('Nama', kuasa ? isi(w.nama) : titik)}
        ${sub('NPWP/NIK', kuasa ? isi(w.nomor) : titik)}
        ${sub('Alamat', kuasa ? isi(w.alamat) : titik)}
      </table></td></tr>
  </table>
  <p class="sd-just">dengan ini menyatakan bahwa Wajib Pajak yang disebutkan di atas merupakan Wajib Pajak yang memiliki peredaran bruto atas penghasilan dari usaha ${f.pilihan === 'melebihi' ? 'melebihi' : 'sampai dengan'} Rp500.000.000,00 (lima ratus juta rupiah).<br>
  Saya bersedia menerima akibat hukum apabila ternyata di kemudian hari Surat Pernyataan ini terbukti tidak benar, termasuk penerapan sanksi sesuai ketentuan peraturan perundang-undangan di bidang perpajakan yang berlaku.</p>
  <p class="sd-just">Demikian Surat Pernyataan ini dibuat dengan sebenar-benarnya tanpa ada tekanan atau paksaan dari pihak manapun.</p>
  <div class="sd-ttd">
    <p>${esc(bersih(f.kota))}, ${d} ${BULAN[m - 1]} ${y}</p>
    <div class="sd-meterai">Meterai</div>
    <p class="sd-nama">${esc(bersih(f.nama))}</p>
  </div>
</article>`;
    },
  };

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
    wajib('kota', f.kota, 'Kota'); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.tanggal || ''))) g.tanggal = 'Tanggal wajib diisi.';
    // Pengecualian pungutan karena peredaran bruto ≤ Rp500 juta hanya untuk wajib pajak orang pribadi (PMK 37/2025 Ps. 10(1)a).
    if (f.pilihan === 'sampai' && f.jenisWp && f.jenisWp !== 'op') g.jenisWp = 'Surat "sampai dengan Rp500 juta" hanya untuk wajib pajak orang pribadi.';
    // Kesesuaian dengan omzet yang SUDAH terjadi di kalkulator (tanpa proyeksi). null = tidak dapat dicocokkan.
    if (f.kondisiKalkulator === 'melebihi' && f.pilihan === 'sampai') g.pilihan = 'Isian kalkulator menunjukkan peredaran bruto tahun berjalan sudah melebihi Rp500 juta. Pilih "melebihi".';
    if (f.kondisiKalkulator === 'sampai' && f.pilihan === 'melebihi') g.pilihan = 'Isian kalkulator menunjukkan peredaran bruto tahun berjalan belum melebihi Rp500 juta. Periksa kembali pilihan Anda.';
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
