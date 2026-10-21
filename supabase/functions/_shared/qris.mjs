/*
 * Logika Edge Function pembayaran QRIS dinamis (Midtrans Core API). Dipakai oleh supabase/functions/qris-{buat,cek,notifikasi,refund}/index.ts
 * (Deno) dan diuji di Node (tests/qris.test.js, tests/e2e/qris-e2e.mjs). Hanya memakai API web standar:
 * fetch, Request/Response, crypto.subtle, btoa — tanpa dependensi.
 *
 * Batas kepercayaan:
 *  - Browser tidak dipercaya: harga, kode pesanan, dan status selalu dari database/Midtrans.
 *  - Notifikasi Midtrans tidak dipercaya: signature_key diperiksa, lalu status DIAMBIL ULANG lewat Get Status;
 *    hanya hasil Get Status yang diteruskan ke database (gateway_terapkan_status).
 *  - Tanpa service_role: database dipanggil dengan anon key + JWT pembeli (fungsi pembeli/admin) atau anon key +
 *    GATEWAY_SECRET (fungsi gateway_*). Server key Midtrans dan GATEWAY_SECRET hanya ada di secret Edge Function.
 */

const PRODUK = { id: 'cek-untung-pro', name: 'Cek Untung Pro' };
const BASE = { sandbox: 'https://api.sandbox.midtrans.com', production: 'https://api.midtrans.com' };
const BATAS_WAKTU_MS = 10000;
const CEK_BERKALA_MS = 30000;   // tanpa ?paksa, Midtrans hanya ditanya bila status terakhir lebih tua dari ini

export class GalatQris extends Error {
  constructor(status, pesan, detail) { super(pesan); this.status = status; this.detail = detail; }
}

/* ------------------------------------------------------------------ konfigurasi */
/**
 * Konfigurasi dari environment. MIDTRANS_ENV: 'sandbox' | 'production' | 'mock' (mock hanya untuk uji lokal; satu-satunya
 * mode yang boleh mengganti MIDTRANS_API_BASE). Kunci yang tidak cocok dengan lingkungannya ditolak, sehingga kunci
 * produksi tidak bisa terpakai di staging dan sebaliknya.
 */
export function bacaKonfigurasi(env = {}) {
  const lingkungan = String(env.MIDTRANS_ENV || '').toLowerCase();
  const kunci = String(env.MIDTRANS_SERVER_KEY || '');
  const rahasia = String(env.GATEWAY_SECRET || '');
  const kurang = [];
  if (!env.SUPABASE_URL) kurang.push('SUPABASE_URL');
  if (!env.SUPABASE_ANON_KEY) kurang.push('SUPABASE_ANON_KEY');
  if (!kunci) kurang.push('MIDTRANS_SERVER_KEY');
  if (rahasia.length < 32) kurang.push('GATEWAY_SECRET (minimal 32 karakter)');
  if (!['sandbox', 'production', 'mock'].includes(lingkungan)) kurang.push('MIDTRANS_ENV (sandbox/production)');
  if (kurang.length) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', `Belum diisi: ${kurang.join(', ')}`);
  if (lingkungan === 'sandbox' && !kunci.startsWith('SB-Mid-server-')) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', 'MIDTRANS_ENV=sandbox tetapi server key bukan kunci sandbox');
  if (lingkungan === 'production' && !kunci.startsWith('Mid-server-')) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', 'MIDTRANS_ENV=production tetapi server key bukan kunci produksi');
  const apiBase = lingkungan === 'mock' ? String(env.MIDTRANS_API_BASE || '') : BASE[lingkungan];
  if (!/^https?:\/\//.test(apiBase)) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', 'MIDTRANS_API_BASE tidak valid');
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { lingkungan, kunci, rahasia, apiBase: apiBase.replace(/\/+$/, ''), supabaseUrl: String(env.SUPABASE_URL).replace(/\/+$/, ''), anonKey: String(env.SUPABASE_ANON_KEY), origins };
}

/* ------------------------------------------------------------------ util */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha512(teks) { return hex(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(teks))); }
/** Perbandingan waktu-konstan untuk string hex. */
export function samaAman(a, b) {
  a = String(a || ''); b = String(b || '');
  let beda = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) beda |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return beda === 0;
}
/** signature_key Midtrans = SHA512(order_id + status_code + gross_amount + server key). */
export async function signatureSah(notif, kunci) {
  if (!notif || typeof notif !== 'object') return false;
  const { order_id: o, status_code: s, gross_amount: g, signature_key: sig } = notif;
  if (![o, s, g, sig].every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200)) return false;
  return samaAman(await sha512(`${o}${s}${g}${kunci}`), String(sig).toLowerCase());
}
/** Hanya field yang dibutuhkan database (minimisasi data). */
export function ringkasStatus(st) {
  const refunds = Array.isArray(st && st.refunds) ? st.refunds.slice(0, 20).map((f) => ({
    refund_key: f && f.refund_key ? String(f.refund_key).slice(0, 100) : null,
    refund_chargeback_id: f && f.refund_chargeback_id != null ? String(f.refund_chargeback_id).slice(0, 100) : null,
    refund_amount: f && f.refund_amount != null ? String(f.refund_amount) : null,
  })) : [];
  const pilih = (k) => (st && st[k] != null ? String(st[k]).slice(0, 100) : null);
  return { order_id: pilih('order_id'), transaction_id: pilih('transaction_id'), transaction_status: pilih('transaction_status'),
    status_code: pilih('status_code'), gross_amount: pilih('gross_amount'), currency: pilih('currency'), fraud_status: pilih('fraud_status'), refunds };
}

