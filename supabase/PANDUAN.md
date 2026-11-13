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

### 2b. Tahap 2: status Pro, masa beta, dan batas riwayat di server (November 2026)

File `schema.sql` aman dijalankan ulang. Bagian akhirnya ("TAHAP 2") menambah:
- tabel **site_settings**: tanggal akhir masa beta (awal: 13 Des 2026) dan tanggal pembelian Pro dibuka;
- kolom **profiles.pengguna_awal**: akun yang dibuat sampai akhir masa beta. Akun lama yang dibuat paling lambat
  13 Des 2026 otomatis ditandai;
- tabel **pro_purchases**: catatan pembelian Pro (harga, mulai, sampai, catatan), hanya bisa diisi admin;
- fungsi **status_situs** dan **status_akun**: tanggal hari ini menurut server (zona Jakarta), masa beta, status Pro;
- batas **3 riwayat** untuk akun gratis, ditegakkan database. Selama masa beta tidak dibatasi. Riwayat yang sudah
  tersimpan tidak pernah dihapus.

Cara menjalankan:
1. **SQL Editor** → **New query**.
2. Salin seluruh isi `supabase/schema.sql` yang terbaru, tempel, lalu klik **Run**. Hasilnya harus *Success*.
   Muncul peringatan "destructive operation"? Itu karena ada perintah `drop policy/trigger if exists` yang lalu dibuat
   ulang; klik **Run this query**.
3. Cek: **Table Editor** → tabel **site_settings** berisi 1 baris dengan `beta_gratis_sampai` = 2026-12-13.
   Tabel **profiles** punya kolom `pengguna_awal` = `true` untuk akun yang sudah ada.
4. Buka **admin.html**. Harus ada bagian **Masa beta & pembelian** dengan tanggal server hari ini.

Jalankan SQL ini **sebelum** versi website tahap 2 dipasang. Bila urutannya terbalik pun website tetap aman: selama
fungsi tahap 2 belum ada, dashboard memakai tanggal perangkat dan `betaGratisSampai` di `config.js` seperti sebelumnya.

Yang tetap dikunci di browser (keputusan pemilik 1 Nov 2026): fitur yang dihitung dari file laporan (PDF, Excel,
analisis semua produk), karena file tidak pernah dikirim ke server.

### 2c. Masukan pengguna (4 Nov 2026)

Bagian "MASUKAN PENGGUNA" di akhir `schema.sql` menambah tabel **feedback** untuk tombol **Kirim masukan** di dashboard:
- hanya akun yang sudah masuk yang bisa mengirim; tamu diarahkan ke WhatsApp bantuan;
- pengguna hanya bisa **mengirim** (tidak bisa membaca masukan siapa pun, termasuk miliknya); admin membaca dan
  mengubah status (baru / dibaca / selesai) di **admin.html** → panel **Masukan pengguna**;
- isi: jenis, pesan (5–2.000 huruf), nama halaman, dan pilihan boleh dihubungi. Angka laporan tidak ikut dikirim;
- batas **5 masukan per akun per 24 jam**, ditegakkan database.

Cara menjalankan sama dengan 2b (salin seluruh `schema.sql` terbaru → **Run**). Dijalankan pemilik 4 Nov 2026.
Bila belum dijalankan, form menampilkan "belum aktif" dan tombol WhatsApp; fitur lain tidak terpengaruh.

### 2d. Price list di akun (Langkah 2a, November 2026)

Kolom `user_data.price_list` menyimpan price list seller (kode, nama, variasi, harga), terpisah dari `settings` agar
price list besar tidak ikut dikirim setiap kali modal disimpan. Batas < 3 MB per akun. Ikut RLS baris yang sudah ada
(hanya pemilik akun). File mentah tidak disimpan.

Jalankan `supabase/migrasi/2026-11-13-price-list.sql` (SQL Editor → New query → tempel → **Run**; hasil: satu baris
`price_list | jsonb`). Isi yang sama ada di `schema.sql`. Dijalankan pemilik 13 Nov 2026. Membatalkan:
`supabase/migrasi/2026-11-13-price-list-batal.sql` (price list di akun ikut terhapus; modal dan pengaturan tidak).
Bila kolom belum ada, price list tetap dipakai di perangkat dengan status "Belum tersimpan di akun (database belum
diperbarui)".

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

**Template email** (Authentication → Emails → Templates) disimpan di `supabase/email/`. Logo digambar dengan tabel
HTML (tanpa gambar), jadi tidak ikut diblokir aplikasi email. Cara memakai: buka file → salin semua → tempel di kolom
*Message body* template yang sesuai → **Save**. Variabel `{{ .ConfirmationURL }}` dan lainnya jangan diubah.

| File | Template Supabase | Status (4 Nov 2026) |
|---|---|---|
| `konfirmasi-pendaftaran.html` | Confirm sign up | terpasang |
| `atur-ulang-kata-sandi.html` | Reset password | terpasang |
| `ganti-email.html` | Change email address | terpasang |
| `undangan.html` | Invite user | disiapkan, belum dipakai |
| `tautan-masuk.html` | Magic link | disiapkan, belum dipakai |
| `verifikasi-ulang.html` | Reauthentication | disiapkan, belum dipakai |

