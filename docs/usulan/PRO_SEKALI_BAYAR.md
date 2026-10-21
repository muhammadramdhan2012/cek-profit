# USULAN v2 — Pro sekali bayar: checkout manual (Transfer Bank + QRIS), hak akses, dan audit

Status: **DIUSULKAN — BELUM DISETUJUI.** Belum ada migrasi yang dijalankan di Supabase produksi, dan
`proPembayaranAktif: false`.

- Diperbarui 21 Okt 2026 (branch `feature/pro-pricing`).
- SQL: `supabase/usulan/pro-sekali-bayar.sql`.
- Tes lokal: `supabase/usulan/test-pro-sekali-bayar.sql` (O1–O24).

## 1. Satu sistem, memakai ulang yang ada

| Bagian | Tabel/kolom | Isi |
|---|---|---|
| Hak akses | `profiles.pro_sekali_bayar` | Boolean eksplisit. Pro lama tetap di `pro_until`. |
| Pesanan | `upgrade_requests` (diperluas) | `order_code`, `metode`, `amount` (dari server), `claimed_at`, `updated_at`. Data permintaan lama tetap sah. |
| Histori | `pro_order_events` | Status lama → baru, oleh siapa, kapan, catatan. |
| Buku besar dana | `pro_payments` | `pembayaran` (terverifikasi), `refund`, `pencabutan`; sumber, referensi, nominal, admin, waktu. |
| Pengaturan | `pengaturan_pembayaran` (1 baris) | Harga resmi, batas hari, rekening, QRIS, kontak bantuan, sakelar `aktif`. Hanya admin yang mengubah. |

**Tidak ada pembayaran lewat WhatsApp.** Checkout ada di `akun.html?view=pro`.

**Detail rekening dan QRIS disimpan di database, bukan di repo publik.** Gambar QRIS berupa file di `img/` situs;
database hanya menyimpan path-nya, dan path dibatasi pola `img/…` lewat check constraint.

## 2. Alur pembeli

1. Seller masuk (Auth V3), lalu membuka **Beli Pro**.
2. Seller memilih **Transfer bank** atau **QRIS**, lalu menekan **Buat pesanan**.
   - Server membuat kode `CU-XXXXXXXX` dan mengambil nominal dari `harga_pro`.
   - Satu akun hanya bisa punya satu pesanan terbuka. Akun yang sudah Pro tidak bisa memesan lagi.
3. Halaman menampilkan instruksi:
   - **Transfer:** bank, nomor rekening (tombol salin), atas nama, nominal tepat, dan kode pesanan di berita transfer.
   - **QRIS:** gambar QRIS, nama merchant, NMID, dan nominal tepat.
4. Seller menekan **Saya sudah membayar** (opsional dengan catatan nama pengirim).
   - Status berubah menjadi **Menunggu verifikasi**. Ini hanya pemberitahuan, **bukan pengesahan**.
5. Admin memeriksa **mutasi rekening / dasbor QRIS merchant**, lalu menekan **Verifikasi dana**.
   - Admin mengisi sumber, referensi persis dari mutasi, dan nominal yang terlihat. Nominal tidak diisi otomatis.
   - Fungsi server mencatat dana dan mengaktifkan Pro dalam satu transaksi.
6. Seller melihat **Pro sekali bayar aktif** di perangkat mana pun.

## 3. Status pesanan

| Status | Label | Masuk dari | Oleh |
|---|---|---|---|
| `baru` | Menunggu pembayaran | — | Pembeli (`buat_pesanan_pro`) |
| `diproses` | Menunggu verifikasi | `baru` | Pembeli (`konfirmasi_sudah_bayar`), klik ulang aman |
| `selesai` | Aktif | `baru`/`diproses`/`dibatalkan`/`ditolak` (dana datang terlambat) | **Hanya admin** (`admin_verifikasi_pesanan`) |
| `ditolak` | Gagal | `baru`/`diproses` | Admin (`admin_tolak_pesanan`, wajib alasan) |
| `dibatalkan` | Dibatalkan | `baru` | Pembeli (`batalkan_pesanan`) atau kedaluwarsa otomatis |
| `direfund` | Dana dikembalikan | `selesai` | Admin (`admin_refund_pesanan` dengan pencabutan) |

**Kedaluwarsa:** pesanan `baru` yang melewati `batas_hari` (bawaan 3 hari) dibatalkan dan dicatat saat pembeli
membuat pesanan berikutnya. Tidak perlu penjadwal di server.

## 4. Kasus khusus

