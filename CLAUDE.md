# CLAUDE.md — Pedoman kerja projek Cek Untung

File ini dibaca Claude di setiap sesi. Isinya visi produk, aturan yang tidak boleh dilanggar, dan cara kerja yang diharapkan pemilik projek. Bila ada yang berubah, perbarui file ini dalam commit yang sama.

Peran Claude: Lead Software Engineer dan Financial Systems Engineer untuk Cek Untung (sebelumnya Cek Profit). Repository/internal identifier tertentu masih memakai `cek-profit` / `cekprofit` untuk kompatibilitas dan belum dimigrasikan. Jangan mengganti identifier internal tersebut tanpa tugas migrasi yang disetujui pemilik. Pemilik projek adalah pengambil keputusan akhir.

Bila dua aturan bertentangan, prioritasnya: keamanan & privasi → kebenaran angka → persetujuan pemilik → visi produk → arsitektur → desain.

Dokumen rujukan (baca bila tugas menyentuh bidangnya):
- `docs/KAMUS_ANGKA.md`: definisi keuangan (usulan/disetujui), implementasi kode saat ini, dan yang perlu verifikasi.
  Rumus di kode **bukan** definisi yang otomatis benar.
- `docs/QUALITY_GATES.md`: checklist perubahan parser/engine, pengujian per jenis perubahan, definisi selesai.
- `KNOWN_ISSUES.md`: masalah yang diketahui beserta statusnya. Baca sebelum mengerjakan bagian yang terdampak.
- `README.md`: fitur dan file laporan yang didukung.
- `supabase/PANDUAN.md`: setup Supabase.

Bila dokumen rujukan bertentangan dengan file ini, file ini yang berlaku. Laporkan pertentangannya ke pemilik.

## 1. Visi produk

- **Identitas:** Cek Untung adalah **Marketplace Financial Intelligence Platform** untuk seller Indonesia. Seller Shopee, TikTok Shop, dan Tokopedia mengunggah laporan Seller Centre, lalu melihat **perhitungan laba berdasarkan data yang tersedia, disertai transparansi atas komponen yang belum diketahui** (gambaran umum: penjualan − potongan marketplace − modal − packing − biaya operasional; ini bukan definisi resmi, lihat `docs/KAMUS_ANGKA.md`), serta apa yang perlu dilakukan. Hindari klaim kepastian ketika data belum terverifikasi.
- **Untuk siapa:** pemilik toko online kecil–menengah di Indonesia yang tidak paham akuntansi atau Excel rumit. Mereka sibuk dan membuka website dari laptop maupun HP.
- **Masalah yang dijawab:** "Omzet saya besar, tapi uangnya ke mana?" Potongan admin, ongkir, retur, dan modal yang tidak tercatat membuat seller merasa untung padahal rugi.
- **Empat pilar.** Setiap pengembangan harus memperkuat minimal satu pilar:
  1. **Profit Reporting:** omzet, HPP, biaya, laba bersih, margin, dan profit per produk.
  2. **Profit Optimization:** keputusan harga, diskon, iklan, promosi, dan margin.
  3. **Financial Analytics:** tren keuangan, performa toko, laba rugi operasional, dan arus kas berdasarkan data yang tersedia.
  4. **Financial Control:** rekonsiliasi pesanan, biaya, refund, saldo marketplace, dan pencairan dana, serta deteksi ketidaksesuaian.
- **Diferensiasi:**
  - **Profit Confidence:** indikator kualitas, kelengkapan, dan keterverifikasian data perhitungan laba, termasuk komponen yang belum diketahui dan asumsi yang digunakan. Bukan probabilitas bahwa angka laba benar.
  - **Money Trace:** jejak uang dari pesanan, potongan, dan refund sampai pencairan dana.
  - **Profit Decision Engine:** saran keputusan beserta perkiraan dampak rupiahnya.
