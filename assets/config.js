/* ============================================================
 * PENGATURAN SITUS — ubah file ini langsung di GitHub (ikon pensil).
 * Setelah disimpan, situs ikut berubah dalam 1–3 menit.
 * ============================================================ */
window.CEK_CONFIG = {
  brand: 'Cek Untung',

  // Nomor WhatsApp kontak umum (opsional, format '628…'). TIDAK dipakai untuk checkout Pro.
  whatsapp: '',

  // Checkout Pro (transfer bank + QRIS, berbasis akun di akun.html?view=pro). Biarkan false sampai migrasi
  // supabase/usulan/pro-sekali-bayar.sql dijalankan, rekening/QRIS resmi + kontak bantuan diisi di tabel
  // pengaturan_pembayaran, kebijakan refund terbit, dan satu transaksi uji berhasil. Detail rekening TIDAK disimpan di sini.
  proPembayaranAktif: false,

  // Nomor WhatsApp BANTUAN (dukungan pengguna), format sama: '628…' tanpa "+" dan spasi.
  // TERPISAH dari `whatsapp` di atas: mengisi nomor ini TIDAK membuka alur pembayaran Pro.
  // Selama kosong, tautan "Bantuan WhatsApp" tidak tampil. Jangan isi nomor contoh/fiktif.
  waSupport: '',
  waSupportMessage: 'Halo Cek Untung, saya butuh bantuan menggunakan website',

  // Alamat resmi situs. Pengunjung alamat lama *.github.io dialihkan ke sini (alihkanAlamatLama), kecuali bila browser
  // lama masih menyimpan data Cek Untung atau URL membawa token login: mereka melihat pemberitahuan pindah alamat.
  // Disetujui pemilik 22 Okt 2026. Tidak berpengaruh di cekuntung.id, preview, atau localhost.
  domainResmi: 'https://cekuntung.id',
  alihkanAlamatLama: true,

  // Harga Cek Untung Pro (sekali bayar, bukan langganan). Keputusan pemilik 21 Okt 2026; harga reguler tidak ditampilkan
  // sebagai pembanding (keputusan pemilik 22 Okt 2026). `proRegular` sengaja tidak diisi: tampilan coret otomatis hilang.
  // Tidak ada countdown atau sisa kuota yang ditampilkan: kuota promosi belum bisa dicatat/ditegakkan di server.
  prices: {
    pro: 'Rp149.000',
    proLabel: 'Harga Peluncuran',
    proUnit: 'sekali bayar',
  },

  // Analytics ramah privasi (GoatCounter, gratis, tanpa cookie).
  // Daftar di https://www.goatcounter.com lalu isi kode situs, mis. 'cekprofit' → cekprofit.goatcounter.com
  // Kosong = analytics mati. Yang dicatat hanya kunjungan halaman dan klik tombol, BUKAN isi file/angka toko.
  goatcounter: '',

  // Kunci publik untuk memeriksa kode akses. Hanya bisa MEMERIKSA, tidak bisa membuat kode.
  // Jika Anda membuat pasangan kunci baru di alat pembuat kode, tempel kunci publiknya di sini.
  publicKey: 'BCqCk7193jIfz9woFYfWb4IvZMUUkPF9VeYARLW8gpaFPqyFvIAXWr9j3orDgpUf3K6PSyfRtDnbfan7rpjJl5Q',

  email: '',   // opsional, tampil di halaman privasi

  // ---------- Akun (Supabase) ----------
  // Ikuti supabase/PANDUAN.md. Selama kosong, situs berjalan tanpa login (semua tersimpan di browser).
  supabaseUrl: 'https://ikjcbgfexhpksbewkpym.supabase.co',
  supabaseAnonKey: 'sb_publishable_KC8qxwwQKwnYe2k-fjeEYw_HNxiscEt',    // "anon public" / "publishable" key — aman untuk publik, dilindungi aturan RLS
  googleLogin: false,     // true setelah login Google diaktifkan di Supabase (Authentication → Providers)

  // Pajak Seller (simulasi PPh marketplace & surat PMK 37/2025). Batch 4: BELUM untuk produksi (keputusan pemilik).
  // Hanya aktif di staging terverifikasi (lihat staging.pajakSeller) dan localhost.
  pajakSeller: false,

  // ---------- Lingkungan STAGING ----------
  // Panduan: docs/usulan/STAGING_SUPABASE.md. Isi dengan project Supabase STAGING terpisah: URL + publishable key
  // (sb_publishable_…). JANGAN isi secret/service_role. Host yang didaftarkan HANYA memakai staging.
  // proPembayaranAktif di sini hanya berlaku setelah host terbukti staging yang valid; produksi tetap memakai nilai di atas.
  staging: {
    supabaseUrl: 'https://epyhhazihfolbdtjxxfd.supabase.co',             // project cekuntung-staging
    supabaseAnonKey: 'sb_publishable_yJi7jb0iFM-5ElAbhB2Zxg_helb36Yg',      // publishable key STAGING (publik)
    hosts: ['feature-pro-pricing.cekuntung.pages.dev', 'feature-qris-midtrans.cekuntung.pages.dev'],
    proPembayaranAktif: true,
    pajakSeller: true,
  },
};
/*
 * Pemilihan database menurut alamat halaman (fail-closed). Hanya membaca nama host halaman; tidak membaca parameter URL,
 * penyimpanan browser, atau cookie, sehingga tidak bisa dialihkan dari browser.
 *  1. Host produksi (cekuntung.id, www, cekuntung.pages.dev, GitHub Pages lama) → SELALU Supabase produksi; `staging`
 *     diabaikan walau host itu ikut didaftarkan.
 *  2. Host staging terdaftar atau preview Cloudflare (*.cekuntung.pages.dev) → hanya Supabase STAGING yang valid
 *     (https://<ref>.supabase.co, bukan URL produksi, kunci publishable/anon, bukan kunci produksi). Bila kosong/salah,
 *     fitur akun dimatikan (supabaseUrl kosong) dan pesan "konfigurasi staging belum siap" tampil — TIDAK pernah jatuh ke produksi.
 *  3. Host lain (mis. localhost saat pengembangan) → perilaku lama (produksi).
 */
