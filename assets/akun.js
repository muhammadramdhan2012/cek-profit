/* Halaman akun: masuk, daftar, lupa sandi, sandi baru, profil, dan login Google (Supabase Auth, PKCE). */
(() => {
  const C = window.CEK_CONFIG || {};
  const A = CekAturanAkun;   // assets/aturan-akun.js (dimuat sebelum file ini)
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
  let draft = {};       // isian (selain kata sandi) tetap terisi setelah pesan error
  const DRAFT_IDS = ['em', 'nm', 'hp'];

  const eye = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const gLogo = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  // Tombol Google hanya tampil bila pemilik sudah mengaktifkan provider (config.googleLogin = true).
  const google = () => (C.googleLogin ? `<button class="btn g-btn" type="button" id="g-login">${gLogo}<span>Lanjutkan dengan Google</span></button><div class="or">atau gunakan email</div>` : '');
  const errSpan = (id) => `<span class="field-err" id="${id}-err" hidden></span>`;
  /** Kolom kata sandi. `baru` = kata sandi baru (daftar/ganti): tampilkan daftar syarat yang diperbarui saat mengetik. */
  const pwField = (id, label, auto, placeholder, { baru = false, eyeLabel = 'kata sandi' } = {}) => {
    const rules = baru ? `<ul class="pw-rules" id="${id}-rules" aria-label="Syarat kata sandi">${A.SYARAT.map((x) => `<li data-rule="${x.id}" data-ok="false">${x.teks}<span class="sr"> (belum)</span></li>`).join('')}</ul>` : '';
    return `<div class="field"><label for="${id}">${label}</label><div class="pw"><input class="plain" id="${id}" type="password" autocomplete="${auto}" placeholder="${placeholder}" required aria-describedby="${id}-err${baru ? ` ${id}-rules` : ''}"${baru ? ` data-baru="1" maxlength="${A.SANDI_MAKS}"` : ''}>
    <button class="btn quiet sm" type="button" data-eye="${id}" data-eye-label="${eyeLabel}" aria-label="Tampilkan ${eyeLabel}" aria-pressed="false">${eye}</button></div>${errSpan(id)}${rules}</div>`;
  };
  const emailField = (ph = 'Masukkan email Anda') => `<div class="field"><label for="em">Email</label><input class="plain" id="em" type="email" autocomplete="email" inputmode="email" placeholder="${ph}" required aria-describedby="em-err">${errSpan('em')}</div>`;
  const nameField = () => `<div class="field"><label for="nm">Nama lengkap</label><input class="plain" id="nm" autocomplete="name" placeholder="Masukkan nama lengkap" maxlength="100" required aria-describedby="nm-err">${errSpan('nm')}</div>`;
  const phoneField = () => `<div class="field"><label for="hp">Nomor HP/WhatsApp <span class="opt">(opsional)</span></label><input class="plain" id="hp" type="tel" autocomplete="tel" inputmode="tel" placeholder="Contoh: 081234567890" maxlength="20" aria-describedby="hp-h hp-err">
    <span class="hint" id="hp-h">Boleh dikosongkan. Untuk menghubungi Anda soal bantuan dan pembayaran; tidak dipakai untuk iklan.</span>${errSpan('hp')}</div>`;
  const confirmField = (id, of) => pwField(id, 'Konfirmasi kata sandi', 'new-password', 'Ulangi kata sandi', { eyeLabel: 'konfirmasi kata sandi' }).replace('<input ', `<input data-sama="${of}" `);
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
      card.innerHTML = `${heading('Buat kata sandi baru', 'Gunakan kata sandi yang tidak Anda pakai di situs lain.')}${msgHtml()}
        <form id="f-new" novalidate>${pwField('pw1', 'Kata sandi baru', 'new-password', 'Buat kata sandi', { baru: true })}${confirmField('pw1b', 'pw1')}<button class="btn primary" type="submit">Simpan kata sandi</button></form>`;
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
        ${daftar ? nameField() : ''}
        ${emailField(daftar ? 'contoh@email.com' : 'Masukkan email Anda')}
        ${daftar ? phoneField() : ''}
        ${daftar ? pwField('pw', 'Kata sandi', 'new-password', 'Buat kata sandi', { baru: true }) + confirmField('pw2', 'pw') : pwField('pw', 'Kata sandi', 'current-password', 'Masukkan kata sandi')}
        ${daftar ? '<p class="tiny faint">Dengan mendaftar, Anda menyetujui <a href="privasi.html">ketentuan &amp; privasi</a>.</p>' : '<button class="btn link forgot" type="button" data-view="lupa">Lupa kata sandi?</button>'}
        <button class="btn primary" type="submit">${daftar ? 'Daftar gratis' : 'Masuk'}</button>
      </form>
      <p class="switch">${daftar ? 'Sudah punya akun?' : 'Belum punya akun?'} <button class="btn link" type="button" data-view="${daftar ? 'masuk' : 'daftar'}">${daftar ? 'Masuk' : 'Daftar gratis'}</button></p>`;
  }

  async function renderAccount(card, user) {
    card.innerHTML = '<p class="muted" role="status">Memuat akun…</p>';
    try { await salinHpDaftar(); } catch (e) { /* dicoba lagi nanti */ }
    let p = null, reqs = [];
    try { [p, reqs] = await Promise.all([cloud.db.profile(), cloud.db.myRequests().catch(() => [])]); } catch (e) { message = { text: e.message }; }
    // Sesi ditolak server (mis. kedaluwarsa) → kembali ke halaman masuk, bukan tampil seolah masih masuk.
    if (!cloud.auth.user()) { view = 'masuk'; return render(); }
    const pro = cloud.isPro(p);
    const wa = (p && p.whatsapp) || '';
    // Pengguna Google (atau akun lama) belum punya nomor: ajak melengkapi, tidak memblokir.
    const ajakWa = !wa ? '<p class="msg info" id="wa-ajak">Lengkapi nomor WhatsApp Anda agar kami bisa membantu bila ada kendala atau saat konfirmasi pembayaran.</p>' : '';
    const pending = (reqs || []).find((r) => r.status === 'baru' || r.status === 'diproses');
    card.innerHTML = `${heading('Akun saya', esc(user.email || ''))}${msgHtml()}${ajakWa}
      <div class="plan"><div><b>${pro ? 'Pro' : 'Gratis'}</b><span class="small muted">${pro ? `Aktif sampai ${fmtDate(p.pro_until)}` : pending ? 'Permintaan upgrade sedang diproses' : 'Laporan PDF & analisis lengkap ada di Pro'}</span></div>
        ${pro ? '<span class="badge pro">PRO</span>' : pending ? '<a class="btn sm" href="dashboard.html#upgrade">Lihat status</a>' : C.whatsapp ? '<a class="btn sm" href="dashboard.html#upgrade">Upgrade</a>' : '<span class="badge">Pro segera hadir</span>'}</div>
      <form id="f-profile">
        <div class="field"><label for="pf-name">Nama lengkap</label><input class="plain" id="pf-name" value="${esc(p && p.full_name)}" autocomplete="name" maxlength="100" placeholder="Masukkan nama lengkap"></div>
        <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(p && p.store_name)}" placeholder="Tampil di sampul laporan PDF"></div>
        <div class="field"><label for="pf-wa">Nomor HP/WhatsApp</label><input class="plain" id="pf-wa" type="tel" value="${esc(wa)}" data-awal="${esc(wa)}" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Contoh: 081234567890" aria-describedby="pf-wa-h pf-wa-err"><span class="hint" id="pf-wa-h">Untuk bantuan dan konfirmasi pembayaran. Tidak dipakai untuk iklan dan tidak diverifikasi otomatis.</span>${errSpan('pf-wa')}</div>
        <button class="btn" type="submit">Simpan profil</button>
      </form>
      <div class="row-gap"><a class="btn primary" href="${esc(next)}" style="flex:1">Buka dashboard</a><button class="btn quiet" type="button" id="logout">Keluar</button></div>
      <button class="btn link" type="button" data-view="sandi-baru" style="justify-self:center">Ganti kata sandi</button>`;
    message = null;
  }

  /** Menampilkan/menghapus pesan di bawah kolom. Mengembalikan true bila ada pesan. */
  function fieldErr(input, text) {
    if (!input) return false;
    const err = document.getElementById(`${input.id}-err`);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (err) { err.hidden = !text; err.textContent = text || ''; }
    return !!text;
  }
  /** Pesan untuk satu kolom ('' bila valid). Kolom masuk (sandi lama) hanya dicek tidak kosong, agar akun lama tetap bisa masuk. */
  function cekKolom(input) {
    const v = input.value;
    switch (input.id) {
      case 'em': return !v.trim() ? 'Email wajib diisi.' : !input.checkValidity() ? 'Format email tidak valid. Contoh: nama@toko.com' : '';
      case 'nm': return v.trim() ? '' : 'Nama lengkap wajib diisi.';
      case 'hp': return A.normalisasiHp(v).ok ? '' : A.PESAN_HP;   // opsional: kosong boleh, divalidasi bila diisi
      case 'pf-wa': return v.trim() === input.dataset.awal ? '' : A.normalisasiHp(v).ok ? '' : A.PESAN_HP;
      default:
        if (input.dataset.sama) { const asal = document.getElementById(input.dataset.sama); return !v ? 'Ulangi kata sandi Anda.' : asal && v !== asal.value ? 'Konfirmasi kata sandi belum sama.' : ''; }
        if (input.dataset.baru) return A.pesanSandi(v);
        return v ? '' : 'Kata sandi wajib diisi.';
    }
  }
  const kolomForm = (f) => [...f.querySelectorAll('input')].filter((i) => document.getElementById(`${i.id}-err`));
  /** Validasi semua kolom form sebelum dikirim. Pesan tampil di bawah tiap kolom; fokus ke kolom pertama yang salah. */
  function validate(f) {
    let first = null;
    for (const i of kolomForm(f)) if (fieldErr(i, cekKolom(i)) && !first) first = i;
    if (first) first.focus();
    return !!first;
  }
  /** Daftar syarat kata sandi diperbarui saat mengetik (netral, tanpa warna salah sebelum kolom ditinggalkan). */
  function updateRules(input) {
    const list = document.getElementById(`${input.id}-rules`);
    if (!list) return;
    const h = A.cekSandi(input.value);
    list.querySelectorAll('li').forEach((li) => { const ok = !!h[li.dataset.rule]; li.dataset.ok = String(ok); li.querySelector('.sr').textContent = ok ? ' (terpenuhi)' : ' (belum)'; });
  }
  const busy = (btn, on, label) => {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
  };
  // Kata sandi sengaja tidak disimpan di draft (hanya di kolomnya sendiri).
  const keepDraft = () => { DRAFT_IDS.forEach((id) => { const el = document.getElementById(id); if (el) draft[id] = el.value; }); };
  const restoreDraft = () => { DRAFT_IDS.forEach((id) => { const el = document.getElementById(id); if (el && draft[id] && !el.value) el.value = draft[id]; }); };
  const showErr = (text) => { keepDraft(); message = { text }; render(); restoreDraft(); };

  /**
   * Nomor HP dari pendaftaran ada di metadata akun (belum ada sesi saat daftar dengan konfirmasi email). Setelah masuk,
   * salin ke profiles.whatsapp bila kolom itu masih kosong, lalu hapus dari metadata agar tidak tersimpan dua kali dan
   * tidak menimpa nomor yang kemudian diubah/dikosongkan pengguna. Gagal = dicoba lagi saat masuk berikutnya.
   */
  async function salinHpDaftar() {
    const u = cloud.auth.user(), meta = (u && u.user_metadata) || {};
    if (!meta.whatsapp) return;
    const n = A.normalisasiHp(meta.whatsapp);
    if (n.ok && n.nilai) {
      const p = await cloud.db.profile();
      if (p && !p.whatsapp) await cloud.db.updateProfile({ whatsapp: n.nilai });
    }
    await cloud.auth.updateMetadata({ whatsapp: null });
  }

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    // Pesan validasi tampil di bawah kolomnya; isian tidak dikosongkan.
    if (validate(f)) return;
    if (!online()) return showErr(OFFLINE);
    busy(btn, true, f.id === 'f-auth' ? (view === 'daftar' ? 'Mendaftarkan…' : 'Memeriksa…') : 'Memproses…');
    try {
      if (f.id === 'f-auth') {
        const email = $('#em').value.trim(), password = $('#pw').value;
        if (view === 'daftar') {
          const r = await cloud.auth.signUp({ email, password, fullName: $('#nm').value.trim(), whatsapp: A.normalisasiHp($('#hp').value).nilai, redirectTo: here() });
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
        const wa = $('#pf-wa'), patch = { full_name: $('#pf-name').value.trim(), store_name: $('#pf-store').value.trim() };
        // Nomor lama yang belum berformat +62 tetap dipertahankan apa adanya bila tidak diubah.
        if (wa.value.trim() !== wa.dataset.awal) patch.whatsapp = A.normalisasiHp(wa.value).nilai;
        const saved = await cloud.db.updateProfile(patch);
        if (saved && 'whatsapp' in patch) { wa.value = saved.whatsapp || ''; wa.dataset.awal = wa.value; const aj = $('#wa-ajak'); if (aj && wa.value) aj.remove(); }
        toast('Profil tersimpan.'); busy(btn, false); return;
      }
    } catch (err) {
      if (f.id === 'f-profile') { busy(btn, false); toast(online() ? `Profil belum tersimpan. ${err.message}` : OFFLINE); return; }
      keepDraft(); message = { text: online() ? err.message : OFFLINE };
    }
    render(); restoreDraft();
    // Setelah pesan error dari server: fokus ke kolom kata sandi (pesan tetap dibacakan lewat role="alert").
    if (message && !message.ok && f.id === 'f-auth') { const pw = $('#pw'); if (pw) pw.focus(); }
  });

  /** Pindah ke tujuan hanya bila sesi sudah ada dan penggunanya dikenali server. */
  async function go(text) {
    if (!cloud.auth.user()) { showErr('Sesi tidak dapat diverifikasi. Silakan masuk lagi.'); return; }
    message = { ok: true, text }; render();
    try { await salinHpDaftar(); } catch (e) { /* dicoba lagi saat masuk berikutnya; halaman akun tetap mengajak melengkapi nomor */ }
    ss.del(NEXT_KEY);
    location.href = next;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; message = null; render(); const first = $('#card input'); if (first && t.dataset.view !== 'masuk') first.focus(); }
    else if (t.dataset.eye) {
      const i = $(`#${t.dataset.eye}`), show = i.type === 'password';
      const nama = t.dataset.eyeLabel || 'kata sandi';
      i.type = show ? 'text' : 'password'; t.setAttribute('aria-pressed', String(show)); t.setAttribute('aria-label', `${show ? 'Sembunyikan' : 'Tampilkan'} ${nama}`);
    } else if (t.id === 'g-login') {
      if (!online()) return showErr(OFFLINE);
      busy(t, true, 'Membuka Google…'); track('google');
      try {
        if (next !== 'dashboard.html') ss.set(NEXT_KEY, next);
        location.assign(await cloud.auth.oauthStart('google', here()));
      } catch (err) { busy(t, false); showErr('Masuk dengan Google gagal dimulai. Silakan coba lagi.'); }
    } else if (t.id === 'logout') { await cloud.auth.signOut(); view = 'masuk'; message = { ok: true, text: 'Anda sudah keluar.' }; render(); }
  });
  // Saat mengetik: daftar syarat sandi diperbarui; pesan salah dihapus begitu isian sudah benar (tidak menyalahkan lebih awal).
  document.addEventListener('input', (e) => {
    const i = e.target;
    if (!(i instanceof HTMLInputElement)) return;
    if (i.dataset.baru) updateRules(i);
    // Pesan lama dihapus saat pengguna memperbaiki; dicek ulang ketika kolom ditinggalkan atau form dikirim.
    if (i.getAttribute('aria-invalid') === 'true') fieldErr(i, '');
    const konf = document.querySelector(`[data-sama="${i.id}"]`);
    if (konf && konf.getAttribute('aria-invalid') === 'true' && !cekKolom(konf)) fieldErr(konf, '');
  });
  // Pesan salah baru muncul setelah kolom yang sudah diisi ditinggalkan.
  document.addEventListener('focusout', (e) => {
    const i = e.target;
    if (!(i instanceof HTMLInputElement) || !i.value || !document.getElementById(`${i.id}-err`)) return;
    if (i.form && i.form.id === 'f-auth' && view === 'masuk') return;   // form masuk: hanya dicek saat dikirim
    fieldErr(i, cekKolom(i));
  });

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
