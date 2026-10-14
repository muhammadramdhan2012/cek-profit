# Known Issues — Cek Profit

Daftar masalah yang diketahui beserta statusnya. Dokumen ini juga **sumber utama status implementasi pilar produk**.
Sumber awal: audit menyeluruh 14 Okt 2026 (read-only), ditambah analisis penghitungan ganda di
`docs/KAMUS_ANGKA.md` §B.1.

## Aturan

- **Status:**
  - **Terbuka:** masalah terbukti dari kode atau data, belum diperbaiki.
  - **Perlu verifikasi:** potensi risiko, belum terbukti terjadi pada data nyata.
  - **Dikerjakan:** sudah disetujui dan sedang diperbaiki.
  - **Selesai:** hanya dengan **bukti pengujian** (nama tes, perintah, hasil, tanggal, commit).
  - **Ditolak / diterima sebagai risiko:** hanya dengan keputusan pemilik.
- Jangan menandai **Selesai** tanpa bukti. "Kodenya jalan" bukan bukti.
- Perbaikan rumus, parser, database, auth, keamanan, pembayaran, dan arsitektur tetap mengikuti aturan persetujuan
  di `CLAUDE.md` §3.
- Perbaikan yang menyentuh definisi keuangan juga menunggu definisi terkait di `docs/KAMUS_ANGKA.md` disetujui
  (lihat `docs/QUALITY_GATES.md` §1).
- **Privasi:** repository ini publik. Jangan menulis angka bisnis asli toko (nominal, jumlah pesanan/refund/produk,
  statistik operasional), data pembeli, atau nomor transaksi asli di sini. Cukup tulis "ditemukan pada data uji pemilik".
- Nomor baris mengacu pada commit `a31eddb` (14 Okt 2026) dan bisa bergeser.
- **Prioritas:** Critical > High > Medium > Low.
- **Kompleksitas (perkiraan audit):** S = ≤ 1 hari, M = 2–3 hari, L = > 3 hari. "Belum diverifikasi" berarti audit
  awal tidak memberi perkiraan.

## Keputusan pemilik (14 Okt 2026)

- Prioritas investigasi: **H1 → H2 → H3 → P10**.
- Investigasi boleh dimulai. Perbaikan menunggu persetujuan rencana dan definisi terkait (A.6, A.7, A.9, A.10 di
  `docs/KAMUS_ANGKA.md`).
- Nama angka di website belum diubah (lihat M9).

## Ringkasan (14 Okt 2026)

| Prioritas | Terbuka | Perlu verifikasi | Selesai |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 3 | 1 (P10) | 0 |
| Medium | 9 | 5 | 0 |
| Low | 8 | 4 (termasuk P4: Low–Medium) | 0 |

## Status pilar produk

| Pilar | Status | Catatan |
|---|---|---|
| Profit Reporting | Berjalan, dengan masalah akurasi terbuka | H1, H2, H3, M1, P3, P10 |
| Profit Optimization | Sebagian | Simulator harga, harga impas/target, batas harga aman. Belum ada skenario tingkat toko. |
| Financial Analytics | Sebagian | Tren per bulan, temuan otomatis. **Arus kas belum ada** (`docs/KAMUS_ANGKA.md` A.15). |
| Financial Control | Awal | Hanya pencocokan total per file dengan ringkasan resmi. **Saldo dan pencairan belum dibaca:** laporan saldo Shopee dikenali tetapi diabaikan (`assets/app.js:833`). |
| Profit Confidence | Belum ada | Hanya sinyal terpisah (`coverage`, `qtyAssumed`, `unknownRisk`) |
| Money Trace | Belum ada | — |
| Profit Decision Engine | Sebagian | Temuan otomatis berbasis aturan + simulator |

---

## High

### H1 · Jumlah barang Shopee dianggap 1 tanpa export pesanan
- **Status:** Terbuka · **Pilar:** Profit Reporting · **Kompleksitas:** S–M (1–2 hari)
- **Lokasi:** `assets/engine.js:455-458`, `assets/engine.js:682` (peringatan hanya level `info`), `assets/app.js:684`
- **Bukti kode:** `cost = entry.cost * (qty ?? 1) * share; if (qty === null) qtyAssumed++;`
- **Bukti data:** ditemukan pada data uji pemilik. Laporan Shopee tanpa export pesanan membuat seluruh baris produk
  Shopee memakai asumsi ini.