| Kasus | Penanganan |
|---|---|
| Klaim / tangkapan layar tanpa dana masuk | Status hanya `diproses`. Pro tidak aktif. Admin menolak bila dana tidak ditemukan. |
| Kurang bayar | Verifikasi ditolak ("Nominal kurang dari tagihan"). Admin menolak pesanan atau meminta pelunasan sesuai kebijakan. |
| Kelebihan bayar | Pro aktif. Hasil `aktif_kelebihan` mengingatkan admin melakukan refund kelebihan (`admin_refund_pesanan`, `cabut = false`). |
| Transfer ganda | `admin_catat_pembayaran_tambahan` mencatat dana kedua, lalu direfund. Hak akses tidak berubah. |
| Satu referensi dipakai dua akun | Ditolak: referensi unik per sumber (`transfer`/`qris`), dinormalkan huruf besar tanpa spasi dan tanda baca. |
| Admin mengulang verifikasi (klik ganda, jaringan putus) | Referensi sama pada pesanan yang sudah aktif menghasilkan `sudah_aktif`, tanpa entri baru. Referensi lain ditolak. |
| Dua admin bersamaan | Baris pesanan dan profil dikunci (`FOR UPDATE`) di dalam satu transaksi. |
| Dana datang setelah pesanan kedaluwarsa | Admin tetap bisa memverifikasi pesanan `dibatalkan`/`ditolak`. |
| Refund | Nominal ≤ saldo dana pesanan (pembayaran − refund). Wajib alasan. Histori tidak dihapus. |
| Akun dihapus | Pesanan dan histori ikut terhapus. Buku besar dana tetap ada dengan `user_id = null` (keputusan retensi pemilik). |

## 5. Hasil audit SQL dan RLS

Semua lulus di PostgreSQL 16 lokal dengan shim `auth.uid()`; ini bukan Supabase sungguhan.

- **Akses langsung:** seller tidak bisa insert, update, atau delete pesanan, histori, buku besar, pengaturan, maupun
  `pro_sekali_bayar` (O1, O8, O18).
- **Isolasi antar-seller:** seller hanya membaca pesanan, histori, dan dana miliknya (O6, O7, O17).
- **Anonim:** tidak bisa memesan atau membaca pengaturan (O22).
- **Wewenang admin:** fungsi admin memeriksa `is_admin()` dari identitas login, bukan parameter dari browser (O8, O22).
- **Harga:** dari server. Klaim bayar tidak mengaktifkan Pro (O4, O8).
- **Verifikasi:** atomik, aman diulang, tanpa referensi ganda, aman untuk kurang dan lebih bayar (O9–O13).
- **Transfer ganda dan refund** tercatat tanpa menghapus histori (O14, O16). Pro lama tidak berubah (O21).
- **Fungsi `security definer`** semuanya dengan `search_path = public` terkunci. `_catat_event` tidak diberikan ke
  pengguna. Hak eksekusi dicabut dari `public` dan `anon`.
- **Catatan:** tes `supabase/tests/test.sql` T6, T9, dan T10 sengaja berubah hasil setelah migrasi, karena seller tidak
  lagi boleh insert permintaan langsung. Saat migrasi disetujui, tes itu diperbarui ke alur RPC; padanannya ada di O1/O4/O20.

## 6. Prosedur migrasi (setelah disetujui)

1. **Staging dulu:** buat project Supabase terpisah, jalankan `schema.sql`, lalu usulan ini.
   - Ulangi O1–O24 dan T1–T11 dengan tes RLS yang sudah diperbarui.
   - **Jangan jalankan file tes di produksi**, karena tes membuat akun.
2. **Cadangan produksi:**
   - `create table cadangan_pro_<tgl> as select id, pro_until from public.profiles;`
   - `create table cadangan_req_<tgl> as select * from public.upgrade_requests;`
   - Catat jumlah akun Pro lama.
3. **Jalankan** usulan di SQL Editor dalam `begin; … commit;`. Biarkan `pengaturan_pembayaran.aktif = false`.
4. **Verifikasi tanpa membuat data:**
   - kolom `pro_sekali_bayar` ada dan semuanya `false`;
   - jumlah Pro lama sama;
   - fungsi dan policy baru ada;
   - pengaturan `aktif = false`.
5. **Isi pengaturan** (rekening, QRIS, kontak bantuan) lewat Table Editor sebagai admin, lalu satu transaksi uji
   dengan akun penguji: pesan, bayar, verifikasi, login ulang, lalu refund.
6. **Buka pembelian:** `pengaturan_pembayaran.aktif = true`, lalu `proPembayaranAktif: true` lewat rilis yang disetujui.

## 7. Rollback

- **Menutup pembelian** (kapan saja, tanpa menghapus data): `update pengaturan_pembayaran set aktif = false;` dan/atau
  `proPembayaranAktif: false`.
- **Membatalkan migrasi** (hanya bila belum ada pembayaran nyata):
  - drop fungsi dan trigger baru, lalu tabel `pro_payments`, `pro_order_events`, `pengaturan_pembayaran`;
  - drop kolom tambahan `upgrade_requests` dan `pro_sekali_bayar`;
  - kembalikan constraint, policy, dan grant `upgrade_requests` seperti di `schema.sql`.
- Website tetap berfungsi sebelum dan sesudah rollback: tanpa tabel baru, checkout menampilkan "sedang disiapkan" dan
  Pro lama tetap terbaca.
- **Setelah ada pembayaran nyata, jangan hapus tabel atau kolom**, karena ini catatan keuangan. Cukup tutup pembelian.

## 8. Batas yang tetap ada

- **Fitur Pro tetap bisa dibuka lewat DevTools.** PDF, Excel, dan analisis dibuat di browser. Status Pro yang
  tersimpan di database tetap tidak bisa diubah seller.
- **Kode akses lama tetap diterima.** Kode baru tidak diterbitkan.
