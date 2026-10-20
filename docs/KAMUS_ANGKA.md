# Kamus Angka Cek Untung

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

Status persetujuan per 14 Okt 2026 (diperbarui 19 Okt 2026):
- **Sudah ditetapkan pemilik (prinsip/konsep):**
  - konsep Profit Confidence (A.16, kalimat definisinya ada di `CLAUDE.md` §1);
  - prinsip bahwa penyesuaian diklasifikasikan berdasarkan substansi transaksi, tidak otomatis dikeluarkan dari laba (A.10);
  - empat prinsip kuantitas (A.19.1);
  - aturan pencocokan M0–M2 revisi sebagai **dasar desain** (A.19.4), pemisahan status kuantitas dan variasi (A.19.5),
    dan SKU opsional (A.19.6);
  - aturan resmi 19 Okt 2026: **nominal refund tidak boleh digunakan untuk menentukan jumlah unit HPP**; bila jumlah unit
    pada refund parsial tidak dapat diverifikasi, HPP dan laba terkait tidak dihitung dengan proporsi nominal refund
    (A.19.1, beserta penerapannya yang diterima pemilik).
- **Belum disetujui:** semua rumus, bobot, ambang batas, aturan pencocokan, dan definisi keuangan rinci lain di bagian A,
  termasuk tabel klasifikasi A.10, rumus A.16, dan detail A.19.2–A.19.4. Statusnya **DIUSULKAN — BELUM DISETUJUI**.

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

Catatan: perlakuan **PPh 22** dan kolom pajak lain di Laporan Penghasilan **belum ditetapkan**. Pajak tidak boleh
ditetapkan sebagai potongan marketplace final maupun pajak dibayar di muka sebelum klasifikasi dan ketentuan pajaknya
diverifikasi (C.9; KNOWN_ISSUES M11).

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
- Jumlah unit untuk HPP **tidak boleh** diturunkan dari nominal refund (aturan resmi, A.19.1).

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
- Unit yang direfund ditentukan dari field jumlah (export pesanan/file retur), bukan dari nominal refund (A.19.1). Bila
  unitnya tidak diketahui, kondisi unit belum bisa dipilih, sehingga HPP pesanan itu belum terselesaikan.

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
di bawah laba kotor. Hanya dipakai bila Cek Untung menampilkan format laba rugi lengkap.

### A.13 Laba operasional
Status: **DIUSULKAN — BELUM DISETUJUI**

Margin kontribusi − biaya operasional tetap pada periode yang sama: gaji, sewa, internet, dan iklan yang tidak
dipotong dari Laporan Penghasilan.

### A.14 Laba bersih
Status: **DIUSULKAN — BELUM DISETUJUI**

Laba operasional − beban di luar operasional (bunga, pajak penghasilan). Cek Untung saat ini **tidak** menghitung
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

### A.19 Kuantitas terjual dan status unit

#### A.19.1 Prinsip
Status: **DITETAPKAN pemilik (14 Okt 2026)**

1. Kuantitas yang tidak diketahui **tidak boleh diam-diam dianggap 1** (atau angka lain).
2. HPP per unit dikalikan dengan **kuantitas yang relevan dan terverifikasi**.
3. Unit yang sama **tidak boleh dibebankan dua kali** sebagai HPP dan kerugian retur.
4. Kuantitas menjadi salah satu **komponen kelengkapan data Profit Confidence**, tanpa skor numerik dahulu.

Keputusan tampilan pemilik (14 Okt 2026), bila kuantitas belum tersedia:
- Sistem boleh menampilkan simulasi sementara dengan asumsi minimum 1 unit, **hanya bila asumsi itu dapat dibenarkan**.
- Angka itu diberi label **"Estimasi sementara — kuantitas belum terverifikasi"**.
- Angka itu bukan laba final, dan tidak disebut batas atas yang pasti bila refund, penyesuaian, atau komponen material
  lain belum lengkap.
- Sistem menampilkan kebutuhan mengunggah export pesanan Shopee.

Keputusan refund pemilik (14 Okt 2026):
- Kuantitas dan status barang diprioritaskan dari data retur yang dapat diverifikasi.
- Nominal refund **tidak** otomatis diubah menjadi jumlah unit tanpa aturan yang disetujui.
- Refund uang, barang kembali ke stok, dan barang tidak kembali **dibedakan**.
- Refund penuh atau nilai penjualan bersih nol **tidak membuktikan** bahwa kuantitas barang nol atau HPP nol.
  Ada refund **tidak berarti** barang kembali.

Aturan resmi pemilik (19 Okt 2026, H2-B3b). Status: **DITETAPKAN pemilik**

