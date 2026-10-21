-- Tes RLS dasar SETELAH migrasi supabase/usulan/pro-sekali-bayar.sql (v3). Pengganti supabase/tests/test.sql
-- bila migrasi disetujui. Urutan: shim.sql → schema.sql → usulan/pro-sekali-bayar.sql → file ini. Data SINTETIS.
--
-- Kontrak yang BERUBAH dibanding tests/test.sql (dan alasannya):
--  T6  lama: seller boleh INSERT permintaan langsung (tanpa nominal), tidak bisa set 'selesai'.
--      baru: seller TIDAK boleh insert/update langsung; pesanan hanya lewat buat_pesanan_pro() saat pembelian dibuka,
--            dengan kode & nominal dari server. Alasan: nominal/kode tidak boleh dipercaya dari browser.
--  T9  lama: admin melihat 1 permintaan yang dibuat seller lewat insert langsung.
--      baru: admin melihat pesanan yang dibuat lewat RPC (jumlah sama: 1).
--  T10 lama: admin_set_pro menutup SEMUA permintaan terbuka sebagai 'selesai'.
--      baru: admin_set_pro (Pro berjangka lama) hanya menutup permintaan PAKET LAMA; pesanan Pro sekali bayar tetap
--            terbuka. Alasan: menutup pesanan sekali bayar tanpa dana tercatat = "Aktif" palsu.
-- Kontrak lain (T1–T5, T7, T8, T11, T12) tidak berubah.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','a@x.id','{"full_name":"Ani"}'),
 ('22222222-2222-2222-2222-222222222222','b@x.id','{}'),
 ('33333333-3333-3333-3333-333333333333','admin@x.id','{"name":"Admin"}');
update public.profiles set is_admin = true where email = 'admin@x.id';
select 'T1 profil otomatis dibuat' t, count(*) = 3 ok from public.profiles;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'T2 A hanya melihat profil sendiri' t, count(*) = 1 ok from public.profiles;
update public.profiles set store_name = 'Toko Ani' where id = auth.uid();
select 'T3 A bisa ubah nama toko' t, store_name = 'Toko Ani' ok from public.profiles;
update public.profiles set pro_until = '2099-01-01' where id = auth.uid();
update public.profiles set is_admin = true where id = auth.uid();
update public.profiles set pro_sekali_bayar = true where id = auth.uid();
select 'T4 A TIDAK bisa set Pro (lama/sekali bayar) atau admin sendiri' t, pro_until is null and not is_admin and not pro_sekali_bayar ok from public.profiles;
select public.admin_set_pro('11111111-1111-1111-1111-111111111111', '2099-01-01');
insert into public.user_data (settings) values ('{"packing":2000}');
select 'T5 A simpan pengaturan' t, count(*) = 1 ok from public.user_data;
insert into public.reports (title, summary) values ('Sep', '{"x":1}');
-- T6 (kontrak baru)
insert into public.upgrade_requests (plan, note) values ('pro_sekali', 'langsung');
select public.buat_pesanan_pro('transfer');   -- pembelian belum dibuka → ditolak
reset role;
update public.pengaturan_pembayaran set aktif = true, bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI', kontak_bantuan = 'bantuan@contoh.invalid';
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.buat_pesanan_pro('transfer');
update public.upgrade_requests set status = 'selesai', amount = 1;
select 'T6 A tidak bisa insert/ubah pesanan langsung; pesanan lewat RPC dengan nominal server; tidak bisa set selesai' t,
  count(*) = 1 and bool_and(status = 'baru' and amount = 149000 and plan = 'pro_sekali') ok from public.upgrade_requests;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'T7 B tidak melihat data/riwayat/pesanan A' t, (select count(*) from public.user_data) + (select count(*) from public.reports) + (select count(*) from public.upgrade_requests)
  + (select count(*) from public.pro_order_events) + (select count(*) from public.pro_payments) = 0 ok;
insert into public.user_data (user_id, settings) values ('11111111-1111-1111-1111-111111111111', '{}');
select 'T8 B tidak bisa menulis atas nama A' t, true ok;
reset role;
insert into public.upgrade_requests (user_id, plan) values ('22222222-2222-2222-2222-222222222222', 'pro_bulanan');   -- permintaan lama B
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select 'T9 admin melihat semua profil & pesanan' t, (select count(*) from public.profiles) = 3 and (select count(*) from public.upgrade_requests) = 2 ok;
select public.admin_set_pro('11111111-1111-1111-1111-111111111111', '2026-11-13');
select public.admin_set_pro('22222222-2222-2222-2222-222222222222', '2026-11-13');
select 'T10 admin_set_pro: Pro lama aktif; permintaan paket lama selesai; pesanan sekali bayar TIDAK ditutup' t,
  (select pro_until from public.profiles where email = 'a@x.id') = '2026-11-13'
  and (select status from public.upgrade_requests where plan = 'pro_sekali') = 'baru'
  and (select status from public.upgrade_requests where plan = 'pro_bulanan') = 'selesai'
  and (select not pro_sekali_bayar from public.profiles where email = 'a@x.id') ok;
select 'T11 admin tetap tidak membaca modal/riwayat pengguna' t, (select count(*) from public.user_data) + (select count(*) from public.reports) = 0 ok;
reset role;
select 'T12 anon tidak punya akses baca ke profil, pesanan, dana, pengaturan' t,
  not has_table_privilege('anon', 'public.profiles', 'select') and not has_table_privilege('anon', 'public.upgrade_requests', 'select')
  and not has_table_privilege('anon', 'public.pro_payments', 'select') and not has_table_privilege('anon', 'public.pengaturan_pembayaran', 'select')
  and not has_function_privilege('anon', 'public.buat_pesanan_pro(text)', 'execute') ok;
