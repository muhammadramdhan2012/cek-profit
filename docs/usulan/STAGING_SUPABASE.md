# Panduan — Supabase STAGING untuk menguji Manual Payment V1

Status: **PANDUAN; belum dijalankan.** Semua langkah di Supabase dan Cloudflare dilakukan pemilik. Claude tidak membuat
project, tidak memakai kredensial produksi, dan tidak menjalankan SQL di produksi.

## 1. Kenapa staging perlu, dan bagaimana website memisahkannya

File tes SQL dan uji pembayaran membuat akun sintetis serta catatan dana. Keduanya **tidak boleh** menyentuh database
pengguna sungguhan. Karena website statis (tanpa build step), pilihan database ditentukan `assets/config.js` dari
**nama host halaman saja**:

| Host | Database yang dipakai |
|---|---|
| `cekuntung.id`, `www.cekuntung.id`, `cekuntung.pages.dev`, `muhammadramdhan2012.github.io` | **Selalu produksi.** Blok `staging` diabaikan, walau host ini ikut didaftarkan |
| `*.cekuntung.pages.dev` (preview Cloudflare) atau host di `staging.hosts` | **Hanya staging yang valid.** Bila kosong atau salah, fitur akun dan pembayaran **dimatikan** (fail-closed), tidak pernah jatuh ke produksi |
| Host lain (mis. `localhost` saat pengembangan) | Perilaku lama: produksi, kecuali sengaja didaftarkan di `staging.hosts` |

Konfigurasi staging dianggap **valid** hanya bila semua terpenuhi:
- host halaman tercantum di `staging.hosts`;
- `supabaseUrl` berbentuk `https://<ref 20 karakter>.supabase.co` dan **bukan** URL produksi;
- `supabaseAnonKey` berupa publishable key (`sb_publishable_…`) atau anon key lama (JWT ber-role `anon`), **bukan**
  secret/service_role, dan **bukan** kunci produksi.

Yang **tidak** bisa mengalihkan database: parameter URL (`?supabaseUrl=…`), `localStorage`, cookie. `config.js` tidak
membacanya sama sekali (ada tesnya).

**Pita penanda di bagian atas halaman:**
- **"STAGING: database uji…"** (oranye) hanya tampil setelah database **menjawab** fungsi `info_lingkungan()` dengan
  `lingkungan = staging` dan `ref` yang **sama** dengan URL yang dipakai. Fungsi ini hanya dibuat di project staging.
- **"PERINGATAN: database … belum terverifikasi"** (merah): konfigurasi valid, tetapi database tidak menjawab dengan benar.
  Jangan lanjut menguji; cek langkah 5.
- **"Konfigurasi database staging belum siap…"** (merah): alamat preview, tetapi konfigurasi staging kosong/salah.
  Halaman akun dan admin menampilkan pesan yang sama; dashboard tetap bisa dipakai tanpa login.

Catatan: `supabase/PANDUAN.md` menyebut `cekuntung.pages.dev` sebagai "staging Cloudflare". Secara teknis alamat itu
adalah alamat bawaan **branch `main` (produksi)**, jadi website memperlakukannya sebagai produksi. Uji staging memakai
alamat **preview per branch**, bukan `cekuntung.pages.dev`.

## 2. Biaya dan batasan

- **Paket Free Supabase** cukup untuk staging. Cek batas jumlah project gratis terbaru di halaman harga Supabase.
- **Project gratis yang lama tidak dipakai bisa dijeda.** Buka dasbornya sebelum menguji.
- **Email:** staging memakai SMTP bawaan Supabase (jumlah email per jam terbatas, bisa masuk spam). Jangan pakai SMTP
  Resend produksi. Alternatif khusus staging: matikan "Confirm email".

## 3. Membuat project staging dari nol (tanpa data produksi)

1. **Buat project.** supabase.com → **New project**.
   - **Name:** `cekuntung-staging`. **Region:** Singapore.
   - **Database password:** buat baru (jangan sama dengan produksi), simpan di pengelola sandi Anda.
   - Tunggu sampai status project **Healthy**.
2. **Catat ref dan publishable key staging.** **Project Settings → API**:
   - **Project URL**: `https://<ref-staging>.supabase.co`. `<ref-staging>` = 20 huruf/angka. Pastikan **berbeda** dari
     `ikjcbgfexhpksbewkpym` (produksi).
   - **Publishable key** (`sb_publishable_…`). **Jangan** salin secret key / service_role.
