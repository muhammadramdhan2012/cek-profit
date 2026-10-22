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
const SNAP = { sandbox: 'https://app.sandbox.midtrans.com', production: 'https://app.midtrans.com' };
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
  const snapBase = (lingkungan === 'mock' ? String(env.MIDTRANS_SNAP_BASE || apiBase) : SNAP[lingkungan]).replace(/\/+$/, '');
  // Alamat situs untuk tautan kembali dari Snap & tautan aktivasi email (harus terdaftar di Redirect URLs Supabase).
  const situs = String(env.SITE_URL || origins[0] || '').replace(/\/+$/, '');
  return { lingkungan, kunci, rahasia, apiBase: apiBase.replace(/\/+$/, ''), snapBase, situs, supabaseUrl: String(env.SUPABASE_URL).replace(/\/+$/, ''), anonKey: String(env.SUPABASE_ANON_KEY), origins };
}

/* ------------------------------------------------------------------ util */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(teks) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(teks))); }
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
  async function panggil(method, path, body, base = cfg.apiBase) {
    let res;
    try {
      res = await fetcher(base + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(BATAS_WAKTU_MS) });
    } catch (e) { throw new GalatQris(502, 'Penyedia pembayaran tidak dapat dihubungi. Coba lagi sebentar.', 'jaringan'); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status >= 500 || !data) throw new GalatQris(502, 'Penyedia pembayaran sedang bermasalah. Coba lagi sebentar.', `HTTP ${res.status}`);
    return { http: res.status, data };
  }
  const id = (o) => encodeURIComponent(o);
  return {
    status: (orderId) => panggil('GET', `/v2/${id(orderId)}/status`),
    cancel: (orderId) => panggil('POST', `/v2/${id(orderId)}/cancel`),
    refund: (orderId, refundKey, amount, reason) => panggil('POST', `/v2/${id(orderId)}/refund`, { refund_key: refundKey, amount, reason }),
    /** Snap (checkout tamu): hanya QRIS, tanpa data pembeli, berlaku `menit` menit, kembali ke `finish`. */
    snap: (orderId, amount, menit, finish) => panggil('POST', '/snap/v1/transactions', {
      transaction_details: { order_id: orderId, gross_amount: amount },
      item_details: [{ ...PRODUK, price: amount, quantity: 1 }],
      enabled_payments: ['other_qris'],
      expiry: { unit: 'minutes', duration: menit },
      ...(finish ? { callbacks: { finish } } : {}),
    }, cfg.snapBase),
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
      const ctx = { cfg, jwt, fetch: f, mt: midtrans(cfg, f), rpc: database(cfg, f), now: deps.now || (() => Date.now()) };
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
    // Snap yang lewat waktu tanpa transaksi di Midtrans tidak bisa dibayar lagi = kedaluwarsa (sama dengan checkout tamu).
    // Bila ternyata dibayar, notifikasi/Get Status settlement tetap diterapkan (status kedaluwarsa boleh menjadi lunas).
    else if (batalkanBilaPending && g.snap_url) return ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: { order_id: g.gateway_order_id, transaction_status: 'expire', refunds: [] } });
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
const lewat = (g, ctx) => new Date(g.berlaku_sampai).getTime() <= ctx.now();
const publik = (g) => g && { id: g.id, status: g.status, snap_url: g.status === 'menunggu' ? g.snap_url || null : null, berlaku_sampai: g.berlaku_sampai, amount: g.amount, gateway_order_id: g.gateway_order_id, pesan: g.pesan };