/* ------------------------------------------------------------------ klien Midtrans */
export function midtrans(cfg, fetcher) {
  const auth = `Basic ${btoa(`${cfg.kunci}:`)}`;
  async function panggil(method, path, body) {
    let res;
    try {
      res = await fetcher(cfg.apiBase + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(BATAS_WAKTU_MS) });
    } catch (e) { throw new GalatQris(502, 'Penyedia pembayaran tidak dapat dihubungi. Coba lagi sebentar.', 'jaringan'); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status >= 500 || !data) throw new GalatQris(502, 'Penyedia pembayaran sedang bermasalah. Coba lagi sebentar.', `HTTP ${res.status}`);
    return { http: res.status, data };
  }
  const id = (o) => encodeURIComponent(o);
  return {
    charge: (orderId, amount, menit) => panggil('POST', '/v2/charge', {
      payment_type: 'qris',
      transaction_details: { order_id: orderId, gross_amount: amount },
      item_details: [{ ...PRODUK, price: amount, quantity: 1 }],
      qris: { acquirer: 'gopay' },
      custom_expiry: { expiry_duration: menit, unit: 'minute' },
    }),
    status: (orderId) => panggil('GET', `/v2/${id(orderId)}/status`),
    cancel: (orderId) => panggil('POST', `/v2/${id(orderId)}/cancel`),
    refund: (orderId, refundKey, amount, reason) => panggil('POST', `/v2/${id(orderId)}/refund`, { refund_key: refundKey, amount, reason }),
  };
}
const tidakAda = (r) => r.http === 404 || String(r.data && r.data.status_code) === '404';

/* ------------------------------------------------------------------ klien database (PostgREST RPC) */
export function database(cfg, fetcher) {
  return async function rpc(nama, args, jwt) {
    let res;
    try {
      res = await fetcher(`${cfg.supabaseUrl}/rest/v1/rpc/${nama}`, { method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${jwt || cfg.anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(BATAS_WAKTU_MS) });
    } catch (e) { throw new GalatQris(503, 'Database tidak dapat dihubungi. Coba lagi sebentar.', 'jaringan'); }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const pesan = (data && data.message) || `Permintaan gagal (${res.status})`;
      // Pesan dari fungsi database sudah berbahasa Indonesia; selain itu disamarkan.
      const status = res.status === 401 || res.status === 403 ? 403 : res.status >= 500 ? 500 : 400;
      throw new GalatQris(status, /^[A-Z][a-z].{3,200}$/.test(pesan) && !/permission|violates|syntax|relation|column/i.test(pesan) ? pesan : 'Permintaan tidak dapat diproses.', pesan);
    }
    return data;
  };
}

/* ------------------------------------------------------------------ HTTP */
function cors(req, cfg) {
  const o = req.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (o && cfg && cfg.origins.includes(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  return h;
}
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
const jwtDari = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || ''); return m ? m[1] : ''; };
async function bodyJson(req) {
  const teks = await req.text();
  if (teks.length > 20000) throw new GalatQris(413, 'Permintaan terlalu besar.');
  try { return JSON.parse(teks || '{}'); } catch (e) { throw new GalatQris(400, 'Format permintaan tidak valid.'); }
}
const idPesanan = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new GalatQris(400, 'Pesanan tidak valid.'); return n; };