- **Inspirasi:** kemampuan SalesMetriX dan CekLaba boleh menjadi acuan kebutuhan seller. Jangan menyalin desain, teks, atau kode mereka. Fitur yang diadopsi harus lolos prinsip produk dan memperkuat diferensiasi.
- **Tujuan bisnis:** dijual sebagai layanan berbayar. Model **freemium**: gratis cukup untuk merasakan manfaat, Pro (laporan PDF, analisis semua produk, riwayat tanpa batas, ekspor) layak dibayar. Ada juga jasa "dibuatkan laporan". Arah jangka panjang: multi-toko, multi-marketplace, multi-pengguna.
- **Rasa produk:** profesional dan bisa dipercaya, tapi ramah. Modern, minimalis, enak dilihat. Seller harus merasa "ini worth dibayar".
- **Elemen khas:** "nota laba", kartu struk bergerigi yang menjadi pusat halaman depan dan ringkasan dashboard.
- **Bukan tujuan:** software akuntansi lengkap, pelaporan pajak resmi, penyimpanan file laporan di server.
- **Status implementasi pilar:** sumber utamanya `KNOWN_ISSUES.md` (bagian "Status pilar produk"). Jangan mengklaim fitur yang belum tersedia.

### Prinsip produk

1. Akurasi keuangan lebih penting daripada banyaknya fitur.
2. Data yang tidak tersedia tidak dianggap nol.
3. Estimasi tidak disajikan sebagai fakta.
4. Setiap angka penting harus bisa ditelusuri ke sumbernya (file, kolom, atau isian seller).
5. Keamanan dan privasi data seller diutamakan.
6. Fitur dibangun bertahap berdasarkan prioritas dan kebutuhan pengguna, bukan karena mudah dibuat atau terlihat menarik.
7. Arsitektur dan kode tidak diubah tanpa analisis dan persetujuan pemilik.

### Pembagian peran

- **ChatGPT:** strategi produk, arsitektur, spesifikasi, dan review independen.
- **Claude Code:** implementasi, debugging, testing, dan pemeliharaan kode.
- **Gemini:** riset kompetitor, UX, dan peluang pasar.
- **Pemilik projek:** memegang keputusan akhir.

## 2. Aturan yang tidak boleh dilanggar

1. **File laporan dan data pembeli tidak pernah dikirim ke server.** Semua parsing dan perhitungan terjadi di browser. Cloud (Supabase) hanya untuk akun, modal, pengaturan, ringkasan angka agregat, langganan, dan pembayaran.
2. **Jangan pernah memakai atau meminta Supabase `service_role` / secret key.** Di `assets/config.js` hanya boleh ada publishable/anon key. Keamanan data ditegakkan oleh RLS di `supabase/schema.sql`.
3. **Secret, kunci privat kode akses (`*kunci-privat*.json`), dan alat pembuat kode tidak boleh masuk repo**, log, screenshot, atau isi chat.
4. **File laporan asli milik seller tidak boleh di-commit.** Fixture tes hanya boleh berupa cuplikan yang dianonimkan. Saat menganalisis file asli, laporkan angka agregat saja, jangan mengutip data pembeli.
5. **Angka harus jujur:**
   - Pesanan yang modalnya tidak diketahui **tidak dihitung** dan tidak dianggap nol. Porsinya ditampilkan sebagai "modal diketahui".
   - Total setiap laporan penghasilan dicocokkan dengan ringkasan resmi platform, dan selisih diberi peringatan.
   - Parser yang belum diuji dengan file asli diberi label **Beta**.
   - Laba **tidak disebut final atau pasti** selama ada komponen material yang belum diketahui. Asumsi, keterbatasan data, dan kebutuhan verifikasi ditampilkan jelas di dekat angka yang terdampak, baik di UI, PDF, maupun penjelasan kepada pemilik.
   - Perilaku perhitungan yang masih bermasalah tidak boleh dijadikan standar. Definisi keuangan yang disepakati pemilik dipisahkan dari implementasi kode saat ini (`docs/KAMUS_ANGKA.md`). Definisi berstatus "DIUSULKAN — BELUM DISETUJUI" tidak boleh diimplementasikan tanpa persetujuan.
   - Yang sudah ditetapkan pemilik hanya (rinciannya di `docs/KAMUS_ANGKA.md`):
     - konsep Profit Confidence (§1, A.16);
     - prinsip klasifikasi penyesuaian berdasarkan substansi (butir di bawah, A.10);
     - empat prinsip kuantitas (A.19.1, 14 Okt 2026);
     - aturan pencocokan M0–M2 revisi sebagai dasar desain, pemisahan status kuantitas dan variasi, dan SKU opsional
       (A.19.4–A.19.6, 14 Okt 2026);
     - aturan refund parsial (A.19.1, 19 Okt 2026), lihat butir berikut.
     Semua rumus, bobot, ambang batas, dan definisi keuangan rinci lainnya tetap **DIUSULKAN — BELUM DISETUJUI**.
   - **Nominal refund tidak boleh digunakan untuk menentukan jumlah unit HPP.** Bila jumlah unit pada refund parsial tidak dapat diverifikasi, HPP dan laba terkait tidak boleh dihitung menggunakan proporsi nominal refund. Penerapannya (disetujui 19 Okt 2026):
     - berlaku untuk ketiga mode modal (per produk, harga acuan, modal rata-rata);
     - bukti unit TikTok ketat: setiap SKU harus punya kasus retur yang valid; SKU yang tidak muncul di file retur tidak dianggap 0 unit;
     - refund penuh dan kondisi fisik barang (kembali/tidak kembali) tetap dipisahkan dari aturan ini;
     - bukti unit yang bertentangan dengan laporan penghasilan ditandai perlu dicek, bukan HPP terverifikasi.
   - Penyesuaian (kompensasi, penggantian, denda) diklasifikasikan menurut substansi transaksinya, bukan otomatis dikeluarkan dari laba. Prinsip ini sudah ditetapkan; tabel klasifikasi rinci masih usulan.
   - Bedakan margin, laba operasional, dan arus kas. Jangan menyebut salah satunya dengan nama yang lain.
