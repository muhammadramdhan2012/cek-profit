/* ============================================================
 * PENGATURAN SITUS — ubah file ini langsung di GitHub (ikon pensil).
 * Setelah disimpan, situs ikut berubah dalam 1–3 menit.
 * ============================================================ */
window.CEK_CONFIG = {
  brand: 'Cek Untung',

  // Nomor WhatsApp untuk membeli kode akses, format internasional TANPA "+" dan spasi.
  // Contoh: '6281234567890'. Selama kosong, tombol beli menampilkan pesan "nomor belum diatur".
  whatsapp: '',
  waMessage: 'Halo, saya ingin berlangganan Cek Untung Pro.',
  waMessageJasa: 'Halo, saya ingin memakai jasa laporan profit toko dari Cek Untung.',

  // Harga yang tampil di halaman depan (teks bebas). GANTI sebelum dipromosikan.
  prices: {
    pro: 'Rp49.000',
    proUnit: '/ bulan',
    proNote: 'atau Rp399.000 / tahun',
    jasa: 'Rp199.000',
    jasaUnit: '/ toko / bulan',
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
