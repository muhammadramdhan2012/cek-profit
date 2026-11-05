/* Uji klien akun & database terhadap server tiruan. Jalankan: node tests/cloud.test.js */
const createMock = require('./mock-supabase.js');
const fresh = () => { delete require.cache[require.resolve('../assets/cloud.js')]; return require('../assets/cloud.js'); };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

(async () => {
  let failed = 0;
  const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
  const truthy = (c, m) => { if (!c) throw new Error(m || 'gagal'); };
  const mock = createMock({ tokenTtl: 3600 });
  await new Promise((r) => mock.server.listen(0, r));
  const url = `http://127.0.0.1:${mock.server.address().port}`;
  const store = memStore();
  const C = fresh().init({ url, key: 'anon', store });

  await t('tanpa konfigurasi → nonaktif', async () => { truthy(!fresh().init({ url: '' }).enabled); });
  await t('daftar langsung mendapat sesi', async () => {
    const r = await C.auth.signUp({ email: 'ani@toko.id', password: 'sandiku123', fullName: 'Ani' });
    truthy(r.session && C.auth.user().email === 'ani@toko.id');
  });
  await t('sandi pendek → pesan bahasa Indonesia', async () => {
    try { await C.auth.signUp({ email: 'x@y.id', password: '123' }); throw new Error('harus gagal'); } catch (e) { truthy(/minimal 8/.test(e.message), e.message); }
  });
  await t('email sudah terdaftar → pesan netral (tidak membuka apakah email terdaftar)', async () => {
    try { await C.auth.signUp({ email: 'ani@toko.id', password: 'sandiku123' }); throw new Error('harus gagal'); }
    catch (e) { truthy(!/sudah terdaftar/.test(e.message) && /tidak dapat diproses/.test(e.message) && /Lupa kata sandi/.test(e.message), e.message); }
  });
  await t('profil dibuat otomatis & bisa diubah', async () => {
    const p = await C.db.profile(); truthy(p && p.full_name === 'Ani');
    const u = await C.db.updateProfile({ store_name: 'Toko Ani' }); truthy(u.store_name === 'Toko Ani');
  });
  await t('tidak bisa mengaktifkan Pro sendiri', async () => {
    try { await C.db.updateProfile({ pro_until: '2099-01-01' }); throw new Error('harus ditolak'); } catch (e) { truthy(e.status === 403, e.message); }
    truthy(!C.isPro(await C.db.profile()));
  });
  await t('sinkron modal: simpan lalu muat', async () => {
    await C.db.saveData({ settings: { packing: 2000, catalog: [{ kode: 'A', cost: 1000 }] }, profile: { store: 'Toko Ani' } });
    const d = await C.db.loadData(); truthy(d.settings.catalog[0].cost === 1000 && d.profile.store === 'Toko Ani');
  });
  await t('riwayat: tambah, daftar, hapus', async () => {
    const r = await C.db.addReport({ title: 'Sep 2026', period_from: '2026-09-01', period_to: '2026-09-30', summary: { totalMargin: 1 } });
    truthy((await C.db.listReports()).length === 1);
    await C.db.deleteReport(r.id); truthy((await C.db.listReports()).length === 0);
  });
  await t('sesi tersimpan & dipulihkan setelah muat ulang', async () => {
    const C2 = fresh().init({ url, key: 'anon', store }); truthy(C2.auth.user() && C2.auth.user().email === 'ani@toko.id');
  });
  await t('token kedaluwarsa diperbarui otomatis', async () => {
    const s = JSON.parse(store.getItem('cekprofit.session')); s.expires_at = Math.floor(Date.now() / 1000) + 10; store.setItem('cekprofit.session', JSON.stringify(s));
    const C3 = fresh().init({ url, key: 'anon', store });
    const old = C3.auth.session().access_token;
    truthy(await C3.db.profile()); truthy(C3.auth.session().access_token !== old, 'token tidak diperbarui');
  });
  await t('permintaan upgrade → admin aktifkan Pro', async () => {
    const C4 = fresh().init({ url, key: 'anon', store });
    await C4.db.requestUpgrade('pro_bulanan', 'QRIS');
    const me = await C4.db.profile();
    mock.addUser('admin@toko.id', 'adminadmin', {}); mock.makeAdmin('admin@toko.id');
    const A = fresh().init({ url, key: 'anon', store: memStore() });
    await A.auth.signIn({ email: 'admin@toko.id', password: 'adminadmin' });
    truthy((await A.db.adminProfiles()).length >= 2, 'admin melihat semua profil');
    truthy((await A.db.adminRequests()).some((r) => r.status === 'baru'));
    await A.db.adminSetPro(me.id, '2099-12-31');
    truthy(C4.isPro(await C4.db.profile()), 'Pro aktif'); truthy((await C4.db.myRequests())[0].status === 'selesai');
  });
  await t('pengguna biasa tidak bisa memanggil fungsi admin', async () => {
    const C5 = fresh().init({ url, key: 'anon', store });
    try { await C5.db.adminSetPro(C5.auth.user().id, '2099-12-31'); throw new Error('harus ditolak'); } catch (e) { truthy(/Hanya admin/.test(e.message), e.message); }
  });
  await t('masuk dengan sandi salah → pesan jelas', async () => {
    const C6 = fresh().init({ url, key: 'anon', store: memStore() });
    try { await C6.auth.signIn({ email: 'ani@toko.id', password: 'salah' }); throw new Error('harus gagal'); } catch (e) { truthy(e.message === 'Email atau kata sandi salah.', e.message); }
  });
  await t('token dari hash URL (login Google / tautan email)', async () => {
    const C7 = fresh().init({ url, key: 'anon', store: memStore() });
    const res = await fetch(C7.auth.oauthUrl('google', 'http://situs/akun.html'), { redirect: 'manual' });
    const hash = new URL(res.headers.get('location')).hash;
    const r = await C7.auth.fromUrlHash(hash); truthy(r && C7.auth.user().email === 'google@contoh.id');
  });
  /* ---------- Auth V2: login Google (PKCE) — server TIRUAN; perilaku Supabase/Google sungguhan belum teruji ---------- */
  const oauthBack = async (C, extra = '') => {
    const start = await C.auth.oauthStart('google', 'http://situs/akun.html');
    const res = await fetch(start + extra, { redirect: 'manual' });
    return { start, back: new URL(res.headers.get('location')) };
  };
  await t('Google PKCE: URL memuat code_challenge s256, tanpa token; kode ditukar dengan verifier → sesi terverifikasi', async () => {
    const st = memStore(); const G = fresh().init({ url, key: 'anon', store: st });
    const { start, back } = await oauthBack(G);
    truthy(/[?&]provider=google/.test(start) && /code_challenge=[\w-]{43}&code_challenge_method=s256$/.test(start), start);
    truthy(!/scope=/.test(start), 'tidak meminta lingkup Google tambahan');
    truthy(st.getItem('cekprofit.pkce'), 'verifier tersimpan sementara');
    truthy(back.searchParams.get('code') && !back.hash, 'kembali dengan ?code=, bukan token di URL');
    const r = await G.auth.fromUrl({ search: back.search, hash: back.hash });
    truthy(r && r.type === 'login' && G.auth.user().email === 'google@contoh.id', 'sesi Google');
    truthy(!st.getItem('cekprofit.pkce'), 'verifier dihapus setelah dipakai');
    truthy(JSON.parse(st.getItem('cekprofit.session')).user.id === G.auth.user().id, 'sesi tersimpan untuk refresh halaman');
  });
  await t('Google PKCE: verifier hilang/salah atau kode dipakai ulang → gagal, tanpa sesi', async () => {
    const st = memStore(); const G = fresh().init({ url, key: 'anon', store: st });
    const { back } = await oauthBack(G);
    st.removeItem('cekprofit.pkce');
    try { await G.auth.fromUrl({ search: back.search }); throw new Error('harus gagal'); } catch (e) { truthy(/kedaluwarsa/.test(e.message), e.message); }
    truthy(!G.auth.user() && !st.getItem('cekprofit.session'), 'tidak ada sesi');
    const b2 = (await oauthBack(G)).back; st.setItem('cekprofit.pkce', 'verifier-palsu');
    try { await G.auth.fromUrl({ search: b2.search }); throw new Error('harus gagal'); } catch (e) { truthy(!G.auth.user(), 'tidak ada sesi'); }
    const b3 = (await oauthBack(G)).back; const v = st.getItem('cekprofit.pkce');
    await G.auth.fromUrl({ search: b3.search }); await G.auth.signOut(); st.setItem('cekprofit.pkce', v);
    try { await G.auth.fromUrl({ search: b3.search }); throw new Error('harus gagal'); } catch (e) { truthy(!G.auth.user(), 'kode sekali pakai'); }
  });
  await t('Google dibatalkan / gagal → pesan Indonesia, rincian dari URL tidak ditampilkan, tanpa sesi', async () => {
    const st = memStore(); const G = fresh().init({ url, key: 'anon', store: st });
    const { back } = await oauthBack(G, '&mock_error=access_denied');
    try { await G.auth.fromUrl({ search: back.search }); throw new Error('harus gagal'); } catch (e) { truthy(/dibatalkan/.test(e.message), e.message); }
    try { await G.auth.fromUrl({ search: '?error=server_error&error_description=<b>teks+jahat</b>' }); throw new Error('harus gagal'); }
    catch (e) { truthy(/gagal/.test(e.message) && !/jahat|<b>/.test(e.message), e.message); }
    try { await G.auth.fromUrl({ hash: '#error=access_denied&error_code=otp_expired&error_description=x' }); throw new Error('harus gagal'); }
    catch (e) { truthy(/tidak berlaku|dibatalkan/.test(e.message), e.message); }
    truthy(!G.auth.user() && !st.getItem('cekprofit.pkce'), 'tanpa sesi, verifier dibersihkan');
  });
  await t('token dari URL yang tidak dikenali server → sesi dihapus (tidak masuk dashboard)', async () => {
    const st = memStore(); const G = fresh().init({ url, key: 'anon', store: st });
    try { await G.auth.fromUrl({ hash: '#access_token=palsu&refresh_token=palsu&expires_in=3600' }); throw new Error('harus gagal'); } catch (e) { truthy(/tidak dapat diverifikasi/.test(e.message), e.message); }
    truthy(!G.auth.user() && !st.getItem('cekprofit.session'));
    truthy((await G.auth.fromUrl({ search: '?next=dashboard.html' })) === null, 'URL tanpa token/kode → tidak ada perubahan');
  });
  await t('pengguna lama (email/sandi, Pro) masuk dengan Google ber-email sama → ID, data, dan Pro tetap (tiruan penautan)', async () => {
    const A = fresh().init({ url, key: 'anon', store: memStore() }); await A.auth.signIn({ email: 'ani@toko.id', password: 'sandiku123' });
    const idLama = A.auth.user().id, proLama = A.isPro(await A.db.profile()), dataLama = await A.db.loadData();
    const st = memStore(); const G = fresh().init({ url, key: 'anon', store: st });
    const { back } = await oauthBack(G, '&mock_email=ani%40toko.id'); await G.auth.fromUrl({ search: back.search });
    truthy(G.auth.user().id === idLama, 'ID pengguna sama'); truthy(G.isPro(await G.db.profile()) === proLama && proLama, 'status Pro tetap');
    truthy(JSON.stringify((await G.db.loadData()).settings) === JSON.stringify(dataLama.settings), 'data modal tetap');
    await G.auth.signOut(); truthy(!G.auth.user() && !st.getItem('cekprofit.session'), 'keluar membersihkan sesi');
    await A.auth.signIn({ email: 'ani@toko.id', password: 'sandiku123' }); truthy(A.auth.user().id === idLama, 'masuk dengan sandi lama tetap bisa');
  });
  await t('akses data pengguna lain tetap ditolak (RLS tiruan)', async () => {
    const G = fresh().init({ url, key: 'anon', store: memStore() }); const { back } = await oauthBack(G, '&mock_email=baru%40google.id'); await G.auth.fromUrl({ search: back.search });
    truthy((await G.db.listReports()).length === 0, 'riwayat orang lain tidak terlihat');
    try { await G.db.adminProfiles().then((rows) => { if (rows.length > 1) throw new Error('profil lain terlihat'); }); } catch (e) { truthy(!/terlihat/.test(e.message), e.message); }
    truthy(!G.isPro(await G.db.profile()), 'akun Google baru bukan Pro');
  });
  await t('keluar menghapus sesi', async () => {
    const C8 = fresh().init({ url, key: 'anon', store });
    await C8.auth.signOut(); truthy(!C8.auth.user() && !store.getItem('cekprofit.session'));
  });
  await t('daftar dengan konfirmasi email', async () => {
    const m2 = createMock({ confirmEmail: true }); await new Promise((r) => m2.server.listen(0, r));
    const C9 = fresh().init({ url: `http://127.0.0.1:${m2.server.address().port}`, key: 'anon', store: memStore() });
    const r = await C9.auth.signUp({ email: 'b@toko.id', password: 'sandiku123' }); truthy(!r.session && r.confirm);
    try { await C9.auth.signIn({ email: 'b@toko.id', password: 'sandiku123' }); throw new Error('harus gagal'); } catch (e) { truthy(/belum dikonfirmasi/.test(e.message), e.message); }
    m2.server.close();
  });
  /* ---------- Auth V3: aturan sandi baru, nomor HP, metadata — server TIRUAN; Supabase sungguhan belum teruji ---------- */
  const R = require('../assets/aturan-akun.js');
  await t('V3 sandi baru: min 8, kapital, kecil, angka; simbol boleh; maks 72', async () => {
    for (const ok of ['Sandiku123', 'Abcdefg1', 'Toko#Ani_2026!', 'aB3' + 'x'.repeat(69)]) truthy(R.cekSandi(ok).ok && R.pesanSandi(ok) === '', ok);
    const kasus = { sandiku123: 'huruf kapital', SANDIKU123: 'huruf kecil', Sandikuuu: 'angka', Ab1: 'minimal 8 karakter', '': 'wajib' };
    for (const [pw, kurang] of Object.entries(kasus)) truthy(!R.cekSandi(pw).ok && R.pesanSandi(pw).includes(kurang), `${pw}: ${R.pesanSandi(pw)}`);
    truthy(!R.cekSandi('aB3' + 'x'.repeat(70)).ok && /maksimal 72/.test(R.pesanSandi('aB3' + 'x'.repeat(70))), 'lebih dari 72 ditolak');
    const h = R.cekSandi('abcdefgh'); truthy(h.panjang && h.kecil && !h.kapital && !h.angka, 'status per syarat untuk daftar centang');
  });
  await t('V3 nomor HP: dinormalkan ke +62; kosong boleh; format salah ditolak', async () => {
    const ok = { '081234567890': '+6281234567890', '0812-3456-7890': '+6281234567890', '0812 3456 7890': '+6281234567890', '6281234567890': '+6281234567890',
      '+62 812 3456 7890': '+6281234567890', '+62 0812 3456 7890': '+6281234567890', '81234567890': '+6281234567890', '(0812) 3456.7890': '+6281234567890', '0812345678': '+62812345678' };
    for (const [inp, out] of Object.entries(ok)) { const n = R.normalisasiHp(inp); truthy(n.ok && n.nilai === out, `${inp} → ${n.nilai}`); }
    truthy(R.normalisasiHp('').ok && R.normalisasiHp('   ').nilai === '', 'kosong boleh (pengguna Google melengkapi nanti)');
    for (const bad of ['0212345678', '+6581234567', '08123', '0812345678901234', 'nomor saya 0812', '08-12<script>', '++6281234567890', '62 21 1234567'])
      truthy(!R.normalisasiHp(bad).ok, `ditolak: ${bad}`);
  });
  await t('V3 daftar: nomor ikut metadata; sandi tidak pernah masuk metadata/profil; sandi lemah ditolak server dengan pesan Indonesia', async () => {
    const m3 = createMock({ confirmEmail: true, strongPasswords: true }); await new Promise((r) => m3.server.listen(0, r));
    const u3 = `http://127.0.0.1:${m3.server.address().port}`;
    const D = fresh().init({ url: u3, key: 'anon', store: memStore() });
    try { await D.auth.signUp({ email: 'c@toko.id', password: 'sandiku123' }); throw new Error('harus gagal'); }
    catch (e) { truthy(/huruf kapital, huruf kecil, dan angka/.test(e.message), e.message); }
    const r = await D.auth.signUp({ email: 'c@toko.id', password: 'Sandiku123', fullName: 'Citra', whatsapp: '+6281234567890' });
    truthy(!r.session && r.confirm, 'perlu konfirmasi email');
    const meta = [...m3.users.values()].find((x) => x.email === 'c@toko.id').meta;
    truthy(meta.whatsapp === '+6281234567890' && meta.full_name === 'Citra', 'metadata pendaftaran');
    truthy(!JSON.stringify(m3.signupBodies.map((b) => b.data)).includes('Sandiku123') && !JSON.stringify([...m3.profiles.values()]).includes('Sandiku123'), 'sandi tidak di metadata/profil');
    const r2 = await D.auth.signUp({ email: 'd@toko.id', password: 'Sandiku123', fullName: 'Dodi' });
    truthy(r2.confirm && !('whatsapp' in [...m3.users.values()].find((x) => x.email === 'd@toko.id').meta), 'tanpa nomor → tidak ada kunci whatsapp');
    // Salin ke profil lalu hapus dari metadata (langkah yang dijalankan akun.js setelah masuk pertama).
    m3.confirmAll(); await D.auth.signIn({ email: 'c@toko.id', password: 'Sandiku123' });
    truthy(D.auth.user().user_metadata.whatsapp === '+6281234567890', 'nomor terbaca dari sesi');
    await D.db.updateProfile({ whatsapp: D.auth.user().user_metadata.whatsapp });
    await D.auth.updateMetadata({ whatsapp: null });
    truthy((await D.db.profile()).whatsapp === '+6281234567890', 'tersimpan di profiles.whatsapp');
    truthy(!('whatsapp' in D.auth.user().user_metadata) && !('whatsapp' in meta), 'dihapus dari metadata & sesi diperbarui');
    m3.server.close();
  });
  await t('V3 pengguna lama dengan sandi lemah tetap bisa masuk; ganti sandi memakai aturan baru', async () => {
    const m4 = createMock({ strongPasswords: true }); await new Promise((r) => m4.server.listen(0, r));
    m4.addUser('lama@toko.id', 'sandilama1', { full_name: 'Lama' });   // dibuat sebelum aturan baru
    const L = fresh().init({ url: `http://127.0.0.1:${m4.server.address().port}`, key: 'anon', store: memStore() });
    await L.auth.signIn({ email: 'lama@toko.id', password: 'sandilama1' });
    truthy(L.auth.user() && L.auth.user().email === 'lama@toko.id', 'masuk tidak diblokir');
    try { await L.auth.updatePassword('sandibaru1'); throw new Error('harus gagal'); } catch (e) { truthy(/belum memenuhi syarat/.test(e.message), e.message); }
    await L.auth.updatePassword('SandiBaru1');
    await L.auth.signOut(); await L.auth.signIn({ email: 'lama@toko.id', password: 'SandiBaru1' }); truthy(L.auth.user(), 'sandi baru berlaku');
    m4.server.close();
  });
  await t('V3 pesan server lain diterjemahkan (sandi bocor, sama dengan lama, terlalu panjang)', async () => {
    const X = fresh();
    const msg = (m) => new X.CloudError(422, { msg: m }).message;
    truthy(/pernah bocor/.test(msg('Password is known to be weak and easy to guess, please choose a different one. (pwned)')), 'bocor');
    truthy(/berbeda dari kata sandi lama/.test(msg('New password should be different from the old password.')), 'sama');
    truthy(/maksimal 72/.test(msg('Password cannot be longer than 72 characters')), 'panjang');
    truthy(/memenuhi syarat/.test(msg('Password should contain at least one character of each: abc')), 'syarat');
  });
  /* ---------- Bantuan WhatsApp & pindah alamat (assets/situs.js) ---------- */
  const S = require('../assets/situs.js');
  await t('waSupport: tersembunyi bila kosong/salah; terpisah dari nomor pembayaran; pesan hanya nama halaman', async () => {
    truthy(S.waSupportUrl({}, 'Dashboard') === '' && S.waSupportUrl({ waSupport: '' }, 'Akun') === '', 'kosong → tidak ada tautan');
    truthy(S.waSupportUrl({ whatsapp: '6281234567890' }, 'Akun') === '', 'nomor pembayaran tidak dipakai sebagai nomor bantuan');
    for (const bad of ['081234567890', '+6281234567890', '62 812', 'abc', '62812345678901234']) truthy(S.waSupportUrl({ waSupport: bad }, 'Akun') === '', `format salah: ${bad}`);
    const u = new URL(S.waSupportUrl({ waSupport: '6281234567890' }, 'Dashboard'));
    truthy(u.origin === 'https://wa.me' && u.pathname === '/6281234567890', u.href);
    truthy(u.searchParams.get('text') === 'Halo Cek Untung, saya butuh bantuan menggunakan website (halaman: Dashboard).', u.searchParams.get('text'));
    truthy(/halaman: Beranda/.test(decodeURIComponent(S.waSupportUrl({ waSupport: '6281234567890' }, '<b>x</b>'))), 'nama halaman di luar daftar → Beranda');
  });
  await t('masa beta gratis: aktif s.d. tanggal (inklusif), mati setelahnya/format salah; elemen [data-beta] ikut', async () => {
    const cfg = { betaGratisSampai: '2026-12-13', hargaPenggunaAwal: 'Rp99.000' };
    truthy(S.betaGratis(cfg, '2026-11-01').aktif && S.betaGratis(cfg, '2026-12-13').aktif, 'aktif sampai & termasuk 13 Des');
    truthy(!S.betaGratis(cfg, '2026-12-14').aktif, 'mati mulai 14 Des');
    for (const bad of ['', '13-12-2026', '2026/12/13', null]) truthy(!S.betaGratis({ betaGratisSampai: bad }, '2026-11-01').aktif, `format salah/kosong: ${bad}`);
    truthy(S.betaGratis(cfg, '2026-11-01').label === '13 Desember 2026', 'label tanggal');
    const el = (attr) => ({ dataset: {}, hidden: true, textContent: '', attr, removeAttribute() {}, setAttribute() {} });
    const els = [el('beta'), el('sampai'), el('harga')];
    const doc = { querySelectorAll: (q) => (q === '[data-beta]' ? [els[0]] : q === '[data-beta-sampai]' ? [els[1]] : q === '[data-harga-awal]' ? [els[2]] : []), getElementById: () => null };
    S.pasang(doc, cfg, { hostname: 'cekuntung.id', pathname: '/' }, null, '2026-11-01');
    truthy(els[0].hidden === false && els[1].textContent === '13 Desember 2026' && els[2].textContent === 'Rp99.000', 'tampil selama beta');
    S.pasang(doc, cfg, { hostname: 'cekuntung.id', pathname: '/' }, null, '2026-12-14');
    truthy(els[0].hidden === true, 'tersembunyi setelah beta');
  });
  await t('pindah alamat: hanya di *.github.io bila domainResmi diisi; tanpa query/hash', async () => {
    const gh = (path) => ({ hostname: 'muhammadramdhan2012.github.io', pathname: path });
    truthy(S.alamatPindah({}, gh('/cek-profit/')) === '', 'domainResmi kosong → tidak tampil');
    const cfg = { domainResmi: 'https://cekuntung.id' };
    truthy(S.alamatPindah(cfg, gh('/cek-profit/dashboard.html')) === 'https://cekuntung.id/dashboard.html');
    truthy(S.alamatPindah(cfg, gh('/cek-profit/')) === 'https://cekuntung.id/' && S.alamatPindah(cfg, gh('/cek-profit')) === 'https://cekuntung.id/');
    truthy(S.alamatPindah(cfg, { hostname: 'cekuntung.id', pathname: '/dashboard' }) === '', 'di domain resmi tidak tampil');
    truthy(S.alamatPindah(cfg, { hostname: 'cekuntung.pages.dev', pathname: '/' }) === '' && S.alamatPindah(cfg, { hostname: 'localhost', pathname: '/' }) === '', 'staging/lokal tidak tampil');
    truthy(S.alamatPindah({ domainResmi: 'http://cekuntung.id' }, gh('/cek-profit/')) === '' && S.alamatPindah({ domainResmi: 'bukan url' }, gh('/cek-profit/')) === '', 'hanya https');
  });
  await t('Tahap 2: status_situs tanpa login, status_akun, batas riwayat ditegakkan server dengan pesan Indonesia', async () => {
    const m = createMock(); await new Promise((r) => m.server.listen(0, r));
    const u = `http://127.0.0.1:${m.server.address().port}`;
    m.situs.hari = '2026-11-10';
    const anon = fresh().init({ url: u, key: 'anon', store: memStore() });
    const s1 = await anon.db.statusSitus();
    truthy(s1.hari_ini === '2026-11-10' && s1.beta_aktif === true && s1.beta_gratis_sampai === '2026-12-13', 'status situs tanpa login');
    const U = fresh().init({ url: u, key: 'anon', store: memStore() });
    await U.auth.signUp({ email: 'awal@toko.id', password: 'sandiku123' });
    let st = await U.db.statusAkun();
    truthy(st.pengguna_awal === true && st.batas_riwayat === null && st.harga_awal_tersedia === true, 'daftar saat beta = pengguna awal, tanpa batas');
    for (let i = 0; i < 4; i++) await U.db.addReport({ title: `R${i}`, summary: {} });
    m.situs.hari = '2026-12-14';
    st = await U.db.statusAkun();
    truthy(st.beta_aktif === false && st.batas_riwayat === 3 && st.jumlah_riwayat === 4, 'setelah beta: batas 3, riwayat lama tetap');
    try { await U.db.addReport({ title: 'R5', summary: {} }); throw new Error('harus ditolak'); }
    catch (e) { truthy(e.message === 'Akun gratis menyimpan 3 riwayat. Hapus riwayat lama atau upgrade ke Pro.', e.message); truthy(/BATAS_RIWAYAT/.test(e.body.message)); }
    truthy((await U.db.listReports()).length === 4, 'riwayat lama tidak dihapus');
    // admin: buka pembelian, catat harga pengguna awal, tidak bisa dua kali
    m.addUser('adm@toko.id', 'adminadmin', {}); m.makeAdmin('adm@toko.id');
    const A = fresh().init({ url: u, key: 'anon', store: memStore() }); await A.auth.signIn({ email: 'adm@toko.id', password: 'adminadmin' });
    const me = await U.db.profile();
    try { await fresh().init({ url: u, key: 'anon', store: memStore() }).db.statusAkun(); throw new Error('anon harus ditolak'); } catch (e) { truthy(e.status === 401, e.message); }
    try { await A.db.adminCatatPembelian(me.id, 99000, true, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/belum dibuka/.test(e.message), e.message); }
    await A.db.adminSetSitus('2026-12-13', '2027-01-01'); m.situs.hari = '2027-01-15';
    const r = await A.db.adminCatatPembelian(me.id, 99000, true, 'transfer');
    truthy(r.mulai === '2027-01-15' && r.sampai === '2028-01-14', JSON.stringify(r));
    try { await A.db.adminCatatPembelian(me.id, 99000, true, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/hanya tahun pertama/.test(e.message), e.message); }
    try { await U.db.adminCatatPembelian(me.id, 0, false, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/Hanya admin/.test(e.message), e.message); }
    st = await U.db.statusAkun();
    truthy(st.pro_aktif && !st.harga_awal_tersedia && st.batas_riwayat === null, 'setelah membeli: Pro, harga awal terpakai');
    truthy((await A.db.adminPurchases()).length === 1, 'catatan pembelian tersimpan');
    m.server.close();
  });
  await t('Pembayaran online: hanya penguji saat Sandbox, pesan penolakan berbahasa Indonesia, status pesanan bisa dibaca', async () => {
    const m = createMock(); await new Promise((r) => m.server.listen(0, r));
    const u = `http://127.0.0.1:${m.server.address().port}`;
    const U = fresh().init({ url: u, key: 'anon', store: memStore() });
    await U.auth.signUp({ email: 'uji@toko.id', password: 'sandiku123' });
    let st = await U.db.statusPembayaran();
    truthy(st.mode === 'mati' && st.boleh_beli === false, 'awalnya tertutup');
    try { await U.db.buatPesananPro(); throw new Error('harus ditolak'); } catch (e) { truthy(e.status === 400 && e.message === 'Pembelian Pro belum dibuka.', e.message); }
    truthy(U.auth.user(), 'penolakan tidak mengeluarkan pengguna');
    m.bayar.mode = 'sandbox'; m.bayar.penguji.add(U.auth.user().id);
    st = await U.db.statusPembayaran();
    truthy(st.boleh_beli && st.harga === 149000, 'penguji boleh beli');
    const r = await U.db.buatPesananPro();
    truthy(/^https:\/\/app-sandbox\.duitku\.com\//.test(r.payment_url) && r.order_id === 'CU-MOCK-1', JSON.stringify(r));
    const o = await U.db.pesananPro('CU-MOCK-1');
    truthy(o && o.status === 'menunggu' && o.harga === 149000, 'status pesanan');
    truthy((await U.db.pesananPro('CU-LAIN')) === null, 'pesanan tak dikenal → null');
    const anon = fresh().init({ url: u, key: 'anon', store: memStore() });
    try { await anon.db.buatPesananPro(); throw new Error('harus ditolak'); } catch (e) { truthy(e.status === 401, e.message); }
    m.server.close();
  });
  await t('Tahap 2: database lama (SQL tahap 2 belum dijalankan) → status gagal dengan sopan, fitur lama tetap jalan', async () => {
    const m = createMock({ tahap2: false }); await new Promise((r) => m.server.listen(0, r));
    const u = `http://127.0.0.1:${m.server.address().port}`;
    const U = fresh().init({ url: u, key: 'anon', store: memStore() });
    try { await U.db.statusSitus(); throw new Error('harus gagal'); } catch (e) { truthy(e.status === 404, e.message); }
    await U.auth.signUp({ email: 'lama@toko.id', password: 'sandiku123' });
    try { await U.db.statusAkun(); throw new Error('harus gagal'); } catch (e) { truthy(e.status === 404, e.message); }
    truthy(U.auth.user() && (await U.db.profile()), 'sesi & profil tetap ada');
    for (let i = 0; i < 4; i++) await U.db.addReport({ title: `R${i}`, summary: {} });
    m.server.close();
  });
  await t('Tahap 2: pengumuman beta dari server (status_situs); jawaban aneh/gagal → tetap config', async () => {
    truthy(S.betaDariServer({ hari_ini: '2026-12-14', beta_gratis_sampai: '2026-12-13', beta_aktif: false }).aktif === false);
    const b = S.betaDariServer({ hari_ini: '2026-12-20', beta_gratis_sampai: '2027-01-31', beta_aktif: true });
    truthy(b.aktif && b.label === '31 Januari 2027', 'diperpanjang admin');
    truthy(S.betaDariServer({ hari_ini: '2026-12-20', beta_gratis_sampai: null, beta_aktif: false }).aktif === false, 'beta dihentikan');
    for (const bad of [null, 'x', {}, { hari_ini: 'kemarin' }, { hari_ini: '2026-12-20', beta_gratis_sampai: '<b>' }]) truthy(S.betaDariServer(bad) === null, `jawaban aneh: ${JSON.stringify(bad)}`);
    const el = () => ({ dataset: {}, hidden: false, textContent: '' });
    const els = [el(), el()];
    const doc = { querySelectorAll: (q) => (q === '[data-beta]' ? [els[0]] : q === '[data-beta-sampai]' ? [els[1]] : []) };
    const cfg = { supabaseUrl: 'https://x.supabase.co/', supabaseAnonKey: 'pk' };
    let dipanggil = null;
    await S.segarkanBeta(doc, cfg, async (u, o) => { dipanggil = { u, o }; return { ok: true, json: async () => ({ hari_ini: '2026-12-20', beta_gratis_sampai: '2027-01-31', beta_aktif: true }) }; });
    truthy(dipanggil.u === 'https://x.supabase.co/rest/v1/rpc/status_situs' && !dipanggil.o.headers.Authorization && dipanggil.o.headers.apikey === 'pk', 'tanpa token login');
    truthy(els[0].hidden === false && els[1].textContent === '31 Januari 2027', 'diperbarui dari server');
    els[0].hidden = true;
    truthy(await S.segarkanBeta(doc, cfg, async () => { throw new Error('offline'); }) === null && els[0].hidden === true, 'offline → diam');
    truthy(await S.segarkanBeta(doc, cfg, async () => ({ ok: false })) === null && els[0].hidden === true, 'fungsi belum ada (404) → diam');
    truthy(await S.segarkanBeta(doc, {}, async () => { throw new Error('tidak boleh dipanggil'); }) === null, 'akun belum aktif → tidak memanggil server');
  });
  /* ---- Masukan pengguna (keputusan pemilik 4 Nov 2026) ---- */
  await t('Masukan: pengguna mengirim (tanpa membaca balik), admin membaca & ubah status', async () => {
    const m = createMock(); await new Promise((r) => m.server.listen(0, r)); const u2 = `http://127.0.0.1:${m.server.address().port}`;
    m.addUser('seller@toko.id', 'sandiku123', {}); m.addUser('adm@toko.id', 'adminadmin', {}); m.makeAdmin('adm@toko.id');
    const S2 = fresh().init({ url: u2, key: 'anon', store: memStore() }); await S2.auth.signIn({ email: 'seller@toko.id', password: 'sandiku123' });
    await S2.db.kirimMasukan({ jenis: 'saran', pesan: '  Tolong tambah Lazada  ', halaman: 'produk', bolehDihubungi: true });
    truthy(m.feedback.length === 1 && m.feedback[0].pesan === 'Tolong tambah Lazada' && m.feedback[0].halaman === 'produk' && m.feedback[0].boleh_dihubungi, 'tersimpan & dirapikan');
    truthy((await S2.db.adminFeedback()).length === 0, 'pengguna tidak bisa membaca');
    for (let i = 2; i <= 5; i++) await S2.db.kirimMasukan({ jenis: 'lainnya', pesan: `masukan ke-${i}` });
    try { await S2.db.kirimMasukan({ jenis: 'lainnya', pesan: 'masukan ke-6' }); throw new Error('harus gagal'); }
    catch (e) { truthy(/sudah mengirim 5 masukan/.test(e.message) && !/BATAS_/.test(e.message), e.message); }
    const A2 = fresh().init({ url: u2, key: 'anon', store: memStore() }); await A2.auth.signIn({ email: 'adm@toko.id', password: 'adminadmin' });
    const semua = await A2.db.adminFeedback(); truthy(semua.length === 5, 'admin membaca semua');
    await A2.db.adminSetFeedbackStatus(semua[4].id, 'dibaca'); truthy(m.feedback[0].status === 'dibaca', 'status diubah');
    m.server.close();
  });
  await t('Masukan: tabel belum dibuat (SQL belum dijalankan) → error 404 yang bisa dikenali', async () => {
    const m = createMock({ masukan: false }); await new Promise((r) => m.server.listen(0, r));
    m.addUser('x@toko.id', 'sandiku123', {});
    const X = fresh().init({ url: `http://127.0.0.1:${m.server.address().port}`, key: 'anon', store: memStore() }); await X.auth.signIn({ email: 'x@toko.id', password: 'sandiku123' });
    try { await X.db.kirimMasukan({ jenis: 'saran', pesan: 'halo semua' }); throw new Error('harus gagal'); } catch (e) { truthy(e.status === 404, String(e.status)); }
    m.server.close();
  });
  /* ---- Sesi (keputusan pemilik 4 Nov 2026): ingat saya, keluar dari semua perangkat, keluar otomatis 30 hari ---- */
  mock.addUser('sesi@toko.id', 'sandiku123', {});
  const SK = 'cekprofit.session';
  await t('Sesi: "ingat saya" (bawaan) → localStorage; tanpa ingat → sessionStorage saja', async () => {
    const ls = memStore(), ss = memStore();
    const A = fresh().init({ url, key: 'anon', store: ls, tabStore: ss });
    await A.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    truthy(ls.getItem(SK) && !ss.getItem(SK) && A.auth.ingat(), 'bawaan ingat');
    const ls2 = memStore(), ss2 = memStore();
    const B = fresh().init({ url, key: 'anon', store: ls2, tabStore: ss2 });
    await B.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123', ingat: false });
    truthy(!ls2.getItem(SK) && ss2.getItem(SK) && !B.auth.ingat(), 'tanpa ingat: hanya di tab');
    // tab ditutup = sessionStorage baru/kosong → keluar; tab yang sama dimuat ulang → masih masuk, tetap tanpa ingat
    truthy(!fresh().init({ url, key: 'anon', store: ls2, tabStore: memStore() }).auth.user(), 'tab baru: keluar');
    const B2 = fresh().init({ url, key: 'anon', store: ls2, tabStore: ss2 });
    truthy(B2.auth.user() && !B2.auth.ingat(), 'muat ulang tab: masih masuk');
    await B2.db.profile();
    truthy(!ls2.getItem(SK), 'perpanjangan token tidak pindah ke localStorage');
    // pindah ke "ingat" saat masuk lagi: salinan di sessionStorage dihapus
    await B2.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    truthy(ls2.getItem(SK) && !ss2.getItem(SK), 'masuk lagi dengan ingat: pindah ke localStorage');
  });
  await t('Sesi: format lama (tanpa last_active) tetap masuk dan mulai dihitung', async () => {
    const ls = memStore();
    const A = fresh().init({ url, key: 'anon', store: ls }); await A.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const s = JSON.parse(ls.getItem(SK)); delete s.last_active; ls.setItem(SK, JSON.stringify(s));
    const B = fresh().init({ url, key: 'anon', store: ls });
    truthy(B.auth.user() && Math.abs(JSON.parse(ls.getItem(SK)).last_active - Date.now() / 1000) < 5, 'last_active diisi sekarang');
  });
  await t('Sesi: tidak dibuka 29 hari → masih masuk; 31 hari → keluar & dicabut di server', async () => {
    const ls = memStore();
    const A = fresh().init({ url, key: 'anon', store: ls }); await A.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const mundur = (hari) => { const s = JSON.parse(ls.getItem(SK)); s.last_active = Math.floor(Date.now() / 1000) - hari * 86400; ls.setItem(SK, JSON.stringify(s)); };
    mundur(29); truthy(fresh().init({ url, key: 'anon', store: ls }).auth.user(), '29 hari: masih masuk');
    const rt = JSON.parse(ls.getItem(SK)).refresh_token;
    mundur(31); const n0 = mock.logouts.length;
    const B = fresh().init({ url, key: 'anon', store: ls });
    truthy(!B.auth.user() && !ls.getItem(SK), '31 hari: sesi dihapus dari perangkat');
    await B.idleSelesai;
    truthy(mock.logouts.length === n0 + 1 && mock.logouts[n0] === 'local', 'logout ke server (perangkat ini saja)');
    const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: 'anon', 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
    truthy(!r.ok, 'refresh token lama tidak bisa dipakai lagi');
  });
  await t('Sesi: tidak dibuka 31 hari saat offline → tetap keluar di perangkat', async () => {
    const ls = memStore();
    const A = fresh().init({ url, key: 'anon', store: ls }); await A.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const s = JSON.parse(ls.getItem(SK)); s.last_active -= 40 * 86400; ls.setItem(SK, JSON.stringify(s));
    const B = fresh().init({ url: 'http://127.0.0.1:1', key: 'anon', store: ls });
    truthy(!B.auth.user() && !ls.getItem(SK)); await B.idleSelesai;   // tidak melempar error
  });
  await t('Keluar: perangkat ini saja vs semua perangkat', async () => {
    const L = fresh(), H = fresh();
    const laptop = L.init({ url, key: 'anon', store: memStore() }); await laptop.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const hp = H.init({ url, key: 'anon', store: memStore() }); await hp.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    truthy(await hp.auth.signOut() === true && !hp.auth.user() && mock.logouts[mock.logouts.length - 1] === 'local', 'keluar biasa: scope local');
    truthy(await laptop.db.profile(), 'laptop tetap masuk setelah HP keluar');
    await hp.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const rtLaptop = laptop.auth.session().refresh_token;
    truthy(await hp.auth.signOut({ semua: true }) === true && mock.logouts[mock.logouts.length - 1] === 'global', 'semua perangkat: scope global');
    const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: 'anon', 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rtLaptop }) });
    truthy(!r.ok, 'sesi laptop dicabut');
    const off = fresh().init({ url, key: 'anon', store: memStore() }); await off.auth.signIn({ email: 'sesi@toko.id', password: 'sandiku123' });
    const off2 = fresh(); const sesiOff = off.auth.session(); const st2 = memStore(); st2.setItem(SK, JSON.stringify(sesiOff));
    const O = off2.init({ url: 'http://127.0.0.1:1', key: 'anon', store: st2 });
    truthy(await O.auth.signOut({ semua: true }) === false && !O.auth.user(), 'server tak terjangkau: keluar lokal, hasil false');
  });
  mock.server.close();
  console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
  process.exitCode = failed ? 1 : 0;
})();