> **Nominal refund tidak boleh digunakan untuk menentukan jumlah unit HPP.**

1. Jumlah unit yang direfund **diketahui** → HPP memakai unit itu (modal per unit × unit terjual bersih).
2. Jumlah unit **tidak diketahui** → HPP dan laba pesanan itu **belum terselesaikan**: pesanan tidak dihitung dalam laba,
   tidak dianggap 0, tidak dihitung pro-rata menurut nominal, dan tidak dianggap 1 unit.
3. Penjualan dan refund (uang) tetap mengikuti laporan marketplace; aturan ini hanya menyangkut HPP.
4. Kondisi fisik barang (kembali, tidak kembali, belum diketahui) tetap konsep terpisah (A.7, A.9).

Penerapan yang diterima pemilik (19 Okt 2026):
- Berlaku sama untuk **ketiga mode modal**: modal per produk, harga acuan (reseller), dan modal rata-rata. Harga acuan dan
  modal rata-rata dihitung dari nilai penjualan, bukan per unit, jadi pesanan refund parsial di kedua mode itu selalu
  belum terselesaikan, walaupun unitnya diketahui.
- Refund penuh tetap memakai perilaku lama (HPP penjualan 0, risiko kondisi fisik dicatat terpisah). Refund penuh tidak
  memerlukan konversi nominal ke unit.
- TikTok: unit refund hanya dianggap terbukti bila **setiap** SKU di rincian pesanan punya kasus retur (bukan "batal")
  dengan jumlah yang valid, semua kasus menunjuk SKU yang ada di rincian, dan totalnya lebih kecil dari seluruh unit.
  SKU yang tidak muncul di file retur **tidak** dianggap 0 unit refund.
- Bila sumber unit menyebut **seluruh** unit direfund, padahal laporan penghasilan menunjukkan refund parsial (masih ada
  nilai tersisa), kedua sumber bertentangan. Pesanan ditandai **perlu dicek** dan HPP-nya tidak pernah dianggap
  terverifikasi.

#### A.19.2 Jenis kuantitas yang harus dibedakan
Status: **DIUSULKAN — BELUM DISETUJUI**

| Kuantitas | Arti | Sumber yang diusulkan |
|---|---|---|
| Dipesan | Unit yang dipesan pembeli | Export pesanan; TikTok: Detail produk terjual |
| Dikirim | Unit yang benar-benar keluar dari stok | Perlu verifikasi (status pesanan, file retur kategori "tidak dikirim") |
| Direfund | Unit yang uangnya dikembalikan | File retur (jumlah produk dikembalikan); **bukan** hasil konversi nominal refund |
| Kembali ke stok | Unit yang diterima kembali dalam kondisi layak jual | File retur + konfirmasi seller |
| Hilang / tidak kembali | Unit yang sudah dikirim, direfund, dan tidak kembali | File retur + konfirmasi seller |

HPP dan kerugian retur per unit ditentukan dari kombinasi kuantitas ini (A.6, A.7, A.9). Perlakuan finansial akhirnya
**menunggu investigasi H2**.

#### A.19.3 Urutan sumber kuantitas dan status
Status: **DIUSULKAN — BELUM DISETUJUI**

1. TikTok/Tokopedia: kolom "Detail produk terjual" di Laporan Penghasilan.
2. Export pesanan (Shopee/TikTok) yang cocok dengan pesanan tersebut (A.19.4).
3. Bila tidak ada: status **belum terverifikasi**. Boleh memakai estimasi minimum 1 unit berlabel (A.19.1) **hanya**
   bila baris produk itu jelas mewakili barang yang terjual dan belum direfund penuh. Untuk baris yang direfund penuh,
   tidak ada asumsi kuantitas maupun HPP. Statusnya belum terverifikasi sampai data retur atau H2 memutuskan.

Status kuantitas hanya dua: **terverifikasi** atau **belum terverifikasi**. Estimasi selalu belum terverifikasi.

#### A.19.4 Aturan pencocokan Shopee (Laporan Penghasilan ↔ export pesanan)
Status:
- **Revisi M0–M2 DISETUJUI pemilik sebagai dasar desain (14 Okt 2026).** Pencocokan dinyatakan terverifikasi hanya
  bila tidak ambigu. Implementasi kode belum diizinkan.
- **M3 dan toleransi ±Rp1: DIUSULKAN — BELUM DISETUJUI.** Toleransi didukung hasil validasi; M3 belum teruji.

Dasar bukti: validasi baca-saja satu bulan export pesanan Shopee "pesanan selesai" dan Laporan Penghasilan periode
yang sama (data uji pemilik). Rinciannya di `KNOWN_ISSUES.md` (H1, H3). Angka bisnis tidak dicatat.

