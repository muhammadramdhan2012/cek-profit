# Kamus Angka Cek Profit

Dokumen ini memisahkan tiga hal yang sering tercampur:

- **A. Definisi keuangan:** apa arti sebuah angka menurut keputusan pemilik projek.
- **B. Implementasi kode saat ini:** apa yang benar-benar dihitung `assets/engine.js` hari ini.
- **C. Perlu verifikasi:** hal yang belum bisa dipastikan dari kode maupun data.

Aturan pemakaian:

1. **Rumus di kode bukan definisi yang otomatis benar.** Bila B berbeda dari A yang sudah **DISETUJUI**, yang salah
   adalah kode. Catat perbedaannya di `KNOWN_ISSUES.md`. Perbaikan rumus tetap perlu rencana dan persetujuan pemilik.
   Selama definisi A belum disetujui, kode hanya boleh dinilai "sejalan dengan usulan, belum disetujui", "tidak
   sejalan dengan usulan", atau "perlu verifikasi", tidak pernah "sesuai".
2. Definisi berstatus **DIUSULKAN — BELUM DISETUJUI** tidak boleh dijadikan dasar implementasi, teks UI, atau PDF
   sebelum pemilik menyetujuinya. Setelah disetujui, ubah statusnya menjadi **DISETUJUI (tanggal)**.
3. Teks untuk pengguna (`assets/penjelasan.js`, dashboard, PDF) harus konsisten dengan definisi yang **DISETUJUI**.
4. Satuan: semua uang dalam Rupiah. Potongan dan biaya bertanda negatif, seperti di laporan marketplace.
5. **Privasi:** repository ini publik. Jangan menulis angka bisnis asli toko (nominal, jumlah pesanan/refund/produk,
   statistik operasional), data pembeli, atau nomor transaksi asli. Cukup tulis "ditemukan pada data uji pemilik".

Status persetujuan per 14 Okt 2026:
- **Sudah ditetapkan pemilik (prinsip/konsep):**
  - konsep Profit Confidence (A.16, kalimat definisinya ada di `CLAUDE.md` §1);
  - prinsip bahwa penyesuaian diklasifikasikan berdasarkan substansi transaksi, tidak otomatis dikeluarkan dari laba (A.10).
- **Belum disetujui:** semua rumus, bobot, ambang batas, dan definisi keuangan rinci lain di bagian A, termasuk tabel
  klasifikasi A.10 dan rumus A.16. Statusnya **DIUSULKAN — BELUM DISETUJUI**.

---

## A. Definisi keuangan

### A.1 Prinsip umum
Status: **DIUSULKAN — BELUM DISETUJUI**

- Data yang tidak tersedia tidak dianggap nol. Komponen yang tidak diketahui dikeluarkan dari perhitungan dan
  dilaporkan porsinya, atau dihitung sebagai rentang. Tidak boleh diisi diam-diam.
- Setiap angka menyebut **basis waktunya**:
  - **basis pesanan** (akrual): tanggal pesanan dibuat;
  - **basis kas**: tanggal dana dilepas/dicairkan.
  Dua basis tidak dicampur dalam satu angka tanpa label.
- Setiap komponen biaya hanya boleh dihitung **satu kali** (lihat A.9).

### A.2 Penjualan kotor
Status: **DIUSULKAN — BELUM DISETUJUI**

Harga barang yang dibayar pembeli sebelum refund, setelah diskon dan voucher yang ditanggung penjual. Tidak
termasuk ongkir yang dibayar pembeli (diteruskan ke kurir). Subsidi dari platform dicatat terpisah, bukan
sebagai penjualan.

### A.3 Penjualan bersih
Status: **DIUSULKAN — BELUM DISETUJUI**

Penjualan kotor − refund ke pembeli (parsial maupun penuh). Pesanan batal tidak dihitung.

### A.4 Potongan marketplace
Status: **DIUSULKAN — BELUM DISETUJUI**

