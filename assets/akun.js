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
  // Halaman pembelian Pro (akun.html?view=pro): setelah masuk, kembali ke sini.
  const PRO_VIEW = params.get('view') === 'pro';
  if (PRO_VIEW && !params.get('next')) next = 'akun.html?view=pro';
  // Checkout tamu (tanpa login): ?view=pro → formulir; ?view=bayar → kembali dari Snap; ?view=aktivasi → tautan email.
  const VIEW = params.get('view');
  let tamu = PRO_VIEW || VIEW === 'aktivasi';   // false setelah pengunjung memilih "Masuk"
  let tamuPoll = null;
  const TAMU_KEY = 'cekprofit.tamu';
  const dashHref = () => (/^akun\.html/.test(next) ? 'dashboard.html' : next);
  const here = () => location.href.split('#')[0].split('?')[0];
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500); };
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const OFFLINE = 'Tidak ada koneksi internet. Periksa koneksi Anda, lalu coba lagi.';
  let view = params.get('mode') === 'daftar' ? 'daftar' : 'masuk';
  let message = null;   // { ok?: boolean, text }
  let draft = {};       // isian (selain kata sandi) tetap terisi setelah pesan error
  const DRAFT_IDS = ['em', 'nm', 'hp', 'tm-wa'];

  const eye = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const gLogo = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  // Tombol Google hanya tampil bila pemilik sudah mengaktifkan provider (config.googleLogin = true).
  const google = () => (C.googleLogin ? `<button class="btn g-btn" type="button" id="g-login">${gLogo}<span>Lanjutkan dengan Google</span></button><div class="or">atau gunakan email</div>` : '');
  // Tanda kolom wajib di form Daftar email (dibacakan pembaca layar lewat atribut required, bukan lewat bintang).
  const REQ = ' <span class="req" aria-hidden="true">*</span>';
  const errSpan = (id) => `<span class="field-err" id="${id}-err" hidden></span>`;
  /** Kolom kata sandi. `baru` = kata sandi baru (daftar/ganti): tampilkan daftar syarat yang diperbarui saat mengetik. */
  const pwField = (id, label, auto, placeholder, { baru = false, eyeLabel = 'kata sandi' } = {}) => {
    const rules = baru ? `<ul class="pw-rules" id="${id}-rules" aria-label="Syarat kata sandi">${A.SYARAT.map((x) => `<li data-rule="${x.id}" data-ok="false">${x.teks}<span class="sr"> (belum)</span></li>`).join('')}</ul>` : '';
    return `<div class="field"><label for="${id}">${label}</label><div class="pw"><input class="plain" id="${id}" type="password" autocomplete="${auto}" placeholder="${placeholder}" required aria-describedby="${id}-err${baru ? ` ${id}-rules` : ''}"${baru ? ` data-baru="1" maxlength="${A.SANDI_MAKS}"` : ''}>
    <button class="btn quiet sm" type="button" data-eye="${id}" data-eye-label="${eyeLabel}" aria-label="Tampilkan ${eyeLabel}" aria-pressed="false">${eye}</button></div>${errSpan(id)}${rules}</div>`;
  };
  const emailField = (ph = 'Masukkan email Anda', tanda = '') => `<div class="field"><label for="em">Email${tanda}</label><input class="plain" id="em" type="email" autocomplete="email" inputmode="email" placeholder="${ph}" required aria-describedby="em-err">${errSpan('em')}</div>`;
  const nameField = () => `<div class="field"><label for="nm">Nama lengkap${REQ}</label><input class="plain" id="nm" autocomplete="name" placeholder="Masukkan nama lengkap" maxlength="100" required aria-describedby="nm-err">${errSpan('nm')}</div>`;
  // Wajib untuk daftar dengan email + kata sandi (keputusan pemilik 21 Okt 2026). Pengguna Google dan akun lama tidak
  // diwajibkan; mereka bisa melengkapinya di halaman Akun. Nomor tidak pernah ditandai terverifikasi.
  const phoneField = () => `<div class="field"><label for="hp">Nomor HP/WhatsApp${REQ}</label><input class="plain" id="hp" type="tel" autocomplete="tel" inputmode="tel" placeholder="Contoh: 081234567890" maxlength="20" required aria-describedby="hp-h hp-err">
    <span class="hint" id="hp-h">Untuk menghubungi Anda soal bantuan dan pembayaran. Tidak dipakai untuk iklan dan tidak diverifikasi otomatis.</span>${errSpan('hp')}</div>`;
  const confirmField = (id, of, tanda = '') => pwField(id, 'Konfirmasi kata sandi' + tanda, 'new-password', 'Ulangi kata sandi', { eyeLabel: 'konfirmasi kata sandi' }).replace('<input ', `<input data-sama="${of}" `);
  const msgHtml = () => (message ? `<p class="msg ${message.ok ? 'ok' : 'err'}" role="${message.ok ? 'status' : 'alert'}">${esc(message.text)}</p>` : '');
  const heading = (title, sub) => `<div class="acct-head"><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>`;

  function render() {
    hentikanQris();   // timer & polling QRIS hanya hidup selama panel QR tampil
    clearTimeout(tamuPoll); tamuPoll = null;
    const card = $('#card');
    if (!cloud.enabled) {
      // Di alamat staging yang konfigurasinya belum siap, akun sengaja dimatikan (fail-closed) agar tidak menulis ke database produksi.
      const belumSiap = C.lingkungan === 'staging-belum-siap';
      card.innerHTML = `${heading(belumSiap ? 'Konfigurasi staging belum siap' : 'Akun belum aktif', belumSiap ? 'Alamat ini adalah lingkungan uji. Fitur akun dan pembayaran dimatikan sampai database staging terhubung dengan benar, agar tidak tersambung ke database produksi. Anda tetap bisa mencoba dashboard tanpa login.' : 'Pemilik situs belum menghubungkan layanan akun. Anda tetap bisa memakai Cek Untung tanpa login; modal dan pengaturan tersimpan di browser ini.')}
        <a class="btn primary" href="dashboard.html">Buka dashboard</a>`;
      return;
    }
    const user = cloud.auth.user();
    if (view === 'sandi-baru') {
      card.innerHTML = `${heading('Buat kata sandi baru', 'Gunakan kata sandi yang tidak Anda pakai di situs lain.')}${msgHtml()}
        <form id="f-new" novalidate>${pwField('pw1', 'Kata sandi baru', 'new-password', 'Buat kata sandi', { baru: true })}${confirmField('pw1b', 'pw1')}<button class="btn primary" type="submit">Simpan kata sandi</button></form>`;
      return;
    }
    if (VIEW === 'bayar') return renderBayar(card);
    if (user) return PRO_VIEW ? renderPro(card, user) : renderAccount(card, user);
    if (tamu && VIEW === 'aktivasi' && view === 'masuk') return renderTautan(card);
    if (tamu && PAY_READY && view === 'masuk' && !params.get('mode')) return renderTamu(card);
    if (view === 'lupa') {
      card.innerHTML = `${heading('Lupa kata sandi', 'Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.')}${msgHtml()}
        <form id="f-lupa" novalidate>${emailField()}<button class="btn primary" type="submit">Kirim tautan</button></form>
        <p class="switch"><button class="btn link" type="button" data-view="masuk">Kembali ke halaman masuk</button></p>`;
      return;
    }
    const daftar = view === 'daftar';
    card.innerHTML = `<div class="auth-tabs" role="tablist" aria-label="Masuk atau daftar"><button type="button" role="tab" data-view="masuk" aria-selected="${!daftar}">Masuk</button><button type="button" role="tab" data-view="daftar" aria-selected="${daftar}">Daftar</button></div>
      ${heading(daftar ? 'Buat akun gratis' : 'Masuk ke Cek Untung', PRO_VIEW ? 'Pembelian Pro terhubung ke akun Anda. Masuk atau daftar terlebih dahulu.' : daftar ? 'Simpan modal produk dan riwayat laporan, lalu buka dari perangkat mana pun.' : 'Selamat datang kembali. Lanjutkan cek laba toko Anda.')}
      ${msgHtml()}${google()}
      <form id="f-auth" novalidate>
        ${daftar ? `<p class="tiny faint req-note">Kolom bertanda <span class="req" aria-hidden="true">*</span> wajib diisi.</p>${nameField()}` : ''}
        ${daftar ? emailField('contoh@email.com', REQ) : emailField()}
        ${daftar ? phoneField() : ''}
        ${daftar ? pwField('pw', `Kata sandi${REQ}`, 'new-password', 'Buat kata sandi', { baru: true }) + confirmField('pw2', 'pw', REQ) : pwField('pw', 'Kata sandi', 'current-password', 'Masukkan kata sandi')}
        ${daftar ? '<p class="tiny faint">Dengan mendaftar, Anda menyetujui <a href="privasi.html">ketentuan &amp; privasi</a>.</p>' : '<button class="btn link forgot" type="button" data-view="lupa">Lupa kata sandi?</button>'}
        <button class="btn primary" type="submit">${daftar ? 'Daftar gratis' : 'Masuk'}</button>
      </form>
      <p class="switch">${daftar ? 'Sudah punya akun?' : 'Belum punya akun?'} <button class="btn link" type="button" data-view="${daftar ? 'masuk' : 'daftar'}">${daftar ? 'Masuk' : 'Daftar gratis'}</button></p>`;
  }

  // Pembelian Pro dibuka hanya bila proPembayaranAktif = true (sama dengan dashboard); tidak bergantung WhatsApp.
  const PAY_READY = C.proPembayaranAktif === true;
  /** Ringkasan harga Pro dari config (tidak menampilkan hitung mundur maupun jumlah slot promosi). */
  const hargaSingkat = () => { const pr = C.prices || {}; return pr.pro ? `Pro ${pr.pro} ${pr.proUnit || ''}${pr.proLabel ? ` (${pr.proLabel.toLowerCase()})` : ''}. Laporan PDF dan analisis lengkap.`.replace(/\s+\./, '.') : 'Laporan PDF & analisis lengkap ada di Pro'; };
  async function renderAccount(card, user) {
    card.innerHTML = '<p class="muted" role="status">Memuat akun…</p>';
    const klaim = await klaimTamu();
    const salin = await salinHpDaftar();
    let p = null, reqs = [];
    try { [p, reqs] = await Promise.all([cloud.db.profile(), cloud.db.myRequests().catch(() => [])]); } catch (e) { message = { text: e.message }; }
    // Sesi ditolak server (mis. kedaluwarsa) → kembali ke halaman masuk, bukan tampil seolah masih masuk.
    if (!cloud.auth.user()) { view = 'masuk'; return render(); }
    const pro = cloud.isPro(p);
    const gagalSalin = salin.status === 'gagal' && !(p && p.whatsapp);
    // Nomor dari pendaftaran yang belum tersimpan diisikan ulang di kolom (belum tersimpan, jadi data-awal kosong).
    const wa = (p && p.whatsapp) || '', waIsi = gagalSalin ? salin.nomor : wa;
    const ajakWa = gagalSalin
      ? '<p class="msg err" id="wa-ajak" role="alert">Nomor HP/WhatsApp dari pendaftaran belum tersimpan ke akun Anda. Periksa nomor di bawah, lalu tekan Simpan profil.</p>'
      // Pengguna Google (atau akun lama) belum punya nomor: ajak melengkapi, tidak memblokir.
      : !wa ? '<p class="msg info" id="wa-ajak">Lengkapi nomor WhatsApp Anda agar kami bisa membantu bila ada kendala atau saat konfirmasi pembayaran.</p>' : '';
    const pending = (reqs || []).find((r) => r.status === 'baru' || r.status === 'diproses');
    card.innerHTML = `${heading('Akun saya', esc(user.email || ''))}${msgHtml()}${klaim}${ajakWa}
      <div class="plan"><div><b>${pro ? (cloud.isProSekaliBayar(p) ? 'Pro sekali bayar' : 'Pro') : 'Gratis'}</b><span class="small muted">${pro ? (cloud.isProSekaliBayar(p) ? 'Aktif selama layanan Cek Untung beroperasi' : `Aktif sampai ${fmtDate(p.pro_until)}`) : pending ? 'Permintaan Pro sedang diproses' : esc(hargaSingkat())}</span></div>
        ${pro ? '<span class="badge pro">PRO</span>' : pending ? '<a class="btn sm" href="akun.html?view=pro">Lihat status</a>' : PAY_READY ? '<a class="btn sm" href="akun.html?view=pro">Beli Pro</a>' : '<span class="badge">Pro segera hadir</span>'}</div>
      <form id="f-profile">
        <div class="field"><label for="pf-name">Nama lengkap</label><input class="plain" id="pf-name" value="${esc(p && p.full_name)}" autocomplete="name" maxlength="100" placeholder="Masukkan nama lengkap"></div>
        <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(p && p.store_name)}" placeholder="Tampil di sampul laporan PDF"></div>
        <div class="field"><label for="pf-wa">Nomor HP/WhatsApp</label><input class="plain" id="pf-wa" type="tel" value="${esc(waIsi)}" data-awal="${esc(wa)}" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Contoh: 081234567890" aria-describedby="pf-wa-h pf-wa-err"><span class="hint" id="pf-wa-h">Untuk bantuan dan konfirmasi pembayaran. Tidak dipakai untuk iklan dan tidak diverifikasi otomatis.</span>${errSpan('pf-wa')}</div>
        <button class="btn" type="submit">Simpan profil</button>
      </form>
      <div class="row-gap"><a class="btn primary" href="${esc(dashHref())}" style="flex:1">Buka dashboard</a><button class="btn quiet" type="button" id="logout">Keluar</button></div>
      <button class="btn link" type="button" data-view="sandi-baru" style="justify-self:center">Ganti kata sandi</button>`;
    message = null;
  }

  /* ---------------- Pembelian Pro (checkout manual: transfer bank / QRIS) ----------------
   * Kode pesanan, nominal, dan status dibuat server (supabase/usulan/pro-sekali-bayar.sql). Browser hanya menampilkan.
   * "Saya sudah membayar" hanya klaim pembeli (Menunggu verifikasi); Pro aktif setelah admin menemukan dana di mutasi. */
  const STATUS_PESANAN = { baru: 'Menunggu pembayaran', diproses: 'Menunggu verifikasi', perlu_cek: 'Perlu pemeriksaan', selesai: 'Aktif', ditolak: 'Gagal', dibatalkan: 'Dibatalkan', direfund: 'Dana dikembalikan' };
  const METODE = { transfer: 'Transfer bank', qris: 'QRIS' };
  const GAMBAR_QRIS = /^img\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp)$/;
  const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;
  const tglWaktu = (d) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  /** Harga dari server bila ada (nominal tagihan resmi); label & harga reguler yang direncanakan dari config. */
  function hargaBlok(hargaServer) {
    const pr = C.prices || {};
    const now = hargaServer ? rupiah(hargaServer) : pr.pro;
    if (!now) return '';
    return `<div class="harga-pro">${pr.proLabel ? `<span class="hp-label">${esc(pr.proLabel)}</span>` : ''}
      ${pr.proRegular ? `<span class="hp-was">Harga reguler yang direncanakan <s>${esc(pr.proRegular)}</s></span>` : ''}
      <span class="hp-now"><b>${esc(now)}</b> ${esc(pr.proUnit || 'sekali bayar')}</span><span class="hp-note">Bayar satu kali, tanpa tagihan bulanan atau tahunan.</span></div>`;
  }
  const metodeTersedia = (s) => ({
    transfer: !!(s && s.bank_nama && s.bank_nomor && s.bank_pemilik),
    // img/qris-uji*.png = gambar simulasi staging; di luar staging terverifikasi dianggap tidak ada (QRIS tidak ditawarkan).
    qris: !!(s && s.qris_merchant && GAMBAR_QRIS.test(s.qris_gambar || '') && (!/^img\/qris-uji/i.test(s.qris_gambar) || C.lingkungan === 'staging')),
  });
  const SIAPKAN = '<p class="msg info">Metode pembayaran sedang disiapkan. Semua fitur gratis tetap bisa Anda pakai.</p>';
  const salin = (v, label) => `<button class="btn link sm" type="button" data-salin="${esc(v)}" aria-label="Salin ${label}">Salin</button>`;
  function instruksi(o, s) {
    const langkahAkhir = o.status === 'baru' ? '<li>Setelah berhasil, tekan <b>Saya sudah membayar</b> dan isi waktu bayar serta nama pengirim.</li>' : '';
    const kode = `<div><dt>Kode pesanan</dt><dd><b class="mono">${esc(o.order_code)}</b> ${salin(o.order_code, 'kode pesanan')}</dd></div>`;
    if (o.metode === 'qris') {
      return `<div class="pay-box"><img class="qris" src="${esc(s.qris_gambar)}" alt="Kode QRIS ${esc(s.qris_merchant)}" width="220" height="220">
        <p class="small">Merchant: <b>${esc(s.qris_merchant)}</b>${s.qris_nmid ? ` · NMID ${esc(s.qris_nmid)}` : ''} · <a href="${esc(s.qris_gambar)}" download>Unduh QRIS</a></p>
        <dl class="pay-dl">${kode}</dl>
        <ol class="steps"><li>Pindai dengan aplikasi bank atau dompet digital. Pastikan nama merchant sama dengan di atas.</li>
        <li>Ketik nominal sendiri, tepat <b>${rupiah(o.amount)}</b>.</li>${langkahAkhir}</ol>
        <p class="tiny faint">QRIS ini statis dan sama untuk semua pembeli, jadi gambar ini memang boleh dilihat dan diunduh siapa pun. Kode pesanan tidak muncul di laporan QRIS; karena itu kami mencocokkan pembayaran dari waktu dan nama yang Anda isi saat konfirmasi.</p></div>`;
    }
    return `<div class="pay-box"><dl class="pay-dl"><div><dt>Bank</dt><dd>${esc(s.bank_nama)}</dd></div>
        <div><dt>Nomor rekening</dt><dd><b class="mono">${esc(s.bank_nomor)}</b> ${salin(s.bank_nomor, 'nomor rekening')}</dd></div>
        <div><dt>Atas nama</dt><dd>${esc(s.bank_pemilik)}</dd></div>${kode}</dl>
      <ol class="steps"><li>Transfer tepat <b>${rupiah(o.amount)}</b>.</li><li>Bila aplikasi bank Anda mendukung, tulis kode pesanan di berita/keterangan transfer.</li>${langkahAkhir}</ol></div>`;
  }
  function panelPesanan(o, s, tersedia) {
    const batas = new Date(new Date(o.created_at).getTime() + (Number(s && s.batas_jam) || 48) * 36e5);
    const lewat = o.status === 'baru' && batas < new Date();
    const lain = o.metode === 'transfer' ? 'qris' : 'transfer';
    let aksi = '';
    if (o.status === 'baru' && !lewat) {
      aksi = `<div class="field"><label for="k-catatan">Waktu bayar dan nama pengirim (disarankan)</label><input class="plain" id="k-catatan" maxlength="200" placeholder="Contoh: 21 Okt 14.05, a.n. Siti Aminah">
          <span class="hint">Jangan menulis nomor kartu, PIN, atau kode OTP.</span></div>
        <button class="btn primary" type="button" data-konfirmasi="${o.id}">Saya sudah membayar</button>
        <p class="tiny faint">Tombol ini hanya memberi tahu kami. Pro aktif setelah dana kami temukan di mutasi ${o.metode === 'qris' ? 'QRIS' : 'rekening'}; tangkapan layar saja tidak cukup.</p>
        <div class="row-gap">${tersedia[lain] ? `<button class="btn sm" type="button" data-beli="${lain}">Ganti ke ${METODE[lain]}</button>` : ''}<button class="btn sm quiet" type="button" data-batal="${o.id}">Batalkan pesanan</button></div>`;
    } else if (lewat) {
      aksi = `<p class="msg info">Batas waktu pembayaran (${Number(s && s.batas_jam) || 48} jam) sudah lewat. Bila Anda sudah membayar, beri tahu kami agar diperiksa manual; dana Anda tidak hangus. Bila belum, buat pesanan baru.</p>
        <div class="field"><label for="k-catatan">Waktu bayar dan nama pengirim</label><input class="plain" id="k-catatan" maxlength="200" placeholder="Contoh: 23 Okt 09.10, a.n. Siti Aminah"></div>
        <div class="row-gap"><button class="btn" type="button" data-konfirmasi="${o.id}">Saya sudah membayar</button><button class="btn primary" type="button" data-beli="${esc(o.metode)}">Buat pesanan baru</button></div>`;
    } else if (o.status === 'diproses') {
      aksi = '<p class="msg info">Terima kasih. Kami sedang mencocokkan pembayaran Anda dengan mutasi. Konfirmasi Anda belum berarti pembayaran berhasil; Pro aktif setelah dana ditemukan.</p>';
    } else if (o.status === 'perlu_cek') {
      aksi = '<p class="msg info">Pembayaran Anda sedang diperiksa manual (misalnya karena dibayar setelah batas waktu atau ada beberapa pembayaran serupa). Pro aktif setelah pemeriksaan selesai; bila tidak cocok, dana dikembalikan sesuai kebijakan refund. Kami mungkin menghubungi Anda lewat email akun.</p>';
    }
    return `<section class="order" aria-label="Pesanan ${esc(o.order_code)}">
      <div class="order-head"><span class="small muted">Pesanan</span><b class="mono">${esc(o.order_code)}</b><span class="badge st-${esc(o.status)}">${esc(STATUS_PESANAN[o.status] || o.status)}</span></div>
      <dl class="pay-dl"><div><dt>Total dibayar</dt><dd><b>${rupiah(o.amount)}</b></dd></div><div><dt>Metode</dt><dd>${esc(METODE[o.metode] || '-')}</dd></div>
        ${o.status === 'baru' ? `<div><dt>Bayar sebelum</dt><dd>${tglWaktu(batas)}</dd></div>` : ''}</dl>
      ${(o.status === 'baru' && !lewat) || o.status === 'diproses' || o.status === 'perlu_cek' ? instruksi(o, s) : ''}
      ${aksi}</section>`;
  }
  async function renderPro(card, user) {
    card.innerHTML = '<p class="muted" role="status">Memuat pembelian…</p>';
    let p = null;
    try { p = await cloud.db.profile(); } catch (e) { message = { text: e.message }; }
    if (!cloud.auth.user()) { view = 'masuk'; return render(); }
    const head = `${heading('Beli Cek Untung Pro', esc(user.email || ''))}${msgHtml()}`;
    const kembali = '<p class="switch"><a class="btn link" href="akun.html">Kembali ke akun</a></p>';
    message = null;
    if (cloud.isProSekaliBayar(p)) {
      card.innerHTML = `${head}<p class="msg ok">Pro sekali bayar sudah aktif di akun ini, selama layanan Cek Untung beroperasi.</p><a class="btn primary" href="dashboard.html">Buka dashboard</a>${kembali}`;
      return;
    }
    // Selama pembelian belum dibuka (config), database pembayaran tidak dihubungi sama sekali.
    if (!PAY_READY) { card.innerHTML = `${head}${hargaBlok()}${SIAPKAN}${kembali}`; return; }
    let s = null, orders = [];
    try { [s, orders] = await Promise.all([cloud.db.pengaturanPembayaran(), cloud.db.pesananSaya()]); } catch (e) { s = null; orders = []; }
    const tersedia = metodeTersedia(s);
    const open = (orders || []).find((o) => ['baru', 'diproses', 'perlu_cek'].includes(o.status));
    const lama = (orders || []).filter((o) => o !== open).slice(0, 5);
    // Pesanan yang kedaluwarsa otomatis masih bisa diklaim "sudah membayar" (≤ 30 hari) → diperiksa manual, dana tidak hangus.
    const bisaKlaim = (o) => !open && o.status === 'dibatalkan' && o.expired_at && Date.now() - new Date(o.expired_at).getTime() < 30 * 864e5;
    const riwayat = lama.length ? `<details class="riwayat" ${lama.some(bisaKlaim) ? 'open' : ''}><summary class="small">Riwayat pesanan</summary><ul>${lama.map((o) => `<li><span class="mono">${esc(o.order_code || '-')}</span> · ${tglWaktu(o.created_at)} · ${esc(STATUS_PESANAN[o.status] || o.status)}${o.expired_at ? ' (kedaluwarsa)' : ''}${bisaKlaim(o) ? ` <button class="btn link sm" type="button" data-konfirmasi="${o.id}">Saya sudah membayar pesanan ini</button>` : ''}</li>`).join('')}</ul></details>` : '';
    const kontak = s && s.kontak_bantuan ? `<p class="tiny faint">Butuh bantuan pembayaran? Hubungi ${esc(s.kontak_bantuan)}. Jangan kirim file laporan toko atau data pembeli.</p>` : '';
    if (s && s.mode === 'otomatis') { renderOtomatis(card, { head, s, open, kontak, riwayat, kembali }); return; }
    const siap = !!(s && s.aktif && (tersedia.transfer || tersedia.qris));
    if (open) { card.innerHTML = `${head}${panelPesanan(open, s || {}, tersedia)}${kontak}${riwayat}${kembali}`; return; }
    if (!siap) { card.innerHTML = `${head}${hargaBlok()}${SIAPKAN}${riwayat}${kembali}`; return; }
    const pilihan = ['transfer', 'qris'].filter((m) => tersedia[m]);
    card.innerHTML = `${head}${hargaBlok(s.harga_pro)}
      <ul class="benefits"><li>Laporan PDF dengan nama dan logo toko</li><li>Semua produk dan saran harga</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
      <p class="tiny faint">Akses Pro berlaku untuk akun ini selama layanan Cek Untung beroperasi. Fitur berbayar baru di masa depan tidak otomatis termasuk. <a href="privasi.html">Ketentuan</a></p>
      <fieldset class="metode"><legend class="small"><b>Pilih metode pembayaran</b></legend>
        ${pilihan.map((m, i) => `<label class="plan-opt"><input type="radio" name="metode" value="${m}" ${i === 0 ? 'checked' : ''}><span><b>${METODE[m]}</b></span><span class="small muted">${m === 'qris' ? 'Pindai kode QRIS' : 'Transfer ke rekening resmi'}</span></label>`).join('')}
      </fieldset>
      <button class="btn primary" type="button" id="buat-pesanan">Buat pesanan</button>
      <p class="tiny faint">Bayar dalam ${Number(s.batas_jam) || 48} jam setelah pesanan dibuat. Pro aktif setelah dana kami verifikasi di mutasi resmi.</p>
      ${kontak}${riwayat}${kembali}`;
  }
  /* ---------------- Checkout tamu (tanpa login, Midtrans Snap redirect) ----------------
   * Harga & halaman Snap dari server. Pro TIDAK aktif dari halaman ini: aktif setelah pembeli membuka tautan aktivasi yang
   * dikirim ke emailnya (klaim_pembelian_tamu di database memeriksa email terkonfirmasi + sesi dari tautan email). */
  // Pesanan tamu terakhir {kode, email, token} di browser ini (localStorage, fallback sessionStorage). Token hanya membuat
  // browser yang sama memakai ulang tautan pembayarannya; bila hilang, pembeli tetap bisa membayar (pesanan baru) dan aktivasi.
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } } };
  const tamuSesi = {
    get: () => { try { return JSON.parse(ls.get(TAMU_KEY) || ss.get(TAMU_KEY) || 'null'); } catch (e) { return null; } },
    set: (v) => { const t = JSON.stringify(v); ls.set(TAMU_KEY, t); ss.set(TAMU_KEY, t); },
  };
  const urlAktivasi = () => `${here()}?view=aktivasi`;
  function renderTamu(card) {
    card.innerHTML = `${heading('Beli Cek Untung Pro', 'Tanpa perlu daftar dulu. Akun dibuat otomatis dari email Anda setelah pembayaran berhasil.')}${msgHtml()}${hargaBlok()}
      <ul class="benefits"><li>Laporan PDF dengan nama dan logo toko</li><li>Semua produk dan saran harga</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
      <form id="f-tamu" novalidate>
        <p class="tiny faint req-note">Kolom bertanda <span class="req" aria-hidden="true">*</span> wajib diisi.</p>
        ${nameField()}${emailField('contoh@email.com', REQ)}
        <p class="tiny faint">Tautan aktivasi akun dikirim ke email ini. Pro aktif setelah Anda membuka tautan tersebut.</p>
        <div class="field"><label for="tm-wa">Nomor WhatsApp (opsional)</label><input class="plain" id="tm-wa" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Contoh: 081234567890" aria-describedby="tm-wa-err">${errSpan('tm-wa')}</div>
        <button class="btn primary" type="submit">Bayar dengan QRIS</button>
        <p class="tiny faint">Anda akan diarahkan ke halaman pembayaran Midtrans. Nominal terisi otomatis; kode QRIS berlaku 15 menit. Dengan membeli, Anda menyetujui <a href="privasi.html#pro">ketentuan pembelian</a> dan <a href="privasi.html#refund">kebijakan pengembalian dana</a>.</p>
      </form>
      <p class="switch">Sudah punya akun? <button class="btn link" type="button" data-masuk-akun>Masuk</button></p>`;
    message = null;
  }
  function renderTautan(card) {
    card.innerHTML = `${heading('Aktivasi pembelian Pro', 'Masukkan email yang Anda pakai saat membayar. Kami kirim tautan masuk; Pro aktif setelah Anda membukanya.')}${msgHtml()}
      <form id="f-tautan" novalidate>${emailField()}<button class="btn primary" type="submit">Kirim tautan aktivasi</button></form>
      <p class="switch"><button class="btn link" type="button" data-masuk-akun>Masuk dengan kata sandi</button></p>`;
    message = null;
  }
  const PESAN_TAMU = {
    menunggu: 'Kami belum menerima pembayaran Anda. Bila Anda sudah membayar, tunggu sebentar; halaman ini memeriksa otomatis.',
    lunas: 'Pembayaran berhasil. Kami mengirim tautan aktivasi ke email Anda. Buka tautan itu untuk mengaktifkan Pro.',
    diklaim: 'Pembayaran berhasil dan Pro sudah aktif di akun Anda.',
    perlu_cek: 'Pembayaran Anda sedang diperiksa manual. Kami akan menghubungi Anda lewat email.',
    kedaluwarsa: 'Waktu pembayaran habis. Silakan ulangi pembelian.', batal: 'Pembayaran dibatalkan. Silakan ulangi pembelian.',
    gagal: 'Pembayaran tidak berhasil. Silakan ulangi pembelian.', direfund: 'Dana untuk pesanan ini sudah dikembalikan.',
  };
  async function renderBayar(card, paksa = true, ke = 0) {
    const s = tamuSesi.get();
    if (!s || !s.kode) {
      card.innerHTML = `${heading('Status pembayaran', '')}<p class="msg info">Bila Anda sudah membayar, buka email Anda untuk tautan aktivasi. Tidak menerima email?</p>
        <a class="btn primary" href="akun.html?view=aktivasi">Kirim ulang tautan aktivasi</a>`;
      return;
    }
    if (ke === 0) card.innerHTML = `${heading('Status pembayaran', `Pesanan ${esc(s.kode)}`)}<p class="muted" role="status">Memeriksa pembayaran…</p>`;
    let r;
    try { r = await cloud.db.tamuStatus(s.kode, s.email, paksa); } catch (err) { card.innerHTML = `${heading('Status pembayaran', `Pesanan ${esc(s.kode)}`)}<p class="msg err" role="alert">${esc(online() ? err.message : OFFLINE)}</p><button class="btn" type="button" data-cek-tamu>Coba lagi</button>`; return; }
    if (VIEW !== 'bayar' || !$('#card')) return;
    const selesai = ['lunas', 'diklaim'].includes(r.status);
    const emailGagal = r.status === 'lunas' && r.email_status === 'gagal';
    const aksi = r.status === 'menunggu' ? `${snapSah(r.snap_url) ? `<a class="btn primary" href="${esc(r.snap_url)}">Lanjutkan pembayaran</a>` : ''}<button class="btn sm" type="button" data-cek-tamu>Cek status</button>`
      : emailGagal ? '<button class="btn primary" type="button" data-cek-tamu>Kirim ulang tautan aktivasi</button>'
      : ['kedaluwarsa', 'batal', 'gagal'].includes(r.status) ? '<a class="btn primary" href="akun.html?view=pro">Ulangi pembelian</a>' : '';
    const pesan = r.status === 'menunggu' ? 'Selesaikan pembayaran di halaman Midtrans. Bila halaman itu tertutup, tekan <b>Lanjutkan pembayaran</b>; tagihannya tetap sama.'
      : emailGagal ? 'Pembayaran berhasil, tetapi email aktivasi belum terkirim. Tekan tombol di bawah untuk mengirim ulang.' : esc(PESAN_TAMU[r.status] || r.status);
    card.innerHTML = `${heading(selesai ? 'Pembayaran berhasil' : 'Status pembayaran', esc(s.email))}
      ${panelBayar({ kode: s.kode, amount: r.amount, status: LABEL_STATUS[r.status] || '', pesan, ok: selesai, aksi })}
      ${r.status === 'lunas' && !emailGagal ? '<p class="tiny faint">Tidak menemukan email? Periksa folder Spam/Promosi, atau <a href="akun.html?view=aktivasi">kirim ulang tautan aktivasi</a>.</p>' : ''}
      <p class="switch"><a class="btn link" href="dashboard.html">Buka dashboard</a></p>`;
    // Periksa ulang otomatis selama masih menunggu (maks. ±5 menit); sumber kebenaran tetap server/Midtrans.
    if (r.status === 'menunggu' && ke < 60) tamuPoll = setTimeout(() => renderBayar(card, false, ke + 1), 5000);
  }
  /** Klaim pembelian tamu milik email akun ini (database memeriksa email terkonfirmasi + sesi dari tautan email). */
  async function klaimTamu() {
    if (!PAY_READY) return '';
    let k;
    try { k = await cloud.db.klaimPembelian(); } catch (e) { return ''; }   // migrasi belum ada / offline: abaikan
    if (k && k.aktif > 0) return '<p class="msg ok" role="status">Pembelian Pro Anda sudah aktif di akun ini. Agar bisa masuk dengan kata sandi lain kali, buat kata sandi lewat tombol <b>Ganti kata sandi</b> di bawah.</p>';
    if (k && k.ganda > 0) return '<p class="msg info">Kami menerima pembayaran Pro tambahan untuk akun yang sudah Pro. Tim kami akan memproses pengembalian dana sesuai kebijakan refund.</p>';
    if (k && k.perlu_tautan_email) return `<div class="msg info"><p>Ada pembelian Pro untuk email ini. Untuk keamanan, aktifkan lewat tautan yang kami kirim ke email Anda.</p><button class="btn sm" type="button" data-kirim-aktivasi>Kirim tautan aktivasi</button></div>`;
    return '';
  }

  /* ---------------- Pembayaran otomatis: Midtrans Snap redirect (QRIS), sama untuk tamu & pengguna login ----------------
   * Nominal & halaman Snap dari server; Pro aktif setelah server memverifikasi pembayaran ke Midtrans (webhook/Get Status),
   * bukan karena browser kembali dari Snap. Satu percobaan terbuka per pesanan → "Lanjutkan pembayaran" tidak menagih ganda. */
  let qris = null;   // { order, g, poll, ke, cek }
  function hentikanQris() { if (qris) clearTimeout(qris.poll); qris = null; }
  const snapSah = (u) => /^https:\/\//.test(u || '');
  /** Panel status pembayaran (dipakai checkout login & tamu agar tampilannya sama). */
  function panelBayar({ kode, amount, status, pesan, ok, aksi }) {
    return `<section class="order" aria-label="Pesanan ${esc(kode)}">
      <div class="order-head"><span class="small muted">Pesanan</span><b class="mono">${esc(kode)}</b>${status ? `<span class="badge">${esc(status)}</span>` : ''}</div>
      <dl class="pay-dl"><div><dt>Total</dt><dd><b>${amount ? rupiah(amount) : '-'}</b></dd></div><div><dt>Metode</dt><dd>QRIS (Midtrans)</dd></div></dl>
      <div class="pay-box" aria-live="polite"><p class="msg ${ok ? 'ok' : 'info'}" role="status"><span>${pesan}</span></p>${aksi ? `<div class="row-gap">${aksi}</div>` : ''}</div>
      </section>`;
  }
  const LABEL_STATUS = { menunggu: 'Menunggu pembayaran', lunas: 'Lunas', diklaim: 'Lunas', kedaluwarsa: 'Kedaluwarsa', batal: 'Dibatalkan', gagal: 'Gagal', perlu_cek: 'Diperiksa', direfund: 'Dikembalikan', refund_sebagian: 'Dikembalikan sebagian' };
  const tombolCek = '<button class="btn sm" type="button" data-qris-cek>Cek status</button>';
  function qrisHtml(g, o) {
    const sisa = g ? new Date(g.berlaku_sampai).getTime() - Date.now() : 0;
    if (g && g.status === 'menunggu' && sisa > 0 && snapSah(g.snap_url)) {
      return panelBayar({ kode: o.order_code, amount: g.amount, status: LABEL_STATUS.menunggu,
        pesan: 'Selesaikan pembayaran di halaman Midtrans. Bila halaman itu tertutup, tekan <b>Lanjutkan pembayaran</b>; tagihannya tetap sama. Pro aktif otomatis setelah pembayaran terverifikasi.',
        aksi: `<a class="btn primary" href="${esc(g.snap_url)}">Lanjutkan pembayaran</a>${tombolCek}` });
    }
    if (g && g.status === 'perlu_cek') return panelBayar({ kode: o.order_code, amount: g.amount, status: LABEL_STATUS.perlu_cek, pesan: 'Pembayaran Anda sedang diperiksa manual. Pro aktif setelah pemeriksaan selesai; bila tidak cocok, dana dikembalikan sesuai kebijakan refund.' });
    const pernah = g && ['menunggu', 'kedaluwarsa', 'batal', 'gagal'].includes(g.status);
    return panelBayar({ kode: o.order_code, amount: (g && g.amount) || o.amount, status: pernah ? LABEL_STATUS[g.status === 'menunggu' ? 'kedaluwarsa' : g.status] : '',
      pesan: pernah ? 'Waktu pembayaran sebelumnya sudah habis atau tidak berhasil. Bila Anda sempat membayar, tekan <b>Cek status</b>; dana tidak hangus.' : 'Lanjutkan ke halaman pembayaran Midtrans untuk membayar dengan QRIS.',
      aksi: `<button class="btn primary" type="button" data-qris-baru>Bayar dengan QRIS</button>${pernah ? tombolCek : ''}` });
  }
  function tampilQris() { const b = $('#qris-box'); if (b && qris) b.innerHTML = qrisHtml(qris.g, qris.order); }
  function qrisLunas() { hentikanQris(); toast('Pembayaran berhasil. Pro sudah aktif.'); render(); }
  function renderOtomatis(card, { head, s, open, kontak, riwayat, kembali }) {
    if (!s.aktif) { card.innerHTML = `${head}${hargaBlok()}${SIAPKAN}${riwayat}${kembali}`; return; }
    if (!open) {
      card.innerHTML = `${head}${hargaBlok(s.harga_pro)}
        <ul class="benefits"><li>Laporan PDF dengan nama dan logo toko</li><li>Semua produk dan saran harga</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
        <p class="tiny faint">Akses Pro berlaku untuk akun ini selama layanan Cek Untung beroperasi. Fitur berbayar baru di masa depan tidak otomatis termasuk. <a href="privasi.html#pro">Ketentuan pembelian</a> · <a href="privasi.html#refund">Pengembalian dana</a></p>
        <button class="btn primary" type="button" id="bayar-qris">Bayar dengan QRIS</button>
        <p class="tiny faint">Anda akan diarahkan ke halaman pembayaran Midtrans. Nominal ${rupiah(s.harga_pro)} terisi otomatis; kode QRIS berlaku ${Number(s.qr_berlaku_menit) || 15} menit. Pro aktif otomatis setelah pembayaran terverifikasi.</p>
        ${kontak}${riwayat}${kembali}`;
      return;
    }
    const info = open.status === 'perlu_cek' ? '<p class="msg info">Pembayaran Anda sedang diperiksa manual (misalnya nominal tidak sesuai). Pro aktif setelah pemeriksaan selesai; bila tidak cocok, dana dikembalikan sesuai kebijakan refund.</p>'
      : open.status === 'diproses' ? '<p class="msg info">Kami sedang memverifikasi pembayaran Anda.</p>' : '';
    if (open.status !== 'baru') { card.innerHTML = `${head}${panelBayar({ kode: open.order_code, amount: open.amount, status: STATUS_PESANAN[open.status] || open.status, pesan: info.replace(/<\/?p[^>]*>/g, '') })}${kontak}${riwayat}${kembali}`; return; }
    card.innerHTML = `${head}<div id="qris-box"><p class="muted" role="status">Memeriksa pembayaran…</p></div>${kontak}${riwayat}${kembali}`;
    qris = { order: open, g: null, ke: 0 };
    cekQris(false);
  }
  /** Buka halaman Snap untuk pesanan ini (memakai percobaan terbuka bila ada → tanpa tagihan ganda). */
  async function bayarSnap(btn, ambilPesanan) {
    if (!online()) return toast(OFFLINE);
    busy(btn, true, 'Membuka pembayaran…');
    try {
      const x = await ambilPesanan(); const order = Array.isArray(x) ? x[0] : x;
      if (!order || !order.id) throw new Error('Pesanan belum berhasil dibuat. Silakan coba lagi.');
      const r = await cloud.db.qrisBuat(order.id);
      if (r && r.status === 'selesai') return qrisLunas();
      const g = r && r.percobaan;
      if (!g || !snapSah(g.snap_url)) throw new Error('Halaman pembayaran belum tersedia. Silakan coba lagi.');
      track('checkout_snap'); location.assign(g.snap_url);
    } catch (err) { message = { text: online() ? err.message : OFFLINE }; busy(btn, false); render(); }
  }
  async function cekQris(paksa) {
    const st = qris;
    if (!st || st.cek) return;
    if (!online()) { if (paksa) toast(OFFLINE); if (!st.g) tampilQris(); return; }
    st.cek = true;
    try {
      const r = await cloud.db.qrisCek(st.order.id, paksa);
      if (qris !== st) return;
      if (r.pro || (r.pesanan && r.pesanan.status === 'selesai')) return qrisLunas();
      if (r.pesanan && r.pesanan.status !== 'baru') { hentikanQris(); render(); return; }
      st.g = r.percobaan || null; tampilQris();
      if (paksa) toast(st.g && st.g.status === 'menunggu' ? 'Pembayaran belum kami terima. Bila sudah membayar, tunggu sebentar.' : 'Status pembayaran diperbarui.');
      // Periksa ulang otomatis selama masih menunggu (maks. ±5 menit); sumber kebenaran tetap server/Midtrans.
      clearTimeout(st.poll);
      if (st.g && st.g.status === 'menunggu' && st.ke++ < 60) st.poll = setTimeout(() => cekQris(false), 5000);
    } catch (err) { if (paksa) toast(err.message); else if (!st.g) { const b = $('#qris-box'); if (b) b.innerHTML = `<p class="msg err" role="alert">${esc(err.message)}</p>${tombolCek}`; } }
    finally { st.cek = false; }
  }
  async function aksiPro(btn, fn, sukses) {
    if (!online()) { toast(OFFLINE); return; }
    busy(btn, true, 'Memproses…');
    try { await fn(); if (sukses) toast(sukses); } catch (err) { message = { text: err.message }; }
    render();
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
      case 'hp': return !v.trim() ? 'Nomor HP/WhatsApp wajib diisi untuk mendaftar dengan email.' : A.normalisasiHp(v).ok ? '' : A.PESAN_HP;
      case 'tm-wa': return !v.trim() || A.normalisasiHp(v).ok ? '' : A.PESAN_HP;
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
   * salin ke profiles.whatsapp bila kolom itu masih kosong, PASTIKAN tersimpan (dibaca dari respons server), baru hapus
   * dari metadata. Bila gagal, metadata dibiarkan (dicoba lagi saat masuk berikutnya) dan statusnya dilaporkan,
   * bukan dianggap berhasil.
   * @returns {Promise<{status: 'tidak_ada'|'tersimpan'|'sudah_ada'|'gagal', nomor?: string}>}
   */
  async function salinHpDaftar() {
    const u = cloud.auth.user(), meta = (u && u.user_metadata) || {};
    if (!meta.whatsapp) return { status: 'tidak_ada' };
    const n = A.normalisasiHp(meta.whatsapp), nomor = n.ok ? n.nilai : String(meta.whatsapp);
    let status;
    try {
      const p = await cloud.db.profile();
      if (!p) return { status: 'gagal', nomor };
      if (p.whatsapp) status = 'sudah_ada';   // nomor di profil diutamakan (bisa sudah diubah pengguna)
      else {
        if (!n.ok || !n.nilai) return { status: 'gagal', nomor };
        const saved = await cloud.db.updateProfile({ whatsapp: n.nilai });
        if (!saved || saved.whatsapp !== n.nilai) return { status: 'gagal', nomor };
        status = 'tersimpan';
      }
    } catch (e) { return { status: 'gagal', nomor }; }
    // Data sudah aman di profil; penghapusan metadata yang gagal hanya diulang saat masuk berikutnya.
    try { await cloud.auth.updateMetadata({ whatsapp: null }); } catch (e) { /* abaikan */ }
    return { status };
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
      } else if (f.id === 'f-tamu') {
        const email = $('#em').value.trim();
        const lama = tamuSesi.get();
        const r = await cloud.db.tamuCheckout({ token: lama && lama.token, nama: $('#nm').value.trim(), email, whatsapp: $('#tm-wa').value.trim() ? A.normalisasiHp($('#tm-wa').value).nilai : '' });
        // Hanya halaman Snap https yang diikuti (server juga membatasi host Midtrans).
        if (!r || !r.kode || !/^https:\/\//.test(r.snap_url || '')) throw new Error('Halaman pembayaran belum tersedia. Silakan coba lagi.');
        tamuSesi.set({ kode: r.kode, email, token: r.token || (lama && lama.token) || '' }); track('checkout_tamu');
        location.assign(r.snap_url); return;
      } else if (f.id === 'f-tautan') {
        await cloud.auth.kirimTautan($('#em').value.trim(), urlAktivasi());
        // Pesan sama untuk email terdaftar maupun tidak (mencegah enumerasi akun).
        message = { ok: true, text: 'Bila ada pembelian untuk email tersebut, tautan aktivasi sudah dikirim. Periksa kotak masuk dan folder spam.' };
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
        if (!saved || ('whatsapp' in patch && saved.whatsapp !== patch.whatsapp)) throw new Error('Silakan coba lagi.');
        if ('whatsapp' in patch) {
          wa.value = saved.whatsapp || ''; wa.dataset.awal = wa.value; const aj = $('#wa-ajak'); if (aj && wa.value) aj.remove();
          // Nomor sementara dari pendaftaran tidak diperlukan lagi setelah profil menyimpan nomor.
          const u = cloud.auth.user(); if (u && u.user_metadata && u.user_metadata.whatsapp) cloud.auth.updateMetadata({ whatsapp: null }).catch(() => {});
        }
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
    $('#card').innerHTML = `<p class="msg ok" role="status">${esc(text)}</p>`;
    const meta = (cloud.auth.user().user_metadata) || {};
    // Ada nomor dari pendaftaran yang belum dipindahkan: pastikan tersimpan dulu. Bila gagal, tetap di halaman Akun
    // dengan status yang jelas (bukan diam-diam ke dashboard); renderAccount mencoba lagi dan menampilkan formnya.
    if (meta.whatsapp) {
      const r = await salinHpDaftar();
      if (r.status === 'gagal') { message = null; render(); return; }
    }
    ss.del(NEXT_KEY);
    location.href = next;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.id === 'buat-pesanan') { const m = ($('input[name="metode"]:checked') || {}).value; return aksiPro(t, () => cloud.db.buatPesanan(m), 'Pesanan dibuat. Ikuti instruksi pembayaran.'); }
    if (t.dataset.beli) return aksiPro(t, () => cloud.db.buatPesanan(t.dataset.beli), 'Pesanan diperbarui.');
    if (t.hasAttribute('data-masuk-akun')) { tamu = false; view = 'masuk'; message = null; return render(); }
    if (t.hasAttribute('data-cek-tamu')) { busy(t, true, 'Memeriksa…'); return renderBayar($('#card'), true); }
    if (t.hasAttribute('data-kirim-aktivasi')) {
      if (!online()) return toast(OFFLINE);
      busy(t, true, 'Mengirim…');
      try { await cloud.auth.kirimTautan(cloud.auth.user().email, urlAktivasi()); toast('Tautan aktivasi dikirim. Periksa email Anda.'); } catch (err) { toast(err.message); }
      return busy(t, false);
    }
    if (t.id === 'bayar-qris') return bayarSnap(t, () => cloud.db.buatPesanan('qris'));
    if (t.hasAttribute('data-qris-baru')) { if (qris) { const o = qris.order; return bayarSnap(t, async () => o); } return render(); }
    if (t.hasAttribute('data-qris-cek')) { busy(t, true, 'Mengecek…'); await cekQris(true); if (document.contains(t)) busy(t, false); return; }
    if (t.dataset.konfirmasi) return aksiPro(t, () => cloud.db.konfirmasiBayar(+t.dataset.konfirmasi, ($('#k-catatan') || {}).value || ''), 'Terima kasih. Kami akan memverifikasi pembayaran Anda.');
    if (t.dataset.batal) { if (!confirm('Batalkan pesanan ini? Jangan batalkan bila Anda sudah membayar.')) return; return aksiPro(t, () => cloud.db.batalkanPesanan(+t.dataset.batal), 'Pesanan dibatalkan.'); }
    if (t.dataset.salin) { try { await navigator.clipboard.writeText(t.dataset.salin); toast('Disalin.'); } catch (err) { toast('Tidak bisa menyalin otomatis. Salin manual.'); } return; }
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
        else if (r && VIEW === 'aktivasi') message = { ok: true, text: 'Email terverifikasi.' };   // tetap di halaman Akun untuk klaim Pro
        else if (r) return go('Berhasil masuk. Membuka dashboard…');
      } catch (err) {
        history.replaceState(null, '', location.pathname);
        message = { text: online() ? err.message : OFFLINE };
      }
    }
    render();
  })();
})();
