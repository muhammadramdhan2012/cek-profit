# USULAN — Pro sekali bayar: hak akses, audit pembayaran, dan pembayaran manual

Status: **DIUSULKAN — BELUM DISETUJUI.** Belum ada migrasi yang dijalankan di Supabase produksi.
Dibuat 21 Okt 2026 (branch `feature/pro-pricing`). SQL: `supabase/usulan/pro-sekali-bayar.sql`,
tes lokal: `supabase/usulan/test-pro-sekali-bayar.sql`.

## 1. Hak akses (entitlement) sekali bayar

| Opsi | Cara | Kelebihan | Kekurangan |
|---|---|---|---|
| A. Tanggal penanda | `pro_until = '9999-12-31'` | Tanpa migrasi | Tidak eksplisit; tercampur dengan Pro berjangka; mudah salah baca (tampil "sampai 31 Des 9999") |
| **B. Kolom boolean (dipilih)** | `profiles.pro_sekali_bayar boolean not null default false` | Eksplisit; satu kolom; Pro lama di `pro_until` tidak disentuh; grant update yang ada otomatis melindunginya | Butuh migrasi kecil |
| C. Tabel entitlement | `entitlements(user_id, produk, sejak, dicabut)` | Paling fleksibel untuk banyak produk | Lebih banyak query/RLS; berlebihan untuk satu produk |

**Rekomendasi: B.** Website membaca `isPro = pro_sekali_bayar === true || pro_until >= hari ini`.

**Kompatibilitas:**
- Sebelum migrasi kolom belum ada (`undefined`), jadi hanya `pro_until` yang berlaku. Akun Pro lama tetap Pro.
- Urutan rilis bebas: website baru aman di database lama, dan migrasi aman untuk website lama karena kolom bawaannya `false`.
- Pengguna tidak bisa mengubah kolom ini: hak ubah di `profiles` hanya untuk `full_name`, `store_name`, dan
  `whatsapp`. Ini sudah diuji lokal (P1).

## 2. Audit pembayaran dan aktivasi

- **Tabel `pro_payments`** berisi akun, `kind` (aktivasi/pencabutan/refund), nominal, referensi, catatan, admin
  pencatat (`created_by`), waktu, dan `request_id`.
- **Referensi unik:** referensi transaksi untuk aktivasi wajib unik, sehingga satu transfer tidak bisa mengaktifkan dua akun.
- **Siapa yang bisa menulis:** pengguna hanya bisa membaca catatannya sendiri. Penulisan hanya lewat fungsi admin.
- **`admin_aktifkan_pro_sekali`:**
  - nominal dan referensi wajib diisi;
  - akun yang sudah Pro sekali bayar ditolak;
  - permintaan terkait otomatis menjadi "selesai".
- **`admin_cabut_pro`:** jenis refund/pencabutan dengan alasan wajib. `pro_until` lama tidak disentuh.
- **Status pesanan** memakai `upgrade_requests.status` yang sudah ada:

| `status` | Arti |
|---|---|
| `baru` | Menunggu Pembayaran |
| `diproses` | Menunggu Verifikasi |
| `selesai` | Aktif |
| `ditolak` | Gagal/Dibatalkan |

- **Tidak disimpan:** nomor rekening/kartu pembeli, tangkapan layar, atau data pembayaran sensitif lain.
- **Tes lokal P1–P19 lulus** (PostgreSQL 16 + shim), dan tes RLS lama T1–T11 tetap lulus setelah migrasi dijalankan dua kali.

## 3. Pembayaran manual paling sederhana (closed paid launch)

1. Seller masuk, lalu menekan **Beli Pro**. Permintaan `pro_sekali` tercatat dengan status `baru`.
2. Seller membayar Rp149.000 ke **satu rekening atau QRIS resmi** dan menyertakan email akun di berita transfer.
3. Admin memeriksa **mutasi rekening atau QRIS** (bukan tangkapan layar):
   - nominal sesuai;
   - referensi diambil dari mutasi (nomor referensi bank atau ID transaksi QRIS).
4. Admin membuka admin.html, menekan **Aktifkan Pro sekali bayar**, lalu mengisi referensi dan nominal. Aktivasi tercatat.
5. Seller memuat ulang dan melihat "Pro sekali bayar". Status tetap ada saat masuk dari perangkat lain.
6. Bila pembayaran tidak ditemukan dalam batas waktu yang ditetapkan, admin menolak permintaan (status `ditolak`).

## 4. Kebutuhan sebelum tombol beli diaktifkan

- Rekening atau QRIS resmi atas nama usaha atau pemilik.
- Kanal bantuan resmi (email dan/atau WhatsApp Business), diisi di `waSupport` / `email` di `assets/config.js`.
- Kebijakan refund disetujui dan terbit (draf: `docs/usulan/KEBIJAKAN_REFUND.md`).
- Migrasi `supabase/usulan/pro-sekali-bayar.sql` §0–§4 dijalankan pemilik, lalu tes P1–P19 diulang di Supabase.
  §5 (batas riwayat gratis) opsional.
- Isi `whatsapp` (kontak pembayaran) dan `proPembayaranAktif: true`.
- Satu transaksi uji dari awal sampai akhir dengan akun penguji, termasuk refund.

## 5. Batas yang tetap ada

- **Fitur Pro tetap bisa dibuka lewat DevTools.** PDF, Excel, dan analisis dibuat di browser. Ini tidak bisa dikunci
  penuh tanpa desain tambahan, misalnya PDF bermerek dibuat di server.
- **Kode akses lama tetap diterima,** dan tidak ada kode baru yang diterbitkan.
