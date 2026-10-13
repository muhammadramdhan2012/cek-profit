# Cek Profit Marketplace

Alat web untuk menghitung **profit toko Shopee dan TikTok Shop** dari laporan yang diunduh di Seller Centre.

🔗 **Coba langsung:** https://muhammadramdhan2012.github.io/cek-profit/

## Yang dihitung

- Potongan platform (biaya admin, komisi, layanan, ongkir) dalam Rupiah dan persen
- Modal/HPP dari harga acuan pemasok dan diskon pemasok yang diatur pengguna
- Margin per platform, per bulan, dan per produk (Shopee)
- Ringkasan retur dan refund, termasuk buku yang tidak kembali
- Pemeriksaan otomatis: total dicocokkan dengan ringkasan resmi Shopee/TikTok, dan file yang terunggah dua kali tidak dihitung dobel

## File yang didukung

| Platform | Laporan |
|---|---|
| Shopee | Laporan Penghasilan (sheet *Summary* + *Penghasilan*) |
| Shopee | Pengembalian Barang/Dana (`Order.return_refund…`) |
| TikTok Shop | Laporan Penghasilan (`income_…`, sheet *Detail pesanan*) |
| TikTok Shop | Retur (CSV *Pesanan yang Barang/Dananya Dikembalikan*) |

## Privasi

Semua file diolah **di browser pengguna**. Tidak ada data yang dikirim ke server atau disimpan. Halaman hanya menyimpan pengaturan modal di browser masing-masing.

## Batasan

- Hasil adalah **estimasi**, bukan laba bersih: biaya packing (opsional diisi), transport, dan waktu kerja belum lengkap.
- Shopee tidak mencatat harga sebelum diskon, sehingga modal Shopee dihitung dari pola harga yang diisi pengguna.
- Laporan TikTok tidak memuat nama produk, jadi rincian produk hanya untuk Shopee.
- Format laporan marketplace bisa berubah; parser perlu diperbarui jika itu terjadi.

## Teknis

Satu file `index.html` (HTML, CSS, JavaScript tanpa framework). File Excel dibaca dengan [SheetJS](https://sheetjs.com/) di browser. Logika perhitungan diuji dengan data penjualan nyata Shopee dan TikTok Shop (Jan–Okt 2026) dan hasilnya cocok dengan ringkasan resmi kedua platform.
