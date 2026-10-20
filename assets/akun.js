/* Halaman akun: masuk, daftar, lupa sandi, sandi baru, profil, dan login Google (Supabase Auth, PKCE). */
(() => {
  const C = window.CEK_CONFIG || {};
  const cloud = CekCloud.init({ url: C.supabaseUrl, key: C.supabaseAnonKey });
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  // Tujuan setelah masuk: hanya nama halaman di situs ini (bukan URL lain) → tidak ada redirect terbuka.
  const safeNext = (v) => (/^[\w-]+\.html([?#][\w=&%.-]*)?$/.test(v || '') ? v : '');
  const NEXT_KEY = 'cekprofit.authNext';
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* abaikan */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* abaikan */ } } };
  let next = safeNext(params.get('next')) || safeNext(ss.get(NEXT_KEY)) || 'dashboard.html';
  const here = () => location.href.split('#')[0].split('?')[0];
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); };
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const OFFLINE = 'Tidak ada koneksi internet. Periksa koneksi Anda, lalu coba lagi.';
  let view = params.get('mode') === 'daftar' ? 'daftar' : 'masuk';
  let message = null;   // { ok?: boolean, text }
  let draftEmail = '';  // email yang sudah diketik tetap terisi setelah pesan error

  const eye = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const gLogo = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  // Tombol Google hanya tampil bila pemilik sudah mengaktifkan provider (config.googleLogin = true).
  const google = () => (C.googleLogin ? `<button class="btn g-btn" type="button" id="g-login">${gLogo}<span>Lanjutkan dengan Google</span></button><div class="or">atau gunakan email</div>` : '');
  const pwField = (id, label, auto, hint = '') => `<div class="field"><label for="${id}">${label}</label><div class="pw"><input class="plain" id="${id}" type="password" autocomplete="${auto}" minlength="8" required ${hint ? `aria-describedby="${id}-h"` : ''}>
    <button class="btn quiet sm" type="button" data-eye="${id}" aria-label="Tampilkan kata sandi" aria-pressed="false">${eye}</button></div>${hint ? `<span class="hint" id="${id}-h">${hint}</span>` : ''}</div>`;
  const emailField = () => '<div class="field"><label for="em">Email</label><input class="plain" id="em" type="email" autocomplete="email" inputmode="email" required aria-describedby="em-err"><span class="field-err" id="em-err" hidden></span></div>';
  const msgHtml = () => (message ? `<p class="msg ${message.ok ? 'ok' : 'err'}" role="${message.ok ? 'status' : 'alert'}">${esc(message.text)}</p>` : '');
  const heading = (title, sub) => `<div class="acct-head"><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>`;

  function render() {
    const card = $('#card');
    if (!cloud.enabled) {
      card.innerHTML = `${heading('Akun belum aktif', 'Pemilik situs belum menghubungkan layanan akun. Anda tetap bisa memakai Cek Untung tanpa login; modal dan pengaturan tersimpan di browser ini.')}
        <a class="btn primary" href="dashboard.html">Buka dashboard</a>`;
      return;
    }
    const user = cloud.auth.user();
    if (view === 'sandi-baru') {
      card.innerHTML = `${heading('Buat kata sandi baru', 'Minimal 8 karakter. Hindari kata sandi yang mudah ditebak.')}${msgHtml()}
        <form id="f-new" novalidate>${pwField('pw1', 'Kata sandi baru', 'new-password')}<button class="btn primary" type="submit">Simpan kata sandi</button></form>`;
      return;
    }
    if (user) return renderAccount(card, user);
    if (view === 'lupa') {
      card.innerHTML = `${heading('Lupa kata sandi', 'Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.')}${msgHtml()}
        <form id="f-lupa" novalidate>${emailField()}<button class="btn primary" type="submit">Kirim tautan</button></form>
        <p class="switch"><button class="btn link" type="button" data-view="masuk">Kembali ke halaman masuk</button></p>`;
      return;
    }
    const daftar = view === 'daftar';
    card.innerHTML = `<div class="auth-tabs" role="tablist" aria-label="Masuk atau daftar"><button type="button" role="tab" data-view="masuk" aria-selected="${!daftar}">Masuk</button><button type="button" role="tab" data-view="daftar" aria-selected="${daftar}">Daftar</button></div>
      ${heading(daftar ? 'Buat akun gratis' : 'Masuk ke Cek Untung', daftar ? 'Simpan modal produk dan riwayat laporan, lalu buka dari perangkat mana pun.' : 'Selamat datang kembali. Lanjutkan cek laba toko Anda.')}
      ${msgHtml()}${google()}
      <form id="f-auth" novalidate>
        ${daftar ? '<div class="field"><label for="nm">Nama</label><input class="plain" id="nm" autocomplete="name" required></div>' : ''}
        ${emailField()}
        ${pwField('pw', 'Kata sandi', daftar ? 'new-password' : 'current-password', daftar ? 'Minimal 8 karakter.' : '')}
        ${daftar ? '<p class="tiny faint">Dengan mendaftar, Anda menyetujui <a href="privasi.html">ketentuan &amp; privasi</a>.</p>' : '<button class="btn link forgot" type="button" data-view="lupa">Lupa kata sandi?</button>'}
        <button class="btn primary" type="submit">${daftar ? 'Daftar gratis' : 'Masuk'}</button>
      </form>
      <p class="switch">${daftar ? 'Sudah punya akun?' : 'Belum punya akun?'} <button class="btn link" type="button" data-view="${daftar ? 'masuk' : 'daftar'}">${daftar ? 'Masuk' : 'Daftar gratis'}</button></p>`;
  }

  async function renderAccount(card, user) {
    card.innerHTML = '<p class="muted" role="status">Memuat akun…</p>';
    let p = null, reqs = [];
    try { [p, reqs] = await Promise.all([cloud.db.profile(), cloud.db.myRequests().catch(() => [])]); } catch (e) { message = { text: e.message }; }
    // Sesi ditolak server (mis. kedaluwarsa) → kembali ke halaman masuk, bukan tampil seolah masih masuk.
    if (!cloud.auth.user()) { view = 'masuk'; return render(); }
    const pro = cloud.isPro(p);
    const pending = (reqs || []).find((r) => r.status === 'baru' || r.status === 'diproses');
    card.innerHTML = `${heading('Akun saya', esc(user.email || ''))}${msgHtml()}
      <div class="plan"><div><b>${pro ? 'Pro' : 'Gratis'}</b><span class="small muted">${pro ? `Aktif sampai ${fmtDate(p.pro_until)}` : pending ? 'Permintaan upgrade sedang diproses' : 'Laporan PDF & analisis lengkap ada di Pro'}</span></div>
        ${pro ? '<span class="badge pro">PRO</span>' : pending ? '<a class="btn sm" href="dashboard.html#upgrade">Lihat status</a>' : C.whatsapp ? '<a class="btn sm" href="dashboard.html#upgrade">Upgrade</a>' : '<span class="badge">Pro segera hadir</span>'}</div>
      <form id="f-profile">
        <div class="field"><label for="pf-name">Nama</label><input class="plain" id="pf-name" value="${esc(p && p.full_name)}" autocomplete="name"></div>
        <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(p && p.store_name)}" placeholder="Tampil di sampul laporan PDF"></div>
        <div class="field"><label for="pf-wa">Nomor WhatsApp</label><input class="plain" id="pf-wa" value="${esc(p && p.whatsapp)}" inputmode="tel" placeholder="08…"><span class="hint">Dipakai untuk konfirmasi pembayaran.</span></div>
        <button class="btn" type="submit">Simpan profil</button>
      </form>
      <div class="row-gap"><a class="btn primary" href="${esc(next)}" style="flex:1">Buka dashboard</a><button class="btn quiet" type="button" id="logout">Keluar</button></div>
      <button class="btn link" type="button" data-view="sandi-baru" style="justify-self:center">Ganti kata sandi</button>`;
    message = null;
  }

  /** Validasi di browser sebelum dikirim. Mengembalikan pesan error pertama atau ''. */
  function validate(f) {
    const em = f.querySelector('#em'), err = f.querySelector('#em-err');
    if (em) {
      const bad = !em.value.trim() || !em.checkValidity();
      em.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (err) { err.hidden = !bad; err.textContent = bad ? 'Format email tidak valid. Contoh: nama@toko.com' : ''; }
      if (bad) { em.focus(); return 'Format email tidak valid.'; }
    }
    const nm = f.querySelector('#nm');
    if (nm && !nm.value.trim()) { nm.focus(); return 'Nama wajib diisi.'; }
    const pw = f.querySelector('#pw, #pw1');
    if (pw && !pw.value) { pw.focus(); return 'Kata sandi wajib diisi.'; }
    if (pw && (f.id === 'f-new' || view === 'daftar') && pw.value.length < 8) { pw.focus(); return 'Kata sandi minimal 8 karakter.'; }
    return '';
  }
  const busy = (btn, on, label) => {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
  };
  const keepEmail = () => { const em = $('#em'); if (em) draftEmail = em.value; };
  const restoreEmail = () => { const em = $('#em'); if (em && draftEmail && !em.value) em.value = draftEmail; };
  const showErr = (text) => { keepEmail(); message = { text }; render(); restoreEmail(); };

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    const invalid = f.id === 'f-profile' ? '' : validate(f);
    if (invalid) {
      // Pesan email sudah tampil di bawah kolomnya; pesan lain tampil di atas form tanpa mengosongkan isian.
      const inline = f.querySelector('#em-err');
      if (!inline || inline.hidden) { message = { text: invalid }; const m = $('.msg'); if (m) m.outerHTML = msgHtml(); else f.insertAdjacentHTML('beforebegin', msgHtml()); }
      return;
    }
    if (!online()) return showErr(OFFLINE);
    busy(btn, true, f.id === 'f-auth' ? (view === 'daftar' ? 'Mendaftarkan…' : 'Memeriksa…') : 'Memproses…');
    try {
      if (f.id === 'f-auth') {
        const email = $('#em').value.trim(), password = $('#pw').value;
        if (view === 'daftar') {
          const r = await cloud.auth.signUp({ email, password, fullName: $('#nm').value.trim(), redirectTo: here() });
          track('daftar');
          if (r.session) return go('Akun dibuat. Membuka dashboard…');
          view = 'masuk'; message = { ok: true, text: `Hampir selesai. Buka email di ${email} dan klik tautan konfirmasi, lalu masuk. Periksa juga folder spam.` };
        } else {
          await cloud.auth.signIn({ email, password }); track('masuk');
          return go('Berhasil masuk. Membuka dashboard…');
        }
      } else if (f.id === 'f-lupa') {
        await cloud.auth.recover($('#em').value.trim(), here());
        // Pesan sama untuk email terdaftar maupun tidak (mencegah enumerasi akun).
        message = { ok: true, text: 'Jika email tersebut terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Periksa kotak masuk dan folder spam.' };
      } else if (f.id === 'f-new') {
        await cloud.auth.updatePassword($('#pw1').value);
        view = 'masuk'; message = { ok: true, text: 'Kata sandi baru tersimpan.' }; toast('Kata sandi baru tersimpan.');
      } else if (f.id === 'f-profile') {
        await cloud.db.updateProfile({ full_name: $('#pf-name').value.trim(), store_name: $('#pf-store').value.trim(), whatsapp: $('#pf-wa').value.trim() });
        toast('Profil tersimpan.'); busy(btn, false); return;
      }
    } catch (err) { keepEmail(); message = { text: online() ? err.message : OFFLINE }; }
    render(); restoreEmail();
  });

  /** Pindah ke tujuan hanya bila sesi sudah ada dan penggunanya dikenali server. */
  function go(text) {
    if (!cloud.auth.user()) { showErr('Sesi tidak dapat diverifikasi. Silakan masuk lagi.'); return; }
    message = { ok: true, text }; render();
    ss.del(NEXT_KEY);
    location.href = next;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; message = null; render(); const first = $('#card input'); if (first && t.dataset.view !== 'masuk') first.focus(); }
    else if (t.dataset.eye) {
      const i = $(`#${t.dataset.eye}`), show = i.type === 'password';
      i.type = show ? 'text' : 'password'; t.setAttribute('aria-pressed', String(show)); t.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    } else if (t.id === 'g-login') {
      if (!online()) return showErr(OFFLINE);
      busy(t, true, 'Membuka Google…'); track('google');
      try {
        if (next !== 'dashboard.html') ss.set(NEXT_KEY, next);
        location.assign(await cloud.auth.oauthStart('google', here()));
      } catch (err) { busy(t, false); showErr('Masuk dengan Google gagal dimulai. Silakan coba lagi.'); }
    } else if (t.id === 'logout') { await cloud.auth.signOut(); view = 'masuk'; message = { ok: true, text: 'Anda sudah keluar.' }; render(); }
  });
  // Bersihkan pesan error email saat pengguna mengetik ulang.
  document.addEventListener('input', (e) => { if (e.target.id === 'em') { e.target.removeAttribute('aria-invalid'); const er = $('#em-err'); if (er) er.hidden = true; } });

  (async () => {
    // Kembali dari Google (?code= / ?error=) atau dari tautan email (#access_token= / #error=).
    const hasReturn = cloud.enabled && (/[?&](code|error|error_code)=/.test(location.search) || /(access_token|error)=/.test(location.hash));
    if (hasReturn) {
      $('#card').innerHTML = '<p class="muted" role="status">Memeriksa sesi…</p>';
      try {
        const r = await cloud.auth.fromUrl({ search: location.search, hash: location.hash });
        const keep = new URLSearchParams(location.search); ['code', 'error', 'error_code', 'error_description', 'state'].forEach((k) => keep.delete(k));
        history.replaceState(null, '', location.pathname + (keep.toString() ? `?${keep}` : ''));
        if (r && r.type === 'recovery') view = 'sandi-baru';
        else if (r && r.type === 'signup') message = { ok: true, text: 'Email terkonfirmasi. Akun Anda aktif.' };
        else if (r) return go('Berhasil masuk. Membuka dashboard…');
      } catch (err) {
        history.replaceState(null, '', location.pathname);
        message = { text: online() ? err.message : OFFLINE };
      }
    }
    render();
  })();
})();
