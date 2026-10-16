# Known Issues — Cek Untung

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
- H1: prinsip kuantitas disetujui (`docs/KAMUS_ANGKA.md` A.19.1). Spesifikasi implementasi diterima arahnya,
  tetapi **implementasi kode belum diizinkan**. Aturan pencocokan harus divalidasi dulu dengan export pesanan Shopee asli.
- H1/H3 (validasi export pesanan Shopee, 14 Okt 2026):
  - revisi aturan M0–M2 disetujui sebagai **dasar desain**: terverifikasi hanya bila tidak ambigu;
  - status kuantitas dan status variasi dipisah;
  - urutan baris tidak dipakai untuk menebak variasi;
  - HPP terverifikasi hanya bila pemetaan modal benar atau semua kandidat variasi ber-HPP per unit sama;
  - **SKU opsional**;
  - penghitungan unit berlebih saat export diunggah dicatat sebagai bagian H1/H3 dengan prioritas **High**;
  - fixture **sintetis** diizinkan pada tahap pengujian, setelah rencana implementasi disetujui (belum dibuat).
- Tidak ada diskon pemasok yang di-hardcode. Struktur modal dan diskon tiap seller bisa berbeda.

## Ringkasan (14 Okt 2026)

| Prioritas | Terbuka | Perlu verifikasi | Selesai |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 3 | 1 (P10) | 0 |
| Medium | 11 | 5 | 0 |
| Low | 8 | 4 (termasuk P4: Low–Medium) | 0 |

## Status pilar produk

| Pilar | Status | Catatan |
|---|---|---|
| Profit Reporting | Berjalan, dengan masalah akurasi terbuka | H1, H2, H3, M1, M10, M11, P3, P10 |
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
- **Status investigasi (14 Okt 2026):**
  - Investigasi selesai. Prinsip disetujui (A.19.1); detail A.19.2–A.19.4 masih usulan.
  - Implementasi kode **belum diizinkan**.
- **Temuan investigasi:**
  - Laporan Penghasilan Shopee tidak punya kolom kuantitas, SKU, maupun variasi. Kuantitas Shopee hanya bisa didapat
    dari export pesanan (parser Beta, belum diuji dengan file asli).
  - TikTok sudah membaca kuantitas dari "Detail produk terjual".
  - Mode reseller dan modal rata-rata tidak terdampak.
- **Bagian H1 yang bisa dikerjakan tanpa H2/H3 (setelah diizinkan):**
  - status kuantitas per baris (terverifikasi / belum terverifikasi);
  - porsi kuantitas terverifikasi;
  - HPP = kuantitas export × modal per SKU/variasi untuk baris yang cocok **tanpa ambiguitas**;
  - estimasi minimum 1 unit berlabel "Estimasi sementara — kuantitas belum terverifikasi" hanya bila dapat dibenarkan;
  - ajakan mengunggah export pesanan;
  - kuantitas sebagai komponen kelengkapan data.
- **Bergantung pada H2:**
  - pemisahan kuantitas dipesan / dikirim / direfund / kembali / hilang (A.19.2);
  - perlakuan refund penuh dan parsial (refund tidak membuktikan kuantitas atau HPP nol, dan tidak membuktikan barang kembali);
  - perbaikan jumlah retur (M10).
- **Bergantung pada H3:**
  - aturan pencocokan M2 (beberapa baris produk bernama sama);
  - tabel produk dan isian modal per variasi.
- **Kebutuhan data:**
  - Satu file **export pesanan Shopee** (Pesanan Saya → Export) dengan periode yang sama dengan salah satu Laporan
    Penghasilan, untuk memverifikasi format kolom dan aturan M1–M3 serta toleransi ±Rp1 (A.19.4, C.3, C.10).
  - File diproses lokal, tidak di-commit; fixture hanya cuplikan yang dianonimkan dan dengan izin pemilik.
- **Kompatibilitas:**
  - Angka lama dipakai sebagai **baseline regresi, bukan bukti benar**.
  - Kesalahan finansial tidak dipertahankan demi hasil identik. Setiap perbedaan dijelaskan.
  - Kondisi yang belum pasti diberi status estimasi atau belum terverifikasi.
