# Panduan — Supabase STAGING untuk menguji Manual Payment V1

Status: **PANDUAN; belum dijalankan.** Semua langkah dilakukan pemilik di dasbor Supabase. Claude tidak membuat project
dan tidak memakai kredensial produksi.

## Kenapa staging perlu

- Saat ini **preview Cloudflare (`*.cekuntung.pages.dev`) memakai Supabase PRODUKSI**, karena `assets/config.js` sama untuk
  semua alamat. Jadi tes pesanan atau pembayaran di preview akan menulis ke database pengguna sungguhan.
- File tes SQL membuat akun sintetis di `auth.users`, sehingga **tidak boleh dijalankan di produksi**.

## Biaya dan batasan

- **Paket Free Supabase** cukup untuk staging. Saat dokumen ini ditulis, satu organisasi bisa punya beberapa project
  gratis. Cek batas terbaru di halaman harga Supabase.
- **Project gratis yang tidak dipakai bisa dijeda** setelah beberapa hari. Buka dasbornya sebelum pengujian.
- **Email:** staging memakai SMTP bawaan Supabase. Jumlah email per jam terbatas dan email bisa masuk spam.
  - Jangan pakai SMTP Resend produksi, kecuali Anda memang ingin.
  - Alternatif: matikan "Confirm email" di staging. Ini hanya untuk staging.

## Langkah

1. **Buat project baru.** supabase.com → **New project**.
   - **Name:** `cekuntung-staging`.
   - **Region:** Singapore.
   - **Password:** buat password baru (jangan sama dengan produksi), lalu simpan.
2. **Skema dasar.** SQL Editor → tempel isi `supabase/schema.sql` → **Run**.
3. **Migrasi Manual Payment V1.** SQL Editor → tempel isi `supabase/usulan/pro-sekali-bayar.sql` → **Run**.
   Jalankan sekali lagi untuk membuktikan file ini aman dijalankan ulang.
4. **Tes database di staging.** Tes lokal memakai shim `auth.uid()`; di Supabase sungguhan tes ini perlu disesuaikan.
   Cara paling sederhana adalah pengujian lewat website preview (langkah 8) dengan akun sintetis. Bila ingin
   menjalankan file tes SQL, gunakan **project staging saja**.
5. **URL Configuration** (Authentication → URL Configuration) di staging:
   - **Site URL:** `https://feature-pro-pricing.cekuntung.pages.dev/akun`
   - **Redirect URLs:** `https://feature-pro-pricing.cekuntung.pages.dev/akun` dan `https://feature-pro-pricing.cekuntung.pages.dev/akun.html`
6. **Admin staging.** Daftar akun admin uji di preview, lalu di staging: Table Editor → `profiles` → `is_admin = true`.
   - Admin staging **terpisah** dari admin produksi, karena project dan database-nya berbeda.
   - Pakai email yang berbeda dari akun admin produksi agar tidak tertukar.
7. **Hubungkan preview ke staging** (perlu commit dan push yang Anda setujui). Di `assets/config.js`, isi:
   ```js
   staging: {
     supabaseUrl: 'https://<ref-staging>.supabase.co',
     supabaseAnonKey: 'sb_publishable_…',   // publishable/anon key STAGING, bukan secret
     hosts: ['feature-pro-pricing.cekuntung.pages.dev'],
   },
   ```
   - **Hanya host yang terdaftar** memakai staging. `cekuntung.id` tidak pernah dialihkan; ini ada tesnya.
   - Halaman di host staging menampilkan pita **"STAGING: database uji"**.
   - Sebelum `main` dirilis, kosongkan `hosts` atau biarkan. Host produksi tetap aman karena tidak terdaftar.
8. **Pengaturan pembayaran uji.** Di admin.html (preview), isi pengaturan pembayaran.
   - Pakai rekening dan QRIS **milik Anda sendiri** untuk uji dana kecil, atau data uji yang jelas bukan rekening
     orang lain.
   - **Tidak ada data pelanggan asli** yang disalin ke staging.
9. **Smoke test** dengan akun sintetis:

   | # | Skenario | Hasil yang diharapkan |
   |---|---|---|
   | 1 | Daftar → konfirmasi email → masuk | Berhasil masuk (Auth V3) |
   | 2 | Beli Pro: pilih transfer → buat pesanan | Kode `CU-…`, Rp149.000, batas 48 jam |
   | 3 | Tekan "Saya sudah membayar" | Status **Menunggu verifikasi**, Pro **tidak** aktif |
   | 4 | Admin → Verifikasi dana (referensi uji) | Pro aktif; login ulang → tetap Pro |
   | 5 | Ulangi verifikasi dengan referensi sama | "Sudah aktif sebelumnya", tidak ada entri ganda |
   | 6 | QRIS: dua akun membuat pesanan; admin catat "dana masuk tanpa pesanan" | Dana tercatat, Pro belum aktif |
   | 7 | Hubungkan dana ke pesanan dengan bukti | Pro aktif untuk akun yang benar |
   | 8 | Refund penuh | Pro dicabut, histori tetap ada |
   | 9 | Seller lain mencoba membuka pesanan akun pertama | Tidak terlihat |

10. **Rollback staging.** Paling mudah: hapus project staging dan buat ulang. Alternatifnya, jalankan bagian
    rollback di `docs/usulan/PRO_SEKALI_BAYAR.md` §7.

## Yang dibutuhkan dari pemilik

- Membuat project staging dan memberikan **URL serta publishable key staging**. Key ini memang publik; jangan kirim
  secret atau service_role.
- Izin commit dan push untuk mengisi `staging` di `config.js`.
- Rekening/QRIS uji untuk transaksi kecil (opsional, bila ingin uji dana sungguhan di staging).