3. **Skema dasar.** **SQL Editor → New query** → tempel seluruh isi `supabase/schema.sql` → **Run**.
4. **Migrasi Manual Payment V1.** Query baru → tempel isi `supabase/usulan/pro-sekali-bayar.sql` → **Run**. Lalu **Run
   sekali lagi** untuk membuktikan aman dijalankan ulang (hasil kedua tidak boleh error).
5. **Penanda staging.** Query baru → tempel isi `supabase/staging/penanda-staging.sql`.
   - Ganti `GANTI_DENGAN_REF_STAGING` dengan `<ref-staging>` dari langkah 2 → **Run**.
   - File ini menolak placeholder dan menolak ref produksi. **Jangan pernah** jalankan di project produksi.
   - Cek: `select public.info_lingkungan();` → `{"ref": "<ref-staging>", "lingkungan": "staging"}`.
6. **Pemeriksaan keamanan cepat** (query baru, hanya membaca katalog):
   ```sql
   select proname, prosecdef, proconfig from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef order by 1;          -- semua: search_path=public, pg_temp
                                                                                   -- (kecuali is_admin, handle_new_user dari schema.sql)
   select relname, relrowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;      -- semua rls = true
   select has_table_privilege('authenticated', 'public.pro_payments', 'delete');  -- false
   ```
7. **Auth.** **Authentication → Sign In / Providers → Email**: biarkan aktif. Google tetap **nonaktif**.
8. **URL Configuration** (**Authentication → URL Configuration**) di project **staging**:
   - **Site URL:** `https://feature-pro-pricing.cekuntung.pages.dev/akun`
   - **Redirect URLs:** `https://feature-pro-pricing.cekuntung.pages.dev/akun` dan
     `https://feature-pro-pricing.cekuntung.pages.dev/akun.html`
   - URL Configuration produksi **tidak perlu diubah**.
9. **Tidak ada data produksi yang disalin.** Jangan memakai fitur backup/restore/clone dari project produksi. Semua akun di
   staging adalah akun uji baru.

## 4. Menghubungkan preview Cloudflare ke staging

Website statis tidak memakai environment variable Cloudflare; konfigurasinya ada di `assets/config.js` yang ikut
di-commit. Karena itu staging dihubungkan **lewat commit di branch preview**, bukan lewat dasbor Cloudflare.

1. **Alamat preview yang dipakai:** alias branch `https://feature-pro-pricing.cekuntung.pages.dev` (dibuat otomatis
   Cloudflare Pages untuk branch `feature/pro-pricing`). Alamat preview per commit (`https://<hash>.cekuntung.pages.dev`)
   **tidak** didaftarkan, sehingga di sana fitur akun mati (aman).
2. **Kirim ke Claude** (boleh di chat; keduanya memang publik): Project URL staging dan publishable key staging.
   **Jangan kirim** secret key, service_role, atau password database.
3. Claude mengisi (setelah Anda menyetujui commit dan push ke branch `feature/pro-pricing` saja):
   ```js
   staging: {
     supabaseUrl: 'https://<ref-staging>.supabase.co',
     supabaseAnonKey: 'sb_publishable_…',              // publishable key STAGING
     hosts: ['feature-pro-pricing.cekuntung.pages.dev'],
   },
   ```
4. **Tunggu deploy preview** (Cloudflare → Workers & Pages → `cekuntung` → **Deployments**, cari branch
   `feature/pro-pricing`, status **Success**). Buka `https://feature-pro-pricing.cekuntung.pages.dev/akun`, tekan
   Cmd+Shift+R.
5. **Pastikan pita oranye "STAGING: database uji"** tampil. Bila merah, **berhenti**: periksa langkah 3.2 dan 3.5.

**Dampak ke produksi:** tidak ada.
- Produksi (`cekuntung.id`, `www`, `cekuntung.pages.dev`, GitHub Pages) **mengabaikan** blok `staging`, walau nanti blok
  itu ikut ter-merge ke `main` (ada tesnya). Publishable key staging memang publik; tidak membuka akses ke produksi.
- Bila ingin bersih, sebelum merge ke `main` blok `staging` bisa dikosongkan lagi. Keduanya aman; keputusan Anda.
- Tidak ada perubahan Cloudflare (DNS, domain, environment variable) yang diperlukan.

## 5. Admin staging

1. Daftar akun admin uji di `https://feature-pro-pricing.cekuntung.pages.dev/akun` (email berbeda dari admin produksi).
2. Supabase **staging** → **Table Editor → profiles** → baris akun itu → `is_admin = true` → **Save**.
3. Buka `/admin` di preview. Admin staging terpisah total dari admin produksi.

## 6. Daftar tes nyata di staging sebelum migrasi produksi

