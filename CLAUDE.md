# CLAUDE.md — Pedoman kerja projek Cek Profit

File ini dibaca Claude di setiap sesi. Isinya visi produk, aturan yang tidak boleh dilanggar, dan cara kerja yang diharapkan pemilik projek. Bila ada yang berubah, perbarui file ini dalam commit yang sama.

## 1. Visi produk

- **Apa:** website publik tempat seller Shopee, TikTok Shop, dan Tokopedia mengunggah laporan Seller Centre, lalu melihat **laba bersih yang sebenarnya** (penjualan − potongan marketplace − modal − packing − biaya operasional).
- **Untuk siapa:** pemilik toko online kecil–menengah di Indonesia yang tidak paham akuntansi atau Excel rumit. Mereka sibuk dan membuka website dari laptop maupun HP.
- **Masalah yang dijawab:** "Omzet saya besar, tapi uangnya ke mana?" Potongan admin, ongkir, retur, dan modal yang tidak tercatat membuat seller merasa untung padahal rugi.
- **Tujuan bisnis:** dijual sebagai layanan berbayar. Model **freemium**: gratis cukup untuk merasakan manfaat, Pro (laporan PDF, analisis semua produk, riwayat tanpa batas, ekspor) layak dibayar. Ada juga jasa "dibuatkan laporan".
- **Rasa produk:** profesional dan bisa dipercaya, tapi ramah. Modern, minimalis, enak dilihat. Seller harus merasa "ini worth dibayar".
- **Elemen khas:** "nota laba", kartu struk bergerigi yang menjadi pusat halaman depan dan ringkasan dashboard.

## 2. Aturan yang tidak boleh dilanggar

1. **File laporan dan data pembeli tidak pernah dikirim ke server.** Semua parsing dan perhitungan terjadi di browser. Cloud hanya menyimpan akun, modal, pengaturan, dan ringkasan angka.
2. **Jangan pernah memakai atau meminta Supabase `service_role` / secret key.** Di `assets/config.js` hanya boleh ada publishable/anon key. Keamanan data ditegakkan oleh RLS di `supabase/schema.sql`.
3. **Kunci privat kode akses (`*kunci-privat*.json`) dan alat pembuat kode tidak boleh masuk repo.**
4. **Angka harus jujur:**
   - Pesanan yang modalnya tidak diketahui **tidak dihitung** dan tidak dianggap nol. Porsinya ditampilkan sebagai "modal diketahui".
   - Total setiap laporan penghasilan dicocokkan dengan ringkasan resmi platform, dan selisih diberi peringatan.
   - Parser yang belum diuji dengan file asli diberi label **Beta**.
5. **Jangan mengubah requirement atau keputusan produk tanpa memberi tahu pemilik.** Bila ragu, tanyakan dulu.

## 3. Bahasa dan wording

- Semua teks untuk pengguna memakai **Bahasa Indonesia** yang sederhana dan sopan (sapaan "Anda"), tanpa jargon akuntansi atau teknis.
- Sebut **"website"** atau **"dashboard"**, jangan "aplikasi". Pengguna memakai Cek Profit di browser, tidak menginstal apa pun.
- Tombol pendaftaran: **"Daftar gratis"**. Tombol untuk pengguna yang sudah login: **"Buka dashboard"**.
- Angka rupiah memakai format `Rp1.234.567`; nilai minus ditulis `−Rp…` dengan warna biaya.

## 4. Desain

- Font tunggal: **Plus Jakarta Sans** (subset WOFF di `fonts/`). Jangan menambah font atau CDN baru.
- Warna dan ukuran memakai token di `assets/base.css` (`--bg`, `--surface`, `--ink`, `--accent`, `--cost`, …).
- Tema terang, gelap, dan ikuti perangkat (`assets/theme.js`, key `cekprofit.theme`) harus selalu berfungsi. Setiap komponen baru dicek di kedua tema.
- Wajib rapi di lebar HP **375px** tanpa scroll horizontal.
- Minimalis: satu hal yang menonjol per layar, sisanya tenang. Hindari dekorasi berlebihan dan template generik.

## 5. Arsitektur

