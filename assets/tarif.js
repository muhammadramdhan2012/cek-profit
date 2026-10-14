/* Cek Profit — tabel tarif umum marketplace.
 *
 * Dipakai untuk simulasi harga SEBELUM ada laporan, atau untuk produk/kategori baru.
 * Laba dari laporan TIDAK memakai tabel ini: laba memakai potongan yang benar-benar tercatat di laporan.
 *
 * Kenapa tidak diambil otomatis dari situs marketplace?
 *   - Halaman tarif resmi dirender dengan JavaScript dan formatnya sering berubah (diuji 14 Okt 2026:
 *     halaman edukasi Shopee tidak mengembalikan isi tarif bila diambil oleh mesin).
 *   - Tarif berbeda per subkategori, status toko, dan program yang diikuti; sumber publik pun tidak selalu sama.
 *   Angka yang salah tanpa disadari lebih berbahaya daripada angka yang jelas tertulis "perkiraan" dengan tanggal.
 *
 * CARA MEMPERBARUI: ubah angka di DATA, ganti `dicek`, tambahkan sumber, lalu jalankan
 * `python3 scripts/versi.py` dan `node tests/tarif.test.js`. Semua persen dalam angka 0–100.
 */
const CekTarif = (() => {
  const DATA = {
    dicek: '2026-10-14',
    shopee: {
      nama: 'Shopee',
      berlaku: 'tarif Januari 2026',
      sumber: [
        { label: 'Pusat Edukasi Penjual Shopee (resmi)', url: 'https://seller.shopee.co.id/edu/article/15965' },
        { label: 'Salesmetrix: biaya admin Shopee 2026', url: 'https://salesmetrix.id/blog/berapa-biaya-admin-shopee-2026' },
      ],
      status: [{ id: 'nonmall', label: 'Toko biasa (Non-Star, Star, Star+)' }, { id: 'mall', label: 'Shopee Mall' }],
      // Kisaran umum per kelompok kategori besar. Subkategori bisa sedikit berbeda.
      kategori: [
        { id: 'umum', label: 'Fashion, makanan & minuman, kecantikan, rumah tangga, hobi', nonmall: 10, mall: 11.7 },
        { id: 'elektronik', label: 'Elektronik & aksesoris, perawatan kulit tertentu', nonmall: 9.5, mall: 10.45 },
        { id: 'susu', label: 'Susu formula & suplemen kesehatan', nonmall: 6.75, mall: 7.7 },
        { id: 'gadget', label: 'HP, laptop, elektronik harga tinggi', nonmall: 5.25, mall: 6.2 },
        { id: 'perhiasan', label: 'Logam mulia & perhiasan', nonmall: 4.25, mall: 4.7 },
        { id: 'digital', label: 'Voucher digital & tiket', nonmall: 2.5, mall: 3.2 },
      ],
      tetap: [{ id: 'proses', label: 'Biaya proses pesanan', rp: 1250 }],
      opsi: [
        { id: 'gox', label: 'Gratis Ongkir XTRA', pct: 4, catatan: 'program opsional, umumnya sekitar 4%' },
        { id: 'promo', label: 'Promo/Cashback XTRA', pct: 2, catatan: 'program opsional, sekitar 1,5–4%' },
        { id: 'po', label: 'Pre-order', pct: 3, catatan: 'hanya untuk produk pre-order' },
      ],
    },
    tiktok: {
      nama: 'TikTok Shop & Tokopedia',
      berlaku: 'tarif sejak 18 Mei 2026',
      sumber: [
        { label: 'Katadata: penyesuaian biaya TikTok Shop & Tokopedia 18 Mei 2026', url: 'https://katadata.co.id/digital/e-commerce/6a0a8ae3741b3/tiktok-shop-tokopedia-sesuaikan-biaya-admin-seller-per-18-mei-ada-yang-naik' },
      ],
      status: [{ id: 'nonmall', label: 'Toko biasa' }, { id: 'mall', label: 'Mall' }],
      // Sumber publik hanya menyebut kisaran: toko biasa 2,5–10% (kebanyakan 9–10%), Mall 2,5–12,2%.
      kategori: [
        { id: 'umum', label: 'Sebagian besar kategori (fashion, kecantikan, rumah tangga, makanan)', nonmall: 10, mall: 12.2 },
        // Kategori lain (mis. perangkat video 4%) tidak dirinci di sumber publik: penjual mengisi persennya sendiri.
      ],
      tetap: [
        { id: 'proses', label: 'Biaya pemrosesan pesanan', rp: 1250 },
        { id: 'logistik', label: 'Biaya layanan logistik', rp: 1000, catatan: 'Rp260–3.000 per pesanan, tergantung rute' },
      ],
      opsi: [{ id: 'po', label: 'Pre-order', pct: 3, catatan: 'hanya untuk produk pre-order' }],
    },
  };

  const PLATFORMS = ['shopee', 'tiktok'];

  /**
   * Perkiraan potongan untuk satu pesanan.
   * @param {{platform:'shopee'|'tiktok', status?:string, kategori?:string, opsi?:string[], afiliasi?:number}} p
   * @returns {{pct:number, fixed:number, rincian:{label:string, pct?:number, rp?:number}[]}}
   */
  function estimate({ platform, status = 'nonmall', kategori, opsi = [], afiliasi = 0 } = {}) {
    const d = DATA[platform];
    if (!d) throw new Error(`Platform tidak dikenal: ${platform}`);
    const kat = d.kategori.find((k) => k.id === kategori) || d.kategori[0];
    const st = status === 'mall' ? 'mall' : 'nonmall';
    const rincian = [{ label: `Komisi/biaya administrasi (${kat.label.split(',')[0].split('(')[0].trim()})`, pct: kat[st] }];
    for (const o of d.opsi) if (opsi.includes(o.id)) rincian.push({ label: o.label, pct: o.pct });
    if (afiliasi > 0) rincian.push({ label: 'Komisi afiliasi', pct: +afiliasi });
    for (const t of d.tetap) rincian.push({ label: t.label, rp: t.rp });
    const pct = rincian.reduce((a, x) => a + (x.pct || 0), 0);
    const fixed = rincian.reduce((a, x) => a + (x.rp || 0), 0);
    return { pct: Math.round(pct * 100) / 100, fixed, rincian };
  }

  return { DATA, PLATFORMS, estimate };
})();
if (typeof module !== 'undefined') module.exports = CekTarif;
