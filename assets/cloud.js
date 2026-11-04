/* Cek Profit — klien akun & database (Supabase) tanpa dependensi.
 *
 * Memakai REST API Supabase langsung (Auth/GoTrue + PostgREST) dengan fetch, sehingga:
 *  - tidak perlu memuat pustaka besar dari CDN;
 *  - bisa diuji di Node dengan server tiruan (tests/cloud.test.js).
 *
 * Yang dikirim ke server HANYA: email/sandi saat login, profil, modal & pengaturan, ringkasan riwayat,
 * dan permintaan upgrade. File laporan dan data pembeli tidak pernah dikirim.
 *
 * Jika CEK_CONFIG.supabaseUrl kosong, CekCloud.enabled = false dan seluruh aplikasi tetap jalan lokal.
 */
const CekCloud = (() => {
  const SESSION_KEY = 'cekprofit.session';
  const PKCE_KEY = 'cekprofit.pkce';    // code_verifier login Google (sementara, dihapus setelah dipakai)
  let cfg = { url: '', key: '' };
  let session = null;               // {access_token, refresh_token, expires_at, user}
  let storage = null;              // localStorage: sesi "ingat saya" (bertahan setelah browser ditutup)
  let tabStorage = null;           // sessionStorage: sesi tanpa "ingat saya" (hilang saat tab/browser ditutup)
  let ingat = true;
  const INGAT_KEY = 'cekprofit.ingat';   // pilihan "ingat saya" selama alur login Google (sementara)
  /** Sesi otomatis berakhir bila website tidak dibuka selama ini (keputusan pemilik 4 Nov 2026). */
  const IDLE_HARI = 30;
  const listeners = new Set();
  let refreshing = null;

  const nowSec = () => Math.floor(Date.now() / 1000);
  const baca = (st) => { try { return JSON.parse(st.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } };
  /** Kunci yang sama (cekprofit.session) di salah satu tempat; localStorage didahulukan agar sesi lama tetap terbaca. */
  const read = () => { const s = baca(storage); if (s) { ingat = true; return s; } const t = baca(tabStorage); if (t) ingat = false; return t; };
  const write = (s) => {
    const [pakai, lain] = ingat ? [storage, tabStorage] : [tabStorage, storage];
    try { lain.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
    try { if (s) pakai.setItem(SESSION_KEY, JSON.stringify(s)); else pakai.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
  };
  const emit = () => listeners.forEach((fn) => { try { fn(session); } catch (e) { /* abaikan */ } });

  /** Pesan error Supabase → kalimat yang dimengerti pengguna. */
  function friendly(status, body) {
    const raw = (body && (body.error_description || body.msg || body.message || body.error)) || '';
    const m = String(raw).toLowerCase();
    if (m.includes('invalid login credentials')) return 'Email atau kata sandi salah.';
    if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk email Anda.';
    // Tidak menyebut apakah email terdaftar (mencegah enumerasi akun).
    if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists')) return 'Pendaftaran dengan email ini tidak dapat diproses. Jika Anda sudah punya akun, silakan masuk atau pakai "Lupa kata sandi".';
    if (m.includes('pwned') || m.includes('leaked') || m.includes('compromised')) return 'Kata sandi ini pernah bocor di situs lain. Silakan buat kata sandi lain.';
    if (m.includes('longer than 72')) return 'Kata sandi maksimal 72 karakter.';
    if (m.includes('should be different')) return 'Kata sandi baru harus berbeda dari kata sandi lama.';
    // Aturan sandi baru (sama dengan pengaturan Supabase yang direkomendasikan). Hanya untuk daftar/ganti sandi;
    // masuk dengan sandi lama tidak memakai pesan ini.
    if (m.includes('password should') || m.includes('weak')) return 'Kata sandi belum memenuhi syarat: minimal 8 karakter, ada huruf kapital, huruf kecil, dan angka.';
    if (m.includes('rate limit') || status === 429) return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
    if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Format email tidak valid.';
    if (m.includes('jwt expired')) return 'Sesi berakhir. Silakan masuk lagi.';
    if (m === 'access_denied') return 'Masuk dengan Google dibatalkan. Anda bisa mencoba lagi atau memakai email.';
    if (m === 'tautan_kedaluwarsa') return 'Tautan sudah tidak berlaku. Silakan minta tautan baru.';
    if (m === 'oauth_gagal') return 'Masuk dengan Google gagal. Silakan coba lagi beberapa saat lagi.';
    if (m.includes('code verifier') || m.includes('flow state') || m.includes('auth code')) return 'Proses masuk dengan Google kedaluwarsa. Silakan ulangi dari awal.';
    // Penolakan dari database (tahap 2), mis. batas riwayat akun gratis: pesannya sudah berbahasa Indonesia.
    const tolak = String(raw).match(/^BATAS_(?:RIWAYAT|MASUKAN):\s*(.+)$/);
    if (tolak) return tolak[1];
    if (status === 0) return 'Tidak bisa terhubung ke server. Periksa koneksi internet.';
    return raw || `Permintaan gagal (${status}).`;
  }
  class CloudError extends Error { constructor(status, body) { super(friendly(status, body)); this.status = status; this.body = body; } }

  async function http(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
    if (!cfg.url) throw new CloudError(0, { message: 'Akun belum diaktifkan di situs ini.' });
    if (auth) await ensureFresh();
    const h = { apikey: cfg.key, 'Content-Type': 'application/json', ...headers };
    if (auth && session) h.Authorization = `Bearer ${session.access_token}`;
    let res;
    try { res = await fetch(cfg.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new CloudError(0, {}); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      if (res.status === 401 && auth && session) { setSession(null); }
      throw new CloudError(res.status, data);
    }
    return data;
  }

  function setSession(s) {
    if (s && s.access_token) {
      session = { access_token: s.access_token, refresh_token: s.refresh_token,
        expires_at: s.expires_at || nowSec() + (Number(s.expires_in) || 3600), user: s.user || (session && session.user) || null, last_active: nowSec() };
    } else session = null;
    write(session);
    emit();
  }
  async function ensureFresh() {
    if (!session || !session.refresh_token) return;
    if (session.expires_at - nowSec() > 60) return;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false });
          setSession(s);
        } catch (e) { setSession(null); }
        finally { refreshing = null; }
      })();
    }
    await refreshing;
  }

  /** Website tidak dibuka lebih dari IDLE_HARI: sesi dihapus dari perangkat sekarang juga, lalu (bila online) dicabut di
   *  server. Token akses lama biasanya sudah kedaluwarsa, jadi diperbarui dulu sekali untuk bisa memanggil logout. */
  function akhiriSesiLama(lama) {
    session = null; write(null);
    if (!lama || !lama.refresh_token) return Promise.resolve();
    return (async () => {
      try {
        const s = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: lama.refresh_token } });
        if (s && s.access_token) await http('/auth/v1/logout?scope=local', { method: 'POST', auth: false, headers: { Authorization: `Bearer ${s.access_token}` } });
      } catch (e) { /* offline: sesi di perangkat sudah dihapus */ }
    })();
  }
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pkceStore = () => { try { if (typeof sessionStorage !== 'undefined') return sessionStorage; } catch (e) { /* abaikan */ } return storage; };
  /** Token baru dari URL dianggap sah hanya bila server mengenali penggunanya; bila tidak, sesi dihapus. */
  async function verifyUser() {
    try { session.user = await http('/auth/v1/user'); write(session); emit(); }
    catch (e) { setSession(null); throw new CloudError(e.status || 401, { message: 'Sesi tidak dapat diverifikasi. Silakan masuk lagi.' }); }
  }

  /* ---------- auth ---------- */
  const auth = {
    /**
     * Daftar. `whatsapp` (sudah dinormalkan +62…) ikut sebagai metadata pendaftaran karena dengan konfirmasi email belum
     * ada sesi untuk menulis ke profiles; akun.js menyalinnya ke profiles.whatsapp setelah masuk pertama, lalu
     * menghapusnya dari metadata. Kata sandi tidak pernah masuk metadata/profil.
     */
    async signUp({ email, password, fullName, whatsapp, redirectTo }) {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const data = { full_name: fullName || '' };
      if (whatsapp) data.whatsapp = whatsapp;
      const res = await http(`/auth/v1/signup${q}`, { method: 'POST', auth: false, body: { email, password, data } });
      if (res && res.access_token) { setSession(res); return { session: true }; }
      return { session: false, confirm: true };      // perlu konfirmasi email
    },
    /** `ingat` false: sesi disimpan di sessionStorage dan hilang saat tab/browser ditutup (komputer bersama). */
    async signIn({ email, password, ingat: ig = true }) {
      ingat = ig !== false;
      setSession(await http('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } }));
      return session;
    },
    oauthUrl(provider, redirectTo) {
      return `${cfg.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;
    },
    /**
     * Login Google dengan PKCE (alur resmi Supabase Auth): verifier acak disimpan sementara di sessionStorage, Supabase
     * mengembalikan ?code= yang hanya bisa ditukar dengan verifier itu. Tidak ada token di URL. Lingkup Google bawaan
     * Supabase (email, profil); tidak meminta akses Gmail/Drive.
     */
    async oauthStart(provider, redirectTo, { ingat: ig = true } = {}) {
      pkceStore().setItem(INGAT_KEY, ig === false ? '0' : '1');
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      pkceStore().setItem(PKCE_KEY, verifier);
      return `${this.oauthUrl(provider, redirectTo)}&code_challenge=${challenge}&code_challenge_method=s256`;
    },
    /**
     * Hasil kembali dari Supabase: ?code= (PKCE), #access_token= (tautan email / alur lama), atau ?error= / #error=.
     * Sesi baru dianggap sah hanya setelah /auth/v1/user berhasil; bila gagal, sesi dihapus.
     * @returns {Promise<null|{type: string}>}
     */
    async fromUrl({ search = '', hash = '' } = {}) {
      const q = new URLSearchParams(String(search).replace(/^\?/, '')), h = new URLSearchParams(String(hash).replace(/^#/, ''));
      const err = q.get('error') || h.get('error') || q.get('error_code') || h.get('error_code');
      if (err) {
        pkceStore().removeItem(PKCE_KEY);
        const code = q.get('error_code') || h.get('error_code') || err;
        // Rincian teknis dari URL tidak ditampilkan apa adanya (bisa dimanipulasi lewat tautan).
        throw new CloudError(400, { message: err === 'access_denied' ? 'access_denied' : /otp_expired|expired/.test(code) ? 'tautan_kedaluwarsa' : 'oauth_gagal' });
      }
      if (q.get('code')) {
        const verifier = pkceStore().getItem(PKCE_KEY); pkceStore().removeItem(PKCE_KEY);
        ingat = pkceStore().getItem(INGAT_KEY) !== '0'; pkceStore().removeItem(INGAT_KEY);
        if (!verifier) throw new CloudError(400, { message: 'flow state: code verifier tidak ditemukan' });
        setSession(await http('/auth/v1/token?grant_type=pkce', { method: 'POST', auth: false, body: { auth_code: q.get('code'), code_verifier: verifier } }));
        await verifyUser();
        return { type: 'login' };
      }
      return h.get('access_token') ? this.fromUrlHash(hash) : null;
    },
    async recover(email, redirectTo) {
      await http(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', auth: false, body: { email } });
    },
    async updatePassword(password) { await http('/auth/v1/user', { method: 'PUT', body: { password } }); },
    /** Mengubah metadata pengguna (mis. menghapus nomor sementara dari pendaftaran). Sesi diperbarui dengan data terbaru. */
    async updateMetadata(data) {
      const u = await http('/auth/v1/user', { method: 'PUT', body: { data } });
      if (session && u && u.id) { session.user = u; write(session); emit(); }
      return u;
    },
    /** Keluar dari perangkat ini saja; `semua: true` mencabut sesi di semua perangkat (laptop, HP, komputer lain). */
    async signOut({ semua = false } = {}) {
      let ok = true;
      try { if (session) await http(`/auth/v1/logout?scope=${semua ? 'global' : 'local'}`, { method: 'POST' }); } catch (e) { ok = false; }
      setSession(null);
      return ok;     // false: sudah keluar di perangkat ini, tetapi server tidak terjangkau
    },
    /** Membaca token dari hash URL setelah login Google / konfirmasi email / reset sandi. */
    async fromUrlHash(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      if (p.get('error_description')) throw new CloudError(400, { message: p.get('error_description') });
      if (!p.get('access_token')) return null;
      setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: Number(p.get('expires_at')) || undefined });
      await verifyUser();
      return { type: p.get('type') || 'login' };
    },
    user: () => (session && session.user) || null,
    session: () => session,
    ingat: () => ingat,
    IDLE_HARI,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  /* ---------- database (PostgREST) ---------- */
  const enc = encodeURIComponent;
  const db = {
    async profile() {
      const u = auth.user(); if (!u) return null;
      const rows = await http(`/rest/v1/profiles?select=*&id=eq.${enc(u.id)}`);
      return rows && rows[0] || null;
    },
    async updateProfile(patch) {
      const u = auth.user();
      const rows = await http(`/rest/v1/profiles?id=eq.${enc(u.id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } });
      return rows && rows[0];
    },
    async loadData() {
      const u = auth.user(); if (!u) return null;
      const rows = await http(`/rest/v1/user_data?select=settings,profile,updated_at&user_id=eq.${enc(u.id)}`);
      return rows && rows[0] || null;
    },
    async saveData({ settings, profile }) {
      const u = auth.user();
      return http('/rest/v1/user_data?on_conflict=user_id', { method: 'POST', body: { user_id: u.id, settings, profile, updated_at: new Date().toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    listReports: () => http('/rest/v1/reports?select=id,created_at,title,period_from,period_to,summary&order=created_at.desc&limit=50'),
    addReport: (row) => http('/rest/v1/reports', { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then((r) => r && r[0]),
    deleteReport: (id) => http(`/rest/v1/reports?id=eq.${enc(id)}`, { method: 'DELETE' }),
    requestUpgrade: (plan, note) => http('/rest/v1/upgrade_requests', { method: 'POST', body: { plan, note: note || '' }, headers: { Prefer: 'return=representation' } }).then((r) => r && r[0]),
    /* status resmi dari server (tahap 2): tanggal server, masa beta, Pro, pengguna awal, batas riwayat */
    statusSitus: () => http('/rest/v1/rpc/status_situs', { method: 'POST', body: {}, auth: false }),
    statusAkun: () => http('/rest/v1/rpc/status_akun', { method: 'POST', body: {} }),
    myRequests: () => http('/rest/v1/upgrade_requests?select=*&order=created_at.desc&limit=5'),
    /* admin */
    adminProfiles: () => http('/rest/v1/profiles?select=*&order=created_at.desc&limit=500'),
    adminRequests: () => http('/rest/v1/upgrade_requests?select=*&order=created_at.desc&limit=200'),
    adminSetPro: (target, until) => http('/rest/v1/rpc/admin_set_pro', { method: 'POST', body: { target, until } }),
    adminPurchases: () => http('/rest/v1/pro_purchases?select=*&order=created_at.desc&limit=500'),
    adminCatatPembelian: (target, harga, pakaiHargaAwal, catatan) => http('/rest/v1/rpc/admin_catat_pembelian', { method: 'POST', body: { target, harga, pakai_harga_awal: !!pakaiHargaAwal, catatan: catatan || '' } }),
    adminSetSitus: (betaSampai, dibukaPada) => http('/rest/v1/rpc/admin_set_situs', { method: 'POST', body: { beta_sampai: betaSampai || null, dibuka_pada: dibukaPada || null } }),
    /* masukan pengguna: hanya kirim (tanpa membaca kembali, karena pengguna tidak punya izin baca) */
    kirimMasukan: ({ jenis, pesan, halaman = '', bolehDihubungi = false }) => http('/rest/v1/feedback', { method: 'POST',
      body: { jenis, pesan: String(pesan || '').trim(), halaman: String(halaman || '').slice(0, 40), boleh_dihubungi: !!bolehDihubungi }, headers: { Prefer: 'return=minimal' } }),
    adminFeedback: () => http('/rest/v1/feedback?select=*&order=created_at.desc&limit=300'),
    adminSetFeedbackStatus: (id, status) => http(`/rest/v1/feedback?id=eq.${enc(id)}`, { method: 'PATCH', body: { status } }),
    adminSetRequestStatus: (id, status) => http(`/rest/v1/upgrade_requests?id=eq.${enc(id)}`, { method: 'PATCH', body: { status } }),
  };

  /** Pro aktif bila pro_until >= hari ini (zona waktu pengguna). */
  const isPro = (profile, today = new Date().toLocaleDateString('sv-SE')) => !!(profile && profile.pro_until && profile.pro_until >= today);

  const memori = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  function init({ url, key, store, tabStore } = {}) {
    cfg = { url: String(url || '').replace(/\/+$/, ''), key: key || '' };
    storage = store || (typeof localStorage !== 'undefined' ? localStorage : memori());
    let ss = null; try { if (typeof sessionStorage !== 'undefined') ss = sessionStorage; } catch (e) { /* diblokir */ }
    tabStorage = tabStore || ss || memori();
    ingat = true; idle = null;
    session = cfg.url ? read() : null;
    if (session) {
      // Sesi lama (sebelum fitur ini) belum punya last_active: mulai dihitung sekarang, tidak langsung dikeluarkan.
      if (session.last_active && nowSec() - session.last_active > IDLE_HARI * 86400) idle = akhiriSesiLama(session);
      else { session.last_active = nowSec(); write(session); }
    }
    return api;
  }
  let idle = null;
  const api = { init, auth, db, isPro, CloudError, get enabled() { return !!cfg.url; }, /** untuk uji */ get idleSelesai() { return idle; } };
  return api;
})();
if (typeof module !== 'undefined') module.exports = CekCloud;
