/* Halaman akun: masuk, daftar, lupa sandi, sandi baru, dan profil. */
(() => {
  const C = window.CEK_CONFIG || {};
  const cloud = CekCloud.init({ url: C.supabaseUrl, key: C.supabaseAnonKey });
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const next = /^[\w-]+\.html([?#].*)?$/.test(params.get('next') || '') ? params.get('next') : 'app.html';
  const here = () => location.href.split('#')[0].split('?')[0];
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); };
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  let view = params.get('mode') === 'daftar' ? 'daftar' : 'masuk';
  let message = null;

  const eye = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const google = `<a class="btn" href="${esc(cloud.enabled ? cloud.auth.oauthUrl('google', here()) : '#')}" data-track="google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Lanjutkan dengan Google</a><div class="or">atau dengan email</div>`;
  const pwField = (id, label, auto) => `<div class="field"><label for="${id}">${label}</label><div class="pw"><input class="plain" id="${id}" type="password" autocomplete="${auto}" minlength="8" required>
    <button class="btn quiet sm" type="button" data-eye="${id}" aria-label="Tampilkan kata sandi">${eye}</button></div></div>`;
  const msgHtml = () => (message ? `<p class="msg ${message.ok ? 'ok' : 'err'}" role="alert">${esc(message.text)}</p>` : '');

  function render() {
    const card = $('#card');
    if (!cloud.enabled) {
      card.innerHTML = `<h1>Akun belum aktif</h1><p class="muted">Pemilik situs belum menghubungkan layanan akun. Anda tetap bisa memakai Cek Profit tanpa login; modal dan pengaturan tersimpan di browser ini.</p>
        <a class="btn primary" href="app.html">Buka aplikasi</a>`;
      return;
    }
    const user = cloud.auth.user();
    if (view === 'sandi-baru') {
      card.innerHTML = `<h1>Buat kata sandi baru</h1>${msgHtml()}<form id="f-new">${pwField('pw1', 'Kata sandi baru', 'new-password')}<button class="btn primary" type="submit">Simpan kata sandi</button></form>`;
      return;
    }
    if (user) return renderAccount(card, user);
    if (view === 'lupa') {
      card.innerHTML = `<h1>Lupa kata sandi</h1><p class="muted">Kami kirim tautan untuk membuat kata sandi baru ke email Anda.</p>${msgHtml()}
        <form id="f-lupa"><div class="field"><label for="em">Email</label><input class="plain" id="em" type="email" autocomplete="email" required></div>
        <button class="btn primary" type="submit">Kirim tautan</button></form><p class="switch"><button class="btn link" type="button" data-view="masuk">Kembali ke halaman masuk</button></p>`;
      return;
    }
    const daftar = view === 'daftar';
    card.innerHTML = `<div><h1>${daftar ? 'Buat akun' : 'Masuk'}</h1><p class="muted" style="margin-top:6px">${daftar ? 'Simpan modal produk dan riwayat laporan, lalu buka dari perangkat mana pun.' : 'Selamat datang kembali.'}</p></div>
      ${msgHtml()}${C.googleLogin ? google : ''}
      <form id="f-auth">
        ${daftar ? '<div class="field"><label for="nm">Nama</label><input class="plain" id="nm" autocomplete="name" required></div>' : ''}
        <div class="field"><label for="em">Email</label><input class="plain" id="em" type="email" autocomplete="email" required></div>
        ${pwField('pw', 'Kata sandi', daftar ? 'new-password' : 'current-password')}
        ${daftar ? '<p class="tiny faint">Minimal 8 karakter. Dengan mendaftar, Anda menyetujui <a href="privasi.html">ketentuan &amp; privasi</a>.</p>' : '<button class="btn link" type="button" data-view="lupa" style="justify-self:start">Lupa kata sandi?</button>'}
        <button class="btn primary" type="submit">${daftar ? 'Buat akun' : 'Masuk'}</button>
      </form>
      <p class="switch">${daftar ? 'Sudah punya akun?' : 'Belum punya akun?'} <button class="btn link" type="button" data-view="${daftar ? 'masuk' : 'daftar'}">${daftar ? 'Masuk' : 'Daftar gratis'}</button></p>`;
  }

  async function renderAccount(card, user) {
    card.innerHTML = '<p class="muted">Memuat akun…</p>';
    let p = null, reqs = [];
    try { [p, reqs] = await Promise.all([cloud.db.profile(), cloud.db.myRequests().catch(() => [])]); } catch (e) { message = { text: e.message }; }
    const pro = cloud.isPro(p);
    const pending = (reqs || []).find((r) => r.status === 'baru' || r.status === 'diproses');
    card.innerHTML = `<div><h1>Akun saya</h1><p class="muted" style="margin-top:6px">${esc(user.email || '')}</p></div>${msgHtml()}
      <div class="plan"><div><b>${pro ? 'Pro' : 'Gratis'}</b><span class="small muted">${pro ? `Aktif sampai ${fmtDate(p.pro_until)}` : pending ? 'Permintaan upgrade sedang diproses' : 'Laporan PDF & analisis lengkap ada di Pro'}</span></div>
        ${pro ? '<span class="badge pro">PRO</span>' : `<a class="btn sm" href="app.html#upgrade">${pending ? 'Lihat status' : 'Upgrade'}</a>`}</div>
      <form id="f-profile">
        <div class="field"><label for="pf-name">Nama</label><input class="plain" id="pf-name" value="${esc(p && p.full_name)}" autocomplete="name"></div>
        <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(p && p.store_name)}" placeholder="Tampil di sampul laporan PDF"></div>
        <div class="field"><label for="pf-wa">Nomor WhatsApp</label><input class="plain" id="pf-wa" value="${esc(p && p.whatsapp)}" inputmode="tel" placeholder="08…"><span class="hint">Dipakai untuk konfirmasi pembayaran.</span></div>
        <button class="btn" type="submit">Simpan profil</button>
      </form>
      <div class="row-gap"><a class="btn primary" href="${esc(next)}" style="flex:1">Buka aplikasi</a><button class="btn quiet" type="button" id="logout">Keluar</button></div>
      <button class="btn link" type="button" data-view="sandi-baru" style="justify-self:center">Ganti kata sandi</button>`;
    message = null;
  }

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (f.id === 'f-auth') {
        const email = $('#em').value.trim(), password = $('#pw').value;
        if (view === 'daftar') {
          const r = await cloud.auth.signUp({ email, password, fullName: $('#nm').value.trim(), redirectTo: here() });
          track('daftar');
          if (r.session) { location.href = next; return; }
          view = 'masuk'; message = { ok: true, text: `Hampir selesai. Buka email dari Supabase di ${email} dan klik tautan konfirmasi, lalu masuk.` };
        } else {
          await cloud.auth.signIn({ email, password }); track('masuk');
          location.href = next; return;
        }
      } else if (f.id === 'f-lupa') {
        await cloud.auth.recover($('#em').value.trim(), here());
        message = { ok: true, text: 'Jika email terdaftar, tautan untuk membuat kata sandi baru sudah dikirim.' };
      } else if (f.id === 'f-new') {
        await cloud.auth.updatePassword($('#pw1').value);
        view = 'masuk'; message = { ok: true, text: 'Kata sandi baru tersimpan.' }; toast('Kata sandi baru tersimpan.');
      } else if (f.id === 'f-profile') {
        await cloud.db.updateProfile({ full_name: $('#pf-name').value.trim(), store_name: $('#pf-store').value.trim(), whatsapp: $('#pf-wa').value.trim() });
        toast('Profil tersimpan.'); btn.disabled = false; return;
      }
    } catch (err) { message = { text: err.message }; }
    render();
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; message = null; render(); }
    else if (t.dataset.eye) { const i = $(`#${t.dataset.eye}`); i.type = i.type === 'password' ? 'text' : 'password'; }
    else if (t.id === 'logout') { await cloud.auth.signOut(); view = 'masuk'; message = { ok: true, text: 'Anda sudah keluar.' }; render(); }
    else if (t.dataset.track) track(t.dataset.track);
  });

  (async () => {
    if (cloud.enabled && location.hash.length > 1) {
      try {
        const r = await cloud.auth.fromUrlHash(location.hash);
        history.replaceState(null, '', location.pathname + location.search);
        if (r && r.type === 'recovery') view = 'sandi-baru';
        else if (r && r.type === 'signup') message = { ok: true, text: 'Email terkonfirmasi. Akun Anda aktif.' };
        else if (r) { location.href = next; return; }
      } catch (err) { message = { text: err.message }; }
    }
    render();
  })();
})();
