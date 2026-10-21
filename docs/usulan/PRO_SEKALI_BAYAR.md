# USULAN v3 — Pro sekali bayar: checkout manual (Transfer Bank + QRIS Statis), hak akses, dan audit

Status: **DIUSULKAN — BELUM DISETUJUI.** Belum ada migrasi yang dijalankan di Supabase produksi, dan
`proPembayaranAktif: false`.

- Diperbarui 21 Okt 2026 (branch `feature/pro-pricing`).
- SQL: `supabase/usulan/pro-sekali-bayar.sql`.
- Tes lokal:
  - `supabase/usulan/test-pro-sekali-bayar.sql` (O1–O24, V1–V12);
  - `supabase/usulan/test-rls-setelah-migrasi.sql` (T1–T12, pengganti `tests/test.sql` setelah migrasi);
  - uji konkurensi dengan 12 sesi paralel.
- Panduan staging: `docs/usulan/STAGING_SUPABASE.md`.

## 1. Satu sistem, memakai ulang yang ada

| Bagian | Tabel/kolom | Isi |
|---|---|---|
| Hak akses | `profiles.pro_sekali_bayar` | Boolean eksplisit. Pro lama tetap di `pro_until`. |
| Pesanan | `upgrade_requests` (diperluas) | `order_code`, `metode`, `amount` (dari server), `claimed_at`, `expired_at`, `updated_at`. Data lama tetap sah. |
| Histori | `pro_order_events` | Status lama → baru, oleh, waktu, catatan. `internal` = catatan admin yang tidak terlihat pembeli. |
| Buku besar dana | `pro_payments` | `pembayaran` / `refund` / `pencabutan`; sumber, referensi (unik per sumber), nominal, admin, waktu. Dana yang pemiliknya belum pasti tercatat dengan `dihubungkan_pada` kosong. |
| Audit admin | `pro_audit_log` | Koreksi referensi, penghubungan dana, pencatatan dana ambigu, perubahan pengaturan. Hanya admin yang membaca. |
| Pengaturan | `pengaturan_pembayaran` (1 baris) | Harga resmi, **batas jam (48)**, rekening, QRIS statis, kontak bantuan, sakelar `aktif`. Diubah admin lewat admin.html; setiap perubahan tercatat. |

**Checkout tanpa WhatsApp.** Checkout ada di `akun.html?view=pro`.

**Detail rekening dan QRIS disimpan di database, bukan di repo publik.** Gambar QRIS berupa file di `img/` situs.
QRIS statis memang publik (sama untuk semua pembeli), jadi tidak disebut rahasia.

## 2. Alur pembeli

1. Seller masuk (Auth V3), lalu membuka **Beli Pro** dan melihat Rp149.000 sekali bayar.
2. Seller memilih **Transfer bank** atau **QRIS**, lalu menekan **Buat pesanan**.
   - Server membuat kode `CU-XXXXXXXX` dan mengambil nominal dari `harga_pro`.
   - Satu akun hanya bisa punya satu pesanan terbuka. Akun yang sudah Pro tidak bisa memesan lagi.
3. Halaman menampilkan instruksi:
   - **Transfer:** bank, nomor rekening (tombol salin), atas nama, nominal tepat, dan kode pesanan (tombol salin). Kode
     pesanan ditulis di berita transfer **bila aplikasi bank mendukung**, tetapi tidak dijadikan satu-satunya bukti.
   - **QRIS statis:** gambar QRIS dengan tautan unduh, nama merchant, NMID, nominal yang diketik sendiri, dan kode
     pesanan untuk identifikasi di Cek Untung. Halaman menjelaskan bahwa kode pesanan tidak muncul di laporan QRIS,
     sehingga pencocokan memakai waktu bayar dan nama yang diisi pembeli.
4. Seller menekan **Saya sudah membayar** dan sebaiknya mengisi waktu bayar dan nama pengirim.
   - Status menjadi **Menunggu verifikasi**. Ini hanya pemberitahuan.
5. Admin memeriksa **mutasi rekening / dasbor QRIS merchant**:
   - **Verifikasi dana:** sumber, referensi persis, dan nominal diketik admin. Dana dicatat dan Pro aktif dalam satu
     transaksi.
   - **Bila pemilik dana belum pasti:** admin menekan **Catat dana masuk tanpa pesanan** dan menandai pesanan **Perlu
     pemeriksaan**. Setelah bukti cocok, admin menekan **Hubungkan ke pesanan** sehingga Pro aktif dan tercatat di audit.
