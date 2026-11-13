/* Cek Untung — membaca price list supplier (Langkah 2a, disetujui pemilik 13 Nov 2026).
 *
 * Murni: tanpa DOM, tanpa jaringan, tanpa localStorage. Masukan berupa tabel (array-of-arrays dari SheetJS), sehingga
 * bisa diuji di Node (tests/pricelist.test.js). Dipakai assets/app.js. Perhitungan modal dari price list ada di
 * assets/engine.js (buildCatalog), bukan di sini.
 *
 * Aturan:
 *  - Seller memilih kolom (kode, nama, variasi, harga) dan jenis harga (harga modal atau harga sampul). Tebakan kolom
 *    di sini hanya SARAN yang harus dikonfirmasi seller.
 *  - Seller memilih format angka: 'titik' (titik ribuan, koma desimal: 45.000 / 45000,00) atau 'koma' (koma ribuan,
 *    titik desimal: 45,000 / 45000.00). Sel yang sudah berupa angka di Excel dipakai apa adanya.
 *  - Harga yang tidak cocok dengan format, kosong, nol, atau negatif TIDAK dipakai, tetapi didaftar (`masalah`).
 *  - Kode yang sama dengan harga berbeda = konflik: semua baris kode itu tidak dipakai, didaftar (`konflik`).
 *    Kode yang sama dengan harga sama = satu baris.
 *  - File mentah tidak disimpan; yang disimpan hanya baris [kode, nama, variasi, harga].
 */
