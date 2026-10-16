# Quality Gates Cek Untung

Pemeriksaan wajib sebelum meminta izin commit. Aturan persetujuan tetap mengikuti `CLAUDE.md` §3: lulus quality
gate **tidak** berarti boleh commit atau push tanpa izin pemilik.

Bila suatu pemeriksaan tidak bisa dilakukan, tulis **secara eksplisit** di laporan: apa yang tidak diuji,
kenapa, dan risikonya.

**Ruang lingkup:** setiap pembaruan file yang disebut di dokumen ini (kode, tes, `README.md`, `KNOWN_ISSUES.md`,
`docs/*`, `CLAUDE.md`) mengikuti `CLAUDE.md` §3. Bila suatu gate membutuhkan pembaruan dokumen atau file di luar
ruang lingkup tugas yang disetujui, **minta izin pemilik dulu**. Jangan memperluas ruang lingkup sendiri. Bila
izin belum ada, tulis usulan perubahannya di laporan.

## 1. Gate per jenis perubahan

| Jenis perubahan | Wajib |
|---|---|
| **Parser / mesin hitung / rumus keuangan** | Checklist §2 lengkap; semua tes Node (§4); perbandingan angka sebelum vs sesudah (§3); definisi di `docs/KAMUS_ANGKA.md` sudah **DISETUJUI** |
| **Skema database / RLS / auth** | Tes RLS di PostgreSQL lokal (`supabase/tests/`); `node tests/cloud.test.js`; tinjauan keamanan §5; migrasi idempoten; dijalankan pemilik |
| **Tampilan (HTML/CSS/JS UI)** | Pemeriksaan tampilan §6; tidak ada error console; `python3 scripts/versi.py` |
| **Teks untuk pengguna / penjelasan "?"** | Konsisten dengan definisi yang disetujui di `docs/KAMUS_ANGKA.md`; tidak ada klaim kepastian bila data belum lengkap; Bahasa Indonesia sesuai `CLAUDE.md` §4 |
| **Tarif umum (`assets/tarif.js`)** | Setiap angka bertanggal dan bersumber; `node tests/tarif.test.js` |
| **Dependency baru** | Evaluasi (perlu atau tidak, ukuran, lisensi, keamanan), di-*vendor* dengan versi tetap, persetujuan pemilik |
| **Semua perubahan** | Dampak ke fitur lama diperiksa. Bila menemukan atau menutup masalah: laporkan ke pemilik, dan perbarui `KNOWN_ISSUES.md` bila termasuk ruang lingkup atau sudah diizinkan |

## 2. Checklist kebenaran finansial (parser dan mesin hitung)

Setiap butir dijawab **ya / tidak relevan (alasan) / tidak bisa diuji (alasan)**:

1. **Definisi** perhitungan tertulis dan merujuk ke definisi yang disetujui di `docs/KAMUS_ANGKA.md` bagian A.
2. **Tes normal, edge case, dan regresi** ditambahkan di `tests/`.
3. **Duplikasi:**
   - file yang sama diunggah dua kali;
   - periode tumpang tindih;
   - baris identik yang sah tidak terbuang.
4. **HPP yang belum diketahui** tetap dikeluarkan dari laba (tidak dianggap nol) dan tercermin di "modal diketahui".
5. **Refund parsial dan penuh:**
   - dengan dan tanpa file retur;
   - barang kembali vs tidak kembali.
6. **Tidak ada penghitungan ganda HPP dan kerugian retur.** Setiap unit hanya masuk salah satu dari: HPP, kerugian
   retur, atau tidak keduanya (barang kembali). Aturannya di `docs/KAMUS_ANGKA.md` A.9.
7. **Rekonsiliasi:** total per file tetap cocok dengan ringkasan resmi; selisih memunculkan peringatan.
8. **Nilai negatif, nol, kosong, dan teks.** Format angka Indonesia/Inggris (`1.234,56`, `1,234.56`, `45000,00`) dan
   tanggal (`yyyy-mm-dd`, `dd/mm/yyyy`, serial Excel).
9. **Kolom wajib hilang atau berganti nama** menghasilkan pesan "format berubah", bukan angka 0 diam-diam.
10. **Variasi produk dan SKU** di banyak platform tidak tergabung salah.
11. **Basis waktu** setiap angka jelas (tanggal pesanan atau tanggal dana dilepas), dan bulan tidak lengkap ditandai.
12. **Asumsi baru** ditampilkan ke seller di dekat angka terdampak dan masuk komponen Profit Confidence.
13. **Bukti tidak merusak hasil lama** (§3).

## 3. Bukti regresi angka