Fakta yang terbukti untuk file yang diuji:
- Baris produk Laporan Penghasilan dibuat **per variasi**, tanpa nama variasi; ID produk sama untuk semua variasi.
- Subtotal export = jumlah × harga setelah diskon. Untuk pasangan yang tidak ambigu, `Harga Produk` = subtotal export.
- Urutan baris tidak konsisten antara kedua file.
- Export "pesanan selesai" tidak memuat pesanan batal atau refund penuh.

Aturan:
- **Syarat dasar:** nomor pesanan sama. Pencocokan tidak pernah lintas pesanan.
- Kecocokan nama atau nominal saja tidak cukup bila masih ada ambiguitas. Ambiguitas berarti status belum terverifikasi.
- **Urutan baris tidak dipakai** untuk menebak variasi.
- **M0:** pesanan tidak ada di export → kuantitas dan variasi belum terverifikasi.
- **M1:** satu baris produk penghasilan untuk satu nama ↔ satu baris export bernama sama **dan** `Harga Produk` sama
  dengan subtotal export → kuantitas dan variasi terverifikasi.
- **M2:** beberapa baris produk penghasilan bernama sama ↔ baris export bernama sama, dipasangkan lewat nilai (subtotal):
  - pasangan **unik** → kuantitas dan variasi terverifikasi;
  - nilai **kembar** (variasi berharga sama) → kuantitas terverifikasi **hanya bila** semua kandidat bernilai sama punya
    jumlah yang sama; variasi **ambigu**.
- **M3 (usulan):** nama berbeda, hanya bila pesanan punya tepat satu baris produk dan nilai totalnya cocok.
- **M4:** baris export yang tidak terpakai tidak dipakai untuk pesanan lain.
- Toleransi nilai **±Rp1** (usulan).

#### A.19.5 Status kuantitas, status variasi, dan HPP terverifikasi
Status: **DITETAPKAN pemilik (14 Okt 2026)**

- Status **kuantitas** (terverifikasi / belum terverifikasi) dan status **variasi** (terverifikasi / ambigu / tidak
  relevan) dicatat dan ditampilkan **terpisah**.
- Bila kuantitas diketahui tetapi variasi ambigu, keduanya ditampilkan dengan statusnya masing-masing.
- **HPP terverifikasi hanya bila** pemetaan modalnya benar, **atau** semua kandidat variasi punya HPP per unit yang sama
  (menurut isian seller).
- Tidak boleh mengasumsikan semua variasi ber-HPP sama. Bila HPP kandidat berbeda atau belum diisi, HPP berstatus
  "variasi belum terverifikasi".
- Refund atau `Returned quantity` **tidak** membuktikan barang kembali ke stok (lihat A.19.1, A.19.2, C.10).

#### A.19.6 SKU opsional dan kunci modal
Status:
- **Prinsip DITETAPKAN pemilik (14 Okt 2026):** SKU **opsional**. Cek Untung harus tetap bekerja untuk seller yang tidak
  mengisi SKU, dan untuk seller dengan struktur modal dan diskon yang berbeda-beda.
- **Urutan kunci di bawah: DIUSULKAN — BELUM DISETUJUI.**

Usulan urutan kunci untuk mencari modal per baris:
1. SKU, bila diisi seller (kolom SKU yang **terisi**, bukan sekadar ada);
2. nama produk + nama variasi;
3. nama produk;
4. ID produk (kompatibilitas modal lama).

Catatan:
- Modal per variasi harus bisa diisi tanpa SKU.
- Mode reseller memakai diskon pemasok dari **isian seller**. Tidak ada nilai diskon yang di-hardcode.
- Struktur modal lain (stok sendiri, produsen, dropshipper) tetap didukung.

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
| Modal barang | `totalModal` | Per produk: `modal per unit × qty × (harga+refund)/harga`; qty = 1 bila export pesanan tidak ada; bila export ada, baris variasi bernama sama terhitung ganda (KNOWN_ISSUES H1/H3). Reseller: `(harga+refund) × rasio acuan`. | `assets/engine.js:445`, `assets/engine.js:455-458`, `assets/engine.js:509-512` | **Tidak sejalan dengan usulan A.6** pada kasus qty diasumsikan (H1) dan variasi (H3); sisanya perlu verifikasi. |
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
- **Pesanan dengan refund yang tercatat di baris pesanan:** refund penuh membuat modal pesanan menjadi 0 (rumus lama
  `share`). **Sejak H2-B3b (19 Okt 2026)** refund parsial tidak lagi memakai `share`: modal = modal per unit × unit
  terjual bersih bila unitnya terbukti (buku unit Shopee, file retur TikTok); selain itu HPP tidak diketahui dan
  pesanan dikeluarkan dari laba dengan alasan `refund_parsial_unit_tidak_diketahui`.
