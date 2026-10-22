# Rilis Produksi Cek Untung Pro — checklist, konfigurasi, operasional, deployment

Kandidat rilis: branch `feature/qris-midtrans`. Status: **belum aman untuk produksi** sampai bagian B selesai dan bagian
C kosong. Pembayaran produksi tetap mati (`proPembayaranAktif: false` untuk produksi, `pengaturan_pembayaran.aktif = false`).

## Release checklist

### A. Selesai otomatis oleh Claude (terbukti dengan tes lokal / staging)
- [x] Checkout login dan tamu lewat Midtrans Snap Redirect (QRIS), harga & hak Pro dari server, webhook ber-signature +
      Get Status, idempotensi dana/refund, refund penuh mencabut Pro, refund sebagian tidak.
- [x] Klaim tamu hanya untuk pemilik email lewat tautan email; dana tamu tidak bisa "Hubungkan dana" ke akun lain.
- [x] Monitor pembayaran admin (baca saja) dengan tanda perlu_cek / ganda / refund / belum_diklaim.
- [x] Hardening checkout tamu: tanpa pengungkapan pesanan per email, batas per peminta (CF-Connecting-IP) + global.
- [x] Halaman `privasi.html`: Midtrans, pembelian tanpa akun, pengembalian dana, penjual — dengan penanda
      **KEPUTUSAN PEMILIK** yang wajib diisi. CI menolak merge ke `main` bila penanda masih ada.
- [x] Teks checkout/FAQ/dashboard disesuaikan dengan QRIS Midtrans dan pembelian tanpa akun.
- [x] Draf kebijakan refund v3 (`docs/usulan/KEBIJAKAN_REFUND.md`), prosedur operasional, rencana deployment (di bawah).

### B. Memerlukan tindakan pemilik proyek
1. Isi semua **KEPUTUSAN PEMILIK** di `privasi.html` (lihat "Keputusan pemilik" di bawah); tinjau dengan konsultan hukum bila memungkinkan.
2. Verifikasi `CF-Connecting-IP` di staging (prosedur di bawah) dan catat hasilnya.
3. Konfigurasi produksi sesuai checklist berikut (Supabase Auth/SMTP, Midtrans, secret, Cloudflare, backup).
4. Jalankan deployment berurutan dan smoke test transaksi produksi kecil (bagian Deployment).

### C. Belum aman untuk produksi (blocker)
- [ ] Penanda KEPUTUSAN PEMILIK masih ada di `privasi.html`.
- [ ] SMTP produksi belum terbukti mengirim ke alamat pelanggan sembarang (bukan anggota tim) — wajib untuk tautan aktivasi tamu.
- [ ] Akun Midtrans **Production** (QRIS aktif, Notification URL) belum dikonfigurasi/diuji.
- [ ] Backup database produksi sebelum migrasi belum dibuat.
- [ ] `kontak_bantuan` (pengaturan pembayaran) dan email resmi (`email` di `assets/config.js`) belum diisi.

## Keputusan pemilik yang diperlukan
1. Garansi tanpa alasan: ya/tidak, berapa hari.
2. Batas hari perbaikan sebelum refund bila fitur inti rusak.
3. Waktu tanggapan pertama dan waktu dana diterima (hari kerja).
4. Akses Pro selama chargeback: dicabut atau tetap.
5. Lama penyimpanan pesanan tamu yang tidak dibayar.
6. Identitas penjual (nama/badan usaha, kota) dan email resmi pembayaran.
7. Konfirmasi bahwa pembayaran ganda dikembalikan penuh (sudah dijanjikan di layar status).

## Production configuration checklist

**Supabase Auth**
- [ ] Confirm email: **aktif**. Site URL: `https://cekuntung.id`.
- [ ] Redirect URLs: `https://cekuntung.id/akun`, `https://cekuntung.id/akun?view=aktivasi`.
- [ ] Custom SMTP (Resend) dengan domain terverifikasi; uji kirim ke alamat di luar tim. Template email berbahasa Indonesia.
- [ ] Rate limit email Auth cukup untuk volume aktivasi (Authentication → Rate Limits).
- [ ] Google login tetap mati (`googleLogin` di config) sampai diputuskan.