/** Pembungkus: konfigurasi, CORS, metode, dan galat → JSON. Detail teknis hanya ke log server, tanpa rahasia/token. */
function bungkus(nama, fn, { butuhLogin }) {
  return async (req, deps = {}) => {
    let cfg = null;
    try {
      cfg = bacaKonfigurasi(deps.env || {});
      const h = cors(req, cfg);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
      if (req.method !== 'POST') return json(405, { error: 'Metode tidak diizinkan.' }, h);
      const jwt = jwtDari(req);
      if (butuhLogin && (!jwt || jwt === cfg.anonKey)) return json(401, { error: 'Silakan masuk terlebih dahulu.' }, h);
      const f = deps.fetch || fetch;
      const ctx = { cfg, jwt, mt: midtrans(cfg, f), rpc: database(cfg, f), now: deps.now || (() => Date.now()) };
      return json(200, await fn(req, ctx), h);
    } catch (e) {
      const status = e instanceof GalatQris ? e.status : 500;
      (deps.log || console.error)(`[${nama}] ${status} ${e instanceof GalatQris ? e.detail || e.message : e && e.message}`);
      return json(status, { error: e instanceof GalatQris ? e.message : 'Terjadi kesalahan. Coba lagi sebentar.' }, cfg ? cors(req, cfg) : {});
    }
  };
}

/* ------------------------------------------------------------------ alur */
/**
 * Selaraskan satu percobaan dengan Midtrans: Get Status → (opsional) batalkan QR yang masih pending tetapi sudah lewat
 * waktu → teruskan hasil Get Status ke database. Percobaan yang tidak tercatat di Midtrans ditandai gagal.
 */
async function sinkron(ctx, g, { batalkanBilaPending = false } = {}) {
  let st = await ctx.mt.status(g.gateway_order_id);
  if (tidakAda(st)) {
    if (g.status === 'dibuat') await ctx.rpc('gateway_simpan_qr', { p_rahasia: ctx.cfg.rahasia, p_percobaan: g.id, p_hasil: { ok: false, pesan: 'Tidak tercatat di penyedia pembayaran' } });
    return 'tidak_ada';
  }
  if (batalkanBilaPending && String(st.data.transaction_status) === 'pending') {
    await ctx.mt.cancel(g.gateway_order_id);
    st = await ctx.mt.status(g.gateway_order_id);
    if (tidakAda(st)) return 'tidak_ada';
  }
  if (!st.data.transaction_status) throw new GalatQris(502, 'Status pembayaran belum dapat dipastikan. Coba lagi sebentar.', `status tanpa transaction_status (${st.http})`);
  return ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: ringkasStatus(st.data) });
}
/** URL gambar QR hanya diterima dari host API Midtrans (https); server tidak pernah mengambil URL ini (bukan SSRF),
 *  browser hanya memuatnya sebagai <img>. Mode mock (uji lokal) boleh memakai host tiruan. */
export function urlQrSah(url, cfg) {
  let u; try { u = new URL(String(url || '')); } catch (e) { return false; }
  if (String(url).length > 500 || u.username || u.password) return false;
  if (cfg.lingkungan === 'mock') return /^https?:$/.test(u.protocol);
  return u.protocol === 'https:' && u.hostname === new URL(cfg.apiBase).hostname && (u.port === '' || u.port === '443');
}
const lewat = (g, ctx) => new Date(g.berlaku_sampai).getTime() <= ctx.now();
const publik = (g) => g && { id: g.id, status: g.status, qr_url: g.qr_url, qr_string: g.qr_string, berlaku_sampai: g.berlaku_sampai, amount: g.amount, gateway_order_id: g.gateway_order_id, pesan: g.pesan };

/** POST {pesanan} — pembeli (login). Mengembalikan QR yang berlaku, atau membuat QR baru bila yang lama sudah selesai. */
export const handleBuat = bungkus('qris-buat', async (req, ctx) => {
  const { pesanan } = await bodyJson(req);
  const p_order = idPesanan(pesanan);
  let m = await ctx.rpc('gateway_mulai_percobaan', { p_order }, ctx.jwt);
  if (m.aksi === 'cek') {   // QR lama lewat waktu: pastikan statusnya di Midtrans (mungkin sudah dibayar) sebelum membuat yang baru
    await sinkron(ctx, m.percobaan, { batalkanBilaPending: true });
    m = await ctx.rpc('gateway_mulai_percobaan', { p_order }, ctx.jwt);
    if (m.aksi === 'cek') throw new GalatQris(409, 'Pembayaran sebelumnya masih diproses. Coba lagi beberapa saat lagi.');
  }
  if (m.aksi === 'selesai') return { status: 'selesai' };
  const g = m.percobaan;
  if (m.aksi === 'pakai') {
    if (g.status === 'dibuat') throw new GalatQris(409, 'QR sedang dibuat. Coba lagi beberapa detik lagi.');
    return { status: 'menunggu', percobaan: publik(g) };
  }
  // aksi 'baru': buat charge. Nominal & masa berlaku dari database, bukan dari browser.
  const menit = Math.max(1, Math.round((new Date(g.berlaku_sampai).getTime() - ctx.now()) / 60000)) || m.qr_menit;
  let hasil;
  try {
    const r = await ctx.mt.charge(g.gateway_order_id, g.amount, menit);
    const d = r.data;
    const qr = Array.isArray(d.actions) && d.actions.find((a) => a && a.name === 'generate-qr-code');
    const ok = String(d.status_code) === '201' && d.transaction_status === 'pending' && d.transaction_id && Number(d.gross_amount) === g.amount;
    hasil = ok ? { ok: true, gateway_txn_id: String(d.transaction_id), qr_url: urlQrSah(qr && qr.url, ctx.cfg) ? qr.url : '', qr_string: typeof d.qr_string === 'string' ? d.qr_string.slice(0, 1000) : '' }
      : { ok: false, pesan: `Ditolak penyedia (${String(d.status_code || r.http).slice(0, 10)})` };
  } catch (e) {
    // Hasil tidak pasti (jaringan/batas waktu): tandai gagal. Bila ternyata tercatat lalu dibayar, notifikasi tetap
    // diterapkan ke percobaan ini (status gagal masih boleh menjadi lunas).
    hasil = { ok: false, pesan: 'Gagal menghubungi penyedia pembayaran' };
  }
  const simpan = await ctx.rpc('gateway_simpan_qr', { p_rahasia: ctx.cfg.rahasia, p_percobaan: g.id, p_hasil: hasil });
  if (simpan.status !== 'menunggu') throw new GalatQris(502, 'QR belum berhasil dibuat. Silakan coba lagi.', simpan.pesan);
  return { status: 'menunggu', percobaan: publik(simpan) };
}, { butuhLogin: true });

