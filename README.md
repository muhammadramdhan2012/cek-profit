# Cek Untung

> Sebelumnya bernama Cek Profit. Repository/internal identifier tertentu masih memakai `cek-profit` / `cekprofit` untuk kompatibilitas dan belum dimigrasikan. Alamat situs dan nama repository belum diubah.

Website untuk menghitung **laba toko Shopee, TikTok Shop, dan Tokopedia dari data yang tersedia** di laporan Seller Centre, lengkap dengan bagian angka yang masih perlu dilengkapi. Hasilnya bisa disusun menjadi laporan PDF yang siap dikirim.

- Situs: https://muhammadramdhan2012.github.io/cek-profit/
- Aplikasi: https://muhammadramdhan2012.github.io/cek-profit/dashboard.html
- Contoh laporan: [contoh-laporan.pdf](contoh-laporan.pdf)

## Fitur

Pro: **Rp149.000 sekali bayar** (harga peluncuran; harga reguler yang direncanakan Rp299.000). Bukan langganan. Pembelian
belum dibuka (`proPembayaranAktif: false`).

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

## Mengatur situs (tanpa coding)

Buka `assets/config.js` di GitHub, klik ikon pensil, ubah isinya, lalu **Commit changes**:

- `whatsapp`: nomor untuk konfirmasi pembayaran Pro, misalnya `'628…'`.
- `proPembayaranAktif`: tombol beli Pro hanya aktif bila `true` **dan** `whatsapp` terisi. Biarkan `false` sampai alur
  pembayaran dan aktivasi di server (`supabase/usulan/pro-sekali-bayar.sql`) disetujui dan diuji.
- `waSupport`: nomor WhatsApp bantuan (terpisah dari pembayaran). Kosong = tombol bantuan tidak tampil.
- `prices`: harga Pro (`pro`, `proRegular` = harga reguler yang direncanakan, `proLabel`, `proUnit`).
- `goatcounter`: kode situs dari goatcounter.com (statistik tanpa cookie). Kosong berarti statistik mati.
- `publicKey`: kunci publik untuk memeriksa kode akses.
- `supabaseUrl`, `supabaseAnonKey`, `googleLogin`: pengaturan akun (lihat panduan Supabase).

## Kode akses Pro (alternatif tanpa akun)

**Tidak lagi diterbitkan** (keputusan pemilik 21 Okt 2026): Pro baru hanya berbasis akun. Kode lama yang sudah
diterbitkan tetap diterima.

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
node tests/license.test.js    # kode akses
node tests/cloud.test.js      # akun & database terhadap server tiruan
python3 -m http.server 8000   # lalu buka http://localhost:8000/dashboard.html
```

Data penjualan asli tidak disimpan di repo. Uji dengan file asli dilakukan terpisah.

## Catatan teknis penting

Sebagian file TikTok menulis ukuran tabel yang salah di dalam file Excel (`<dimension ref="A1:X19">` padahal datanya sampai baris 544). SheetJS mempercayai catatan itu dan diam-diam memotong data. `Engine.sheetsFromSheetJS` menghitung ulang rentang dari sel yang benar-benar terisi.

**Cache browser.** GitHub Pages menyuruh browser menyimpan CSS/JS sekitar 10 menit. Tanpa penanganan, halaman baru bisa termuat bersama CSS lama sehingga tampilan berantakan. Karena itu setiap file diberi nomor versi dari hash isinya (`site.css?v=44b26f4e4f`), begitu juga versi cache `sw.js`. Jalankan `python3 scripts/versi.py` sebelum commit. Hook `scripts/pre-commit` dan GitHub Actions (`.github/workflows/periksa.yml`) menolak perubahan bila nomor versinya belum diperbarui.
