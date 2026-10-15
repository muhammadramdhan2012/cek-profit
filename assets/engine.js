/* Cek Profit — mesin hitung.
 *
 * Murni: input = workbook {name, sheets: {namaSheet: array-of-arrays}}, output = angka.
 * Tidak menyentuh DOM, sehingga bisa diuji di Node (lihat tests/).
 *
 * Prinsip:
 *  - Modal yang belum diketahui TIDAK dianggap 0. Pesanan tanpa modal dikeluarkan dari margin
 *    dan dilaporkan lewat `coverage` (porsi penjualan yang modalnya diketahui).
 *  - Semua uang dalam Rupiah (number). Potongan/biaya bertanda negatif seperti di laporan marketplace.
 */
const Engine = (() => {
  /* ---------- utilitas ---------- */
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).replace(/[\r\n\t]/g, '').trim();
    if (!s || s === '-' || s === '/') return 0;
    s = s.replace(/^(rp|idr)\s*/i, '').replace(/^-\s*(rp|idr)\s*/i, '-').trim();
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isFinite(n) ? n : 0;
  };
  const str = (v) => (v === null || v === undefined ? '' : String(v)).replace(/[\r\t]/g, '').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const date = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const s = str(v);
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return '';
  };
  /** Nama produk dinormalisasi untuk pencocokan: huruf kecil, spasi tunggal, tanpa tanda baca. */
  const norm = (s) => str(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const isOk = (v) => typeof v === 'number' && isFinite(v);
  const clamp01 = (x) => (isOk(x) ? Math.min(1, Math.max(0, x)) : 1);

  const findHeader = (aoa, names) => aoa.findIndex((row) => Array.isArray(row) && names.every((n) => row.some((c) => str(c) === n)));
  const colMap = (row) => { const m = {}; row.forEach((c, i) => { const k = str(c); if (k && !(k in m)) m[k] = i; }); return m; };
  const getter = (row, map) => (name) => (name in map ? row[map[name]] : '');
  /** Ambil nilai kolom pertama yang ada dari beberapa kemungkinan nama (bahasa Indonesia/Inggris). */
  const getterAny = (row, map) => (...names) => { for (const n of names) if (n in map) return row[map[n]]; return ''; };
  /**
   * Seperti getterAny, tetapi mengambil kolom pertama yang ISINYA tidak kosong.
   * Dipakai untuk SKU Shopee: kolom "Nomor Referensi SKU" bisa ada tetapi kosong (SKU itu opsional
   * bagi seller), sehingga getterAny akan berhenti di kolom kosong itu. getterAny sengaja tidak diubah
   * karena dipakai parser lain yang sudah stabil.
   */
  const getterFilled = (row, map) => (...names) => { for (const n of names) if (n in map && str(row[map[n]]) !== '') return row[map[n]]; return ''; };
  const hasAny = (row, names) => names.some((n) => row.some((c) => str(c) === n));
  const firstSheetHeader = (wb, test) => {
    for (const [sheet, aoa] of Object.entries(wb.sheets)) {
      const h = aoa.slice(0, 30).findIndex((row) => Array.isArray(row) && test(row));
      if (h >= 0) return { sheet, aoa, h };
    }
    return null;
  };
  const headerHas = (names) => (row) => names.every((n) => row.some((c) => str(c) === n));
  const lastValue = (row) => row.filter((c) => str(c) !== '').slice(-1)[0];

  /* ---------- kolom export pesanan (alias ID/EN) ---------- */
  const COL = {
    shopeeOrderId: ['No. Pesanan'],
    shopeeQty: ['Jumlah'],
    shopeeSku: ['Nomor Referensi SKU', 'SKU Induk'],
    shopeeVar: ['Nama Variasi'],
    shopeeName: ['Nama Produk'],
    shopeePrice: ['Harga Setelah Diskon', 'Harga Awal'],
    shopeeStatus: ['Status Pesanan'],
    // Kolom tambahan export Shopee yang sudah divalidasi (H1/H3). Dipakai pencocok (Fase 2) untuk kuantitas dan
    // tanda status/refund; rumus refund dan laba tidak memakainya secara langsung.
    shopeeSkuVariant: ['Nomor Referensi SKU'],   // SKU per variasi (opsional, sering kosong)
    shopeeSkuParent: ['SKU Induk'],              // SKU tingkat produk (opsional)
    shopeeSubtotal: ['Subtotal Pesanan'],        // per baris; pada export yang divalidasi = Jumlah × Harga Setelah Diskon
    shopeePriceAfterDisc: ['Harga Setelah Diskon'],
    shopeeReturnedQty: ['Returned quantity'],    // unit yang DIREFUND, bukan unit yang kembali ke stok
    shopeeReturnStatus: ['Status Pembatalan/ Pengembalian'],
    ttOrderId: ['Order ID', 'ID Pesanan'],
    ttSkuId: ['SKU ID', 'ID SKU'],
    ttSellerSku: ['Seller SKU', 'SKU Penjual'],
    ttName: ['Product Name', 'Nama Produk'],
    ttVar: ['Variation', 'Variasi'],
    ttQty: ['Quantity', 'Kuantitas', 'Jumlah'],
    ttSubtotal: ['SKU Subtotal After Discount', 'Subtotal SKU Setelah Diskon', 'Subtotal SKU setelah diskon'],
    ttStatus: ['Order Status', 'Status Pesanan'],
  };
  const isShopeeOrderHeader = (row) => hasAny(row, COL.shopeeOrderId) && hasAny(row, COL.shopeeQty) && hasAny(row, COL.shopeeName)
    && hasAny(row, [...COL.shopeeVar, ...COL.shopeeSku]) && !hasAny(row, ['No. Pengembalian']) && !hasAny(row, ['Lihat berdasarkan']);
  const isTiktokOrderHeader = (row) => hasAny(row, COL.ttOrderId) && hasAny(row, COL.ttSkuId) && hasAny(row, COL.ttQty) && !hasAny(row, ['Return Order ID']);
  const isModalTemplateHeader = headerHas(['Kode', 'Modal per unit (Rp)']);

  /* ---------- deteksi jenis file ---------- */
  function detect(wb) {
    const names = Object.keys(wb.sheets);
    if (names.includes('Penghasilan') && names.includes('Summary')) return 'shopee_income';
    if (names.includes('Detail pesanan')) return 'tiktok_income';
    if (names.includes('Transaction Report')) return 'shopee_balance';
    if (firstSheetHeader(wb, isModalTemplateHeader)) return 'modal_template';
    if (firstSheetHeader(wb, headerHas(['No. Pengembalian', 'Solusi Pengembalian Barang/Dana']))) return 'shopee_return';
    if (firstSheetHeader(wb, headerHas(['Return Order ID', 'Order ID']))) return 'tiktok_return';
    if (firstSheetHeader(wb, isShopeeOrderHeader)) return 'shopee_orders';
    if (firstSheetHeader(wb, isTiktokOrderHeader)) return 'tiktok_orders';
    return 'unknown';
  }

  /* ---------- Shopee: laporan penghasilan ---------- */
  const SH_SHIP = ['Ongkir Dibayar Pembeli', 'Ongkos Kirim yang Dibayarkan ke Jasa Kirim', 'Potongan Ongkos Kirim dari Jasa Kirim',
    'Gratis Ongkir dari Shopee', 'Ongkos Kirim Pengembalian Barang', 'Return to Seller Fee', 'Pengembalian Biaya Kirim'];
  const SH_VOUCHER = ['Voucher disponsor oleh Penjual', 'Cashback Koin disponsori Penjual', 'Diskon Produk dari Shopee',
    'Voucher co-fund disponsor oleh Penjual', 'Cashback Koin Co-fund disponsori Penjual'];
  const SH_XTRA = ['Biaya Layanan Gratis Ongkir XTRA (Kategori D)', 'Biaya Layanan Gratis Ongkir XTRA (Kategori E)',
    'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)', 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)', 'Biaya Layanan Gratis Ongkir XTRA'];
  const SH_AMS = ['Biaya Komisi AMS'];

  function parseShopeeIncome(wb) {
    const aoa = wb.sheets['Penghasilan'];
    const h = findHeader(aoa, ['No. Pesanan', 'Lihat berdasarkan']);
    if (h < 0) throw new Error('Kolom "No. Pesanan" tidak ditemukan di sheet Penghasilan.');
    const map = colMap(aoa[h]);
    const orders = [], items = [];
    for (const row of aoa.slice(h + 1)) {
      const g = getter(row, map);
      const type = str(g('Lihat berdasarkan'));
      const id = str(g('No. Pesanan'));
      if (!id || (type !== 'Order' && type !== 'Sku')) continue;
      const harga = num(g('Harga Produk')), refund = num(g('Jumlah Pengembalian Dana ke Pembeli')), total = num(g('Total Penghasilan'));
      const orderDate = date(g('Waktu Pesanan Dibuat')), payDate = date(g('Tanggal Dana Dilepaskan'));
      if (type === 'Sku') {
        items.push({ orderId: id, productId: str(g('ID Produk')), name: str(g('Nama Produk')), harga, refund, total, orderDate });
        continue;
      }
      const ship = SH_SHIP.reduce((a, c) => a + num(g(c)), 0);
      const voucher = SH_VOUCHER.reduce((a, c) => a + num(g(c)), 0);
      const admin = num(g('Biaya Administrasi')), proses = num(g('Biaya Proses Pesanan'));
      const xtra = SH_XTRA.reduce((a, c) => a + num(g(c)), 0);
      const ams = SH_AMS.reduce((a, c) => a + num(g(c)), 0);
      // Kolom biaya lain/baru apa pun tertangkap sebagai selisih terhadap Total Penghasilan.
      const lain = total - (harga + refund + ship + voucher + admin + proses + xtra + ams);
      orders.push({ id, orderDate, payDate, harga, refund, voucher, ship, admin, proses, xtra, ams, lain, total });
    }
    let summaryTotal = null, from = '', to = '';
    for (const row of wb.sheets['Summary'] || []) {
      const label = str(row[0]);
      if (/Total yang Dilepas/i.test(label)) summaryTotal = num(lastValue(row));
      if (label === 'Dari') from = date(row[1]);
      if (/^ke$/i.test(label)) to = date(row[1]);
    }
    const adjustments = [];
    const adj = wb.sheets['Adjustment'];
    if (adj) {
      const ah = findHeader(adj, ['Tipe Penyesuaian | Deskripsi']);
      if (ah >= 0) {
        const am = colMap(adj[ah]);
        for (const row of adj.slice(ah + 1)) {
          const g = getter(row, am);
          const tipe = str(g('Tipe Penyesuaian | Deskripsi'));
          if (!tipe) break;
          const d = date(g('Tanggal Penyesuaian Dibuat')), amt = num(g('Biaya Penyesuaian')), oid = str(g('No. Pesanan Terhubung'));
          adjustments.push({ key: `${d}|${tipe}|${amt}|${oid}`, date: d, type: tipe, amount: amt, orderId: oid });
        }
      }
    }
    return { kind: 'shopee_income', orders, items, adjustments,
      check: { summaryTotal, sum: orders.reduce((a, o) => a + o.total, 0), from, to } };
  }

  /* ---------- TikTok: laporan penghasilan ---------- */
  const TT_FEES = { platform: 'Biaya komisi platform', dinamis: 'Komisi dinamis', proses: 'Biaya pemrosesan pesanan', ongkir: 'Ongkir' };
  const TT_AFF = ['Komisi Afiliasi', 'Komisi mitra afiliasi', 'Komisi Iklan Toko afiliasi', 'Deposit komisi afiliasi',
    'Pengembalian dana komisi afiliasi', 'Komisi iklan toko Mitra Afiliasi'];
  /** "1732… * 1;\n1734… * 2;" → [{skuId, qty}] */
  const parseSoldDetail = (v) => {
    const out = [];
    for (const m of str(v).matchAll(/(\d{6,})\s*\*\s*(\d+)/g)) out.push({ skuId: m[1], qty: +m[2] });
    return out;
  };
  function parseTiktokIncome(wb) {
    const aoa = wb.sheets['Detail pesanan'];
    const h = findHeader(aoa, ['ID Pesanan/Penyesuaian', 'Jenis transaksi']);
    if (h < 0) throw new Error('Kolom "ID Pesanan/Penyesuaian" tidak ditemukan.');
    const map = colMap(aoa[h]);
    const rows = [];
    for (const row of aoa.slice(h + 1)) {
      const g = getter(row, map);
      const id = str(g('ID Pesanan/Penyesuaian'));
      if (!id) continue;
      const jenis = str(g('Jenis transaksi'));
      const settle = num(g('Jumlah penyelesaian pembayaran'));
      const totalBiaya = num(g('Total Biaya'));
      const fees = {};
      let known = 0;
      for (const [k, c] of Object.entries(TT_FEES)) { fees[k] = num(g(c)); known += fees[k]; }
      fees.afiliasi = TT_AFF.reduce((a, c) => a + num(g(c)), 0); known += fees.afiliasi;
      fees.lain = totalBiaya - known;   // pre-order, layanan program, dan biaya baru lainnya
      rows.push({
        key: `${id}|${jenis}|${date(g('Waktu pembayaran pesanan'))}|${settle}|${num(g('Total Pendapatan'))}`,
        id, jenis, isOrder: jenis === 'Pesanan', source: str(g('Sumber pesanan')),
        orderDate: date(g('Waktu pemesanan')), payDate: date(g('Waktu pembayaran pesanan')),
        pre: num(g('Subtotal sebelum diskon')) + num(g('Total pengembalian dana sebelum diskon')),
        preGross: num(g('Subtotal sebelum diskon')),
        sales: num(g('Total Pendapatan')), fees, totalBiaya, settle,
        lines: parseSoldDetail(g('Detail produk terjual')),
      });
    }
    let reportSettle = null;
    for (const row of wb.sheets['Laporan'] || []) {
      if (row.some((c) => str(c) === 'Jumlah penyelesaian pembayaran')) { reportSettle = num(lastValue(row)); break; }
    }
    const dates = rows.map((r) => r.payDate).filter(Boolean).sort();
    return { kind: 'tiktok_income', rows,
      check: { reportSettle, sum: rows.reduce((a, r) => a + r.settle, 0), from: dates[0] || '', to: dates[dates.length - 1] || '' } };
  }

  /* ---------- export pesanan (memberi jumlah barang, SKU, varian) ---------- */
  function parseShopeeOrders(wb) {
    const f = firstSheetHeader(wb, isShopeeOrderHeader);
    const map = colMap(f.aoa[f.h]);
    const lines = [];
    const hasReturnStatusCol = COL.shopeeReturnStatus.some((n) => n in map);
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getterAny(row, map);
      const orderId = str(g(...COL.shopeeOrderId));
      const qty = num(g(...COL.shopeeQty));
      if (!orderId || !(qty > 0)) continue;
      // Kolom angka opsional: kosong, tidak ada, atau berisi teks tanpa angka → NaN,
      // supaya "tidak ada data" tidak tertukar dengan angka 0 (num() mengubah teks seperti "-" menjadi 0).
      const optNum = (names) => {
        const v = g(...names);
        if (typeof v === 'number') return isFinite(v) ? v : NaN;
        return /\d/.test(str(v)) ? num(v) : NaN;
      };
      const filled = getterFilled(row, map);
      lines.push({ orderId, name: str(g(...COL.shopeeName)), sku: str(g(...COL.shopeeSku)), variant: str(g(...COL.shopeeVar)),
        qty, unitPrice: num(g(...COL.shopeePrice)), status: str(g(...COL.shopeeStatus)),
        // Field tambahan (H1/H3). Field lama di atas tidak diubah agar perhitungan yang berjalan tetap sama.
        // SKU variasi dan SKU induk disimpan TERPISAH. SKU induk berlaku untuk satu produk (semua variasinya),
        // jadi tidak boleh dipakai sebagai identitas variasi.
        skuVariant: str(filled(...COL.shopeeSkuVariant)), skuParent: str(filled(...COL.shopeeSkuParent)),
        subtotal: optNum(COL.shopeeSubtotal), priceAfterDisc: optNum(COL.shopeePriceAfterDisc),
        // Fase 2.1: null = kolom status pembatalan/pengembalian TIDAK ADA di file ini (informasi tidak tersedia),
        // berbeda dari '' = kolomnya ada tetapi kosong (tidak ada tanda retur saat export dibuat).
        returnedQty: optNum(COL.shopeeReturnedQty),
        returnStatus: hasReturnStatusCol ? str(g(...COL.shopeeReturnStatus)) : null });
    }
    return { kind: 'shopee_orders', lines };
  }
  function parseTiktokOrders(wb) {
    const f = firstSheetHeader(wb, isTiktokOrderHeader);
    const map = colMap(f.aoa[f.h]);
    const lines = [];
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getterAny(row, map);
      const orderId = str(g(...COL.ttOrderId)).replace(/^'/, '');
      const qty = num(g(...COL.ttQty));
      if (!/^\d{6,}$/.test(orderId) || !(qty > 0)) continue;   // baris ke-2 CSV TikTok berisi keterangan kolom
      lines.push({ orderId, skuId: str(g(...COL.ttSkuId)).replace(/^'/, ''), sellerSku: str(g(...COL.ttSellerSku)),
        name: str(g(...COL.ttName)), variant: str(g(...COL.ttVar)), qty, subtotal: num(g(...COL.ttSubtotal)), status: str(g(...COL.ttStatus)) });
    }
    return { kind: 'tiktok_orders', lines };
  }

  /* ---------- pencocokan Laporan Penghasilan Shopee ↔ export pesanan (H1/H3, Fase 1) ----------
   * Pada data yang sudah divalidasi, Laporan Penghasilan Shopee punya SATU baris per variasi produk, tetapi
   * tidak mencatat nama variasi, jumlah barang, maupun SKU. Export pesanan mencatat semuanya.
   * Fungsi di bawah memasangkan keduanya.
   *
   * Aturan (docs/KAMUS_ANGKA.md A.19.4–A.19.5, disetujui sebagai dasar desain):
   *  - Hanya di dalam NOMOR PESANAN YANG SAMA. Tidak pernah lintas pesanan.
   *  - Pertama dikelompokkan per nama produk, lalu dipasangkan lewat NILAI:
   *    "Harga Produk" di laporan harus sama dengan "Subtotal Pesanan" di export (toleransi 0).
   *  - Urutan baris TIDAK dipakai untuk menebak.
   *  - Satu baris export hanya boleh dipakai sekali → jumlah barang tidak terhitung ganda.
   *  - Kalau tidak bisa dipastikan, status dibiarkan "belum"/"ambigu". Tidak ada tebakan.
   *
   * Arti status:
   *  qtyStatus     terverifikasi = jumlah barang terbukti dari export
   *                belum         = tidak ada bukti yang cukup
   *  variantStatus terverifikasi = variasi yang terjual diketahui pasti
   *                tidak_relevan = produk tanpa variasi (nama variasi kosong di export)
   *                ambigu        = beberapa variasi bernilai sama; mana yang mana tidak bisa dipastikan
   *                belum         = tidak ada pasangan sama sekali
   *
   * Nilai `rule` (alasan hasil): M0 (pesanan tidak ada di export), M1, M2 (pasangan pasti),
   *  M2_ambigu (nilai kembar), nama_tidak_ditemukan, nilai_tidak_cocok, jumlah_kandidat_beda, pesanan_lain.
   *
   * BATAS: status pesanan belum diperiksa. Aturan ini baru divalidasi untuk export "pesanan selesai".
   * Baris dengan status lain (mis. batal) tetap ikut dicocokkan dan hanya DITANDAI di `nonCompletedLines`;
   * keputusan perlakuannya menunggu H2. Pasangan "terverifikasi" berarti jumlah/variasi tercatat di export,
   * BUKAN berarti barang pasti terkirim atau tidak dikembalikan.
   *
   * Fungsi ini MURNI (tidak mengubah input, tidak menyentuh DOM). Sejak Fase 2 dipakai shopeeOrderModal,
   * hanya untuk mode modal per produk.
   */

  /** Nilai rupiah satu baris export: Subtotal Pesanan; bila kolomnya tidak ada, Jumlah × Harga Setelah Diskon. */
  const shopeeLineValue = (l) => {
    if (isOk(l.subtotal)) return l.subtotal;
    if (isOk(l.priceAfterDisc)) return l.qty * l.priceAfterDisc;
    return NaN;   // hanya ada "Harga Awal" atau tidak ada harga → tidak bisa dibandingkan
  };
  const sameValue = (a, b, tol) => isOk(a) && isOk(b) && Math.abs(Math.round(a) - Math.round(b)) <= tol;

  /**
   * @param {string} orderId  nomor pesanan yang dicocokkan
   * @param {{orderId:string,name:string,harga:number}[]} items  baris produk Laporan Penghasilan (pesanan ini)
   * @param {{orderId:string,name:string,variant:string,qty:number}[]} lines  baris export pesanan
   * @returns {{orderId:string, items:object[], groups:object[], unusedLines:number[], nonCompletedLines:number[],
   *            ignored:{items:number,lines:number}}}
   *   items[i] sejajar dengan input items: {rule, qtyStatus, variantStatus, qty, lineIdx, candidateIdx, groupId}
   *   lineIdx / candidateIdx menunjuk indeks di array `lines` yang diberikan.
   */
  function matchShopeeOrder(orderId, items, lines) {
    const tol = 0;   // nilai harus sama persis (keputusan pemilik D2). Toleransi lain butuh izin baru.
    const out = { orderId, items: [], groups: [], unusedLines: [], nonCompletedLines: [], ignored: { items: 0, lines: 0 } };
    const blank = (rule) => ({ rule, qtyStatus: 'belum', variantStatus: 'belum', qty: null, lineIdx: [], candidateIdx: [], groupId: null });

    // Syarat dasar: hanya baris dengan nomor pesanan yang sama yang ikut dicocokkan.
    const myLines = [];
    lines.forEach((l, i) => { if (str(l.orderId) === str(orderId)) myLines.push(i); else out.ignored.lines++; });
    // Tandai (tidak dibuang) baris yang statusnya diketahui dan bukan "Selesai". Lihat BATAS di atas.
    out.nonCompletedLines = myLines.filter((j) => str(lines[j].status) && str(lines[j].status) !== 'Selesai');
    items.forEach((it) => { if (str(it.orderId) !== str(orderId)) out.ignored.items++; });
    out.items = items.map((it) => blank(str(it.orderId) === str(orderId) ? 'M0' : 'pesanan_lain'));

    const used = new Set();   // pencegah hitung ganda: indeks baris export yang sudah dipakai
    const variantOf = (idx) => (str(lines[idx].variant) ? 'terverifikasi' : 'tidak_relevan');

    // Kelompokkan per nama produk (dinormalisasi) di dalam pesanan ini.
    const byName = new Map();
    items.forEach((it, i) => {
      if (out.items[i].rule === 'pesanan_lain') return;
      const k = norm(it.name);
      if (!byName.has(k)) byName.set(k, { itemIdx: [], lineIdx: [] });
      byName.get(k).itemIdx.push(i);
    });
    for (const i of myLines) { const k = norm(lines[i].name); if (byName.has(k)) byName.get(k).lineIdx.push(i); }

    for (const { itemIdx, lineIdx } of byName.values()) {
      if (!myLines.length) continue;                         // M0: pesanan ini tidak ada di export
      if (!lineIdx.length) { itemIdx.forEach((i) => { out.items[i].rule = 'nama_tidak_ditemukan'; }); continue; }

      // M1: tepat satu baris laporan ↔ satu baris export bernama sama, dan nilainya sama.
      if (itemIdx.length === 1 && lineIdx.length === 1) {
        const i = itemIdx[0], j = lineIdx[0];
        if (sameValue(items[i].harga, shopeeLineValue(lines[j]), tol)) {
          used.add(j);
          Object.assign(out.items[i], { rule: 'M1', qtyStatus: 'terverifikasi', variantStatus: variantOf(j), qty: lines[j].qty, lineIdx: [j], candidateIdx: [j] });
        } else out.items[i].rule = 'nilai_tidak_cocok';
        continue;
      }

      // M2: beberapa baris bernama sama. Pasangkan per NILAI yang sama persis.
      const valueKey = (v) => (isOk(v) ? String(Math.round(v)) : 'NaN');
      const linesByVal = new Map();
      for (const j of lineIdx) {
        const k = valueKey(shopeeLineValue(lines[j]));
        if (!linesByVal.has(k)) linesByVal.set(k, []);
        linesByVal.get(k).push(j);
      }
      const itemsByVal = new Map();
      for (const i of itemIdx) {
        const k = valueKey(items[i].harga);
        if (!itemsByVal.has(k)) itemsByVal.set(k, []);
        itemsByVal.get(k).push(i);
      }
      for (const [k, its] of itemsByVal) {
        const cand = k === 'NaN' ? [] : (linesByVal.get(k) || []).filter((j) => !used.has(j));
        if (!cand.length) { its.forEach((i) => { out.items[i].rule = 'nilai_tidak_cocok'; }); continue; }
        if (its.length === 1 && cand.length === 1) {
          // Pasangan unik: pasti.
          const i = its[0], j = cand[0];
          used.add(j);
          Object.assign(out.items[i], { rule: 'M2', qtyStatus: 'terverifikasi', variantStatus: variantOf(j), qty: lines[j].qty, lineIdx: [j], candidateIdx: [j] });
          continue;
        }
        if (its.length === cand.length) {
          // Nilai kembar (mis. dua variasi berharga sama). Kita tahu kelompok baris export ini milik
          // kelompok baris laporan ini, tetapi TIDAK tahu pasangan per baris. Jangan menebak:
          // variasi = ambigu. Jumlah barang hanya pasti bila semua kandidat punya jumlah yang sama.
          const qtys = new Set(cand.map((j) => lines[j].qty));
          const qtyOk = qtys.size === 1;
          const groupId = out.groups.length;
          cand.forEach((j) => used.add(j));
          out.groups.push({ groupId, itemIdx: its.slice(), lineIdx: cand.slice(), qtyTotal: cand.reduce((a, j) => a + lines[j].qty, 0), complete: true });
          its.forEach((i) => Object.assign(out.items[i], {
            rule: 'M2_ambigu', qtyStatus: qtyOk ? 'terverifikasi' : 'belum', variantStatus: 'ambigu',
            qty: qtyOk ? lines[cand[0]].qty : null, lineIdx: [], candidateIdx: cand.slice(), groupId }));
          continue;
        }
        // Jumlah baris laporan ≠ jumlah kandidat bernilai sama → tidak bisa dipasangkan. Baris export
        // tidak dipakai (tetap tersedia) dan statusnya belum.
        its.forEach((i) => Object.assign(out.items[i], { rule: 'jumlah_kandidat_beda', variantStatus: 'ambigu', candidateIdx: cand.slice() }));
      }
    }
    // M4: baris export yang tidak terpakai dicatat, tetapi tidak dipakai untuk pesanan lain.
    out.unusedLines = myLines.filter((j) => !used.has(j));
    return out;
  }

  /* ---------- template modal per produk ---------- */
  const TEMPLATE_HEADER = ['Platform', 'Kode', 'Nama produk', 'Variasi', 'Terjual', 'Harga jual rata-rata (Rp)', 'Modal per unit (Rp)'];
  function parseModalTemplate(wb) {
    const f = firstSheetHeader(wb, isModalTemplateHeader);
    const map = colMap(f.aoa[f.h]);
    const entries = [];
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getter(row, map);
      const raw = g('Modal per unit (Rp)');
      if (str(raw) === '') continue;
      const cost = num(raw);
      const kode = str(g('Kode')), nama = str(g('Nama produk')), variasi = str(g('Variasi'));
      if (!(cost >= 0) || (!kode && !nama)) continue;
      entries.push({ kode, nama, variasi, cost });
    }
    return { kind: 'modal_template', entries };
  }

  /* ---------- retur ---------- */
  /**
   * Baca jumlah unit dari file retur (H2-A). Membedakan:
   *  'ada'         angka valid (termasuk 0 yang ditulis eksplisit)
   *  'kosong'      kolom ada tetapi sel kosong
   *  'tidak_valid' kolom ada tetapi isinya bukan angka ≥ 0
   *  'tidak_ada'   kolom tidak ada di file
   * Selain 'ada', nilainya NaN (tidak diketahui). Tidak pernah diganti 1 atau 0.
   * Dipakai untuk jumlah unit retur dan nominal refund (keduanya tidak boleh negatif).
   */
  function optField(row, map, names) {
    const name = names.find((n) => n in map);
    if (!name) return { value: NaN, info: 'tidak_ada' };
    const v = row[map[name]];
    if (str(v) === '') return { value: NaN, info: 'kosong' };
    const n = typeof v === 'number' ? v : (/\d/.test(str(v)) ? num(v) : NaN);
    return isOk(n) && n >= 0 ? { value: n, info: 'ada' } : { value: NaN, info: 'tidak_valid' };
  }
  const returnQty = (row, map, names) => { const f = optField(row, map, names); return { qty: f.value, qtyInfo: f.info }; };

  function parseShopeeReturn(wb) {
    const f = firstSheetHeader(wb, headerHas(['No. Pengembalian', 'Solusi Pengembalian Barang/Dana']));
    const map = colMap(f.aoa[f.h]);
    const cases = [];
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getter(row, map);
      const rid = str(g('No. Pengembalian'));
      if (!rid) continue;
      const status = str(g('Status Pembatalan/ Pengembalian')), solusi = str(g('Solusi Pengembalian Barang/Dana'));
      const alasan = str(g('Alasan Pengembalian'));
      let cat;
      if (/dibatalkan/i.test(status)) cat = 'batal';
      else if (/barang dan dana/i.test(solusi)) cat = 'retur_barang';
      else if (/tidak lengkap/i.test(alasan)) cat = 'tidak_dikirim';
      else if (/tidak menerima/i.test(alasan)) cat = 'paket_bermasalah';
      else cat = 'refund_tanpa_retur';
      cases.push({ key: `S|${rid}|${str(g('Nama Produk'))}|${str(g('Variasi'))}`, platform: 'shopee', orderId: str(g('No. Pesanan')),
        product: str(g('Nama Produk')), variant: str(g('Variasi')), reason: alasan, note: str(g('Catatan Pengembalian Barang')),
        resi: str(g('No. Resi Pengembalian Barang')), returnStatus: str(g('Status Pengembalian Barang')),
        // H2-A/K1: kolom di file asli bernama "Jumlah Produk Dikembalikan" (unit yang direfund). Kolom "Jumlah"
        // tetap didukung untuk format lama. Sebelumnya kolom yang tidak ada terbaca 1.
        ...returnQty(row, map, ['Jumlah Produk Dikembalikan', 'Jumlah']),
        // H2-A/P2: nominal refund kosong/tidak valid = tidak diketahui (dulu terbaca Rp0). Nol eksplisit tetap 0.
        ...(({ value, info }) => ({ amount: value, amountInfo: info, amountSource: info === 'ada' ? 'file_retur' : null }))(optField(row, map, ['Total Pengembalian Dana'])),
        date: date(g('Waktu Pengembalian Diajukan')), cat });
    }
    return { kind: 'shopee_return', cases };
  }
  function parseTiktokReturn(wb) {
    const f = firstSheetHeader(wb, headerHas(['Return Order ID', 'Order ID']));
    const map = colMap(f.aoa[f.h]);
    const cases = [];
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getter(row, map);
      const rid = str(g('Return Order ID'));
      if (!rid) continue;
      // H2-A: jumlah kosong/tidak valid = tidak diketahui (dulu dianggap 1).
      // P1: file retur TikTok tidak punya kolom nominal refund, jadi nominal = harga satuan × jumlah, HANYA bila
      // harga valid dan jumlah > 0. Jumlah 0 bukan bukti refund Rp0, dan harga kosong/tidak valid bukan Rp0 →
      // nominal tidak diketahui (NaN). Harga 0 yang ditulis eksplisit tetap 0. Jumlah unit tidak pernah diturunkan
      // dari nominal. Kategori "sudah direfund" tetap memakai cara lama (tidak bergantung pada jumlah).
      const { qty, qtyInfo } = returnQty(row, map, ['Return Quantity']);
      const price = optField(row, map, ['Return unit price']);
      const amountOk = isOk(qty) && qty > 0 && price.info === 'ada';
      const amount = amountOk ? price.value * qty : NaN;
      const amountInfo = amountOk ? 'ada' : price.info !== 'ada' ? `harga_${price.info}` : qty === 0 ? 'jumlah_nol' : `jumlah_${qtyInfo}`;
      const refunded = !!date(g('Refund Time')) && num(g('Return unit price')) > 0;
      const type = str(g('Return Type')), reason = str(g('Return Reason')), resi = str(g('Return Logistics Tracking ID'));
      let cat;
      if (!refunded) cat = 'batal';
      else if (resi || /return and refund/i.test(type)) cat = 'retur_barang';
      else if (/arrive on time|did not receive/i.test(reason)) cat = 'paket_bermasalah';
      else if (/missing/i.test(reason)) cat = 'tidak_dikirim';
      else cat = 'refund_tanpa_retur';
      cases.push({ key: `T|${rid}|${str(g('SKU ID'))}`, platform: 'tiktok', orderId: str(g('Order ID')), skuId: str(g('SKU ID')),
        product: str(g('Product Name')), variant: str(g('SKU Name')), reason, note: str(g('Buyer Note')),
        resi, returnStatus: str(g('Return Status')), qty, qtyInfo, amount, amountInfo,
        amountSource: amountOk ? 'harga_satuan_x_jumlah' : null, date: date(g('Time Requested')), cat });
    }
    return { kind: 'tiktok_return', cases };
  }

  function parseWorkbook(wb) {
    const kind = detect(wb);
    const fn = { shopee_income: parseShopeeIncome, tiktok_income: parseTiktokIncome, shopee_return: parseShopeeReturn,
      tiktok_return: parseTiktokReturn, shopee_orders: parseShopeeOrders, tiktok_orders: parseTiktokOrders, modal_template: parseModalTemplate }[kind];
    return fn ? fn(wb) : { kind };
  }

  /* ---------- gabung ---------- */
  const CAT_LABEL = {
    tidak_dikirim: 'Barang kurang / stok kosong (tidak dikirim)',
    retur_barang: 'Retur barang ke penjual',
    paket_bermasalah: 'Paket terlambat / tidak sampai',
    refund_tanpa_retur: 'Refund tanpa pengembalian barang',
    batal: 'Pengajuan dibatalkan / ditolak',
  };
  const CHECK_CATS = new Set(['retur_barang', 'paket_bermasalah', 'refund_tanpa_retur']);
  const BUCKETS = [[0, 50000, '< Rp50 rb'], [50000, 100000, 'Rp50–100 rb'], [100000, 200000, 'Rp100–200 rb'],
    [200000, 500000, 'Rp200–500 rb'], [500000, Infinity, '≥ Rp500 rb']];

  function merge(parsed) {
    const out = { shopeeOrders: new Map(), shopeeItems: [], shopeeAdj: new Map(), tiktok: new Map(), cases: new Map(),
      shopeeLines: new Map(), tiktokLines: new Map(), dupes: 0,
      // Pesanan Shopee yang muncul di ≥2 versi export yang isinya berbeda → hasil pembandingan (lihat
      // resolveShopeeVersions). Pesanan yang hanya punya satu versi tidak tercatat di sini.
      shopeeOrderMeta: new Map(),
    };
    const shopeeVersions = new Map();   // nomor pesanan → Map(isi versi → baris) dari semua file export Shopee
    const caseVersions = new Map();     // kunci kasus retur → Map(isi → kasus) dari semua file retur
    const seenLine = new Set();
    for (const p of parsed) {
      if (p.kind === 'shopee_income') {
        const fresh = new Set();
        for (const o of p.orders) { if (out.shopeeOrders.has(o.id)) { out.dupes++; continue; } out.shopeeOrders.set(o.id, o); fresh.add(o.id); }
        out.shopeeItems.push(...p.items.filter((it) => fresh.has(it.orderId)));
        for (const a of p.adjustments) out.shopeeAdj.set(a.key, a);
      } else if (p.kind === 'tiktok_income') {
        for (const r of p.rows) { if (out.tiktok.has(r.key)) { out.dupes++; continue; } out.tiktok.set(r.key, r); }
      } else if (p.kind === 'shopee_return' || p.kind === 'tiktok_return') {
        // H2-A: kasus yang sama bisa muncul di beberapa file retur. Simpan semua versinya; versi final dipilih
        // menurut isinya (bukan urutan unggah) di finalizeCases.
        for (const c of p.cases) {
          if (!caseVersions.has(c.key)) caseVersions.set(c.key, new Map());
          caseVersions.get(c.key).set(caseSer(c), c);
        }
      } else if (p.kind === 'shopee_orders') {
        collectShopeeLines(p.lines, shopeeVersions);
      } else if (p.kind === 'tiktok_orders') {
        const target = out.tiktokLines;   // TikTok: mekanisme dedup lama, tidak diubah
        for (const l of p.lines) {
          const k = `${p.kind}|${l.orderId}|${l.sku || l.skuId}|${l.name}|${l.variant}|${l.qty}`;
          if (seenLine.has(k)) continue;           // export yang sama diunggah dua kali
          seenLine.add(k);
          if (!target.has(l.orderId)) target.set(l.orderId, []);
          target.get(l.orderId).push(l);
        }
      }
    }
    finalizeShopeeLines(shopeeVersions, out);
    finalizeCases(caseVersions, out);
    return out;
  }

  /** Isi kasus retur yang relevan untuk angka/status (dipakai membandingkan versi antar file). */
  const caseSer = (c) => JSON.stringify([c.qty, c.qtyInfo, c.amount, c.cat, c.returnStatus, c.resi, c.reason, c.date].map(shNum));
  /**
   * Satu kasus per kunci. Bila beberapa file memuat kasus yang sama dengan isi BERBEDA (mis. status berubah),
   * dipakai versi pertama menurut urutan isi agar hasil tidak bergantung urutan unggah, dan kasus ditandai
   * `versiBerbeda` → jumlah unitnya tidak dianggap pasti (lihat returnUnits di compute).
   */
  function finalizeCases(caseVersions, out) {
    for (const [key, vm] of caseVersions) {
      const vs = [...vm.entries()].sort((a, b) => byText(a[0], b[0]));
      out.cases.set(key, vs.length === 1 ? vs[0][1] : { ...vs[0][1], versiBerbeda: true });
    }
  }

  /* ---------- export pesanan Shopee dari beberapa file (H1/H3 Fase 2 A3 + Fase 2.1) ----------
   * Satu pesanan bisa muncul di beberapa file export (file diunggah ulang, periode tumpang tindih, export lama
   * dan baru). Export tidak punya nomor baris unik, jadi baris dibandingkan bertingkat (keputusan pemilik):
   *  1. Identitas wajib  : nama, variasi, jumlah. Selalu ada di semua format. Jumlah baris per kombinasi ini
   *                        harus sama di semua versi; bila tidak → konflik FINANSIAL.
   *  2. Field opsional   : SKU variasi (identitas), harga setelah diskon dan subtotal (finansial). Dibandingkan
   *                        HANYA bila tersedia di kedua versi. Tidak tersedia ≠ 0 dan ≠ "sama".
   *  3. Metadata status  : Status Pesanan, status pembatalan/pengembalian, returnedQty. Bukan identitas: bila
   *                        berbeda → konflik STATUS. Tanda retur/belum selesai digabung dari semua versi.
   * Semua keputusan memakai urutan ISI, tidak pernah urutan unggah, sehingga hasilnya sama untuk urutan apa pun.
   * Dalam SATU file, semua baris tetap dipakai (dua baris kembar yang sah tidak dibuang).
   */
  const SH_OPTIONAL = [
    { f: 'skuVariant', kind: 'identitas', ok: (v) => str(v) !== '' },   // SKU kosong = tidak ada informasi
    { f: 'priceAfterDisc', kind: 'finansial', ok: isOk },
    { f: 'subtotal', kind: 'finansial', ok: isOk },
  ];
  const shNum = (v) => (typeof v === 'number' && !isFinite(v) ? 'NaN' : v);
  const shKey1 = (l) => [l.name, l.variant, l.qty].map(String).join('|');
  const shLineSer = (l) => JSON.stringify([l.name, l.variant, l.qty, l.skuVariant, l.sku, l.unitPrice, l.priceAfterDisc,
    l.subtotal, l.status, l.returnStatus, l.returnedQty].map(shNum));
  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  /** Multiset (kumpulan nilai yang boleh kembar) dalam bentuk teks yang bisa dibandingkan. */
  const multiset = (vals) => vals.map((v) => String(shNum(v))).sort().join('\u0001');
  const isSubMultiset = (part, whole) => {
    const left = whole.map((v) => String(shNum(v)));
    return part.every((v) => { const i = left.indexOf(String(shNum(v))); if (i < 0) return false; left.splice(i, 1); return true; });
  };

  /**
   * Kumpulkan isi pesanan dari SATU file export Shopee sebagai "versi". Versi yang isinya sama persis (file sama
   * diunggah ulang, atau hanya urutan barisnya berbeda) disimpan sekali → baris tidak pernah digandakan.
   */
  function collectShopeeLines(lines, versions) {
    const byOrder = new Map();
    for (const l of lines) { if (!byOrder.has(l.orderId)) byOrder.set(l.orderId, []); byOrder.get(l.orderId).push(l); }
    for (const [orderId, ls] of byOrder) {
      const ser = ls.map(shLineSer).sort().join('\n');     // diurutkan → urutan baris tidak berpengaruh
      const rowSer = ls.map(shLineSer).join('\n');           // urutan baris asli, hanya untuk memilih secara tetap
      if (!versions.has(orderId)) versions.set(orderId, new Map());
      const vm = versions.get(orderId), old = vm.get(ser);
      if (!old || rowSer < old.rowSer) vm.set(ser, { ls, rowSer });
    }
  }

  /** Tetapkan baris final tiap pesanan. Versi diurutkan menurut isinya, bukan urutan unggah. */
  function finalizeShopeeLines(versions, out) {
    for (const [orderId, vm] of versions) {
      const vs = [...vm.entries()].sort((a, b) => byText(a[0], b[0])).map((e) => e[1].ls);
      if (vs.length === 1) { out.shopeeLines.set(orderId, vs[0]); continue; }
      const r = resolveShopeeVersions(vs);
      out.shopeeLines.set(orderId, r.lines);
      out.shopeeOrderMeta.set(orderId, r.meta);
    }
  }

  /**
   * Bandingkan ≥2 versi isi satu pesanan.
   * @param vs  daftar versi (masing-masing daftar baris), sudah diurutkan menurut isi
   * @returns {{lines: object[], meta: {versi, finansial, identitas, sebagian, status, tandaRetur,
   *            statusBelumSelesai, infoRetur}}}
   *   finansial  = jumlah baris, harga, atau subtotal berbeda → kuantitas belum, HPP tidak diketahui
   *   identitas  = SKU variasi berbeda (finansial sama) → kuantitas tetap, HPP tidak diketahui
   *   sebagian   = ada info di versi lain yang tidak bisa digabung dengan aman → HPP belum terverifikasi
   *   status     = Status Pesanan / status retur / returnedQty berbeda → HPP belum terverifikasi
   *   tandaRetur, statusBelumSelesai = gabungan dari SEMUA versi; infoRetur = ada versi yang punya info retur
   *   skuSatuSumber = SKU variasi hanya ada di sebagian versi → HPP yang modalnya dicari lewat SKU itu "belum"
   */
  function resolveShopeeVersions(vs) {
    const meta = { versi: vs.length, finansial: false, identitas: false, sebagian: false, status: false,
      tandaRetur: false, statusBelumSelesai: false, infoRetur: false, skuSatuSumber: false };
    const groups = vs.map((ls) => {
      const g = new Map();
      for (const l of ls) { const k = shKey1(l); if (!g.has(k)) g.set(k, []); g.get(k).push(l); }
      return g;
    });
    const keys = [...new Set(groups.flatMap((g) => [...g.keys()]))].sort(byText);
    // Bandingkan nilai satu field sebagai multiset, HANYA antar versi yang punya info untuk semua baris kelompok.
    const differs = (lists, ok, get) => new Set(lists.filter((ls) => ls.length && ls.every((l) => ok(get(l))))
      .map((ls) => multiset(ls.map(get)))).size > 1;

    // Tingkat 1: identitas wajib.
    for (const k of keys) if (new Set(groups.map((g) => (g.get(k) || []).length)).size > 1) meta.finansial = true;

    // Tingkat 3: metadata status. Gabungan "ada tanda di salah satu versi" tidak bergantung urutan.
    for (const ls of vs) for (const l of ls) {
      if (str(l.returnStatus) !== '' || l.returnedQty > 0) meta.tandaRetur = true;
      if (str(l.status) && str(l.status) !== 'Selesai') meta.statusBelumSelesai = true;
    }
    meta.infoRetur = vs.some((ls) => ls.every((l) => l.returnStatus !== null || isOk(l.returnedQty)));
    for (const k of keys) {
      const lists = groups.map((g) => g.get(k) || []);
      if (differs(lists, (v) => str(v) !== '', (l) => l.status)
        || differs(lists, (v) => v !== null, (l) => l.returnStatus)
        || differs(lists, isOk, (l) => l.returnedQty)) meta.status = true;
    }
    // SKU variasi hanya tercatat di sebagian versi: bukan konflik, tetapi juga belum terbukti sama (lihat shopeeOrderModal).
    for (const k of keys) {
      const hasSku = groups.map((g) => (g.get(k) || []).some((l) => str(l.skuVariant) !== ''));
      if (hasSku.includes(true) && hasSku.includes(false)) meta.skuSatuSumber = true;
    }
    // Konflik finansial: baris versi pertama (menurut isi) hanya untuk tampilan; jumlahnya tidak dipakai.
    if (meta.finansial) return { lines: vs[0], meta };

    // Tingkat 2: field opsional, per kelompok identitas wajib.
    const lines = [];
    for (const k of keys) {
      const lists = groups.map((g) => g.get(k));
      for (const { f, kind, ok } of SH_OPTIONAL) if (differs(lists, ok, (l) => l[f])) meta[kind] = true;
      if (lists[0].length === 1) {
        // Tiap versi punya tepat SATU baris untuk kombinasi ini → pasangan barisnya pasti, field boleh digabung.
        // Nilai yang tidak tersedia diambil dari versi yang punya, tidak pernah diisi 0.
        const merged = { ...lists[0][0] };
        for (const { f, ok } of SH_OPTIONAL) { const src = lists.find((ls) => ok(ls[0][f])); if (src) merged[f] = src[0][f]; }
        lines.push(merged);
        continue;
      }
      // Beberapa baris kembar: pasangan antar versi TIDAK bisa dibuktikan, jadi field tidak digabung lintas baris.
      // Dipakai satu versi utuh dengan info terlengkap. Ini aturan teknis agar hasil tetap sama, BUKAN bukti.
      const info = (ls) => ls.reduce((a, l) => a + SH_OPTIONAL.filter(({ f, ok }) => ok(l[f])).length, 0);
      let best = 0;
      lists.forEach((ls, i) => { if (info(ls) > info(lists[best])) best = i; });
      const chosen = lists[best];
      for (const { f, kind, ok } of SH_OPTIONAL) {
        const chosenVals = chosen.filter((l) => ok(l[f])).map((l) => l[f]);
        const chosenFull = chosenVals.length === chosen.length;
        for (const ls of lists) {
          if (ls === chosen) continue;
          const vals = ls.filter((l) => ok(l[f])).map((l) => l[f]);
          if (!vals.length) continue;
          if (chosenFull) { if (!isSubMultiset(vals, chosenVals)) meta[kind] = true; }   // nilai versi lain bertentangan
          else if (multiset(vals) !== multiset(chosenVals)) meta.sebagian = true;        // info versi lain tidak terpakai
        }
      }
      lines.push(...chosen);
    }
    return { lines, meta };
  }

  /* ---------- modal ---------- */
  const acuanReady = (s) => isOk(s.mitra) && s.mitra >= 0 && s.mitra < 100;
  const modeOf = (s) => (s.modalMode === 'acuan' || (!s.modalMode && isOk(s.mitra)) ? 'acuan' : 'produk');

  /** Modal ÷ harga jual Shopee pada tanggal d (mode harga acuan). NaN jika diskon pemasok belum diisi. */
  function shopeeRatio(settings, d) {
    if (!acuanReady(settings)) return NaN;
    const periods = [...(settings.periods || [])].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    if (!periods.length) return NaN;
    let p = periods[0];
    for (const q of periods) if (!q.start || q.start <= (d || '')) p = q;
    const sell = (1 + (p.markup || 0) / 100) * (1 - (p.disc || 0) / 100);
    return sell > 0 ? (1 - settings.mitra / 100) / sell : NaN;
  }

  /** Indeks katalog modal: cari berdasarkan kode (SKU/ID) atau nama (+variasi). */
  function buildCatalog(entries = [], extraPct = 0) {
    const byCode = new Map(), byName = new Map();
    const mult = 1 + (isOk(extraPct) && extraPct > 0 ? extraPct / 100 : 0);
    for (const raw of entries) {
      if (!isOk(raw.cost) || raw.cost < 0) continue;
      const e = { ...raw, baseCost: raw.cost, cost: raw.cost * mult };   // baseCost = angka yang diisi penjual
      if (e.kode) byCode.set(norm(e.kode), e);
      if (e.nama) {
        if (e.variasi) byName.set(norm(`${e.nama} ${e.variasi}`), e);
        if (!byName.has(norm(e.nama)) || !e.variasi) byName.set(norm(e.nama), e);
      }
    }
    return {
      size: byCode.size + byName.size,
      find(codes, name, variant) {
        for (const c of codes) if (c && byCode.has(norm(c))) return byCode.get(norm(c));
        if (name && variant && byName.has(norm(`${name} ${variant}`))) return byName.get(norm(`${name} ${variant}`));
        if (name && byName.has(norm(name))) return byName.get(norm(name));
        return null;
      },
    };
  }

  const monthOf = (d) => (d ? d.slice(0, 7) : '');
  const daysBetween = (a, b) => (!a || !b ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1);
  const fixedPerMonth = (s) => (s.fixedCosts || []).reduce((a, c) => a + (isOk(c.amount) ? c.amount : 0), 0);

  /**
   * @param parsed     hasil parseWorkbook untuk semua file
   * @param settings   {modalMode:'produk'|'acuan', catalog:[{kode,nama,variasi,cost}], fallbackPct, mitra, coret, periods,
   *                    packing, fixedCosts:[{label,amount}], targetMargin,
   *                    extraCostPct: biaya kulakan (ongkir beli, dll.) dalam % dari harga beli, ditambahkan ke modal per produk}
   * @param caseState  {kunciRetur: 'belum'|'kembali'|'hilang'}
   * @param filter     {platforms: ['shopee','tiktok'], from: 'YYYY-MM', to: 'YYYY-MM'} (bulan pesanan)
   */
  function compute(parsed, settings, caseState = {}, filter = {}) {
    const m = merge(parsed);
    const mode = modeOf(settings);
    const catalog = buildCatalog(settings.catalog, settings.extraCostPct);
    const fallback = isOk(settings.fallbackPct) && settings.fallbackPct >= 0 && settings.fallbackPct < 100 ? settings.fallbackPct / 100 : NaN;
    const packing = isOk(settings.packing) ? settings.packing : 0;
    const target = isOk(settings.targetMargin) ? settings.targetMargin / 100 : 0.15;
    const want = new Set(filter.platforms || ['shopee', 'tiktok']);
    const inRange = (d) => { const mo = monthOf(d); return (!filter.from || (mo && mo >= filter.from)) && (!filter.to || (mo && mo <= filter.to)); };

    const allMonths = new Set();
    for (const o of m.shopeeOrders.values()) if (o.orderDate) allMonths.add(monthOf(o.orderDate));
    for (const r of m.tiktok.values()) if (r.isOrder && r.orderDate) allMonths.add(monthOf(r.orderDate));
    const available = { shopee: m.shopeeOrders.size > 0, tiktok: [...m.tiktok.values()].some((r) => r.isOrder) };

    const months = new Map();
    const blank = () => ({ sales: 0, received: 0, fees: 0, margin: 0, orders: 0, knownSales: 0 });
    const mon = (k) => { if (!months.has(k)) months.set(k, { month: k, shopee: blank(), tiktok: blank() }); return months.get(k); };
    const buckets = BUCKETS.map(([lo, hi, label]) => ({ label, lo, hi, orders: 0, value: 0, fees: 0, margin: 0, known: 0 }));
    const addBucket = (v, fee, margin) => {
      const b = buckets.find((x) => v >= x.lo && v < x.hi);
      if (!b) return;
      b.orders++; b.value += v; b.fees += fee;
      if (isOk(margin)) { b.margin += margin; b.known++; }
    };

    /* produk (gabungan item Shopee + baris SKU TikTok) */
    const prod = new Map();
    const touchProduct = (key, init) => { if (!prod.has(key)) prod.set(key, { key, rows: 0, qty: 0, qtyKnown: true, sales: 0, received: 0, modal: 0, modalKnown: true, unitCost: NaN, baseCost: NaN, ...init }); return prod.get(key); };
    let qtyAssumed = 0, linesWithoutCost = 0, ttNoDetail = 0, ttNoDetailSales = 0;
    // H2-A: ringkasan kepastian HPP (metadata; tidak mengubah angka). Penjualan = nilai produk setelah refund.
    // "terverifikasi" termasuk total kelompok variasi yang pasti. "tidak_diketahui" tidak punya nilai HPP.
    const K = { hpp: { terverifikasi: 0, estimasi: 0, belum: 0 },
      penjualan: { terverifikasi: 0, estimasi: 0, belum: 0, tidak_diketahui: 0 },
      baris: { terverifikasi: 0, estimasi: 0, belum: 0, tidak_diketahui: 0 } };
    const kAdd = (status, sales, cost) => {
      const st = status === 'terverifikasi_kelompok' ? 'terverifikasi' : status;
      K.baris[st]++; K.penjualan[st] += isOk(sales) ? sales : 0;
      if (st !== 'tidak_diketahui') K.hpp[st] += cost;
    };
    /*
     * H2-B3a: cakupan kepastian per PESANAN (metadata; tidak mengubah angka apa pun).
     * Dasar penjualan = penjualan bersih per pesanan, sama persis dengan totalSales (Shopee: harga + refund + voucher;
     * TikTok: Total Pendapatan). Setiap pesanan masuk SATU status saja, yaitu status terlemah di antara barisnya,
     * sehingga jumlah semua status = total dan "tidakDiketahui" = penjualan yang modalnya tidak diketahui (keluar
     * dari laba). Berbeda dari K.penjualan (per baris produk, tanpa voucher) yang tetap dipertahankan.
     * Urutan dari terkuat ke terlemah: terverifikasi < estimasi < estimasi_minimum < belum < tidak_diketahui.
     */
    const CAKUPAN_URUT = ['terverifikasi', 'estimasi', 'estimasi_minimum', 'belum', 'tidak_diketahui'];
    const CAKUPAN_KEY = { terverifikasi: 'terverifikasi', estimasi: 'estimasi', estimasi_minimum: 'estimasiMinimum', belum: 'belum', tidak_diketahui: 'tidakDiketahui' };
    const blankStatus = () => ({ terverifikasi: 0, estimasi: 0, estimasiMinimum: 0, belum: 0, tidakDiketahui: 0 });
    const blankCakupan = () => ({ penjualan: blankStatus(), jumlahPesanan: blankStatus(),
      dikeluarkan: { penjualan: 0, danaDiterima: 0, jumlahPesanan: 0, alasan: {} },
      refundParsialTanpaUnit: { jumlahPesanan: 0, penjualan: 0 } });
    const CK = { shopee: blankCakupan(), tiktok: blankCakupan() };
    const weakest = (list) => list.reduce((a, s) => (CAKUPAN_URUT.indexOf(s) > CAKUPAN_URUT.indexOf(a) ? s : a), 'terverifikasi');
    /**
     * Catat satu pesanan ke cakupan.
     * @param reasons  alasan pesanan dikeluarkan dari laba (hanya untuk status tidak_diketahui)
     * @param partial  true bila laba pesanan ini masih memakai nominal refund parsial sebagai pengganti jumlah unit
     */
    function ckAdd(pf, status, sales, settle, reasons, partial) {
      const c = CK[pf], k = CAKUPAN_KEY[status];
      c.penjualan[k] += sales; c.jumlahPesanan[k]++;
      if (status === 'tidak_diketahui') {
        // Dana diterima bisa negatif (potongan/ongkir retur); dicatat apa adanya, tidak dibulatkan ke 0.
        c.dikeluarkan.penjualan += sales; c.dikeluarkan.danaDiterima += settle; c.dikeluarkan.jumlahPesanan++;
        // Satu pesanan bisa punya beberapa alasan, jadi jumlah per alasan bisa lebih besar dari jumlahPesanan.
        for (const a of new Set(reasons)) c.dikeluarkan.alasan[a] = (c.dikeluarkan.alasan[a] || 0) + 1;
      }
      if (partial) { c.refundParsialTanpaUnit.jumlahPesanan++; c.refundParsialTanpaUnit.penjualan += sales; }
    }
    // Kandidat refund penuh (Shopee per item, TikTok per pesanan). Kondisi fisiknya dievaluasi setelah kasus retur dibaca.
    const fullRefunds = [];
    // Ringkasan status Shopee mode modal per produk (H1/H3 Fase 2). Informasi tambahan saja: tidak dipakai
    // menghitung angka lain dan tidak disimpan. Mode harga acuan tidak memakai kuantitas: hanya hpp/metodeHpp terisi.
    //  kuantitas: terverifikasi = jumlah terbukti dari export; belum = tidak ada bukti cukup
    //  hpp: terverifikasi = kuantitas, variasi, dan modal pasti, tanpa refund/status yang belum jelas
    //       terverifikasi_kelompok = total satu kelompok variasi ambigu pasti, rincian per variasi tidak pasti
    //       estimasi = ada angka, tetapi jumlah barang dianggap 1 unit (pesanan tidak ada di export), atau modal
    //                  rata-rata tanpa alasan rekonsiliasi yang lebih serius
    //       belum = ada angka, tetapi ada asumsi lain (lihat hppReasons)
    //       tidak_diketahui = tidak ada angka: modal belum diisi, atau jumlah barang tidak diketahui (A1)
    //  kuantitasTidakDiketahui: pesanan ada di export tetapi barisnya tidak cocok meyakinkan (A1)
    //  exportBerbeda: baris dari pesanan yang isi FINANSIAL export-nya berbeda antar file (A3)
    //  identitasBerbeda / identitasSebagian / statusExportBerbeda: konflik antar file (Fase 2.1)
    //  infoReturTidakTersedia: file export tidak punya kolom retur (bukan bukti tidak ada retur)
    const shopeeQty = { baris: 0, kuantitas: { terverifikasi: 0, belum: 0 }, variasi: { terverifikasi: 0, tidak_relevan: 0, ambigu: 0, belum: 0 },
      hpp: { terverifikasi: 0, terverifikasi_kelompok: 0, estimasi: 0, belum: 0, tidak_diketahui: 0 },
      unitTerverifikasi: 0, estimasiSatuUnit: 0, refundPenuhTanpaKuantitas: 0, kuantitasTidakDiketahui: 0, exportBerbeda: 0,
      identitasBerbeda: 0, identitasSebagian: 0, statusExportBerbeda: 0, infoReturTidakTersedia: 0,
      metodeHpp: { modal_per_unit: 0, modal_rata_rata: 0, harga_acuan: 0 },   // dari mana angka HPP berasal (lihat hppMethod)
      refundBelumJelas: 0, statusBelumDivalidasi: 0 };

    /* ===== Shopee ===== */
    const S = { orders: 0, sales: 0, fees: { admin: 0, proses: 0, xtra: 0, ams: 0, ship: 0, lain: 0 }, received: 0, modal: 0, packing: 0,
      adj: 0, first: '', last: '', knownSales: 0, knownReceived: 0, knownPacking: 0, margin: 0, voucher: 0 };
    const shopeeIn = new Set();
    const itemsByOrder = new Map();
    for (const it of m.shopeeItems) { if (!itemsByOrder.has(it.orderId)) itemsByOrder.set(it.orderId, []); itemsByOrder.get(it.orderId).push(it); }

    /** Modal satu pesanan Shopee + catatan per item (untuk tabel produk). */
    function shopeeOrderModal(o) {
      const items = itemsByOrder.get(o.id) || [];
      const gross = o.harga + o.refund;
      if (mode === 'acuan') {
        // Mode reseller: modal = harga jual × rasio (diskon pemasok dan pola harga dari isian seller). Harga acuan
        // ditaksir dari harga jual, jadi HPP selalu ESTIMASI; refund (rumus lama, tidak diubah) → "belum".
        // Status hanya metadata; angka modal tidak berubah.
        const r = shopeeRatio(settings, o.orderDate);
        return { modal: gross * r, items: items.map((it) => {
          const cost = (it.harga + it.refund) * r;
          const reasons = isOk(cost) ? ['harga_acuan', ...(it.refund !== 0 || !(it.harga + it.refund > 0) ? ['refund'] : [])] : [];
          const hppStatus = !isOk(cost) ? 'tidak_diketahui' : reasons.includes('refund') ? 'belum' : 'estimasi';
          shopeeQty.baris++; shopeeQty.hpp[hppStatus]++;
          if (isOk(cost)) shopeeQty.metodeHpp.harga_acuan++;
          if (reasons.includes('refund')) shopeeQty.refundBelumJelas++;
          return { it, qty: null, cost, unit: NaN, entry: null, hppMethod: isOk(cost) ? 'harga_acuan' : null, hppStatus, hppReasons: reasons };
        }) };
      }
      const exp = m.shopeeLines.get(o.id) || [];
      // H1/H3 Fase 2: pasangkan baris laporan ↔ baris export dengan aturan M0–M2 (lihat matchShopeeOrder).
      // Cara lama memberi SEMUA baris export bernama sama ke item pertama, sehingga variasi berikutnya dianggap
      // 1 unit lagi (unit terhitung ganda). Pencocok memastikan tiap baris export dipakai paling banyak sekali.
      const match = matchShopeeOrder(o.id, items, exp);
      // Fase 2.1: hasil pembandingan bila pesanan ini muncul di ≥2 versi export yang berbeda (resolveShopeeVersions).
      // null = hanya satu versi; pemeriksaan status dilakukan per baris seperti biasa.
      const meta = m.shopeeOrderMeta.get(o.id) || null;
      // A3 konflik FINANSIAL: tidak bisa dipastikan versi mana yang benar, jadi hasil pencocokan tidak dipakai:
      // semua item dianggap "ada di export tetapi belum cocok" (aturan A1).
      const conflict = !!(meta && meta.finansial);
      if (conflict) {
        match.items = match.items.map(() => ({ rule: 'export_berbeda', qtyStatus: 'belum', variantStatus: 'belum', qty: null, lineIdx: [], candidateIdx: [], groupId: null }));
        match.groups = [];
      }
      // Pemeriksaan status per BARIS hanya untuk pesanan dengan satu versi export. Untuk beberapa versi, status
      // diambil dari gabungan semua versi di `meta` (per pesanan), supaya tidak bergantung pada versi yang terpilih.
      const notYetValidated = new Set(meta ? [] : match.nonCompletedLines);   // status pesanan selain "Selesai"
      // Tanda pembatalan/pengembalian di export. Dampaknya ke HPP belum diketahui (menunggu H2).
      const hasReturnSign = (j) => !meta && (str(exp[j].returnStatus) !== '' || exp[j].returnedQty > 0);
      // Kolom retur tidak ada di file (returnStatus null) dan returnedQty juga tidak ada → info retur tidak tersedia.
      // Ini BUKAN bukti tidak ada retur.
      const noReturnInfo = (j) => !meta && exp[j].returnStatus === null && !isOk(exp[j].returnedQty);

      // Kelompok variasi ambigu (nilai kembar): HPP dihitung SEKALI untuk seluruh kelompok, hanya bila semua
      // baris export kandidat punya modal. Total kelompok pasti; pembagian per variasi tidak bisa dipastikan.
      const groupCost = match.groups.map((g) => {
        const costs = g.lineIdx.map((j) => ({ j, ...shopeeCostOf(items[g.itemIdx[0]], exp[j]) }));
        const known = costs.every((c) => c.entry);
        return {
          costs, known,
          base: known ? costs.reduce((a, c) => a + c.entry.cost * exp[c.j].qty, 0) : NaN,   // Σ modal × jumlah
          sameUnit: known && new Set(costs.map((c) => c.entry.cost)).size === 1,
          variantCost: known && costs.every((c) => c.key !== 'produk_legacy'),
          viaSku: costs.some((c) => c.key === 'sku_variasi'),
        };
      });

      let modal = 0, ok = true;
      const notes = items.map((it, i) => {
        const r = match.items[i];
        const group = r.groupId === null ? null : match.groups[r.groupId];
        const lines = group ? group.lineIdx : r.lineIdx;   // baris export yang terbukti milik item ini (bisa kosong)
        // Rumus refund LAMA (H2) sengaja tidak diubah: modal dikali porsi yang tidak direfund.
        const share = it.harga > 0 ? clamp01((it.harga + it.refund) / it.harga) : 0;
        let entry = null, key = null, cost, qty = r.qty, ledger = null;
        // Dasar jumlah barang untuk HPP: 'export' (terbukti), 'kelompok' (hanya total kelompok yang terbukti),
        // 'estimasi_1' (dianggap 1 unit), 'tidak_diketahui' (A1), atau null bila HPP tidak memakai jumlah barang
        // (modal rata-rata dihitung dari nilai penjualan, bukan dari jumlah).
        let qtyBasis = null;
        if (group) {
          const g = groupCost[r.groupId];
          if (g.known) {
            // Nilai baris laporan dalam kelompok sama persis, jadi total kelompok dibagi rata per baris laporan.
            cost = (g.base / group.itemIdx.length) * share;
            entry = g.costs[0].entry; key = g.variantCost ? 'variasi' : 'produk_legacy';
            qtyBasis = r.qtyStatus === 'terverifikasi' ? 'export' : 'kelompok';
          }
        } else if (r.qtyStatus === 'terverifikasi') {
          ({ entry, key } = shopeeCostOf(it, exp[lines[0]]));
          // H2-B1: bila unit refund bisa direkonsiliasi dari field kuantitas, HPP = modal × unit terjual bersih.
          // Nominal refund tidak dipakai. Bila tidak bisa, rumus lama (share) tetap dipakai dan ditandai.
          if (entry && !conflict) ledger = unitLedger(o.id, it, exp[lines[0]], meta);
          if (ledger) {   // ringkasan buku unit (metadata)
            ledgerStats.baris++; ledgerStats.status[ledger.unitStatus] = (ledgerStats.status[ledger.unitStatus] || 0) + 1;
            if (ledger.unitLedgerComplete) {
              ledgerStats.lengkap++; ledgerStats.unitBelumDiketahui += ledger.qtyUnknown;
              ledgerStats.nilaiUnitBelumDiketahui += entry.cost * ledger.qtyUnknown;
            }
          }
          if (entry && ledger && ledger.unitLedgerComplete) { cost = entry.cost * ledger.qtySold; qtyBasis = 'buku_unit'; }
          else if (entry) { cost = entry.cost * qty * share; qtyBasis = 'export'; }
        } else {
          ({ entry, key } = shopeeCostOf(it, null));
          if (entry && exp.length) {
            // A1 (keputusan pemilik): pesanan ADA di export, tetapi baris ini tidak bisa dipasangkan secara meyakinkan.
            // Export menunjukkan jumlahnya bisa lebih dari 1, sehingga estimasi 1 unit bisa terlalu kecil dan laba
            // terlihat terlalu besar. HPP baris ini TIDAK DIKETAHUI: bukan 0, bukan estimasi, dan tidak diganti modal
            // rata-rata. Pesanannya keluar dari "modal diketahui" (sama seperti pesanan yang modalnya belum diisi).
            cost = NaN; ok = false; qtyBasis = 'tidak_diketahui';
          } else if (entry) {
            // Pesanan TIDAK ada di export sama sekali: estimasi minimal 1 unit (cara lama, A.19.1) tetap dipakai agar
            // kompatibel, dengan pencarian modal tanpa variasi. Statusnya "estimasi", bukan terverifikasi. Bila item
            // direfund penuh, share = 0 sehingga modalnya 0 menurut rumus refund lama; itu juga bukan HPP pasti.
            cost = entry.cost * 1 * share; qtyAssumed++; qtyBasis = 'estimasi_1';
          }
        }
        if (!entry) {
          if (isOk(fallback)) cost = (it.harga + it.refund) * fallback;
          else { cost = NaN; ok = false; linesWithoutCost++; }
        }
        // Konflik IDENTITAS (SKU variasi berbeda antar export, finansial sama): jumlah barang tetap terbukti, tetapi
        // modal per unit yang benar tidak bisa dipastikan → HPP tidak diketahui. Modal rata-rata (persen dari nilai
        // penjualan) tidak bergantung pada SKU, jadi tetap dipakai dengan status "belum".
        if (meta && meta.identitas && entry && isOk(cost)) { cost = NaN; ok = false; }
        modal += isOk(cost) ? cost : 0;

        // Status HPP. "terverifikasi" hanya bila semua syarat terpenuhi; alasan lain dicatat di hppReasons.
        const reasons = [];
        if (!entry && isOk(cost)) reasons.push('modal_rata_rata');            // dari persen modal, bukan isian per produk
        if (!group && r.qtyStatus !== 'terverifikasi') reasons.push('kuantitas');
        if (qtyBasis === 'estimasi_1') reasons.push('estimasi_satu_unit');
        if (conflict) reasons.push('export_berbeda');
        if (entry && key === 'produk_legacy' && lines.length) reasons.push('modal_tingkat_produk'); // belum terbukti berlaku untuk variasi ini
        // Refund di SATU baris kelompok membuat pembagian kelompok tidak pasti, jadi seluruh kelompok ikut "belum" (D1).
        const refunded = (k) => items[k].refund !== 0 || !(items[k].harga + items[k].refund > 0);
        if ((group ? group.itemIdx.some(refunded) : refunded(i)) || lines.some(hasReturnSign) || (meta && meta.tandaRetur)) reasons.push('refund');
        if (lines.some((j) => notYetValidated.has(j)) || (meta && meta.statusBelumSelesai)) reasons.push('status_pesanan');
        if (meta ? !meta.infoRetur : lines.some(noReturnInfo)) reasons.push('info_retur_tidak_tersedia');
        if (meta && meta.identitas) reasons.push('identitas_berbeda');
        // SKU yang hanya tercatat di sebagian export belum terbukti sama dengan baris di export lain.
        const viaSku = group ? groupCost[r.groupId].viaSku : key === 'sku_variasi';
        if (meta && (meta.sebagian || (meta.skuSatuSumber && viaSku))) reasons.push('identitas_sebagian');
        if (meta && meta.status) reasons.push('status_export_berbeda');
        // Metode HPP (metadata, tidak mengubah angka): modal per unit dari daftar modal × jumlah barang, atau modal
        // rata-rata = persen dari nilai penjualan (Laporan Penghasilan). null bila tidak ada HPP sama sekali.
        const hppMethod = entry ? 'modal_per_unit' : isOk(cost) ? 'modal_rata_rata' : null;
        let hppStatus;
        if (!isOk(cost)) hppStatus = 'tidak_diketahui';
        else if (hppMethod === 'modal_rata_rata') {
          // Modal rata-rata selalu ESTIMASI (bukan HPP aktual). Alasan yang tidak memengaruhi persen dari nilai
          // penjualan (jumlah barang, konflik SKU) tidak menurunkannya. Alasan rekonsiliasi yang lebih serius
          // (refund/retur, status pesanan, info retur tidak ada, identitas sebagian, konflik finansial) → "belum",
          // supaya tidak tersembunyi di balik label estimasi.
          const ringan = new Set(['modal_rata_rata', 'kuantitas', 'identitas_berbeda']);
          hppStatus = reasons.every((x) => ringan.has(x)) ? 'estimasi' : 'belum';
        }
        // Estimasi 1 unit (pesanan tidak ada di export). H2-A: bila ada alasan yang lebih serius (refund/retur,
        // status pesanan, info retur tidak ada, konflik), statusnya "belum" agar tidak tampak sekadar estimasi biasa.
        else if (qtyBasis === 'estimasi_1') hppStatus = reasons.every((x) => x === 'kuantitas' || x === 'estimasi_satu_unit') ? 'estimasi' : 'belum';
        else if (reasons.length) hppStatus = 'belum';
        else if (group && !(groupCost[r.groupId].sameUnit && r.qtyStatus === 'terverifikasi')) hppStatus = 'terverifikasi_kelompok';
        else hppStatus = 'terverifikasi';

        countShopeeStatus(r, hppStatus, reasons, group, qtyBasis, it, hppMethod);
        // SKU di bawah hanya untuk tampilan tabel produk (sama seperti cara lama), tidak dipakai mencari modal.
        const shown = exp[lines[0]] || exp.find((l) => norm(l.name) === norm(it.name)) || {};
        return { it, qty, cost, unit: entry ? entry.cost : NaN, base: entry ? entry.baseCost : NaN, entry, sku: shown.sku, variant: shown.variant,
          rule: r.rule, qtyStatus: r.qtyStatus, variantStatus: r.variantStatus, qtyBasis, hppMethod, hppStatus, hppReasons: reasons, ledger };
      });
      // Unit terverifikasi dari kelompok dihitung sekali per kelompok (bukan per baris laporan).
      for (const g of match.groups) shopeeQty.unitTerverifikasi += g.qtyTotal;
      if (!items.length) { if (isOk(fallback)) modal = gross * fallback; else ok = false; }
      return { modal: ok ? modal : NaN, items: notes };
    }

    /* H2-B1: kasus retur Shopee per nomor pesanan, untuk buku unit. */
    const shopeeCasesByOrder = new Map();
    for (const c of m.cases.values()) {
      if (c.platform !== 'shopee') continue;
      if (!shopeeCasesByOrder.has(c.orderId)) shopeeCasesByOrder.set(c.orderId, []);
      shopeeCasesByOrder.get(c.orderId).push(c);
    }
    const ledgerStats = { baris: 0, lengkap: 0, unitBelumDiketahui: 0, nilaiUnitBelumDiketahui: 0, invariantGagal: 0, status: {} };

    /**
     * H2-B1: buku unit untuk SATU baris pesanan Shopee yang terpasang pasti ke satu baris export.
     * Bukan catatan persediaan; hanya membagi unit baris ini ke satu perlakuan masing-masing:
     *   qtySold + qtyNotShipped + qtyReturnedGood + qtyReturnedDamaged + qtyLost + qtyUnknown = qtyOrdered
     * qtySold = unit yang tetap menjadi penjualan bersih setelah unit yang direfund dikeluarkan.
     * Sumber unit refund HANYA field kuantitas: returnedQty export + "Jumlah Produk Dikembalikan" file retur
     * (pesanan + produk + variasi yang sama). Nominal refund tidak pernah dipakai, termasuk untuk menyimpulkan 0.
     *   terverifikasi = kedua sumber sama · satu_sumber = hanya satu · konflik = berbeda · tidak_diketahui = tidak ada
     * Kondisi fisik tidak ditebak: hanya kasus yang sudah ditandai seller "Tidak kembali" (hilang) atau
     * "Kembali" yang dipakai. Kategori dari teks alasan (mis. "tidak dikirim") belum disetujui sebagai bukti,
     * dan nilai rusak belum bisa diisi → unit itu masuk qtyUnknown.
     * @returns {object} ledger; unitLedgerComplete = false bila jumlah unit tidak bisa direkonsiliasi (rumus lama dipakai)
     */
    function unitLedger(orderId, it, line, meta) {
      const reasons = [], sources = [];
      const qtyOrdered = line.qty;
      // Sumber 1: export. Bila export pesanan ini berbeda antar file (Fase 2.1), returnedQty tidak dapat dipakai.
      let ex;
      if (meta && (meta.finansial || meta.status)) ex = { status: 'konflik' };
      else if (isOk(line.returnedQty)) ex = { status: 'ada', units: line.returnedQty };
      else ex = { status: 'tidak_ada' };
      // Sumber 2: file retur. Pengajuan "batal" (ditolak/dibatalkan) bukan unit yang direfund.
      const cs = (shopeeCasesByOrder.get(orderId) || []).filter((c) => c.cat !== 'batal'
        && norm(c.product) === norm(it.name) && norm(c.variant) === norm(line.variant));
      let rf;
      if (!cs.length) rf = { status: 'tidak_ada' };
      else if (cs.some((c) => c.versiBerbeda)) rf = { status: 'konflik' };
      else if (cs.every((c) => isOk(c.qty))) rf = { status: 'ada', units: cs.reduce((a, c) => a + c.qty, 0) };
      else rf = { status: 'tidak_valid' };
      if (ex.status === 'ada') sources.push('export_returnedQty');
      if (rf.status === 'ada') sources.push('file_retur');
      let unitStatus, qtyRefunded = NaN;
      if (ex.status === 'konflik' || rf.status === 'konflik') unitStatus = 'konflik';
      else if (ex.status === 'ada' && rf.status === 'ada') {
        unitStatus = ex.units === rf.units ? 'terverifikasi' : 'konflik';
        if (unitStatus === 'terverifikasi') qtyRefunded = ex.units;
      } else if (ex.status === 'ada' || rf.status === 'ada') {
        unitStatus = 'satu_sumber'; qtyRefunded = ex.status === 'ada' ? ex.units : rf.units;
      } else unitStatus = 'tidak_diketahui';
      if (unitStatus === 'konflik') reasons.push('sumber_unit_berbeda');
      if (unitStatus === 'tidak_diketahui') reasons.push('unit_refund_tidak_diketahui');
      if (isOk(qtyRefunded) && qtyRefunded > qtyOrdered) { reasons.push('unit_refund_melebihi_pesanan'); qtyRefunded = NaN; }
      // Pemeriksaan konsistensi (BUKAN menurunkan unit dari nominal): ada unit direfund tetapi Laporan Penghasilan
      // belum mencatat refund apa pun untuk baris ini (mis. refund baru muncul di laporan berikutnya). Mengeluarkan
      // unit dari HPP saat pendapatan masih penuh akan membuat laba terlalu besar → rumus lama dipakai, ditandai.
      if (isOk(qtyRefunded) && qtyRefunded > 0 && it.refund === 0) { reasons.push('unit_refund_tanpa_refund_di_laporan_penghasilan'); qtyRefunded = NaN; }

      const L = { qtyOrdered, qtyRefunded, qtySold: NaN, qtyNotShipped: 0, qtyReturnedGood: 0, qtyReturnedDamaged: 0,
        qtyLost: 0, qtyUnknown: NaN, unitLedgerComplete: false, unitStatus, unitReasons: reasons, unitSources: sources };
      if (!isOk(qtyRefunded)) return L;   // tidak bisa direkonsiliasi → rumus lama, ditandai

      // Kondisi fisik unit yang direfund: hanya dari tanda seller yang sudah ada.
      const st = (c) => (CHECK_CATS.has(c.cat) ? (caseState[c.key] || 'belum') : 'na');
      const sum = (f) => cs.filter((c) => isOk(c.qty) && f(st(c))).reduce((a, c) => a + c.qty, 0);
      let lost = sum((x) => x === 'hilang'), good = sum((x) => x === 'kembali');
      if (lost + good > qtyRefunded) { reasons.push('kondisi_fisik_melebihi_unit_refund'); lost = 0; good = 0; }
      L.qtySold = qtyOrdered - qtyRefunded;
      L.qtyLost = lost; L.qtyReturnedGood = good;
      L.qtyUnknown = qtyRefunded - lost - good;
      if (L.qtyUnknown > 0) reasons.push('kondisi_fisik_belum_diketahui');
      // Invariant: setiap unit tepat satu perlakuan. Bila tidak terpenuhi, buku unit tidak dipakai.
      const total = L.qtySold + L.qtyNotShipped + L.qtyReturnedGood + L.qtyReturnedDamaged + L.qtyLost + L.qtyUnknown;
      if (total !== qtyOrdered || L.qtySold < 0 || L.qtyUnknown < 0) { reasons.push('invariant_unit_gagal'); ledgerStats.invariantGagal++; return L; }
      L.unitLedgerComplete = true;
      return L;
    }

    /**
     * Cari modal per unit untuk SATU baris export Shopee (keputusan pemilik E1, hanya jalur Shopee;
     * pencarian modal TikTok tidak berubah). Urutan:
     *  1. SKU variasi ("Nomor Referensi SKU") yang terisi dan ada di daftar modal → modal variasi itu.
     *  2. Nama produk + nama variasi yang persis ada di daftar modal → modal variasi itu.
     *  3. Cara lama (SKU/ID produk/nama). Ini modal TINGKAT PRODUK. Dipakai agar data modal lama tetap jalan,
     *     tetapi bila produk punya variasi, modal ini belum terbukti berlaku untuk variasi tersebut (E2).
     * SKU induk tidak dipakai di langkah 1–2 karena berlaku untuk semua variasi produk.
     * @param it    baris produk Laporan Penghasilan
     * @param line  baris export yang terbukti milik item ini, atau null bila belum diketahui
     * @returns {{entry: object|null, key: 'sku_variasi'|'nama_variasi'|'produk'|'produk_legacy'|null}}
     */
    function shopeeCostOf(it, line) {
      const variant = line ? str(line.variant) : '';
      if (line && line.skuVariant) {
        const e = catalog.find([line.skuVariant], '', '');
        if (e) return { entry: e, key: 'sku_variasi' };
      }
      if (variant) {
        const e = catalog.find([], it.name, variant);
        if (e && e.variasi && norm(`${e.nama} ${e.variasi}`) === norm(`${it.name} ${variant}`)) return { entry: e, key: 'nama_variasi' };
      }
      const e = catalog.find([line ? line.sku : undefined, it.productId], it.name, variant);   // cara lama
      if (!e) return { entry: null, key: null };
      // Pencarian lama lewat nama saja bisa mengembalikan modal VARIASI LAIN (daftar modal memetakan nama produk ke
      // variasi pertama yang diisi). Untuk baris yang variasinya diketahui, modal milik variasi lain tidak dipakai.
      if (variant && e.variasi && norm(e.variasi) !== norm(variant)) return { entry: null, key: null };
      // Hanya produk yang jelas TANPA variasi (baris export cocok dan variasinya kosong) yang boleh memakai modal
      // tingkat produk sebagai modal pasti. Selain itu nilai lama dipakai, tetapi ditandai.
      return { entry: e, key: line && !variant ? 'produk' : 'produk_legacy' };
    }

    /** Tambah hitungan ringkasan status Shopee (hanya informasi; tidak mengubah angka lain). */
    function countShopeeStatus(r, hppStatus, reasons, group, qtyBasis, it, hppMethod) {
      shopeeQty.baris++;
      if (hppMethod) shopeeQty.metodeHpp[hppMethod]++;
      shopeeQty.kuantitas[r.qtyStatus]++;
      shopeeQty.variasi[r.variantStatus]++;
      shopeeQty.hpp[hppStatus]++;
      if (!group && r.qtyStatus === 'terverifikasi') shopeeQty.unitTerverifikasi += r.qty;
      if (qtyBasis === 'estimasi_1') { if (it.harga + it.refund > 0) shopeeQty.estimasiSatuUnit++; else shopeeQty.refundPenuhTanpaKuantitas++; }
      if (qtyBasis === 'tidak_diketahui') shopeeQty.kuantitasTidakDiketahui++;
      if (reasons.includes('export_berbeda')) shopeeQty.exportBerbeda++;
      if (reasons.includes('identitas_berbeda')) shopeeQty.identitasBerbeda++;
      if (reasons.includes('identitas_sebagian')) shopeeQty.identitasSebagian++;
      if (reasons.includes('status_export_berbeda')) shopeeQty.statusExportBerbeda++;
      if (reasons.includes('info_retur_tidak_tersedia')) shopeeQty.infoReturTidakTersedia++;
      if (reasons.includes('refund')) shopeeQty.refundBelumJelas++;
      if (reasons.includes('status_pesanan')) shopeeQty.statusBelumDivalidasi++;
    }

    /**
     * H2-B3a: status cakupan satu pesanan Shopee + kandidat refund penuh (metadata saja).
     * estimasi_minimum = pesanan tidak ada di export dan dianggap 1 unit tanpa alasan lain: HPP adalah BATAS BAWAH
     * (minimal 1 unit), jadi labanya batas atas. Rumus HPP-nya tidak diubah.
     */
    function shopeeCakupan(o, modal, notes, net) {
      if (!isOk(modal)) {
        const reasons = notes.length
          ? notes.filter((n) => !isOk(n.cost)).map((n) => (mode === 'acuan' ? 'diskon_pemasok_belum_diisi'
            : n.qtyBasis === 'tidak_diketahui' ? 'kuantitas_tidak_diketahui'
              : n.entry && (n.hppReasons || []).includes('identitas_berbeda') ? 'identitas_variasi_berbeda' : 'modal_belum_diisi'))
          : ['tanpa_rincian_produk'];
        ckAdd('shopee', 'tidak_diketahui', net, o.total, reasons, false);
      } else if (!notes.length) {
        // Tanpa baris produk: modal rata-rata dari nilai pesanan. Refund di sini belum punya dasar unit.
        ckAdd('shopee', o.refund !== 0 ? 'belum' : 'estimasi', net, o.total, [], o.refund !== 0 && o.harga + o.refund > 0);
      } else {
        const st = notes.map((n) => {
          const s = n.hppStatus === 'terverifikasi_kelompok' ? 'terverifikasi' : (n.hppStatus || 'belum');
          return s === 'estimasi' && n.qtyBasis === 'estimasi_1' ? 'estimasi_minimum' : s;
        });
        // Refund parsial yang HPP-nya masih dikurangi menurut nominal refund (share), bukan menurut unit (buku unit).
        const partial = notes.some((n) => n.it.refund !== 0 && n.it.harga + n.it.refund > 0 && n.qtyBasis !== 'buku_unit');
        ckAdd('shopee', weakest(st), net, o.total, [], partial);
      }
      for (const n of notes) {
        if (!(n.it.refund < 0 && !(n.it.harga + n.it.refund > 0))) continue;   // hanya item yang direfund penuh
        // Unit hanya dianggap diketahui bila jumlahnya terbukti dari export (bukan anggapan 1 unit, bukan nominal).
        const qtyKnown = n.qtyBasis === 'export' || n.qtyBasis === 'buku_unit';
        const units = qtyKnown ? n.qty : NaN;
        const unitCost = n.entry && !(n.hppReasons || []).includes('identitas_berbeda') ? n.unit : NaN;
        fullRefunds.push({ platform: 'shopee', orderId: o.id, product: n.it.name, skus: null, units,
          qtySource: qtyKnown ? 'export' : 'tidak_diketahui', value: isOk(units) && isOk(unitCost) ? unitCost * units : NaN,
          bukuUnit: !!(n.ledger && n.ledger.unitLedgerComplete) });
      }
    }

    /** H2-B3a: status cakupan satu pesanan TikTok + kandidat refund penuh (metadata saja). */
    function tiktokCakupan(r, modal, lines) {
      const partial = r.preGross > 0 && r.pre > 0 && r.pre < r.preGross;
      if (!isOk(modal)) {
        const reason = mode === 'acuan' ? 'diskon_pemasok_belum_diisi' : !lines.length ? 'tanpa_rincian_produk' : 'modal_belum_diisi';
        ckAdd('tiktok', 'tidak_diketahui', r.sales, r.settle, [reason], false);
      } else {
        // Refund parsial: modal masih dikurangi menurut nominal refund, jadi bukan estimasi yang valid → "belum".
        const st = partial ? 'belum' : mode === 'acuan' ? 'estimasi' : lines.some((l) => l.entry) ? 'belum' : 'estimasi';
        ckAdd('tiktok', st, r.sales, r.settle, [], partial);
      }
      if (r.preGross > 0 && !(r.pre > 0)) {
        // Refund penuh. "Detail produk terjual" tetap mencantumkan unit yang direfund (audit H2-B3), jadi untuk refund
        // penuh jumlah unitnya = jumlah di detail. Sumbernya dicatat agar bisa ditinjau.
        const src = r.lines.length ? r.lines : (m.tiktokLines.get(r.id) || []);
        const units = src.length ? src.reduce((a, l) => a + l.qty, 0) : NaN;
        const value = mode !== 'acuan' && lines.length && lines.every((l) => l.entry) ? lines.reduce((a, l) => a + l.entry.cost * l.qty, 0) : NaN;
        fullRefunds.push({ platform: 'tiktok', orderId: r.id, product: null, skus: src.map((l) => String(l.skuId)), units,
          qtySource: r.lines.length ? 'detail_produk' : src.length ? 'export' : 'tidak_diketahui', value: isOk(units) ? value : NaN, bukuUnit: false });
      }
    }

    if (want.has('shopee')) for (const o of m.shopeeOrders.values()) {
      if (!inRange(o.orderDate)) continue;
      shopeeIn.add(o.id);
      const { modal, items } = shopeeOrderModal(o);
      // Kepastian: pesanan yang modalnya tidak diketahui tidak masuk laba, jadi semua barisnya "tidak_diketahui".
      if (!isOk(modal)) { if (items.length) items.forEach((n) => kAdd('tidak_diketahui', n.it.harga + n.it.refund, 0)); else kAdd('tidak_diketahui', o.harga + o.refund, 0); }
      else if (!items.length) kAdd('estimasi', o.harga + o.refund, modal);   // tanpa baris produk: modal rata-rata
      else items.forEach((n) => kAdd(n.hppStatus || 'belum', n.it.harga + n.it.refund, n.cost));
      const net = o.harga + o.refund + o.voucher;
      shopeeCakupan(o, modal, items, net);
      const counted = o.harga + o.refund > 0;
      const pack = counted ? packing : 0;
      const fee = o.admin + o.proses + o.xtra + o.ams + o.ship + o.lain;
      const margin = isOk(modal) ? o.total - modal - pack : NaN;
      S.orders += counted ? 1 : 0; S.sales += net; S.received += o.total; S.packing += pack; S.voucher += o.voucher;
      if (isOk(modal)) { S.modal += modal; S.margin += margin; S.knownSales += net; S.knownReceived += o.total; S.knownPacking += pack; }
      for (const k of Object.keys(S.fees)) S.fees[k] += o[k];
      if (o.payDate && (!S.first || o.payDate < S.first)) S.first = o.payDate;
      if (o.payDate && o.payDate > S.last) S.last = o.payDate;
      const mm = mon(monthOf(o.orderDate) || '—').shopee;
      mm.sales += net; mm.received += o.total; mm.fees += fee; mm.orders += counted ? 1 : 0;
      if (isOk(margin)) { mm.margin += margin; mm.knownSales += net; }
      if (counted) addBucket(net, fee, margin);
      // alokasi ke produk: proporsional terhadap harga item
      const gross = o.harga + o.refund;
      for (const n of items) {
        const share = gross ? (n.it.harga + n.it.refund) / gross : 0;
        const p = touchProduct(`shopee|${n.it.productId || norm(n.it.name)}`, { platform: 'shopee', code: n.it.productId, sku: n.sku || '', name: n.it.name, variant: '' });
        p.name = n.it.name || p.name; if (n.sku && !p.sku) p.sku = n.sku;
        p.rows += 1; p.sales += n.it.harga + n.it.refund; p.received += o.total * share;
        // H2-B1: baris dengan buku unit memakai unit terjual bersih (bilangan bulat); baris lain tetap cara lama.
        if (n.ledger && n.ledger.unitLedgerComplete) p.qty += n.ledger.qtySold;
        else if (n.qty === null) p.qtyKnown = false; else p.qty += n.qty * clamp01(n.it.harga > 0 ? (n.it.harga + n.it.refund) / n.it.harga : 0);
        if (isOk(n.cost)) p.modal += n.cost; else p.modalKnown = false;
        if (isOk(n.unit)) { p.unitCost = n.unit; p.baseCost = n.base; }
        p.packing = (p.packing || 0) + pack * share;
        if (n.qtyStatus) {   // ringkasan status per produk (mode modal per produk saja); informasi tambahan
          const st = p.statusShopee || (p.statusShopee = { baris: 0, kuantitasBelum: 0, variasiAmbigu: 0, hppTerverifikasi: 0, hppBelum: 0 });
          st.baris++;
          if (n.qtyStatus !== 'terverifikasi') st.kuantitasBelum++;
          if (n.variantStatus === 'ambigu') st.variasiAmbigu++;
          if (n.hppStatus === 'terverifikasi' || n.hppStatus === 'terverifikasi_kelompok') st.hppTerverifikasi++; else st.hppBelum++;
        }
      }
    }
    if (want.has('shopee')) S.adj = [...m.shopeeAdj.values()].filter((a) => inRange(a.date)).reduce((a, x) => a + x.amount, 0);
    S.feeTotal = Object.values(S.fees).reduce((a, b) => a + b, 0);

    /* ===== TikTok ===== */
    const ttRatio = mode === 'acuan' && acuanReady(settings) ? (1 - settings.mitra / 100) / ((settings.coret || 100) / 100) : NaN;
    const T = { orders: 0, sales: 0, fees: { platform: 0, dinamis: 0, proses: 0, ongkir: 0, afiliasi: 0, lain: 0 }, received: 0, modal: 0, packing: 0,
      adj: 0, pre: 0, first: '', last: '', bySource: {}, knownSales: 0, knownReceived: 0, knownPacking: 0, margin: 0 };
    const ttOrderPrice = new Map();
    const ttUnitCost = new Map();   // skuId → modal per unit (untuk estimasi retur)
    function tiktokRowModal(r) {
      if (mode === 'acuan') return { modal: r.pre * ttRatio, lines: [] };
      const exp = m.tiktokLines.get(r.id) || [];
      const lines = r.lines.length ? r.lines.map((l) => ({ ...l, ...(exp.find((e) => e.skuId === l.skuId) || {}), qty: l.qty })) : exp;
      const share = r.preGross > 0 ? clamp01(r.pre / r.preGross) : (r.sales > 0 ? 1 : 0);
      if (!lines.length) { if (r.pre > 0) { ttNoDetail++; ttNoDetailSales += r.sales; } return { modal: isOk(fallback) ? Math.max(r.sales, 0) * fallback : NaN, lines: [] }; }
      let modal = 0, ok = true;
      const totalQty = lines.reduce((a, l) => a + l.qty, 0) || 1;
      const notes = lines.map((l) => {
        const entry = catalog.find([l.skuId, l.sellerSku], l.name, l.variant);
        let cost;
        if (entry) { cost = entry.cost * l.qty * share; ttUnitCost.set(l.skuId, entry.cost); }
        else if (isOk(fallback)) cost = Math.max(r.sales, 0) * fallback * (l.qty / totalQty);
        else { cost = NaN; ok = false; linesWithoutCost++; }
        modal += isOk(cost) ? cost : 0;
        return { ...l, cost, unit: entry ? entry.cost : NaN, base: entry ? entry.baseCost : NaN, entry, share };
      });
      return { modal: ok ? modal : NaN, lines: notes };
    }
    if (want.has('tiktok')) for (const r of m.tiktok.values()) {
      if (!r.isOrder) { if (inRange(r.payDate)) T.adj += r.settle; continue; }
      if (!inRange(r.orderDate)) continue;
      if (r.payDate && (!T.first || r.payDate < T.first)) T.first = r.payDate;
      if (r.payDate && r.payDate > T.last) T.last = r.payDate;
      const { modal, lines } = tiktokRowModal(r);
      // Kepastian TikTok: status HPP per baris belum dievaluasi (belum ada pencocokan seperti Shopee), jadi modal
      // per unit = "belum"; modal rata-rata / harga acuan = "estimasi"; tanpa modal = "tidak_diketahui".
      kAdd(!isOk(modal) ? 'tidak_diketahui' : mode === 'acuan' ? 'estimasi' : lines.some((l) => l.entry) ? 'belum' : 'estimasi', r.sales, modal);
      tiktokCakupan(r, modal, lines);
      const counted = r.pre > 0;             // terjual (tidak dibatalkan/direfund penuh)
      const pack = counted ? packing : 0;
      const margin = isOk(modal) ? r.settle - modal - pack : NaN;
      T.orders += counted ? 1 : 0; T.sales += r.sales; T.received += r.settle; T.pre += r.pre; T.packing += pack;
      if (isOk(modal)) { T.modal += modal; T.margin += margin; T.knownSales += r.sales; T.knownReceived += r.settle; T.knownPacking += pack; }
      for (const k of Object.keys(T.fees)) T.fees[k] += r.fees[k];
      const src = r.source || 'Lainnya';
      T.bySource[src] = T.bySource[src] || { sales: 0, margin: 0, orders: 0 };
      T.bySource[src].sales += r.sales; T.bySource[src].orders += counted ? 1 : 0;
      if (isOk(margin)) T.bySource[src].margin += margin;
      if (counted) ttOrderPrice.set(r.id, { pre: r.preGross, paid: r.sales > 0 ? r.sales : 0 });
      const mm = mon(monthOf(r.orderDate) || '—').tiktok;
      mm.sales += r.sales; mm.received += r.settle; mm.fees += r.totalBiaya; mm.orders += counted ? 1 : 0;
      if (isOk(margin)) { mm.margin += margin; mm.knownSales += r.sales; }
      if (counted) addBucket(r.sales, r.totalBiaya, margin);
      // alokasi ke produk: memakai subtotal SKU bila ada, jika tidak dibagi rata per unit
      const subTotal = lines.reduce((a, l) => a + (l.subtotal || 0), 0);
      const qtyTotal = lines.reduce((a, l) => a + l.qty, 0);
      for (const l of lines) {
        const w = subTotal > 0 ? (l.subtotal || 0) / subTotal : l.qty / (qtyTotal || 1);
        const p = touchProduct(`tiktok|${l.skuId || norm(l.name)}`, { platform: 'tiktok', code: l.skuId || '', sku: l.sellerSku || '', name: '', variant: l.variant || '' });
        if (l.name) p.name = l.name; else if (!p.name && l.entry && l.entry.nama) p.name = l.entry.nama;
        p.rows += 1; p.sales += r.sales * w; p.received += r.settle * w; p.qty += l.qty * (l.share ?? 1);
        if (isOk(l.cost)) p.modal += l.cost; else p.modalKnown = false;
        if (isOk(l.unit)) { p.unitCost = l.unit; p.baseCost = l.base; }
        p.packing = (p.packing || 0) + pack * w;
      }
    }
    T.feeTotal = Object.values(T.fees).reduce((a, b) => a + b, 0);
    T.discount = T.pre > 0 ? 1 - T.sales / T.pre : 0;
    const ttPaidRatio = T.sales > 0 ? T.pre / T.sales : 1;
    S.coverage = S.sales > 0 ? S.knownSales / S.sales : 0;
    T.coverage = T.sales > 0 ? T.knownSales / T.sales : 0;
    if (S.knownSales <= 0) S.margin = NaN;
    if (T.knownSales <= 0) T.margin = NaN;

    /* ===== Produk + saran harga ===== */
    const platformFeePct = { shopee: S.sales > 0 ? -S.feeTotal / S.sales : 0, tiktok: T.sales > 0 ? -T.feeTotal / T.sales : 0 };
    // Tarif efektif toko: biaya pemrosesan dihitung tetap per pesanan, sisanya persen dari penjualan.
    // Inilah "tarif terbaru" yang paling akurat, karena diambil dari potongan yang benar-benar terjadi.
    const feeModel = (X) => (X.orders > 0 && X.sales > 0 ? { pct: -(X.feeTotal - X.fees.proses) / X.sales, fixed: -X.fees.proses / X.orders, orders: X.orders } : null);
    const feeModels = { shopee: feeModel(S), tiktok: feeModel(T) };
    const products = [...prod.values()].map((p) => {
      const fees = p.received - p.sales;
      const margin = p.modalKnown ? p.received - p.modal - (p.packing || 0) : NaN;
      const avgPrice = p.qtyKnown && p.qty > 0 ? p.sales / p.qty : NaN;
      const feePct = p.sales > 200000 ? -fees / p.sales : platformFeePct[p.platform];
      const packUnit = p.qty > 0 ? (p.packing || 0) / p.qty : packing;
      const unit = p.unitCost;
      const breakEven = isOk(unit) && feePct < 1 ? (unit + packUnit) / (1 - feePct) : NaN;
      const targetPrice = isOk(unit) && feePct + target < 1 ? (unit + packUnit) / (1 - feePct - target) : NaN;
      let health = 'unknown';
      if (isOk(margin)) health = margin < 0 ? 'rugi' : (p.sales > 0 && margin / p.sales < target ? 'tipis' : 'sehat');
      if (isOk(avgPrice) && isOk(breakEven) && avgPrice < breakEven) health = 'rugi';
      return { ...p, name: p.name || (p.code ? `SKU ${p.code}` : 'Tanpa nama'), fees, margin, pct: isOk(margin) && p.sales ? margin / p.sales : NaN,
        avgPrice, feePct, breakEven, targetPrice, health };
    });

    /* ===== Retur ===== */
    const shopeeOrderDate = new Map([...m.shopeeOrders.values()].map((o) => [o.id, o.orderDate]));
    const shopeeOrderCostRatio = (orderId, d) => {
      if (mode === 'acuan') return shopeeRatio(settings, d);
      return isOk(fallback) ? fallback : NaN;
    };
    /* H2-A: jumlah unit yang direfund per kasus retur, beserta tingkat keyakinannya.
     * Sumber: file retur (c.qty) dan, khusus Shopee, kolom returnedQty export pesanan pada baris yang SAMA
     * (nomor pesanan + nama produk + variasi). Jumlah unit TIDAK PERNAH diturunkan dari nominal refund.
     *  terverifikasi   file retur dan export menyebut jumlah yang sama
     *  satu_sumber     hanya satu sumber punya angka → dipakai, tetapi tidak dianggap terverifikasi
     *  konflik         sumber berbeda, atau kasus berbeda antar file retur → TIDAK dipakai (bukan min/maks)
     *  tidak_cocok     pesanan ada di export tetapi baris produknya tidak ditemukan → TIDAK dipakai
     *  tidak_diketahui tidak ada sumber yang punya angka
     * Kasus dengan pesanan + produk + variasi yang sama dibandingkan bersama (beberapa pengajuan retur). */
    const caseGroupKey = (c) => (c.platform === 'shopee' ? `S|${c.orderId}|${norm(c.product)}|${norm(c.variant)}` : `T|${c.orderId}|${c.skuId}`);
    const caseGroups = new Map();
    for (const c of m.cases.values()) { const k = caseGroupKey(c); if (!caseGroups.has(k)) caseGroups.set(k, []); caseGroups.get(k).push(c); }
    /** Unit direfund menurut export Shopee untuk baris produk yang sama. */
    function exportRefundUnits(c) {
      const ls = c.platform === 'shopee' ? m.shopeeLines.get(c.orderId) : null;
      if (!ls) return { status: 'tanpa_export' };
      const meta = m.shopeeOrderMeta.get(c.orderId);
      if (meta && (meta.finansial || meta.status)) return { status: 'konflik' };   // export pesanan ini sendiri berbeda antar file
      const hit = ls.filter((l) => norm(l.name) === norm(c.product) && norm(l.variant) === norm(c.variant));
      if (!hit.length) return { status: 'tidak_cocok' };
      if (!hit.every((l) => isOk(l.returnedQty))) return { status: 'tanpa_kolom' };
      return { status: 'ada', units: hit.reduce((a, l) => a + l.returnedQty, 0) };
    }
    const unitCache = new Map();
    function returnUnits(c) {
      const k = caseGroupKey(c);
      if (!unitCache.has(k)) {
        const g = caseGroups.get(k), ex = exportRefundUnits(g[0]);
        const caseKnown = g.every((x) => isOk(x.qty)), caseSum = g.reduce((a, x) => a + x.qty, 0);
        let status;
        if (g.some((x) => x.versiBerbeda) || ex.status === 'konflik') status = 'konflik';
        else if (ex.status === 'tidak_cocok') status = 'tidak_cocok';
        else if (ex.status === 'ada') status = caseKnown ? (caseSum === ex.units ? 'terverifikasi' : 'konflik') : (g.length === 1 ? 'satu_sumber' : 'tidak_diketahui');
        else status = caseKnown ? 'satu_sumber' : 'tidak_diketahui';
        const fromExport = ex.status === 'ada' && !caseKnown && g.length === 1;
        unitCache.set(k, { status, source: fromExport ? 'export' : (caseKnown ? 'file_retur' : null), exportUnits: ex.units });
      }
      const u = unitCache.get(k);
      const units = u.status === 'terverifikasi' || (u.status === 'satu_sumber' && u.source === 'file_retur') ? c.qty
        : u.status === 'satu_sumber' && u.source === 'export' ? u.exportUnits : NaN;
      return { units, unitStatus: u.status, unitSource: u.source };
    }

    const cases = [...m.cases.values()].filter((c) => want.has(c.platform) && inRange(c.platform === 'shopee' ? (shopeeOrderDate.get(c.orderId) || c.date) : c.date)).map((c) => {
      const { units, unitStatus, unitSource } = returnUnits(c);
      let estModal, usesUnits = false, modalSource = null, modalKeyOk = false;
      if (c.platform === 'shopee') {
        // Modal per unit memakai aturan pencarian Shopee yang sama dengan penjualan (E1/E2): modal milik variasi
        // lain tidak dipakai. Mode lain memakai nilai refund × rasio seperti sebelumnya (tidak memakai jumlah unit).
        const found = mode === 'produk' ? shopeeCostOf({ name: c.product, productId: '' }, { variant: c.variant, skuVariant: '', sku: '' }) : { entry: null };
        usesUnits = !!found.entry;
        if (found.entry) { modalSource = `modal_per_unit:${found.key}`; modalKeyOk = found.key !== 'produk_legacy'; }
        else modalSource = mode === 'acuan' ? 'harga_acuan' : 'modal_rata_rata';
        estModal = found.entry ? found.entry.cost * units : c.amount * shopeeOrderCostRatio(c.orderId, shopeeOrderDate.get(c.orderId) || c.date);
      } else if (mode === 'produk') {
        const unit = ttUnitCost.get(c.skuId) ?? (catalog.find([c.skuId], c.product, c.variant) || {}).cost;
        usesUnits = isOk(unit);
        modalSource = usesUnits ? 'modal_per_unit:sku_tiktok' : 'modal_rata_rata';
        modalKeyOk = usesUnits;
        estModal = isOk(unit) ? unit * units : c.amount * fallback;
      } else {
        const op = ttOrderPrice.get(c.orderId);
        modalSource = 'harga_acuan';
        estModal = c.amount * (op && op.paid > 0 ? op.pre / op.paid : ttPaidRatio) * ttRatio;
      }
      // Alasan bila perkiraan modal retur tidak bisa dihitung (A3: tidak pernah diganti 0).
      const estReason = isOk(estModal) ? null : usesUnits ? `jumlah_${unitStatus}` : !isOk(c.amount) ? 'nilai_refund_tidak_diketahui' : 'modal_tidak_ditemukan';
      // P4: dasar dan kepastian nilai kerugian/risiko retur (metadata; tidak mengubah angka).
      //  terverifikasi  = modal per unit dengan kunci variasi/produk yang tepat + jumlah unit terverifikasi 2 sumber
      //  sementara      = ada angka, tetapi dasarnya satu sumber, modal tingkat produk, atau nilai refund × rasio
      //                   (modal rata-rata / harga acuan = estimasi)
      //  tidak_diketahui = tidak ada angka
      const lossBasis = !isOk(estModal) ? null : usesUnits ? 'modal_per_unit' : 'nilai_refund_x_rasio';
      const lossCertainty = !isOk(estModal) ? 'tidak_diketahui'
        : usesUnits && modalKeyOk && unitStatus === 'terverifikasi' ? 'terverifikasi' : 'sementara';
      const lossReason = lossCertainty === 'terverifikasi' ? null : lossCertainty === 'tidak_diketahui' ? estReason
        : !usesUnits ? 'nilai_refund_x_rasio' : !modalKeyOk ? 'modal_tingkat_produk' : `jumlah_${unitStatus}`;
      const needsCheck = CHECK_CATS.has(c.cat);
      return { ...c, estModal, estReason, units, unitStatus, unitSource, modalSource, lossBasis, lossCertainty, lossReason,
        needsCheck, state: needsCheck ? (caseState[c.key] || 'belum') : 'na' };
    });
    // Angka risiko/kerugian hanya menjumlahkan kasus yang nilainya diketahui. Kasus tanpa nilai dihitung terpisah
    // (kerugianTanpaNilai / risikoTanpaNilai) agar "Rp0" tidak disalahartikan sebagai "tidak ada risiko".
    const sumOk = (arr) => arr.reduce((a, c) => a + (isOk(c.estModal) ? c.estModal : 0), 0);
    const lostCertain = sumOk(cases.filter((c) => c.state === 'hilang'));
    const unknownRisk = sumOk(cases.filter((c) => c.state === 'belum'));
    const lostNoValue = cases.filter((c) => c.state === 'hilang' && !isOk(c.estModal)).length;
    const riskNoValue = cases.filter((c) => c.state === 'belum' && !isOk(c.estModal)).length;
    // P5: kerugian yang masuk laba (lostCertain) dipecah menurut kepastiannya; jumlah keduanya = lostCertain.
    const lostVerified = sumOk(cases.filter((c) => c.state === 'hilang' && c.lossCertainty === 'terverifikasi'));
    const lostProvisional = sumOk(cases.filter((c) => c.state === 'hilang' && c.lossCertainty === 'sementara'));
    const catSummary = {};
    for (const c of cases) {
      const k = `${c.platform}|${c.cat}`;
      catSummary[k] = catSummary[k] || { platform: c.platform, cat: c.cat, label: CAT_LABEL[c.cat], count: 0, amount: 0, amountKnown: 0, amountUnknown: 0 };
      catSummary[k].count += 1;
      if (isOk(c.amount)) catSummary[k].amountKnown += c.amount; else catSummary[k].amountUnknown += 1;   // nilai refund tidak diketahui
    }
    // P3: total kategori hanya bila SEMUA nilainya diketahui; selain itu NaN (tampil "—"), bukan jumlah sebagian
    // yang terlihat lengkap. Jumlah yang diketahui tetap tersedia di amountKnown.
    for (const x of Object.values(catSummary)) x.amount = x.amountUnknown ? NaN : x.amountKnown;

    /* ===== Total ===== */
    const has = { shopee: want.has('shopee') && available.shopee, tiktok: want.has('tiktok') && available.tiktok };
    const pick = (f) => (has.shopee ? f(S) : 0) + (has.tiktok ? f(T) : 0);
    const totalSales = pick((p) => p.sales);
    const knownSales = pick((p) => p.knownSales);
    const coverage = totalSales > 0 ? knownSales / totalSales : 0;
    const ready = knownSales > 0;
    const marginRaw = pick((p) => (isOk(p.margin) ? p.margin : 0));
    const totalMargin = ready ? marginRaw - lostCertain : NaN;
    const first = [has.shopee && S.first, has.tiktok && T.first].filter(Boolean).sort()[0] || '';
    const last = [has.shopee && S.last, has.tiktok && T.last].filter(Boolean).sort().slice(-1)[0] || '';
    const days = daysBetween(first, last);
    const monthsSpan = days / 30.4;
    const orders = pick((p) => p.orders);
    const fixedMonthly = fixedPerMonth(settings);
    const opex = fixedMonthly * monthsSpan;
    const monthList = [...months.values()].filter((x) => x.month !== '—').sort((a, b) => a.month.localeCompare(b.month));
    for (const x of monthList) {
      const sel = [has.shopee && x.shopee, has.tiktok && x.tiktok].filter(Boolean);
      x.total = { sales: sel.reduce((a, v) => a + v.sales, 0), fees: sel.reduce((a, v) => a + v.fees, 0), received: sel.reduce((a, v) => a + v.received, 0),
        margin: sel.reduce((a, v) => a + v.margin, 0), knownSales: sel.reduce((a, v) => a + v.knownSales, 0), orders: sel.reduce((a, v) => a + v.orders, 0) };
      x.total.net = x.total.margin - fixedMonthly;
    }

    /**
     * H2-A: kepastian laba (metadata, tidak mengubah angka).
     *  laba.dariDataTersedia = totalMargin (angka yang sama dengan sebelumnya).
     *  laba.final hanya true bila SEMUA syarat terpenuhi; alasan yang belum terpenuhi ada di alasanTidakFinal.
     *  "Modal diketahui" (coverage) ≠ modal terverifikasi: estimasi dan "belum" tetap dipisah di hpp/penjualan.
     */
    /**
     * H2-B3a: refund penuh yang kondisi fisik barangnya BELUM diketahui (EXPOSURE/risiko, bukan kerugian; tidak
     * masuk laba). Kondisi fisik dianggap diketahui HANYA bila seller sudah menandai kasus retur yang cocok sebagai
     * "kembali" atau "hilang" (sumberKondisi = tanda_seller). Kategori yang dibaca dari teks/alasan marketplace
     * (mis. "tidak dikirim") hanya INDIKASI, bukan bukti unit tertentu tidak pernah dikirim. Kasus "batal"
     * (pengajuan dibatalkan/ditolak) tidak menjelaskan nasib barang.
     *  tanpa_kasus_retur        tidak ada kasus retur yang cocok sama sekali
     *  retur_item_ambigu        (Shopee) kasus hanya menyebut nama produk, tetapi pesanan punya lebih dari satu
     *                           kandidat baris/variasi bernama sama → tidak dipakai, tidak memilih salah satu
     *  kasus_belum_dicek        ada kasus yang belum ditandai seller (tumpang tindih dengan risiko kasus lama)
     *  kasus_tidak_menjelaskan  ada kasus, tetapi tidak ada tanda seller untuk semua barang (termasuk indikasi saja)
     */
    function refundTanpaCatatanFisik() {
      const st = (c) => (CHECK_CATS.has(c.cat) ? (caseState[c.key] || 'belum') : 'na');
      const sellerMark = (c) => CHECK_CATS.has(c.cat) && (st(c) === 'kembali' || st(c) === 'hilang');
      const oid = (x) => String(x).replace(/^'/, '');
      const keyOf = (pf, orderId, product) => (pf === 'shopee' ? `S|${oid(orderId)}|${norm(product)}` : `T|${oid(orderId)}`);
      const idx = new Map();
      for (const c of m.cases.values()) {
        const k = keyOf(c.platform, c.orderId, c.product);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(c);
      }
      /** Shopee: kasus retur bisa dipakai untuk item ini hanya bila kandidatnya tunggal (satu baris laporan bernama
       *  sama dan paling banyak satu variasi di export). Tidak memilih variasi pertama atau menebak dari urutan. */
      const shopeeAmbiguous = (orderId, product) => {
        const nm = norm(product);
        const rows = (itemsByOrder.get(orderId) || []).filter((it) => norm(it.name) === nm).length;
        const variants = new Set((m.shopeeLines.get(orderId) || []).filter((l) => norm(l.name) === nm).map((l) => norm(l.variant)));
        return rows > 1 || variants.size > 1;
      };
      const blank = () => ({ jumlahPesanan: 0, jumlahTransaksi: 0, jumlahUnitDiketahui: 0, transaksiUnitTidakDiketahui: 0,
        nilaiModalDiketahui: 0, kasusModalTidakDiketahui: 0, sumberQty: {}, kondisi: {}, indikasi: {},
        tumpangTindih: { risikoKasusBelumDicek: 0, bukuUnit: 0 },
        // Refund penuh yang kondisi fisiknya diketahui (tidak masuk exposure), beserta sumber buktinya.
        kondisiDiketahui: { jumlahTransaksi: 0, sumberKondisi: {} } });
      const out = { shopee: blank(), tiktok: blank() };
      const orders = { shopee: new Set(), tiktok: new Set() };
      for (const f of fullRefunds) {
        const o = out[f.platform];
        const ambiguous = f.platform === 'shopee' && shopeeAmbiguous(f.orderId, f.product);
        const cs = ambiguous ? [] : (idx.get(keyOf(f.platform, f.orderId, f.product)) || []);
        const hasCase = !!(idx.get(keyOf(f.platform, f.orderId, f.product)) || []).length;
        // TikTok: setiap SKU di rincian produk harus punya kasus bertanda seller. Tanpa rincian, satu tanda cukup
        // hanya bila tidak ada kasus lain yang belum dicek (dicek di bawah).
        const marked = cs.some(sellerMark) && (!f.skus || !f.skus.length || f.skus.every((s) => cs.some((c) => oid(c.skuId) === s && sellerMark(c))));
        let kondisi;
        if (ambiguous && hasCase) kondisi = 'retur_item_ambigu';
        else if (!cs.length) kondisi = 'tanpa_kasus_retur';
        else if (cs.some((c) => CHECK_CATS.has(c.cat) && st(c) === 'belum')) kondisi = 'kasus_belum_dicek';
        else if (marked) {   // kondisi fisik diketahui dari tanda seller → bukan exposure
          o.kondisiDiketahui.jumlahTransaksi++;
          o.kondisiDiketahui.sumberKondisi.tanda_seller = (o.kondisiDiketahui.sumberKondisi.tanda_seller || 0) + 1;
          continue;
        } else kondisi = 'kasus_tidak_menjelaskan';
        orders[f.platform].add(f.orderId);
        o.jumlahTransaksi++;
        if (isOk(f.units)) o.jumlahUnitDiketahui += f.units; else o.transaksiUnitTidakDiketahui++;
        if (isOk(f.value)) o.nilaiModalDiketahui += f.value; else o.kasusModalTidakDiketahui++;
        o.sumberQty[f.qtySource] = (o.sumberQty[f.qtySource] || 0) + 1;
        o.kondisi[kondisi] = (o.kondisi[kondisi] || 0) + 1;
        // Indikasi dari teks marketplace dicatat terpisah (tidak mengubah status kondisi fisik).
        if (cs.some((c) => c.cat === 'tidak_dikirim')) o.indikasi.tidak_dikirim = (o.indikasi.tidak_dikirim || 0) + 1;
        if (kondisi === 'kasus_belum_dicek') o.tumpangTindih.risikoKasusBelumDicek++;
        if (f.bukuUnit) o.tumpangTindih.bukuUnit++;
      }
      for (const pf of ['shopee', 'tiktok']) out[pf].jumlahPesanan = orders[pf].size;
      return { kondisiFisikStatus: 'belum_diketahui', ...sumParts(out.shopee, out.tiktok), perMarketplace: out };
    }

    /** Jumlahkan dua objek bertingkat berisi angka (untuk total Shopee + TikTok). */
    function sumParts(a, b) {
      const res = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const x = a[k], y = b[k];
        if (typeof x === 'object' || typeof y === 'object') res[k] = sumParts(x || {}, y || {});
        else res[k] = (x || 0) + (y || 0);
      }
      return res;
    }

    /** H2-B3a: kepastian.cakupan (lihat ckAdd). Hanya metadata; tidak dipakai menghitung angka lain. */
    function buildCakupan(r) {
      const per = {};
      for (const pf of ['shopee', 'tiktok']) {
        const c = CK[pf];
        per[pf] = { ...c, penjualan: { total: Object.values(c.penjualan).reduce((a, v) => a + v, 0), ...c.penjualan } };
      }
      const total = sumParts(per.shopee, per.tiktok);
      // total dihitung ulang dari status (bukan dari r.totalSales) supaya rekonsiliasi di tes bermakna.
      return {
        dasar: 'penjualan_bersih_per_pesanan',
        ...total,
        labaTerhitung: { nilai: r.totalMargin, dasarPenjualan: r.knownSales },
        refundTanpaCatatanFisik: refundTanpaCatatanFisik(),
        perMarketplace: per,
      };
    }

    function buildKepastian(r) {
      const why = [];
      if (!r.ready) why.push('laba_belum_dapat_dihitung');
      if (r.knownSales < r.totalSales) why.push('modal_tidak_diketahui');
      if (K.baris.estimasi) why.push('hpp_estimasi');
      if (K.baris.belum) why.push('hpp_belum_terverifikasi');
      if (K.baris.tidak_diketahui) why.push('hpp_tidak_diketahui');
      const check = r.cases.filter((c) => c.needsCheck);
      if (check.some((c) => c.state === 'belum')) why.push('retur_belum_dicek');
      if (check.some((c) => c.state === 'hilang' && c.unitStatus !== 'terverifikasi')) why.push('jumlah_retur_belum_terverifikasi');
      if (lostNoValue) why.push('kerugian_retur_tanpa_nilai');
      if (lostProvisional) why.push('kerugian_retur_sementara');
      if (ledgerStats.unitBelumDiketahui) why.push('kondisi_fisik_unit_refund_belum_diketahui');
      if (r.adjustments) why.push('penyesuaian_belum_diklasifikasikan');
      // Total tiap Laporan Penghasilan harus cocok dengan ringkasan resmi (toleransi Rp1, sama seperti dashboard).
      for (const p of parsed) {
        if (p.kind !== 'shopee_income' && p.kind !== 'tiktok_income') continue;
        if (!want.has(p.kind === 'shopee_income' ? 'shopee' : 'tiktok')) continue;
        const ref = p.kind === 'shopee_income' ? p.check.summaryTotal : p.check.reportSettle;
        if (ref === null || ref === undefined) { if (!why.includes('ringkasan_resmi_tidak_ada')) why.push('ringkasan_resmi_tidak_ada'); }
        else if (Math.abs(ref - p.check.sum) > 1 && !why.includes('total_file_tidak_cocok')) why.push('total_file_tidak_cocok');
      }
      // Kelengkapan periode (bulan lengkap, A.17) belum bisa dibuktikan oleh engine → laba tidak pernah final dulu.
      why.push('periode_belum_divalidasi');
      const unitRetur = {};
      for (const c of check) unitRetur[c.unitStatus] = (unitRetur[c.unitStatus] || 0) + 1;
      const files = (kind) => parsed.filter((p) => p.kind === kind).length;
      return {
        laba: { dariDataTersedia: r.totalMargin, final: why.length === 0, alasanTidakFinal: why },
        hpp: { ...K.hpp }, penjualan: { ...K.penjualan }, baris: { ...K.baris },
        // H2-B3a: cakupan per pesanan (lihat buildCakupan). Penjualan di sini = totalSales, berbeda dari penjualan di atas.
        cakupan: buildCakupan(r),
        // H2-B1: buku unit Shopee. nilaiUnitBelumDiketahui = modal unit yang direfund tetapi kondisi fisiknya belum
        // diketahui (risiko, BUKAN kerugian; tidak masuk laba). Bisa tumpang tindih dengan risiko kasus "belum dicek".
        bukuUnit: { ...ledgerStats, status: { ...ledgerStats.status } },
        // kerugianTerverifikasi + kerugianSementara = kerugian yang saat ini masuk laba (lostCertain).
        risikoBarang: { kerugianTerverifikasi: lostVerified, kerugianSementara: lostProvisional, risikoTerhitung: unknownRisk,
          kerugianTanpaNilai: lostNoValue, risikoTanpaNilai: riskNoValue, unitRetur },
        sumberData: {
          laporanPenghasilan: { shopee: files('shopee_income'), tiktok: files('tiktok_income') },
          exportPesanan: { shopee: files('shopee_orders'), tiktok: files('tiktok_orders') },
          fileRetur: { shopee: files('shopee_return'), tiktok: files('tiktok_return') },
          saldo: files('shopee_balance') ? 'diunggah, belum dipakai' : 'tidak ada',
          metodeModal: mode === 'acuan' ? 'harga_acuan' : 'modal_per_unit / modal_rata_rata',
        },
      };
    }

    const result = {
      mode, ready, coverage, knownSales, has, available, shopee: S, tiktok: T, lostCertain, unknownRisk, totalMargin,
      totalSales, totalFees: pick((p) => p.feeTotal), totalReceived: pick((p) => p.received),
      totalModal: pick((p) => p.modal), totalPacking: pick((p) => p.packing), knownReceived: pick((p) => p.knownReceived), knownPacking: pick((p) => p.knownPacking), adjustments: pick((p) => p.adj),
      orders, first, last, days, monthsSpan, feeModel: feeModels,
      perMonth: ready && monthsSpan > 0 ? totalMargin / monthsSpan : NaN, perOrder: ready && orders ? totalMargin / orders : NaN,
      fixedMonthly, opex, netProfit: ready ? totalMargin - opex : NaN,
      months: monthList, allMonths: [...allMonths].sort(), buckets: buckets.filter((b) => b.orders > 0),
      products, cases, catSummary: Object.values(catSummary), dupes: m.dupes, target,
      qtyAssumed, shopeeQty, linesWithoutCost, ttNoDetail, ttNoDetailSales, hasOrderExport: { shopee: m.shopeeLines.size > 0, tiktok: m.tiktokLines.size > 0 },
      productsWithoutCost: products.filter((p) => !p.modalKnown).length,
    };
    result.kepastian = buildKepastian(result);
    result.insights = insights(result);
    return result;
  }

  /* ---------- temuan otomatis ---------- */
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const monthName = (k) => { const [y, mm] = String(k).split('-'); return BULAN[+mm - 1] ? `${BULAN[+mm - 1]} ${y}` : k; };
  const rp = (v) => `${v < 0 ? '−' : ''}Rp${Math.abs(Math.round(v)).toLocaleString('id-ID')}`;
  const pc = (v, d = 1) => `${(v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  /** Daftar temuan berbasis aturan, diurutkan dari yang paling penting. level: bad | warn | good | info */
  function insights(r) {
    const out = [];
    const add = (level, score, title, detail, action = '') => out.push({ level, score, title, detail, action });
    if (!r.totalSales) return out;

    if (!r.ready) add('warn', 100, 'Margin belum bisa dihitung', 'Modal produk belum diisi, jadi yang terlihat baru penjualan dan potongan platform.', 'Isi modal per produk atau modal rata-rata di langkah 2.');
    else if (r.coverage < 0.98) {
      const why = [];
      if (r.productsWithoutCost) why.push(`${r.productsWithoutCost} produk belum punya modal`);
      if (r.ttNoDetail && !(r.mode === 'acuan')) why.push(`${r.ttNoDetail.toLocaleString('id-ID')} pesanan TikTok tidak mencantumkan produk di laporan penghasilan`);
      add('warn', 90, `Modal baru diketahui untuk ${pc(r.coverage, 0)} penjualan`,
        `${why.join('; ') || 'Sebagian pesanan belum punya modal'}. Margin hanya menghitung penjualan yang modalnya diketahui.`,
        r.ttNoDetail ? 'Unggah export pesanan TikTok, atau isi modal rata-rata (%) sebagai cadangan.' : 'Lengkapi template modal per produk.');
    }
    if (r.qtyAssumed > 0) add('info', 40, `${r.qtyAssumed.toLocaleString('id-ID')} item Shopee memakai jumlah = 1`,
      'Laporan penghasilan Shopee tidak mencatat jumlah barang per produk.', 'Unggah export pesanan Shopee agar jumlah barang tepat.');

    const feePct = -r.totalFees / r.totalSales;
    add(feePct > 0.2 ? 'bad' : feePct > 0.15 ? 'warn' : 'info', 70, `Potongan platform ${pc(feePct)} dari penjualan`,
      `Total ${rp(-r.totalFees)} dipotong marketplace. Rata-rata ${rp(-r.totalFees / Math.max(r.orders, 1))} per pesanan.`);

    // tren potongan: 2 bulan terakhir vs 3 bulan pertama
    const ms = r.months.filter((x) => x.total.sales > 0);
    if (ms.length >= 4) {
      const avg = (arr) => arr.reduce((a, x) => a - x.total.fees, 0) / Math.max(arr.reduce((a, x) => a + x.total.sales, 0), 1);
      const early = avg(ms.slice(0, 3)), late = avg(ms.slice(-2));
      if (late - early > 0.01) add('bad', 85, `Potongan platform naik ${pc(late - early)} poin`,
        `Dari ${pc(early)} di awal periode menjadi ${pc(late)} di 2 bulan terakhir. Harga jual yang sama kini menyisakan margin lebih kecil.`, 'Tinjau ulang harga jual atau ikut/keluar program ongkir & komisi.');
      else if (early - late > 0.01) add('good', 50, `Potongan platform turun ${pc(early - late)} poin`, `Dari ${pc(early)} menjadi ${pc(late)} di 2 bulan terakhir.`);
      if (r.ready) {
        const best = ms.reduce((a, x) => (x.total.margin > a.total.margin ? x : a));
        const worst = ms.reduce((a, x) => (x.total.margin < a.total.margin ? x : a));
        add('info', 30, `Bulan terbaik ${monthName(best.month)}, terlemah ${monthName(worst.month)}`, `Margin ${rp(best.total.margin)} vs ${rp(worst.total.margin)}.`);
      }
    }

    if (r.ready && r.has.shopee && r.has.tiktok && isOk(r.shopee.margin) && isOk(r.tiktok.margin) && r.shopee.knownSales && r.tiktok.knownSales) {
      const a = r.shopee.margin / r.shopee.knownSales, b = r.tiktok.margin / r.tiktok.knownSales;
      if (Math.abs(a - b) > 0.03) {
        const [hi, lo, hv, lv] = a > b ? ['Shopee', 'TikTok Shop', a, b] : ['TikTok Shop', 'Shopee', b, a];
        add('info', 60, `${hi} lebih menguntungkan per rupiah penjualan`, `Margin ${pc(hv)} di ${hi} vs ${pc(lv)} di ${lo}.`, `Arahkan promosi ke ${hi}, atau naikkan harga di ${lo}.`);
      }
    }

    const losers = r.products.filter((p) => p.health === 'rugi' && isOk(p.margin)).sort((a, b) => a.margin - b.margin);
    if (losers.length) add('bad', 95, `${losers.length} produk merugi`,
      `Terbesar: ${losers.slice(0, 3).map((p) => `${p.name.slice(0, 40)} (${rp(p.margin)})`).join('; ')}.`, 'Naikkan harga ke batas aman di tabel saran harga, atau hentikan diskonnya.');
    const thin = r.products.filter((p) => p.health === 'tipis');
    if (thin.length) add('warn', 65, `${thin.length} produk di bawah target margin ${pc(r.target, 0)}`, 'Produk ini tetap untung, tetapi tipis. Sedikit kenaikan potongan platform bisa membuatnya rugi.');

    const known = r.products.filter((p) => isOk(p.margin) && p.margin > 0).sort((a, b) => b.margin - a.margin);
    if (r.ready && known.length >= 10) {
      const tot = known.reduce((a, p) => a + p.margin, 0);
      const top = known.slice(0, 5).reduce((a, p) => a + p.margin, 0);
      if (tot > 0) add(top / tot > 0.6 ? 'warn' : 'info', 45, `5 produk teratas menyumbang ${pc(top / tot, 0)} margin`,
        `Teratas: ${known[0].name.slice(0, 50)}.`, top / tot > 0.6 ? 'Jaga stok produk ini; ketergantungan tinggi pada sedikit produk.' : '');
    }

    const small = r.buckets.find((b) => b.hi <= 50000);
    if (small && small.orders >= 10) {
      const sp = -small.fees / Math.max(small.value, 1);
      if (r.ready && small.known && small.margin / small.known < 0) add('bad', 80, 'Pesanan di bawah Rp50 ribu rata-rata rugi', `${small.orders.toLocaleString('id-ID')} pesanan, potongan ${pc(sp)}.`, 'Buat paket bundling atau minimal pembelian.');
      else if (sp > feePct + 0.02) add('warn', 55, `Pesanan kecil kena potongan ${pc(sp)}`, `Lebih tinggi dari rata-rata ${pc(feePct)} karena biaya tetap per pesanan.`, 'Dorong pembeli menambah barang (bundling, gratis ongkir minimal belanja).');
    }

    const refunds = r.cases.filter((c) => c.cat !== 'batal');
    if (refunds.length) {
      const amt = refunds.reduce((a, c) => a + c.amount, 0);
      const unchecked = r.cases.filter((c) => c.state === 'belum').length;
      add(amt / r.totalSales > 0.03 ? 'warn' : 'info', 58, `Retur & refund ${pc(amt / r.totalSales)} dari penjualan`,
        `${refunds.length} kasus senilai ${rp(amt)}.${unchecked ? ` ${unchecked} kasus belum dicek apakah barangnya kembali.` : ''}`, unchecked ? 'Tandai status barang di bagian Retur.' : '');
    }
    if (r.ready && r.fixedMonthly > 0) {
      const net = r.netProfit;
      add(net < 0 ? 'bad' : 'good', 92, net < 0 ? 'Margin belum menutup biaya operasional' : 'Margin menutup biaya operasional',
        `Biaya tetap ${rp(r.fixedMonthly)}/bulan. Laba bersih periode ini ${rp(net)}.`, net < 0 ? `Butuh tambahan margin ${rp(-net / Math.max(r.monthsSpan, 1))} per bulan.` : '');
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Simulasi satu produk. Semua persen dalam angka 0–100. */
  function simulate({ listPrice, disc = 0, cost, feePct, feeFixed = 0, packing = 0, target = 15 }) {
    const price = listPrice * (1 - disc / 100);
    const fees = price * feePct / 100 + feeFixed;
    const margin = price - fees - cost - packing;
    const base = cost + packing + feeFixed;
    const breakEvenPrice = base / (1 - feePct / 100);
    const targetPrice = base / (1 - feePct / 100 - target / 100);
    const maxDisc = listPrice > 0 ? (1 - breakEvenPrice / listPrice) * 100 : NaN;
    return { listPrice, price, fees, cost, packing, margin, marginPct: price ? margin / price : NaN, maxDisc, breakEvenPrice, targetPrice };
  }

  /**
   * HPP per unit untuk produsen: biaya satu kali produksi (batch) dibagi jumlah jadi, ditambah kemasan per unit.
   * @param {{bahan:number, tenaga:number, overhead:number, hasil:number, kemasan:number}} x  Rupiah; hasil = unit jadi per batch
   */
  function hpp({ bahan = 0, tenaga = 0, overhead = 0, hasil = 0, kemasan = 0 } = {}) {
    const n = Number(hasil);
    if (!(n > 0)) return NaN;
    const v = (x) => (isOk(+x) && +x > 0 ? +x : 0);
    return (v(bahan) + v(tenaga) + v(overhead)) / n + v(kemasan);
  }

  /** Baris template modal: semua produk yang ditemukan, terisi modal yang sudah diketahui. */
  function templateRows(result) {
    const rows = result.products
      .sort((a, b) => a.platform.localeCompare(b.platform) || b.sales - a.sales)
      .map((p) => [p.platform === 'shopee' ? 'Shopee' : 'TikTok Shop', p.platform === 'tiktok' ? (p.code || p.sku) : (p.sku || p.code), p.name, p.variant || '',
        p.qtyKnown ? Math.round(p.qty) : p.rows, isOk(p.avgPrice) ? Math.round(p.avgPrice) : '', isOk(p.baseCost) ? p.baseCost : '']);
    return [TEMPLATE_HEADER, ...rows];
  }

  /**
   * Ubah workbook SheetJS menjadi {namaSheet: array-of-arrays}.
   * Penting: sebagian file TikTok menulis tag <dimension> yang salah (mis. A1:X19 padahal data sampai baris 544).
   * SheetJS mempercayai tag itu dan diam-diam memotong data, jadi rentang dihitung ulang dari sel yang benar-benar ada.
   */
  function sheetsFromSheetJS(XLSX, wbx) {
    const sheets = {};
    for (const n of wbx.SheetNames) {
      const ws = wbx.Sheets[n];
      let maxR = -1, maxC = -1;
      for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        const a = XLSX.utils.decode_cell(k);
        if (a.r > maxR) maxR = a.r;
        if (a.c > maxC) maxC = a.c;
      }
      if (maxR >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
      sheets[n] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    }
    return sheets;
  }

  return { num, date, norm, detect, sheetsFromSheetJS, monthName, parseWorkbook, compute, simulate, hpp, shopeeRatio, insights, templateRows, buildCatalog, modeOf,
    matchShopeeOrder, shopeeLineValue,
    CAT_LABEL, TEMPLATE_HEADER };
})();
if (typeof module !== 'undefined') module.exports = Engine;
