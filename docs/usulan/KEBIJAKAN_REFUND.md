# DRAF — Kebijakan Pengembalian Dana (Refund) Cek Untung Pro

Status: **DRAF UNTUK DITINJAU PEMILIK — BELUM DITERBITKAN.** Bukan nasihat hukum. Sebelum terbit, sebaiknya ditinjau
oleh konsultan hukum untuk memastikan kesesuaiannya dengan aturan yang berlaku. Bagian yang perlu dicek:
- UU No. 8 Tahun 1999 tentang Perlindungan Konsumen, termasuk larangan klausula baku yang mengalihkan tanggung jawab
  pelaku usaha;
- PP No. 80 Tahun 2019 tentang Perdagangan Melalui Sistem Elektronik;
- UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi, untuk data yang dicatat saat refund.

Bagian bertanda **[PILIH]** adalah keputusan pemilik.

---

## Kebijakan Pengembalian Dana Cek Untung Pro

Cek Untung Pro dibeli dengan **sekali bayar** dan aktif di akun yang membeli. Kebijakan ini menjelaskan kapan Anda
berhak mendapat pengembalian dana dan bagaimana prosesnya. Kebijakan ini tidak mengurangi hak Anda sebagai konsumen
menurut hukum yang berlaku.

### 1. Pengembalian dana penuh

Anda berhak atas pengembalian dana penuh bila:
1. **Pembayaran ganda atau kelebihan bayar.** Kelebihannya dikembalikan.
2. **Pro tidak dapat diaktifkan** di akun Anda dalam **[PILIH: 2] hari kerja** setelah pembayaran Anda kami terima dan verifikasi.
3. **Fitur Pro inti tidak berfungsi** sesuai yang tercantum di halaman harga saat pembelian, dan tidak dapat kami perbaiki
   dalam **[PILIH: 14] hari** sejak Anda melaporkannya. Fitur inti: laporan PDF, analisis semua produk, semua temuan,
   ekspor Excel, dan riwayat tanpa batas.
4. **[PILIH: ya/tidak] Garansi [7] hari:** Anda dapat meminta pengembalian dana tanpa alasan dalam **[7] hari** sejak
   Pro aktif. Garansi berlaku satu kali per pembeli.

### 2. Bila layanan dihentikan

Kami akan memberi tahu lewat email akun paling lambat **[PILIH: 30] hari** sebelum layanan Cek Untung dihentikan
permanen. **[PILIH: ya/tidak]** Bila penghentian terjadi dalam **[PILIH: 12] bulan** sejak pembelian, kami
mengembalikan dana secara proporsional sesuai sisa bulan dari periode tersebut.

### 3. Yang tidak termasuk pengembalian dana

Di luar ketentuan pada bagian 1 dan 2:
- perubahan pikiran setelah masa garansi (bila garansi berlaku);
- fitur atau layanan yang tidak tercantum saat pembelian, termasuk fitur berbayar baru di masa depan;
- hasil perhitungan yang berbeda karena data atau modal yang Anda isi tidak lengkap atau tidak tepat. Cek Untung
  menandai angka yang belum pasti, dan hasilnya adalah perkiraan, bukan laporan keuangan yang diaudit;
- akun yang dinonaktifkan karena pelanggaran ketentuan, misalnya akun dipakai bersama atau dijual kembali. Hak Anda
  menurut hukum tetap berlaku.

### 4. Cara mengajukan

1. Hubungi **[kanal bantuan resmi]** dari **email yang terdaftar di akun** Anda.
2. Sertakan email akun, tanggal pembayaran, nominal, referensi transaksi bila ada, dan alasan singkat.
   **Jangan kirim file laporan toko atau data pembeli**; data itu tidak diperlukan.
3. Kami menjawab dalam **[PILIH: 3] hari kerja**.
4. Bila disetujui, dana dikembalikan dalam **[PILIH: 7–14] hari kerja** ke rekening atau metode yang sama dengan
   pembayaran. Bila tidak memungkinkan, ke rekening atas nama pembayar.
5. Saat refund disetujui, akses Pro di akun dicabut. Setiap refund dan pencabutan dicatat beserta waktu, nominal,
   dan alasannya.

### 5. Kontak

Pertanyaan atau keluhan tentang pembayaran dan pengembalian dana: **[kanal bantuan resmi]**.

---

## Catatan untuk pemilik (tidak ikut diterbitkan)

- **Klausula yang dihindari:** jangan memakai kalimat seperti "dana tidak dapat dikembalikan dalam kondisi apa pun".
  Klausula yang mengalihkan tanggung jawab pelaku usaha berisiko tidak berlaku.
- **Garansi 7 hari:** opsi paling sederhana dan membangun kepercayaan. Untuk produk digital, ada risiko pembeli
  mengunduh PDF lalu meminta refund. Batasi satu kali per pembeli dan catat setiap refund.
- **Pencatatan:** setiap refund memakai `admin_cabut_pro(jenis = 'refund')` sehingga tercatat di `pro_payments`.
- **Tempat terbit:** halaman `privasi.html` (bagian Pro) dan FAQ harga. Terbitkan sebelum tombol beli diaktifkan.
