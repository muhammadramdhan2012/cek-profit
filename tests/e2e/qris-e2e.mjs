/*
 * Uji ujung-ke-ujung QRIS: Edge Function ASLI (supabase/functions/_shared/qris.mjs) + PostgreSQL ASLI + Midtrans TIRUAN.
 * Tidak masuk CI (butuh PostgreSQL). Menjalankan:
 *   PGHOST=<dir socket/host> PGPORT=<port> PGUSER=postgres node tests/e2e/qris-e2e.mjs
 * Membuat database baru `qris_e2e_<acak>` dan memasang: shim-tanpa-ekspos → schema → pro-sekali-bayar → hardening →
 * qris-midtrans. Jembatan PostgREST mini meneruskan /rest/v1/rpc/<fungsi> ke psql dengan peran anon/authenticated:
 *   Authorization "Bearer <anon key>" → anon;  "Bearer uid:<uuid>" → authenticated dengan auth.uid() = uuid.
 * Data SINTETIS. Tidak menghubungi Supabase/Midtrans sungguhan.
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Q = await import(path.join(ROOT, 'supabase', 'functions', '_shared', 'qris.mjs'));
const createMidtransMock = require(path.join(ROOT, 'tests', 'mock-midtrans.js'));
const DB = `qris_e2e_${Math.random().toString(36).slice(2, 8)}`;
const ANON = 'sb_publishable_E2E_ANON', RAHASIA = 'E'.repeat(48);
const U = { a: 'a3000000-0000-0000-0000-0000000000a3', b: 'b3000000-0000-0000-0000-0000000000b3', c: 'c3000000-0000-0000-0000-0000000000c3',
  d: 'd3000000-0000-0000-0000-0000000000d3', adm: 'f3000000-0000-0000-0000-0000000000f3' };

// berhenti = false hanya untuk shim: peran anon/authenticated bersifat global di cluster, jadi "already exists" pada
// cluster yang sudah pernah dipakai bukan kegagalan. File migrasi tetap dijalankan dengan ON_ERROR_STOP.
const psql = (sql, db = DB, file, berhenti = true) => new Promise((ok, no) => execFile('psql', ['-X', '-q', '-At', '-v', `ON_ERROR_STOP=${berhenti ? 1 : 0}`, '-d', db, ...(file ? ['-f', file] : ['-c', sql])],
  { maxBuffer: 1 << 24 }, (e, out, err) => (e ? no(new Error(String(err || e.message).replace(/^.*ERROR:\s+/s, '').split('\n')[0])) : ok(out.trim()))));
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''")}'`);

/* ---- jembatan PostgREST mini (hanya RPC) ---- */
let dbMati = false;
const bridge = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const kirim = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (dbMati) return kirim(503, { message: 'unavailable' });
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(new URL(req.url, 'http://x').pathname);
    if (!m || req.method !== 'POST' || req.headers.apikey !== ANON) return kirim(401, { message: 'invalid' });
    const tok = (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || '';
    const uid = tok.startsWith('uid:') ? tok.slice(4) : '';
    if (tok !== ANON && !/^[0-9a-f-]{36}$/.test(uid)) return kirim(401, { message: 'JWT tidak valid' });
    const args = JSON.parse(raw || '{}');
    if (!Object.keys(args).every((k) => /^p_[a-z_]+$/.test(k))) return kirim(400, { message: 'argumen' });
    const panggil = `public.${m[1]}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')})`;
    const sql = `begin; select set_config('request.jwt.claim.sub', ${lit(uid)}, true) \\g /dev/null
set local role ${uid ? 'authenticated' : 'anon'};
select coalesce(to_jsonb(${panggil}), 'null'::jsonb); commit;`;
    try { kirim(200, JSON.parse((await psqlStdin(sql)).split('\n').pop())); }
    catch (e) { kirim(/permission denied/.test(e.message) ? 403 : 400, { message: e.message }); }
  });
});
const psqlStdin = (sql) => new Promise((ok, no) => {
  const p = execFile('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB], { maxBuffer: 1 << 24 },
    (e, out, err) => (e ? no(new Error(String(err || e.message).replace(/^.*?ERROR:\s+/s, '').split('\n')[0])) : ok(out.trim())));
  p.stdin.end(sql);
});

/* ---- uji ---- */
let gagal = 0;
const cek = (c, m) => { if (!c) gagal++; console.log(c ? 'ok  ' : 'GAGAL', m); };
const mt = createMidtransMock();
await new Promise((r) => mt.server.listen(0, r));
await new Promise((r) => bridge.listen(0, r));
const env = { SUPABASE_URL: `http://127.0.0.1:${bridge.address().port}`, SUPABASE_ANON_KEY: ANON, MIDTRANS_SERVER_KEY: mt.serverKey,
  MIDTRANS_ENV: 'mock', MIDTRANS_API_BASE: `http://127.0.0.1:${mt.server.address().port}`, GATEWAY_SECRET: RAHASIA };
