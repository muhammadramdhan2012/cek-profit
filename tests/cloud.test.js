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
  /* ---------- Pro sekali bayar: kolom eksplisit + aktivasi admin tercatat (server TIRUAN meniru usulan SQL) ---------- */
  await t('Pro sekali bayar: status dari akun; seller tidak bisa menaikkan sendiri; aktivasi admin wajib nominal + referensi unik', async () => {
    const m5 = createMock(); await new Promise((r) => m5.server.listen(0, r)); const u5 = `http://127.0.0.1:${m5.server.address().port}`;
    const sellerId = m5.addUser('seller@toko.id', 'Sandiku123', {}); const lamaId = m5.addUser('lama@toko.id', 'Sandiku123', {});
    m5.profiles.get(lamaId).pro_until = '2099-01-31'; m5.addUser('admin@toko.id', 'Sandiku123', {}); m5.makeAdmin('admin@toko.id');
    const S1 = fresh().init({ url: u5, key: 'anon', store: memStore() }); await S1.auth.signIn({ email: 'seller@toko.id', password: 'Sandiku123' });
    try { await S1.db.updateProfile({ pro_sekali_bayar: true }); throw new Error('harus ditolak'); } catch (e) { truthy(e.status === 403, e.message); }
    try { await S1.db.adminAktifkanPro(sellerId, 149000, 'TRX-SENDIRI'); throw new Error('harus ditolak'); } catch (e) { truthy(/Hanya admin/.test(e.message), e.message); }
    truthy(!S1.isPro(await S1.db.profile()), 'tetap gratis');
    const AD = fresh().init({ url: u5, key: 'anon', store: memStore() }); await AD.auth.signIn({ email: 'admin@toko.id', password: 'Sandiku123' });
    try { await AD.db.adminAktifkanPro(sellerId, 149000, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/Referensi/.test(e.message), e.message); }
    try { await AD.db.adminAktifkanPro(sellerId, 0, 'TRX-1'); throw new Error('harus ditolak'); } catch (e) { truthy(/Nominal/.test(e.message), e.message); }
    await AD.db.adminAktifkanPro(sellerId, 149000, 'TRX-1');
    try { await AD.db.adminAktifkanPro(sellerId, 149000, 'TRX-2'); throw new Error('harus ditolak'); } catch (e) { truthy(/sudah Pro/.test(e.message), e.message); }
    try { await AD.db.adminAktifkanPro(lamaId, 149000, 'TRX-1'); throw new Error('harus ditolak'); } catch (e) { truthy(e.status === 409, e.message); }
    truthy(m5.proPayments.filter((x) => x.kind === 'aktivasi').length === 1, 'satu aktivasi tercatat');
    const S2 = fresh().init({ url: u5, key: 'anon', store: memStore() }); await S2.auth.signIn({ email: 'seller@toko.id', password: 'Sandiku123' });
    const pr = await S2.db.profile();
    truthy(S2.isPro(pr) && S2.isProSekaliBayar(pr) && pr.pro_until === null, 'login ulang: Pro sekali bayar dari database, tanpa tanggal');
    const L = fresh().init({ url: u5, key: 'anon', store: memStore() }); await L.auth.signIn({ email: 'lama@toko.id', password: 'Sandiku123' });
    const pl = await L.db.profile(); truthy(L.isPro(pl) && !L.isProSekaliBayar(pl), 'Pro lama (berjangka) tetap berfungsi');
    try { await AD.db.adminCabutPro(sellerId, 'refund', 149000, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/Alasan/.test(e.message), e.message); }
    await AD.db.adminCabutPro(sellerId, 'refund', 149000, 'refund atas permintaan');
    truthy(!S2.isPro(await S2.db.profile()) && m5.proPayments.some((x) => x.kind === 'refund'), 'refund: Pro dicabut, tercatat');
    m5.server.close();
  });
  await t('Pro sekali bayar: sebelum migrasi, fungsi admin memberi pesan jelas; Pro lama tetap terbaca', async () => {
    const m6 = createMock({ proMigrasi: false }); await new Promise((r) => m6.server.listen(0, r)); const u6 = `http://127.0.0.1:${m6.server.address().port}`;
    const id = m6.addUser('x@toko.id', 'Sandiku123', {}); m6.profiles.get(id).pro_until = '2099-01-31'; m6.addUser('adm@toko.id', 'Sandiku123', {}); m6.makeAdmin('adm@toko.id');
    const AD = fresh().init({ url: u6, key: 'anon', store: memStore() }); await AD.auth.signIn({ email: 'adm@toko.id', password: 'Sandiku123' });
    try { await AD.db.adminAktifkanPro(id, 149000, 'TRX-1'); throw new Error('harus gagal'); } catch (e) { truthy(/migrasi belum dijalankan/.test(e.message), e.message); }
    const X = fresh().init({ url: u6, key: 'anon', store: memStore() }); await X.auth.signIn({ email: 'x@toko.id', password: 'Sandiku123' });
    const px = await X.db.profile(); truthy(!('pro_sekali_bayar' in px) && X.isPro(px) && !X.isProSekaliBayar(px), 'tanpa kolom baru: Pro lama tetap Pro');
    m6.server.close();
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
  mock.server.close();
  console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
  process.exitCode = failed ? 1 : 0;
})();
