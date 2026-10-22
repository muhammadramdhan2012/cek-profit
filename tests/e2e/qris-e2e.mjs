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
let dbMati = false, otpGagal = false; const otp = [];
const bridge = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const kirim = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (dbMati) return kirim(503, { message: 'unavailable' });
    const pth = new URL(req.url, 'http://x');
    if (pth.pathname === '/auth/v1/otp') {   // tiruan Supabase Auth: tautan email (OTP) — dicatat, bisa digagalkan
      otp.push({ body: JSON.parse(raw || '{}'), redirect: pth.searchParams.get('redirect_to'), apikey: req.headers.apikey });
      return kirim(otpGagal ? 500 : 200, {});
    }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(pth.pathname);
    if (!m || req.method !== 'POST' || req.headers.apikey !== ANON) return kirim(401, { message: 'invalid' });
    const tok = (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || '';
    // Token uji: "uid:<uuid>" atau "uid:<uuid>:<metode amr>" (mis. otp / password).
    const [uid = '', amr = 'password'] = tok.startsWith('uid:') ? tok.slice(4).split(':') : [];
    if (tok !== ANON && !/^[0-9a-f-]{36}$/.test(uid)) return kirim(401, { message: 'JWT tidak valid' });
    const args = JSON.parse(raw || '{}');
    if (!Object.keys(args).every((k) => /^p_[a-z_]+$/.test(k))) return kirim(400, { message: 'argumen' });
    const panggil = `public.${m[1]}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')})`;
    const klaim = uid ? JSON.stringify({ sub: uid, amr: [{ method: amr }] }) : '';
    const sql = `begin; select set_config('request.jwt.claim.sub', ${lit(uid)}, true), set_config('request.jwt.claims', ${lit(klaim)}, true) \\g /dev/null
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
  MIDTRANS_ENV: 'mock', MIDTRANS_API_BASE: `http://127.0.0.1:${mt.server.address().port}`, GATEWAY_SECRET: RAHASIA, SITE_URL: 'https://preview.uji.invalid' };
const logs = [];
const deps = { env, log: (m) => logs.push(m) };
const panggil = async (h, body, uid) => { const r = await h(new Request('https://fn/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid !== null ? { Authorization: `Bearer ${uid ? `uid:${uid}` : ANON}` } : {}) }, body: JSON.stringify(body) }), deps); return { status: r.status, body: await r.json() }; };
const notifikasi = (oid, opsi) => panggil(Q.handleNotifikasi, mt.notifikasi(oid, opsi), null);
const rpcSebagai = async (uid, fn, args) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer uid:${uid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); return r.json(); };
const satu = (sql) => psql(sql);

try {
  await psql(`create database ${DB}`, 'postgres');
  await psql(null, DB, path.join(ROOT, 'supabase/tests/shim-tanpa-ekspos.sql'), false);
  for (const f of ['supabase/schema.sql', 'supabase/usulan/pro-sekali-bayar.sql', 'supabase/usulan/hardening-fungsi.sql', 'supabase/usulan/qris-midtrans.sql', 'supabase/usulan/checkout-tamu.sql']) await psql(null, DB, path.join(ROOT, f));
  await satu(`insert into public.gateway_rahasia (id, hash) values (1, encode(sha256(convert_to('${RAHASIA}', 'UTF8')), 'hex'));
    insert into auth.users (id, email) values ('${U.a}','a@e2e.id'),('${U.b}','b@e2e.id'),('${U.c}','c@e2e.id'),('${U.d}','d@e2e.id'),('${U.adm}','admin@e2e.id');
    update public.profiles set is_admin = true where id = '${U.adm}';
    update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis', kontak_bantuan = 'bantuan@contoh.invalid'`);
  const pesan = async (uid) => (await rpcSebagai(uid, 'buat_pesanan_pro', { p_metode: 'qris' })).id;
  const pro = async (uid) => (await satu(`select pro_sekali_bayar from public.profiles where id = '${uid}'`)) === 't';
  const jml = (sql) => satu(sql).then(Number);

  // E1 checkout login → Snap; panggil ulang → Snap yang sama (tanpa tagihan ganda)
  const oA = await pesan(U.a);
  let r = await panggil(Q.handleBuat, { pesanan: oA, amount: 1 }, U.a);
  const gA = r.body.percobaan;
  cek(r.status === 200 && gA.status === 'menunggu' && /snap\/v4\/redirection/.test(gA.snap_url) && gA.amount === 149000 && mt.trx.get(gA.gateway_order_id).body.enabled_payments.join() === 'other_qris', `E1 Snap QRIS dibuat (Rp149.000 dari server, amount browser diabaikan) ${r.status}`);
  r = await panggil(Q.handleBuat, { pesanan: oA }, U.a);
  cek(r.body.percobaan.id === gA.id && r.body.percobaan.snap_url === gA.snap_url && mt.trx.size === 1, 'E2 Lanjutkan pembayaran memakai Snap yang sama, 1 transaksi di Midtrans');
  mt.pilihQris(gA.gateway_order_id);
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
  const g1 = (await panggil(Q.handleBuat, { pesanan: oB }, U.b)).body.percobaan; mt.pilihQris(g1.gateway_order_id);
  await satu(`update public.pro_gateway_percobaan set berlaku_sampai = now() - interval '1 minute' where id = ${g1.id}`);
  r = await panggil(Q.handleBuat, { pesanan: oB }, U.b);
  cek(r.status === 200 && r.body.percobaan.gateway_order_id.endsWith('-2') && mt.trx.get(g1.gateway_order_id).status === 'cancel'
    && (await satu(`select status from public.pro_gateway_percobaan where id = ${g1.id}`)) === 'batal', 'E9 QR lewat waktu: QR lama dibatalkan, QR baru -2, pesanan sama');
  cek((await jml(`select count(*) from public.pro_gateway_percobaan where order_id = ${oB} and status in ('dibuat','menunggu')`)) === 1, 'E10 hanya satu QR terbuka per pesanan');
  // E11 notifikasi tidak datang: cek berkala/paksa mengaktifkan lewat Get Status
  mt.bayar(r.body.percobaan.gateway_order_id);
  r = await panggil(Q.handleCek, { pesanan: oB, paksa: true }, U.b);
  cek(r.body.pro === true && await pro(U.b), 'E11 tanpa notifikasi: tombol cek/polling mengaktifkan lewat Get Status');

  const oC = await pesan(U.c);
  // E9b Snap ditutup tanpa memilih QRIS lalu lewat waktu (Get Status 404) → kedaluwarsa; Snap baru untuk pesanan yang sama
  const c1 = (await panggil(Q.handleBuat, { pesanan: oC }, U.c)).body.percobaan;
  await satu(`update public.pro_gateway_percobaan set berlaku_sampai = now() - interval '1 minute' where id = ${c1.id}`);
  r = await panggil(Q.handleCek, { pesanan: oC }, U.c);
  cek(r.status === 200 && r.body.percobaan.status === 'kedaluwarsa' && !r.body.percobaan.snap_url, 'E9b Snap lewat waktu tanpa transaksi → kedaluwarsa, tautan lanjutkan disembunyikan');
  const gC = (await panggil(Q.handleBuat, { pesanan: oC }, U.c)).body.percobaan;
  cek(gC.gateway_order_id.endsWith('-2') && (await jml(`select count(*) from public.upgrade_requests where user_id = '${U.c}'`)) === 1, 'E9c bayar ulang: Snap baru -2 pada pesanan yang sama');
  // E12 nominal tidak cocok
  mt.bayar(gC.gateway_order_id, { gross: 1000 });
  r = await notifikasi(gC.gateway_order_id);
  cek(r.body.hasil === 'perlu_cek' && !(await pro(U.c)) && (await satu(`select status from public.upgrade_requests where id = ${oC}`)) === 'perlu_cek', 'E12 nominal tidak cocok: perlu_cek, Pro tidak aktif');
  // E9d webhook terlambat: Snap pertama (sudah ditandai kedaluwarsa) ternyata dibayar penuh → tetap diterapkan, dana tidak hangus
  mt.bayar(c1.gateway_order_id);
  r = await notifikasi(c1.gateway_order_id);
  cek(r.status === 200 && await pro(U.c) && (await satu(`select status from public.pro_gateway_percobaan where id = ${c1.id}`)) === 'lunas', `E9d webhook terlambat untuk Snap kedaluwarsa → lunas, Pro aktif (${JSON.stringify(r.body)})`);

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

  // ---------------- checkout tamu (Snap) ----------------
  await satu(`update public.pengaturan_pembayaran set mode = 'otomatis'`);
  const tamu = (body) => panggil(Q.handleTamuCheckout, body, null);
  const statusTamu = (body) => panggil(Q.handleTamuStatus, body, null);
  const sebagai = (uid, metode) => `uid:${uid}:${metode}`;
  const klaim = async (uid, metode) => (await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/klaim_pembelian_tamu`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${sebagai(uid, metode)}`, 'Content-Type': 'application/json' }, body: '{}' })).json();
  r = await tamu({ nama: 'Tamu Baru', email: 'Tamu@E2E.id', whatsapp: '081234567890' });
  const k1 = r.body.kode;
  cek(r.status === 200 && /^CT-/.test(k1) && /snap\/v4\/redirection/.test(r.body.snap_url) && mt.trx.get(k1).body.enabled_payments.join() === 'other_qris', `G1 checkout tamu tanpa login → Snap QRIS (${r.status})`);
  r = await tamu({ nama: 'Tamu Baru', email: 'tamu@e2e.id' });
  cek(r.body.kode === k1 && mt.trx.size === [...mt.trx.keys()].length, 'G2 klik ulang → Snap yang sama (tanpa tagihan ganda)');
  r = await panggil(Q.handleNotifikasi, mt.notifikasi(k1, { kunci: 'palsu' }), null);
  cek(r.status === 401, 'G3 webhook palsu untuk pesanan tamu ditolak');
  mt.bayar(k1);
  const par = await Promise.all(Array.from({ length: 8 }, () => panggil(Q.handleNotifikasi, mt.notifikasi(k1), null)));
  cek(par.every((x) => x.status === 200) && (await jml(`select count(*) from public.pro_payments where note like '%${k1}%' and kind = 'pembayaran'`)) === 1
    && (await satu(`select status from public.pro_pesanan_tamu where kode = '${k1}'`)) === 'lunas', 'G4 8 notifikasi paralel → 1 dana, pesanan lunas, belum ada Pro');
  cek(otp.length === 1 && otp[0].body.email === 'tamu@e2e.id' && otp[0].body.create_user === true && otp[0].redirect === 'https://preview.uji.invalid/akun?view=aktivasi'
    && (await satu(`select email_status from public.pro_pesanan_tamu where kode = '${k1}'`)) === 'terkirim', 'G5 tautan aktivasi dikirim sekali ke email pesanan');
  // akun dibuat Supabase dari tautan (OTP) → klaim
  const uT = 'e6000000-0000-0000-0000-0000000000e6', uX = 'e7000000-0000-0000-0000-0000000000e7';
  await satu(`insert into auth.users (id, email, email_confirmed_at) values ('${uT}', 'tamu@e2e.id', now()), ('${uX}', 'penyerang@e2e.id', now())`);
  let kl = await klaim(uX, 'otp');
  cek(kl.aktif === 0 && !(await pro(uX)), 'G6 klaim oleh email lain ditolak');
  kl = await klaim(uT, 'password');
  cek(kl.aktif === 0 && kl.perlu_tautan_email === true && !(await pro(uT)), 'G7 masuk dengan kata sandi saja belum cukup → diminta tautan email');
  kl = await klaim(uT, 'otp');
  cek(kl.aktif === 1 && await pro(uT) && (await satu(`select status from public.pro_pesanan_tamu where kode = '${k1}'`)) === 'diklaim', 'G8 masuk lewat tautan email → Pro aktif');
  // email gagal terkirim → tercatat → pulih
  const uS = 'e8000000-0000-0000-0000-0000000000e8';
  r = await tamu({ nama: 'Email Gagal', email: 'gagal@e2e.id' }); const k2 = r.body.kode; mt.bayar(k2);
  otpGagal = true; r = await panggil(Q.handleNotifikasi, mt.notifikasi(k2), null); otpGagal = false;
  cek(r.status === 200 && (await satu(`select status || '/' || email_status from public.pro_pesanan_tamu where kode = '${k2}'`)) === 'lunas/gagal', 'G9 email gagal: pembayaran tetap tercatat lunas, status email gagal');
  await satu(`update public.pro_pesanan_tamu set email_dicoba = now() - interval '2 minutes' where kode = '${k2}'`);
  r = await statusTamu({ kode: k2, email: 'gagal@e2e.id' });
  cek(r.body.status === 'lunas' && r.body.email_status === 'terkirim', 'G10 pemulihan: halaman status mengirim ulang tautan');
  await satu(`insert into auth.users (id, email, email_confirmed_at) values ('${uS}', 'gagal@e2e.id', now())`);
  cek((await klaim(uS, 'magiclink')).aktif === 1 && await pro(uS), 'G11 klaim setelah pemulihan → Pro aktif');
  // email terdaftar yang sudah Pro membayar lagi → tidak ada aktivasi ganda
  r = await tamu({ nama: 'Sudah Pro', email: 'tamu@e2e.id' }); const k3 = r.body.kode; mt.bayar(k3);
  await panggil(Q.handleNotifikasi, mt.notifikasi(k3), null);
  kl = await klaim(uT, 'otp');
  cek(kl.ganda === 1 && (await jml(`select count(*) from public.upgrade_requests where user_id = '${uT}'`)) === 1, 'G12 email sudah Pro bayar lagi → ditandai ganda, tanpa aktivasi kedua');
  // refund dana tamu yang sudah diklaim
  const payT = await jml(`select payment_id from public.pro_pesanan_tamu where kode = '${k1}'`);
  r = await panggil(Q.handleRefund, { pembayaran: payT, nominal: 149000, alasan: 'uji refund tamu' }, U.adm);
  cek(r.status === 200 && r.body.hasil === 'direfund' && !(await pro(uT)), `G13 refund penuh dana tamu → Pro dicabut (${JSON.stringify(r.body)})`);
  r = await panggil(Q.handleRefund, { pembayaran: payT, nominal: 149000, alasan: 'ulang' }, U.adm);
  cek(r.status === 400 && (await jml(`select count(*) from public.pro_payments where refund_of = ${payT}`)) === 1, 'G14 refund ulang ditolak, 1 baris refund');
  // nominal salah
  r = await tamu({ nama: 'Nominal Salah', email: 'nominal@e2e.id' }); const k4 = r.body.kode; mt.bayar(k4, { gross: 1000 });
  r = await panggil(Q.handleNotifikasi, mt.notifikasi(k4), null);
  cek(r.body.hasil === 'perlu_cek' && (await jml(`select count(*) from public.pro_payments where note like '%${k4}%'`)) === 0, 'G15 nominal salah → perlu_cek, tidak masuk buku besar, tanpa email');
  cek(!otp.some((o) => o.body.email === 'nominal@e2e.id'), 'G16 tidak ada tautan aktivasi untuk pembayaran tidak sah');
  cek(!logs.join('\n').includes(RAHASIA) && !logs.join('\n').includes(mt.serverKey), 'E21 log Edge Function tanpa server key/rahasia');
  cek((await jml(`select count(*) from public.pro_payments where sumber = 'midtrans' and kind = 'pembayaran' and note not like 'Checkout tamu%'`)) === 4, 'E22 buku besar: 4 pembayaran sah (A, B, C terlambat, D); nominal tidak cocok (C-2) tidak tercatat');
} catch (e) { gagal++; console.log('GAGAL (galat)', e.message); }
finally {
  mt.server.close(); bridge.close();
  await psql(`drop database if exists ${DB}`, 'postgres').catch(() => {});
}
console.log(gagal ? `\n${gagal} GAGAL` : '\nE2E QRIS semua lulus');
process.exitCode = gagal ? 1 : 0;