(function pilihLingkungan(C) {
  const PROD_URL = C.supabaseUrl, PROD_KEY = C.supabaseAnonKey;
  const HOST_PRODUKSI = ['cekuntung.id', 'www.cekuntung.id', 'cekuntung.pages.dev', 'muhammadramdhan2012.github.io'];
  const host = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
  const st = C.staging || {};
  const daftar = Array.isArray(st.hosts) ? st.hosts.map((h) => String(h).toLowerCase()) : [];
  const kunciPublik = (k) => {
    k = String(k || '');
    if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return true;
    if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k)) return false;   // kunci anon lama (JWT): wajib role "anon"
    try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch (e) { return false; }
  };
  C.lingkungan = 'produksi'; C.konfigurasiBelumSiap = '';
  if (HOST_PRODUKSI.includes(host)) return;
  const preview = /\.cekuntung\.pages\.dev$/.test(host);
  if (!preview && !daftar.includes(host)) return;
  const valid = daftar.includes(host) && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(st.supabaseUrl || '')
    && st.supabaseUrl !== PROD_URL && kunciPublik(st.supabaseAnonKey) && st.supabaseAnonKey !== PROD_KEY;
  if (valid) {
    C.supabaseUrl = st.supabaseUrl; C.supabaseAnonKey = st.supabaseAnonKey; C.lingkungan = 'staging';
    // Uji checkout di staging. Database staging tetap punya saklar sendiri (pengaturan_pembayaran.aktif, diatur admin staging).
    C.proPembayaranAktif = st.proPembayaranAktif === true;
    C.pajakSeller = st.pajakSeller === true;
    return;
  }
  C.supabaseUrl = ''; C.supabaseAnonKey = ''; C.proPembayaranAktif = false; C.lingkungan = 'staging-belum-siap';
  C.konfigurasiBelumSiap = 'Konfigurasi database staging belum siap. Fitur akun dan pembayaran dimatikan di alamat ini agar tidak tersambung ke database produksi.';
})(window.CEK_CONFIG);