- **Kasus retur yang ditandai "Tidak kembali":** perkiraan modalnya **ditambahkan** sebagai kerugian
  (`lostCertain`, `assets/engine.js:601-613`).

**Hasil per skenario** (dibandingkan dengan usulan A.9, belum disetujui):

| Skenario | Hasil kode saat ini | Penilaian |
|---|---|---|
| Refund tercatat di baris pesanan + kasus ditandai "Tidak kembali" | Modal dikurangi, lalu kerugian ditambahkan, sehingga biaya unit dihitung sekali | Sejalan dengan usulan A.9, belum disetujui |
| Refund tercatat di baris pesanan, **file retur tidak diunggah** | Refund penuh: modal 0, kerugian tidak pernah ditambahkan; risikonya diungkap sebagai refund tanpa catatan fisik (H2-B3a). Refund parsial tanpa unit: sejak H2-B3b pesanan dikeluarkan dari laba, bukan dipotong menurut nominal | Refund penuh: diungkap sebagai risiko, belum terselesaikan (KNOWN_ISSUES H2). Refund parsial: sejalan dengan aturan resmi A.19.1 |
| Refund tercatat di baris pesanan, kasus "Belum dicek" | Biaya unit hilang, hanya ditampilkan sebagai risiko | Tidak sejalan dengan usulan, tetapi diungkap sebagai risiko |
| **Refund tidak tercatat di baris pesanan** (misalnya refund setelah dana dilepas, tercatat sebagai penyesuaian) + kasus ditandai "Tidak kembali" | Modal pesanan tetap penuh **dan** kerugian ditambahkan, sehingga **HPP dihitung dua kali**. Refundnya sendiri dikeluarkan dari laba lewat penyesuaian, jadi penjualan terlalu besar. | Potensi penghitungan ganda (KNOWN_ISSUES P10) |
| Kasus retur untuk pesanan yang **tidak ada** di laporan penghasilan yang diunggah (periode lain) | Kerugian tetap dikurangkan dari periode ini tanpa penjualannya | Tidak sejalan dengan usulan; salah periode (KNOWN_ISSUES M1, P10) |
| Jumlah unit di kasus retur ≠ porsi refund di pesanan (refund parsial nominal, bukan per unit) | Sejak H2-B3b: modal memakai unit dari field jumlah, bukan porsi nominal. Bila bukti unit menyebut seluruh unit direfund padahal refund parsial, pesanan ditandai konflik dan dikeluarkan dari laba | Sejalan dengan aturan resmi A.19.1 |

**Kesimpulan untuk pemilik:**
- Tidak ada penghitungan ganda pada alur normal.
- Ada **satu jalur penghitungan ganda yang mungkin terjadi** (refund setelah dana dilepas).
- Ada **satu jalur kehilangan biaya yang sudah terbukti** (refund tanpa file retur).
- Keduanya dicatat di `KNOWN_ISSUES.md`.

### B.1a Metadata refund parsial (`kepastian.cakupan`, H2-B3b)

Tiga hitungan yang berbeda arti. Semuanya hanya metadata (tidak dipakai menghitung angka lain), per marketplace dan
gabungan.

| Simbol | Field | Arti |
|---|---|---|
| A | `refundParsialDitemukan` | Semua pesanan refund parsial yang **ditemukan** (ada refund, nilai tersisa > 0), apa pun perlakuannya |
| B | `refundParsialTanpaUnit` | Pesanan **refund parsial** (definisi yang sama dengan A, jadi B selalu bagian dari A) yang labanya **masih memakai porsi nominal refund** sebagai pengganti unit. Refund bernilai positif (anomali) bukan refund parsial. Nama field dipertahankan untuk kompatibilitas. Sejak H2-B3b nilainya diharapkan **0**; angka > 0 berarti ada jalur yang lolos dari aturan A.19.1 |
| C | `dikeluarkan.refundParsial` | Pesanan yang **dikeluarkan dari laba** karena unit refund parsial tidak diketahui. `konflik`/`penjualanKonflik` = bagian dari C yang bukti unitnya bertentangan dengan laporan penghasilan. Konflik hanya dinilai bila HPP pesanan memakai modal per unit (Shopee: per baris bermodal per unit; TikTok: semua baris pesanan bermodal per unit); di mode harga acuan dan modal rata-rata unit tidak dipakai, jadi pesanan tercatat sebagai C biasa |

