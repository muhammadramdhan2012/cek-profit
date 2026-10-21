/* Server tiruan Supabase (Auth + REST) untuk uji lokal. Bukan untuk produksi.
 * Jalankan: node tests/mock-supabase.js 54321
 * Meniru aturan keamanan utama di supabase/schema.sql (baca/tulis milik sendiri, admin, kolom terbatas).
 */
const http = require('http');
const crypto = require('crypto');

// strongPasswords: meniru pengaturan Supabase yang direkomendasikan (min. 8, huruf kecil, kapital, angka) untuk daftar
// dan ganti sandi. Masuk dengan sandi lama yang lemah TETAP berhasil, dengan penanda weak_password (meniru Supabase
// Auth; perilaku server sungguhan tetap harus diuji di Supabase).
// proMigrasi: meniru database SETELAH supabase/usulan/pro-sekali-bayar.sql v2 (pesanan, buku besar, fungsi admin).
// false = database produksi saat ini (tabel/fungsi belum ada → 404).
function createMock({ confirmEmail = false, tokenTtl = 3600, strongPasswords = false, proMigrasi = true } = {}) {
  const proPayments = [], events = [];
  const pengaturan = { id: 1, aktif: false, harga_pro: 149000, batas_hari: 3, bank_nama: '', bank_nomor: '', bank_pemilik: '', qris_merchant: '', qris_nmid: '', qris_gambar: '', kontak_bantuan: '' };
  let paySeq = 1;
  const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const weak = (pw) => !pw || pw.length < 8 || (strongPasswords && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)));
  const weakMsg = (pw) => (!pw || pw.length < 8 ? 'Password should be at least 8 characters.' : 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.');
  const signupBodies = [];
  const users = new Map();      // id → {id,email,password,meta}
  const tokens = new Map();     // access → {uid, exp}
  const codes = new Map();      // kode PKCE → {id, challenge, method}
  const refresh = new Map();    // refresh → uid
  const profiles = new Map(), userData = new Map(), reports = [], requests = [];
  let reqSeq = 1;
  const today = () => new Date().toISOString().slice(0, 10);
  const issue = (uid) => {
    const access = crypto.randomBytes(16).toString('hex'), rt = crypto.randomBytes(16).toString('hex');
    tokens.set(access, { uid, exp: Date.now() / 1000 + tokenTtl }); refresh.set(rt, uid);
    const u = users.get(uid);
    return { access_token: access, refresh_token: rt, token_type: 'bearer', expires_in: tokenTtl, expires_at: Math.floor(Date.now() / 1000) + tokenTtl, user: { id: uid, email: u.email, user_metadata: u.meta } };
  };
  const addUser = (email, password, meta = {}) => {
    const id = crypto.randomUUID();
    users.set(id, { id, email, password, meta, confirmed: !confirmEmail });
    profiles.set(id, { id, email, full_name: meta.full_name || meta.name || '', store_name: '', whatsapp: '', pro_until: null, is_admin: false, created_at: new Date().toISOString(), ...(proMigrasi ? { pro_sekali_bayar: false } : {}) });
    return id;
  };
  const isAdmin = (uid) => !!(profiles.get(uid) || {}).is_admin;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, extra = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', ...extra });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (!req.headers.apikey && !req.url.startsWith('/auth/v1/authorize')) return send(401, { message: 'No API key found in request' });
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const tok = tokens.get(bearer);
    if (tok && tok.exp < Date.now() / 1000) return send(401, { message: 'JWT expired' });
    const uid = tok ? tok.uid : null;
    const p = url.pathname, q = url.searchParams;

    /* ---- auth ---- */
    if (p === '/auth/v1/signup') {
      if ([...users.values()].some((u) => u.email === body.email)) return send(422, { msg: 'User already registered' });
      signupBodies.push(body);
      if (weak(body.password)) return send(422, { code: 'weak_password', msg: weakMsg(body.password) });
      const id = addUser(body.email, body.password, body.data || {});
      return confirmEmail ? send(200, { id, email: body.email }) : send(200, issue(id));
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'password') {
      const u = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
      if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      if (!u.confirmed) return send(400, { error_description: 'Email not confirmed' });
      const s = issue(u.id);
      if (weak(u.password)) s.weak_password = { reasons: ['characters'] };
      return send(200, s);
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'refresh_token') {
      const id = refresh.get(body.refresh_token); refresh.delete(body.refresh_token);
      return id ? send(200, issue(id)) : send(400, { error_description: 'Invalid Refresh Token' });
    }
    if (p === '/auth/v1/user') {
      if (!uid) return send(401, { message: 'invalid JWT' });
      if (req.method === 'PUT' && body.password !== undefined) {
        if (weak(body.password)) return send(422, { code: 'weak_password', msg: weakMsg(body.password) });
        users.get(uid).password = body.password;
      }
      if (req.method === 'PUT' && body.data) {
        const meta = users.get(uid).meta;
        for (const [k, v] of Object.entries(body.data)) { if (v === null) delete meta[k]; else meta[k] = v; }
      }
      const u = users.get(uid); return send(200, { id: uid, email: u.email, user_metadata: u.meta });
    }
    if (p === '/auth/v1/logout') { tokens.delete(bearer); return send(204); }
    if (p === '/auth/v1/recover') return send(200, {});
    if (p === '/auth/v1/authorize') {
      // Tiruan penyedia Google. mock_error = pengguna membatalkan; mock_email = akun Google yang dipakai. Email yang sudah
      // terdaftar memakai ID pengguna yang sama (meniru penautan identitas otomatis Supabase untuk email terverifikasi —
      // perilaku server sungguhan tetap harus diuji di Supabase).
      const back = new URL(q.get('redirect_to'));
      if (q.get('mock_error')) { back.searchParams.set('error', q.get('mock_error')); back.searchParams.set('error_description', 'User cancelled'); res.writeHead(302, { Location: back.toString() }); return res.end(); }
      const email = q.get('mock_email') || 'google@contoh.id';
      let u = [...users.values()].find((x) => x.email === email);
      const id = u ? u.id : addUser(email, crypto.randomUUID(), { name: 'Pengguna Google', full_name: 'Pengguna Google' });
      users.get(id).confirmed = true;
      if (q.get('code_challenge')) {
        const code = crypto.randomUUID(); codes.set(code, { id, challenge: q.get('code_challenge'), method: q.get('code_challenge_method') });
        back.searchParams.set('code', code); res.writeHead(302, { Location: back.toString() }); return res.end();
      }
      const s = issue(id);
      res.writeHead(302, { Location: `${q.get('redirect_to')}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=${s.expires_in}&token_type=bearer` });
      return res.end();
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'pkce') {
      const c = codes.get(body.auth_code); codes.delete(body.auth_code);   // kode hanya sekali pakai
      if (!c) return send(404, { error_description: 'invalid flow state, no valid flow state found' });
      const ch = crypto.createHash('sha256').update(String(body.code_verifier || '')).digest('base64url');
      if (c.method !== 's256' || ch !== c.challenge) return send(400, { error_description: 'code challenge does not match previously saved code verifier' });
      return send(200, issue(c.id));
    }

    /* ---- REST ---- */
    if (!p.startsWith('/rest/v1/')) return send(404, { message: 'not found' });
    if (!uid) return send(401, { message: 'permission denied' });
    const eq = (k) => (q.get(k) || '').replace(/^eq\./, '');
    const table = p.slice('/rest/v1/'.length);
    if (table === 'profiles') {
      if (req.method === 'GET') return send(200, [...profiles.values()].filter((r) => (eq('id') ? r.id === eq('id') : true) && (r.id === uid || isAdmin(uid))));
      if (req.method === 'PATCH') {
        if (Object.keys(body).some((k) => !['full_name', 'store_name', 'whatsapp'].includes(k))) return send(403, { message: 'permission denied for table profiles' });
        const r = profiles.get(eq('id'));
        if (!r || r.id !== uid) return send(200, []);
        Object.assign(r, body); return send(200, [r]);
      }
    }
    if (table === 'user_data') {
      if (req.method === 'GET') { const r = userData.get(uid); return send(200, r ? [r] : []); }
      if (req.method === 'POST') {
        if (body.user_id && body.user_id !== uid) return send(403, { message: 'new row violates row-level security policy' });
        userData.set(uid, { user_id: uid, settings: body.settings || {}, profile: body.profile || {}, updated_at: body.updated_at });
        return send(201);
      }
    }
    if (table === 'reports') {
      if (req.method === 'GET') return send(200, reports.filter((r) => r.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at)));
      if (req.method === 'POST') { const r = { id: crypto.randomUUID(), user_id: uid, created_at: new Date().toISOString(), ...body }; reports.push(r); return send(201, [r]); }
      if (req.method === 'DELETE') { const i = reports.findIndex((r) => r.id === eq('id') && r.user_id === uid); if (i >= 0) reports.splice(i, 1); return send(204); }
    }
    if (table === 'upgrade_requests') {
      if (req.method === 'GET') return send(200, requests.filter((r) => (r.user_id === uid || isAdmin(uid)) && (!eq('plan') || r.plan === eq('plan'))).slice().reverse());
      // Setelah migrasi v2 seller tidak boleh menulis langsung (hanya lewat fungsi).
      if (proMigrasi && ['POST', 'PATCH'].includes(req.method)) return send(403, { code: '42501', message: 'permission denied for table upgrade_requests' });
      if (req.method === 'POST') { const r = { id: reqSeq++, user_id: uid, plan: body.plan, note: body.note || '', status: 'baru', created_at: new Date().toISOString() }; requests.push(r); return send(201, [r]); }
      if (req.method === 'PATCH') { if (!isAdmin(uid)) return send(200, []); const r = requests.find((x) => x.id === +eq('id')); if (r) r.status = body.status; return send(204); }
    }
    if (['pengaturan_pembayaran', 'pro_order_events', 'pro_payments'].includes(table) && !proMigrasi) return send(404, { code: '42P01', message: `relation "public.${table}" does not exist` });
    if (table === 'pengaturan_pembayaran' && req.method === 'GET') return send(200, [pengaturan]);
    if (table === 'pro_order_events' && req.method === 'GET') {
      return send(200, events.filter((e) => e.order_id === +eq('order_id') && (isAdmin(uid) || (requests.find((r) => r.id === e.order_id) || {}).user_id === uid)));
    }
    if (table === 'pro_payments' && req.method === 'GET') return send(200, proPayments.filter((x) => x.user_id === uid || isAdmin(uid)).slice().reverse());
    if (table.startsWith('rpc/') && table !== 'rpc/admin_set_pro') {
      if (!proMigrasi) return send(404, { code: 'PGRST202', message: `Could not find the function public.${table.slice(4)} in the schema cache` });
      const err = (m, code = 400) => send(code, { message: m });
      const ev = (r, lama, baru, cat) => events.push({ order_id: r.id, status_lama: lama, status_baru: baru, oleh: uid, catatan: cat, waktu: new Date().toISOString() });
      const fn = table.slice(4);
      const tersedia = (m) => (m === 'transfer' ? !!(pengaturan.bank_nama && pengaturan.bank_nomor && pengaturan.bank_pemilik) : m === 'qris' ? !!(pengaturan.qris_merchant && pengaturan.qris_gambar) : false);
      if (fn === 'buat_pesanan_pro') {
        if (!pengaturan.aktif) return err('Pembelian Pro belum dibuka');
        if (!tersedia(body.p_metode)) return err('Metode pembayaran tidak tersedia');
        if (profiles.get(uid).pro_sekali_bayar) return err('Akun Anda sudah Pro');
        requests.filter((r) => r.user_id === uid && r.plan === 'pro_sekali' && r.status === 'baru' && Date.now() - Date.parse(r.created_at) > pengaturan.batas_hari * 864e5)
          .forEach((r) => { r.status = 'dibatalkan'; ev(r, 'baru', 'dibatalkan', 'Kedaluwarsa: belum dibayar dalam batas waktu'); });
        let r = requests.find((x) => x.user_id === uid && x.plan === 'pro_sekali' && ['baru', 'diproses'].includes(x.status));
        if (r) { if (r.status === 'baru' && r.metode !== body.p_metode) { r.metode = body.p_metode; ev(r, 'baru', 'baru', `Metode diganti: ${body.p_metode}`); } return send(200, r); }
        r = { id: reqSeq++, user_id: uid, plan: 'pro_sekali', note: '', status: 'baru', created_at: new Date().toISOString(), order_code: `CU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, metode: body.p_metode, amount: pengaturan.harga_pro, claimed_at: null };
        requests.push(r); ev(r, null, 'baru', 'Pesanan dibuat'); return send(200, r);
      }
      if (fn === 'konfirmasi_sudah_bayar' || fn === 'batalkan_pesanan') {
        const r = requests.find((x) => x.id === +body.p_order && x.user_id === uid && x.plan === 'pro_sekali');
        if (!r) return err('Pesanan tidak ditemukan');
        if (fn === 'konfirmasi_sudah_bayar') {
          if (r.status === 'diproses') return send(200, r);
          if (r.status !== 'baru') return err('Status pesanan tidak dapat diubah');
          r.status = 'diproses'; r.claimed_at = new Date().toISOString(); ev(r, 'baru', 'diproses', `Pembeli menyatakan sudah membayar. ${String(body.p_catatan || '').slice(0, 300)}`); return send(200, r);
        }
        if (r.status !== 'baru') return err('Pesanan yang sudah dikonfirmasi dibayar hanya bisa dibatalkan oleh admin');
        r.status = 'dibatalkan'; ev(r, 'baru', 'dibatalkan', 'Dibatalkan pembeli'); return send(200, r);
      }
      if (!isAdmin(uid)) return err('Hanya admin');
      const r = requests.find((x) => x.id === +body.p_order);
      if (fn === 'admin_verifikasi_pesanan') {
        const ref = norm(body.p_referensi);
        if (!['transfer', 'qris'].includes(body.p_sumber)) return err('Sumber pembayaran harus transfer atau qris');
        if (ref.length < 3) return err('Referensi transaksi dari mutasi wajib diisi');
        if (!(body.p_nominal > 0)) return err('Nominal pembayaran wajib diisi');
        if (!r || r.plan !== 'pro_sekali') return err('Pesanan tidak ditemukan');
        if (r.status === 'selesai') return proPayments.some((x) => x.order_id === r.id && x.kind === 'pembayaran' && x.sumber === body.p_sumber && x.reference_norm === ref) ? send(200, 'sudah_aktif') : err('Pesanan sudah aktif. Untuk transfer ganda/kelebihan gunakan "Catat pembayaran tambahan"');
        if (r.status === 'direfund') return err('Pesanan sudah direfund');
        if (body.p_nominal < r.amount) return err('Nominal kurang dari tagihan. Pro tidak diaktifkan');
        if (profiles.get(r.user_id).pro_sekali_bayar) return err('Akun ini sudah Pro sekali bayar');
        if (proPayments.some((x) => x.kind === 'pembayaran' && x.sumber === body.p_sumber && x.reference_norm === ref)) return err('Referensi ini sudah tercatat untuk pembayaran lain');
        proPayments.push({ id: paySeq++, order_id: r.id, user_id: r.user_id, kind: 'pembayaran', sumber: body.p_sumber, reference: body.p_referensi, reference_norm: ref, amount: body.p_nominal, note: body.p_catatan || '', created_by: uid, created_at: new Date().toISOString() });
        profiles.get(r.user_id).pro_sekali_bayar = true; const lama = r.status; r.status = 'selesai'; ev(r, lama, 'selesai', `Dana terverifikasi (${body.p_sumber}, ${ref})`);
        return send(200, body.p_nominal > r.amount ? 'aktif_kelebihan' : 'aktif');
      }
      if (fn === 'admin_catat_pembayaran_tambahan') {
        if (!r) return err('Pesanan tidak ditemukan');
        if (String(body.p_catatan || '').trim().length < 3) return err('Keterangan wajib diisi');
        const ref = norm(body.p_referensi);
        if (proPayments.some((x) => x.kind === 'pembayaran' && x.sumber === body.p_sumber && x.reference_norm === ref)) return err('Referensi ini sudah tercatat untuk pembayaran lain');
        proPayments.push({ id: paySeq++, order_id: r.id, user_id: r.user_id, kind: 'pembayaran', sumber: body.p_sumber, reference: body.p_referensi, reference_norm: ref, amount: body.p_nominal, note: body.p_catatan, created_by: uid, created_at: new Date().toISOString() });
        ev(r, r.status, r.status, `Pembayaran tambahan dicatat: ${body.p_catatan}`); return send(200, null);
      }
      if (fn === 'admin_refund_pesanan') {
        if (!r) return err('Pesanan tidak ditemukan');
        if (String(body.p_alasan || '').trim().length < 3) return err('Alasan wajib diisi');
        const saldo = proPayments.filter((x) => x.order_id === r.id).reduce((a, x) => a + (x.kind === 'pembayaran' ? x.amount : x.kind === 'refund' ? -x.amount : 0), 0);
        if (!(body.p_nominal > 0) || body.p_nominal > saldo) return err(`Nominal refund harus 1 sampai ${saldo}`);
        proPayments.push({ id: paySeq++, order_id: r.id, user_id: r.user_id, kind: 'refund', amount: body.p_nominal, note: body.p_alasan, created_by: uid, created_at: new Date().toISOString() });
        if (body.p_cabut_pro) { profiles.get(r.user_id).pro_sekali_bayar = false; const lama = r.status; r.status = 'direfund'; ev(r, lama, 'direfund', `Refund ${body.p_nominal}, Pro dicabut: ${body.p_alasan}`); }
        else ev(r, r.status, r.status, `Refund sebagian/kelebihan ${body.p_nominal}: ${body.p_alasan}`);
        return send(200, null);
      }
      if (fn === 'admin_tolak_pesanan') {
        if (!r) return err('Pesanan tidak ditemukan');
        if (String(body.p_alasan || '').trim().length < 3) return err('Alasan wajib diisi');
        if (!['baru', 'diproses'].includes(r.status)) return err('Hanya pesanan yang belum selesai yang bisa ditolak');
        const lama = r.status; r.status = body.p_status || 'ditolak'; ev(r, lama, r.status, body.p_alasan); return send(200, null);
      }
      if (fn === 'admin_cabut_pro') {
        const pr = profiles.get(body.target);
        if (String(body.catatan || '').trim().length < 3) return err('Alasan wajib diisi');
        if (!pr || !pr.pro_sekali_bayar) return err('Akun ini tidak memiliki Pro sekali bayar');
        proPayments.push({ id: paySeq++, user_id: pr.id, kind: 'pencabutan', amount: 0, note: body.catatan, created_by: uid, created_at: new Date().toISOString() });
        pr.pro_sekali_bayar = false; return send(200, null);
      }
      return send(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
    }
    if (table === 'rpc/admin_set_pro') {
      if (!isAdmin(uid)) return send(400, { message: 'Hanya admin' });
      const r = profiles.get(body.target); if (r) r.pro_until = body.until;
      if (body.until) requests.filter((x) => x.user_id === body.target && ['baru', 'diproses'].includes(x.status)).forEach((x) => { x.status = 'selesai'; });
      return send(200, null);
    }
    return send(404, { message: 'not found' });
  });
  return { server, users, signupBodies, proPayments, events, pengaturan, profiles, userData, reports, requests, addUser, makeAdmin: (email) => { const u = [...users.values()].find((x) => x.email === email); profiles.get(u.id).is_admin = true; }, confirmAll: () => users.forEach((u) => { u.confirmed = true; }), today };
}
module.exports = createMock;
if (require.main === module) {
  const port = +process.argv[2] || 54321;
  const m = createMock();
  m.addUser('admin@contoh.id', 'rahasia123', { full_name: 'Admin' }); m.makeAdmin('admin@contoh.id');
  m.server.listen(port, () => console.log(`Mock Supabase di http://127.0.0.1:${port} (admin@contoh.id / rahasia123)`));
}