- **Dampak:** di mode modal per produk, pesanan multi-unit hanya dibebani modal 1 unit, sehingga laba terlalu besar.
  "Modal diketahui" tetap 100%. Mode reseller (harga acuan) tidak terdampak.
- **Rekomendasi (audit):**
  - Pisahkan "modal diketahui" dari "jumlah barang pasti".
  - Tampilkan asumsi di dekat nota laba.
  - Naikkan peringatan menjadi `warn` dan masukkan ke Profit Confidence.
  - Opsional: estimasi qty dari harga, lalu tampilkan rentang laba.
- **Bukti untuk menutup:** tes regresi dengan pesanan qty > 1 tanpa export.

### H2 · Refund tanpa file retur menghapus biaya barang
- **Status:** Terbuka · **Pilar:** Profit Reporting · **Kompleksitas:** M (2–3 hari)
- **Lokasi:** `assets/engine.js:456` (`share`), `assets/engine.js:458`, `assets/app.js:476` (diungkap hanya di halaman Retur)
- **Bukti:** modal pesanan dikurangi sebesar porsi refund. Kerugian barang yang tidak kembali hanya ditambahkan bila
  file retur diunggah **dan** kasusnya ditandai "Tidak kembali". Lihat `docs/KAMUS_ANGKA.md` §B.1.
- **Bukti data:** ditemukan pada data uji pemilik:
  - refund parsial dan penuh ada di laporan Shopee;
  - setelah file retur diunggah, masih ada kasus "Belum dicek" dengan risiko modal yang berarti.