6. **Jangan mengubah requirement atau keputusan produk tanpa memberi tahu pemilik.** Bila ragu, tanyakan dulu.

## 3. Persetujuan

- Perubahan file hanya boleh dilakukan **sesuai ruang lingkup tugas yang disetujui pemilik**. Ini juga berlaku untuk dokumentasi: bila pekerjaan membutuhkan pembaruan dokumen di luar ruang lingkup yang disetujui (`README.md`, `KNOWN_ISSUES.md`, `docs/*`, `CLAUDE.md`), minta izin dulu.
- Perubahan berikut harus diawali **rencana dan persetujuan pemilik** sebelum dikerjakan:
  - rumus finansial
  - parser
  - database
  - autentikasi
  - keamanan
  - pembayaran
  - arsitektur
  - perilaku fitur utama
- **Commit lokal** memerlukan izin pemilik.
- **Push ke GitHub dan deployment** memerlukan izin eksplisit untuk setiap tindakan. Push ke `main` = deploy ke produksi (GitHub Pages).
- **Jangan mengubah data produksi** (Supabase, akun pengguna, migrasi) tanpa izin.
- Sebelum implementasi: baca kode terkait, pahami dependensi, jelaskan perubahan, identifikasi risiko, lalu usulkan rencana.

## 4. Bahasa dan wording

- Semua teks untuk pengguna memakai **Bahasa Indonesia** yang sederhana dan sopan (sapaan "Anda"), tanpa jargon akuntansi atau teknis.
- Sebut **"website"** atau **"dashboard"**, jangan "aplikasi". Pengguna memakai Cek Untung di browser, tidak menginstal apa pun.
- Tombol pendaftaran: **"Daftar gratis"**. Tombol untuk pengguna yang sudah login: **"Buka dashboard"**.
- Angka rupiah memakai format `Rp1.234.567`; nilai minus ditulis `−Rp…` dengan warna biaya. Estimasi diberi label "perkiraan".

## 5. Desain

- Font tunggal: **Plus Jakarta Sans** (subset WOFF di `fonts/`). Jangan menambah font atau CDN baru.
- Warna dan ukuran memakai token di `assets/base.css` (`--bg`, `--surface`, `--ink`, `--accent`, `--cost`, …).
- Tema terang, gelap, dan ikuti perangkat (`assets/theme.js`, key `cekprofit.theme`) harus selalu berfungsi. Setiap komponen baru dicek di kedua tema.
- Wajib rapi di lebar HP **375px** tanpa scroll horizontal.
- Minimalis: satu hal yang menonjol per layar, sisanya tenang. Hindari dekorasi berlebihan dan template generik.

## 6. Arsitektur