6. Seller melihat **Pro sekali bayar aktif** di perangkat mana pun.

## 3. Status pesanan

| Status | Label | Masuk dari | Oleh |
|---|---|---|---|
| `baru` | Menunggu pembayaran | — | Pembeli (`buat_pesanan_pro`) |
| `diproses` | Menunggu verifikasi | `baru` (≤ 48 jam) | Pembeli (`konfirmasi_sudah_bayar`) |
| `perlu_cek` | Perlu pemeriksaan | `baru` (> 48 jam), `dibatalkan` karena kedaluwarsa (≤ 30 hari), atau ditandai admin | Pembeli / admin |
| `selesai` | Aktif | `baru`/`diproses`/`perlu_cek`/`dibatalkan`/`ditolak` | **Hanya admin** (verifikasi atau hubungkan dana) |
| `ditolak` | Gagal | `baru`/`diproses`/`perlu_cek` | Admin, wajib alasan |
| `dibatalkan` | Dibatalkan / kedaluwarsa | `baru` | Pembeli, atau otomatis setelah 48 jam |
| `direfund` | Dana dikembalikan | `selesai` | Admin (refund dengan pencabutan) |

**Batas 48 jam:** pesanan `baru` yang lewat 48 jam dibatalkan otomatis (`expired_at` terisi) saat pembeli membuat
pesanan berikutnya. Bila pembeli menyatakan sudah membayar setelah batas itu, statusnya **Perlu pemeriksaan**: dana tidak
hangus, Pro tidak langsung aktif, dan admin menyelesaikan dengan aktivasi atau refund setelah rekonsiliasi.

## 4. Pembayaran ambigu (wajib untuk QRIS statis)

| # | Skenario | Penanganan |
|---|---|---|
| 1 | Dua seller membayar Rp149.000 berdekatan | Admin mencatat kedua dana sebagai "belum teridentifikasi", menandai kedua pesanan Perlu pemeriksaan, mencocokkan jam/nama, lalu **Hubungkan dana** satu per satu. Dana yang sudah terhubung tidak bisa dipakai pesanan lain. |
| 2 | Klaim tanpa membayar | Tetap Menunggu verifikasi. Dana tidak ditemukan, sehingga pesanan **Ditolak** dengan alasan. |
| 3 | Bayar kurang | Verifikasi ditolak sistem. Admin menolak pesanan lalu refund dana yang masuk, atau meminta pelunasan sesuai kebijakan. |
| 4 | Bayar lebih | Pro aktif ("aktif_kelebihan"), lalu kelebihannya direfund **atas pembayaran asal** tanpa mencabut Pro. |
| 5 | Bayar dua kali | Dana kedua dicatat sebagai pembayaran tambahan atau dana belum teridentifikasi, lalu direfund. Hak akses tidak berubah. |
| 6 | Bayar setelah 48 jam | Perlu pemeriksaan, lalu aktivasi atau refund oleh admin. |
| 7 | Dua seller mengklaim transaksi yang sama | Referensi unik: dana hanya bisa dihubungkan ke satu pesanan. Pesanan lain ditolak bila dananya tidak ditemukan. |
| 8 | Admin salah ketik referensi | **Koreksi referensi**: nilai lama dan baru tercatat di audit, keunikan tetap dijaga. |
| 9 | Admin mengulang karena koneksi putus | Referensi yang sama menghasilkan "sudah aktif", tanpa entri ganda. Sudah diuji dengan 12 sesi paralel. |
| 10 | Dana masuk tetapi pembeli belum pasti | "Dana masuk tanpa pesanan": dana tercatat dan tidak hilang, Pro tidak aktif. Admin bertanya lewat email akun lalu menghubungkan dana, atau refund ke pengirim. |

**Aturan:** jangan menebak pembeli. Kesamaan nominal saja bukan bukti, dan Pro tidak diaktifkan sebelum bukti cukup.

## 5. Hasil audit SQL dan RLS

Semua lulus di PostgreSQL 16 lokal dengan shim `auth.uid()`; ini bukan Supabase sungguhan.

- **Akses langsung:** seller tidak bisa insert, update, atau delete pesanan, histori, buku besar, audit, pengaturan,
  maupun `pro_sekali_bayar`.