- **Dampak:** laba terlalu besar senilai barang yang hilang, tanpa peringatan di nota.
- **Rekomendasi (audit):** bila ada refund tetapi status barang tidak diketahui, tampilkan rentang laba ("laba Rp X
  sampai Rp Y") atau skenario konservatif sebagai default di Profit Confidence.
- **Bukti untuk menutup:** tes refund parsial/penuh, dengan dan tanpa file retur, sesuai A.9 (setelah disetujui).

### H3 · Variasi produk dengan modal berbeda tergabung salah
- **Status:** Terbuka · **Pilar:** Profit Reporting, Profit Optimization · **Kompleksitas:** M–L (3–5 hari, perlu
  file export Shopee asli)
- **Lokasi:**
  - `assets/engine.js:451`: semua baris export bernama sama diambil item pertama;
  - `assets/engine.js:455`: modal variasi pertama × total qty;
  - `assets/engine.js:490`: satu baris produk per `productId`;
  - `assets/engine.js:495`: modal variasi terakhir yang menang.
- **Bukti data:** ditemukan pada data uji pemilik. Ada pesanan Shopee dengan lebih dari satu baris produk bernama
  sama, kemungkinan variasi.
- **Dampak:** modal salah untuk produk bervariasi; harga impas dan target per produk menyesatkan; isian modal di tabel
  hanya tersimpan untuk satu SKU variasi.
- **Rekomendasi (audit):**
  - Cocokkan item ke baris export memakai nama + harga + qty secara berurutan, dan hitung modal per baris variasi.
  - Pecah tabel produk per variasi bila SKU-nya berbeda.
  - Tambahkan tes dengan data demo yang punya variasi.
- **Bukti untuk menutup:** fixture dengan variasi bermodal berbeda; verifikasi `docs/KAMUS_ANGKA.md` C.3.

---

## Medium

### M1 · Dasar periode tercampur; bulan pertama dan terakhir tidak lengkap
- **Status:** Terbuka · **Pilar:** Financial Analytics · **Kompleksitas:** S (1 hari)
- **Lokasi:**
  - `assets/engine.js:480`: rentang memakai tanggal dana dilepas;
  - `assets/engine.js:482`: grafik memakai tanggal pesanan;
  - `assets/engine.js:409`: filter memakai bulan pesanan;
  - `assets/engine.js:634-637`: biaya operasional.
- **Bukti data:** ditemukan pada data uji pemilik. Laporan berbasis tanggal dana dilepas memunculkan bulan sebelum
  awal periode sebagai bulan sebagian. Ada jeda beberapa hari antara pesanan dan dana dilepas.
- **Dampak:** "bulan terlemah", perbandingan bulan, dan tren potongan bisa salah arah.
- **Rekomendasi (audit):**
  - Tandai bulan yang tidak lengkap.
  - Keluarkan bulan tidak lengkap dari temuan dan perbandingan.
  - Tampilkan teks "periode berdasarkan tanggal pesanan".
  - Ambang hari menunggu keputusan (`docs/KAMUS_ANGKA.md` A.17).

### M2 · Sinkron akun menimpa perubahan lokal
- **Status:** Terbuka · **Kompleksitas:** M (2–3 hari)
- **Lokasi:** `assets/app.js:126`, `unionCatalog` (basis = cloud)
- **Dampak:** modal yang diubah offline atau di perangkat lain bisa kembali ke nilai lama tanpa pemberitahuan.
- **Rekomendasi (audit):** simpan `updated_at` per entri modal dan per bagian pengaturan, gabungkan dengan prinsip
  "yang terbaru menang", dan beri tahu pengguna bila ada konflik.

### M3 · Keluar akun tidak menghapus data toko di browser
- **Status:** Terbuka · **Kompleksitas:** S (½ hari)
- **Lokasi:** `assets/app.js:1043`
- **Dampak:** di perangkat bersama, pengguna berikutnya melihat modal, nama toko, dan logo.
- **Rekomendasi (audit):** saat keluar, tawarkan "Hapus juga data toko di browser ini" (default ya bila data sudah
  tersinkron).

### M4 · Gagal jaringan saat token habis membuat pengguna ter-logout
- **Status:** Terbuka · **Kompleksitas:** S (½ hari)
- **Lokasi:** `assets/cloud.js:73-75` (`catch (e) { setSession(null); }`)
- **Dampak:** sesi hilang saat sinyal buruk, padahal website dijanjikan bisa dipakai offline.
- **Rekomendasi (audit):** hapus sesi hanya bila server menolak token (status 400/401). Bila jaringan gagal,
  pertahankan sesi dan coba lagi nanti.

### M5 · Batas 3 riwayat gratis hanya di browser
- **Status:** Terbuka · **Kompleksitas:** S (½ hari, perlu migrasi SQL yang dijalankan pemilik)
- **Lokasi:** `supabase/schema.sql:85`, `assets/app.js:927`
- **Dampak (bisnis):** pengguna gratis bisa menyimpan riwayat tanpa batas lewat API.
- **Rekomendasi (audit):** trigger `before insert` pada `reports` yang menolak bila pengguna bukan Pro dan sudah
  punya ≥ 3 riwayat.

### M6 · Status Pro dan kode akses hanya dikunci di browser
- **Status:** Terbuka (keterbatasan desain yang sudah diketahui) · **Kompleksitas:** M
- **Lokasi:** `assets/app.js:76`, `assets/license.js:34-35`
- **Dampak (bisnis):** fitur Pro bisa dibuka lewat DevTools; satu kode akses bisa dibagikan ke banyak orang.
- **Rekomendasi (audit):**
  - Hentikan kode akses dan beralih ke Pro berbasis akun.
  - Validasi fitur bernilai tinggi (riwayat, PDF bermerek, perbandingan) di server (RLS/Edge Function), sementara
    perhitungan tetap di browser.
  - Perlu keputusan produk dan pembayaran.

### M7 · Tes tidak memakai format file asli
- **Status:** Terbuka · **Kompleksitas:** M (2 hari)
- **Lokasi:** `tests/engine.test.js:14-16` (hanya data demo sintetis: `Demo.make()`, `Demo.settings()`)
- **Dampak:** H1–H3 lolos semua tes. Regresi parser tidak terdeteksi. Uji file asli dan e2e dilakukan di luar repo.
- **Rekomendasi (audit):**
  - Simpan cuplikan file asli yang dianonimkan sebagai fixture di `tests/fixtures/`.
  - Tambahkan tes regresi H1–H3.
  - Lihat `docs/QUALITY_GATES.md` §7.

### M8 · Kolom wajib yang berganti nama tidak terdeteksi
- **Status:** Terbuka · **Kompleksitas:** S (1 hari)
- **Lokasi:** `assets/engine.js:47`, `assets/engine.js:118`, `assets/engine.js:130`
- **Dampak:** bila "Harga Produk" berganti nama, penjualan terbaca 0 dan selisihnya masuk "biaya lain", sementara
  pencocokan total tetap lolos.
- **Rekomendasi (audit):**
  - Buat daftar kolom wajib per parser; bila ada yang hilang, tolak dengan pesan "Format laporan berubah".
  - Beri peringatan bila "biaya lain" lebih dari sekitar 5% penjualan (ambang perlu keputusan).

### M9 · Teks website masih memberi kesan kepastian
- **Status:** Terbuka · **Pilar:** semua (kepercayaan) · **Kompleksitas:** belum diverifikasi (bukan bagian audit awal)
- **Lokasi:**
  - `index.html:6-7`: judul dan deskripsi "Laba bersih …";
  - `index.html:37`: "…berapa yang benar-benar tersisa";
  - `assets/app.js` dan `assets/report.js` memakai label "Laba bersih" untuk `netProfit`.
- **Bukti:** `CLAUDE.md` §1 menetapkan "perhitungan laba berdasarkan data yang tersedia, disertai transparansi atas
  komponen yang belum diketahui". `docs/KAMUS_ANGKA.md` §B.2 mencatat `netProfit` secara substansi adalah laba
  operasional (usulan).
- **Dampak:** klaim di website tidak sejalan dengan visi dan keterbatasan data yang masih terbuka.
- **Rekomendasi:** ubah teks dan label setelah nama angka diputuskan pemilik. Ini perubahan perilaku fitur utama,
  jadi perlu persetujuan. Keputusan 14 Okt 2026: **belum diubah**.

---

## Low

| ID | Status | Lokasi | Masalah | Rekomendasi (audit) | Kompleksitas |
|---|---|---|---|---|---|
| L1 | Terbuka | `assets/app.js:46`, `assets/app.js:94` | Gagal menyimpan ke localStorage (kuota penuh) tidak diberitahukan | Tampilkan pemberitahuan bila gagal | S |
| L2 | Terbuka | `assets/engine.js:273`, `assets/engine.js:298` | `returnStatus` dibaca tetapi tidak dipakai (ditemukan pada data uji pemilik: status retur TikTok tersedia) | Isi status barang otomatis dari `returnStatus` | S |
| L3 | Terbuka | `assets/engine.js:149` | Parser penyesuaian Shopee berhenti di baris kosong pertama | Ganti `break` dengan `continue` | S |
| L4 | Terbuka | `assets/engine.js:329`, `assets/engine.js:339` | Duplikat Shopee memakai versi pertama; dua baris export identik yang sah dianggap satu | Simpan versi dengan tanggal dilepas terbaru; tambahkan nomor baris ke kunci duplikat | S |
| L5 | Terbuka | `sw.js:23` | Saat offline, aset yang gagal dimuat dibalas `dashboard.html`; tidak ada batas waktu jaringan | Fallback HTML hanya untuk navigasi; batas waktu jaringan sekitar 4 detik | S |
| L6 | Terbuka | `supabase/schema.sql:93`, `supabase/schema.sql:99-100` | `upgrade_requests.note` tanpa batas panjang dan tanpa batas jumlah permintaan | `check (length(note) < 500)` dan batas permintaan per hari | S |
| L7 | Terbuka | `assets/engine.js:573` | Tarif efektif: biaya logistik TikTok ikut masuk bagian persen | Pisahkan biaya logistik sebagai biaya tetap | S |
| L8 | Terbuka | `assets/engine.js:472` vs `assets/engine.js:492` | Penjualan per produk dihitung sebelum voucher, total sesudah voucher; jumlah per produk ≠ total | Samakan definisinya, atau beri label kolomnya | S |

---

## Perlu verifikasi (potensi risiko)

| ID | Prioritas | Lokasi | Risiko | Kondisi pada data uji pemilik | Rekomendasi (audit) | Kompleksitas |
|---|---|---|---|---|---|---|
| P1 | Medium | `assets/engine.js:19-20` | `num("45000,00")` terbaca 4.500.000 (koma desimal tanpa titik ribuan) | Belum ditemukan | Perbaiki parsing angka (fase akurasi di roadmap audit) | Belum diverifikasi |
| P2 | Medium | `assets/engine.js:36-37` | Tanggal `dd/mm/yyyy` diasumsikan; ekspor berformat `mm/dd` akan tertukar | Belum ditemukan | Perbaiki parsing tanggal (fase akurasi di roadmap audit) | Belum diverifikasi |
| P3 | Medium | `assets/engine.js:499`, `assets/engine.js:528` | Semua penyesuaian dikeluarkan dari laba; tidak sejalan dengan prinsip klasifikasi berdasarkan substansi | Penyesuaian yang ditemukan bersifat positif (kompensasi/penggantian) | Klasifikasikan sesuai A.10 setelah disetujui; masukkan ke Profit Confidence | Belum diverifikasi |
| P4 | **Low–Medium** | `assets/cloud.js:106-112` | Token dibaca dari hash URL (alur implicit): risiko login CSRF | — | Beralih ke alur PKCE | Belum diverifikasi |
| P5 | Medium | `assets/cloud.js:21-22`, tanpa CSP | Token di localStorage; bila ada XSS, token bisa dicuri | Tidak ada XSS terbukti | Tambahkan Content Security Policy lewat `<meta>` | Belum diverifikasi |
| P6 | Low | `assets/cloud.js:67-79` | Dua tab me-refresh token bersamaan bisa membuat semua tab ter-logout | — | Belum diverifikasi | Belum diverifikasi |
| P7 | Low | parser umum (`assets/engine.js`) | ID pesanan numerik di atas 2^53 bisa bertabrakan dan terbuang sebagai duplikat | ID TikTok terbaca sebagai teks, jadi aman saat ini | Belum diverifikasi | Belum diverifikasi |
| P8 | Low | `assets/app.js` (`compute()`) | Hitungan dijalankan 2× per render; bisa lambat pada data sangat besar | — | Belum diverifikasi | Belum diverifikasi |
| P9 | Medium | arsitektur (`assets/engine.js`, `supabase/schema.sql`) | Tidak ada konsep toko; file dua toko akan tergabung tanpa peringatan | — | Tabel `stores`, `store_id` di `user_data` dan `reports`, deteksi file dari toko berbeda (fase multi-toko di roadmap audit) | Belum diverifikasi |
| P10 | **High bila terbukti** | `assets/engine.js:456`, `assets/engine.js:601-613`, `assets/engine.js:499` | **Penghitungan ganda HPP:** refund yang tidak tercatat di baris pesanan (misalnya penyesuaian setelah dana dilepas) + kasus "Tidak kembali" membuat modal pesanan tetap penuh dan kerugian ditambahkan. Juga: kerugian retur dari pesanan di luar periode laporan. Lihat `docs/KAMUS_ANGKA.md` §B.1. | Perlu dicek (`docs/KAMUS_ANGKA.md` C.6) | Cocokkan refund/penyesuaian ke pesanannya sebelum menghitung kerugian retur (A.9); batasi kerugian retur ke pesanan dalam periode | Belum diverifikasi (bukan bagian audit awal) |

## Belum dapat diverifikasi

1. Pengaturan Supabase Auth: konfirmasi email, kebijakan sandi, perlindungan sandi bocor, rate limit, Site URL dan
   Redirect URL.
2. Apakah skema di produksi sama persis dengan `supabase/schema.sql`.
3. Kesetaraan definisi penjualan Shopee dan TikTok (`docs/KAMUS_ANGKA.md` C.1, C.2).
4. Parser export pesanan Shopee/TikTok (Beta; belum ada file export Shopee asli).
5. Hasil PDF lewat `window.print()` di Safari iOS dan Android.
6. Mode offline nyata di HTTPS (service worker hanya aktif di HTTPS).
7. Ketepatan tarif umum di `assets/tarif.js` (sumber sekunder, dicek 14 Okt 2026).

## Riwayat perubahan dokumen

- 14 Okt 2026: dibuat dari audit read-only + analisis penghitungan ganda. Belum ada masalah yang diperbaiki.
- 14 Okt 2026: angka bisnis asli dihapus (repo publik); rekomendasi dan kompleksitas audit dipulihkan; path dibuat
  lengkap; P4 dikembalikan ke Low–Medium; M7 dikoreksi ke baris 14–16.
