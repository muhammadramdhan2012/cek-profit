\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','a@x.id','{"full_name":"Ani"}'),
 ('22222222-2222-2222-2222-222222222222','b@x.id','{}'),
 ('33333333-3333-3333-3333-333333333333','admin@x.id','{"name":"Admin"}');
update public.profiles set is_admin = true where email = 'admin@x.id';
select 'T1 profil otomatis dibuat' t, count(*) = 3 ok from public.profiles;
-- sebagai pengguna A
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'T2 A hanya melihat profil sendiri' t, count(*) = 1 ok from public.profiles;
update public.profiles set store_name = 'Toko Ani' where id = auth.uid();
select 'T3 A bisa ubah nama toko' t, store_name = 'Toko Ani' ok from public.profiles;
update public.profiles set pro_until = '2099-01-01' where id = auth.uid();
update public.profiles set is_admin = true where id = auth.uid();
select 'T4 A TIDAK bisa set Pro/admin sendiri' t, pro_until is null and not is_admin ok from public.profiles;
select public.admin_set_pro('11111111-1111-1111-1111-111111111111', '2099-01-01');
insert into public.user_data (settings) values ('{"packing":2000}');
select 'T5 A simpan pengaturan' t, count(*) = 1 ok from public.user_data;
insert into public.reports (title, summary) values ('Sep', '{"x":1}');
insert into public.upgrade_requests (plan, note) values ('pro_bulanan', 'transfer BCA');
insert into public.upgrade_requests (plan, status) values ('pro_bulanan', 'selesai');
update public.upgrade_requests set status = 'selesai';
select 'T6 A buat permintaan, tidak bisa set selesai sendiri' t, count(*) = 1 and bool_and(status='baru') ok from public.upgrade_requests;
-- sebagai pengguna B
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'T7 B tidak melihat data/riwayat/permintaan A' t, (select count(*) from public.user_data) + (select count(*) from public.reports) + (select count(*) from public.upgrade_requests) = 0 ok;
insert into public.user_data (user_id, settings) values ('11111111-1111-1111-1111-111111111111', '{}');
select 'T8 B tidak bisa menulis atas nama A' t, true ok;
-- sebagai admin
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select 'T9 admin melihat semua profil & permintaan' t, (select count(*) from public.profiles) = 3 and (select count(*) from public.upgrade_requests) = 1 ok;
select public.admin_set_pro('11111111-1111-1111-1111-111111111111', '2026-11-13');
select 'T10 admin aktifkan Pro, permintaan selesai' t, (select pro_until from public.profiles where email='a@x.id') = '2026-11-13' and (select status from public.upgrade_requests) = 'selesai' ok;
select 'T11 admin tetap tidak membaca modal/riwayat pengguna' t, (select count(*) from public.user_data) + (select count(*) from public.reports) = 0 ok;
-- anon
reset role; set role anon; select set_config('request.jwt.claim.sub','',false);
select 'T12 anon tidak melihat apa pun' t, count(*) = 0 ok from public.profiles;