Semua biaya yang dipotong marketplace dari penjualan:
- komisi atau biaya administrasi;
- biaya program (Gratis Ongkir XTRA, Promo XTRA, dll.);
- biaya proses atau pemrosesan per pesanan;
- komisi afiliasi;
- ongkir yang ditanggung penjual;
- biaya lain yang tercatat di laporan.

Kolom yang tidak dikenali tetap dihitung sebagai "biaya lain" agar total cocok dengan laporan, dan diberi peringatan
bila porsinya tidak wajar.

### A.5 Dana diterima (pendapatan bersih dari marketplace)
Status: **DIUSULKAN — BELUM DISETUJUI**

Penjualan bersih − potongan marketplace untuk pesanan tersebut, sesuai Laporan Penghasilan. Ini **bukan** arus kas
(lihat A.11): dana bisa tertahan di saldo marketplace dan belum dicairkan ke rekening.

### A.6 HPP (harga pokok penjualan)
Status: **DIUSULKAN — BELUM DISETUJUI**

Biaya perolehan barang yang **benar-benar keluar dari stok** karena terjual, sampai barang siap dijual. Contohnya:
- harga beli + biaya kulakan (penjual stok sendiri);
- harga acuan × (1 − diskon pemasok) (reseller);
- HPP produksi (produsen);
- harga supplier (dropshipper).

Tidak termasuk ongkir ke pembeli.
- Barang yang direfund dan **kembali** ke stok bukan HPP.
- Barang yang direfund tetapi **tidak kembali** tetap keluar dari stok. Dicatat sebagai **kerugian barang retur**
  (A.7), bukan dihapus.
- HPP yang tidak diketahui tidak dianggap nol (A.1).

### A.7 Kerugian barang retur
Status: **DIUSULKAN — BELUM DISETUJUI**

Biaya perolehan barang yang sudah keluar dari stok, direfund ke pembeli, dan tidak kembali dalam kondisi layak jual.
- Barang kembali dan layak jual: kerugian 0.
- Barang kembali tetapi rusak: kerugian sebesar nilai yang hilang (keputusan seller).
- Kompensasi dari marketplace atas barang hilang mengurangi kerugian ini (A.10).

### A.8 Packing dan biaya per pesanan lain
Status: **DIUSULKAN — BELUM DISETUJUI**

Biaya variabel yang dikeluarkan penjual per pesanan dan tidak tercatat di laporan marketplace, misalnya packing
atau biaya dropship.

### A.9 Aturan anti penghitungan ganda HPP dan retur
Status: **DIUSULKAN — BELUM DISETUJUI**

Untuk setiap unit barang, tepat satu dari tiga kondisi berlaku:

| Kondisi unit | Penjualan | HPP | Kerugian retur |
|---|---|---|---|
| Terjual, tidak direfund | dihitung | dihitung | 0 |
| Direfund, barang kembali layak jual | dikurangi refund | 0 | 0 |
| Direfund, barang tidak kembali | dikurangi refund | 0 | biaya perolehan unit |

Konsekuensinya:
- Satu unit tidak boleh muncul sebagai HPP **dan** kerugian retur sekaligus.
- Satu unit tidak boleh hilang dari keduanya padahal barangnya keluar dari stok.
- Refund yang tercatat di luar baris pesanan (misalnya sebagai penyesuaian setelah dana dilepas) harus dicocokkan ke
  pesanannya sebelum aturan ini diterapkan.

### A.10 Penyesuaian
Status:
- **Prinsip DITETAPKAN pemilik (14 Okt 2026):** penyesuaian diklasifikasikan berdasarkan substansi transaksi, tidak
  otomatis dikeluarkan dari laba.
- **Tabel klasifikasi di bawah: DIUSULKAN — BELUM DISETUJUI.**

Diklasifikasikan menurut **substansi transaksi**, tidak otomatis dikeluarkan dari laba:

