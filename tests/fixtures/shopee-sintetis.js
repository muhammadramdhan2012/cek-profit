/* Fixture SINTETIS untuk uji pencocokan Shopee (H1/H3).
 *
 * Semua data di sini buatan: nama produk, nomor pesanan, dan harga fiktif. Tidak ada salinan atau
 * transformasi data pembeli maupun data toko asli. Yang ditiru hanya STRUKTUR kolom laporan Shopee
 * yang sudah divalidasi (nama kolom), agar parser diuji dengan format yang realistis.
 *
 * Dua pembuat workbook:
 *  - penghasilan(orders)          → mirip "Laporan Penghasilan" (sheet Summary + Penghasilan)
 *  - exportPesanan(lines, format) → mirip "Pesanan Saya → Export" (sheet orders)
 */

/**
 * @param {{id:string, items:{name:string, productId?:string, harga:number, refund?:number}[], orderDate?:string}[]} orders
 */
function penghasilan(orders) {
  const header = ['No.', 'Lihat berdasarkan', 'No. Pesanan', 'ID Produk', 'Nama Produk', 'Waktu Pesanan Dibuat',
    'Tanggal Dana Dilepaskan', 'Total Penghasilan', 'Harga Produk', 'Jumlah Pengembalian Dana ke Pembeli'];
  const rows = [['Laporan Penghasilan (sintetis)'], [], header];
  let no = 1, total = 0;
  for (const o of orders) {
    const harga = o.items.reduce((a, it) => a + it.harga, 0);
    const refund = o.items.reduce((a, it) => a + (it.refund || 0), 0);
    const date = o.orderDate || '2026-01-10 10:00';
    rows.push([no++, 'Order', o.id, '', '', date, '2026-01-15', harga + refund, harga, refund]);
    total += harga + refund;
    for (const it of o.items) rows.push([no++, 'Sku', o.id, it.productId || '', it.name, date, '2026-01-15', it.harga + (it.refund || 0), it.harga, it.refund || 0]);
  }
  const summary = [['Dari', '2026-01-01'], ['ke', '2026-01-31'], ['Total yang Dilepas', total]];
  return { name: 'penghasilan-sintetis.xlsx', sheets: { Summary: summary, Penghasilan: rows } };
}

/**
 * @param {{order:string, name:string, variant?:string, qty:number, price:number, skuVariant?:string, skuParent?:string,
 *          returned?:number, returnStatus?:string, subtotal?:number|string, afterDisc?:number|string,
 *          status?:string}[]} lines   status default "Selesai"; afterDisc default = price
 * @param {'baru'|'lama'|'harga_awal'} format  'lama' = tanpa kolom Subtotal/Returned/Status Pembatalan;
 *                                             'harga_awal' = hanya ada kolom Harga Awal (tanpa harga setelah diskon)
 */
function exportPesanan(lines, format = 'baru') {
  const cols = format === 'baru'
    ? ['No. Pesanan', 'Status Pesanan', 'Status Pembatalan/ Pengembalian', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU',
      'Nama Variasi', 'Harga Awal', 'Harga Setelah Diskon', 'Jumlah', 'Returned quantity', 'Subtotal Pesanan']
    : format === 'lama'
      ? ['No. Pesanan', 'Status Pesanan', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU', 'Nama Variasi', 'Harga Awal', 'Harga Setelah Diskon', 'Jumlah']
      : ['No. Pesanan', 'Status Pesanan', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU', 'Nama Variasi', 'Harga Awal', 'Jumlah'];
  const val = (l, c) => ({
    'No. Pesanan': l.order, 'Status Pesanan': l.status ?? 'Selesai', 'Status Pembatalan/ Pengembalian': l.returnStatus || '',
    'SKU Induk': l.skuParent || '', 'Nama Produk': l.name, 'Nomor Referensi SKU': l.skuVariant || '', 'Nama Variasi': l.variant || '',
    'Harga Awal': l.price, 'Harga Setelah Diskon': l.afterDisc ?? l.price, Jumlah: l.qty, 'Returned quantity': l.returned || 0,
    'Subtotal Pesanan': l.subtotal ?? l.qty * l.price,
  }[c]);
  return { name: 'export-sintetis.xlsx', sheets: { orders: [cols, ...lines.map((l) => cols.map((c) => val(l, c)))] } };
}

module.exports = { penghasilan, exportPesanan };
