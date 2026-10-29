# Cek Untung

> Sebelumnya bernama Cek Profit. Repository/internal identifier tertentu masih memakai `cek-profit` / `cekprofit` untuk kompatibilitas dan belum dimigrasikan. Alamat situs dan nama repository belum diubah.

Website untuk menghitung **laba toko Shopee, TikTok Shop, dan Tokopedia dari data yang tersedia** di laporan Seller Centre, lengkap dengan bagian angka yang masih perlu dilengkapi. Hasilnya bisa disusun menjadi laporan PDF yang siap dikirim.

- Situs: https://muhammadramdhan2012.github.io/cek-profit/
- Aplikasi: https://muhammadramdhan2012.github.io/cek-profit/dashboard.html
- Contoh laporan: [contoh-laporan.pdf](contoh-laporan.pdf)

## Fitur

| Gratis | Pro |
|---|---|
| Nota laba: penjualan, potongan, modal, biaya operasional, laba bersih | Laporan PDF dengan nama dan logo toko |
| Grafik per bulan, bulan ini vs bulan lalu, target laba bulanan | Analisis semua produk dengan status rugi/tipis/sehat |
| Modal per produk (template Excel) atau modal rata-rata | Harga impas dan harga target per produk |
| Mode reseller (diskon dari harga acuan) | Semua temuan otomatis |
| 5 produk teratas dan 2 temuan otomatis | Ekspor Excel lengkap |
| Retur yang tidak kembali, simulator harga | Riwayat tanpa batas |
| Tema terang, gelap, atau ikuti perangkat | |
| Jenis usaha: reseller, stok sendiri, produsen (kalkulator HPP), dropshipper | |
| Tombol "?" yang menjelaskan setiap angka | |
| Tarif efektif toko dari laporan + tarif umum marketplace di simulator | |
| Akun: sinkron modal antarperangkat, 3 riwayat | |

Akun (daftar, masuk, lupa sandi, Google opsional) memakai **Supabase**; ikuti [supabase/PANDUAN.md](supabase/PANDUAN.md). Selama belum diatur, situs tetap jalan tanpa login. Pembayaran Pro manual: pengguna mengirim permintaan dari aplikasi, Anda mengaktifkan di `admin.html`.

Hal lain yang sudah disiapkan:
- Semua file diolah di browser pengguna dan tidak dikirim ke server.
- Setelah halaman terbuka, aplikasi tetap bisa dipakai tanpa internet. Pembaca Excel dan font disimpan di repo, dan ada service worker.
- Total setiap laporan penghasilan dicocokkan dengan ringkasan resmi platform.
- Pesanan yang modalnya belum diketahui **tidak dihitung**, bukan dianggap nol. Porsinya ditampilkan sebagai "modal diketahui".

## File yang dibaca

| Laporan | Status |
|---|---|
| Shopee: Laporan Penghasilan (`Summary` + `Penghasilan`) | Diuji dengan data asli |
| TikTok Shop: Laporan Penghasilan (`Detail pesanan`), termasuk pesanan Tokopedia | Diuji dengan data asli |
| Shopee: Pengembalian (`Order.return_refund…`) | Diuji dengan data asli |
| TikTok: Retur (CSV) | Diuji dengan data asli |
| Shopee: Export pesanan (jumlah, SKU, variasi) | **Beta**: dibuat dari nama kolom yang umum, belum diuji dengan file asli |
| TikTok: Export pesanan (CSV, kolom Inggris/Indonesia) | **Beta**: belum diuji dengan file asli |
| Template modal Cek Untung (`Kode`, `Modal per unit (Rp)`) | Diuji |
| Shopee: Saldo Penjual (`Transaction Report`) | **Beta** (Money Trace v1, diuji dengan satu file asli): rekonsiliasi saldo, penyesuaian, dan penarikan di Jejak uang. **Tidak dipakai dalam laba.** Penarikan hanya bukti dana keluar dari Shopee; rekonsiliasi bank belum ada |
| Tokopedia | Lewat Laporan Penghasilan TikTok Shop (kolom sumber pesanan); laporan Tokopedia terpisah belum dibaca |
| Lazada (semua laporan) | Belum didukung, memerlukan sampel file ekspor asli |
| Iklan & promosi, produk/stok (semua marketplace), saldo & pencairan TikTok, mutasi bank | Belum didukung, memerlukan sampel file ekspor asli. Pencairan dana tidak pernah dihitung sebagai penjualan |

Di dashboard, semua jenis ini tampil di **Pusat Data Marketplace** (Unggah data) per marketplace dan kategori, beserta
status dukungan, format, cara unduh (hanya yang sudah terverifikasi), dan status unggah/validasi. Hanya kategori
berstatus Didukung atau Beta yang bisa diunggah lewat kategorinya; jenis file tetap dikenali dari isinya, bukan dari
nama file. File kosong ditolak, file yang tidak sesuai kategorinya diberi tahu, dan file/baris yang sama dihitung sekali.

## Pajak Seller (Beta)

