# Mengaktifkan akun (login/daftar) dengan Supabase

Waktu: sekitar 15 menit. Biaya: gratis untuk awal (paket Free Supabase).
Selama langkah ini belum dilakukan, situs tetap jalan tanpa login.

## 1. Buat project Supabase

1. Buka https://supabase.com, lalu klik **Start your project**. Masuk dengan akun GitHub Anda.
2. Klik **New project**, lalu isi:
   - **Name**: `cek-profit`
   - **Database Password**: klik *Generate*, lalu simpan di tempat aman (misalnya catatan di HP).
   - **Region**: **Southeast Asia (Singapore)**, karena paling dekat dengan Indonesia.
3. Klik **Create new project** dan tunggu sekitar 2 menit.

## 2. Buat tabel dan aturan keamanan

1. Di menu kiri, klik **SQL Editor**, lalu **New query**.
2. Buka file `supabase/schema.sql` di GitHub, klik **Raw**, salin semua isinya, lalu tempel ke editor.
3. Klik **Run**. Hasilnya harus *Success. No rows returned*.

Aturan keamanan di file ini sudah diuji dengan PostgreSQL 16:
- setiap pengguna hanya bisa membaca datanya sendiri;
- pengguna tidak bisa mengaktifkan Pro untuk dirinya sendiri;
- hanya admin yang bisa mengubah status Pro.

## 3. Atur alamat situs

**Authentication** → **URL Configuration**:
- **Site URL**: `https://muhammadramdhan2012.github.io/cek-profit/akun.html`
- **Redirect URLs**: klik *Add URL*, isi `https://muhammadramdhan2012.github.io/cek-profit/**`

Ini diperlukan agar tautan konfirmasi email dan reset sandi kembali ke situs Anda.

## 4. Sambungkan ke situs

1. **Project Settings** (ikon gerigi) → **Data API** atau **API Keys**.
2. Salin **Project URL** (contoh `https://abcdefgh.supabase.co`).
3. Salin **anon public** key (atau **Publishable key** yang diawali `sb_publishable_`).
   Key ini memang aman dipasang di situs publik, karena data tetap dilindungi aturan keamanan dari langkah 2.
   **Jangan** pernah memakai *service_role* atau *secret key*.
4. Di GitHub, buka `assets/config.js`, klik ikon pensil, lalu isi:
   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseAnonKey: 'eyJ...atau sb_publishable_...',
   ```
5. Klik **Commit changes** dan tunggu 1–3 menit.

## 5. Jadikan akun Anda admin

1. Buka situs, klik **Daftar gratis**, lalu daftar dengan email Anda dan konfirmasi lewat email.
2. Di Supabase: **Table Editor** → tabel **profiles** → baris dengan email Anda → kolom **is_admin** → ubah menjadi `true` → **Save**.
3. Buka `https://muhammadramdhan2012.github.io/cek-profit/admin.html`.

## Alur pembayaran manual

1. Pengguna klik **Berlangganan Pro** → pilih paket → **Lanjut ke pembayaran**.
   Permintaannya tercatat, dan WhatsApp Anda terbuka dengan pesan yang sudah berisi email akun dan paket.
2. Anda kirim nomor rekening atau QRIS, lalu pengguna membayar.
3. Buka **admin.html** → bagian **Permintaan upgrade** → klik **Aktifkan 1 bulan** atau **1 tahun**.
4. Pro aktif di akun pengguna begitu halamannya dimuat ulang.

Untuk memperpanjang, klik **+1 bln** atau **+1 thn** di daftar pengguna. Masa berlaku dihitung dari tanggal berakhir yang lama, jadi sisa hari tidak hilang.

## Opsional

- **Login dengan Google**:
  1. Authentication → Providers → Google, lalu ikuti petunjuk Supabase untuk membuat OAuth Client di Google Cloud.
  2. Setelah aktif, ubah `googleLogin: true` di `config.js`.
- **Email dari domain sendiri**: email bawaan Supabase dibatasi beberapa email per jam. Saat pengguna mulai banyak, atur SMTP sendiri di Authentication → Emails → SMTP Settings. Layanan gratis seperti Brevo atau Resend bisa dipakai.
- **Template email bahasa Indonesia**: Authentication → Emails → Templates. Ubah teks "Confirm your signup" dan "Reset password", dan pakai nama produk **Cek Untung** di judul dan isi email. Nama project Supabase (`cek-profit`) dan alamat situs tidak perlu diubah.

## Uji lokal (untuk pengembang)

```bash
node tests/mock-supabase.js 54321    # server tiruan Supabase
# lalu set supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' di config.js lokal
```
