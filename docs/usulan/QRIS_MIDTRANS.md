# Pembayaran otomatis QRIS dinamis (Midtrans) — implementasi lokal

Status: **SIAP DIUJI DI STAGING; belum dijalankan di Supabase mana pun, belum ada Edge Function terpasang, tanpa uang
sungguhan.** Branch `feature/qris-midtrans` (dari `feature/pro-pricing`). Rancangan lengkap: dokumen "Desain Pembayaran
Otomatis QRIS Dinamis — Cek Untung Pro".

## Alur

1. Pembeli menekan **Bayar dengan QRIS** → `buat_pesanan_pro('qris')` (pesanan & harga dari server).
2. Browser memanggil Edge Function `qris-buat` (JWT pembeli) → `gateway_mulai_percobaan`:
   QR yang masih berlaku dipakai ulang; QR yang lewat waktu dicek dulu ke Midtrans dan dibatalkan bila masih pending;
   baru setelah itu dibuat percobaan `<kode>-N` dan charge QRIS Midtrans (Rp dari database, berlaku 15 menit).
3. Pembeli membayar. Midtrans mengirim notifikasi ke `qris-notifikasi` → cek `signature_key` → **Get Status** →
   `gateway_terapkan_status` (dana dicatat sekali, Pro diaktifkan sekali, event + audit).
4. Halaman checkout memanggil `qris-cek` tiap 5 detik (database saja; Midtrans ditanya bila diminta, lewat waktu,
   atau status terakhir > 30 detik) dan menampilkan Pro aktif tanpa muat ulang.
5. Refund: admin → `qris-refund` → `admin_refund_gateway_siapkan` (cek admin, sisa dana, `refund_key` deterministik)
   → Refund API → Get Status → `gateway_terapkan_status` mencatat refund; Pro dicabut hanya bila seluruh dana pesanan kembali.

Alur manual lama tetap ada: `pengaturan_pembayaran.mode = 'manual'` mengembalikan checkout transfer/QRIS statis, dan
semua fungsi admin manual tetap bisa dipakai untuk pengecualian.

## Akses tanpa `service_role`

| Pemanggil | Kunci yang dipakai | Fungsi yang bisa dipanggil |
|---|---|---|
| Browser pembeli | publishable key + JWT pembeli | Edge Function `qris-buat`, `qris-cek` |
| Edge Function untuk pembeli | anon key + JWT pembeli | `gateway_mulai_percobaan`, `gateway_percobaan_saya` (cek pemilik di database) |
| Edge Function untuk admin | anon key + JWT admin | `admin_refund_gateway_siapkan` (cek `is_admin()`) |
| Edge Function sistem | anon key + `GATEWAY_SECRET` | `gateway_simpan_qr`, `gateway_terapkan_status` (database hanya menyimpan hash SHA-256 rahasia, di tabel tanpa hak akses API) |

Risiko yang diterima: siapa pun yang memegang `GATEWAY_SECRET` bisa menulis status pembayaran palsu. Rahasia ini hanya
ada di secret Edge Function (dan hash-nya di database), cakupannya hanya dua fungsi, dan bisa diganti kapan saja dengan
`supabase/usulan/atur-rahasia-gateway.sql`. Tidak ada `service_role` yang dipakai.

## File

| File | Isi |
|---|---|
| `supabase/usulan/qris-midtrans.sql` | Migrasi (setelah `pro-sekali-bayar.sql` + `hardening-fungsi.sql`), idempoten |
| `supabase/usulan/atur-rahasia-gateway.sql` | Memasang hash `GATEWAY_SECRET` (per project) |
| `supabase/functions/_shared/qris.mjs` | Logika & pengamanan Edge Function (tanpa dependensi) |
| `supabase/functions/qris-{buat,cek,notifikasi,refund}/index.ts` | Pembungkus Deno |
| `assets/akun.js`, `assets/cloud.js`, `admin.html` | Checkout QR + hitung mundur + cek otomatis; admin: mode, masa QR, refund lewat Midtrans |
| `tests/qris.test.js` (CI), `tests/mock-midtrans.js` | Uji Edge Function dengan Midtrans tiruan |
| `supabase/usulan/test-qris-midtrans.sql` | Uji database Q1–Q28 |
| `tests/e2e/qris-e2e.mjs` | Uji ujung-ke-ujung E1–E22: Edge Function asli + PostgreSQL asli + Midtrans tiruan (manual) |

## Secret Edge Function (diisi pemilik, tidak pernah di repo/chat)

| Nama | Staging | Produksi |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | server key **sandbox** (`SB-Mid-server-…`) | server key produksi (`Mid-server-…`) |
| `MIDTRANS_ENV` | `sandbox` | `production` |
| `GATEWAY_SECRET` | acak 64 karakter (lihat `atur-rahasia-gateway.sql`) | acak, **berbeda** |
| `ALLOWED_ORIGINS` | `https://feature-qris-midtrans.cekuntung.pages.dev,https://feature-pro-pricing.cekuntung.pages.dev` | `https://cekuntung.id,https://www.cekuntung.id` |

`SUPABASE_URL` dan `SUPABASE_ANON_KEY` disediakan otomatis oleh Supabase. Fungsi menolak berjalan bila kunci tidak
cocok dengan `MIDTRANS_ENV` (kunci produksi tidak bisa terpakai di staging dan sebaliknya).

## Menjalankan uji lokal

```bash
node tests/qris.test.js                                    # CI
PGHOST=<socket> PGPORT=<port> PGUSER=postgres node tests/e2e/qris-e2e.mjs   # butuh PostgreSQL lokal
# SQL: shim-tanpa-ekspos.sql → schema.sql → pro-sekali-bayar.sql → hardening-fungsi.sql → qris-midtrans.sql → test-qris-midtrans.sql
```