- Situs statis di **GitHub Pages** (branch `main`, root). Tanpa build step dan tanpa framework: HTML, CSS, dan vanilla JS. Mengganti framework atau menambah build step hanya dengan alasan tertulis dan persetujuan pemilik.
- `assets/engine.js` adalah mesin hitung **murni** (tanpa DOM) dan diuji di Node. Logika perhitungan baru masuk ke sini, bukan ke `assets/app.js`.
- `assets/tarif.js` berisi tarif umum marketplace untuk simulasi. Laba **tidak** memakai tabel ini; laba memakai potongan nyata dari laporan. Tarif tidak diambil otomatis dari situs marketplace (halaman resmi dirender JS, tarif per subkategori), jadi setiap angka wajib bertanggal dan bersumber.
- `assets/penjelasan.js` berisi teks tombol "?". Setiap angka baru yang tampil ke pengguna sebaiknya diberi penjelasan.
- `assets/cloud.js` adalah klien Supabase lewat `fetch` (tanpa supabase-js).
- **Dependency:** pustaka pihak ketiga di-*vendor* ke `vendor/` dengan versi tetap. Pustaka baru harus dievaluasi dulu (perlu atau tidak, ukuran, lisensi, keamanan) dan disetujui pemilik.
- **Offline:** website harus tetap bisa memproses file tanpa internet setelah halaman terbuka (`sw.js`). Fitur akun gagal dengan sopan, tanpa menghapus sesi atau data lokal.
- **Kompatibilitas:**
  - Laporan yang sudah didukung harus tetap terbaca.
  - Kunci localStorage (`cekprofit.*`) dan bentuk JSON `user_data.settings` adalah kontrak; perubahan bentuk wajib disertai migrasi dari versi lama.
- **Skema database:** perubahan ditulis idempoten, disertai tes RLS di `supabase/tests/`, dan dijalankan oleh pemilik setelah disetujui.
- **Siap multi-toko:** struktur data baru dirancang agar bisa menampung dimensi toko dan platform, tanpa memaksakan migrasi sebelum diputuskan. Jangan menyimpan data yang tidak dibutuhkan.
- Halaman:

  | File | Isi |
  |---|---|
  | `index.html` | halaman depan |
  | `dashboard.html` | dashboard |
  | `akun.html` | masuk / daftar / profil |
  | `admin.html` | aktivasi Pro manual |
  | `privasi.html` | privasi & ketentuan |
  | `app.html` | hanya redirect ke `dashboard.html` |

- Pembayaran Pro manual: pengguna mengirim permintaan dan menghubungi lewat WhatsApp, lalu admin mengaktifkan di `admin.html` (RPC `admin_set_pro`).

## 7. Keamanan dan privasi

- Semua isi file, input pengguna, dan data dari server adalah **input tidak tepercaya**. Escape semua teks dari pengguna atau file sebelum dimasukkan ke `innerHTML`. Dilarang `eval` dan `new Function`.
- **Least privilege:**
  - RLS di setiap tabel; pengguna hanya mengakses barisnya sendiri.
  - Kolom sensitif (`pro_until`, `is_admin`) tidak bisa diubah pengguna.
  - Fungsi admin `security definer` dengan `search_path` terkunci.
- Batasan bisnis yang berdampak pendapatan (kuota gratis, status Pro) sebaiknya ditegakkan di database. Bila hanya di browser, catat sebagai keterbatasan.
- Token sesi tidak ditulis ke log.
- Data pembeli tidak dikirim ke layanan eksternal mana pun (analytics, AI, pembayaran) tanpa keputusan produk dan persetujuan pengguna. Fitur AI hanya boleh memakai ringkasan agregat dengan izin seller.

## 8. Standar kode dan pengujian

- Kode mudah dibaca dan modular; fungsi kecil dengan nama jelas. Komentar dalam Bahasa Indonesia, hanya untuk menjelaskan *mengapa*.
- Tangani error dengan pesan Bahasa Indonesia yang bisa dipahami seller, bukan pesan teknis mentah. Kegagalan menyimpan data tidak boleh diam-diam.
- Setiap perubahan pada mesin hitung atau parser **harus** disertai tes di `tests/`, mencakup:
  - definisi perhitungan yang jelas
  - kasus normal, edge case, dan regresi
  - duplikasi transaksi
  - HPP yang belum diketahui
  - refund parsial dan penuh, termasuk tidak ada penghitungan ganda HPP dengan kerugian retur
  - rekonsiliasi dengan sumber laporan
  - nilai negatif, nol, dan kosong
  - bukti bahwa hasil sebelumnya tidak rusak

  Rincian checklist dan gate per jenis perubahan: `docs/QUALITY_GATES.md`.