Hubungannya: A = B + C + pesanan yang dihitung dengan unit yang terbukti + pesanan yang dikeluarkan karena alasan lain
(misalnya modal belum diisi atau laporan tidak mencantumkan produk). Diuji di `tests/engine.test.js` (B3b-13 s.d.
B3b-16).

### B.1b Jejak uang / Money Trace A1 (`r.jejakUang`, 20 Okt 2026)

Status: **implementasi kode saat ini** (bukan definisi yang disetujui; A.2–A.5 tetap DIUSULKAN). A1 tidak menambah
rumus penjualan, potongan, dana, HPP, atau laba. Yang baru hanya agregat refund sebagai **rincian** dan status
rekonsiliasi tiap angka. Semua field berikut metadata.

| Komponen | Shopee (Laporan Penghasilan) | TikTok Shop (Laporan Penghasilan) | Basis tanggal |
|---|---|---|---|
| Penjualan sesuai laporan | `Harga Produk + Jumlah Pengembalian Dana ke Pembeli + voucher penjual` = `S.sales`; dicocokkan dengan "1. Total Pendapatan" (Summary) | `Total Pendapatan` baris pesanan = `T.sales`; dicocokkan dengan sheet Laporan | tanggal pesanan |
| Refund (rincian) | kolom `Jumlah Pengembalian Dana ke Pembeli` (≤ 0); dicocokkan dengan baris yang sama di Summary | kolom `Total pengembalian dana setelah diskon` (≤ 0); identitas per baris: `Subtotal setelah diskon penjual + refund = Total Pendapatan` | tanggal pesanan |
| Potongan marketplace | jumlah kolom biaya (termasuk sisa "biaya lain") = `S.feeTotal`; dicocokkan dengan "2. Total Pengeluaran" | `Total Biaya` = `T.feeTotal`; dicocokkan dengan sheet Laporan | tanggal pesanan |
| Dana pesanan dilepas | `Total Penghasilan` = `S.received`; dicocokkan dengan "3. Total yang Dilepas" | `Jumlah penyelesaian pembayaran` baris pesanan = `T.received`; dana pesanan + penyesuaian dicocokkan dengan sheet Laporan | tanggal pesanan |
| Penyesuaian (terpisah, tidak masuk laba) | sheet Adjustment, `Biaya Penyesuaian` = `S.adj`; dicocokkan dengan "Total Penyesuaian" | baris selain "Pesanan" = `T.adj` | Shopee: tanggal penyesuaian; TikTok: waktu pembayaran |
| Pencairan ke rekening | belum diproses | belum diproses | — |

**Refund tidak dihitung dua kali.** Di kedua marketplace refund sudah termasuk di penjualan (dibuktikan pada data uji
pemilik, agregat saja: Shopee Σ refund = baris Summary dan Summary "Subtotal Pesanan" = Σ(harga + refund); TikTok
identitas per baris berlaku 100% di 4 file dan Σ refund = sheet Laporan). Karena itu refund hanya ditampilkan sebagai
rincian "sudah termasuk penjualan" dan tidak pernah dikurangkan lagi. Jumlah pesanan refund dibagi penuh (pesanan
tidak terhitung terjual, sama dengan dasar `orders`) dan sebagian.

**Status** (dari terlemah, per komponen per marketplace; gabungan = status terlemah):

| Status | Arti |
|---|---|
| `perlu_dicek` | ringkasan resmi ada tetapi tidak cocok (toleransi Rp1 per file), jumlah gabungan file ≠ angka yang ditampilkan, refund bernilai positif, atau identitas refund TikTok tidak berlaku |
| `belum_tersedia` | kolom tidak ada → nilai NaN (bukan Rp0). Pencairan selalu di status ini pada A1 |
| `berdasarkan_laporan` | angka dari laporan tetapi belum bisa dicocokkan penuh: ringkasan resmi tidak ada, filter bulan aktif, beberapa file memuat pesanan yang sama, baris non-pesanan TikTok ikut dalam ringkasan, atau kolom subtotal setelah diskon TikTok tidak ada |
| `terekonsiliasi` | setiap file cocok dengan ringkasannya **dan** jumlah gabungan file = angka yang ditampilkan |

File yang isinya identik dengan file sebelumnya (unggah ulang) diabaikan dalam pemeriksaan. Status bukan skor
keyakinan dan bukan bukti bahwa laba benar.

