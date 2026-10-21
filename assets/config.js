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

  // Alamat resmi situs. Bila diisi (mis. 'https://cekuntung.id'), pengunjung alamat lama *.github.io melihat
  // pemberitahuan pindah alamat. Kosong = tidak ada pemberitahuan. Tidak ada pengalihan otomatis.
  domainResmi: '',

  // Harga Cek Untung Pro (sekali bayar, bukan langganan). Keputusan pemilik 21 Okt 2026.
  // `proRegular` = harga reguler YANG DIRENCANAKAN, tampil dicoret sebagai pembanding dengan keterangan itu.
  // Tidak ada countdown atau sisa kuota yang ditampilkan: kuota promosi belum bisa dicatat/ditegakkan di server.
  prices: {
    pro: 'Rp149.000',
    proRegular: 'Rp299.000',
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
};
