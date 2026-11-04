/* Elemen lintas halaman yang dikendalikan config.js:
 *  - Tautan bantuan WhatsApp (CEK_CONFIG.waSupport). TERPISAH dari nomor pembayaran Pro (CEK_CONFIG.whatsapp),
 *    agar mengisi nomor bantuan tidak ikut membuka alur pembayaran. Selama kosong/tidak valid, tautan disembunyikan.
 *  - Pengumuman masa beta ([data-beta]): dari config, lalu diperbarui dari server bila tersedia (tahap 2).
 *  - Pemberitahuan pindah alamat (CEK_CONFIG.domainResmi). Hanya tampil di alamat lama GitHub Pages (*.github.io).
 * Pesan WhatsApp hanya memuat nama halaman: tanpa email, nomor, angka laporan, atau data pesanan.
 */
const CekSitus = (() => {
  const NOMOR_WA = /^62\d{8,13}$/;   // format wa.me: kode negara tanpa "+" dan tanpa spasi
  const HALAMAN = ['Beranda', 'Dashboard', 'Akun', 'Privasi'];

  /** URL wa.me untuk bantuan, atau '' bila nomor bantuan belum diatur atau formatnya salah. */
  /** Tautan WhatsApp bantuan dengan teks pembuka sendiri (mis. "Kirim masukan"). Kosong bila nomor bantuan belum valid. */
  function bantuanWa(cfg, teks) {
    const nomor = String((cfg && cfg.waSupport) || '').trim();
    return NOMOR_WA.test(nomor) ? `https://wa.me/${nomor}?text=${encodeURIComponent(String(teks || ''))}` : '';
  }
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

  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  /** Masa beta gratis (CEK_CONFIG.betaGratisSampai 'YYYY-MM-DD', inklusif). hariIni 'YYYY-MM-DD' (tanggal perangkat).
   *  Format salah/kosong → tidak aktif. Aturan yang sama ada di assets/app.js (betaGratis). */
  const TGL = /^\d{4}-\d{2}-\d{2}$/;
  const labelTanggal = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
  function betaGratis(cfg, hariIni) {
    const s = String((cfg && cfg.betaGratisSampai) || '').trim();
    if (!TGL.test(s)) return { aktif: false, sampai: '', label: '' };
    return { aktif: String(hariIni) <= s, sampai: s, label: labelTanggal(s) };
  }
  /** Masa beta menurut server (RPC status_situs, tahap 2): tanggal & jam server, bisa diubah admin tanpa deploy.
   *  Jawaban yang bentuknya tidak dikenal → null (tetap memakai config). */
  function betaDariServer(st) {
    if (!st || typeof st !== 'object' || !TGL.test(String(st.hari_ini || ''))) return null;
    const s = st.beta_gratis_sampai;
    if (s == null) return { aktif: false, sampai: '', label: '' };
    if (!TGL.test(String(s))) return null;
    return { aktif: st.beta_aktif === true, sampai: s, label: labelTanggal(s) };
  }
  function terapkanBeta(doc, beta, cfg) {
    doc.querySelectorAll('[data-beta]').forEach((el) => { el.hidden = !beta.aktif; });
    doc.querySelectorAll('[data-beta-sampai]').forEach((el) => { if (beta.label) el.textContent = beta.label; });
    doc.querySelectorAll('[data-harga-awal]').forEach((el) => { if (cfg && cfg.hargaPenggunaAwal) el.textContent = cfg.hargaPenggunaAwal; });
  }
  /** Minta status masa beta ke server lalu perbarui [data-beta]. Gagal (offline, akun belum aktif, SQL tahap 2 belum
   *  dijalankan) → diam, tampilan dari config tetap. Tanpa token login: hanya data umum situs. */
  async function segarkanBeta(doc, cfg, fetchFn) {
    const url = String((cfg && cfg.supabaseUrl) || '').replace(/\/+$/, '');
    if (!url || !fetchFn || !doc.querySelectorAll('[data-beta]').length) return null;
    try {
      const res = await fetchFn(`${url}/rest/v1/rpc/status_situs`, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey || '', 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) return null;
      const beta = betaDariServer(await res.json());
      if (beta) terapkanBeta(doc, beta, cfg);
      return beta;
    } catch (e) { return null; }
  }

  const TUTUP_KEY = 'cekprofit.pindahTutup';
  function pasang(doc, cfg, loc, store, hariIni = new Date().toLocaleDateString('sv-SE')) {
    // Masa beta: elemen [data-beta] tampil hanya selama beta aktif; [data-beta-sampai] / [data-harga-awal] diisi dari config.
    terapkanBeta(doc, betaGratis(cfg, hariIni), cfg);
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
    const run = () => { let st = null; try { st = sessionStorage; } catch (e) { /* abaikan */ } const cfg = window.CEK_CONFIG || {}; pasang(document, cfg, location, st); if (typeof fetch === 'function') segarkanBeta(document, cfg, fetch.bind(window)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }
  return { bantuanWa, waSupportUrl, alamatPindah, pasang, betaGratis, betaDariServer, segarkanBeta };
})();
if (typeof module !== 'undefined') module.exports = CekSitus;