Subjek email diisi langsung di Supabase (kolom *Subject*), tidak disimpan di file ini.

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

Tetap berlaku sebagai cadangan bila pembayaran online bermasalah.

1. Pengguna klik **Berlangganan Pro** → pilih paket → **Lanjut ke pembayaran**.
   Permintaannya tercatat, dan WhatsApp Anda terbuka dengan pesan yang sudah berisi email akun dan paket.
2. Anda kirim nomor rekening atau QRIS, lalu pengguna membayar.
3. Buka **admin.html** → cari pengguna → klik **Catat pembelian**.
   - Harga terisi otomatis: Rp149.000, atau Rp99.000 bila akun pengguna awal yang masih berhak (tahun pertama saja,
     dibeli paling lambat 30 hari sejak tanggal pembelian dibuka). Database menolak harga khusus yang tidak berhak.
   - Isi catatan (mis. "transfer BCA 3 Jan"), lalu **Simpan & aktifkan 1 tahun**.
4. Pro aktif 1 tahun di akun pengguna begitu halamannya dimuat ulang. Bila Pro masih aktif (perpanjangan), tahun baru
   dimulai sehari setelah masa lama berakhir, jadi sisa hari tidak hilang.

Saat pembelian dibuka: isi **Pembelian Pro dibuka pada** di admin.html → **Simpan**. Batas klaim harga pengguna awal
(30 hari) dihitung dari tanggal ini. Memperpanjang atau mengakhiri masa beta juga lewat bagian yang sama.

Tombol **+1 bln**, **+1 thn**, dan **Matikan** hanya untuk koreksi manual; tidak tercatat sebagai pembelian.

Kode akses (CP1…): sejak 1 Nov 2026 tidak diterbitkan lagi (keputusan pemilik); Pro hanya lewat akun. Kode yang
sudah pernah diberikan tetap berlaku sampai tanggalnya.

## Pembayaran online Pro lewat Duitku (Sandbox, 5 Nov 2026)

Pro dibayar di halaman Duitku dan aktif otomatis setelah notifikasi Duitku lolos pemeriksaan tanda tangan dan nominal
di database. Tahap ini **Sandbox** (uang tiruan) dan hanya untuk akun penguji. Kunci Duitku **hanya** Anda isi di
Supabase; jangan dikirim ke chat, ditulis di repository, atau ditempel di `config.js`.

**A. Ambil kunci Sandbox dari Duitku**
1. Masuk ke dashboard Duitku **Sandbox** → menu **Project** → pilih/buat project "Cek Untung".
2. Catat **Merchant Code** (mis. `DSxxxxx`) dan **API Key**. Simpan di tempat aman (mis. password manager).

**B. Jalankan SQL**
1. Supabase → **SQL Editor** → **New query** → tempel seluruh `supabase/schema.sql` → **Run**.
   Aman dijalankan ulang. Bagian baru: *PEMBAYARAN ONLINE PRO LEWAT DUITKU* (tabel `pro_orders`, fungsi `duitku_terima`, dll.).

**C. Simpan kunci di Vault (untuk pemeriksaan notifikasi di database)**
1. Supabase → **Project Settings** → **Vault** (atau **Integrations → Vault**). Bila diminta, aktifkan Vault.
2. **Add new secret** dua kali:
   - Name `duitku_merchant_code_sandbox`, Secret = Merchant Code Sandbox.
   - Name `duitku_api_key_sandbox`, Secret = API Key Sandbox.
   Nama harus persis (huruf kecil, garis bawah).

**D. Buat dua Edge Function**
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nama `duitku-buat` → hapus isi contoh → tempel seluruh `supabase/functions/duitku-buat/index.ts` → **Deploy**.
   Biarkan **Enforce JWT verification** (Verify JWT) **menyala**.
3. Ulangi untuk nama `duitku-callback` dengan isi `supabase/functions/duitku-callback/index.ts`.
   Setelah deploy: buka fungsi itu → **Details/Settings** → **matikan Enforce JWT verification** → **Save**
   (Duitku tidak membawa token login Supabase).
4. **Edge Functions** → **Secrets** (atau **Manage secrets**) → tambahkan:
   - `DUITKU_MERCHANT_CODE_SANDBOX` = Merchant Code Sandbox
   - `DUITKU_API_KEY_SANDBOX` = API Key Sandbox
   `SUPABASE_URL` dan `SUPABASE_ANON_KEY` sudah tersedia otomatis. **Jangan** menambahkan atau memakai `service_role`.

**E. Isi URL di dashboard Duitku Sandbox (project Cek Untung)**
- **Callback URL:** `https://<project-ref>.supabase.co/functions/v1/duitku-callback`
  (`<project-ref>` = bagian depan `supabaseUrl` di `assets/config.js`).
- Return URL tidak perlu diisi di dashboard; website mengirimnya sendiri (`https://cekuntung.id/dashboard.html?bayar=…`).