Menu **Pajak Seller** berisi kalkulator **simulasi** PPh final UMKM dan PPh Pasal 22 marketplace, serta generator Surat
Pernyataan peredaran bruto. Aktif hanya bila `pajakSeller: true` di `assets/config.js` (false = menu dan rute `#pajak`
tertutup). Isian dan identitas pajak hanya diproses di browser: tidak disimpan, tidak dikirim. Tidak berhubungan dengan pembayaran Pro.

- **Dasar aturan:** PP 55/2022 jo. PP 20/2026, PMK 37/2025 (surat sesuai Lampiran A hal. 14–15), pengumuman DJP (pemungutan
  PPh 22 berlaku 1 November 2026), FAQ PMK 37/2025.
- **Keterbatasan:** hasil adalah simulasi, bukan nasihat pajak atau bukti pajak dibayar; hanya tahun 2026; koperasi, badan lain,
  dan tarif umum belum didukung. Omzet yang diisi otomatis dari laporan adalah penjualan **setelah diskon penjual**, sedangkan
  dasar pungutan resmi dihitung sebelum diskon, jadi estimasi PPh 22 adalah perkiraan. Estimasi bergantung pada marketplace yang
  **ditunjuk ulang** DJP sebagai pemungut. Pajak tidak mengubah laporan laba. Belum ditinjau konsultan pajak.

## Mengatur situs (tanpa coding)

Buka `assets/config.js` di GitHub, klik ikon pensil, ubah isinya, lalu **Commit changes**:

- `whatsapp`: nomor untuk pembelian, misalnya `'6281234567890'`. Selama kosong, tombol beli menampilkan "kontak segera tersedia".
- `prices`: harga yang tampil di halaman depan.
- `goatcounter`: kode situs dari goatcounter.com (statistik tanpa cookie). Kosong berarti statistik mati.
- `publicKey`: kunci publik untuk memeriksa kode akses.
- `supabaseUrl`, `supabaseAnonKey`, `googleLogin`: pengaturan akun (lihat panduan Supabase).

## Kode akses Pro (alternatif tanpa akun)

- Kode ditandatangani dengan **ECDSA P-256**. Halaman hanya memegang kunci publik, jadi kode tidak bisa dipalsukan, dan masa berlaku tidak bisa diubah sendiri oleh pembeli.
- Kode dibuat dengan alat pembuat kode dan file kunci privat yang **tidak disimpan di repo ini**.
- Batasan: karena tidak ada server, orang yang paham teknis tetap bisa mengakali tampilan di browsernya sendiri. Ini kunci "jujur", bukan DRM.

## Struktur

```
index.html            halaman depan
dashboard.html              aplikasi (menu: Ringkasan, Produk, Biaya, Retur, Simulator, Riwayat, Data & modal)
akun.html             masuk, daftar, lupa sandi, profil
admin.html            admin: pengguna, permintaan upgrade, aktifkan Pro
privasi.html          privasi & ketentuan
assets/engine.js      mesin hitung murni (tanpa DOM), diuji di Node
assets/app.js         tampilan & interaksi aplikasi
assets/cloud.js       klien akun & database Supabase tanpa dependensi (fetch)
assets/report.js      laporan PDF (dicetak lewat browser)
assets/license.js     pemeriksaan kode akses
assets/demo.js        data contoh fiktif
assets/config.js      pengaturan situs
assets/theme.js       pilihan tema terang/gelap/ikuti perangkat
supabase/schema.sql   tabel, aturan keamanan (RLS), fungsi admin
supabase/tests/       uji aturan keamanan di PostgreSQL
vendor/               SheetJS 0.18.5 (Apache-2.0)
fonts/                Plus Jakarta Sans (OFL), subset Latin
sw.js                 service worker (offline)
tests/                uji Node + server tiruan Supabase
```

## Menjalankan uji

```bash
node tests/engine.test.js     # mesin hitung dengan data contoh
node tests/saldo.test.js      # Money Trace Shopee v1 (saldo penjual), data sintetis
node tests/license.test.js    # kode akses
node tests/cloud.test.js      # akun & database terhadap server tiruan
python3 -m http.server 8000   # lalu buka http://localhost:8000/dashboard.html
```

Data penjualan asli tidak disimpan di repo. Uji dengan file asli dilakukan terpisah.

## Catatan teknis penting

Sebagian file TikTok menulis ukuran tabel yang salah di dalam file Excel (`<dimension ref="A1:X19">` padahal datanya sampai baris 544). SheetJS mempercayai catatan itu dan diam-diam memotong data. `Engine.sheetsFromSheetJS` menghitung ulang rentang dari sel yang benar-benar terisi.

**Cache browser.** GitHub Pages menyuruh browser menyimpan CSS/JS sekitar 10 menit. Tanpa penanganan, halaman baru bisa termuat bersama CSS lama sehingga tampilan berantakan. Karena itu setiap file diberi nomor versi dari hash isinya (`site.css?v=44b26f4e4f`), begitu juga versi cache `sw.js`. Jalankan `python3 scripts/versi.py` sebelum commit. Hook `scripts/pre-commit` dan GitHub Actions (`.github/workflows/periksa.yml`) menolak perubahan bila nomor versinya belum diperbarui.
