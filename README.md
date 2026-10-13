# Cek Profit

Alat web untuk menghitung **laba sebenarnya toko Shopee, TikTok Shop, dan Tokopedia** dari laporan Seller Centre. Hasilnya bisa disusun menjadi laporan PDF yang siap dikirim.

- Situs: https://muhammadramdhan2012.github.io/cek-profit/
- Aplikasi: https://muhammadramdhan2012.github.io/cek-profit/app.html
- Contoh laporan: [contoh-laporan.pdf](contoh-laporan.pdf)

## Fitur

| Gratis | Pro (kode akses) |
|---|---|
| Penjualan, potongan platform, margin, dan laba bersih | Laporan PDF dengan nama dan logo toko |
| Grafik per bulan, per platform, dan per nilai pesanan | Analisis semua produk dengan status rugi/tipis/sehat |
| Modal per produk (template Excel) atau modal rata-rata | Harga impas dan harga target per produk |
| Mode reseller (diskon dari harga acuan) | Semua temuan otomatis |
| 5 produk teratas dan 2 temuan otomatis | Ekspor Excel lengkap |
| Retur yang tidak kembali, simulator harga | |

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
| Template modal Cek Profit (`Kode`, `Modal per unit (Rp)`) | Diuji |

## Mengatur situs (tanpa coding)

Buka `assets/config.js` di GitHub, klik ikon pensil, ubah isinya, lalu **Commit changes**:

- `whatsapp`: nomor untuk pembelian, misalnya `'6281234567890'`. Selama kosong, tombol beli menampilkan "kontak segera tersedia".
- `prices`: harga yang tampil di halaman depan.
- `goatcounter`: kode situs dari goatcounter.com (statistik tanpa cookie). Kosong berarti statistik mati.
- `publicKey`: kunci publik untuk memeriksa kode akses.

## Kode akses Pro

- Kode ditandatangani dengan **ECDSA P-256**. Halaman hanya memegang kunci publik, jadi kode tidak bisa dipalsukan, dan masa berlaku tidak bisa diubah sendiri oleh pembeli.
- Kode dibuat dengan alat pembuat kode dan file kunci privat yang **tidak disimpan di repo ini**.
- Batasan: karena tidak ada server, orang yang paham teknis tetap bisa mengakali tampilan di browsernya sendiri. Ini kunci "jujur", bukan DRM.

## Struktur

```
index.html          halaman depan
app.html            aplikasi
privasi.html        privasi & ketentuan
assets/engine.js    mesin hitung murni (tanpa DOM), diuji di Node
assets/app.js       tampilan & interaksi
assets/report.js    laporan PDF (dicetak lewat browser)
assets/license.js   pemeriksaan kode akses
assets/demo.js      data contoh fiktif
assets/config.js    pengaturan situs
vendor/             SheetJS 0.18.5 (Apache-2.0)
fonts/              Bricolage Grotesque & Plus Jakarta Sans (OFL), subset Latin
sw.js               service worker (offline)
tests/              uji Node
```

## Menjalankan uji

```bash
node tests/engine.test.js     # mesin hitung dengan data contoh
node tests/license.test.js    # kode akses
python3 -m http.server 8000   # lalu buka http://localhost:8000/app.html
```

Data penjualan asli tidak disimpan di repo. Uji dengan file asli dilakukan terpisah.

## Catatan teknis penting

Sebagian file TikTok menulis ukuran tabel yang salah di dalam file Excel (`<dimension ref="A1:X19">` padahal datanya sampai baris 544). SheetJS mempercayai catatan itu dan diam-diam memotong data. `Engine.sheetsFromSheetJS` menghitung ulang rentang dari sel yang benar-benar terisi.

Setiap rilis, naikkan `VERSION` di `sw.js` agar cache lama di browser pengguna dibersihkan.
