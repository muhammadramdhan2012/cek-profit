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
    for (const row of f.aoa.slice(f.h + 1)) {
      const g = getterAny(row, map);
      const orderId = str(g(...COL.shopeeOrderId));
      const qty = num(g(...COL.shopeeQty));
      if (!orderId || !(qty > 0)) continue;
      lines.push({ orderId, name: str(g(...COL.shopeeName)), sku: str(g(...COL.shopeeSku)), variant: str(g(...COL.shopeeVar)),
        qty, unitPrice: num(g(...COL.shopeePrice)), status: str(g(...COL.shopeeStatus)) });
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
        qty: num(g('Jumlah')) || 1, amount: num(g('Total Pengembalian Dana')), date: date(g('Waktu Pengembalian Diajukan')), cat });
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
      const qty = num(g('Return Quantity')) || 1;
      const amount = num(g('Return unit price')) * qty;
      const refunded = !!date(g('Refund Time')) && amount > 0;
      const type = str(g('Return Type')), reason = str(g('Return Reason')), resi = str(g('Return Logistics Tracking ID'));
      let cat;
      if (!refunded) cat = 'batal';
      else if (resi || /return and refund/i.test(type)) cat = 'retur_barang';
      else if (/arrive on time|did not receive/i.test(reason)) cat = 'paket_bermasalah';
      else if (/missing/i.test(reason)) cat = 'tidak_dikirim';
      else cat = 'refund_tanpa_retur';
      cases.push({ key: `T|${rid}|${str(g('SKU ID'))}`, platform: 'tiktok', orderId: str(g('Order ID')), skuId: str(g('SKU ID')),
        product: str(g('Product Name')), variant: str(g('SKU Name')), reason, note: str(g('Buyer Note')),
        resi, returnStatus: str(g('Return Status')), qty, amount, date: date(g('Time Requested')), cat });
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
      shopeeLines: new Map(), tiktokLines: new Map(), dupes: 0 };
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
        for (const c of p.cases) out.cases.set(c.key, c);
      } else if (p.kind === 'shopee_orders' || p.kind === 'tiktok_orders') {
        const target = p.kind === 'shopee_orders' ? out.shopeeLines : out.tiktokLines;
        for (const l of p.lines) {
          const k = `${p.kind}|${l.orderId}|${l.sku || l.skuId}|${l.name}|${l.variant}|${l.qty}`;
          if (seenLine.has(k)) continue;           // export yang sama diunggah dua kali
          seenLine.add(k);
          if (!target.has(l.orderId)) target.set(l.orderId, []);
          target.get(l.orderId).push(l);
        }
      }
    }
    return out;
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
        const r = shopeeRatio(settings, o.orderDate);
        return { modal: gross * r, items: items.map((it) => ({ it, qty: null, cost: (it.harga + it.refund) * r, unit: NaN, entry: null })) };
      }
      const exp = m.shopeeLines.get(o.id) || [];
      const used = new Set();
      let modal = 0, ok = true;
      const notes = items.map((it) => {
        const lines = exp.filter((l, i) => !used.has(i) && norm(l.name) === norm(it.name));
        lines.forEach((l) => used.add(exp.indexOf(l)));
        const qty = lines.length ? lines.reduce((a, l) => a + l.qty, 0) : null;
        const l0 = lines[0] || {};
        const entry = catalog.find([l0.sku, it.productId], it.name, l0.variant);
        const share = it.harga > 0 ? clamp01((it.harga + it.refund) / it.harga) : 0;
        let cost;
        if (entry) { cost = entry.cost * (qty ?? 1) * share; if (qty === null) qtyAssumed++; }
        else if (isOk(fallback)) cost = (it.harga + it.refund) * fallback;
        else { cost = NaN; ok = false; linesWithoutCost++; }
        modal += isOk(cost) ? cost : 0;
        return { it, qty, cost, unit: entry ? entry.cost : NaN, base: entry ? entry.baseCost : NaN, entry, sku: l0.sku, variant: l0.variant };
      });
      if (!items.length) { if (isOk(fallback)) modal = gross * fallback; else ok = false; }
      return { modal: ok ? modal : NaN, items: notes };
    }

    if (want.has('shopee')) for (const o of m.shopeeOrders.values()) {
      if (!inRange(o.orderDate)) continue;
      shopeeIn.add(o.id);
      const { modal, items } = shopeeOrderModal(o);
      const net = o.harga + o.refund + o.voucher;
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
        if (n.qty === null) p.qtyKnown = false; else p.qty += n.qty * clamp01(n.it.harga > 0 ? (n.it.harga + n.it.refund) / n.it.harga : 0);
        if (isOk(n.cost)) p.modal += n.cost; else p.modalKnown = false;
        if (isOk(n.unit)) { p.unitCost = n.unit; p.baseCost = n.base; }
        p.packing = (p.packing || 0) + pack * share;
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
    const cases = [...m.cases.values()].filter((c) => want.has(c.platform) && inRange(c.platform === 'shopee' ? (shopeeOrderDate.get(c.orderId) || c.date) : c.date)).map((c) => {
      let estModal;
      if (c.platform === 'shopee') {
        const entry = mode === 'produk' ? catalog.find([], c.product, c.variant) : null;
        estModal = entry ? entry.cost * (c.qty || 1) : c.amount * shopeeOrderCostRatio(c.orderId, shopeeOrderDate.get(c.orderId) || c.date);
      } else if (mode === 'produk') {
        const unit = ttUnitCost.get(c.skuId) ?? (catalog.find([c.skuId], c.product, c.variant) || {}).cost;
        estModal = isOk(unit) ? unit * (c.qty || 1) : c.amount * fallback;
      } else {
        const op = ttOrderPrice.get(c.orderId);
        estModal = c.amount * (op && op.paid > 0 ? op.pre / op.paid : ttPaidRatio) * ttRatio;
      }
      const needsCheck = CHECK_CATS.has(c.cat);
      return { ...c, estModal, needsCheck, state: needsCheck ? (caseState[c.key] || 'belum') : 'na' };
    });
    const sumOk = (arr) => arr.reduce((a, c) => a + (isOk(c.estModal) ? c.estModal : 0), 0);
    const lostCertain = sumOk(cases.filter((c) => c.state === 'hilang'));
    const unknownRisk = sumOk(cases.filter((c) => c.state === 'belum'));
    const catSummary = {};
    for (const c of cases) {
      const k = `${c.platform}|${c.cat}`;
      catSummary[k] = catSummary[k] || { platform: c.platform, cat: c.cat, label: CAT_LABEL[c.cat], count: 0, amount: 0 };
      catSummary[k].count += 1; catSummary[k].amount += c.amount;
    }

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

    const result = {
      mode, ready, coverage, knownSales, has, available, shopee: S, tiktok: T, lostCertain, unknownRisk, totalMargin,
      totalSales, totalFees: pick((p) => p.feeTotal), totalReceived: pick((p) => p.received),
      totalModal: pick((p) => p.modal), totalPacking: pick((p) => p.packing), knownReceived: pick((p) => p.knownReceived), knownPacking: pick((p) => p.knownPacking), adjustments: pick((p) => p.adj),
      orders, first, last, days, monthsSpan, feeModel: feeModels,
      perMonth: ready && monthsSpan > 0 ? totalMargin / monthsSpan : NaN, perOrder: ready && orders ? totalMargin / orders : NaN,
      fixedMonthly, opex, netProfit: ready ? totalMargin - opex : NaN,
      months: monthList, allMonths: [...allMonths].sort(), buckets: buckets.filter((b) => b.orders > 0),
      products, cases, catSummary: Object.values(catSummary), dupes: m.dupes, target,
      qtyAssumed, linesWithoutCost, ttNoDetail, ttNoDetailSales, hasOrderExport: { shopee: m.shopeeLines.size > 0, tiktok: m.tiktokLines.size > 0 },
      productsWithoutCost: products.filter((p) => !p.modalKnown).length,
    };
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
    CAT_LABEL, TEMPLATE_HEADER };
})();
if (typeof module !== 'undefined') module.exports = Engine;
