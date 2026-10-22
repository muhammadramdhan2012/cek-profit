/* Uji Edge Function QRIS (supabase/functions/_shared/qris.mjs) di Node, tanpa Deno/Supabase/Midtrans sungguhan.
 * Midtrans = server tiruan (tests/mock-midtrans.js); database = RPC tiruan yang mencatat panggilan.
 * Uji ujung-ke-ujung dengan PostgreSQL sungguhan: tests/e2e/qris-e2e.mjs (manual, butuh PostgreSQL lokal). */
const createMidtransMock = require('./mock-midtrans');
const path = require('path');
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };

const SUPA = 'https://contoh-uji.supabase.co', ANON = 'sb_publishable_UJI_ANON', RAHASIA = 'r'.repeat(40);
const JWT = 'eyJ.uji.pembeli';

(async () => {
  const Q = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'qris.mjs'));
  const mt = createMidtransMock(); await new Promise((r) => mt.server.listen(0, r));
  const MT = `http://127.0.0.1:${mt.server.address().port}`;
  const env = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: ANON, MIDTRANS_SERVER_KEY: mt.serverKey, MIDTRANS_ENV: 'mock', MIDTRANS_API_BASE: MT, GATEWAY_SECRET: RAHASIA, ALLOWED_ORIGINS: 'https://feature-pro-pricing.cekuntung.pages.dev' };

  /** RPC tiruan: fungsi per nama; mencatat argumen & JWT. Fungsi boleh melempar {status, message}. */
  function db(handlers) {
    const calls = [];
    const fetcher = async (url, init) => {
      if (!String(url).startsWith(SUPA)) return fetch(url, init);
      if (String(url).includes('/auth/v1/otp')) { calls.push({ nama: 'otp', url: String(url), body: JSON.parse(init.body), apikey: init.headers.apikey }); return new Response('{}', { status: handlers.otpStatus || 200 }); }
      const nama = String(url).split('/rpc/')[1];
      const args = JSON.parse(init.body);
      calls.push({ nama, args, auth: init.headers.Authorization, apikey: init.headers.apikey });
      const h = handlers[nama];
      try {
        const v = h ? await h(args) : null;
        return new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: e.status || 400 }); }
    };
    return { calls, fetcher };
  }
  const logs = [];
  const deps = (fetcher, extra = {}) => ({ env, fetch: fetcher, log: (m) => logs.push(m), ...extra });
  const req = (body, { jwt = JWT, method = 'POST', origin } = {}) => new Request('https://fungsi.uji/x', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined });
  const baca = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });
  const percobaan = (o) => ({ id: 7, order_id: 3, gateway_order_id: 'CU-AAAA0001-1', amount: 149000, status: 'dibuat', berlaku_sampai: new Date(Date.now() + 15 * 60000).toISOString(), qr_url: null, ...o });

  await t('Konfigurasi: kunci/rahasia/lingkungan wajib; kunci harus cocok lingkungan; hanya mock boleh ganti API', async () => {
    const coba = (e) => { try { return Q.bacaKonfigurasi(e); } catch (x) { return x; } };
    const kosong = coba({});
    truthy(kosong.status === 503 && /MIDTRANS_SERVER_KEY/.test(kosong.detail) && /GATEWAY_SECRET/.test(kosong.detail), 'kosong → 503 + daftar yang kurang');
    truthy(coba({ ...env, MIDTRANS_ENV: 'sandbox', MIDTRANS_SERVER_KEY: 'Mid-server-PROD' }).status === 503, 'sandbox + kunci produksi ditolak');
    truthy(coba({ ...env, MIDTRANS_ENV: 'production', MIDTRANS_SERVER_KEY: 'SB-Mid-server-x' }).status === 503, 'produksi + kunci sandbox ditolak');
    truthy(coba({ ...env, GATEWAY_SECRET: 'pendek' }).status === 503, 'rahasia < 32 ditolak');
    const sb = coba({ ...env, MIDTRANS_ENV: 'sandbox', MIDTRANS_SERVER_KEY: 'SB-Mid-server-abc', MIDTRANS_API_BASE: 'http://jahat.example' });
    truthy(sb.apiBase === 'https://api.sandbox.midtrans.com', 'sandbox: MIDTRANS_API_BASE diabaikan');
    const pr = coba({ ...env, MIDTRANS_ENV: 'production', MIDTRANS_SERVER_KEY: 'Mid-server-abc' });
    truthy(pr.apiBase === 'https://api.midtrans.com', 'produksi → api.midtrans.com');
  });

  await t('Signature notifikasi: SHA512(order_id+status_code+gross_amount+server key), perbandingan aman', async () => {
    const c = await Q.signatureSah({ order_id: 'A-1', status_code: '200', gross_amount: '149000.00', signature_key: require('crypto').createHash('sha512').update(`A-1200149000.00${mt.serverKey}`).digest('hex') }, mt.serverKey);
    truthy(c === true, 'signature benar diterima');
    const n = { order_id: 'A-1', status_code: '200', gross_amount: '149000.00' };
    const sig = require('crypto').createHash('sha512').update(`A-1200149000.00${mt.serverKey}`).digest('hex');
    truthy(!(await Q.signatureSah({ ...n, gross_amount: '1.00', signature_key: sig }, mt.serverKey)), 'nominal diubah → ditolak');
    truthy(!(await Q.signatureSah({ ...n, signature_key: sig }, 'kunci-lain')), 'kunci lain → ditolak');
    truthy(!(await Q.signatureSah({ ...n }, mt.serverKey)) && !(await Q.signatureSah({ ...n, gross_amount: 149000, signature_key: sig }, mt.serverKey)) && !(await Q.signatureSah(null, 'x')), 'field kosong/bukan string → ditolak');
  });

  await t('Ringkasan status hanya membawa field yang dibutuhkan (minimisasi data)', async () => {
    const r = Q.ringkasStatus({ order_id: 'A', transaction_id: 'T', transaction_status: 'settlement', status_code: '200', gross_amount: '149000.00', currency: 'IDR', fraud_status: 'accept',
      customer_details: { email: 'x@y.id' }, issuer: 'bank', merchant_id: 'M', refunds: [{ refund_key: 'RF-1', refund_amount: '1000.00', reason: 'rahasia', bank_confirmed_at: 'x' }] });
    truthy(!('customer_details' in r) && !('issuer' in r) && !('merchant_id' in r), 'field lain dibuang');
    truthy(r.refunds.length === 1 && !('reason' in r.refunds[0]) && r.refunds[0].refund_key === 'RF-1', 'refund hanya kunci & nominal');
  });

  await t('Notifikasi: signature salah → 401 tanpa menyentuh Midtrans/database', async () => {
    const d = db({}); mt.log.length = 0;
    const r = await baca(await Q.handleNotifikasi(req({ order_id: 'X', status_code: '200', gross_amount: '149000.00', signature_key: 'ab' }, { jwt: '' }), deps(d.fetcher)));
    truthy(r.status === 401 && d.calls.length === 0 && mt.log.length === 0, `401, 0 panggilan (${r.status}, ${d.calls.length}, ${mt.log.length})`);
  });

  await t('Notifikasi sah: Get Status dari Midtrans, database menerima ringkasan Get Status (bukan isi notifikasi) + rahasia', async () => {
    const c = await (await fetch(`${MT}/v2/charge`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${mt.serverKey}:`).toString('base64')}` }, body: JSON.stringify({ payment_type: 'qris', transaction_details: { order_id: 'CU-N1-1', gross_amount: 149000 } }) })).json();
    mt.bayar('CU-N1-1');
    const d = db({ gateway_terapkan_status: () => 'aktif' }); mt.log.length = 0;
    // Notifikasi dipalsukan berisi status 'settlement' dengan nominal lain, tetapi signature dihitung atas field asli → ditolak;
    // notifikasi asli diterima dan nilai yang diteruskan berasal dari Get Status.
    const asli = mt.notifikasi('CU-N1-1');
    const r = await baca(await Q.handleNotifikasi(req(asli, { jwt: '' }), deps(d.fetcher)));
    truthy(r.status === 200 && r.body.hasil === 'aktif', `200 aktif (${r.status} ${JSON.stringify(r.body)})`);
    truthy(mt.log.includes('GET /v2/CU-N1-1/status'), 'Get Status dipanggil');
    const a = d.calls[0];
    truthy(a.nama === 'gateway_terapkan_status' && a.args.p_rahasia === RAHASIA && a.args.p_status.transaction_id === c.transaction_id && a.args.p_status.transaction_status === 'settlement' && !('signature_key' in a.args.p_status), 'argumen database = ringkasan Get Status');
    truthy(a.auth === `Bearer ${ANON}` && a.apikey === ANON, 'database dipanggil dengan anon key (tanpa service_role)');
  });

  await t('Notifikasi: Midtrans putus → 502; database gagal → 500 (agar Midtrans mengirim ulang)', async () => {
    const notif = mt.notifikasi('CU-N1-1');
    mt.gagalkanBerikutnya(/status$/, 'putus');
    let r = await baca(await Q.handleNotifikasi(req(notif, { jwt: '' }), deps(db({}).fetcher)));
    truthy(r.status === 502, `Midtrans putus → 502 (${r.status})`);
    r = await baca(await Q.handleNotifikasi(req(notif, { jwt: '' }), deps(db({ gateway_terapkan_status: () => { throw Object.assign(new Error('could not serialize'), { status: 500 }); } }).fetcher)));
    truthy(r.status === 500 && !/serialize/.test(r.body.error), `database gagal → 500 tanpa pesan teknis (${r.status} ${r.body.error})`);
    r = await baca(await Q.handleNotifikasi(req(null, { jwt: '', method: 'GET' }), deps(db({}).fetcher)));
    truthy(r.status === 405, 'GET → 405');
    r = await baca(await Q.handleNotifikasi(req(notif, { jwt: '' }), { env: { SUPABASE_URL: SUPA }, fetch: db({}).fetcher, log: () => {} }));
    truthy(r.status === 503 && /belum dikonfigurasi/.test(r.body.error), 'tanpa konfigurasi → 503 pesan jelas');
  });

  await t('Buat QR: wajib login; QR berjalan dipakai ulang tanpa charge baru', async () => {
    let r = await baca(await Q.handleBuat(req({ pesanan: 3 }, { jwt: '' }), deps(db({}).fetcher)));
    truthy(r.status === 401, 'tanpa JWT → 401');
    r = await baca(await Q.handleBuat(req({ pesanan: 3 }, { jwt: ANON }), deps(db({}).fetcher)));
    truthy(r.status === 401, 'JWT = anon key → 401');
    const g = percobaan({ status: 'menunggu', qr_url: 'https://api.sandbox.midtrans.com/v2/qris/x/qr-code' });
    const d = db({ gateway_mulai_percobaan: () => ({ aksi: 'pakai', percobaan: g }) }); mt.log.length = 0;
    r = await baca(await Q.handleBuat(req({ pesanan: 3 }), deps(d.fetcher)));
    truthy(r.status === 200 && r.body.percobaan.qr_url === g.qr_url && mt.log.length === 0, 'pakai → tanpa charge');
    truthy(d.calls[0].auth === `Bearer ${JWT}`, 'mulai_percobaan memakai JWT pembeli');
    r = await baca(await Q.handleBuat(req({ pesanan: 3 }), deps(db({ gateway_mulai_percobaan: () => ({ aksi: 'pakai', percobaan: percobaan() }) }).fetcher)));
    truthy(r.status === 409, 'QR masih dibuat → 409 coba lagi');
    r = await baca(await Q.handleBuat(req({ pesanan: 'abc' }), deps(db({}).fetcher)));
    truthy(r.status === 400, 'pesanan tidak valid → 400');
  });

  await t('Buat QR baru: nominal & masa berlaku dari database (bukan browser), charge QRIS 15 menit, hasil disimpan dengan rahasia', async () => {
    const g = percobaan({ gateway_order_id: 'CU-B1-1' });
    const d = db({ gateway_mulai_percobaan: () => ({ aksi: 'baru', percobaan: g, qr_menit: 15 }),
      gateway_simpan_qr: (a) => ({ ...g, status: a.p_hasil.ok ? 'menunggu' : 'gagal', qr_url: a.p_hasil.qr_url, gateway_txn_id: a.p_hasil.gateway_txn_id }) });
    const r = await baca(await Q.handleBuat(req({ pesanan: 3, amount: 1, harga: 1 }), deps(d.fetcher)));
    truthy(r.status === 200 && r.body.status === 'menunggu' && /qr-code$/.test(r.body.percobaan.qr_url), `200 + QR (${r.status} ${JSON.stringify(r.body)})`);
    const body = mt.trx.get('CU-B1-1').body;
    truthy(body.transaction_details.gross_amount === 149000 && body.item_details[0].price === 149000 && body.qris.acquirer === 'gopay', 'nominal 149000 dari database; amount browser diabaikan');
    truthy(body.custom_expiry.expiry_duration === 15 && body.custom_expiry.unit === 'minute' && !body.customer_details, 'berlaku 15 menit; tanpa data pembeli');
    const s = d.calls.find((c) => c.nama === 'gateway_simpan_qr');
    truthy(s.args.p_rahasia === RAHASIA && s.args.p_hasil.ok === true && s.auth === `Bearer ${ANON}`, 'simpan_qr dengan rahasia + anon key');
  });

  await t('Buat QR: charge gagal/terputus → percobaan ditandai gagal, 502, tanpa QR palsu', async () => {
    for (const mode of ['500', 'putus']) {
      const g = percobaan({ gateway_order_id: `CU-F${mode}-1` });
      const d = db({ gateway_mulai_percobaan: () => ({ aksi: 'baru', percobaan: g, qr_menit: 15 }), gateway_simpan_qr: (a) => ({ ...g, status: a.p_hasil.ok ? 'menunggu' : 'gagal' }) });
      mt.gagalkanBerikutnya(/charge$/, mode);
      const r = await baca(await Q.handleBuat(req({ pesanan: 3 }), deps(d.fetcher)));
      const s = d.calls.find((c) => c.nama === 'gateway_simpan_qr');
      truthy(r.status === 502 && s && s.args.p_hasil.ok === false && !r.body.percobaan, `${mode}: 502 + simpan ok:false (${r.status})`);
    }
  });

  await t('Buat QR saat QR lama lewat waktu: cek status, batalkan yang masih pending, baru buat QR baru', async () => {
    await fetch(`${MT}/v2/charge`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${mt.serverKey}:`).toString('base64')}` }, body: JSON.stringify({ payment_type: 'qris', transaction_details: { order_id: 'CU-C1-1', gross_amount: 149000 } }) });
    let ke = 0; const lama = percobaan({ gateway_order_id: 'CU-C1-1', status: 'menunggu', berlaku_sampai: new Date(Date.now() - 1000).toISOString() });
    const baru = percobaan({ id: 8, gateway_order_id: 'CU-C1-2' });
    const d = db({ gateway_mulai_percobaan: () => (++ke === 1 ? { aksi: 'cek', percobaan: lama } : { aksi: 'baru', percobaan: baru, qr_menit: 15 }),
      gateway_terapkan_status: (a) => a.p_status.transaction_status, gateway_simpan_qr: (a) => ({ ...baru, status: 'menunggu', qr_url: a.p_hasil.qr_url }) });
    mt.log.length = 0;
    const r = await baca(await Q.handleBuat(req({ pesanan: 3 }), deps(d.fetcher)));
    truthy(r.status === 200 && mt.log.join() === 'GET /v2/CU-C1-1/status,POST /v2/CU-C1-1/cancel,GET /v2/CU-C1-1/status,POST /v2/charge', `urutan Midtrans: ${mt.log.join()}`);
    truthy(d.calls.find((c) => c.nama === 'gateway_terapkan_status').args.p_status.transaction_status === 'cancel', 'QR lama tercatat batal sebelum QR baru');
  });

  await t('Cek status: tanpa paksa dan baru dicek → tidak menanyai Midtrans; paksa → Get Status', async () => {
    const g = percobaan({ gateway_order_id: 'CU-C1-2', status: 'menunggu', dicek_pada: new Date().toISOString() });
    const info = { pesanan: { id: 3, status: 'baru' }, pro: false, percobaan: g };
    const d = db({ gateway_percobaan_saya: () => info, gateway_terapkan_status: () => 'menunggu' }); mt.log.length = 0;
    let r = await baca(await Q.handleCek(req({ pesanan: 3 }), deps(d.fetcher)));
    truthy(r.status === 200 && mt.log.length === 0, 'tanpa paksa → hanya database');
    r = await baca(await Q.handleCek(req({ pesanan: 3, paksa: true }), deps(d.fetcher)));
    truthy(r.status === 200 && mt.log.includes('GET /v2/CU-C1-2/status'), 'paksa → Get Status');
  });

  await t('Refund admin: kunci refund dari database, Refund API, lalu dicatat dari Get Status', async () => {
    mt.bayar('CU-N1-1');
    const d = db({ admin_refund_gateway_siapkan: () => ({ gateway_order_id: 'CU-N1-1', refund_key: 'RF-5-1', nominal: 149000, alasan: 'uji' }),
      gateway_terapkan_status: (a) => (a.p_status.transaction_status === 'refund' && a.p_status.refunds[0].refund_key === 'RF-5-1' ? 'direfund' : 'salah') });
    let r = await baca(await Q.handleRefund(req({ pembayaran: 5, nominal: 149000, alasan: 'uji' }), deps(d.fetcher)));
    truthy(r.status === 200 && r.body.hasil === 'direfund', `refund → direfund (${r.status} ${JSON.stringify(r.body)})`);
    truthy(d.calls[0].auth === `Bearer ${JWT}`, 'siapkan refund memakai JWT admin (is_admin dicek database)');
    r = await baca(await Q.handleRefund(req({ pembayaran: 5, nominal: 149000, alasan: 'uji' }), deps(d.fetcher)));
    truthy(r.status === 200 && mt.trx.get('CU-N1-1').refunds.length === 1, 'kunci refund sama → tidak ada refund kedua');
    const d2 = db({ admin_refund_gateway_siapkan: () => { throw Object.assign(new Error('Hanya admin'), { status: 400 }); } });
    r = await baca(await Q.handleRefund(req({ pembayaran: 5, nominal: 1, alasan: 'uji' }), deps(d2.fetcher)));
    truthy(r.status === 400 && r.body.error === 'Hanya admin', 'bukan admin → ditolak database');
  });

  await t('URL QR: hanya https dari host API Midtrans; selain itu tidak disimpan (dan server tidak pernah mengambilnya)', async () => {
    const sb = Q.bacaKonfigurasi({ ...env, MIDTRANS_ENV: 'sandbox', MIDTRANS_SERVER_KEY: 'SB-Mid-server-abc' });
    truthy(Q.urlQrSah('https://api.sandbox.midtrans.com/v2/qris/abc/qr-code', sb), 'host sandbox diterima');
    for (const u of ['http://api.sandbox.midtrans.com/v2/qris/a', 'https://api.sandbox.midtrans.com.evil.id/a', 'https://evil.id/a', 'javascript:alert(1)',
      'https://user:pw@api.sandbox.midtrans.com/a', 'https://api.sandbox.midtrans.com:8443/a', 'data:image/png;base64,AAA', '']) truthy(!Q.urlQrSah(u, sb), `ditolak: ${u}`);
    const pr = Q.bacaKonfigurasi({ ...env, MIDTRANS_ENV: 'production', MIDTRANS_SERVER_KEY: 'Mid-server-abc' });
    truthy(Q.urlQrSah('https://api.midtrans.com/v2/qris/a/qr-code', pr) && !Q.urlQrSah('https://api.sandbox.midtrans.com/v2/qris/a', pr), 'produksi hanya api.midtrans.com');
  });

  await t('Checkout tamu: validasi input; Snap hanya QRIS, nominal dari database, tanpa data pembeli, kembali ke situs', async () => {
    const d0 = db({});
    for (const [body, pesan] of [[{ nama: 'Ani', email: 'bukan' }, /Email/], [{ nama: 'A', email: 'a@b.id' }, /Nama/], [{ nama: 'Ani', email: 'a@b.id', whatsapp: '12345' }, /WhatsApp/]]) {
      const r = await baca(await Q.handleTamuCheckout(req(body, { jwt: '' }), deps(d0.fetcher)));
      truthy(r.status === 400 && pesan.test(r.body.error), `input salah → 400 (${JSON.stringify(body)})`);
    }
    truthy(d0.calls.length === 0, 'input salah tidak menyentuh database');
    truthy(Q.normalWa('0812-3456-7890') === '+6281234567890' && Q.normalWa('') === '' && Q.normalWa('+6281234567890') === '+6281234567890' && Q.normalWa('021555') === null, 'normalisasi WhatsApp');
    const t0 = { id: 11, kode: 'CT-ABCD1234', amount: 149000, status: 'dibuat', berlaku_sampai: new Date(Date.now() + 15 * 60000).toISOString(), email: 'x@y.id' };
    const d = db({ tamu_buat_pesanan: () => ({ aksi: 'baru', pesanan: t0, qr_menit: 15 }),
      tamu_simpan_snap: (a) => ({ ...t0, status: a.p_hasil.ok ? 'menunggu' : 'gagal', snap_url: a.p_hasil.snap_url, email_status: 'belum' }) });
    const r = await baca(await Q.handleTamuCheckout(req({ nama: ' Ani  Wijaya ', email: 'Ani@Contoh.ID', whatsapp: '0812 3456 7890', amount: 1 }, { jwt: '' }), deps(d.fetcher)));
    truthy(r.status === 200 && r.body.kode === 'CT-ABCD1234' && /\/snap\/v4\/redirection\//.test(r.body.snap_url) && !('email' in r.body), `200 + URL Snap, tanpa email di respons (${JSON.stringify(r.body)})`);
    const a = d.calls.find((c) => c.nama === 'tamu_buat_pesanan').args;
    truthy(a.p_email === 'ani@contoh.id' && a.p_nama === 'Ani Wijaya' && a.p_whatsapp === '+6281234567890' && a.p_rahasia === RAHASIA, 'argumen dinormalkan + rahasia');
    const sb = mt.trx.get('CT-ABCD1234').body;
    truthy(sb.transaction_details.gross_amount === 149000 && sb.enabled_payments.join() === 'other_qris' && sb.expiry.duration === 15 && sb.expiry.unit === 'minutes'
      && sb.callbacks.finish === 'https://feature-pro-pricing.cekuntung.pages.dev/akun?view=bayar' && !sb.customer_details, 'Snap: QRIS saja, Rp dari database, 15 menit, kembali ke situs, tanpa data pembeli');
    const sbCfg = Q.bacaKonfigurasi({ ...env, MIDTRANS_ENV: 'sandbox', MIDTRANS_SERVER_KEY: 'SB-Mid-server-abc' });
    truthy(Q.urlSnapSah('https://app.sandbox.midtrans.com/snap/v4/redirection/x', sbCfg) && !Q.urlSnapSah('https://app.sandbox.midtrans.com.jahat.id/x', sbCfg) && !Q.urlSnapSah('https://api.sandbox.midtrans.com/x', sbCfg), 'URL Snap hanya dari host Snap Midtrans');
  });

  await t('Notifikasi checkout tamu lunas → tautan aktivasi (OTP Supabase, anon key); gagal kirim tetap 200 dan tercatat', async () => {
    await fetch(`${MT}/snap/v1/transactions`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${mt.serverKey}:`).toString('base64')}` }, body: JSON.stringify({ transaction_details: { order_id: 'CT-NOTIF001', gross_amount: 149000 } }) });
    mt.bayar('CT-NOTIF001');
    for (const otpStatus of [200, 500]) {
      const d = db({ otpStatus, gateway_terapkan_status: () => 'lunas_tamu', tamu_perlu_email: () => ({ id: 21, email: 'ani@contoh.id' }), tamu_catat_email: () => null });
      const r = await baca(await Q.handleNotifikasi(req(mt.notifikasi('CT-NOTIF001'), { jwt: '' }), deps(d.fetcher)));
      const otp = d.calls.find((c) => c.nama === 'otp'), cat = d.calls.find((c) => c.nama === 'tamu_catat_email');
      truthy(r.status === 200 && r.body.hasil === 'lunas_tamu', `${otpStatus}: notifikasi tetap 200`);
      truthy(otp && otp.body.email === 'ani@contoh.id' && otp.body.create_user === true && otp.apikey === ANON
        && decodeURIComponent(otp.url).endsWith('redirect_to=https://feature-pro-pricing.cekuntung.pages.dev/akun?view=aktivasi'), `${otpStatus}: OTP dikirim ke email pesanan, kembali ke halaman aktivasi`);
      truthy(cat && cat.args.p_ok === (otpStatus === 200) && cat.args.p_pesan === `HTTP ${otpStatus}`, `${otpStatus}: hasil pengiriman tercatat`);
    }
  });

  await t('Status tamu: kode/email salah format → 404 tanpa database; kode+email dicek database', async () => {
    const d = db({ tamu_status: () => null });
    let r = await baca(await Q.handleTamuStatus(req({ kode: "CT-1' or 1=1", email: 'a@b.id' }, { jwt: '' }), deps(d.fetcher)));
    truthy(r.status === 404 && d.calls.length === 0, 'format salah → 404 tanpa database');
    r = await baca(await Q.handleTamuStatus(req({ kode: 'CT-ABCD1234', email: 'orang@lain.id' }, { jwt: '' }), deps(d.fetcher)));
    truthy(r.status === 404 && d.calls[0].args.p_email === 'orang@lain.id', 'kode + email tidak cocok → 404');
  });

  await t('CORS: hanya origin terdaftar; OPTIONS 204', async () => {
    const d = db({ gateway_percobaan_saya: () => ({ pesanan: { id: 3 }, percobaan: null }) });
    const ok = await Q.handleCek(req({ pesanan: 3 }, { origin: 'https://feature-pro-pricing.cekuntung.pages.dev' }), deps(d.fetcher));
    const lain = await Q.handleCek(req({ pesanan: 3 }, { origin: 'https://jahat.example' }), deps(d.fetcher));
    const pre = await Q.handleCek(new Request('https://fungsi.uji/x', { method: 'OPTIONS', headers: { Origin: 'https://feature-pro-pricing.cekuntung.pages.dev' } }), deps(d.fetcher));
    truthy(ok.headers.get('Access-Control-Allow-Origin') === 'https://feature-pro-pricing.cekuntung.pages.dev' && !lain.headers.get('Access-Control-Allow-Origin') && pre.status === 204, 'CORS');
  });

  await t('Rahasia tidak pernah muncul di respons atau log', async () => {
    const semua = logs.join('\n');
    truthy(!semua.includes(mt.serverKey) && !semua.includes(RAHASIA) && !semua.includes(JWT), 'log bersih dari server key, rahasia, dan JWT');
  });

  mt.server.close();
  console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
  process.exitCode = failed ? 1 : 0;
})();
