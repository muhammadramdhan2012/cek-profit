/* Cek Untung — Money Trace Shopee v1: saldo penjual, penyesuaian, dan penarikan dana.
 *
 * Murni (tanpa DOM), diuji di Node: tests/saldo.test.js.
 * Input : sheet laporan saldo Shopee ("Transaction Report") dan hasil Engine.parseWorkbook untuk Laporan Penghasilan Shopee.
 * Output: rekonsiliasi saja. Modul ini TIDAK dipakai Engine.compute, sehingga omzet, HPP, laba, dan margin tidak berubah.
 *
 * Aturan (disetujui PO, Batch 3B):
 *  - Pencocokan nominal harus SAMA PERSIS (tanpa toleransi Rp1: belum ada bukti pembulatan di laporan Shopee).
 *  - Satu baris hanya boleh berpasangan dengan satu baris lain (1:1).
 *  - Penarikan dana hanya membuktikan dana keluar dari Shopee, bukan diterima bank (tidak ada data bank).
 *  - Baris tanpa pasangan tidak dianggap hilang atau salah: diberi status dan alasannya.
 */
const CekSaldo = (() => {
  const STATUS = ['cocok', 'di_luar_periode', 'belum_direkonsiliasi', 'tidak_cukup_data'];
  const KOLOM = ['Tanggal Transaksi', 'Tipe Transaksi', 'Deskripsi', 'No. Pesanan', 'Jenis Transaksi', 'Jumlah', 'Status', 'Saldo Akhir'];
  const SHEET = 'Transaction Report';

  const str = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
  const pad = (n) => String(n).padStart(2, '0');
  // Nilai di laporan saldo berupa angka bulat rupiah; teks berformat "1.234" atau "-1.234" juga diterima.
  const angka = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    const s = str(v).replace(/^(rp|idr)\s*/i, '');
    if (!s) return NaN;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
    return /^-?\d+$/.test(s) ? Number(s) : NaN;
  };
  /** "2026-10-12 23:43:19" | Date | serial Excel → { waktu: 'YYYY-MM-DD HH:MM:SS', tanggal: 'YYYY-MM-DD' } atau null */
  const waktuDari = (v) => {
    let d = null;
    if (v instanceof Date && !isNaN(v)) d = v;
    else if (typeof v === 'number' && v > 20000 && v < 80000) {
      const u = new Date(Math.round((v - 25569) * 86400000));
      const w = `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())} ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())}`;
      return { waktu: w, tanggal: w.slice(0, 10) };
    } else {
      const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      if (!m) return null;
      const w = `${m[1]}-${m[2]}-${m[3]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
      return { waktu: w, tanggal: w.slice(0, 10) };
    }
    const w = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return { waktu: w, tanggal: w.slice(0, 10) };
  };
  const JENIS = { 'Penghasilan dari Pesanan': 'pesanan', 'Penyesuaian': 'penyesuaian', 'Penarikan Dana': 'penarikan' };

  /**
   * Membaca laporan saldo Shopee. sheets = { namaSheet: array-of-arrays }.
   * Melempar Error berbahasa Indonesia bila format tidak dikenali (bukan dianggap saldo Rp0).
   */
  function parse(sheets) {
    const aoa = sheets && sheets[SHEET];
    if (!aoa) throw new Error('Sheet "Transaction Report" tidak ditemukan. Gunakan laporan transaksi Saldo Penjual dari Shopee.');
    const h = aoa.findIndex((r) => KOLOM.every((k) => (r || []).map(str).includes(k)));
    if (h < 0) throw new Error('Kolom laporan saldo tidak lengkap. Kolom yang dibutuhkan: ' + KOLOM.join(', ') + '.');
    const col = Object.fromEntries(KOLOM.map((k) => [k, aoa[h].map(str).indexOf(k)]));
    // Ringkasan di atas tabel: periode dan total resmi untuk diperiksa terhadap baris.
    const meta = { dari: '', ke: '', totalMasuk: null, totalKeluar: null, jumlahMasuk: null, jumlahKeluar: null };
    for (const r of aoa.slice(0, h)) {
      const label = str(r && r[0]);
      const nilai = (r || []).slice(1).map(angka).filter((x) => !isNaN(x));
      if (label === 'Dari') meta.dari = (waktuDari(r[1]) || {}).tanggal || '';
      if (label === 'Ke') meta.ke = (waktuDari(r[1]) || {}).tanggal || '';
      if (label === 'Total Saldo Masuk' && nilai.length >= 2) [meta.totalMasuk, meta.jumlahMasuk] = nilai;
      if (label === 'Total Saldo Keluar' && nilai.length >= 2) [meta.totalKeluar, meta.jumlahKeluar] = nilai;
    }
    const rows = [], rusak = [];
    aoa.slice(h + 1).forEach((r, i) => {
      if (!r || r.every((c) => str(c) === '')) return;
      const t = waktuDari(r[col['Tanggal Transaksi']]);
      const jumlah = angka(r[col['Jumlah']]), saldoAkhir = angka(r[col['Saldo Akhir']]);
      if (!t || isNaN(jumlah) || isNaN(saldoAkhir)) { rusak.push(h + 2 + i); return; }
      const tipe = str(r[col['Tipe Transaksi']]);
      const ref = str(r[col['No. Pesanan']]);
      rows.push({ baris: h + 2 + i, waktu: t.waktu, tanggal: t.tanggal, tipe, jenis: JENIS[tipe] || 'lain',
        deskripsi: str(r[col['Deskripsi']]), ref: ref === '-' ? '' : ref, arah: str(r[col['Jenis Transaksi']]),
        jumlah, status: str(r[col['Status']]), saldoAkhir });
    });
    if (!rows.length && !rusak.length) throw new Error('Laporan saldo tidak berisi transaksi.');
    // Laporan Shopee menulis baris terbaru lebih dulu; urutan kronologis ditentukan dari waktu, lalu urutan file.
    const desc = rows.length > 1 && rows[0].waktu >= rows[rows.length - 1].waktu;
    const kronologis = (desc ? [...rows].reverse() : [...rows]).map((x, i) => ({ ...x, urut: i }));
    kronologis.sort((a, b) => (a.waktu < b.waktu ? -1 : a.waktu > b.waktu ? 1 : a.urut - b.urut));
    const masuk = rows.filter((x) => x.jumlah > 0), keluar = rows.filter((x) => x.jumlah < 0);
    const sum = (l) => l.reduce((a, x) => a + x.jumlah, 0);
    const cocokRingkasan = meta.totalMasuk === null || meta.totalKeluar === null ? null
      : sum(masuk) === meta.totalMasuk && sum(keluar) === meta.totalKeluar && masuk.length === meta.jumlahMasuk && keluar.length === meta.jumlahKeluar;
    return { kind: 'shopee_balance', meta, rows: kronologis, barisRusak: rusak, rantai: rantai(kronologis), cocokRingkasan };
  }

  /** Saldo berantai: saldo akhir baris sebelumnya + jumlah = saldo akhir baris ini (persis). */
  function rantai(rows) {
    let putus = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].saldoAkhir + rows[i].jumlah !== rows[i].saldoAkhir) putus++;
    const awal = rows.length ? rows[0].saldoAkhir - rows[0].jumlah : null;
    const akhir = rows.length ? rows[rows.length - 1].saldoAkhir : null;
    return { berantai: putus === 0, putus, awal, akhir };
  }

  const sig = (x) => [x.waktu, x.tipe, x.deskripsi, x.ref, x.jumlah, x.saldoAkhir].join('|');

  /**
   * Gabungkan file saldo: baris yang sama persis di file lain (unggah ganda / periode tumpang tindih) dihitung sekali.
   * Di dalam satu file, baris kembar tetap dihitung semua (bisa transaksi sah yang berbeda).
   */
  function gabungSaldo(saldoFiles) {
    const maks = new Map(), contoh = new Map();
    let identik = 0;
    const sigFile = new Set();
    for (const f of saldoFiles) {
      const hit = new Map();
      for (const x of f.rows) { const s = sig(x); hit.set(s, (hit.get(s) || 0) + 1); if (!contoh.has(s)) contoh.set(s, []); }
      const fs = [...hit.entries()].sort().join('\n');
      if (sigFile.has(fs)) { identik++; continue; }
      sigFile.add(fs);
      for (const [s, n] of hit) maks.set(s, Math.max(maks.get(s) || 0, n));
      for (const x of f.rows) { const l = contoh.get(sig(x)); if (l.length < maks.get(sig(x))) l.push(x); }
    }
    const rows = [...contoh.values()].flat();
    rows.sort((a, b) => (a.waktu < b.waktu ? -1 : a.waktu > b.waktu ? 1 : a.urut - b.urut));
    const total = saldoFiles.reduce((a, f) => a + f.rows.length, 0);
    return { rows, identik, barisGanda: total - rows.length };
  }

  /** Laporan Penghasilan Shopee (hasil Engine) → pesanan & penyesuaian unik. Versi berbeda untuk nomor yang sama ditandai. */
  function gabungPenghasilan(incomeFiles) {
    const pesanan = new Map(), penyesuaian = new Map(), periode = [];
    for (const p of incomeFiles) {
      if (p.check && p.check.from && p.check.to) periode.push([p.check.from, p.check.to]);
      for (const o of p.orders) {
        const v = { ref: o.id, tanggal: o.payDate, jumlah: o.total };
        const ada = pesanan.get(o.id);
        if (!ada) pesanan.set(o.id, { ...v, konflik: false });
        else if (ada.jumlah !== v.jumlah || ada.tanggal !== v.tanggal) ada.konflik = true;
      }
      for (const a of p.adjustments) if (!penyesuaian.has(a.key)) penyesuaian.set(a.key, { ref: a.orderId, tanggal: a.date, jumlah: a.amount, tipe: a.type });
    }
    return { pesanan, penyesuaian: [...penyesuaian.values()], periode };
  }

  const dalam = (tgl, rentang) => rentang.some(([a, b]) => tgl >= a && tgl <= b);
  const kosongStatus = () => Object.fromEntries(STATUS.map((s) => [s, { n: 0, jumlah: 0 }]));

  /**
   * Rekonsiliasi saldo Shopee dengan Laporan Penghasilan Shopee.
   * @param {object[]} saldoFiles hasil parse()
   * @param {object[]} incomeFiles hasil Engine.parseWorkbook dengan kind 'shopee_income'
   */
  function trace(saldoFiles, incomeFiles = []) {
    if (!saldoFiles.length) return null;
    const G = gabungSaldo(saldoFiles);
    const I = gabungPenghasilan(incomeFiles);
    const adaPenghasilan = incomeFiles.length > 0;
    const tglSaldo = G.rows.map((x) => x.tanggal);
    const metaDari = saldoFiles.map((f) => f.meta.dari).filter(Boolean).sort(), metaKe = saldoFiles.map((f) => f.meta.ke).filter(Boolean).sort();
    const periodeSaldo = { dari: metaDari[0] || tglSaldo[0] || '', ke: metaKe[metaKe.length - 1] || tglSaldo[tglSaldo.length - 1] || '' };
    const periodePenghasilan = I.periode.length ? { dari: I.periode.map((p) => p[0]).sort()[0], ke: I.periode.map((p) => p[1]).sort().pop() } : null;
    const hariTerakhir = new Set(I.periode.map((p) => p[1]));

    const item = [];
    const pakaiPesanan = new Set(), pakaiPenyesuaian = new Set();
    for (const x of G.rows) {
      const it = { sumber: 'saldo', jenis: x.jenis, tanggal: x.tanggal, waktu: x.waktu, ref: x.ref, jumlah: x.jumlah, keterangan: x.deskripsi, status: '', alasan: '' };
      const set = (status, alasan) => { it.status = status; it.alasan = alasan; };
      if (x.status !== 'Transaksi Selesai') set('tidak_cukup_data', 'status_belum_selesai');
      else if (x.jenis === 'penarikan') set('tidak_cukup_data', 'tanpa_data_bank');
      else if (x.jenis === 'lain') set('tidak_cukup_data', 'jenis_belum_dikenali');
      else if (!adaPenghasilan) set('tidak_cukup_data', 'laporan_penghasilan_tidak_ada');
      else if (x.jenis === 'pesanan') {
        const o = x.ref ? I.pesanan.get(x.ref) : null;
        if (!x.ref) set('tidak_cukup_data', 'tanpa_nomor_pesanan');
        else if (!o) set(dalam(x.tanggal, I.periode) ? 'belum_direkonsiliasi' : 'di_luar_periode',
          dalam(x.tanggal, I.periode) ? (hariTerakhir.has(x.tanggal) ? 'tidak_ada_di_penghasilan_hari_terakhir' : 'tidak_ada_di_penghasilan') : 'di_luar_periode_penghasilan');
        else if (pakaiPesanan.has(x.ref)) set('belum_direkonsiliasi', 'pasangan_sudah_dipakai');
        else if (o.konflik) set('belum_direkonsiliasi', 'versi_penghasilan_berbeda');
        else if (o.jumlah !== x.jumlah) set('belum_direkonsiliasi', 'nominal_berbeda');
        else if (o.tanggal !== x.tanggal) set('belum_direkonsiliasi', 'tanggal_berbeda');
        else { set('cocok', ''); pakaiPesanan.add(x.ref); }
      } else {   // penyesuaian: tanggal dan nominal sama persis; nomor pesanan harus sama bila keduanya ada
        const k = I.penyesuaian.findIndex((a, i) => !pakaiPenyesuaian.has(i) && a.jumlah === x.jumlah && a.tanggal === x.tanggal && (!a.ref || !x.ref || a.ref === x.ref));
        if (k >= 0) { pakaiPenyesuaian.add(k); set('cocok', ''); }
        else set(dalam(x.tanggal, I.periode) ? 'belum_direkonsiliasi' : 'di_luar_periode', dalam(x.tanggal, I.periode) ? 'penyesuaian_tanpa_pasangan' : 'di_luar_periode_penghasilan');
      }
      item.push(it);
    }
    // Sisi Laporan Penghasilan yang tidak punya pasangan di saldo.
    const diSaldo = (tgl) => tgl >= periodeSaldo.dari && tgl <= periodeSaldo.ke;
    for (const o of I.pesanan.values()) {
      if (pakaiPesanan.has(o.ref)) continue;
      const it = { sumber: 'penghasilan', jenis: 'pesanan', tanggal: o.tanggal, ref: o.ref, jumlah: o.jumlah, keterangan: 'Pesanan di Laporan Penghasilan' };
      if (G.rows.some((x) => x.ref === o.ref)) Object.assign(it, { status: 'belum_direkonsiliasi', alasan: o.konflik ? 'versi_penghasilan_berbeda' : 'nominal_atau_tanggal_berbeda' });
      else if (o.jumlah === 0) Object.assign(it, { status: 'tidak_cukup_data', alasan: 'nilai_nol_tanpa_mutasi' });
      else if (!diSaldo(o.tanggal)) Object.assign(it, { status: 'di_luar_periode', alasan: 'di_luar_periode_saldo' });
      else Object.assign(it, { status: 'belum_direkonsiliasi', alasan: 'tidak_ada_di_saldo' });
      item.push(it);
    }
    I.penyesuaian.forEach((a, i) => {
      if (pakaiPenyesuaian.has(i)) return;
      item.push({ sumber: 'penghasilan', jenis: 'penyesuaian', tanggal: a.tanggal, ref: a.ref, jumlah: a.jumlah, keterangan: a.tipe,
        status: diSaldo(a.tanggal) ? 'belum_direkonsiliasi' : 'di_luar_periode', alasan: diSaldo(a.tanggal) ? 'tidak_ada_di_saldo' : 'di_luar_periode_saldo' });
    });

    const status = { saldo: kosongStatus(), penghasilan: kosongStatus() };
    for (const it of item) { const s = status[it.sumber][it.status]; s.n++; s.jumlah += it.jumlah; }
    const kelompok = {};
    for (const j of ['pesanan', 'penyesuaian', 'penarikan', 'lain']) {
      const l = G.rows.filter((x) => x.jenis === j);
      kelompok[j] = { n: l.length, jumlah: l.reduce((a, x) => a + x.jumlah, 0) };
    }
    const r = rantai(G.rows);
    const masuk = G.rows.filter((x) => x.jumlah > 0).reduce((a, x) => a + x.jumlah, 0);
    const keluar = G.rows.filter((x) => x.jumlah < 0).reduce((a, x) => a + x.jumlah, 0);
    const adjSaldo = item.filter((x) => x.sumber === 'saldo' && x.jenis === 'penyesuaian');
    const adjCocok = adjSaldo.filter((x) => x.status === 'cocok').reduce((a, x) => a + x.jumlah, 0);
    return {
      versi: 'saldo-shopee-v1',
      file: { jumlah: saldoFiles.length, identik: G.identik, barisGanda: G.barisGanda, cocokRingkasan: saldoFiles.every((f) => f.cocokRingkasan !== false),
        barisRusak: saldoFiles.reduce((a, f) => a + f.barisRusak.length, 0) },
      periode: { saldo: periodeSaldo, penghasilan: periodePenghasilan },
      // Saldo awal = saldo sebelum transaksi pertama di file. Persamaan awal + masuk + keluar = akhir hanya diklaim bila berantai.
      saldo: { awal: r.awal, masuk, keluar, akhir: r.akhir, berantai: r.berantai, putus: r.putus, persamaan: r.awal + masuk + keluar === r.akhir },
      kelompok,
      penyesuaian: { saldo: kelompok.penyesuaian.jumlah, cocok: adjCocok, belumTerjelaskan: kelompok.penyesuaian.jumlah - adjCocok },
      status,
      item,
    };
  }

  return { parse, trace, STATUS };
})();
if (typeof module !== 'undefined') module.exports = CekSaldo;