/** POST {pesanan, paksa} — pembeli (login). Status dari database; Midtrans ditanya bila paksa, lewat waktu, atau berkala. */
export const handleCek = bungkus('qris-cek', async (req, ctx) => {
  const { pesanan, paksa } = await bodyJson(req);
  const p_order = idPesanan(pesanan);
  let info = await ctx.rpc('gateway_percobaan_saya', { p_order }, ctx.jwt);
  if (!info) throw new GalatQris(404, 'Pesanan tidak ditemukan.');
  const g = info.percobaan;
  if (g && ['dibuat', 'menunggu'].includes(g.status)) {
    const tua = !g.dicek_pada || ctx.now() - new Date(g.dicek_pada).getTime() > CEK_BERKALA_MS;
    if (paksa === true || lewat(g, ctx) || tua) {
      await sinkron(ctx, g, { batalkanBilaPending: lewat(g, ctx) });
      info = await ctx.rpc('gateway_percobaan_saya', { p_order }, ctx.jwt);
    }
  }
  return { pesanan: info.pesanan, pro: info.pro === true, percobaan: publik(info.percobaan) };
}, { butuhLogin: true });

/** POST notifikasi Midtrans (tanpa login). Signature → Get Status → database. Non-200 membuat Midtrans mengirim ulang. */
export const handleNotifikasi = bungkus('qris-notifikasi', async (req, ctx) => {
  const notif = await bodyJson(req);
  if (!(await signatureSah(notif, ctx.cfg.kunci))) throw new GalatQris(401, 'Signature tidak valid.', `signature ditolak untuk ${String(notif && notif.order_id).slice(0, 60)}`);
  const st = await ctx.mt.status(notif.order_id);
  if (tidakAda(st)) return { ok: true, hasil: 'tidak_ada_di_midtrans' };
  if (!st.data.transaction_status) throw new GalatQris(502, 'Status belum dapat dipastikan.', `HTTP ${st.http}`);
  const hasil = await ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: ringkasStatus(st.data) });
  return { ok: true, hasil };
}, { butuhLogin: false });

/** POST {pembayaran, nominal, alasan} — admin (login + is_admin di database). Refund lewat Midtrans, lalu dicatat dari Get Status. */
export const handleRefund = bungkus('qris-refund', async (req, ctx) => {
  const { pembayaran, nominal, alasan } = await bodyJson(req);
  const prep = await ctx.rpc('admin_refund_gateway_siapkan', { p_payment: idPesanan(pembayaran), p_nominal: Number(nominal), p_alasan: String(alasan || '') }, ctx.jwt);
  const r = await ctx.mt.refund(prep.gateway_order_id, prep.refund_key, prep.nominal, prep.alasan);
  const kode = String(r.data.status_code || r.http);
  if (!['200', '201'].includes(kode)) throw new GalatQris(502, 'Refund ditolak penyedia pembayaran. Periksa di dasbor Midtrans.', `refund ${kode}: ${String(r.data.status_message || '').slice(0, 120)}`);
  const st = await ctx.mt.status(prep.gateway_order_id);
  if (tidakAda(st)) throw new GalatQris(502, 'Refund terkirim, tetapi status belum dapat dipastikan. Cek lagi nanti.');
  const hasil = await ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: ringkasStatus(st.data) });
  return { ok: true, hasil, refund_key: prep.refund_key };
}, { butuhLogin: true });