- Situs statis di **GitHub Pages** (branch `main`, root). Tanpa build step dan tanpa framework: HTML, CSS, dan vanilla JS.
- `assets/engine.js` adalah mesin hitung **murni** (tanpa DOM) dan diuji di Node. Logika perhitungan baru masuk ke sini, bukan ke `app.js`.
- `assets/tarif.js` berisi tarif umum marketplace untuk simulasi. Laba **tidak** memakai tabel ini; laba memakai potongan nyata dari laporan. Tarif tidak diambil otomatis dari situs marketplace (halaman resmi dirender JS, tarif per subkategori), jadi setiap angka wajib bertanggal dan bersumber.
- `assets/penjelasan.js` berisi teks tombol "?". Setiap angka baru yang tampil ke pengguna sebaiknya diberi penjelasan.
- `assets/cloud.js` adalah klien Supabase lewat `fetch` (tanpa supabase-js).
- Library pihak ketiga di-*vendor* ke `vendor/` dengan versi tetap. Website harus tetap bisa memproses file tanpa internet setelah halaman terbuka (`sw.js`).
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

## 6. Standar kode

- Kode mudah dibaca dan modular; fungsi kecil dengan nama jelas. Komentar dalam Bahasa Indonesia, hanya untuk menjelaskan *mengapa*.
- Tangani error dengan pesan Bahasa Indonesia yang bisa dipahami seller, bukan pesan teknis mentah.
- Setiap perubahan pada mesin hitung atau parser **harus** disertai tes di `tests/`.
- Escape semua teks dari pengguna atau file sebelum dimasukkan ke `innerHTML`.
- Jangan mengklaim sesuatu benar hanya karena kodenya jalan. Jelaskan apa yang sudah diuji dan apa yang belum (misalnya alur Supabase sungguhan hanya bisa diuji pemilik).

## 7. Alur kerja wajib sebelum commit

```bash
python3 scripts/versi.py          # perbarui ?v=<hash> semua aset + versi sw.js
node tests/engine.test.js
node tests/tarif.test.js
node tests/license.test.js
node tests/cloud.test.js          # memakai server tiruan tests/mock-supabase.js
```

- Hook `scripts/pre-commit` dan CI `.github/workflows/periksa.yml` menolak commit yang nomor versinya basi. Tujuannya mencegah halaman baru termuat bersama CSS lama dari cache browser.
- Untuk perubahan tampilan: cek dengan Playwright (Chromium sudah terpasang) di desktop dan 375px, tema terang dan gelap.
- Halaman baru wajib masuk daftar `PAGES` di `scripts/versi.py` dan `CORE` di `sw.js`.
- Mematikan server lokal: pakai `fuser -k PORT/tcp`, **jangan** `pkill -f` (ikut membunuh shell).
- Tes RLS database: `supabase/tests/` dijalankan di PostgreSQL lokal.

## 8. Cara bekerja dengan pemilik projek

- Jelaskan dalam **Bahasa Indonesia**. Istilah programming boleh tetap dalam bahasa aslinya.
- Pemilik sedang belajar Python, data analytics, dan software engineering. Jelaskan langkah teknis (Supabase, GitHub) dengan runtut dan konkret: apa yang diklik dan apa yang diisi.
- Bila menemukan masalah serius, misalnya angka salah atau data terpotong, **jelaskan dulu** sebelum memperbaiki, termasuk dampaknya ke pengguna yang sudah memakai.
- Bila requirement ambigu, sebutkan ambiguitasnya sebelum implementasi.
- Setelah push: beri tahu bahwa GitHub Pages butuh 1–3 menit, lalu minta refresh (Cmd+Shift+R).

## 9. Status saat ini dan yang masih menunggu

- ✅ Halaman depan, dashboard, laporan PDF, akun Supabase (schema dan RLS sudah dijalankan), admin, tema gelap/terang, versi aset otomatis.
- ✅ Jenis usaha (reseller, stok sendiri, produsen, dropshipper) dengan fitur masing-masing; tombol "?" penjelasan angka (`assets/penjelasan.js`); tarif efektif dari laporan + tabel tarif umum (`assets/tarif.js`, diperbarui manual dengan tanggal dan sumber).
- ⏳ Tarif umum di `assets/tarif.js` dicek 14 Okt 2026 dari sumber sekunder; perlu dicocokkan ulang saat marketplace mengumumkan perubahan tarif.
- ⏳ Nomor WhatsApp dan harga final di `assets/config.js`. Harga sekarang masih placeholder: Rp49.000/bulan, Rp399.000/tahun, jasa Rp199.000.
- ⏳ Supabase URL Configuration (Site URL dan Redirect URL ke domain GitHub Pages) belum dikonfirmasi.
- ⏳ Parser export pesanan Shopee dan TikTok masih Beta, belum diuji dengan file asli.
- ⏳ Statistik GoatCounter belum aktif (`goatcounter: ''`).