**Keterbatasan A1:** pencairan dana dan saldo marketplace belum dibaca (laporan saldo dan riwayat penarikan tidak
diproses); dana dilepas ≠ dana masuk rekening; filter bulan selalu menurunkan status karena ringkasan resmi mencakup
seluruh periode file; periode Laporan Penghasilan mengikuti tanggal dana dilepas/dibayar sedangkan angka dikelompokkan
menurut tanggal pesanan; voucher Shopee bernilai bukan nol belum ada di data uji (C.2); penyesuaian tetap di luar laba
(A.10, KNOWN_ISSUES P3). Diuji di `tests/engine.test.js` (MT-A1) dan `tests/tampilan.test.js` (MT-A1).

### B.1c Refund dan biaya susulan TikTok (R4, disetujui pemilik 20 Okt 2026)

Status: **aturan R4 disetujui pemilik**; penerapan dari aturan resmi A.19.1 (refund parsial, 19 Okt 2026).

TikTok kadang mencatat refund atau biaya setelah dana pesanan dilepas sebagai **baris "Pesanan" kedua dengan ID
pesanan yang sama**. Ciri baris susulan: `Subtotal sebelum diskon` = 0 dan `Total Pendapatan` ≤ 0. Ditemukan pada data
uji pemilik (agregat): 4 refund susulan parsial dan 1 biaya logistik susulan, semuanya dengan pesanan asal di file
yang sama.

| Aturan | Penerapan |
|---|---|
| Angka laporan | Baris susulan tetap masuk penjualan, refund, potongan, dan dana apa adanya (tidak dihapus, tidak menjadi penjualan baru) |
| Pencocokan | Ke pesanan asal dengan ID pesanan yang sama dan `Subtotal sebelum diskon` > 0. Harus tepat satu baris asal; antarfile juga dicocokkan |
| HPP | Pesanan asal + semua susulannya dinilai sebagai **satu pesanan**: `Subtotal sebelum diskon` setelah refund digabung, lalu aturan H2-B3b berlaku di ketiga mode modal |
| Refund parsial | Unit hanya dari file retur (setiap SKU harus punya kasus valid). Tanpa bukti → HPP pesanan tidak diketahui, pesanan keluar dari laba. Mode harga acuan dan modal rata-rata tidak memakai unit, jadi selalu tidak diketahui. Nominal refund tidak pernah dipakai |
| Refund penuh | Sama dengan refund penuh di baris asal: tidak terhitung terjual, HPP 0, kondisi fisik barang dicatat terpisah (tidak ditebak) |
| Baris susulan | HPP 0 bila pesanan asal bermodal, tidak diketahui bila tidak. Tidak dihitung sebagai pesanan baru (jumlah pesanan, cakupan) |
| Tanpa pesanan asal | Refund susulan → HPP tidak diketahui, alasan `refund_susulan_tanpa_pesanan_asal`. Biaya susulan tanpa pesanan asal → perilaku lama |
| Biaya susulan | Biaya sah sesuai laporan (mengurangi dana dan laba bila pesanan asal bermodal), bukan refund barang |

Metadata `kepastian.refundTiktok`: refund di baris asal, refund susulan cocok/tidak cocok (baris, nilai), biaya
susulan, refund parsial dengan unit terverifikasi/belum diketahui. Jejak uang membedakan kecocokan **total** dengan
laporan (status refund) dari kelengkapan **pencocokan transaksi** (`refund.pencocokanTransaksi`).

Batasan: kunci duplikat TikTok belum diubah (R1–R3 ditunda, KNOWN_ISSUES P11); bila satu pesanan punya lebih dari satu
baris asal, susulannya dianggap tidak cocok. Diuji di `tests/engine.test.js` (TT-R4-1 s.d. TT-R4-12).

### B.1d Penggabungan beberapa Laporan Penghasilan (P11, R1–R3, 20 Okt 2026)

Status: **penerapan instruksi pemilik 20 Okt 2026** (konflik ditahan, bukan dijumlahkan atau dipilih). Aturan identitas
dan cakupan di bawah adalah rancangan Claude Code yang perlu ditinjau pemilik.

