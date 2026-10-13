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
  await t('email sudah terdaftar → pesan jelas', async () => {
    try { await C.auth.signUp({ email: 'ani@toko.id', password: 'sandiku123' }); throw new Error('harus gagal'); } catch (e) { truthy(/sudah terdaftar/.test(e.message), e.message); }
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
  mock.server.close();
  console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
  process.exitCode = failed ? 1 : 0;
})();