**Supabase project / Edge Functions**
- [ ] API keys: Edge Function memakai `SUPABASE_ANON_KEY` bawaan; pastikan legacy anon key masih aktif di produksi.
- [ ] Secrets (Edge Functions → Secrets), **berbeda dari staging**:
      `MIDTRANS_ENV=production`, `MIDTRANS_SERVER_KEY` (awalan `Mid-server-`), `GATEWAY_SECRET` (baru, 64 hex,
      lewat `atur-rahasia-gateway.sql`), `ALLOWED_ORIGINS=https://cekuntung.id`, `SITE_URL=https://cekuntung.id`.
- [ ] Jangan pernah memakai `service_role`. Server key Midtrans hanya di secret, tidak di repo/chat.

**Midtrans Production**
- [ ] Akun terverifikasi, QRIS (Snap `other_qris`) aktif, refund QRIS tersedia.
- [ ] Payment Notification URL: `https://<ref-produksi>.supabase.co/functions/v1/qris-notifikasi`.
- [ ] Finish URL dikirim per transaksi oleh server; isi juga default Finish URL `https://cekuntung.id/akun?view=bayar`.

**Cloudflare Pages / repo**
- [ ] Produksi = branch `main`; preview tetap fail-closed ke staging.
- [ ] Sebelum merge: hapus `img/qris-uji.png`, tidak ada `data-keputusan` (CI memeriksa keduanya).

**Backup**
- [ ] Konfirmasi backup harian/PITR sesuai paket; buat dump manual tepat sebelum migrasi (Database → Backups, atau
      `pg_dump` dari Mac dengan connection string — jangan simpan dump di repo).

## Verifikasi CF-Connecting-IP (staging, tanpa mengubah kode)
1. Dari satu jaringan, buat 9 checkout tamu (email uji, sampai halaman Snap, **tanpa membayar**), tiap permintaan
   mengirim `CF-Connecting-IP` palsu berbeda.
2. SQL staging: `select peminta, count(*) from public.pro_pesanan_tamu where created_at > now() - interval '10 minutes' group by 1;`
3. Satu nilai `peminta` dan permintaan ke-9 ditolak → header ditimpa Cloudflare (tepercaya). Banyak nilai → bisa
   dipalsukan (hanya batas global efektif). Semua `null` → header tidak sampai.

## Prosedur operasional

**Rekonsiliasi harian (5–10 menit)**
1. Midtrans Dashboard → Transactions → kemarin, status settlement: catat jumlah transaksi dan total.
2. admin.html → Monitor pembayaran → "Semua": jumlah baris Lunas/Diklaim kemarin harus sama dengan Midtrans.
3. Tangani semua baris di "Perlu perhatian" (di bawah). Selisih yang tidak terjelaskan → jangan aktifkan manual; catat dan periksa.

**Pembayaran tidak tersinkron (sudah bayar, Pro belum aktif)**
1. Pastikan status settlement di Midtrans Dashboard (cari kode `CU-…-n` atau `CT-…`).
2. Pengguna login: minta buka `akun.html?view=pro` → **Cek status** (server menanyakan Midtrans).
3. Tamu: kirim ulang notifikasi dari Midtrans Dashboard (bila tersedia di akun Anda); pembeli dapat membuka
   `akun.html?view=aktivasi` untuk tautan aktivasi baru.
4. Masih gagal: periksa log Edge Function `qris-notifikasi` (Supabase → Edge Functions → Logs).
5. **Jangan** memakai "Verifikasi dana" atau "Catat dana masuk" untuk pembayaran Midtrans: buku besar akan mencatat dana
   dua kali saat webhook berhasil.