| Aturan | Isi | Bukti |
|---|---|---|
| Identitas baris | Isi finansial baris: ID, jenis, tanggal pesanan & bayar, penjualan, refund, subtotal, biaya per jenis, settlement, rincian SKU×jumlah, sumber (TikTok); harga, refund, voucher, biaya, total + baris SKU (pesanan Shopee); tanggal, tipe, nilai, nomor pesanan terkait (penyesuaian Shopee). Tanpa data pribadi | — |
| Dalam satu file | Tidak ada deduplikasi (kecuali pesanan Shopee yang tercatat dua kali dengan isi sama), karena ringkasan resmi file hanya cocok bila semua barisnya dihitung | Ringkasan per file |
| Antarfile | Baris berisi sama dihitung sekali (jumlah kemunculan maksimum di satu file) | File asli: 3 file TikTok unduhan ulang (3.283 baris) dan periode berurutan |
| Cakupan file | Rentang tanggal bayar/dana dilepas yang dicakup file: TikTok = tanggal bayar terawal–terakhir; Shopee = "Dari"–"ke" di Summary (terbukti basisnya tanggal dana dilepas) | File asli |
| Konflik versi | Pada tanggal yang dicakup dua file, isi kelompok transaksi (ID) berbeda; atau pesanan Shopee / baris asal TikTok dengan isi berbeda di dua file. Seluruh kelompok **ditahan**: tidak masuk penjualan, dana, biaya, HPP, maupun laba; kedua versinya dicatat; status "Perlu rekonsiliasi"; laba tidak final (`konflik_antar_laporan`) | **Hanya sintetis** |
| Tidak saling lengkap | File mencakup tanggal transaksi tetapi tidak memuat ID-nya sama sekali. Transaksi **tetap dihitung**; status "Perlu dicek" (`laporan_tidak_saling_lengkap`) | **Hanya sintetis** |
| Refund/biaya susulan | Baris dengan ID sama di periode lain (di luar cakupan file asal) bukan konflik dan bukan duplikat; aturan R4 tetap berlaku | Sintetis + 4 kasus asli dalam satu file |

Money Trace: status komponen = gabungan **rekonsiliasi intrafile** (`rekonsiliasiFile`: cocok / tidak_cocok /
tanpa_ringkasan) dan **rekonsiliasi gabungan** (`rekonsiliasiGabungan`: bebas_konflik / tidak_lengkap / konflik).
"Sesuai laporan dan terekonsiliasi" hanya bila keduanya bersih. Duplikat identik yang sudah ditangani tidak menurunkan
status. File dianggap identik berdasarkan seluruh isi barisnya, bukan himpunan nomor pesanan.

Batasan: semua versi laporan nyata yang berbeda isi belum pernah ditemukan pada data uji, jadi aturan konflik baru
diuji sintetis. Cakupan TikTok dari baris (bukan dari periode resmi file) bisa lebih sempit dari periode unduhan;
sheet Laporan TikTok sebenarnya memuat periode resmi (baris "Periode", basis tanggal pembayaran, UTC+7) — lihat
KNOWN_ISSUES P13. Total yang tampil saat ada transaksi ditahan dinyatakan "belum lengkap" di dashboard, PDF, dan Excel.
Diuji di `tests/engine.test.js` (MG-P11-*).

### B.1e Periode resmi Laporan Penghasilan TikTok (P13, 20 Okt 2026)

Status: **penerapan izin terbatas pemilik 20 Okt 2026**. Hanya cakupan dan status; tidak ada angka yang berubah.

| Hal | Isi |
|---|---|
| Sumber | Sheet `Laporan`, baris berlabel `Periode` (nilai di sel terakhir baris itu); baris `Zona waktu` |
| Format yang ditemukan | `YYYY/MM/DD-YYYY/MM/DD` di semua 7 file asli (4 unik); zona `UTC+7`. Spasi di sekitar tanda hubung diterima; format lain **tidak ditebak** → "rusak" |
| Batas | Inklusif di kedua ujung (file asli punya transaksi tepat di tanggal awal dan tanggal akhir) |
| Basis | Tanggal pembayaran: semua baris di file asli berada di dalam periode resmi |
| Tanpa periode | Rentang tanggal transaksi dipakai sebagai **cakupan teramati**, tidak disebut resmi. Gabungan beberapa file tanpa periode → "berdasarkan laporan" (`cakupan_teramati`) |
| Periode rusak | Status "Perlu dicek" (`periode_resmi_rusak`), cadangan cakupan teramati |
| Transaksi di luar periode | Anomali "Perlu dicek" (`baris_di_luar_periode_resmi`); transaksi tetap dihitung |

Penggunaan: **penahanan konflik** (P11) tetap memakai cakupan teramati, jadi periode resmi tidak pernah membuat transaksi
ditahan. Periode resmi dipakai untuk **status**: (1) laporan yang tidak saling lengkap, dan (2) nomor transaksi sama
dengan isi berbeda yang hanya terlihat dengan periode resmi → `identitas_transaksi_belum_pasti` ("Perlu dicek"); kedua
baris tetap dihitung karena belum terbukti apakah itu versi lain atau transaksi lain.

