/* Cek Untung — Pajak Seller: simulasi PPh final UMKM dan PPh Pasal 22 marketplace.
 *
 * Murni (tanpa DOM), deterministik, diuji di Node: tests/pajak.test.js. Bukan AI, bukan konsultasi pajak.
 * Hasil adalah SIMULASI dari angka yang diisi pengguna; bukan bukti pajak telah dibayar/dipungut, dan tidak pernah
 * mengubah laporan laba (modul ini tidak dipakai Engine.compute).
 *
 * Aturan yang dipakai (diverifikasi 27 Okt 2026 dari sumber resmi; lihat ATURAN):
 *  - PP 55/2022 jo. PP 20/2026: PPh final 0,5% dari peredaran bruto bagi WP orang pribadi (tanpa batas waktu) dengan
 *    peredaran bruto ≤ Rp4,8 miliar setahun; bagian peredaran bruto sampai Rp500 juta setahun tidak dikenai pajak,
 *    dihitung kumulatif sejak bulan pertama tahun pajak. Badan (CV, firma, PT) TIDAK dihitung di sini.
 *  - PMK 37/2025: marketplace pemungut memungut PPh 22 0,5% × peredaran bruto pada dokumen tagihan (tidak termasuk
 *    PPN/PPnBM, sebelum potongan penjualan). Tidak dipungut untuk WP orang pribadi dengan peredaran bruto tahun berjalan
 *    ≤ Rp500 juta yang sudah menyampaikan surat pernyataan. Bila melewati Rp500 juta: surat paling lambat akhir bulan itu,
 *    pemungutan mulai awal bulan berikutnya setelah surat diterima.
 *  - Pengumuman DJP: pemungutan PPh 22 oleh marketplace ditunda; berlaku 1 November 2026.
 * Hal yang belum dapat dipastikan TIDAK ditebak: hasilnya berstatus "belum_didukung" / "belum_lengkap" tanpa angka.
 */