| Substansi | Perlakuan |
|---|---|
| Kompensasi barang hilang/rusak (termasuk asuransi pengiriman) | Mengurangi kerugian barang retur |
| Penggantian biaya logistik | Mengurangi potongan marketplace |
| Refund atau koreksi atas pesanan tertentu | Dicocokkan ke pesanan itu (A.9) |
| Denda, biaya layanan tambahan | Beban, menambah potongan |
| Tidak bisa diklasifikasikan | Ditampilkan terpisah sebagai "perlu dicek", tidak dimasukkan diam-diam |

### A.11 Margin kontribusi
Status: **DIUSULKAN — BELUM DISETUJUI**

Dana diterima − HPP − kerugian barang retur − packing dan biaya per pesanan ± penyesuaian yang berkaitan dengan
pesanan. Menunjukkan sumbangan penjualan sebelum biaya tetap.

### A.12 Laba kotor (opsional, untuk laporan laba rugi)
Status: **DIUSULKAN — BELUM DISETUJUI**

Penjualan bersih − HPP − kerugian barang retur. Dalam laporan laba rugi, potongan marketplace disajikan sebagai beban
di bawah laba kotor. Hanya dipakai bila Cek Profit menampilkan format laba rugi lengkap.

### A.13 Laba operasional
Status: **DIUSULKAN — BELUM DISETUJUI**

Margin kontribusi − biaya operasional tetap pada periode yang sama: gaji, sewa, internet, dan iklan yang tidak
dipotong dari Laporan Penghasilan.

### A.14 Laba bersih
Status: **DIUSULKAN — BELUM DISETUJUI**

Laba operasional − beban di luar operasional (bunga, pajak penghasilan). Cek Profit saat ini **tidak** menghitung
bunga dan pajak. Selama itu belum ada, angka paling bawah yang ditampilkan sebaiknya disebut **laba operasional**,
bukan laba bersih (lihat B, catatan nama).

### A.15 Arus kas
Status: **DIUSULKAN — BELUM DISETUJUI**

Uang yang benar-benar masuk dan keluar rekening pada suatu periode (basis kas):
- **Kas masuk:** dana yang dicairkan dari saldo marketplace ke rekening.
- **Kas keluar:** pembelian stok (bukan HPP barang yang terjual), packing, biaya operasional yang dibayar, iklan.

Arus kas berbeda dari laba karena perbedaan waktu (dana tertahan, stok dibeli sebelum terjual), jadi keduanya tidak
boleh disamakan. Dibutuhkan laporan saldo/penarikan marketplace dan data pembelian stok.

### A.16 Profit Confidence
Status:
- **Konsep DITETAPKAN pemilik (14 Okt 2026):** kalimat definisi di bawah, juga ada di `CLAUDE.md` §1.
- **Komponen, rumus, bobot, dan ambang batas: DIUSULKAN — BELUM DISETUJUI.**

Indikator kualitas, kelengkapan, dan keterverifikasian data perhitungan laba, termasuk komponen yang belum diketahui
dan asumsi yang digunakan. **Bukan probabilitas bahwa angka laba benar.**

Calon komponen (rumus dan bobot menunggu keputusan):
- porsi penjualan yang HPP-nya diketahui;
- jumlah barang pasti vs diasumsikan;
- refund dengan atau tanpa status barang;
- rekonsiliasi file dengan ringkasan resmi;
- kelengkapan bulan;
- penyesuaian yang belum diklasifikasikan;
- parser Beta.

### A.17 Periode dan bulan lengkap
Status: **DIUSULKAN — BELUM DISETUJUI**

Laporan Penghasilan berisi pesanan yang **dananya sudah dilepas** dalam rentang tanggal tertentu. Akibatnya, pesanan
yang dibuat di akhir periode tetapi belum dilepas tidak ada di laporan.

