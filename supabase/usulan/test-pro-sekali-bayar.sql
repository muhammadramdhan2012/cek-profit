-- Uji lokal usulan pro-sekali-bayar.sql (PostgreSQL + supabase/tests/shim.sql). Data sintetis.
-- Urutan: shim.sql → schema.sql → usulan/pro-sekali-bayar.sql → file ini. Setiap baris hasil harus berakhir |t.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a','free@x.id','{}'),
 ('b0000000-0000-0000-0000-00000000000b','beli@x.id','{}'),
 ('c0000000-0000-0000-0000-00000000000c','lama@x.id','{}'),
 ('d0000000-0000-0000-0000-00000000000d','admin@x.id','{}');
update public.profiles set is_admin = true where email = 'admin@x.id';
update public.profiles set pro_until = '2099-01-31' where email = 'lama@x.id';   -- Pro lama (bertanggal)

-- Pengguna biasa
set role authenticated; select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',false);
update public.profiles set pro_sekali_bayar = true where id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set pro_until = '2999-01-01' where id = 'a0000000-0000-0000-0000-00000000000a';
select 'P1 akun gratis tidak bisa menjadikan dirinya Pro (kolom baru maupun lama)' t, (select not pro_sekali_bayar and pro_until is null from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') ok;
select public.admin_aktifkan_pro_sekali('a0000000-0000-0000-0000-00000000000a', 149000, 'TRX-PALSU');
select 'P2 pengguna biasa tidak bisa memanggil aktivasi' t, (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') ok;
insert into public.pro_payments (user_id, kind, amount, reference, created_by) values ('a0000000-0000-0000-0000-00000000000a','aktivasi',149000,'TRX-X','a0000000-0000-0000-0000-00000000000a');
select 'P3 pengguna tidak bisa menulis catatan pembayaran' t, (select count(*) from public.pro_payments) = 0 ok;
insert into public.upgrade_requests (plan) values ('pro_sekali');
select 'P4 permintaan paket pro_sekali bisa dibuat' t, (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 1 ok;
select public.admin_cabut_pro('c0000000-0000-0000-0000-00000000000c', 'pencabutan', 0, 'iseng');
reset role;
select 'P5 pengguna biasa tidak bisa mencabut Pro orang lain' t, (select pro_until from public.profiles where email = 'lama@x.id') = '2099-01-31' ok;

set role authenticated; select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b',false);
insert into public.upgrade_requests (plan) values ('pro_sekali');
reset role;
-- Admin
set role authenticated; select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_aktifkan_pro_sekali('b0000000-0000-0000-0000-00000000000b', 0, 'TRX-001');
select public.admin_aktifkan_pro_sekali('b0000000-0000-0000-0000-00000000000b', 149000, '');
reset role;
select 'P6 tanpa nominal/referensi tidak mengaktifkan Pro' t, (select not pro_sekali_bayar from public.profiles where email = 'beli@x.id') ok;
set role authenticated; select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_aktifkan_pro_sekali('b0000000-0000-0000-0000-00000000000b', 149000, 'TRX-001', 'transfer terverifikasi di mutasi');
reset role;
select 'P7 aktivasi admin: Pro sekali bayar + tercatat + terhubung ke permintaan' t, (select pro_sekali_bayar and pro_until is null from public.profiles where email = 'beli@x.id')
  and (select request_id is not null from public.pro_payments where reference = 'TRX-001') and (select status from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b') = 'selesai'
  and (select count(*) from public.pro_payments where kind = 'aktivasi' and amount = 149000 and reference = 'TRX-001') = 1 ok;
set role authenticated; select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_aktifkan_pro_sekali('b0000000-0000-0000-0000-00000000000b', 149000, 'TRX-002');
select public.admin_aktifkan_pro_sekali('a0000000-0000-0000-0000-00000000000a', 149000, 'TRX-001');
reset role;
select 'P8 tidak ada aktivasi ganda (akun sama / referensi sama)' t, (select count(*) from public.pro_payments where kind = 'aktivasi') = 1
  and (select not pro_sekali_bayar from public.profiles where email = 'free@x.id') ok;
select 'P9 Pro lama (bertanggal) tidak berubah' t, (select pro_until from public.profiles where email = 'lama@x.id') = '2099-01-31' ok;

-- Pembeli melihat catatannya sendiri saja
set role authenticated; select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b',false);
select 'P10 pembeli melihat catatan pembayarannya' t, count(*) = 1 ok from public.pro_payments;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',false);
select 'P11 akun lain tidak melihat catatan pembayaran orang lain' t, count(*) = 0 ok from public.pro_payments;
select 'P12 akun lain tidak bisa membaca status Pro pembeli' t, (select count(*) from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b') = 0 ok;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-00000000000b',false);
select 'P13 pembeli membaca status Pro-nya dari database' t, (select pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b') ok;

-- Refund / pencabutan oleh admin, tercatat
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_cabut_pro('b0000000-0000-0000-0000-00000000000b', 'refund', 149000, '');
reset role;
select 'P14 pencabutan tanpa alasan ditolak' t, (select pro_sekali_bayar from public.profiles where email = 'beli@x.id') ok;
set role authenticated; select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_cabut_pro('b0000000-0000-0000-0000-00000000000b', 'refund', 149000, 'refund atas permintaan pembeli');
reset role;
select 'P15 refund: Pro dicabut dan tercatat' t, (select not pro_sekali_bayar from public.profiles where email = 'beli@x.id')
  and (select count(*) from public.pro_payments where kind = 'refund' and amount = 149000) = 1 ok;

set role authenticated; select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',false);
select public.admin_cabut_pro('c0000000-0000-0000-0000-00000000000c', 'pencabutan', 0, 'coba cabut Pro lama');
reset role;
select 'P18 cabut sekali bayar tidak menyentuh Pro lama (berjangka)' t, (select pro_until from public.profiles where email = 'lama@x.id') = '2099-01-31' ok;
select 'P19 kolom baru default false untuk semua akun lain' t, (select count(*) from public.profiles where pro_sekali_bayar and email <> 'beli@x.id') = 0 ok;

-- Batas riwayat akun gratis (opsional)
set role authenticated; select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',false);
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}');
insert into public.reports (title, summary) values ('4','{}');
select 'P16 akun gratis: riwayat ke-4 ditolak database' t, count(*) = 3 ok from public.reports;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-00000000000c',false);
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}'),('4','{}');
select 'P17 akun Pro: riwayat tanpa batas' t, count(*) = 4 ok from public.reports;
reset role;