- **Hasil validasi export pesanan Shopee asli (14 Okt 2026, baca-saja, satu bulan data uji pemilik):**
  - Parser export saat ini **bisa membaca** format export "pesanan selesai": nomor pesanan, nama, variasi, jumlah,
    harga setelah diskon, status.
  - Kolom `Nomor Referensi SKU` ada tetapi kosong; parser tidak beralih ke `SKU Induk` karena memilih kolom pertama
    yang **ada**, bukan yang **terisi** (`assets/engine.js:49`, `assets/engine.js:65`, `assets/engine.js:216`).
  - Kolom `Returned quantity`, `Status Pembatalan/ Pengembalian`, `Subtotal Pesanan`, dan `Jumlah Produk di Pesan` belum
    dibaca parser (`assets/engine.js:207-219`).
  - Export jenis "pesanan selesai" tidak memuat pesanan batal atau refund penuh.
  - Subtotal pesanan konsisten dengan jumlah × harga setelah diskon. Untuk pasangan yang tidak ambigu, `Harga Produk` di
    Laporan Penghasilan sama dengan subtotal export.
  - Baris produk Laporan Penghasilan Shopee dibuat **per variasi**, tetapi tanpa nama variasi; ID produk sama untuk semua
    variasi.
  - Variasi dengan harga sama membuat pemasangan lewat nilai **ambigu**. Pada kasus yang ditemukan, kuantitasnya tetap
    pasti; yang ambigu hanya variasinya.
  - Urutan baris tidak konsisten antara Laporan Penghasilan dan export, sehingga **tidak boleh** dipakai.
  - Lihat temuan penghitungan ganda di H3.
- **Acceptance criteria untuk seller tanpa SKU (usulan, berlaku saat implementasi diizinkan):**
  - AC-S1: perhitungan tetap jalan tanpa SKU. SKU hanya kunci tambahan, tidak pernah syarat.
  - AC-S2: identitas baris tanpa SKU memakai nomor pesanan + nama produk + nama variasi (dari export) + nilai. Pemetaan
    yang ambigu tidak pernah dinyatakan terverifikasi.
  - AC-S3: modal per variasi bisa diisi tanpa SKU (kunci nama + variasi). Modal tidak otomatis disamakan antarvariasi.
  - AC-S4: kuantitas dan variasi masing-masing punya status sendiri, dan keduanya ditampilkan terpisah.
  - AC-S5: HPP terverifikasi hanya bila pemetaan modal benar atau semua kandidat variasi ber-HPP per unit sama;
    selain itu "variasi belum terverifikasi".
  - AC-S6: untuk pesanan yang cocok, total unit yang dihitung tidak melebihi total jumlah di export; tidak ada baris yang
    menerima jumlah dari baris variasi lain.
  - AC-S7: mode reseller (diskon dari harga acuan) tidak memakai nilai diskon yang di-hardcode; diskon selalu dari isian seller.
  - AC-S8: Returned quantity atau refund tidak pernah dianggap barang kembali ke stok.
- **Ketergantungan (diperbarui):**
  - **H1 ↔ H3:** pencocokan per variasi (M2) dan status variasi diperlukan agar kuantitas dari export tidak terhitung
    ganda. Keduanya sebaiknya diimplementasikan bersama.
  - **H1 ↔ H2:** pemisahan unit dipesan / tidak dikirim / direfund / kembali / hilang (A.19.2) dan perlakuan refund.
    `Returned quantity` hanya menunjukkan unit yang direfund.
  - **H2 ↔ M10:** jumlah retur Shopee.

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
    *(Bagian "secara berurutan" digantikan keputusan pemilik 14 Okt 2026: urutan baris tidak dipakai. Lihat
    `docs/KAMUS_ANGKA.md` A.19.4.)*
  - Pecah tabel produk per variasi bila SKU-nya berbeda.
  - Tambahkan tes dengan data demo yang punya variasi.
- **Bukti untuk menutup:** fixture dengan variasi bermodal berbeda; verifikasi `docs/KAMUS_ANGKA.md` C.3.
- **Temuan validasi 14 Okt 2026: penghitungan ganda unit variasi saat export diunggah**
  - **Prioritas:** High · **Status:** Terbuka · **Bagian dari:** H1 dan H3
  - **Lokasi:** `assets/engine.js:451-458`
  - **Bukti:** validasi baca-saja dengan export pesanan Shopee asli dan Laporan Penghasilan periode yang sama (data uji
    pemilik).
    - Laporan Penghasilan membuat satu baris per variasi tanpa nama variasi.
    - Kode mencocokkan lewat nama saja. Baris pertama mengambil jumlah **semua** baris export bernama sama, lalu baris
      variasi berikutnya tidak mendapat pasangan dan dianggap 1 unit lagi.
    - Hasilnya, unit yang dihitung **lebih banyak secara material** dibanding total jumlah di export. Tanpa export, unit
      sedikit kurang (H1).
  - **Dampak:**
    - Di mode modal per produk, mengunggah export pesanan (yang selama ini disarankan) justru membuat HPP produk
      bervariasi terlalu besar dan laba terlalu kecil, tanpa peringatan.
    - Penghitung `qtyAssumed` turun, sehingga kondisi tampak membaik.
    - Mode reseller dan modal rata-rata tidak terdampak.
  - **Rekomendasi:** aturan M0–M2 revisi dan pemisahan status kuantitas/variasi (`docs/KAMUS_ANGKA.md` A.19.4–A.19.5).
  - **Bukti untuk menutup:** tes dengan fixture sintetis (AC-S6), tanpa salinan data pembeli.