Suatu bulan (basis pesanan) dianggap **lengkap** bila rentang dana dilepas mencakup awal bulan itu sampai
setidaknya beberapa hari setelah akhir bulan. Batas harinya perlu keputusan pemilik. Pada data uji pemilik ditemukan
jeda beberapa hari antara pesanan dan dana dilepas. Bulan yang tidak lengkap diberi label dan tidak dipakai untuk
perbandingan atau temuan.

### A.18 Tarif efektif
Status: **DIUSULKAN — BELUM DISETUJUI**

Potongan marketplace yang benar-benar terjadi, dipisah menjadi:
- bagian tetap per pesanan;
- bagian persen dari penjualan.

Dipakai untuk simulasi. Berbeda dari tarif umum (`assets/tarif.js`), yang hanya perkiraan dari sumber publik.

---

## B. Implementasi kode saat ini (`assets/engine.js`, per 14 Okt 2026, commit `a31eddb`)

Bagian ini menggambarkan apa yang **dihitung**, bukan apa yang **benar**. Selama definisi A belum disetujui, kolom
penilaian hanya memakai:
- **Sejalan dengan usulan, belum disetujui**;
- **Tidak sejalan dengan usulan**;
- **Perlu verifikasi**.

| Angka di UI | Field | Rumus saat ini | Lokasi | Penilaian terhadap usulan A |
|---|---|---|---|---|
| Penjualan | `totalSales` | Shopee: `Harga Produk + Jumlah Pengembalian Dana + voucher/cashback penjual + "Diskon Produk dari Shopee"`. TikTok: `Total Pendapatan`. | `assets/engine.js:101-102`, `assets/engine.js:472`, `assets/engine.js:536` | **Perlu verifikasi.** Mendekati penjualan bersih (A.3), tetapi perlakuan "Diskon Produk dari Shopee" dan definisi TikTok belum pasti (C.1, C.2). |
| Potongan marketplace | `totalFees` | Jumlah kolom biaya + ongkir neto; sisa terhadap `Total Penghasilan` masuk "biaya lain" | `assets/engine.js:124-130`, `assets/engine.js:184-186`, `assets/engine.js:500`, `assets/engine.js:561` | **Sejalan dengan usulan A.4, belum disetujui.** Kolom wajib belum divalidasi (KNOWN_ISSUES M8). |
| Dana diterima | `totalReceived` | Shopee `Total Penghasilan`; TikTok `Jumlah penyelesaian pembayaran`, baris "Pesanan" saja | `assets/engine.js:477`, `assets/engine.js:536` | **Sejalan dengan usulan A.5, belum disetujui.** |
| Penyesuaian | `adjustments` | **Semua** dikeluarkan dari margin, ditampilkan terpisah sebagai "kompensasi" | `assets/engine.js:499`, `assets/engine.js:528` | **Tidak sejalan** dengan prinsip yang sudah ditetapkan (klasifikasi berdasarkan substansi, A.10). Lihat KNOWN_ISSUES P3. |
| Modal barang | `totalModal` | Per produk: `modal per unit × qty × (harga+refund)/harga`; qty = 1 bila export pesanan tidak ada. Reseller: `(harga+refund) × rasio acuan`. | `assets/engine.js:445`, `assets/engine.js:455-458`, `assets/engine.js:509-512` | **Tidak sejalan dengan usulan A.6** pada kasus qty diasumsikan (H1) dan variasi (H3); sisanya perlu verifikasi. |
| Retur yang tidak kembali | `lostCertain` | Perkiraan modal kasus yang ditandai "Tidak kembali" | `assets/engine.js:601-607`, `assets/engine.js:613` | **Perlu verifikasi** terhadap A.7 dan A.9. Lihat B.1. |
| Margin (UI: "Margin kotor" / "Margin setelah modal") | `totalMargin` | `Dana diterima (pesanan bermodal) − modal − packing − retur tidak kembali` | `assets/engine.js:476`, `assets/engine.js:535`, `assets/engine.js:630` | Strukturnya mendekati **margin kontribusi** (usulan A.11), bukan laba kotor (A.12). **Perlu verifikasi**; nama di UI perlu keputusan (B.2). |
| Biaya operasional | `opex` | `biaya tetap per bulan × (hari periode ÷ 30,4)`; hari dari tanggal dana dilepas | `assets/engine.js:634-637` | **Perlu verifikasi.** Basis waktu campuran (KNOWN_ISSUES M1). |
| Laba bersih | `netProfit` | `totalMargin − opex` | `assets/engine.js:652` | Strukturnya mendekati **laba operasional** (usulan A.13). Nama "laba bersih" tidak sejalan dengan usulan A.14 karena pajak/bunga tidak dihitung. |
| Modal diketahui | `coverage` | Penjualan pesanan bermodal ÷ seluruh penjualan | `assets/engine.js:627` | **Sejalan dengan usulan A.1, belum disetujui**, tetapi tidak mencerminkan asumsi qty (H1). |
| Tarif efektif | `feeModel` | Tetap = `−biaya proses ÷ pesanan`; persen = `−(potongan − biaya proses) ÷ penjualan` | `assets/engine.js:573` | **Sejalan dengan usulan A.18, belum disetujui**; biaya logistik TikTok ikut masuk persen (L7). |
| Harga impas / target | `breakEven`, `targetPrice` | `(modal + packing per unit) ÷ (1 − persen potongan [− target])` | `assets/engine.js:582`, `assets/engine.js:754` | **Perlu verifikasi.** Tidak ada definisi A untuk angka ini; input modal per produk terdampak H3. |
| Arus kas | — | **Tidak dihitung** | — | Belum ada (A.15). |
| Profit Confidence | — | **Belum ada.** Yang ada hanya sinyal terpisah: `coverage`, `qtyAssumed`, `unknownRisk`, cek ringkasan per file. | — | Belum ada (A.16). |

