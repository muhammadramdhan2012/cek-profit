/*
 * Server tiruan Midtrans Core API untuk uji lokal QRIS (BUKAN Midtrans sungguhan; perilaku disederhanakan dari
 * dokumentasi publik). Endpoint: POST /v2/charge, GET /v2/:id/status, POST /v2/:id/cancel, POST /v2/:id/refund.
 * Simulator: bayar(), kedaluwarsa(), notifikasi() (dengan signature_key yang benar atau salah), gagalkanBerikutnya().
 */
const http = require('http');
const crypto = require('crypto');

function createMidtransMock({ serverKey = 'SB-Mid-server-UJI-LOKAL' } = {}) {
  const trx = new Map();   // order_id → transaksi
  const log = [];
  let gagal = null;        // { path: RegExp, mode: 'putus'|'500' } untuk satu permintaan berikutnya
  let urut = 0;
  const kirim = (res, http, body) => { res.writeHead(http, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const status = (t) => ({
    status_code: t.status === 'pending' ? '201' : t.status === 'expire' ? '407' : '200',
    status_message: 'Success', transaction_id: t.transaction_id, order_id: t.order_id, gross_amount: t.gross_amount,
    currency: 'IDR', payment_type: 'qris', transaction_status: t.status, fraud_status: 'accept', acquirer: 'gopay',
    transaction_time: t.waktu, ...(t.refunds.length ? { refund_amount: t.refunds.reduce((a, r) => a + Number(r.refund_amount), 0).toFixed(2), refunds: t.refunds } : {}),
  });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      log.push(`${req.method} ${u.pathname}`);
      if (gagal && gagal.path.test(u.pathname)) { const g = gagal; gagal = null; if (g.mode === 'putus') return req.socket.destroy(); return kirim(res, 500, { status_code: '500' }); }
      const harap = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;
      if (req.headers.authorization !== harap) return kirim(res, 401, { status_code: '401', status_message: 'Unknown Merchant server_key/id' });
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return kirim(res, 400, { status_code: '400' }); }
      if (req.method === 'POST' && u.pathname === '/v2/charge') {
        const o = body.transaction_details && body.transaction_details.order_id;
        if (!o || body.payment_type !== 'qris') return kirim(res, 400, { status_code: '400', status_message: 'Bad request' });
        if (trx.has(o)) return kirim(res, 406, { status_code: '406', status_message: 'The request could not be completed due to a conflict with the current state of the target resource, please try again' });
        const t = { order_id: o, transaction_id: `mock-${++urut}-${crypto.randomUUID()}`, gross_amount: `${Number(body.transaction_details.gross_amount).toFixed(2)}`,
          status: 'pending', refunds: [], waktu: new Date().toISOString(), body };
        trx.set(o, t);
        const base = `http://127.0.0.1:${server.address().port}`;
        return kirim(res, 200, { ...status(t), status_code: '201', status_message: 'QRIS transaction is created',
          actions: [{ name: 'generate-qr-code', method: 'GET', url: `${base}/v2/qris/${t.transaction_id}/qr-code` }], qr_string: `00020101021226MOCK${t.transaction_id}` });
      }
      const m = /^\/v2\/([^/]+)\/(status|cancel|refund)$/.exec(u.pathname);
      if (!m) return kirim(res, 404, { status_code: '404' });
      const id = decodeURIComponent(m[1]);
      const t = trx.get(id) || [...trx.values()].find((x) => x.transaction_id === id);
      if (!t) return kirim(res, 404, { status_code: '404', status_message: "Transaction doesn't exist." });
      if (m[2] === 'status' && req.method === 'GET') return kirim(res, 200, status(t));
      if (m[2] === 'cancel' && req.method === 'POST') {
        if (t.status !== 'pending') return kirim(res, 412, { status_code: '412', status_message: 'Merchant cannot modify the status of the transaction' });
        t.status = 'cancel';
        return kirim(res, 200, status(t));
      }
      if (m[2] === 'refund' && req.method === 'POST') {
        const ada = t.refunds.find((r) => r.refund_key === body.refund_key);
        if (ada) return kirim(res, 200, { ...status(t), status_code: '200', refund_key: ada.refund_key, refund_amount: ada.refund_amount });   // refund_key sama = tidak ada refund baru
        if (!['settlement', 'partial_refund'].includes(t.status)) return kirim(res, 412, { status_code: '412', status_message: 'Transaction status cannot be updated' });
        const sisa = Number(t.gross_amount) - t.refunds.reduce((a, r) => a + Number(r.refund_amount), 0);
        const amt = body.amount == null ? sisa : Number(body.amount);
        if (!(amt > 0 && amt <= sisa)) return kirim(res, 412, { status_code: '412', status_message: 'Refund amount exceeds' });
        t.refunds.push({ refund_chargeback_id: t.refunds.length + 1, refund_amount: amt.toFixed(2), created_at: new Date().toISOString(), reason: body.reason || '', refund_key: body.refund_key || `auto-${t.refunds.length + 1}` });
        t.status = amt === sisa ? 'refund' : 'partial_refund';
        return kirim(res, 200, { ...status(t), status_code: '200' });
      }
      return kirim(res, 405, { status_code: '405' });
    });
  });
  const sha512 = (s) => crypto.createHash('sha512').update(s).digest('hex');
  return {
    server, trx, log, serverKey,
    /** Pembeli membayar: transaksi → settlement (nominal bisa dipalsukan untuk uji tidak cocok). */
    bayar(orderId, { gross } = {}) { const t = trx.get(orderId); if (!t) throw new Error(`tidak ada ${orderId}`); t.status = 'settlement'; if (gross) t.gross_amount = Number(gross).toFixed(2); return t; },
    kedaluwarsa(orderId) { const t = trx.get(orderId); t.status = 'expire'; return t; },
    /** Isi notifikasi HTTP seperti yang dikirim Midtrans. kunci lain = signature salah. */
    notifikasi(orderId, { kunci = serverKey, ubah = {} } = {}) {
      const t = trx.get(orderId); const s = { ...status(t), ...ubah };
      return { ...s, signature_key: sha512(`${s.order_id}${s.status_code}${s.gross_amount}${kunci}`) };
    },
    gagalkanBerikutnya(path, mode = 'putus') { gagal = { path, mode }; },
  };
}
module.exports = createMidtransMock;