- **Keterbatasan SKU:**
  - Seller boleh tidak mengisi SKU (SKU opsional).
  - Template modal dan tabel produk saat ini berkunci ID produk, sehingga modal per variasi belum bisa diisi tanpa SKU
    (`assets/engine.js:490`, `assets/engine.js:495`).
  - Kunci nama + variasi dibutuhkan (AC-S3).

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

### M10 · Parser retur Shopee membaca kolom jumlah yang salah
- **Status:** Terbuka · **Pilar:** Profit Reporting · **Kompleksitas:** S · **Terkait:** H1, H2
- **Lokasi:** `assets/engine.js:274` (`qty: num(g('Jumlah')) || 1`), dipakai di `assets/engine.js:601` (perkiraan modal retur)
- **Bukti:** file retur Shopee asli memakai kolom "Jumlah Produk Dikembalikan". Kolom `Jumlah` tidak ada, sehingga jumlah
  retur Shopee selalu terbaca 1. Ditemukan pada data uji pemilik (nama kolom saja).
- **Dampak:** kerugian barang retur multi-unit tercatat terlalu kecil, sehingga laba terlalu besar. Bertentangan dengan
  prinsip A.19.1 (kuantitas tidak diketahui tidak boleh dianggap 1).
- **Rekomendasi:**
  - baca "Jumlah Produk Dikembalikan" dan pertahankan `Jumlah` sebagai alias;
  - bila kosong, status belum terverifikasi, bukan 1;
  - dikerjakan bersama H2 karena memengaruhi kerugian retur (A.7, A.9).
- **Bukti untuk menutup:** tes retur Shopee dengan jumlah 2 dan dengan jumlah kosong.

### M11 · Klasifikasi PPh 22 dan kolom biaya Shopee yang belum dirinci
- **Status:** Terbuka (butuh keputusan definisi) · **Pilar:** Profit Reporting, Financial Control
- **Kompleksitas:** S untuk membaca kolom; perlakuan menunggu keputusan (`docs/KAMUS_ANGKA.md` C.9)
- **Lokasi:** `assets/engine.js:124-130`. Kolom `PPh 22`, `Biaya Transaksi`, `Biaya Kampanye`, `Premi`, `FBS Fee`, dan
  `Biaya Isi Saldo Otomatis (dari Penghasilan)` tidak dibaca terpisah dan masuk "biaya lain" lewat selisih.
- **Bukti:** kolom-kolom itu ada di header Laporan Penghasilan Shopee asli (nama kolom saja; nilainya belum diperiksa).
- **Dampak:**
  - Total tetap cocok dengan laporan, tetapi PPh 22 (pajak) tercampur dengan potongan marketplace, sehingga persen
    potongan, tarif efektif, dan margin bisa menyesatkan.
  - Biaya lain (transaksi, kampanye) tidak tampil di rincian.
- **Rekomendasi:**
  - Rinci kolom-kolom tersebut di parser dan halaman Biaya.
  - Perlakuan PPh 22 **tidak boleh** ditetapkan sebagai biaya final ataupun pajak dibayar di muka sebelum klasifikasi
    dan ketentuan pajaknya diverifikasi (C.9, dengan konsultan pajak).
- **Bukti untuk menutup:** keputusan C.9 tercatat di Kamus + tes parser dengan kolom-kolom tersebut.

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
- 14 Okt 2026: hasil investigasi H1 dan ketergantungannya dicatat; M10 (jumlah retur Shopee) dan M11 (PPh 22 dan biaya
  Shopee) ditambahkan. Belum ada masalah yang diperbaiki.
- 14 Okt 2026: hasil validasi export pesanan Shopee (tanpa angka bisnis); temuan penghitungan ganda variasi (H1/H3,
  High); aturan SKU opsional; acceptance criteria seller tanpa SKU; ketergantungan H1/H2/H3 diperbarui.
