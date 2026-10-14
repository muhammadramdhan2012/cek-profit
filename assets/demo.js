/* Data CONTOH (fiktif) untuk mencoba semua fitur tanpa file sendiri.
 * Formatnya meniru laporan asli: penghasilan Shopee & TikTok, export pesanan, dan retur.
 * Deterministik (seed tetap) agar contoh laporan PDF selalu sama.
 */
const CekDemo = (() => {
  const PRODUCTS = [
    // [nama, harga jual, modal per unit, bobot laku]
    ['Kaos Polos Cotton Combed 30s', 59000, 31000, 9],
    ['Tumbler Stainless 500ml', 89000, 47000, 6],
    ['Case HP Silikon Doff', 25000, 13500, 8],
    ['Tas Selempang Kanvas', 129000, 68000, 4],
    ['Kaos Kaki Ankle isi 3', 15000, 11000, 7],
    ['Botol Minum Anak 350ml', 45000, 24000, 5],
    ['Hijab Voal Motif', 69000, 33000, 6],
    ['Dompet Kulit Sintetis', 99000, 52000, 3],
    ['Lampu Tidur LED Sensor', 79000, 49000, 3],
    ['Buku Catatan A5 Dotted', 35000, 16000, 4],
  ];
  const VARIANTS = { 0: ['Hitam, M', 'Putih, L', 'Navy, XL'], 6: ['Dusty Pink', 'Sage', 'Mocca'] };
  const SKU = (k) => `TC-${String(k + 1).padStart(3, '0')}`;
  const PID = (k) => `90000${k + 11}`;
  const TTSKU = (k) => `17290000000000${String(k + 101).padStart(5, '0')}`;

  function make() {
    let seed = 20260101;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const weightSum = PRODUCTS.reduce((a, p) => a + p[3], 0);
    const pickProduct = () => { let x = rnd() * weightSum; for (let k = 0; k < PRODUCTS.length; k++) { x -= PRODUCTS[k][3]; if (x <= 0) return k; } return 0; };
    const day = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;

    /* ---- Shopee: penghasilan + export pesanan ---- */
    const H = ['No.', 'Lihat berdasarkan', 'No. Pesanan', 'ID Produk', 'Nama Produk', 'Waktu Pesanan Dibuat', 'Tanggal Dana Dilepaskan',
      'Total Penghasilan', 'Harga Produk', 'Jumlah Pengembalian Dana ke Pembeli', 'Ongkos Kirim yang Dibayarkan ke Jasa Kirim', 'Gratis Ongkir dari Shopee',
      'Voucher disponsor oleh Penjual', 'Biaya Administrasi', 'Biaya Proses Pesanan', 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)'];
    const rows = [[], [], H];
    const OH = ['No. Pesanan', 'Status Pesanan', 'Waktu Pesanan Dibuat', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU', 'Nama Variasi', 'Harga Awal', 'Harga Setelah Diskon', 'Jumlah'];
    const orderExport = [OH];
    let total = 0;
    const shopeeIds = [];
    for (let i = 0; i < 420; i++) {
      const mth = 1 + Math.floor(rnd() * 9), d = 1 + Math.floor(rnd() * 27);
      const n = rnd() < 0.75 ? 1 : 2;
      const lines = [];
      for (let j = 0; j < n; j++) {
        const k = pickProduct();
        if (lines.some((l) => l.k === k)) continue;
        const qty = rnd() < 0.8 ? 1 : 2 + Math.floor(rnd() * 2);
        const variant = VARIANTS[k] ? VARIANTS[k][Math.floor(rnd() * VARIANTS[k].length)] : '';
        lines.push({ k, qty, variant, price: PRODUCTS[k][1] * qty });
      }
      const price = lines.reduce((a, l) => a + l.price, 0);
      const adminRate = mth >= 6 ? 0.095 : 0.08;   // kenaikan biaya admin di pertengahan tahun
      const admin = -Math.round(price * adminRate), proses = -1250, xtra = -Math.min(Math.round(price * 0.045), 10000);
      const voucher = rnd() < 0.15 ? -5000 : 0;
      const refunded = rnd() < 0.025;
      const refund = refunded ? -price : 0;
      const tot = refunded ? -1250 : price + voucher + admin + proses + xtra;
      total += tot;
      const id = `26${String(mth).padStart(2, '0')}${String(d).padStart(2, '0')}DEMO${String(i).padStart(4, '0')}`;
      shopeeIds.push({ id, lines, mth, d });
      rows.push([i, 'Order', id, '-', '-', day(mth, d), day(mth, d + 3), tot, price, refund, -11000, 11000, voucher,
        refunded ? 0 : admin, proses, refunded ? 0 : xtra]);
      for (const l of lines) {
        const share = l.price / price;
        rows.push([i, 'Sku', id, PID(l.k), PRODUCTS[l.k][0], day(mth, d), day(mth, d + 3), Math.round(tot * share), l.price, refunded ? -l.price : 0, 0, 0, 0, 0, 0, 0]);
        orderExport.push([id, refunded ? 'Batal' : 'Selesai', day(mth, d) + ' 10:15', SKU(l.k), PRODUCTS[l.k][0], SKU(l.k) + (l.variant ? `-${l.variant.split(',')[0].toUpperCase()}` : ''), l.variant,
          PRODUCTS[l.k][1], PRODUCTS[l.k][1], l.qty]);
      }
    }
    const shopee = { name: 'contoh-shopee-penghasilan.xlsx', sheets: { Summary: [['3. Total yang Dilepas', '', '', total], ['Dari', '2026-01-01'], ['ke', '2026-09-30']], Penghasilan: rows } };
    const shopeeOrders = { name: 'contoh-shopee-pesanan.xlsx', sheets: { orders: orderExport } };

    /* ---- TikTok: penghasilan + export pesanan ---- */
    const TH = ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran', 'Total Pendapatan',
      'Subtotal sebelum diskon', 'Total pengembalian dana sebelum diskon', 'Total Biaya', 'Biaya komisi platform', 'Komisi dinamis', 'Biaya pemrosesan pesanan', 'Ongkir',
      'Komisi Afiliasi', 'Detail produk terjual', 'Sumber pesanan'];
    const tt = [TH];
    const TOH = ['Order ID', 'Order Status', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity', 'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Created Time'];
    const ttOrders = [TOH, ['Platform unique order ID.', 'Current order status.', 'Platform SKU ID', 'Seller SKU', 'Product name', 'SKU variation', 'SKU sold quantity', 'Unit price', 'Subtotal', 'Order creation time']];
    let ttSum = 0;
    const ttIds = [];
    for (let i = 0; i < 520; i++) {
      const mth = 1 + Math.floor(rnd() * 9), d = 1 + Math.floor(rnd() * 27);
      const k = pickProduct();
      const qty = rnd() < 0.85 ? 1 : 2;
      const disc = mth >= 7 ? 0.05 : 0.1;
      const pre = PRODUCTS[k][1] * qty, paid = Math.round(pre * (1 - disc));
      const plat = -Math.round(paid * 0.08), din = -Math.round(paid * (mth >= 5 ? 0.07 : 0.045)), proc = -1250, ong = -Math.round(rnd() * 1200);
      const aff = rnd() < 0.2 ? -Math.round(paid * 0.05) : 0;
      const biaya = plat + din + proc + ong + aff;
      const id = `5800${String(mth).padStart(2, '0')}${String(i).padStart(10, '0')}`;
      ttIds.push([id, k, paid, day(mth, d), qty]);
      ttSum += paid + biaya;
      const detail = rnd() < 0.5 ? `${TTSKU(k)} * ${qty};` : '/';
      tt.push([id, 'Pesanan', day(mth, d).replace(/-/g, '/'), day(mth, d + 4).replace(/-/g, '/'), paid + biaya, paid, pre, 0, biaya, plat, din, proc, ong, aff, detail,
        rnd() < 0.55 ? 'Tokopedia' : 'TikTok Shop']);
      const variant = VARIANTS[k] ? VARIANTS[k][i % VARIANTS[k].length] : 'Default';
      ttOrders.push([id, 'Selesai', TTSKU(k), SKU(k), PRODUCTS[k][0], variant, qty, PRODUCTS[k][1], paid, day(mth, d).replace(/-/g, '/') + ' 09:30:00']);
    }
    const tiktok = { name: 'contoh-tiktok-penghasilan.xlsx', sheets: { 'Detail pesanan': tt, Laporan: [['', 'Jumlah penyelesaian pembayaran', '', '', '', ttSum]] } };
    const tiktokOrders = { name: 'contoh-tiktok-pesanan.csv', sheets: { Sheet1: ttOrders } };

    /* ---- Retur TikTok ---- */
    const RH = ['Return Order ID', 'Order ID', 'SKU ID', 'Product Name', 'SKU Name', 'Return Type', 'Time Requested', 'Return Reason', 'Return unit price', 'Return Quantity',
      'Return Logistics Tracking ID', 'Return Status', 'Refund Time', 'Buyer Note'];
    const pickTt = (i) => ttIds[i];
    const ret = [RH];
    const reasons = [['Return and refund', 'Wrong product sent', 'JX00DEMO', 'Contoh: warna tidak sesuai'],
      ['Refund only', "Product wouldn't arrive on time", '', 'Contoh: paket belum sampai'],
      ['Return and refund', 'Damaged product', 'JX01DEMO', 'Contoh: barang pecah'],
      ['Refund only', 'Missing products or accessories', '', 'Contoh: isi kurang']];
    for (let i = 0; i < 8; i++) {
      const [id, k, paid, dd, qty] = pickTt(7 + i * 37);
      const [type, reason, resi, note] = reasons[i % reasons.length];
      const [y, mo, d] = dd.split('-');
      ret.push([`R${i + 1}`, id, TTSKU(k), PRODUCTS[k][0], VARIANTS[k] ? VARIANTS[k][0] : 'Default', type, `${d}/${mo}/${y}`, reason, Math.round(paid / qty), 1,
        resi ? resi + i : '', 'Completed', `${d}/${mo}/${y}`, note]);
    }
    const tiktokReturn = { name: 'contoh-tiktok-retur.csv', sheets: { Sheet1: ret } };
    return [shopee, shopeeOrders, tiktok, tiktokOrders, tiktokReturn];
  }

  const catalog = () => PRODUCTS.map((p, k) => ({ kode: SKU(k), nama: p[0], variasi: '', cost: p[2] }))
    .concat(PRODUCTS.map((p, k) => ({ kode: PID(k), nama: '', variasi: '', cost: p[2] })))
    .concat(PRODUCTS.map((p, k) => ({ kode: TTSKU(k), nama: '', variasi: '', cost: p[2] })));

  const settings = () => ({
    sellerType: 'stok', modalMode: 'produk', catalog: catalog(), fallbackPct: null, packing: 1500, targetMargin: 15,
    fixedCosts: [{ label: 'Gaji admin paruh waktu', amount: 1000000 }, { label: 'Sewa gudang & listrik', amount: 400000 }],
    mitra: null, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }],
  });
  const profile = () => ({ store: 'Toko Contoh Sejahtera', owner: 'Disusun oleh: Cek Profit', logo: '' });

  return { make, settings, profile, PRODUCTS };
})();
if (typeof module !== 'undefined') module.exports = CekDemo;