const CekPriceList = (() => {
  const VERSI = 1;
  /** Batas ukuran price list yang disimpan (byte JSON). Database menolak ≥ 3.000.000 (user_data_price_list_size). */
  const BATAS_BYTE = 2900000;
  const FORMAT = {
    titik: 'Titik ribuan, koma desimal (45.000 atau 45000,00)',
    koma: 'Koma ribuan, titik desimal (45,000 atau 45000.00)',
  };
  const JENIS = { modal: 'Harga modal (harga beli)', sampul: 'Harga sampul / harga katalog' };

  const teks = (v) => (v === null || v === undefined ? '' : String(v)).replace(/ /g, ' ').trim();
  const normHeader = (v) => teks(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const POLA = {
    // Desimal rupiah ditulis 1–2 digit. "45,000" (titik) atau "45.000" (koma) = tidak terbaca, bukan 45 rupiah.
    titik: [/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/, /^\d+(,\d{1,2})?$/],
    koma: [/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/, /^\d+(\.\d{1,2})?$/],
  };
  /** Bersihkan tulisan harga: buang "Rp"/"IDR", spasi, dan ",-" di akhir (gaya penulisan harga di Indonesia). */
  const bersihkan = (v) => teks(v).replace(/^(rp\.?|idr)\s*/i, '').replace(/\s+/g, '').replace(/,-$|\.-$/, '');

  /**
   * Baca satu harga menurut format pilihan seller. Angka asli Excel dipakai apa adanya.
   * @returns {number} NaN bila tidak terbaca (termasuk tulisan yang tidak cocok dengan format).
   */
  function bacaAngka(v, format) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = bersihkan(v);
    if (!s || !POLA[format]) return NaN;
    if (!POLA[format].some((re) => re.test(s))) return NaN;
    const angka = format === 'titik' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number(angka);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Tebak format dari contoh nilai teks. null bila tidak bisa ditebak (mis. semua sel sudah berupa angka). */
  function tebakFormat(nilai) {
    let titik = 0, koma = 0;
    for (const v of nilai) {
      if (typeof v === 'number') continue;
      const s = bersihkan(v);
      if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+,\d{1,2}$/.test(s)) titik++;
      else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) koma++;
    }
    if (!titik && !koma) return null;
    return titik >= koma ? 'titik' : 'koma';
  }

  /** Baris judul kolom: baris pertama (dari 30 baris awal) yang punya ≥ 2 sel teks bukan angka. */
  function cariHeader(aoa) {
    for (let i = 0; i < Math.min(30, aoa.length); i++) {
      const row = aoa[i] || [];
      const isi = row.filter((c) => teks(c) !== '');
      const huruf = isi.filter((c) => typeof c !== 'number' && /[a-z]/i.test(teks(c)));
      if (isi.length >= 2 && huruf.length >= 2) return i;
    }
    return -1;
  }

  const RE = {
    kode: /\b(kode|sku|isbn|barcode|plu|ean|code|artikel)\b/,
    nama: /\b(judul|nama|produk|title|deskripsi|description|item|buku)\b/,
    variasi: /\b(variasi|varian|variant|cover|jilid)\b/,
    harga: /\b(harga|het|price|hrg|netto|nett|net|modal|beli|rp)\b/,
    hargaModal: /\b(modal|beli|netto|nett|net|hpp|pokok)\b/,
    hargaSampul: /\b(sampul|het|katalog|retail|eceran|jual|price|bruto)\b/,
  };
  /**
   * Saran kolom dari judul kolom. Hanya saran: seller tetap memilih.
   * @returns {{kode:number, nama:number, variasi:number, harga:number, jenis:'modal'|'sampul'|null, kandidatHarga:number[]}}
   */
  function tebakKolom(header) {
    const h = (header || []).map(normHeader);
    const cari = (re, kecuali = []) => h.findIndex((x, i) => x && re.test(x) && !kecuali.includes(i));
    const kode = cari(RE.kode);
    const kandidatHarga = h.map((x, i) => (x && RE.harga.test(x) && i !== kode ? i : -1)).filter((i) => i >= 0);
    const variasi = cari(RE.variasi, [kode, ...kandidatHarga]);
    const nama = cari(RE.nama, [kode, variasi, ...kandidatHarga]);
    const modalIdx = kandidatHarga.find((i) => RE.hargaModal.test(h[i]));
    const harga = modalIdx !== undefined ? modalIdx : kandidatHarga.length ? kandidatHarga[0] : -1;
    const jenis = harga < 0 ? null : RE.hargaModal.test(h[harga]) ? 'modal' : RE.hargaSampul.test(h[harga]) ? 'sampul' : null;
    return { kode, nama, variasi, harga, jenis, kandidatHarga };
  }

  /** Kode sebagai teks. Angka besar dari Excel (mis. ISBN 9786020000000) ditulis tanpa notasi eksponen. */
  const kodeTeks = (v) => (typeof v === 'number' && Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : teks(v));

  /**
   * Bangun price list dari tabel dan pemetaan kolom pilihan seller.
   * @param aoa   array-of-arrays (sheet)
   * @param peta  {header:number, kode:number, nama:number, variasi:number, harga:number, jenis:'modal'|'sampul', format:'titik'|'koma'}
   *              (kolom yang tidak dipakai = -1)
   * @returns {{baris:[string,string,string,number][], masalah:{baris:number, alasan:string, nilai:string}[],
   *            konflik:{kode:string, harga:number[], baris:number[]}[], jumlahBaca:number}}
   */
  function bangun(aoa, peta) {
    if (!peta || !JENIS[peta.jenis] || !FORMAT[peta.format]) throw new Error('Pemetaan kolom belum lengkap.');
    if (!(peta.harga >= 0)) throw new Error('Kolom harga belum dipilih.');
    if (!(peta.kode >= 0) && !(peta.nama >= 0)) throw new Error('Pilih kolom kode atau nama produk.');
    const ambil = (row, i) => (i >= 0 ? row[i] : '');
    const masalah = [], calon = [];
    let jumlahBaca = 0;
    for (let r = peta.header + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const kode = kodeTeks(ambil(row, peta.kode)), nama = teks(ambil(row, peta.nama)), variasi = teks(ambil(row, peta.variasi));
      const mentah = ambil(row, peta.harga);
      if (!kode && !nama) { if (teks(mentah) !== '') masalah.push({ baris: r + 1, alasan: 'tanpa_kode_nama', nilai: teks(mentah) }); continue; }
      jumlahBaca++;
      const harga = bacaAngka(mentah, peta.format);
      if (teks(mentah) === '') { masalah.push({ baris: r + 1, alasan: 'harga_kosong', nilai: '' }); continue; }
      if (!Number.isFinite(harga)) { masalah.push({ baris: r + 1, alasan: 'harga_tidak_terbaca', nilai: teks(mentah) }); continue; }
      if (!(harga > 0)) { masalah.push({ baris: r + 1, alasan: 'harga_nol_atau_negatif', nilai: teks(mentah) }); continue; }
      calon.push({ r: r + 1, kode, nama, variasi, harga });
    }
    // Kode ganda: harga sama → satu baris; harga berbeda → konflik, tidak dipakai.
    const perKode = new Map();
    for (const c of calon) if (c.kode) { const k = c.kode.toLowerCase(); if (!perKode.has(k)) perKode.set(k, []); perKode.get(k).push(c); }
    const konflik = [], buang = new Set();
    for (const [, list] of perKode) {
      if (list.length < 2) continue;
      const harga = [...new Set(list.map((c) => c.harga))];
      if (harga.length > 1) { konflik.push({ kode: list[0].kode, harga, baris: list.map((c) => c.r) }); list.forEach((c) => buang.add(c)); }
      else list.slice(1).forEach((c) => buang.add(c));
    }
    const baris = calon.filter((c) => !buang.has(c)).map((c) => [c.kode, c.nama, c.variasi, c.harga]);
    return { baris, masalah, konflik, jumlahBaca };
  }

  /** Contoh hasil bacaan beberapa baris pertama, untuk dicek seller sebelum menyimpan. */
  function contoh(aoa, peta, n = 5) {
    const out = [];
    for (let r = peta.header + 1; r < aoa.length && out.length < n; r++) {
      const row = aoa[r] || [];
      const kode = peta.kode >= 0 ? kodeTeks(row[peta.kode]) : '', nama = peta.nama >= 0 ? teks(row[peta.nama]) : '';
      if (!kode && !nama) continue;
      const mentah = peta.harga >= 0 ? row[peta.harga] : '';
      const harga = bacaAngka(mentah, peta.format);
      // Tidak terbaca, atau di bawah Rp100 (hampir pasti salah format/kolom): diberi tanda untuk dicek seller.
      out.push({ baris: r + 1, kode, nama, variasi: peta.variasi >= 0 ? teks(row[peta.variasi]) : '', asli: teks(mentah), harga, periksa: !Number.isFinite(harga) || harga < 100 });
    }
    return out;
  }

  /** Objek price list yang disimpan (tanpa file mentah). */
  const buatSimpanan = ({ hasil, peta, namaKolom, namaFile, kini }) => ({
    v: VERSI, diubah: kini, jenis: peta.jenis, format: peta.format, kolom: namaKolom || {}, namaFile: teks(namaFile).slice(0, 120),
    baris: hasil.baris, konflik: hasil.konflik.length, masalah: hasil.masalah.length,
  });
  const ukuran = (simpanan) => new TextEncoder().encode(JSON.stringify(simpanan)).length;
  const terlaluBesar = (simpanan) => ukuran(simpanan) >= BATAS_BYTE;

  /**
   * Sinkron price list (disimpan terpisah dari settings). `lokal` = price list di perangkat (atau penanda hapus
   * {dihapus:true, diubah}), `info` = settings.priceListInfo dari akun {diubah, jumlah}.
   * Yang terbaru menang; waktu sama → tidak ada yang dilakukan (isi sudah sama).
   * @returns {'unduh'|'unggah'|'sama'}
   */
  function rencanaSinkron(lokal, info) {
    const tL = lokal && Number.isFinite(lokal.diubah) ? lokal.diubah : 0;
    const tA = info && Number.isFinite(info.diubah) ? info.diubah : 0;
    if (tA > tL) return 'unduh';
    if (tL > tA) return 'unggah';
    return 'sama';
  }
  /** Ringkasan untuk settings.priceListInfo (kecil; ikut sinkron M2 per kunci). */
  const info = (simpanan) => (simpanan && !simpanan.dihapus
    ? { diubah: simpanan.diubah, jumlah: simpanan.baris.length, jenis: simpanan.jenis }
    : { diubah: simpanan ? simpanan.diubah : 0, jumlah: 0, dihapus: true });

  const adaBaris = (x) => !!(x && Array.isArray(x.baris) && x.baris.length);
  /**
   * Satu putaran sinkron price list dengan akun. Fungsi jaringan diberikan pemanggil:
   *  bacaWaktu() → waktu ubah price list di akun (null bila belum ada); unduh() → isi kolom; unggah(obj).
   * Sebelum mengunggah, waktu di akun dibaca dulu: bila akun lebih baru (perangkat lain mengunggah tetapi ringkasannya
   * belum sampai), price list akun diunduh, bukan ditimpa. Isi akun kosong padahal ringkasan menyebut ada price list
   * (mis. kolom dibuat ulang) → price list perangkat TIDAK dihapus; diunggah ulang bila ada.
   * @returns {Promise<{status:'sama'|'diunduh'|'diunggah'|'gagal', priceList?, info?, galat?}>}
   */
  async function sinkronkan({ lokal, info: infoAkun, bacaWaktu, unduh, unggah }) {
    let rencana = rencanaSinkron(lokal, infoAkun);
    if (rencana === 'sama') return { status: 'sama' };
    try {
      if (rencana === 'unggah') {
        const tAkun = await bacaWaktu();
        if (tAkun !== null && tAkun > (lokal.diubah || 0)) rencana = 'unduh';
      }
      if (rencana === 'unduh') {
        const data = await unduh();
        if (adaBaris(data)) return { status: 'diunduh', priceList: data, info: info(data) };
        if (data && data.dihapus) { const hapus = { dihapus: true, diubah: Math.max(data.diubah || 0, (infoAkun && infoAkun.diubah) || 0) }; return { status: 'diunduh', priceList: hapus, info: info(hapus) }; }
        if (!lokal || !adaBaris(lokal)) return { status: 'sama' };
      }
      await unggah(lokal.dihapus ? { dihapus: true, diubah: lokal.diubah } : lokal);
      return { status: 'diunggah', info: info(lokal) };
    } catch (e) { return { status: 'gagal', galat: e }; }
  }

  return { VERSI, BATAS_BYTE, sinkronkan, FORMAT, JENIS, bacaAngka, tebakFormat, cariHeader, tebakKolom, bangun, contoh, buatSimpanan,
    ukuran, terlaluBesar, rencanaSinkron, info };
})();
if (typeof module !== 'undefined') module.exports = CekPriceList;