Pengaturan pembayaran diisi lewat `/admin` di preview dengan data **uji** yang jelas bukan rekening orang lain
(mis. `BANK UJI`, `0000000000`, `PEMILIK UJI`, QRIS gambar uji). Rekening/QRIS asli hanya dengan persetujuan Anda.

| # | Skenario | Hasil yang diharapkan |
|---|---|---|
| S0 | Buka `/akun`, `/admin`, `/dashboard`, `/` di preview | Pita oranye STAGING di semua halaman |
| S1 | DevTools → Network saat login | Semua permintaan ke `<ref-staging>.supabase.co`, **tidak ada** ke `ikjcbgfexhpksbewkpym` |
| S2 | Daftar (dengan nomor HP) → konfirmasi email → masuk; lupa sandi | Berhasil; tautan email kembali ke alamat preview |
| S3 | Pengaturan pembayaran: coba aktifkan tanpa kontak bantuan | Ditolak dengan pesan jelas |
| S4 | Isi data uji + kontak bantuan → aktifkan | Pembelian terbuka di staging saja |
| S5 | Seller A: Beli Pro → transfer → buat pesanan; ulangi | Kode `CU-…`, Rp149.000, batas 48 jam; pesanan kedua = pesanan yang sama |
| S6 | Seller A: "Saya sudah membayar" | **Menunggu verifikasi**; Pro **tidak** aktif |
| S7 | Admin: verifikasi (referensi `UJI-001`) | Pro aktif; keluar–masuk lagi tetap Pro |
| S8 | Admin: verifikasi ulang referensi sama / referensi `uji 001` di pesanan lain | "Sudah aktif"/ditolak duplikat; tidak ada entri ganda |
| S9 | QRIS: seller B & C membuat pesanan; admin "Catat dana masuk tanpa pesanan" | Dana tercatat belum teridentifikasi; tidak ada Pro aktif |
| S10 | Admin: hubungkan dana ke pesanan B dengan alasan | Pro aktif hanya untuk B; histori & audit tercatat |
| S11 | Klaim bayar setelah 48 jam (ubah `expired_at` pesanan uji di Table Editor staging) | **Perlu pemeriksaan**; teks "dana tidak hangus" |
| S12 | Refund penuh dari baris pembayaran asal | Pro dicabut; histori tetap; sisa dana tidak bisa direfund lagi |
| S13 | Refund kelebihan bayar (pembayaran tambahan) | Pro tetap aktif |
| S14 | Koreksi referensi dengan alasan | Tercatat di audit (nilai lama & baru) |
| S15 | Admin "Atur Pro lama" (`admin_set_pro`) pada akun uji | Pro lama aktif; pesanan sekali bayar **tidak** ikut "Aktif"; tercatat `set_pro_lama` di audit |
| S16 | Seller B membuka pesanan/pembayaran seller A (ubah id di DevTools) | Tidak terlihat |
| S17 | Seller biasa memanggil fungsi admin dari console | "Hanya admin" |
| S18 | Akun gratis menyimpan riwayat ke-4 (bila trigger opsional dipasang) | Ditolak; akun Pro tanpa batas |
| S19 | Hapus akun uji (Authentication → Users) | Baris `pro_payments` tetap ada dengan `user_id` kosong |
| S20 | Matikan internet setelah halaman terbuka | Dashboard tetap memproses file; akun gagal dengan sopan |
| S21 | Buka `https://<hash-commit>.cekuntung.pages.dev/akun` | Pita merah "belum siap"; tidak ada permintaan ke Supabase mana pun |
| S22 | Buka `https://cekuntung.id/akun?supabaseUrl=…` (tanpa login, tanpa transaksi) | Tidak ada pita; tetap produksi |
| S23 | 375px, tema terang & gelap di checkout dan admin | Rapi, tanpa scroll horizontal |

**Jangan** menjalankan S2–S21 di produksi. S22 hanya membuka halaman, tanpa login atau transaksi.

## 7. Rollback staging

Paling mudah: hapus project staging (**Project Settings → General → Delete project**) dan buat ulang dari langkah 3.
Alternatifnya, jalankan bagian rollback di `docs/usulan/PRO_SEKALI_BAYAR.md` §7 **di project staging saja**.

## 8. Yang dibutuhkan dari pemilik

- Membuat project staging (langkah 3) lalu memberikan **Project URL** dan **publishable key** staging.
- Izin commit dan push **hanya** ke branch `feature/pro-pricing` untuk mengisi blok `staging`.
- Data rekening/QRIS uji (opsional). Rekening/QRIS asli hanya dengan persetujuan terpisah.