Sebelum dan sesudah perubahan parser atau mesin hitung, bandingkan minimal angka berikut:
- `totalSales`
- `totalFees`
- `totalReceived`
- `totalModal`
- `totalMargin`
- `netProfit`
- `coverage`
- `orders`
- jumlah produk
- jumlah kasus retur

Bandingkan pada:
- data contoh (`assets/demo.js`);
- setiap fixture di `tests/fixtures/` *(target, belum ada)*;
- bila tersedia dan diizinkan, salinan file asli seller. Laporkan hasilnya hanya di percakapan dengan pemilik.
  **Jangan menulis angka bisnis asli ke file di repository** (repository publik).

Setiap perbedaan harus dijelaskan: disengaja (sesuai definisi baru) atau regresi.

## 4. Perintah tes

```bash
python3 scripts/versi.py          # perbarui ?v=<hash> semua aset + versi sw.js
python3 scripts/versi.py --check  # harus: "Nomor versi cocok dengan isi file."
node tests/engine.test.js         # mesin hitung (data contoh)
node tests/tarif.test.js          # tabel tarif umum
node tests/license.test.js        # kode akses
node tests/cloud.test.js          # akun & database terhadap server tiruan tests/mock-supabase.js
```

- Hook `scripts/pre-commit` hanya menjalankan `versi.py --check`, tes engine, dan tes tarif.
- CI (`.github/workflows/periksa.yml`) menjalankan semuanya.
- Jangan menganggap lolos hook berarti semua tes lulus.
- Tes RLS: `supabase/tests/shim.sql` + `supabase/tests/test.sql` di PostgreSQL lokal.

## 5. Pemeriksaan keamanan (bila relevan)

- Semua teks dari file, pengguna, atau server di-escape sebelum `innerHTML`; tidak ada `eval` / `new Function`.
- Tidak ada secret, `service_role`, kunci privat, atau file laporan asli di diff.
- Tabel atau kolom baru punya RLS; pengguna tidak bisa membaca atau mengubah baris pengguna lain; kolom sensitif
  tidak bisa diubah sendiri.
- Fungsi `security definer` memakai `search_path` terkunci dan memeriksa `is_admin()` bila perlu.
- Batasan bisnis (kuota, Pro) dicek apakah bisa dilewati lewat API.
- Tidak ada data pembeli yang dikirim ke server atau layanan eksternal.

## 6. Pemeriksaan tampilan

- Playwright (Chromium terpasang di `/opt/pw-browsers`):
  - desktop (±1366px) dan HP **375px**;
  - tema **terang** dan **gelap**;
  - tanpa scroll horizontal;
  - tanpa error console.
- Lihat screenshot, jangan hanya mengandalkan tes lulus.
- *(target)* Skrip Playwright disimpan di `tests/e2e/`. Saat ini skrip e2e ada di luar repo.
- Server lokal: `python3 -m http.server 8765`; matikan dengan `fuser -k 8765/tcp` (jangan `pkill -f`).
- Halaman baru wajib masuk `PAGES` di `scripts/versi.py` dan `CORE` di `sw.js`.

## 7. Fixture data *(target, belum ada)*

- Lokasi: `tests/fixtures/`.
- Isi: cuplikan **dianonimkan** dari laporan asli (header asli, 20–50 baris).
  - Nama pembeli, alamat, telepon, nomor pesanan asli, dan nama toko diganti.
  - Angka boleh diubah selama total ringkasan disesuaikan.
- Wajib mencakup:
  - qty > 1 tanpa export pesanan;
  - variasi bermodal berbeda;
  - refund parsial dan penuh;
  - refund setelah dana dilepas (penyesuaian);
  - kasus retur di luar periode;
  - kolom berganti nama;
  - angka dengan koma desimal.
- File laporan asli seller **tidak boleh** di-commit (`CLAUDE.md` §2).

## 8. Definisi selesai

Sebuah tugas atau fitur baru boleh disebut **selesai** bila:
1. acceptance criteria yang disepakati terpenuhi;
2. gate yang relevan (§1) lulus, dengan bukti (perintah dan hasil);
3. dokumentasi diperbarui, bila termasuk ruang lingkup yang disetujui (bila tidak, usulkan ke pemilik dan tunggu izin):
   - `README.md` bila fitur berubah;
   - `docs/KAMUS_ANGKA.md` bila definisi atau implementasi berubah;
   - `KNOWN_ISSUES.md` bila masalah ditemukan atau ditutup;
   - `CLAUDE.md` §10 bila status berubah;
4. hal yang belum diverifikasi disebutkan secara eksplisit;
5. pemilik sudah melihat hasilnya. Commit dan push tetap menunggu izin terpisah.

Masalah di `KNOWN_ISSUES.md` ditandai **Selesai** hanya dengan bukti: nama tes, perintah, hasil, tanggal, dan commit.