**F. Buka Sandbox untuk penguji**
1. Daftar akun penguji di cekuntung.id: `cekuntung9+duitku@gmail.com` (email masuk ke kotak masuk cekuntung9@gmail.com).
2. admin.html → baris akun itu → **Jadikan penguji**.
3. admin.html → **Pembayaran online (Duitku)** → **Buka Sandbox (penguji saja)**.
   Pengguna lain tidak melihat tombol beli dan database menolak pesanan mereka.

**G. Uji (centang semua)**
- [ ] Masuk sebagai penguji → klik kartu **BETA**/**Pro** di dashboard → **Bayar** → halaman Duitku Sandbox terbuka.
- [ ] Bayar dengan metode tes Sandbox (mis. virtual account lewat halaman demo Duitku, atau QRIS tes) → kembali ke
      dashboard → "Pembayaran sedang diproses" → dalam 1 menit "Pro aktif" dengan tanggal 1 tahun lagi.
- [ ] Batalkan/biarkan kedaluwarsa satu pembayaran → Pro tidak berubah; pesanan tercatat gagal/kedaluwarsa di admin.
- [ ] admin.html menampilkan pesanan, referensi Duitku, dan "Notifikasi terakhir".
- [ ] Akun lain (bukan penguji) tidak melihat tombol beli.
Bila Pro tidak aktif: lihat kolom **Notifikasi terakhir** di admin ("tanda tangan tidak sah" = kunci di Vault salah;
"kunci Duitku belum dipasang di Vault" = langkah C belum), dan **Edge Functions → duitku-callback → Logs**.
Bila tombol **Bayar** menjawab "Pembayaran belum disiapkan": cek Secrets langkah D.4. Bila proyek Anda tidak lagi
menyediakan `SUPABASE_ANON_KEY` otomatis, tambahkan secret `CEK_ANON_KEY` berisi nilai `supabaseAnonKey` dari
`assets/config.js` (kunci publik, bukan `service_role`).

**Menutup lagi:** admin.html → **Tutup pembayaran**. Production (uang sungguhan) butuh kunci Production
(`*_production`) dan persetujuan terpisah; belum ada tombolnya.

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

- Nomor HP/WhatsApp pengguna disimpan di kolom `profiles.whatsapp` yang sudah ada (tidak perlu migrasi).
  - Daftar dengan email + kata sandi: nomor **wajib**. Website menormalkan ke `+62…`, menyimpannya sementara sebagai
    data pendaftaran, lalu memindahkannya ke profil setelah pengguna pertama kali masuk.
  - Bila pemindahan gagal, pengguna tetap di halaman Akun dengan pesan "belum tersimpan" dan nomornya terisi untuk
    disimpan ulang; data pendaftaran baru dihapus setelah profil benar-benar tersimpan.
  - Pengguna Google dan akun lama: nomor **tidak wajib** untuk masuk; dapat dilengkapi di halaman Akun.
  - Nomor **tidak diverifikasi** dan tidak dipakai untuk OTP.
- Tombol **Bantuan WhatsApp** memakai `waSupport` di `assets/config.js`, terpisah dari `whatsapp` (pembayaran Pro).
  Isi hanya dengan nomor resmi, format `628…` tanpa `+` dan spasi. Selama kosong, tombol tidak tampil.
- `domainResmi` di `assets/config.js`: isi `https://cekuntung.id` saat domain siap. Pengunjung alamat lama
  (`*.github.io`) lalu melihat pemberitahuan pindah alamat; tidak ada pengalihan otomatis.

## Uji lokal (untuk pengembang)

```bash
node tests/mock-supabase.js 54321    # server tiruan Supabase
# lalu set supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon' di config.js lokal
```

Uji aturan database dengan PostgreSQL 16 lokal (database kosong; setiap baris hasil `nama|t`, `f` = gagal; pesan
ERROR yang tercetak adalah penolakan yang memang diharapkan):

```bash
createdb uji && psql -d uji -f supabase/tests/shim.sql
psql -d uji -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -d uji -tA -f supabase/tests/test.sql          # T1–T12 (dasar)
createdb uji2 && psql -d uji2 -f supabase/tests/shim.sql && psql -d uji2 -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -d uji2 -tA -f supabase/tests/test-tahap2.sql  # U1–U19 (tahap 2)
createdb uji3 && psql -d uji3 -f supabase/tests/shim.sql && psql -d uji3 -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -d uji3 -tA -f supabase/tests/test-masukan.sql # M1–M8 (masukan pengguna)
createdb uji4 && psql -d uji4 -f supabase/tests/shim.sql && psql -d uji4 -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -d uji4 -tA -f supabase/tests/test-price-list.sql   # PL1–PL10 (price list); jalankan dari folder repo
# Migrasi pada database lama: schema.sql sebelum 13 Nov 2026 (git show 6577231:supabase/schema.sql), lalu:
psql -d uji5 -tA -f supabase/tests/test-price-list-migrasi.sql   # MG1–MG4 (migrasi + pembatalan)
```