- **Isolasi antar-seller:** seller hanya membaca pesanan, histori non-internal, dan dana miliknya.
- **Anonim:** tidak punya akses ke tabel maupun fungsi pembayaran.
- **Fungsi admin:** semua memeriksa `is_admin()` dari identitas login. Semua `security definer` memakai
  `search_path = public` yang terkunci. Hak eksekusi dicabut dari `public`/`anon` dan diberikan ke `authenticated`.
  Fungsi internal (`_catat_event`, `_audit`, `_aktifkan_dari_pesanan`) tidak bisa dipanggil pengguna.
- **Konkurensi:** baris profil dan pesanan dikunci (`FOR UPDATE`), ditambah indeks unik pesanan terbuka dan referensi.
  Uji 12 sesi paralel: 1 pesanan dan 1 pembayaran.
- **Refund:** wajib menunjuk pembayaran asal (`refund_of`), dan nominalnya tidak boleh melebihi sisa dana pembayaran itu.
- **Perbaikan fungsi lama:** `admin_set_pro` tidak lagi menutup pesanan Pro sekali bayar. Sebelumnya, setelah migrasi,
  fungsi ini akan menandai pesanan "Aktif" tanpa dana tercatat.
- **Kontrak tes lama T6, T9, T10** diganti di `test-rls-setelah-migrasi.sql`, dengan alasan tertulis di kepala file.

## 6. Retensi saat akun dihapus

- Pesanan dan histori ikut terhapus.
- Buku besar dana dan audit **tetap disimpan** dengan `user_id`/`order_id` menjadi null (minimisasi identitas): nominal,
  sumber, referensi, waktu, dan catatan admin.
- **Keputusan pemilik:** apakah catatan admin perlu disamarkan saat akun dihapus. Lamanya retensi perlu ditinjau
  terhadap UU PDP dan kebutuhan pembukuan. Ini bukan klaim kepatuhan hukum.

## 7. Prosedur migrasi (setelah disetujui)

1. **Staging dulu** sesuai `docs/usulan/STAGING_SUPABASE.md`.
2. **Cadangan produksi:**
   - `create table cadangan_pro_<tgl> as select id, pro_until from public.profiles;`
   - `create table cadangan_req_<tgl> as select * from public.upgrade_requests;`
   - Catat jumlah akun Pro lama.
3. **Jalankan** usulan di SQL Editor produksi. File sudah idempoten; boleh dibungkus `begin; … commit;`.
   `pengaturan_pembayaran.aktif` tetap `false`.
4. **Verifikasi tanpa membuat data:**
   - kolom baru ada dan `pro_sekali_bayar` semuanya `false`;
   - jumlah Pro lama sama;
   - fungsi dan policy ada;
   - `aktif = false`.
5. **Rilis website** (merge yang disetujui) dengan `proPembayaranAktif: false`, lalu isi pengaturan resmi di admin.html.
6. **Satu transaksi dengan dana sungguhan** dan akun penguji: pesan, bayar, verifikasi, login ulang, lalu refund.
7. **Buka pembelian:** `aktif = true`, lalu `proPembayaranAktif: true` lewat rilis yang disetujui.

## 8. Rollback

- **Menutup pembelian** (kapan saja, tanpa menghapus data): `aktif = false` di admin.html dan/atau
  `proPembayaranAktif: false`.
- **Membatalkan migrasi** (hanya bila **belum ada** pembayaran nyata):
  - drop fungsi baru dan trigger `audit_pengaturan` / `batas_riwayat`;
  - drop tabel `pro_audit_log`, `pro_payments`, `pro_order_events`, `pengaturan_pembayaran`;
  - drop kolom tambahan `upgrade_requests` dan `pro_sekali_bayar`;
  - pulihkan constraint, policy, dan grant `upgrade_requests` serta `admin_set_pro` dari `schema.sql`.
- **Setelah ada pembayaran nyata, jangan hapus tabel atau kolom**, karena ini catatan keuangan. Tutup pembelian saja.
- Website tetap berfungsi tanpa tabel baru: checkout menampilkan "sedang disiapkan" dan Pro lama tetap terbaca.

## 9. Batas yang tetap ada

- **Fitur Pro tetap bisa dibuka lewat DevTools.** PDF, Excel, dan analisis dibuat di browser. Status Pro yang
  tersimpan di database tetap tidak bisa diubah seller.
- **Kode akses lama tetap diterima.** Kode baru tidak diterbitkan.