/** POST {pesanan} — pembeli (login). Mengembalikan halaman Snap yang berlaku, atau membuat yang baru bila yang lama sudah selesai.
 *  Satu percobaan terbuka per pesanan (database) → membuka ulang tidak membuat tagihan ganda. */
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
    if (g.status === 'dibuat') throw new GalatQris(409, 'Halaman pembayaran sedang disiapkan. Coba lagi beberapa detik lagi.');
    return { status: 'menunggu', percobaan: publik(g) };
  }
  // aksi 'baru': buat transaksi Snap (QRIS saja). Nominal & masa berlaku dari database, bukan dari browser.
  const menit = Math.max(1, Math.round((new Date(g.berlaku_sampai).getTime() - ctx.now()) / 60000)) || m.qr_menit;
  if (!ctx.cfg.situs) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', 'SITE_URL/ALLOWED_ORIGINS kosong');
  let hasil;
  try {
    const r = await ctx.mt.snap(g.gateway_order_id, g.amount, menit, `${ctx.cfg.situs}/akun?view=pro`);
    hasil = r.http === 201 && r.data.token && urlSnapSah(r.data.redirect_url, ctx.cfg)
      ? { ok: true, snap_url: r.data.redirect_url } : { ok: false, pesan: `Ditolak penyedia (${r.http})` };
  } catch (e) {
    // Hasil tidak pasti: tandai gagal. Snap tanpa pilihan QRIS tidak bisa dibayar; bila sempat dibayar, notifikasi tetap diterapkan.
    hasil = { ok: false, pesan: 'Gagal menghubungi penyedia pembayaran' };
  }
  const simpan = await ctx.rpc('gateway_simpan_qr', { p_rahasia: ctx.cfg.rahasia, p_percobaan: g.id, p_hasil: hasil });
  if (simpan.status !== 'menunggu') throw new GalatQris(502, 'Halaman pembayaran belum berhasil dibuat. Silakan coba lagi.', simpan.pesan);
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
/** URL halaman Snap hanya diterima dari host Snap Midtrans (https). Pembeli diarahkan ke sini, jadi wajib dibatasi. */
export function urlSnapSah(url, cfg) {
  let u; try { u = new URL(String(url || '')); } catch (e) { return false; }
  if (String(url).length > 500 || u.username || u.password) return false;
  if (cfg.lingkungan === 'mock') return /^https?:$/.test(u.protocol);
  return u.protocol === 'https:' && u.hostname === new URL(cfg.snapBase).hostname && (u.port === '' || u.port === '443');
}

/* ------------------------------------------------------------------ checkout tamu (tanpa login) */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TOKEN = /^[0-9a-f]{64}$/;
/** Token browser untuk memakai ulang pesanan tamu miliknya. Yang dikirim browser hanya dipakai bila formatnya benar;
 *  selain itu dibuat baru. Database hanya menyimpan SHA-256-nya. */
export function tokenTamu(v) {
  if (typeof v === 'string' && TOKEN.test(v)) return v;
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
/** Penanda peminta untuk batas penyalahgunaan: HMAC-SHA256(GATEWAY_SECRET, IP) 32 hex; IP mentah tidak disimpan.
 *  IP dibaca dari X-Forwarded-For (entri pertama) dan DIANGGAP PETUNJUK, bukan identitas: bila dipalsukan, batas
 *  global di database tetap berlaku, dan batas ini tidak pernah dikaitkan ke email pembeli. */
export async function pemintaDari(req, rahasia) {
  const ip = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(rahasia), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`peminta:${ip}`))).slice(0, 32);
}
/** Nomor WhatsApp opsional → +62…; '' bila kosong; null bila format salah. */
export function normalWa(v) {
  const d = String(v || '').replace(/[\s\-().]/g, '');
  if (!d) return '';
  const n = d.startsWith('+62') ? d.slice(3) : d.startsWith('62') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : null;
  return n && /^8[0-9]{7,12}$/.test(n) ? `+62${n}` : null;
}
/**
 * Kirim tautan masuk/aktivasi (OTP email Supabase, anon key; akun dibuat Supabase bila belum ada → tanpa akun ganda).
 * Kegagalan TIDAK menggagalkan pembayaran: dicatat, dan pembeli bisa meminta tautan lagi dari halaman Akun.
 */
