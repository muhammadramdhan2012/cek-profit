/* Elemen lintas halaman yang dikendalikan config.js:
 *  - Tautan bantuan WhatsApp (CEK_CONFIG.waSupport). TERPISAH dari nomor pembayaran Pro (CEK_CONFIG.whatsapp),
 *    agar mengisi nomor bantuan tidak ikut membuka alur pembayaran. Selama kosong/tidak valid, tautan disembunyikan.
 *  - Pemberitahuan pindah alamat (CEK_CONFIG.domainResmi). Hanya tampil di alamat lama GitHub Pages (*.github.io).
 *  - Pengalihan otomatis alamat lama (CEK_CONFIG.alihkanAlamatLama), kecuali bila ada data di browser lama atau URL
 *    membawa token login; dalam kasus itu pemberitahuan yang tampil.
 * Pesan WhatsApp hanya memuat nama halaman: tanpa email, nomor, angka laporan, atau data pesanan.
 */
const CekSitus = (() => {
  const NOMOR_WA = /^62\d{8,13}$/;   // format wa.me: kode negara tanpa "+" dan tanpa spasi
  const HALAMAN = ['Beranda', 'Dashboard', 'Akun', 'Privasi'];

  /** URL wa.me untuk bantuan, atau '' bila nomor bantuan belum diatur atau formatnya salah. */
  function waSupportUrl(cfg, halaman) {
    const nomor = String((cfg && cfg.waSupport) || '').trim();
    if (!NOMOR_WA.test(nomor)) return '';
    const nama = HALAMAN.includes(halaman) ? halaman : 'Beranda';
    const teks = (cfg && cfg.waSupportMessage) || 'Halo Cek Untung, saya butuh bantuan menggunakan website';
    return `https://wa.me/${nomor}?text=${encodeURIComponent(`${teks} (halaman: ${nama}).`)}`;
  }

  /** Alamat yang sama di domain resmi, atau '' bila pemberitahuan tidak perlu tampil. */
  function alamatPindah(cfg, loc) {
    let resmi;
    try { resmi = new URL(String((cfg && cfg.domainResmi) || '')); } catch (e) { return ''; }
    if (resmi.protocol !== 'https:' || !loc || !/\.github\.io$/i.test(loc.hostname || '') || loc.hostname === resmi.hostname) return '';
    // /cek-profit/dashboard.html → /dashboard.html. Query & hash tidak dibawa (bisa berisi token login).
    const file = String(loc.pathname || '/').replace(/^\/[^/]+\//, '/').replace(/^\/[^/]*$/, (m) => (m.includes('.') ? m : '/'));
    return new URL(file, resmi.origin).href;
  }

  const TUTUP_KEY = 'cekprofit.pindahTutup';
  // Kunci yang boleh ditinggal di alamat lama: tema, tanda "Nanti", dan sesi (data akun ada di server; cukup masuk lagi).
  const KUNCI_AMAN = ['cekprofit.theme', TUTUP_KEY, 'cekprofit.session'];
  const AUTH = /(^|[?&#])(code|error|error_code|error_description|access_token|refresh_token|token_hash|type)=/;
  /**
   * URL tujuan pengalihan otomatis dari alamat lama, atau '' bila TIDAK boleh dialihkan:
   *  - alihkanAlamatLama bukan true, atau bukan alamat lama (lihat alamatPindah);
   *  - URL membawa token/kode login (tautan email lama) — token tidak boleh pindah domain diam-diam;
   *  - browser lama menyimpan data Cek Untung selain kunci aman (modal, retur, kode akses) — data itu tidak ikut pindah.
   * Query aman (mis. ?view=pro) ikut dibawa; hash hanya bila berupa nama bagian (#riwayat).
   */
  function alamatAlihkan(cfg, loc, local) {
    if (!cfg || cfg.alihkanAlamatLama !== true) return '';
    const ke = alamatPindah(cfg, loc);
    if (!ke) return '';
    const search = String(loc.search || ''), hash = String(loc.hash || '');
    if (AUTH.test(search) || AUTH.test(hash)) return '';
    try {
      for (let i = 0; local && i < local.length; i++) {
        const k = local.key(i);
        if (k && k.startsWith('cekprofit.') && !KUNCI_AMAN.includes(k)) return '';
      }
    } catch (e) { return ''; }   // penyimpanan tidak bisa dibaca: jangan ambil risiko kehilangan data
    const u = new URL(ke);
    if (search.length > 1 && search.length < 300) u.search = search;
    if (/^#[A-Za-z0-9_-]{1,40}$/.test(hash)) u.hash = hash;
    return u.href;
  }
  /**
   * Penanda lingkungan. Pita "STAGING" hanya tampil setelah database MENJAWAB bahwa ia staging (fungsi info_lingkungan()
   * yang hanya dibuat di project staging: supabase/staging/penanda-staging.sql) dengan ref project yang sama dengan URL.
   * Tanpa jawaban itu, yang tampil peringatan.
   */
  function pita(doc, teks, jenis) {
    let el = doc.getElementById('tanda-staging');
    if (!el) { el = doc.createElement('div'); el.id = 'tanda-staging'; el.setAttribute('role', 'note'); doc.body.prepend(el); }
    el.className = `tanda-staging ${jenis}`; el.textContent = teks;
    // Tinggi pita berubah menurut lebar layar; elemen lain yang menempel di bawah memakai --pita-h.
    const ukur = () => { try { doc.documentElement.style.setProperty('--pita-h', `${el.offsetHeight}px`); } catch (e) { /* abaikan */ } };
    ukur();
    if (el.dataset && !el.dataset.ukur && typeof window !== 'undefined' && window.addEventListener) { el.dataset.ukur = '1'; window.addEventListener('resize', ukur); }
  }
  async function tandaStaging(doc, cfg, fetcher) {
    if (!cfg) return '';
    if (cfg.lingkungan === 'staging-belum-siap') { pita(doc, cfg.konfigurasiBelumSiap || 'Konfigurasi staging belum siap.', 'bahaya'); return 'belum-siap'; }
    if (cfg.lingkungan !== 'staging') return '';
    let ok = false;
    try {
      const res = await (fetcher || fetch)(`${cfg.supabaseUrl}/rest/v1/rpc/info_lingkungan`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' }, body: '{}' });
      const isi = res.ok ? await res.json() : null;
      // Ref harus cocok dengan URL yang benar-benar dipakai, agar database lain yang kebetulan punya fungsi ini tidak lolos.
      const ref = (/^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(cfg.supabaseUrl || '') || [])[1];
      ok = !!(isi && isi.lingkungan === 'staging' && ref && isi.ref === ref);
    } catch (e) { ok = false; }
    pita(doc, ok ? 'STAGING: database uji, bukan layanan Cek Untung sungguhan. Jangan membayar dengan uang sungguhan di sini.'
      : 'PERINGATAN: database di alamat ini belum terverifikasi sebagai staging. Jangan memakai data atau uang sungguhan.', ok ? 'staging' : 'bahaya');
    return ok ? 'staging' : 'tidak-terverifikasi';
  }
  function pasang(doc, cfg, loc, store) {
    tandaStaging(doc, cfg);   // asinkron; tidak menunda elemen lain
    doc.querySelectorAll('[data-wa-support]').forEach((el) => {
      const url = waSupportUrl(cfg, el.dataset.waSupport);
      if (url) { el.href = url; el.target = '_blank'; el.rel = 'noopener'; el.hidden = false; }
      else { el.removeAttribute('href'); el.hidden = true; }
    });
    const ke = alamatPindah(cfg, loc);
    let tutup = false;
    try { tutup = store && store.getItem(TUTUP_KEY) === '1'; } catch (e) { /* abaikan */ }
    if (!ke || tutup || doc.getElementById('pindah-domain')) return;
    const host = new URL(ke).hostname;
    const el = doc.createElement('div');
    el.id = 'pindah-domain'; el.className = 'pindah'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Alamat baru Cek Untung');
    // Teks statis + host dari config (bukan input pengguna); tetap dimasukkan sebagai teks, bukan HTML.
    const p = doc.createElement('p');
    const b = doc.createElement('b'); b.textContent = `Cek Untung pindah ke ${host}.`;
    p.append(b, ' Akun Anda tetap sama; modal yang tersimpan di akun ikut terbawa setelah Anda masuk di alamat baru. Data yang hanya ada di browser ini, termasuk tanda retur dan kode akses, tidak pindah otomatis.');
    const a = doc.createElement('a'); a.className = 'btn sm primary'; a.href = ke; a.textContent = `Buka ${host}`;
    const x = doc.createElement('button'); x.type = 'button'; x.className = 'btn sm quiet'; x.textContent = 'Nanti';
    x.addEventListener('click', () => { el.remove(); try { store && store.setItem(TUTUP_KEY, '1'); } catch (e) { /* abaikan */ } });
    const act = doc.createElement('div'); act.className = 'pindah-act'; act.append(a, x);
    el.append(p, act);
    doc.body.prepend(el);
  }

  if (typeof document !== 'undefined') {
    const run = () => {
      let st = null, local = null;
      try { st = sessionStorage; } catch (e) { /* abaikan */ }
      try { local = localStorage; } catch (e) { /* abaikan */ }
      const ke = alamatAlihkan(window.CEK_CONFIG || {}, location, local);
      if (ke) { location.replace(ke); return; }
      pasang(document, window.CEK_CONFIG || {}, location, st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }
  return { waSupportUrl, alamatPindah, alamatAlihkan, pasang, tandaStaging };
})();
if (typeof module !== 'undefined') module.exports = CekSitus;
