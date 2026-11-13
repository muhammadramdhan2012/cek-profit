/* Cek Untung — status Pro dan akses fitur (satu tempat).
 *
 * Murni: tanpa DOM, tanpa jaringan, tanpa localStorage. Semua masukan diberikan pemanggil, sehingga bisa diuji di Node
 * (tests/akses.test.js). Dipakai assets/app.js (dashboard), assets/akun.js, admin.html, dan assets/situs.js.
 *
 * Sumber kebenaran tetap DATABASE: `pro_until` dan masa beta di `site_settings` ditegakkan oleh fungsi database
 * (status_akun, akses_pro, batas riwayat). Modul ini hanya memutuskan apa yang TAMPIL di browser. Kunci di browser
 * adalah ajakan daftar/upgrade, bukan perlindungan data. Pembayaran (Duitku) tidak diurus di sini.
 */
const CekAkses = (() => {
  const TGL = /^\d{4}-\d{2}-\d{2}$/;

  /** Tanggal hari ini menurut perangkat, format YYYY-MM-DD (zona waktu perangkat). */
  const tanggalPerangkat = () => new Date().toLocaleDateString('sv-SE');

  /**
   * Jawaban status dari server (RPC status_situs / status_akun) dianggap sah bila `hari_ini` berformat tanggal.
   * Tidak sah (offline, SQL tahap 2 belum dijalankan, bentuk tidak dikenal) → null, lalu aturan lokal dipakai.
   */
  const statusServerSah = (st) => (st && typeof st === 'object' && TGL.test(String(st.hari_ini || '')) ? st : null);

  /** Hari ini: tanggal server bila ada jawaban sah, selain itu tanggal perangkat. */
  const hariIni = (serverStatus, perangkat = tanggalPerangkat()) => (serverStatus ? serverStatus.hari_ini : perangkat);

  /**
   * Masa beta menurut config situs (`betaGratisSampai`, inklusif).
   * @returns {{aktif:boolean, sampai:string}} sampai = '' bila tanggal kosong/format salah.
   */
  function betaDariConfig(betaGratisSampai, hari) {
    const s = String(betaGratisSampai || '').trim();
    if (!TGL.test(s)) return { aktif: false, sampai: '' };
    return { aktif: String(hari) <= s, sampai: s };
  }

  /**
   * Masa beta menurut server. Dipakai dashboard DAN halaman publik (keputusan pemilik 13 Nov 2026, D2).
   *  - Server tegas: tanggal sah + beta_aktif boolean → keputusan server dipakai (false = mati, TIDAK kembali ke config).
   *  - Server menyatakan tidak ada masa beta (beta_gratis_sampai null) → mati.
   *  - Jawaban rusak (hari_ini/tanggal beta tidak sah, atau beta_aktif bukan boolean) → null: pemanggil kembali ke config.
   */
  function betaDariServer(st) {
    if (!statusServerSah(st)) return null;
    const s = st.beta_gratis_sampai;
    if (s == null) return { aktif: false, sampai: '' };
    if (!TGL.test(String(s)) || typeof st.beta_aktif !== 'boolean') return null;
    return { aktif: st.beta_aktif, sampai: s };
  }

  /**
   * Tanggal akhir beta yang berlaku di dashboard ('' = tidak beta).
   * Ada jawaban server yang bisa dipakai → keputusan server. Jawaban rusak atau tidak ada → config, dibandingkan dengan
   * hari ini (tanggal server bila ada, selain itu tanggal perangkat).
   */
  function betaSampai({ serverStatus = null, betaGratisSampai = '', hari }) {
    const server = serverStatus ? betaDariServer(serverStatus) : null;
    const b = server || betaDariConfig(betaGratisSampai, hari);
    return b.aktif ? b.sampai : '';
  }

  /** Pro dari akun: `pro_until` (kolom date, "YYYY-MM-DD") ≥ hari ini. Inklusif: hari terakhir masih Pro. */
  const proAkun = (profile, hari) => !!(profile && profile.pro_until && profile.pro_until >= hari);

  /**
   * Status akses satu pengunjung.
   * @param {object} x
   * @param {boolean} x.demo        mode contoh (data fiktif): semua fitur terbuka
   * @param {boolean} x.licenseOk   kode akses lama sudah diperiksa dan sah
   * @param {object|null} x.profile baris profiles milik pengguna (pro_until)
   * @param {object|null} x.serverStatus jawaban status_akun/status_situs yang SUDAH lolos statusServerSah
   * @param {string} x.betaGratisSampai  config situs
   * @param {string} [x.perangkat]  tanggal perangkat (untuk uji)
   * @returns {{pro:boolean, proSendiri:boolean, proAkun:boolean, betaSampai:string, hariIni:string,
   *            sumber:'contoh'|'akun'|'kode'|'beta'|null}}
   *   proSendiri = Pro yang benar-benar dimiliki (akun/kode), bukan karena masa beta.
   *   sumber mengikuti urutan label paket di dashboard: contoh → akun → kode → beta.
   */
  function status({ demo = false, licenseOk = false, profile = null, serverStatus = null, betaGratisSampai = '', perangkat } = {}) {
    const hari = hariIni(serverStatus, perangkat === undefined ? tanggalPerangkat() : perangkat);
    const beta = betaSampai({ serverStatus, betaGratisSampai, hari });
    const akun = proAkun(profile, hari);
    const sendiri = !!licenseOk || akun;
    const sumber = demo ? 'contoh' : akun ? 'akun' : licenseOk ? 'kode' : beta ? 'beta' : null;
    return { pro: !!demo || sendiri || !!beta, proSendiri: sendiri, proAkun: akun, betaSampai: beta, hariIni: hari, sumber };
  }

  /* ---------- batas paket gratis dan kunci tamu ---------- */

  /** Batas akun gratis (aturan lama): temuan di Ringkasan, produk di tabel Produk, riwayat tersimpan.
   *  Riwayat juga dibatasi database (status_akun.batas_riwayat). */
  const BATAS_GRATIS = Object.freeze({ temuan: 2, produk: 5, riwayat: 3 });
  const batas = (st) => (st.pro ? { temuan: Infinity, produk: Infinity, riwayat: Infinity } : { ...BATAS_GRATIS });

  /** Halaman yang perlu akun gratis bagi tamu (keputusan pemilik 4 Nov 2026). Mode contoh terbuka penuh; tanpa layanan
   *  akun (supabaseUrl kosong) tidak ada yang dikunci. */
  const KUNCI_TAMU = Object.freeze(['produk', 'biaya', 'retur', 'riwayat']);
  const perluAkun = ({ demo = false, cloudEnabled = false, login = false, halaman }) => !demo && !!cloudEnabled && !login && KUNCI_TAMU.includes(halaman);

  /** Fitur yang dikunci untuk paket gratis. Fitur baru didaftarkan di sini, tidak di pemanggil. */
  const FITUR = Object.freeze({ pdf: 'pro', excel: 'pro' });
  const boleh = (st, fitur) => {
    if (!(fitur in FITUR)) throw new Error(`Fitur tidak dikenal: ${fitur}`);
    return FITUR[fitur] === 'semua' || st.pro;
  };

  return { tanggalPerangkat, statusServerSah, hariIni, betaDariConfig, betaDariServer, betaSampai, proAkun, status,
    BATAS_GRATIS, batas, KUNCI_TAMU, perluAkun, FITUR, boleh };
})();
if (typeof module !== 'undefined') module.exports = CekAkses;