async function kirimAktivasi(ctx, kode, fetcher) {
  try {
    const t = await ctx.rpc('tamu_perlu_email', { p_rahasia: ctx.cfg.rahasia, p_kode: kode });
    if (!t) return 'tidak_perlu';
    let ok = false, ket = '';
    try {
      const res = await fetcher(`${ctx.cfg.supabaseUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(`${ctx.cfg.situs}/akun?view=aktivasi`)}`, { method: 'POST',
        headers: { apikey: ctx.cfg.anonKey, Authorization: `Bearer ${ctx.cfg.anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: t.email, create_user: true }), signal: AbortSignal.timeout(BATAS_WAKTU_MS) });
      ok = res.ok; ket = `HTTP ${res.status}`;
    } catch (e) { ket = 'jaringan'; }
    await ctx.rpc('tamu_catat_email', { p_rahasia: ctx.cfg.rahasia, p_pesanan: t.id, p_ok: ok, p_pesan: ket });
    return ok ? 'terkirim' : 'gagal';
  } catch (e) { return 'gagal'; }   // dicatat di log pembungkus bila perlu; pembayaran tetap aman
}
/** Selaraskan pesanan tamu: Snap yang lewat waktu tanpa transaksi di Midtrans (404) = kedaluwarsa. */
async function sinkronTamu(ctx, kode, lewatWaktu) {
  let st = await ctx.mt.status(kode);
  if (tidakAda(st)) {
    if (!lewatWaktu) return 'menunggu';
    return ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: { order_id: kode, transaction_status: 'expire', refunds: [] } });
  }
  if (lewatWaktu && String(st.data.transaction_status) === 'pending') { await ctx.mt.cancel(kode); st = await ctx.mt.status(kode); if (tidakAda(st)) return 'tidak_ada'; }
  if (!st.data.transaction_status) throw new GalatQris(502, 'Status pembayaran belum dapat dipastikan. Coba lagi sebentar.', `HTTP ${st.http}`);
  return ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: ringkasStatus(st.data) });
}
const tamuPublik = (t, token) => ({ ...(token ? { token } : {}), kode: t.kode, status: t.status, amount: t.amount, berlaku_sampai: t.berlaku_sampai, snap_url: t.status === 'menunggu' ? t.snap_url : null, email_status: t.email_status });

/** POST {nama, email, whatsapp} — tanpa login. Membuat/mengambil pesanan tamu + halaman Snap (QRIS). */
export const handleTamuCheckout = bungkus('tamu-checkout', async (req, ctx) => {
  const b = await bodyJson(req);
  const email = String(b.email || '').trim().toLowerCase(), nama = String(b.nama || '').trim().replace(/\s+/g, ' ');
  const wa = normalWa(b.whatsapp);
  if (!EMAIL.test(email) || email.length > 254) throw new GalatQris(400, 'Email tidak valid.');
  if (nama.length < 2 || nama.length > 100) throw new GalatQris(400, 'Nama lengkap wajib diisi (2–100 karakter).');
  if (wa === null) throw new GalatQris(400, 'Nomor WhatsApp tidak valid. Contoh: 081234567890, atau kosongkan.');
  if (!ctx.cfg.situs) throw new GalatQris(503, 'Pembayaran otomatis belum dikonfigurasi.', 'SITE_URL/ALLOWED_ORIGINS kosong');
  const token = tokenTamu(b.token);
  const args = { p_rahasia: ctx.cfg.rahasia, p_email: email, p_nama: nama, p_whatsapp: wa,
    p_token_hash: await sha256Hex(token), p_peminta: await pemintaDari(req, ctx.cfg.rahasia) };
  let m = await ctx.rpc('tamu_buat_pesanan', args);
  if (m.aksi === 'cek') {
    await sinkronTamu(ctx, m.pesanan.kode, true);
    m = await ctx.rpc('tamu_buat_pesanan', args);
    if (m.aksi === 'cek') throw new GalatQris(409, 'Pembayaran sebelumnya masih diproses. Coba lagi beberapa saat lagi.');
  }
  const t = m.pesanan;
  if (m.aksi === 'pakai') {
    if (t.status === 'dibuat') throw new GalatQris(409, 'Halaman pembayaran sedang disiapkan. Coba lagi beberapa detik lagi.');
    return tamuPublik(t, token);
  }
  const menit = Math.max(1, Math.round((new Date(t.berlaku_sampai).getTime() - ctx.now()) / 60000)) || m.qr_menit;
  let hasil;
  try {
    const r = await ctx.mt.snap(t.kode, t.amount, menit, `${ctx.cfg.situs}/akun?view=bayar`);
    hasil = r.http === 201 && r.data.token && urlSnapSah(r.data.redirect_url, ctx.cfg)
      ? { ok: true, snap_token: String(r.data.token).slice(0, 200), snap_url: r.data.redirect_url }
      : { ok: false, pesan: `Ditolak penyedia (${r.http})` };
  } catch (e) { hasil = { ok: false, pesan: 'Gagal menghubungi penyedia pembayaran' }; }
  const simpan = await ctx.rpc('tamu_simpan_snap', { p_rahasia: ctx.cfg.rahasia, p_pesanan: t.id, p_hasil: hasil });
  if (simpan.status !== 'menunggu') throw new GalatQris(502, 'Halaman pembayaran belum berhasil dibuat. Silakan coba lagi.', simpan.pesan);
  return tamuPublik(simpan, token);
}, { butuhLogin: false });

/** POST {kode, email, paksa} — tanpa login; kode DAN email harus cocok. Untuk halaman kembali dari Snap. */
export const handleTamuStatus = bungkus('tamu-status', async (req, ctx) => {
  const b = await bodyJson(req);
  const kode = String(b.kode || ''), email = String(b.email || '').trim().toLowerCase();
  if (!/^CT-[A-Z0-9]{8}$/.test(kode) || !EMAIL.test(email)) throw new GalatQris(404, 'Pesanan tidak ditemukan.');
  const args = { p_rahasia: ctx.cfg.rahasia, p_kode: kode, p_email: email };
  let t = await ctx.rpc('tamu_status', args);
  if (!t) throw new GalatQris(404, 'Pesanan tidak ditemukan.');
  if (['dibuat', 'menunggu'].includes(t.status)) {
    const lewatWaktu = new Date(t.berlaku_sampai).getTime() <= ctx.now();
    const tua = !t.dicek_pada || ctx.now() - new Date(t.dicek_pada).getTime() > CEK_BERKALA_MS;
    if (b.paksa === true || lewatWaktu || tua) { await sinkronTamu(ctx, kode, lewatWaktu); t = await ctx.rpc('tamu_status', args); }
  }
  if (t.status === 'lunas' && t.email_status !== 'terkirim') { await kirimAktivasi(ctx, kode, ctx.fetch); t = await ctx.rpc('tamu_status', args); }
  return tamuPublik(t);
}, { butuhLogin: false });

export const handleNotifikasi = bungkus('qris-notifikasi', async (req, ctx) => {
  const notif = await bodyJson(req);
  if (!(await signatureSah(notif, ctx.cfg.kunci))) throw new GalatQris(401, 'Signature tidak valid.', `signature ditolak untuk ${String(notif && notif.order_id).slice(0, 60)}`);
  const st = await ctx.mt.status(notif.order_id);
  if (tidakAda(st)) return { ok: true, hasil: 'tidak_ada_di_midtrans' };
  if (!st.data.transaction_status) throw new GalatQris(502, 'Status belum dapat dipastikan.', `HTTP ${st.http}`);
  const hasil = await ctx.rpc('gateway_terapkan_status', { p_rahasia: ctx.cfg.rahasia, p_status: ringkasStatus(st.data) });
  // Checkout tamu yang baru lunas: kirim tautan aktivasi. Gagal kirim tidak membatalkan pencatatan (tetap 200).
  const email = /^CT-/.test(String(notif.order_id)) && hasil === 'lunas_tamu' ? await kirimAktivasi(ctx, notif.order_id, ctx.fetch) : undefined;
  return { ok: true, hasil, ...(email ? { email } : {}) };
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
