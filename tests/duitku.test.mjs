/* Uji Edge Function Duitku (duitku-buat & duitku-callback) dengan fetch tiruan. Jalankan: node tests/duitku.test.mjs
 * Butuh Node 22.18+ (menjalankan TypeScript dengan type stripping). Kunci di sini TIRUAN. */
import { createHmac } from 'node:crypto';
import * as buat from '../supabase/functions/duitku-buat/index.ts';
import * as cb from '../supabase/functions/duitku-callback/index.ts';

let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const truthy = (c, m) => { if (!c) throw new Error(m || 'gagal'); };

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon-tes', DUITKU_MERCHANT_CODE_SANDBOX: 'DS12345', DUITKU_API_KEY_SANDBOX: 'kunci-rahasia-tes' };
const env = (o = {}) => (n) => ({ ...ENV, ...o })[n];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// fetch tiruan: mencatat panggilan dan menjawab sesuai URL.
const tiruan = (jawab) => { const log = []; const f = async (url, init = {}) => { log.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return jawab(url, init, log.length); }; f.log = log; return f; };
const req = (o = {}) => new Request('https://proj.supabase.co/functions/v1/duitku-buat', {
  method: o.method || 'POST', headers: { Origin: o.origin ?? 'https://cekuntung.id', ...(o.token === null ? {} : { Authorization: o.token || 'Bearer token-pengguna' }) },
});
const PESANAN = { order_id: 'CU261105-ABC', harga: 149000, email: 'ani@x.id', mode: 'sandbox', produk: 'Cek Untung Pro 1 tahun', lanjut: false };

await t('hmacHex sama dengan HMAC-SHA256 Node', async () => {
  truthy(await buat.hmacHex('DS12345' + '1700000000000', 'k') === createHmac('sha256', 'k').update('DS123451700000000000').digest('hex'));
});
await t('CORS: hanya cekuntung.id dan preview *.cekuntung.pages.dev', async () => {
  truthy(buat.asalDiizinkan('https://cekuntung.id') && buat.asalDiizinkan('https://duitku-sandbox.cekuntung.pages.dev'));
  truthy(!buat.asalDiizinkan('https://cekuntung.id.jahat.com') && !buat.asalDiizinkan('http://cekuntung.id') && !buat.asalDiizinkan(null) && !buat.asalDiizinkan('https://x.pages.dev'));
  const f = tiruan(() => json(200, {}));
  const r = await buat.buatHandler(env(), f)(req({ origin: 'https://jahat.example' }));
  truthy(r.status === 403 && f.log.length === 0, 'asal asing harus ditolak tanpa memanggil apa pun');
});
await t('tanpa token login → 401, database & Duitku tidak dipanggil', async () => {
  const f = tiruan(() => json(200, {}));
  const r = await buat.buatHandler(env(), f)(req({ token: null }));
  truthy(r.status === 401 && f.log.length === 0);
});
await t('pembelian tertutup → pesan dari database diteruskan dengan bahasa Indonesia', async () => {
  const f = tiruan(() => json(400, { message: 'PEMBAYARAN_TUTUP: Pembelian Pro belum dibuka.' }));
  const r = await buat.buatHandler(env(), f)(req());
  const b = await r.json();
  truthy(r.status === 400 && b.error === 'Pembelian Pro belum dibuka.' && f.log.length === 1, JSON.stringify(b));
});
await t('pesanan menunggu dilanjutkan: Duitku tidak dipanggil lagi', async () => {
  const f = tiruan(() => json(200, { ...PESANAN, lanjut: true, payment_url: 'https://app-sandbox.duitku.com/redirect_checkout?reference=DS1' }));
  const r = await buat.buatHandler(env(), f)(req());
  const b = await r.json();
  truthy(r.status === 200 && b.lanjut && b.payment_url.includes('DS1') && f.log.length === 1);
});
await t('alur normal: harga dari database, tanda tangan benar, referensi disimpan, link dikembalikan', async () => {
  const f = tiruan((url) => {
    if (url.endsWith('/rpc/pesanan_pro_buat')) return json(200, PESANAN);
    if (url.includes('duitku.com')) return json(200, { merchantCode: 'DS12345', reference: 'DSREF9', paymentUrl: 'https://app-sandbox.duitku.com/redirect_checkout?reference=DSREF9', statusCode: '00', statusMessage: 'SUCCESS' });
    if (url.endsWith('/rpc/pesanan_pro_set_referensi')) return new Response(null, { status: 204 });
    return json(404, {});
  });
  const r = await buat.buatHandler(env(), f)(req());
  const b = await r.json();
  truthy(r.status === 200 && b.payment_url.endsWith('DSREF9') && r.headers.get('Access-Control-Allow-Origin') === 'https://cekuntung.id', JSON.stringify(b));
  const [db1, duitku, db2] = f.log;
  truthy(db1.init.headers.Authorization === 'Bearer token-pengguna' && db1.init.headers.apikey === 'anon-tes', 'database dipanggil dengan token pengguna + anon key');
  truthy(duitku.url === 'https://api-sandbox.duitku.com/api/merchant/createInvoice', 'endpoint sandbox');
  const h = duitku.init.headers;
  truthy(h['x-duitku-merchantcode'] === 'DS12345' && /^\d{13}$/.test(h['x-duitku-timestamp']), 'header merchant & timestamp ms');
  truthy(h['x-duitku-signature'] === createHmac('sha256', 'kunci-rahasia-tes').update('DS12345' + h['x-duitku-timestamp']).digest('hex'), 'tanda tangan');
  truthy(duitku.body.paymentAmount === 149000 && duitku.body.merchantOrderId === 'CU261105-ABC' && duitku.body.email === 'ani@x.id', 'isi invoice');
  truthy(duitku.body.callbackUrl === 'https://proj.supabase.co/functions/v1/duitku-callback', 'callbackUrl');
  truthy(duitku.body.returnUrl === 'https://cekuntung.id/dashboard.html?bayar=CU261105-ABC', 'returnUrl');
  truthy(db2.body.p_order_id === 'CU261105-ABC' && db2.body.p_referensi === 'DSREF9' && db2.init.headers.Authorization === 'Bearer token-pengguna', 'referensi disimpan atas nama pengguna');
  truthy(!JSON.stringify(b).includes('kunci-rahasia-tes') && !JSON.stringify(duitku.body).includes('kunci-rahasia-tes'), 'kunci tidak bocor');
});
await t('Duitku menolak → 502, referensi tidak disimpan', async () => {
  const f = tiruan((url) => url.endsWith('/rpc/pesanan_pro_buat') ? json(200, PESANAN) : json(400, { statusCode: '01', statusMessage: 'Invalid' }));
  const r = await buat.buatHandler(env(), f)(req());
  truthy(r.status === 502 && f.log.length === 2 && !f.log.some((l) => l.url.includes('set_referensi')));
});
await t('kunci Duitku belum dipasang → 500 dengan pesan sopan', async () => {
  const f = tiruan(() => json(200, PESANAN));
  const r = await buat.buatHandler(env({ DUITKU_API_KEY_SANDBOX: undefined }), f)(req());
  truthy(r.status === 500 && /belum disiapkan/.test((await r.json()).error) && f.log.length === 1);
});