**Refund (atas permintaan / pembayaran ganda)**
1. admin.html → Buku besar → baris dana `midtrans` → **Refund lewat Midtrans** (nominal + alasan). Status & pencabutan
   Pro tercatat otomatis dari Midtrans; refund penuh mencabut Pro, refund sebagian tidak.
2. Refund dari dashboard Midtrans juga tercatat otomatis (saat notifikasi berikutnya / Cek status).
3. Refund manual (transfer) hanya bila Midtrans tidak bisa (misalnya lewat masa refund); catat dengan tombol refund manual.
4. Tamu yang direfund sebagian sebelum klaim tidak bisa mengklaim: refund sisanya, lalu minta pembeli membeli ulang.

**Chargeback (berbeda dari refund)**
Refund = kita mengembalikan dana. Chargeback = bank/penerbit pembayar menarik dana lewat Midtrans karena sengketa.
1. Notifikasi sengketa dari Midtrans → kumpulkan bukti (kode pesanan, waktu, status Pro aktif, email aktivasi).
2. Tanggapi di dashboard Midtrans sesuai batas waktu mereka.
3. Akses Pro selama sengketa mengikuti keputusan pemilik (#4). Bila dana ditarik: catat **refund manual** dengan alasan
   "chargeback <id>" dan pilihan cabut Pro. Sistem tidak memproses status chargeback otomatis.

## Deployment produksi (berurutan)
1. **Freeze**: pastikan `main` = rilis terakhir yang sehat; catat commit-nya (untuk rollback).
2. **Backup** database produksi (lihat checklist).
3. **Periksa migrasi yang sudah ada** di produksi (Table Editor: `pro_payments`, `pengaturan_pembayaran`, `gateway_rahasia`).
4. **SQL Editor produksi**, berurutan, satu file per Run: `pro-sekali-bayar.sql` (bila belum) → `hardening-fungsi.sql`
   (bila belum) → `qris-midtrans.sql` → `atur-rahasia-gateway.sql` (hash produksi) → `checkout-tamu.sql` →
   `admin-monitor-pembayaran.sql`. Semua aman diulang. Biarkan `aktif = false`.
5. **Secrets** produksi, lalu **deploy 6 Edge Functions**: `qris-buat`, `qris-cek`, `qris-refund` (default),
   `qris-notifikasi`, `tamu-checkout`, `tamu-status` (`--no-verify-jwt`).
6. **Midtrans Production**: Notification URL + Finish URL.
7. **Merge ke `main`** (PR terpisah yang menghapus `img/qris-uji.png`, mengisi kebijakan, mengubah produksi
   `proPembayaranAktif: true`, `email`). Tunggu Cloudflare 1–3 menit, refresh keras.
8. **Admin**: isi `kontak_bantuan`, mode **Otomatis**, centang **Buka pembelian**.
9. **Smoke test** (uang sungguhan, kecil): satu checkout login + satu checkout tamu Rp149.000 → Pro aktif / tautan
   aktivasi diterima → monitor admin benar → refund penuh keduanya → Pro dicabut, refund tercatat sekali.
10. Pantau log Edge Function dan monitor admin 24 jam pertama.

## Rollback dan menonaktifkan checkout
- **Matikan checkout seketika**: admin.html → Pengaturan pembayaran → hapus centang **Buka pembelian**. Database menolak
  pesanan baru; webhook, refund, dan status pembayaran yang sudah berjalan tetap diproses.
- **Sembunyikan tombol beli**: revert commit `proPembayaranAktif: true` di `main` (Cloudflare 1–3 menit).
- **Edge Function bermasalah**: deploy ulang versi sebelumnya dari commit terakhir yang sehat; jangan hapus
  `qris-notifikasi` selama masih ada pembayaran berjalan.
- **SQL**: tidak di-rollback (semua migrasi menambah, tidak menghapus data). Bila perlu, pulihkan dari backup langkah 2
  hanya dengan keputusan pemilik — pembayaran setelah backup akan hilang dari database dan harus dicocokkan ulang dari Midtrans.