### B.1 Analisis penghitungan ganda HPP dan kerugian retur (kode saat ini)

**Aliran saat ini:**
- **Pesanan dengan refund yang tercatat di baris pesanan:** modal dikurangi sebesar porsi refund
  (`share = (harga + refund) / harga`, `assets/engine.js:456`). Refund penuh membuat modal pesanan menjadi 0.
- **Kasus retur yang ditandai "Tidak kembali":** perkiraan modalnya **ditambahkan** sebagai kerugian
  (`lostCertain`, `assets/engine.js:601-613`).

**Hasil per skenario** (dibandingkan dengan usulan A.9, belum disetujui):

| Skenario | Hasil kode saat ini | Penilaian |
|---|---|---|
| Refund tercatat di baris pesanan + kasus ditandai "Tidak kembali" | Modal dikurangi, lalu kerugian ditambahkan, sehingga biaya unit dihitung sekali | Sejalan dengan usulan A.9, belum disetujui |
| Refund tercatat di baris pesanan, **file retur tidak diunggah** | Modal dikurangi, kerugian tidak pernah ditambahkan, sehingga biaya unit **hilang** dan laba terlalu besar | Tidak sejalan dengan usulan (KNOWN_ISSUES H2) |
| Refund tercatat di baris pesanan, kasus "Belum dicek" | Biaya unit hilang, hanya ditampilkan sebagai risiko | Tidak sejalan dengan usulan, tetapi diungkap sebagai risiko |
| **Refund tidak tercatat di baris pesanan** (misalnya refund setelah dana dilepas, tercatat sebagai penyesuaian) + kasus ditandai "Tidak kembali" | Modal pesanan tetap penuh **dan** kerugian ditambahkan, sehingga **HPP dihitung dua kali**. Refundnya sendiri dikeluarkan dari laba lewat penyesuaian, jadi penjualan terlalu besar. | Potensi penghitungan ganda (KNOWN_ISSUES P10) |
| Kasus retur untuk pesanan yang **tidak ada** di laporan penghasilan yang diunggah (periode lain) | Kerugian tetap dikurangkan dari periode ini tanpa penjualannya | Tidak sejalan dengan usulan; salah periode (KNOWN_ISSUES M1, P10) |
| Jumlah unit di kasus retur ≠ porsi refund di pesanan (refund parsial nominal, bukan per unit) | Kerugian memakai qty kasus, modal dikurangi porsi nominal, sehingga bisa lebih atau kurang | Perlu verifikasi (C.5) |

