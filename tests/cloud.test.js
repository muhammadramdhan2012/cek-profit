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
  await t('Pro lama (berjangka): admin_set_pro tetap berfungsi; permintaan lama ikut selesai', async () => {
    const C4 = fresh().init({ url, key: 'anon', store });
    const me = await C4.db.profile();
    mock.requests.push({ id: 999, user_id: me.id, plan: 'pro_bulanan', note: '', status: 'baru', created_at: new Date().toISOString() });   // permintaan lama yang sudah ada
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
  /* ---------- Checkout Pro manual (server TIRUAN meniru supabase/usulan/pro-sekali-bayar.sql v2) ---------- */
  await t('Checkout: pesanan dibuat server (harga resmi, kode unik), satu pesanan terbuka, klaim bayar tidak mengaktifkan Pro', async () => {
    const m5 = createMock(); await new Promise((r) => m5.server.listen(0, r)); const u5 = `http://127.0.0.1:${m5.server.address().port}`;
    m5.addUser('a@toko.id', 'Sandiku123', {}); m5.addUser('b@toko.id', 'Sandiku123', {}); m5.addUser('adm@toko.id', 'Sandiku123', {}); m5.makeAdmin('adm@toko.id');
    const masuk = async (email) => { const c = fresh().init({ url: u5, key: 'anon', store: memStore() }); await c.auth.signIn({ email, password: 'Sandiku123' }); return c; };
    const A = await masuk('a@toko.id'), B = await masuk('b@toko.id'), AD = await masuk('adm@toko.id');
    try { await A.db.buatPesanan('transfer'); throw new Error('harus ditolak'); } catch (e) { truthy(/belum dibuka/.test(e.message), e.message); }
    Object.assign(m5.pengaturan, { aktif: true, bank_nama: 'BANK UJI', bank_nomor: '0000000000', bank_pemilik: 'PEMILIK UJI', kontak_bantuan: 'bantuan@contoh.invalid' });   // data SINTETIS
    try { await A.db.buatPesanan('qris'); throw new Error('harus ditolak'); } catch (e) { truthy(/tidak tersedia/.test(e.message), e.message); }
    const o = await A.db.buatPesanan('transfer');
    truthy(o.amount === 149000 && /^CU-[0-9A-F]{8}$/.test(o.order_code) && o.status === 'baru', JSON.stringify(o));
    truthy((await A.db.buatPesanan('transfer')).id === o.id, 'pesanan ganda tidak dibuat');
    try { await fetch(`${u5}/rest/v1/upgrade_requests`, { method: 'POST', headers: { apikey: 'anon', Authorization: `Bearer ${A.auth.session().access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'pro_sekali', amount: 1 }) }).then((r) => { if (r.status !== 403) throw new Error(`insert langsung harus ditolak: ${r.status}`); }); } catch (e) { throw e; }
    truthy((await B.db.pesananSaya()).length === 0, 'B tidak melihat pesanan A');
    try { await B.db.konfirmasiBayar(o.id); throw new Error('harus ditolak'); } catch (e) { truthy(/tidak ditemukan/.test(e.message), e.message); }
    const k = await A.db.konfirmasiBayar(o.id, 'sudah transfer'); truthy(k.status === 'diproses', 'menunggu verifikasi');
    truthy(!A.isPro(await A.db.profile()), 'klaim bayar TIDAK mengaktifkan Pro');
    try { await A.db.batalkanPesanan(o.id); throw new Error('harus ditolak'); } catch (e) { truthy(/admin/.test(e.message), e.message); }
    try { await A.db.adminVerifikasi(o.id, 'transfer', 'TRX-SENDIRI', 149000); throw new Error('harus ditolak'); } catch (e) { truthy(/Hanya admin/.test(e.message), e.message); }
    // admin
    try { await AD.db.adminVerifikasi(o.id, 'transfer', 'TRX-001', 100000); throw new Error('harus ditolak'); } catch (e) { truthy(/kurang/.test(e.message), e.message); }
    truthy((await AD.db.adminVerifikasi(o.id, 'transfer', 'TRX-001', 149000)) === 'aktif', 'aktif');
    truthy((await AD.db.adminVerifikasi(o.id, 'transfer', 'trx 001', 149000)) === 'sudah_aktif', 'ulang aman');
    const A2 = await masuk('a@toko.id'); const pa = await A2.db.profile();
    truthy(A2.isPro(pa) && A2.isProSekaliBayar(pa), 'login ulang: Pro sekali bayar');
    truthy((await A2.db.historiPesanan(o.id)).map((x) => x.status_baru).join('>') === 'baru>diproses>selesai', 'histori status');
    const ob = await B.db.buatPesanan('transfer');
    try { await AD.db.adminVerifikasi(ob.id, 'transfer', 'TRX/001', 149000); throw new Error('harus ditolak'); } catch (e) { truthy(/sudah tercatat/.test(e.message), e.message); }
    truthy(!B.isPro(await B.db.profile()), 'satu pembayaran tidak mengaktifkan dua akun');
    truthy((await AD.db.adminVerifikasi(ob.id, 'qris', 'QR-1', 150000)) === 'aktif_kelebihan', 'kelebihan bayar');
    const payB = m5.proPayments.find((x) => x.reference === 'QR-1').id, payA = m5.proPayments.find((x) => x.reference === 'TRX-001').id;
    try { await AD.db.adminRefund(payB, 200000, 'kelebihan', false); throw new Error('harus ditolak'); } catch (e) { truthy(/1 sampai 150000/.test(e.message), e.message); }
    await AD.db.adminRefund(payB, 1000, 'kelebihan bayar', false); truthy(B.isPro(await B.db.profile()), 'refund kelebihan: Pro tetap');
    truthy(m5.proPayments.find((x) => x.kind === 'refund').refund_of === payB, 'refund menunjuk pembayaran asal');
    await AD.db.adminRefund(payA, 149000, 'refund atas permintaan', true); truthy(!A2.isPro(await A2.db.profile()), 'refund penuh: Pro dicabut');
    truthy((await A2.db.pesananSaya())[0].status === 'direfund' && (await B.db.pesananSaya()).every((x) => x.user_id !== m5.profiles.get([...m5.users.values()].find((u) => u.email === 'a@toko.id').id).id), 'status direfund; B hanya melihat miliknya');
    truthy(m5.proPayments.length === 4, 'buku besar: 2 pembayaran + 2 refund, tidak ada yang dihapus');
    m5.server.close();
  });
  await t('Pembayaran ambigu (QRIS statis), 48 jam, koreksi, catatan internal, pengaturan hanya admin', async () => {
    const m7 = createMock(); await new Promise((r) => m7.server.listen(0, r)); const u7 = `http://127.0.0.1:${m7.server.address().port}`;
    for (const e of ['e@toko.id', 'f@toko.id', 'g@toko.id', 'adm@toko.id']) m7.addUser(e, 'Sandiku123', {}); m7.makeAdmin('adm@toko.id');
    const masuk = async (email) => { const c = fresh().init({ url: u7, key: 'anon', store: memStore() }); await c.auth.signIn({ email, password: 'Sandiku123' }); return c; };
    const E = await masuk('e@toko.id'), F = await masuk('f@toko.id'), G = await masuk('g@toko.id'), AD = await masuk('adm@toko.id');
    try { await E.db.adminPengaturan({ aktif: true }); throw new Error('harus ditolak'); } catch (e) { truthy(/bukan admin/.test(e.message), e.message); }
    try { await AD.db.adminPengaturan({ aktif: true }); throw new Error('harus ditolak'); } catch (e) { truthy(/lengkapi kontak bantuan/.test(e.message), e.message); }
    await AD.db.adminPengaturan({ aktif: true, qris_merchant: 'MERCHANT UJI', qris_gambar: 'img/qris-uji.png', kontak_bantuan: 'bantuan@contoh.invalid' });   // SINTETIS
    truthy(m7.audit.some((x) => x.aksi === 'ubah_pengaturan'), 'perubahan pengaturan tercatat');
    const oe = await E.db.buatPesanan('qris'), of = await F.db.buatPesanan('qris');
    await E.db.konfirmasiBayar(oe.id, '10.01 a.n. E'); await F.db.konfirmasiBayar(of.id, '10.02 a.n. F');
    const d1 = await AD.db.adminCatatDana('qris', 'QRIS-AMB-1', 149000, '10:01 nama tidak jelas'), d2 = await AD.db.adminCatatDana('qris', 'QRIS-AMB-2', 149000, '10:02 nama tidak jelas');
    truthy(!E.isPro(await E.db.profile()) && !F.isPro(await F.db.profile()), 'dana ambigu tidak mengaktifkan Pro');
    await AD.db.adminCatatan(oe.id, 'cocokkan jam bayar via email', true);
    truthy((await E.db.pesananSaya())[0].status === 'perlu_cek' && (await E.db.historiPesanan(oe.id)).every((x) => !x.internal), 'pembeli: Perlu pemeriksaan, catatan internal tersembunyi');
    truthy((await AD.db.historiPesanan(oe.id)).some((x) => x.internal), 'admin melihat catatan internal');
    try { await AD.db.adminVerifikasi(oe.id, 'qris', 'qris amb 1', 149000); throw new Error('harus ditolak'); } catch (e) { truthy(/belum teridentifikasi/.test(e.message), e.message); }
    try { await AD.db.adminHubungkanDana(d1, oe.id, ''); throw new Error('harus ditolak'); } catch (e) { truthy(/wajib/.test(e.message), e.message); }
    truthy((await AD.db.adminHubungkanDana(d1, oe.id, 'jam 10:01 cocok')) === 'aktif' && E.isPro(await E.db.profile()), 'hubungkan dana → Pro aktif');
    try { await AD.db.adminHubungkanDana(d1, of.id, 'dana sama'); throw new Error('harus ditolak'); } catch (e) { truthy(/sudah terhubung/.test(e.message), e.message); }
    await AD.db.adminRefund(d2, 149000, 'tidak ada pembeli yang cocok', false);
    try { await AD.db.adminHubungkanDana(d2, of.id, 'setelah refund'); throw new Error('harus ditolak'); } catch (e) { truthy(/direfund/.test(e.message), e.message); }
    await AD.db.adminTolak(of.id, 'dana tidak ditemukan'); truthy((await F.db.pesananSaya())[0].status === 'ditolak' && !F.isPro(await F.db.profile()), 'pesanan tanpa dana ditolak');
    try { await AD.db.adminKoreksiRef(d1, 'QRIS-AMB-2', 'salah ketik'); throw new Error('harus ditolak'); } catch (e) { truthy(/sudah tercatat/.test(e.message), e.message); }
    await AD.db.adminKoreksiRef(d1, 'QRIS-AMB-01', 'salah ketik'); truthy(m7.audit.some((x) => x.aksi === 'koreksi_referensi' && x.lama.reference === 'QRIS-AMB-1'), 'koreksi tercatat');
    // bayar setelah 48 jam
    const og = await G.db.buatPesanan('qris'); m7.requests.find((r) => r.id === og.id).created_at = new Date(Date.now() - 50 * 36e5).toISOString();
    truthy((await G.db.konfirmasiBayar(og.id, 'bayar telat')).status === 'perlu_cek' && !G.isPro(await G.db.profile()), 'klaim setelah 48 jam → Perlu pemeriksaan, Pro tidak aktif');
    truthy((await G.db.buatPesanan('qris')).id === og.id, 'tidak bisa membuat pesanan baru selama diperiksa');
    truthy((await AD.db.adminVerifikasi(og.id, 'qris', 'QRIS-TELAT', 149000)) === 'aktif', 'dana terlambat diaktifkan admin setelah rekonsiliasi');
    // admin_set_pro (Pro lama) tidak menutup pesanan sekali bayar
    await AD.db.adminTolak(oe.id, 'uji').catch(() => {});
    m7.addUser('h@toko.id', 'Sandiku123', {}); const H = await masuk('h@toko.id'); const oh = await H.db.buatPesanan('qris');
    await AD.db.adminSetPro(H.auth.user().id, '2099-01-01');
    truthy((await H.db.pesananSaya())[0].id === oh.id && (await H.db.pesananSaya())[0].status === 'baru', 'admin_set_pro tidak menutup pesanan sekali bayar');
    m7.server.close();
  });
  await t('Lingkungan staging fail-closed: host staging tidak pernah jatuh ke produksi; host produksi tidak bisa dialihkan', async () => {
    const vm = require('vm'), code = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'config.js'), 'utf8');
    const KOSONG = "staging: { supabaseUrl: '', supabaseAnonKey: '', hosts: [] },";
    truthy(code.includes(KOSONG), 'config.js bawaan: staging kosong');
    // Konteks sengaja diberi URL berparameter + localStorage berisi "staging" untuk membuktikan keduanya diabaikan.
    const muat = (host, isi) => {
      const w = {}; const ls = { getItem: () => JSON.stringify(isi), setItem() {} };
      vm.runInNewContext(code.replace(KOSONG, `staging: ${JSON.stringify(isi)},`), { window: w, atob: (x) => Buffer.from(x, 'base64').toString('binary'),
        localStorage: ls, location: { hostname: host, search: `?supabaseUrl=${isi.supabaseUrl}&env=staging`, hash: '#staging' } });
      return w.CEK_CONFIG;
    };
    const PROD = /^https:\/\/ikjcbgfexhpksbewkpym\.supabase\.co$/;
    const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.c2lnbmF0dXJl`;
    const URL_ST = 'https://abcdefghijklmnopqrst.supabase.co', KEY_ST = 'sb_publishable_UJIstaging1234';
    const PV = 'feature-pro-pricing.cekuntung.pages.dev';
    const ok = { supabaseUrl: URL_ST, supabaseAnonKey: KEY_ST, hosts: [PV, 'cekuntung.id', 'www.cekuntung.id', 'cekuntung.pages.dev', 'muhammadramdhan2012.github.io', 'localhost'] };
    const kosong = { supabaseUrl: '', supabaseAnonKey: '', hosts: [] };
    const produksi = (c) => c.lingkungan === 'produksi' && PROD.test(c.supabaseUrl) && c.supabaseAnonKey.length > 0;
    const mati = (c) => c.lingkungan === 'staging-belum-siap' && c.supabaseUrl === '' && c.supabaseAnonKey === '' && /belum siap/.test(c.konfigurasiBelumSiap);
    // 1. Host produksi: selalu produksi, walau didaftarkan di staging.hosts, dan walau URL/localStorage berisi staging.
    for (const h of ['cekuntung.id', 'www.cekuntung.id', 'CEKUNTUNG.ID', 'cekuntung.pages.dev', 'muhammadramdhan2012.github.io']) {
      truthy(produksi(muat(h, ok)), `${h} + staging valid & terdaftar → tetap produksi`);
      truthy(produksi(muat(h, kosong)), `${h} + staging kosong → produksi`);
    }
    // 2. Host staging: valid → staging; selain itu fail-closed.
    const st = muat(PV, ok); truthy(st.lingkungan === 'staging' && st.supabaseUrl === URL_ST && st.supabaseAnonKey === KEY_ST, 'preview terdaftar + konfigurasi valid → staging');
    truthy(muat(PV.toUpperCase(), ok).lingkungan === 'staging', 'nama host tidak peka huruf besar');
    truthy(muat(PV, { ...ok, supabaseAnonKey: jwt('anon') }).lingkungan === 'staging', 'kunci anon lama (JWT role anon) diterima');
    const prodCfg = muat('cekuntung.id', kosong);
    const salah = {
      'staging kosong': kosong,
      'host tidak terdaftar': { ...ok, hosts: ['lain.cekuntung.pages.dev'] },
      'URL kosong': { ...ok, supabaseUrl: '' },
      'kunci kosong': { ...ok, supabaseAnonKey: '' },
      'URL = produksi': { ...ok, supabaseUrl: prodCfg.supabaseUrl },
      'kunci = produksi': { ...ok, supabaseAnonKey: prodCfg.supabaseAnonKey },
      'URL http': { ...ok, supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co' },
      'URL domain lain': { ...ok, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co.evil.id' },
      'URL bergaris miring': { ...ok, supabaseUrl: URL_ST + '/' },
      'secret key': { ...ok, supabaseAnonKey: 'sb_secret_abcdefghijklmnop' },
      'JWT service_role': { ...ok, supabaseAnonKey: jwt('service_role') },
      'JWT rusak': { ...ok, supabaseAnonKey: 'eyJxx.yy.zz' },
      'hosts bukan array': { ...ok, hosts: PV },
      'tipe salah': { supabaseUrl: 123, supabaseAnonKey: null, hosts: [PV] },
    };
    for (const [nama, isi] of Object.entries(salah)) truthy(mati(muat(PV, isi)), `preview + ${nama} → fitur akun mati, bukan produksi`);
    truthy(mati(muat('cabang-lain.cekuntung.pages.dev', ok)), 'preview Cloudflare lain (tidak terdaftar) → mati, bukan produksi');
    truthy(mati(muat('a.b.cekuntung.pages.dev', kosong)), 'sub-subdomain preview → mati');
    truthy(mati(muat('staging.contoh.id', { ...ok, hosts: ['staging.contoh.id'], supabaseAnonKey: 'sb_secret_x1234567890' })), 'host staging kustom + kunci salah → mati');
    truthy(muat('staging.contoh.id', { ...ok, hosts: ['staging.contoh.id'] }).lingkungan === 'staging', 'host staging kustom terdaftar + valid → staging');
    // 3. Host lain (pengembangan lokal): perilaku lama.
    truthy(produksi(muat('127.0.0.1', kosong)), 'localhost tanpa staging → produksi (perilaku lama)');
    truthy(muat('localhost', ok).lingkungan === 'staging', 'localhost yang sengaja didaftarkan → staging');
    truthy(produksi(muat('cekuntung.id.evil.id', ok)), 'domain tiruan bukan preview → bukan staging (dan tidak terdaftar)');
    truthy(!/location\.(search|hash)|localStorage|sessionStorage|document\.cookie/.test(code), 'config.js tidak membaca URL, localStorage, atau cookie');
    truthy(!/sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}/.test(code), 'tanpa secret key');
  });
  await t('Pita STAGING hanya tampil setelah database menjawab staging', async () => {
    const S = require('../assets/situs.js');
    const dok = () => { const el = { id: '', className: '', textContent: '', setAttribute() {} }; let ada = null;
      return { el, getElementById: () => ada, createElement: () => el, body: { prepend: (x) => { ada = x; } } }; };
    const cfg = { lingkungan: 'staging', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabaseAnonKey: 'sb_publishable_x' };
    let dipanggil = '';
    const jawab = (status, isi) => async (url) => { dipanggil = url; return { ok: status === 200, json: async () => isi }; };
    let d = dok(); truthy((await S.tandaStaging(d, cfg, jawab(200, { lingkungan: 'staging', ref: 'abcdefghijklmnopqrst' }))) === 'staging' && /^STAGING/.test(d.el.textContent) && /\/rest\/v1\/rpc\/info_lingkungan$/.test(dipanggil), 'terverifikasi → pita STAGING');
    d = dok(); truthy((await S.tandaStaging(d, cfg, jawab(404, {}))) === 'tidak-terverifikasi' && /PERINGATAN/.test(d.el.textContent) && !/^STAGING/.test(d.el.textContent), 'RPC tidak ada (mis. database produksi) → peringatan, bukan STAGING');
    d = dok(); truthy((await S.tandaStaging(d, cfg, jawab(200, 'staging'))) === 'tidak-terverifikasi', 'jawaban format lama/lain → peringatan');
    d = dok(); truthy((await S.tandaStaging(d, cfg, jawab(200, { lingkungan: 'staging', ref: 'zzzzzzzzzzzzzzzzzzzz' }))) === 'tidak-terverifikasi', 'ref database berbeda dari URL → peringatan');
    d = dok(); truthy((await S.tandaStaging(d, cfg, async () => { throw new Error('offline'); })) === 'tidak-terverifikasi', 'offline → peringatan');
    d = dok(); truthy((await S.tandaStaging(d, { lingkungan: 'staging-belum-siap', konfigurasiBelumSiap: 'Konfigurasi database staging belum siap.' })) === 'belum-siap' && /belum siap/.test(d.el.textContent), 'belum siap → pita peringatan');
    d = dok(); let panggil = 0; truthy((await S.tandaStaging(d, { lingkungan: 'produksi' }, async () => { panggil++; })) === '' && panggil === 0 && d.el.textContent === '', 'produksi → tanpa pita & tanpa permintaan jaringan');
  });
  await t('Checkout: sebelum migrasi, pesan jelas dan Pro lama tetap terbaca', async () => {
    const m6 = createMock({ proMigrasi: false }); await new Promise((r) => m6.server.listen(0, r)); const u6 = `http://127.0.0.1:${m6.server.address().port}`;
    const id = m6.addUser('x@toko.id', 'Sandiku123', {}); m6.profiles.get(id).pro_until = '2099-01-31'; m6.addUser('adm@toko.id', 'Sandiku123', {}); m6.makeAdmin('adm@toko.id');
    const AD = fresh().init({ url: u6, key: 'anon', store: memStore() }); await AD.auth.signIn({ email: 'adm@toko.id', password: 'Sandiku123' });
    try { await AD.db.adminVerifikasi(1, 'transfer', 'TRX-1', 149000); throw new Error('harus gagal'); } catch (e) { truthy(/migrasi belum dijalankan/.test(e.message), e.message); }
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