## Langkah minimum menguji di staging (masing-masing butuh izin pemilik)

1. **Midtrans sandbox:** buat akun sandbox, ambil **Server Key sandbox** (Settings → Access Keys). Jangan kirim ke chat.
2. **Rahasia gateway:** jalankan perintah di kepala `atur-rahasia-gateway.sql` di Terminal Mac.
3. **SQL staging** (SQL Editor `cekuntung-staging`): `qris-midtrans.sql` (2×), `atur-rahasia-gateway.sql` dengan hash,
   lalu `periksa-staging.sql` (tetap 14/14).
4. **Edge Functions:** pasang Supabase CLI, `supabase login`, `supabase link --project-ref epyhhazihfolbdtjxxfd`, isi
   secret (`supabase secrets set …`), lalu deploy `qris-buat`, `qris-cek`, `qris-refund`, dan
   `qris-notifikasi --no-verify-jwt`.
5. **Midtrans sandbox → Settings → Payment → Notification URL:**
   `https://epyhhazihfolbdtjxxfd.supabase.co/functions/v1/qris-notifikasi`.
6. **Push branch** `feature/qris-midtrans` → preview `https://feature-qris-midtrans.cekuntung.pages.dev` (sudah terdaftar
   sebagai host staging). Tambahkan alamat itu di Redirect URLs Supabase staging.
7. **Admin staging:** mode **Otomatis**, kontak bantuan diisi, buka pembelian.
8. **Uji:** beli Pro dengan akun uji, bayar QR lewat simulator QRIS sandbox Midtrans, pastikan Pro aktif < 1 menit;
   uji QR kedaluwarsa, cek manual, refund penuh & sebagian dari admin.

## Bila notifikasi Midtrans hilang (tanpa sistem monitoring)

1. Midtrans mengirim ulang notifikasi yang gagal hingga 5 kali (±3,5 jam).
2. Selama halaman QR terbuka, checkout menanyakan status tiap 5 detik; tombol **Saya sudah bayar, cek sekarang**
   memaksa Get Status ke Midtrans.
3. Saat pembeli membuka lagi **Beli Pro** (atau **Lihat status** di halaman Akun), pesanan terbuka dicek ulang ke Midtrans
   secara otomatis, lalu Pro diaktifkan bila sudah lunas.
4. Rekonsiliasi harian admin (±5 menit): bandingkan transaksi *settlement* di dasbor Midtrans dengan dana `midtrans` di
   Buku besar admin. Ada transaksi lunas tanpa Pro → minta pembeli membuka halaman Beli Pro, atau kirim ulang notifikasi
   dari dasbor Midtrans bila fitur itu tersedia.

## Belum diverifikasi

- Runtime Deno/Supabase Edge sungguhan (logika diuji di Node 22 dengan API web yang sama).
- Respons Midtrans sandbox sungguhan: bentuk `actions`/`qr_string`, perilaku `custom_expiry` untuk QRIS, kode status
  pembatalan, dan bentuk `refunds` di Get Status. Mock mengikuti dokumentasi publik.
- Ketersediaan QRIS dinamis untuk akun Midtrans perorangan, MDR, dan jadwal pencairan.

## Checkout tamu (Midtrans Snap, tanpa login) — usulan, belum di staging

- Alur: `akun.html?view=pro` (belum login) → nama, email, WA opsional → Edge Function `tamu-checkout` (harga dari server,
  `enabled_payments: other_qris`, kedaluwarsa 15 menit) → **redirect** ke halaman Snap → kembali ke `akun.html?view=bayar`
  (status dari `tamu-status`, bukan dari callback browser) → webhook `qris-notifikasi` (signature + Get Status) mencatat
  pembayaran → email tautan aktivasi (Supabase OTP) → `akun.html?view=aktivasi` → `klaim_pembelian_tamu()` mengaktifkan Pro.
- Snap **redirect**, bukan popup: popup memerlukan `snap.js` dari CDN pihak ketiga yang bisa membaca token sesi di halaman.
  Popup hanya dengan persetujuan pemilik.
- Klaim mensyaratkan email terkonfirmasi **dan** sesi dari tautan email (`amr`), jadi mengetik email orang lain saat checkout
  tidak memberi Pro ke akun orang itu. Akun yang sudah ada tidak diduplikasi (OTP dengan `create_user: true` memakai akun lama).
- Email gagal: pembayaran tetap tercatat; `tamu-status` dengan `paksa` atau halaman `view=aktivasi` mengirim ulang (maks. 5×).
- File: `supabase/usulan/checkout-tamu.sql` (+ tes `test-checkout-tamu.sql`), `supabase/functions/tamu-checkout`, `tamu-status`.

### Kebutuhan staging (dijalankan pemilik)
1. SQL Editor staging: jalankan ulang `qris-midtrans.sql` (dispatch pesanan tamu), lalu `checkout-tamu.sql`.
2. Deploy `tamu-checkout` dan `tamu-status` dengan `--no-verify-jwt`.
3. Secret Edge Function `SITE_URL` = alamat preview (mis. `https://feature-qris-midtrans.cekuntung.pages.dev`).
4. Authentication → URL Configuration: tambahkan Redirect URL `<SITE_URL>/akun?view=aktivasi`.
5. Verifikasi di staging: fungsi `security definer` dapat membaca `auth.users.email_confirmed_at`, dan nilai `amr` di JWT
   setelah tautan email berisi `otp`/`magiclink` (belum bisa diuji di sini).