const CekPajak = (() => {
  const TARIF = 0.005;
  const BATAS_TIDAK_KENA = 500000000;      // PP 55/2022 Ps. 60(2): bagian peredaran bruto tidak dikenai pajak (WP OP)
  const BATAS_SURAT = 500000000;           // PMK 37/2025 Ps. 10(1)a & 6(6)
  const BATAS_FINAL = 4800000000;          // PP 20/2026: batas peredaran bruto PPh final setahun
  const TAHUN_DIDUKUNG = [2026];
  const MULAI_PUNGUT = { 2026: 11 };       // Pengumuman DJP: berlaku 1 November 2026

  const ATURAN = [
    { kode: 'PP 55/2022 jo. PP 20/2026', isi: 'PPh final 0,5% bagi wajib pajak orang pribadi dengan peredaran bruto sampai Rp4,8 miliar setahun; peredaran bruto sampai Rp500 juta setahun tidak dikenai pajak (kumulatif sejak Januari).',
      berlaku: 'PP 20/2026 ditetapkan dan berlaku 22 April 2026', sumber: 'https://www.pajak.go.id/en/node/119950' },
    { kode: 'PMK 37/2025', isi: 'Marketplace yang ditunjuk memungut PPh Pasal 22 sebesar 0,5% dari peredaran bruto pada dokumen tagihan (tanpa PPN/PPnBM, sebelum potongan penjualan). Orang pribadi dengan peredaran bruto sampai Rp500 juta yang menyampaikan surat pernyataan tidak dipungut.',
      berlaku: 'Ditetapkan 11 Juni 2025', sumber: 'https://jdih.kemenkeu.go.id/dok/pmk-37-tahun-2025' },
    { kode: 'Pengumuman DJP', isi: 'Pemberlakuan pemungutan PPh Pasal 22 oleh marketplace ditunda sampai 31 Oktober 2026 dan berlaku mulai 1 November 2026. Marketplace pemungut akan ditunjuk ulang; pungutan sebelumnya dikembalikan kepada pedagang.',
      berlaku: '1 November 2026', sumber: 'https://pajak.go.id/en/node/120353' },
    { kode: 'FAQ PMK 37/2025 (DJP)', isi: 'Peredaran bruto untuk batas Rp500 juta mencakup seluruh usaha, termasuk toko offline. PPh 22 yang dipungut merupakan bagian dari pelunasan PPh final; kekurangannya disetor sendiri.',
      berlaku: 'Versi 1, 1 Juli 2026', sumber: 'https://pajak.go.id/en/node/120044' },
  ];

  const angka = (v) => (v === null || v === undefined || v === '' ? null : (typeof v === 'number' ? (isFinite(v) ? v : null) : (isFinite(+v) ? +v : null)));
  const bulat = (v) => Math.round(v);   // ke rupiah terdekat; pembulatan resmi per masa tidak dimodelkan

  /**
   * @param {object} p
   *  tahun, jenis ('op'|'badan'), rezim ('final'|'umum'), syaratFinal (bool: pengguna menyatakan memenuhi syarat PP 55/PP 20),
   *  surat ('sudah'|'belum'|'tidak_tahu': surat pernyataan ≤ Rp500 juta sudah disampaikan ke marketplace),
   *  sampai (1–12: periode Januari s.d. bulan ini), bulan: [{ marketplace, lain }] indeks 0 = Januari (null = belum diisi),
   *  tanpaUsahaLain (bool: pengguna menyatakan tidak ada omzet di luar kolom marketplace), dipungutAktual (angka|null).
   */
  function hitung(p) {
    const tahun = +p.tahun, sampai = Math.min(12, Math.max(1, +p.sampai || 12));
    const op = p.jenis === 'op';
    const catatan = [];
    const rows = Array.from({ length: sampai }, (_, i) => {
      const b = (p.bulan || [])[i] || {};
      const mp = angka(b.marketplace), ln = p.tanpaUsahaLain ? 0 : angka(b.lain);
      return { bulan: i + 1, marketplace: mp, lain: ln };
    });
    const negatif = rows.some((r) => (r.marketplace !== null && r.marketplace < 0) || (r.lain !== null && r.lain < 0));
    const kosongMp = rows.filter((r) => r.marketplace === null).map((r) => r.bulan);
    const kosongLain = rows.filter((r) => r.lain === null).map((r) => r.bulan);
    const lengkap = !kosongMp.length && !kosongLain.length && !negatif;
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const omzet = { marketplace: sum('marketplace'), lain: sum('lain'), total: sum('marketplace') + sum('lain'), kosongMarketplace: kosongMp, kosongLain, negatif, lengkap };
    if (negatif) catatan.push('Ada omzet bulanan bernilai negatif. Peredaran bruto tidak boleh negatif; periksa isian (refund sudah termasuk dalam penjualan dari laporan).');
    if (kosongMp.length) catatan.push(`Omzet marketplace bulan ${kosongMp.join(', ')} belum diisi. Bulan kosong tidak dianggap Rp0.`);
    if (kosongLain.length) catatan.push('Omzet usaha lain belum diisi. Batas Rp500 juta dan Rp4,8 miliar dihitung dari seluruh usaha, bukan hanya toko yang diunggah.');

    // Kumulatif seluruh usaha, untuk batas Rp500 juta (PPh final OP) dan saat surat > Rp500 juta (PMK 37/2025).
    let kum = 0;
    const perBulan = rows.map((r) => { const bruto = (r.marketplace || 0) + (r.lain || 0); kum += bruto; return { ...r, bruto, kumulatif: kum }; });
    const bulanLewat = (perBulan.find((r) => r.kumulatif > BATAS_SURAT) || {}).bulan || null;

    return { tahun, sampai, jenis: op ? 'op' : 'badan', omzet, perBulan, bulanLewat500: bulanLewat, terutang: terutang(p, tahun, op, lengkap, perBulan, omzet),
      pph22: pph22(p, tahun, op, lengkap, perBulan), aktual: aktual(p), catatan, aturan: ATURAN };
  }

  /** Simulasi PPh final terutang (hanya WP orang pribadi yang menyatakan memenuhi syarat PP 55/2022 jo. PP 20/2026). */
  function terutang(p, tahun, op, lengkap, perBulan, omzet) {
    const belum = (alasan) => ({ status: 'belum_didukung', alasan, nilai: null });
    if (!TAHUN_DIDUKUNG.includes(tahun)) return belum('tahun_belum_didukung');
    if (!op) return belum('badan_belum_didukung');
    if (p.rezim !== 'final') return belum('rezim_umum_belum_didukung');
    if (!p.syaratFinal) return belum('syarat_belum_dikonfirmasi');
    if (!lengkap) return { status: 'belum_lengkap', alasan: 'data_belum_lengkap', nilai: null };
    if (omzet.total > BATAS_FINAL) return belum('melebihi_batas_4_8_miliar');
    let sebelum = 0;
    const rinci = perBulan.map((r) => {
      // Bagian yang dikenai pajak bulan ini = peredaran bruto bulan ini di atas sisa batas Rp500 juta.
      const kena = Math.max(0, Math.min(r.bruto, r.kumulatif - BATAS_TIDAK_KENA));
      sebelum = r.kumulatif;
      return { bulan: r.bulan, bruto: r.bruto, dasarKenaPajak: kena, pajak: kena * TARIF };
    });
    const dasar = rinci.reduce((a, r) => a + r.dasarKenaPajak, 0);
    return { status: 'simulasi', alasan: '', dasarKenaPajak: dasar, tidakKenaPajak: Math.min(sebelum, BATAS_TIDAK_KENA), nilai: bulat(dasar * TARIF), perBulan: rinci };
  }

  /** Simulasi PPh 22 yang MUNGKIN dipungut marketplace pemungut (PMK 37/2025). Bukan pungutan aktual. */
  function pph22(p, tahun, op, lengkap, perBulan) {
    if (!TAHUN_DIDUKUNG.includes(tahun)) return { status: 'belum_didukung', alasan: 'tahun_belum_didukung', nilai: null };
    const mulai = MULAI_PUNGUT[tahun];
    const mpLengkap = perBulan.every((r) => r.marketplace !== null && r.marketplace >= 0);
    const totalLengkap = lengkap;
    const pungut = (dari) => perBulan.filter((r) => r.bulan >= Math.max(mulai, dari)).reduce((a, r) => a + (r.marketplace || 0) * TARIF, 0);
    const sebelumBerlaku = perBulan.filter((r) => r.bulan < mulai).reduce((a, r) => a + (r.marketplace || 0), 0);
    const dasarBerlaku = perBulan.filter((r) => r.bulan >= mulai).reduce((a, r) => a + (r.marketplace || 0), 0);
    if (!mpLengkap) return { status: 'belum_lengkap', alasan: 'omzet_marketplace_belum_lengkap', nilai: null, mulaiBulan: mulai };
    const base = { mulaiBulan: mulai, omzetSebelumBerlaku: sebelumBerlaku, dasarSetelahBerlaku: dasarBerlaku };
    // Badan dan OP tanpa surat pernyataan: dipungut atas seluruh peredaran bruto marketplace sejak aturan berlaku.
    if (!op) return { ...base, status: 'simulasi', skenario: 'badan', nilai: bulat(pungut(1)) };
    if (p.surat === 'belum') return { ...base, status: 'simulasi', skenario: 'tanpa_surat', nilai: bulat(pungut(1)) };
    // OP dengan surat: tidak dipungut sampai peredaran bruto seluruh usaha melewati Rp500 juta; pungutan mulai bulan
    // berikutnya (anggapan: surat > Rp500 juta disampaikan tepat waktu). Butuh omzet usaha lain untuk menentukan bulannya.
    const lewat = (perBulan.find((r) => r.kumulatif > BATAS_SURAT) || {}).bulan || null;
    const denganSurat = lewat ? bulat(pungut(lewat + 1)) : 0;
    if (p.surat === 'sudah') {
      if (!totalLengkap) return { ...base, status: 'belum_lengkap', alasan: 'omzet_usaha_lain_belum_diisi', nilai: null };
      return { ...base, status: 'simulasi', skenario: 'dengan_surat', nilai: denganSurat, bulanLewat500: lewat, mulaiDipungutBulan: lewat ? Math.max(mulai, lewat + 1) : null };
    }
    // Status surat tidak diketahui: tampilkan rentang dua skenario, bukan satu angka.
    return { ...base, status: 'rentang', skenario: 'surat_tidak_diketahui', nilai: null,
      minimal: totalLengkap ? denganSurat : null, maksimal: bulat(pungut(1)), bulanLewat500: totalLengkap ? lewat : null };
  }

  /** PPh 22 yang benar-benar dipungut: hanya dari isian pengguna (bukti pungut/dokumen tagihan), tidak disimulasikan. */
  function aktual(p) {
    const v = angka(p.dipungutAktual);
    return v === null ? { status: 'belum_diisi', nilai: null } : { status: 'isian', nilai: v };
  }

  /** Selisih pungutan aktual vs simulasi. Hanya bila keduanya angka; tanda + berarti dipungut lebih besar dari simulasi. */
  function selisih(h) {
    if (h.aktual.nilai === null || h.pph22.nilai === null) return null;
    return h.aktual.nilai - h.pph22.nilai;
  }

  return { hitung, selisih, ATURAN, TARIF, BATAS_TIDAK_KENA, BATAS_SURAT, BATAS_FINAL, TAHUN_DIDUKUNG, MULAI_PUNGUT };
})();
if (typeof module !== 'undefined') module.exports = CekPajak;