const logs = [];
const deps = { env, log: (m) => logs.push(m) };
const panggil = async (h, body, uid) => { const r = await h(new Request('https://fn/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid !== null ? { Authorization: `Bearer ${uid ? `uid:${uid}` : ANON}` } : {}) }, body: JSON.stringify(body) }), deps); return { status: r.status, body: await r.json() }; };
const notifikasi = (oid, opsi) => panggil(Q.handleNotifikasi, mt.notifikasi(oid, opsi), null);
const rpcSebagai = async (uid, fn, args) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer uid:${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); return r.json(); };
const satu = (sql) => psql(sql);

try {
  await psql(`create database ${DB}`, 'postgres');
  await psql(null, DB, path.join(ROOT, 'supabase/tests/shim-tanpa-ekspos.sql'), false);
  for (const f of ['supabase/schema.sql', 'supabase/usulan/pro-sekali-bayar.sql', 'supabase/usulan/hardening-fungsi.sql', 'supabase/usulan/qris-midtrans.sql']) await psql(null, DB, path.join(ROOT, f));
  await satu(`insert into public.gateway_rahasia (id, hash) values (1, encode(sha256(convert_to('${RAHASIA}', 'UTF8')), 'hex'));
    insert into auth.users (id, email) values ('${U.a}','a@e2e.id'),('${U.b}','b@e2e.id'),('${U.c}','c@e2e.id'),('${U.d}','d@e2e.id'),('${U.adm}','admin@e2e.id');
    update public.profiles set is_admin = true where id = '${U.adm}';
    update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis', kontak_bantuan = 'bantuan@contoh.invalid'`);
  const pesan = async (uid) => (await rpcSebagai(uid, 'buat_pesanan_pro', { p_metode: 'qris' })).id;
  const pro = async (uid) => (await satu(`select pro_sekali_bayar from public.profiles where id = '${uid}'`)) === 't';
  const jml = (sql) => satu(sql).then(Number);

  // E1 buat QR, panggil ulang → QR yang sama (tanpa charge kedua)
  const oA = await pesan(U.a);
  let r = await panggil(Q.handleBuat, { pesanan: oA, amount: 1 }, U.a);
  const gA = r.body.percobaan;
  cek(r.status === 200 && gA.status === 'menunggu' && /qr-code$/.test(gA.qr_url) && gA.amount === 149000, `E1 QR dibuat (Rp149.000 dari server, amount browser diabaikan) ${r.status}`);
  r = await panggil(Q.handleBuat, { pesanan: oA }, U.a);
  cek(r.body.percobaan.id === gA.id && mt.trx.size === 1, 'E2 permintaan ulang memakai QR yang sama, 1 charge di Midtrans');
  // E3 notifikasi pending tidak mengaktifkan
  r = await notifikasi(gA.gateway_order_id);
  cek(r.status === 200 && !(await pro(U.a)), 'E3 notifikasi pending: Pro belum aktif');
  // E4 notifikasi palsu
  mt.bayar(gA.gateway_order_id);
  r = await notifikasi(gA.gateway_order_id, { kunci: 'kunci-penyerang' });
  cek(r.status === 401 && !(await pro(U.a)), 'E4 notifikasi bersignature salah ditolak (401), Pro tidak aktif');
  // E5 bayar + 12 notifikasi paralel + 3 cek paksa paralel
  const hasil = await Promise.all([...Array.from({ length: 12 }, () => notifikasi(gA.gateway_order_id)), ...Array.from({ length: 3 }, () => panggil(Q.handleCek, { pesanan: oA, paksa: true }, U.a))]);
  cek(hasil.every((x) => x.status === 200), `E5 15 permintaan paralel diterima (${hasil.map((x) => x.status).join(',')})`);
  cek(await pro(U.a) && (await jml(`select count(*) from public.pro_payments where sumber = 'midtrans' and kind = 'pembayaran' and order_id = ${oA}`)) === 1
    && (await jml(`select count(*) from public.pro_order_events where order_id = ${oA} and status_baru = 'selesai'`)) === 1,
    'E6 paralel: Pro aktif SEKALI, 1 baris dana, 1 event aktivasi');
  r = await panggil(Q.handleCek, { pesanan: oA }, U.a);
  cek(r.body.pesanan.status === 'selesai' && r.body.pro === true && r.body.percobaan.status === 'lunas', 'E7 halaman checkout melihat Pro aktif');
  r = await panggil(Q.handleCek, { pesanan: oA }, U.b);
  cek(r.status === 404, 'E8 seller lain tidak bisa melihat pesanan A');

  // E9 QR kedaluwarsa → QR baru tanpa tagihan ganda; QR lama dibatalkan di Midtrans
  const oB = await pesan(U.b);
  const g1 = (await panggil(Q.handleBuat, { pesanan: oB }, U.b)).body.percobaan;
  await satu(`update public.pro_gateway_percobaan set berlaku_sampai = now() - interval '1 minute' where id = ${g1.id}`);
  r = await panggil(Q.handleBuat, { pesanan: oB }, U.b);
  cek(r.status === 200 && r.body.percobaan.gateway_order_id.endsWith('-2') && mt.trx.get(g1.gateway_order_id).status === 'cancel'
    && (await satu(`select status from public.pro_gateway_percobaan where id = ${g1.id}`)) === 'batal', 'E9 QR lewat waktu: QR lama dibatalkan, QR baru -2, pesanan sama');
  cek((await jml(`select count(*) from public.pro_gateway_percobaan where order_id = ${oB} and status in ('dibuat','menunggu')`)) === 1, 'E10 hanya satu QR terbuka per pesanan');
  // E11 notifikasi tidak datang: cek berkala/paksa mengaktifkan lewat Get Status
  mt.bayar(r.body.percobaan.gateway_order_id);
  r = await panggil(Q.handleCek, { pesanan: oB, paksa: true }, U.b);
  cek(r.body.pro === true && await pro(U.b), 'E11 tanpa notifikasi: tombol cek/polling mengaktifkan lewat Get Status');

  // E12 nominal tidak cocok
  const oC = await pesan(U.c);
  const gC = (await panggil(Q.handleBuat, { pesanan: oC }, U.c)).body.percobaan;
  mt.bayar(gC.gateway_order_id, { gross: 1000 });
  r = await notifikasi(gC.gateway_order_id);
  cek(r.body.hasil === 'perlu_cek' && !(await pro(U.c)) && (await satu(`select status from public.upgrade_requests where id = ${oC}`)) === 'perlu_cek', 'E12 nominal tidak cocok: perlu_cek, Pro tidak aktif');

  // E13 database mati saat notifikasi → 503 (Midtrans kirim ulang); setelah pulih → diterapkan
  const oD = await pesan(U.d);
  const gD = (await panggil(Q.handleBuat, { pesanan: oD }, U.d)).body.percobaan;
  mt.bayar(gD.gateway_order_id);
  dbMati = true; r = await notifikasi(gD.gateway_order_id); dbMati = false;
  cek(r.status >= 500 && !(await pro(U.d)), `E13 database tidak tersedia → ${r.status}, tidak ada perubahan`);
  r = await notifikasi(gD.gateway_order_id);
  cek(r.status === 200 && await pro(U.d), 'E14 kiriman ulang setelah pulih → Pro aktif');

  // E15 refund
  r = await panggil(Q.handleRefund, { pembayaran: await jml(`select id from public.pro_payments where order_id = ${oD} and kind = 'pembayaran'`), nominal: 1000, alasan: 'uji' }, U.d);
  cek(r.status === 400 && r.body.error === 'Hanya admin', 'E15 seller tidak bisa refund');
  const payD = await jml(`select id from public.pro_payments where order_id = ${oD} and kind = 'pembayaran'`);
  r = await panggil(Q.handleRefund, { pembayaran: payD, nominal: 50000, alasan: 'kompensasi uji' }, U.adm);
  cek(r.status === 200 && r.body.hasil === 'refund' && await pro(U.d), `E16 refund sebagian 50.000 → Pro tetap (${JSON.stringify(r.body)})`);
  const payA = await jml(`select id from public.pro_payments where order_id = ${oA} and kind = 'pembayaran'`);
  r = await panggil(Q.handleRefund, { pembayaran: payA, nominal: 149000, alasan: 'permintaan pembeli' }, U.adm);
  cek(r.status === 200 && r.body.hasil === 'direfund' && !(await pro(U.a)) && (await satu(`select status from public.upgrade_requests where id = ${oA}`)) === 'direfund', 'E17 refund penuh → Pro dicabut, pesanan direfund');
  r = await panggil(Q.handleRefund, { pembayaran: payA, nominal: 149000, alasan: 'klik ulang' }, U.adm);
  cek(r.status === 400 && (await jml(`select count(*) from public.pro_payments where refund_of = ${payA}`)) === 1, 'E18 refund kedua ditolak (sisa 0), tetap 1 baris refund');
  await Promise.all(Array.from({ length: 5 }, () => notifikasi(gA.gateway_order_id)));
  cek((await jml(`select count(*) from public.pro_payments where refund_of = ${payA}`)) === 1, 'E19 notifikasi refund berulang tidak menggandakan baris refund');

  // E20 mode manual: QR otomatis ditutup dengan pesan jelas
  await satu(`update public.pengaturan_pembayaran set mode = 'manual', bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI'`);
  r = await panggil(Q.handleBuat, { pesanan: oC }, U.c);
  cek(r.status === 400 && /belum dibuka/.test(r.body.error), 'E20 mode manual: pembuatan QR ditolak dengan pesan jelas');

  cek(!logs.join('\n').includes(RAHASIA) && !logs.join('\n').includes(mt.serverKey), 'E21 log Edge Function tanpa server key/rahasia');
  cek((await jml(`select count(*) from public.pro_payments where sumber = 'midtrans' and kind = 'pembayaran'`)) === 3, 'E22 buku besar: 3 pembayaran sah (A, B, D); nominal tidak cocok (C) tidak tercatat');
} catch (e) { gagal++; console.log('GAGAL (galat)', e.message); }
finally {
  mt.server.close(); bridge.close();
  await psql(`drop database if exists ${DB}`, 'postgres').catch(() => {});
}
console.log(gagal ? `\n${gagal} GAGAL` : '\nE2E QRIS semua lulus');
process.exitCode = gagal ? 1 : 0;
