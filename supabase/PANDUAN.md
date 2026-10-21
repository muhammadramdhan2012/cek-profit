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

**Authentication** → **URL Configuration**. Ini diperlukan agar tautan konfirmasi email dan reset sandi kembali ke
situs Anda. Bila alamat tujuan tidak ada di daftar, Supabase memakai *Site URL* sebagai gantinya.

**Redirect URLs** (klik *Add URL* untuk tiap baris). Website mengirim alamat halaman akun yang sedang dibuka. Di
Cloudflare Pages alamat itu tanpa `.html` (`/akun`), jadi kedua bentuk perlu didaftarkan:

| Alamat | Untuk |
|---|---|
| `https://muhammadramdhan2012.github.io/cek-profit/**` | alamat lama (GitHub Pages). **Jangan dihapus** selama masa pindah |
| `https://cekuntung.pages.dev/akun` dan `https://cekuntung.pages.dev/akun.html` | staging Cloudflare |
| `https://*.cekuntung.pages.dev/akun` | preview per branch Cloudflare (opsional; hanya bila menguji login di preview) |
| `https://cekuntung.id/akun` dan `https://cekuntung.id/akun.html` | domain resmi |

**Site URL**: tetap `https://muhammadramdhan2012.github.io/cek-profit/akun.html` sampai QA di `cekuntung.id` lulus,
lalu ganti ke `https://cekuntung.id/akun`. Mengganti Site URL memengaruhi semua email yang tidak membawa alamat sah,
jadi lakukan setelah pengujian.

## 3b. Aturan kata sandi (Auth V3)

Website (sejak Auth V3) meminta kata sandi **baru** minimal 8 karakter dengan huruf kapital, huruf kecil, dan angka;
simbol boleh. Aturan di browser hanya memberi petunjuk lebih awal. Agar tidak bisa dilewati, samakan di Supabase:

1. **Authentication** → **Sign In / Providers** → **Email** (di versi dashboard lama: **Authentication → Policies**
   atau **Settings**). Cari bagian **Password requirements**.
2. **Minimum password length**: `8`.
3. **Password requirements**: pilih **Lowercase, uppercase letters and digits**. Jangan pilih opsi yang mewajibkan
   simbol, karena website tidak mewajibkannya.
4. Simpan.

Aturan ini berlaku untuk pendaftaran dan ganti/reset sandi. Pengguna lama yang sandinya lebih lemah **tidak boleh
terblokir** saat masuk. Uji dengan satu akun penguji lama (lihat daftar QA) sebelum dianggap aman; perilaku ini
belum diuji di Supabase sungguhan.

## 3c. Email (Resend lewat SMTP)

**Authentication → Emails → SMTP Settings**: isi host, port, username, dan kata sandi SMTP dari Resend. Kata sandi
SMTP disimpan di Supabase saja, **jangan** di website, GitHub, atau chat. Di Resend, pastikan domain pengirim
berstatus *Verified* (SPF dan DKIM). Uji dengan mendaftar akun penguji dan meminta reset sandi; periksa folder spam.

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

- **Login dengan Google** (website memakai alur PKCE Supabase; Client Secret hanya diisi di dashboard Supabase,
  **jangan** di file website, GitHub, atau chat):
  1. Supabase → Authentication → Providers → **Google** → salin **Callback URL (for OAuth)** yang tertera di sana
     (bentuknya `https://<ref-project>.supabase.co/auth/v1/callback`).
  2. Google Cloud Console → pilih/buat project → **APIs & Services → OAuth consent screen**: tipe *External*, nama
     aplikasi *Cek Untung*, email dukungan, domain `muhammadramdhan2012.github.io`, tautan privasi
     `https://muhammadramdhan2012.github.io/cek-profit/privasi.html`. Lingkup cukup bawaan: `openid`, `email`,
     `profile` (jangan tambahkan Gmail/Drive). Status *Testing* hanya mengizinkan akun penguji; pilih *Publish* bila
     sudah siap untuk semua seller.
  3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
     *Authorized JavaScript origins*: `https://muhammadramdhan2012.github.io`.
     *Authorized redirect URIs*: tempel Callback URL dari langkah 1.
  4. Salin **Client ID** dan **Client Secret** → kembali ke Supabase → Providers → Google → aktifkan, tempel keduanya,
     simpan. Secret tersimpan di Supabase, tidak di website.
  5. Supabase → Authentication → **URL Configuration**: *Site URL* `https://muhammadramdhan2012.github.io/cek-profit/`;
     *Redirect URLs* tambahkan `https://muhammadramdhan2012.github.io/cek-profit/akun.html`.
  Untuk domain `cekuntung.id`: tambahkan juga *Authorized JavaScript origins* `https://cekuntung.id` (dan
  `https://cekuntung.pages.dev` untuk staging), domain `cekuntung.id` di consent screen, dan tautan privasi
  `https://cekuntung.id/privasi`. Login Google **tetap nonaktif** (`googleLogin: false`) sampai diuji dengan Supabase
  sungguhan, terutama akun lama berstatus Pro.
  6. Ubah `googleLogin: true` di `assets/config.js` (lewat commit yang disetujui), tunggu GitHub Pages, lalu uji:
     masuk dengan Google (akun baru), masuk dengan Google memakai email akun lama, batal di layar Google, keluar,
     dan muat ulang halaman. Pastikan status Pro dan riwayat akun lama tetap ada.
- **Template email bahasa Indonesia**: Authentication → Emails → Templates. Ubah teks "Confirm your signup" dan "Reset password", dan pakai nama produk **Cek Untung** di judul dan isi email. Nama project Supabase (`cek-profit`) dan alamat situs tidak perlu diubah.

## Nomor HP/WhatsApp dan bantuan

- Nomor HP/WhatsApp pengguna disimpan di kolom `profiles.whatsapp` yang sudah ada (tidak perlu migrasi). Saat
  daftar, nomor **opsional**; bila diisi, website menormalkan ke `+62…`, menyimpannya sementara sebagai data
  pendaftaran, lalu memindahkannya ke profil setelah pengguna pertama kali masuk. Nomor **tidak diverifikasi** dan
  tidak dipakai untuk OTP.
- Tombol **Bantuan WhatsApp** memakai `waSupport` di `assets/config.js`, terpisah dari `whatsapp` (pembayaran Pro).
  Isi hanya dengan nomor resmi, format `628…` tanpa `+` dan spasi. Selama kosong, tombol tidak tampil.
- `domainResmi` di `assets/config.js`: isi `https://cekuntung.id` saat domain siap. Pengunjung alamat lama
  (`*.github.io`) lalu melihat pemberitahuan pindah alamat; tidak ada pengalihan otomatis.

## Uji lokal (untuk pengembang)

```bash
node tests/mock-supabase.js 54321    # server tiruan Supabase
# lalu set supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' di config.js lokal
```
