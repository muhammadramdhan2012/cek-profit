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
  let storage = null;
  const listeners = new Set();
  let refreshing = null;

  const nowSec = () => Math.floor(Date.now() / 1000);
  const read = () => { try { return JSON.parse(storage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } };
  const write = (s) => { try { if (s) storage.setItem(SESSION_KEY, JSON.stringify(s)); else storage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ } };
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
    if (m.includes('pengaturan_siap')) return 'Pembelian belum bisa dibuka: lengkapi kontak bantuan dan minimal satu metode pembayaran.';
    if (m.includes('could not find the function') || (body && body.code === 'PGRST202')) return 'Fitur ini belum aktif di database (migrasi belum dijalankan).';
    if (m.includes('function not found') || m.includes('requested function was not found')) return 'Pembayaran otomatis belum dipasang di server.';
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
        expires_at: s.expires_at || nowSec() + (Number(s.expires_in) || 3600), user: s.user || (session && session.user) || null };
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
    async signIn({ email, password }) {
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
    async oauthStart(provider, redirectTo) {
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
    /** Tautan masuk lewat email (OTP Supabase). Akun dibuat bila belum ada; membuktikan kepemilikan email (klaim pembelian tamu). */
    async kirimTautan(email, redirectTo) {
      await http(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', auth: false, body: { email, create_user: true } });
    },
    /** Mengubah metadata pengguna (mis. menghapus nomor sementara dari pendaftaran). Sesi diperbarui dengan data terbaru. */
    async updateMetadata(data) {
      const u = await http('/auth/v1/user', { method: 'PUT', body: { data } });
      if (session && u && u.id) { session.user = u; write(session); emit(); }
      return u;
    },
    async signOut() {
      try { if (session) await http('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* tetap keluar lokal */ }
      setSession(null);
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
    myRequests: () => http('/rest/v1/upgrade_requests?select=*&order=created_at.desc&limit=5'),
    /* ---- Checkout Pro manual (butuh migrasi supabase/usulan/pro-sekali-bayar.sql). Nominal & kode pesanan dibuat server. ---- */
    pengaturanPembayaran: () => http('/rest/v1/pengaturan_pembayaran?select=*&id=eq.1').then((r) => (r && r[0]) || null),
    pesananSaya: () => http('/rest/v1/upgrade_requests?select=*&plan=eq.pro_sekali&order=created_at.desc&limit=10'),
    historiPesanan: (id) => http(`/rest/v1/pro_order_events?select=status_lama,status_baru,catatan,internal,waktu&order_id=eq.${enc(id)}&order=waktu.asc`),
    buatPesanan: (metode) => http('/rest/v1/rpc/buat_pesanan_pro', { method: 'POST', body: { p_metode: metode } }),
    konfirmasiBayar: (id, catatan = '') => http('/rest/v1/rpc/konfirmasi_sudah_bayar', { method: 'POST', body: { p_order: id, p_catatan: catatan } }),
    batalkanPesanan: (id) => http('/rest/v1/rpc/batalkan_pesanan', { method: 'POST', body: { p_order: id } }),
    /* ---- Pembayaran otomatis QRIS (Edge Functions Supabase; butuh supabase/usulan/qris-midtrans.sql + fungsi terpasang).
       Browser hanya mengirim nomor pesanan; nominal, QR, dan status ditentukan server/Midtrans. ---- */
    qrisBuat: (order) => http('/functions/v1/qris-buat', { method: 'POST', body: { pesanan: order } }),
    /* Checkout tamu (tanpa login, Edge Function --no-verify-jwt): server menentukan harga; Pro aktif setelah klaim lewat email. */
    tamuCheckout: (data) => http('/functions/v1/tamu-checkout', { method: 'POST', auth: false, body: { nama: data.nama, email: data.email, whatsapp: data.whatsapp || '' } }),
    tamuStatus: (kode, email, paksa = false) => http('/functions/v1/tamu-status', { method: 'POST', auth: false, body: { kode, email, paksa: !!paksa } }),
    klaimPembelian: () => http('/rest/v1/rpc/klaim_pembelian_tamu', { method: 'POST', body: {} }),
    qrisCek: (order, paksa = false) => http('/functions/v1/qris-cek', { method: 'POST', body: { pesanan: order, paksa: !!paksa } }),
    /* admin */
    adminProfiles: () => http('/rest/v1/profiles?select=*&order=created_at.desc&limit=500'),
    adminRequests: () => http('/rest/v1/upgrade_requests?select=*&order=created_at.desc&limit=200'),
    adminSetPro: (target, until) => http('/rest/v1/rpc/admin_set_pro', { method: 'POST', body: { target, until } }),
    /* Admin pesanan Pro: semua lewat fungsi server (is_admin() dari login); sebelum migrasi server menjawab "fungsi tidak ada". */
    adminVerifikasi: (order, sumber, referensi, nominal, catatan = '') => http('/rest/v1/rpc/admin_verifikasi_pesanan', { method: 'POST', body: { p_order: order, p_sumber: sumber, p_referensi: referensi, p_nominal: nominal, p_catatan: catatan } }),
    adminCatatTambahan: (order, sumber, referensi, nominal, catatan) => http('/rest/v1/rpc/admin_catat_pembayaran_tambahan', { method: 'POST', body: { p_order: order, p_sumber: sumber, p_referensi: referensi, p_nominal: nominal, p_catatan: catatan } }),
    adminRefund: (payment, nominal, alasan, cabutPro) => http('/rest/v1/rpc/admin_refund_pembayaran', { method: 'POST', body: { p_payment: payment, p_nominal: nominal, p_alasan: alasan, p_cabut_pro: !!cabutPro } }),
    adminCatatDana: (sumber, referensi, nominal, catatan) => http('/rest/v1/rpc/admin_catat_dana_masuk', { method: 'POST', body: { p_sumber: sumber, p_referensi: referensi, p_nominal: nominal, p_catatan: catatan } }),
    adminHubungkanDana: (payment, order, alasan) => http('/rest/v1/rpc/admin_hubungkan_dana', { method: 'POST', body: { p_payment: payment, p_order: order, p_alasan: alasan } }),
    adminKoreksiRef: (payment, referensi, alasan) => http('/rest/v1/rpc/admin_koreksi_referensi', { method: 'POST', body: { p_payment: payment, p_referensi_baru: referensi, p_alasan: alasan } }),
    adminCatatan: (order, catatan, perluCek) => http('/rest/v1/rpc/admin_catatan_pesanan', { method: 'POST', body: { p_order: order, p_catatan: catatan, p_perlu_cek: !!perluCek } }),
    adminPengaturan: (patch) => http('/rest/v1/pengaturan_pembayaran?id=eq.1', { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } }).then((r) => {
      if (!r || !r[0]) throw new CloudError(403, { message: 'Pengaturan tidak tersimpan (bukan admin?)' }); return r[0]; }),
    adminTolak: (order, alasan, status = 'ditolak') => http('/rest/v1/rpc/admin_tolak_pesanan', { method: 'POST', body: { p_order: order, p_alasan: alasan, p_status: status } }),
    adminCabutPro: (target, catatan) => http('/rest/v1/rpc/admin_cabut_pro', { method: 'POST', body: { target, catatan } }),
    adminPayments: () => http('/rest/v1/pro_payments?select=*&order=created_at.desc&limit=200'),
    /** Monitor pembayaran Midtrans (login + tamu), baca saja; tanda dihitung database. Bukan admin → "Hanya admin". */
    adminMonitor: () => http('/rest/v1/rpc/admin_monitor_pembayaran', { method: 'POST', body: {} }),
    adminRefundQris: (payment, nominal, alasan) => http('/functions/v1/qris-refund', { method: 'POST', body: { pembayaran: payment, nominal, alasan } }),
  };

  /**
   * Pro aktif bila (a) Pro sekali bayar: kolom eksplisit profiles.pro_sekali_bayar = true, atau (b) Pro berjangka lama:
   * pro_until >= hari ini (zona waktu pengguna). Kolom (a) baru ada setelah migrasi supabase/usulan/pro-sekali-bayar.sql;
   * sebelum itu nilainya undefined dan hanya (b) yang berlaku, jadi akun Pro lama tetap berfungsi.
   */
  const isProSekaliBayar = (profile) => !!(profile && profile.pro_sekali_bayar === true);
  const isPro = (profile, today = new Date().toLocaleDateString('sv-SE')) => isProSekaliBayar(profile) || !!(profile && profile.pro_until && profile.pro_until >= today);

  function init({ url, key, store } = {}) {
    cfg = { url: String(url || '').replace(/\/+$/, ''), key: key || '' };
    storage = store || (typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem() {}, removeItem() {} });
    session = cfg.url ? read() : null;
    return api;
  }
  const api = { init, auth, db, isPro, isProSekaliBayar, CloudError, get enabled() { return !!cfg.url; } };
  return api;
})();
if (typeof module !== 'undefined') module.exports = CekCloud;