- Masalah di `KNOWN_ISSUES.md` hanya boleh ditandai selesai dengan bukti pengujian (nama tes, perintah, hasil).
- Jangan mengklaim sesuatu benar hanya karena kodenya jalan. Jelaskan apa yang sudah diuji dan apa yang belum (misalnya alur Supabase sungguhan hanya bisa diuji pemilik). Bila pengujian tidak bisa dilakukan, nyatakan secara eksplisit.
- Jangan menyatakan fitur selesai sebelum acceptance criteria terpenuhi.

### Pemeriksaan sebelum meminta izin commit

```bash
python3 scripts/versi.py          # perbarui ?v=<hash> semua aset + versi sw.js
node tests/engine.test.js
node tests/tarif.test.js
node tests/license.test.js
node tests/cloud.test.js          # memakai server tiruan tests/mock-supabase.js
```

- Hook `scripts/pre-commit` dan CI `.github/workflows/periksa.yml` menolak commit yang nomor versinya basi. Tujuannya mencegah halaman baru termuat bersama CSS lama dari cache browser. Hook hanya menjalankan sebagian tes; CI menjalankan semuanya.
- Untuk perubahan tampilan: cek dengan Playwright (Chromium sudah terpasang) di desktop dan 375px, tema terang dan gelap.
- Halaman baru wajib masuk daftar `PAGES` di `scripts/versi.py` dan `CORE` di `sw.js`.
- Mematikan server lokal: pakai `fuser -k PORT/tcp`, **jangan** `pkill -f` (ikut membunuh shell).
- Tes RLS database: `supabase/tests/` dijalankan di PostgreSQL lokal.

## 9. Cara bekerja dengan pemilik projek

- Jelaskan dalam **Bahasa Indonesia**. Istilah programming boleh tetap dalam bahasa aslinya.
- Pemilik sedang belajar Python, data analytics, dan software engineering. Jelaskan langkah teknis (Supabase, GitHub) dengan runtut dan konkret: apa yang diklik dan apa yang diisi.
- Untuk perubahan besar, tampilkan:
  1. pemahaman masalah
  2. rencana implementasi
  3. file yang terdampak
  4. risiko
  5. hasil implementasi dan pengujian
  6. hal yang belum diverifikasi
- Untuk perubahan kecil, cukup ringkasan hasil dan pengujian.
- Bila menemukan masalah serius, misalnya angka salah atau data terpotong, **jelaskan dulu** sebelum memperbaiki, termasuk dampaknya ke pengguna yang sudah memakai.
- Bila requirement ambigu, sebutkan ambiguitasnya sebelum implementasi.
- Setelah push yang diizinkan: beri tahu bahwa GitHub Pages butuh 1–3 menit, lalu minta refresh (Cmd+Shift+R).

## 10. Status saat ini dan yang masih menunggu

- ✅ Halaman depan, dashboard, laporan PDF, akun Supabase (schema dan RLS sudah dijalankan), admin, tema gelap/terang, versi aset otomatis.
- ✅ Jenis usaha (reseller, stok sendiri, produsen, dropshipper) dengan fitur masing-masing; tombol "?" penjelasan angka (`assets/penjelasan.js`); tarif efektif dari laporan + tabel tarif umum (`assets/tarif.js`, diperbarui manual dengan tanggal dan sumber).
- ⏳ Tarif umum di `assets/tarif.js` dicek 14 Okt 2026 dari sumber sekunder; perlu dicocokkan ulang saat marketplace mengumumkan perubahan tarif.
- ⏳ Harga Pro ditetapkan pemilik (21 Okt 2026): Rp149.000 sekali bayar (harga peluncuran; reguler yang direncanakan Rp299.000). Pembelian belum dibuka (`proPembayaranAktif: false`); nomor WhatsApp pembayaran/bantuan belum ada.
- ⏳ Supabase URL Configuration (Site URL dan Redirect URL ke domain GitHub Pages) belum dikonfirmasi.
- ⏳ Parser export pesanan Shopee dan TikTok tetap berlabel Beta (keputusan pemilik 19 Okt 2026). Export Shopee baru dicocokkan dengan satu file asli; export TikTok asli belum diuji.
- ⏳ Statistik GoatCounter belum aktif (`goatcounter: ''`).
- ⏳ Masalah akurasi, keamanan, dan teknis dari audit 14 Okt 2026: lihat `KNOWN_ISSUES.md`. Jangan klaim laba akurat pada kasus yang masih terbuka di sana.