**Kesimpulan untuk pemilik:**
- Tidak ada penghitungan ganda pada alur normal.
- Ada **satu jalur penghitungan ganda yang mungkin terjadi** (refund setelah dana dilepas).
- Ada **satu jalur kehilangan biaya yang sudah terbukti** (refund tanpa file retur).
- Keduanya dicatat di `KNOWN_ISSUES.md`.

### B.2 Catatan nama

UI menyebut `totalMargin` sebagai "Margin kotor" atau "Margin setelah modal", dan `netProfit` sebagai "Laba bersih".
Menurut usulan A (belum disetujui), keduanya lebih tepat disebut **margin kontribusi** dan **laba operasional**.
Mengganti nama di UI adalah perubahan perilaku fitur utama dan perlu persetujuan pemilik. Keputusan 14 Okt 2026:
**nama belum diubah** (KNOWN_ISSUES M9).

---

## C. Perlu verifikasi

| # | Pertanyaan | Kenapa penting | Cara memverifikasi | Keputusan oleh |
|---|---|---|---|---|
| C.1 | Apakah "Total Pendapatan" TikTok setara dengan penjualan bersih Shopee (ongkir pembeli? subsidi platform?) | Penjualan gabungan dan margin % antarplatform bisa tidak sebanding | Cocokkan beberapa pesanan TikTok dengan rinciannya di Seller Center | Pemilik + Claude Code |
| C.2 | Arti dan tanda kolom Shopee "Diskon Produk dari Shopee" (saat ini dijumlahkan sebagai voucher) | Bisa membuat penjualan terlalu besar atau terlalu kecil | Bandingkan beberapa pesanan di Seller Centre | Pemilik |
| C.3 | Baris "Sku" di Laporan Penghasilan Shopee per produk atau per variasi | Menentukan perbaikan H3 | Ditemukan pada data uji pemilik: ada pesanan dengan lebih dari satu baris bernama sama. Perlu dicek apakah itu variasi. | Claude Code (dengan file asli) |
| C.4 | Jenis penyesuaian yang muncul dan substansinya | Dasar tabel klasifikasi A.10 | Ditemukan pada data uji pemilik: jenis TikTok "Penggantian Biaya Logistik" dan "Kompensasi asuransi pengiriman", serta penyesuaian Shopee; yang ditemukan bersifat positif | Pemilik |
| C.5 | Refund parsial: per unit atau per nominal? | Aturan A.9 untuk unit yang direfund sebagian | Cocokkan file retur dengan baris pesanan | Claude Code |
| C.6 | Apakah refund setelah dana dilepas tercatat sebagai penyesuaian atau di baris pesanan | Menentukan apakah P10 terjadi di data nyata | Cari kasus retur "Tidak kembali" yang pesanannya tidak punya refund di baris pesanan | Claude Code (dengan file asli) |
| C.7 | Batas hari untuk "bulan lengkap" (A.17) | Bulan tidak lengkap salah dibaca sebagai bulan buruk | Distribusi jeda pesanan → dana dilepas di beberapa toko | Pemilik |
| C.8 | Definisi "Penjualan" untuk Tokopedia lama (sebelum digabung TikTok) | Saat ini hanya pesanan Tokopedia yang tercatat di laporan TikTok yang didukung | Perlu contoh file | Pemilik |