// ---------- callback ----------
const cbReq = (body, method = 'POST') => new Request('https://proj.supabase.co/functions/v1/duitku-callback', {
  method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'POST' ? body : undefined,
});
const FORM = 'merchantCode=DS12345&amount=149000&merchantOrderId=CU261105-ABC&resultCode=00&reference=DSREF9&paymentCode=SP&signature=abc&customerName=Nama+Pembayar&issuerCode=93600';
await t('callback: hanya kolom yang dibutuhkan diteruskan ke database, dengan anon key', async () => {
  const f = tiruan(() => json(200, { ok: true, hasil: 'lunas' }));
  const r = await cb.buatHandler(env(), f)(cbReq(FORM));
  truthy(r.status === 200 && (await r.text()) === 'OK');
  const d = f.log[0];
  truthy(d.url === 'https://proj.supabase.co/rest/v1/rpc/duitku_terima' && d.init.headers.Authorization === 'Bearer anon-tes');
  truthy(d.body.data.merchantOrderId === 'CU261105-ABC' && d.body.data.amount === '149000' && d.body.data.signature === 'abc');
  truthy(!('customerName' in d.body.data) && !('issuerCode' in d.body.data), 'nama pembayar tidak diteruskan');
});
await t('callback ditolak database → non-200 agar Duitku mencoba lagi', async () => {
  const f = tiruan(() => json(200, { ok: false, hasil: 'tanda tangan tidak sah' }));
  truthy((await cb.buatHandler(env(), f)(cbReq(FORM))).status === 400);
  const g = tiruan(() => json(500, { message: 'error' }));
  truthy((await cb.buatHandler(env(), g)(cbReq(FORM))).status === 502);
});
await t('callback GET ditolak', async () => {
  const f = tiruan(() => json(200, { ok: true }));
  truthy((await cb.buatHandler(env(), f)(cbReq(null, 'GET'))).status === 405 && f.log.length === 0);
});
await t('callback memotong nilai yang terlalu panjang', async () => {
  const d = cb.ambilKolom(new URLSearchParams('merchantOrderId=' + 'x'.repeat(5000)));
  truthy(d.merchantOrderId.length === 200 && d.amount === '');
});

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji Duitku lulus');
process.exit(failed ? 1 : 0);