Penyajian (keputusan pemilik 20 Okt 2026): transaksi yang identitasnya belum pasti **tetap dihitung** apa adanya (tidak
dihapus, tidak dipilih salah satu versi, rumus tidak diubah). Dashboard (kartu penjualan dan laba, Kepastian Profit,
nota, Money Trace), PDF, dan Excel menampilkan: "Total perlu diverifikasi. Ada transaksi dengan identitas yang belum
dapat dipastikan dan mungkin tercatat lebih dari sekali." Transaksi yang ditahan (konflik) menampilkan: "Total belum
lengkap. Sebagian transaksi ditahan karena terdapat perbedaan data antar laporan." Semua komponen Money Trace
marketplace terkait tidak pernah berstatus "terekonsiliasi" selama ada keduanya. **Persoalan identitas transaksi belum
selesai**: total yang memuat transaksi ambigu bisa menghitung satu transaksi lebih dari sekali.

Keterbatasan identitas penyesuaian: pada file asli, ID penyesuaian TikTok berbeda format dari ID pesanan (19 vs 18
digit) dan unik di setiap file (12 penyesuaian), tetapi belum ada bukti bahwa unduhan ulang mempertahankan ID yang sama
untuk transaksi yang sama. Aturan P11 yang sudah ada (nomor sama + isi beda pada tanggal yang dicakup kedua file secara
teramati → ditahan) tetap berlaku dan **perlu keputusan pemilik** untuk penyesuaian (KNOWN_ISSUES P13). Kondisi yang
belum teruji dengan file asli: periode rusak, transaksi di luar periode, file tanpa periode, periode tumpang tindih.

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
| C.3 | Baris "Sku" di Laporan Penghasilan Shopee per produk atau per variasi | Menentukan perbaikan H3 | **Terjawab untuk file yang diuji (14 Okt 2026): per variasi**, tanpa nama variasi; ID produk sama untuk semua variasi. Masih perlu konfirmasi di bulan/toko lain. | Claude Code (dengan file asli) |
| C.4 | Jenis penyesuaian yang muncul dan substansinya | Dasar tabel klasifikasi A.10 | Ditemukan pada data uji pemilik: jenis TikTok "Penggantian Biaya Logistik" dan "Kompensasi asuransi pengiriman", serta penyesuaian Shopee; yang ditemukan bersifat positif | Pemilik |
| C.5 | Refund parsial: per unit atau per nominal? | Aturan A.9 untuk unit yang direfund sebagian | **Diputuskan untuk HPP (19 Okt 2026):** nominal refund tidak boleh dipakai menentukan jumlah unit HPP (aturan resmi A.19.1). Yang masih terbuka hanya pengamatan data: refund untuk barang yang sudah dikirim lalu diretur belum ada di data uji. | Pemilik (diputuskan) / Claude Code (pengamatan) |
| C.6 | Apakah refund setelah dana dilepas tercatat sebagai penyesuaian atau di baris pesanan | Menentukan apakah P10 terjadi di data nyata | Cari kasus retur "Tidak kembali" yang pesanannya tidak punya refund di baris pesanan | Claude Code (dengan file asli) |
| C.7 | Batas hari untuk "bulan lengkap" (A.17) | Bulan tidak lengkap salah dibaca sebagai bulan buruk | Distribusi jeda pesanan → dana dilepas di beberapa toko | Pemilik |
| C.8 | Definisi "Penjualan" untuk Tokopedia lama (sebelum digabung TikTok) | Saat ini hanya pesanan Tokopedia yang tercatat di laporan TikTok yang didukung | Perlu contoh file | Pemilik |
| C.9 | Bagaimana **PPh 22** (dan kolom pajak lain di Laporan Penghasilan Shopee) diperlakukan: potongan marketplace, pajak dibayar di muka/kredit pajak, atau dipisah sebagai pos pajak? | Bila dihitung sebagai potongan, persen potongan dan tarif efektif membesar dan margin terlihat lebih kecil. Bila dianggap kredit pajak tanpa dasar, laba bisa terlihat lebih besar. | Periksa nilai kolom di laporan (agregat saja), ketentuan PPh 22 yang berlaku untuk penjual marketplace, dan bukti potong dari marketplace; konfirmasi ke konsultan pajak | Pemilik (dengan konsultan pajak) |
| C.10 | Kuantitas dipesan vs dikirim vs direfund vs kembali vs hilang (A.19.2): kolom mana di export pesanan dan file retur yang bisa dipakai | Dasar HPP dan kerugian retur per unit | Sebagian terjawab (14 Okt 2026): `Returned quantity` di export = "Jumlah Produk Dikembalikan" di file retur = **unit direfund**, bukan unit kembali ke stok. Pada data uji, unit yang direfund termasuk kategori "tidak dikirim". Status dikirim/kembali/hilang perlu alasan di file retur + konfirmasi seller. Belum ada contoh barang dikirim lalu diretur. | Claude Code (dengan file asli) + Pemilik |
