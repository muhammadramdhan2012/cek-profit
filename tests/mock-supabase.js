/* Server tiruan Supabase (Auth + REST) untuk uji lokal. Bukan untuk produksi.
 * Jalankan: node tests/mock-supabase.js 54321
 * Meniru aturan keamanan utama di supabase/schema.sql (baca/tulis milik sendiri, admin, kolom terbatas).
 */
const http = require('http');
const crypto = require('crypto');

function createMock({ confirmEmail = false, tokenTtl = 3600 } = {}) {
  const users = new Map();      // id → {id,email,password,meta}
  const tokens = new Map();     // access → {uid, exp}
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
    profiles.set(id, { id, email, full_name: meta.full_name || meta.name || '', store_name: '', whatsapp: '', pro_until: null, is_admin: false, created_at: new Date().toISOString() });
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
      if (!body.password || body.password.length < 8) return send(422, { msg: 'Password should be at least 8 characters.' });
      const id = addUser(body.email, body.password, body.data || {});
      return confirmEmail ? send(200, { id, email: body.email }) : send(200, issue(id));
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'password') {
      const u = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
      if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      if (!u.confirmed) return send(400, { error_description: 'Email not confirmed' });
      return send(200, issue(u.id));
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'refresh_token') {
      const id = refresh.get(body.refresh_token); refresh.delete(body.refresh_token);
      return id ? send(200, issue(id)) : send(400, { error_description: 'Invalid Refresh Token' });
    }
    if (p === '/auth/v1/user') {
      if (!uid) return send(401, { message: 'invalid JWT' });
      if (req.method === 'PUT') users.get(uid).password = body.password;
      const u = users.get(uid); return send(200, { id: uid, email: u.email, user_metadata: u.meta });
    }
    if (p === '/auth/v1/logout') { tokens.delete(bearer); return send(204); }
    if (p === '/auth/v1/recover') return send(200, {});
    if (p === '/auth/v1/authorize') {
      let u = [...users.values()].find((x) => x.email === 'google@contoh.id');
      const id = u ? u.id : addUser('google@contoh.id', crypto.randomUUID(), { name: 'Pengguna Google' });
      users.get(id).confirmed = true;
      const s = issue(id);
      res.writeHead(302, { Location: `${q.get('redirect_to')}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=${s.expires_in}&token_type=bearer` });
      return res.end();
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
      if (req.method === 'GET') return send(200, requests.filter((r) => r.user_id === uid || isAdmin(uid)).slice().reverse());
      if (req.method === 'POST') { const r = { id: reqSeq++, user_id: uid, plan: body.plan, note: body.note || '', status: 'baru', created_at: new Date().toISOString() }; requests.push(r); return send(201, [r]); }
      if (req.method === 'PATCH') { if (!isAdmin(uid)) return send(200, []); const r = requests.find((x) => x.id === +eq('id')); if (r) r.status = body.status; return send(204); }
    }
    if (table === 'rpc/admin_set_pro') {
      if (!isAdmin(uid)) return send(400, { message: 'Hanya admin' });
      const r = profiles.get(body.target); if (r) r.pro_until = body.until;
      if (body.until) requests.filter((x) => x.user_id === body.target && ['baru', 'diproses'].includes(x.status)).forEach((x) => { x.status = 'selesai'; });
      return send(200, null);
    }
    return send(404, { message: 'not found' });
  });
  return { server, users, profiles, userData, reports, requests, addUser, makeAdmin: (email) => { const u = [...users.values()].find((x) => x.email === email); profiles.get(u.id).is_admin = true; }, confirmAll: () => users.forEach((u) => { u.confirmed = true; }), today };
}
module.exports = createMock;
if (require.main === module) {
  const port = +process.argv[2] || 54321;
  const m = createMock();
  m.addUser('admin@contoh.id', 'rahasia123', { full_name: 'Admin' }); m.makeAdmin('admin@contoh.id');
  m.server.listen(port, () => console.log(`Mock Supabase di http://127.0.0.1:${port} (admin@contoh.id / rahasia123)`));
}
