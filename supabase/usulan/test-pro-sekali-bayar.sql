-- Uji lokal usulan v2 pro-sekali-bayar.sql (PostgreSQL + supabase/tests/shim.sql). Data SINTETIS, tanpa rekening asli.
-- Urutan: shim.sql → schema.sql → usulan/pro-sekali-bayar.sql → file ini. Setiap baris hasil harus berakhir |t.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a','a@x.id','{}'),
 ('b0000000-0000-0000-0000-00000000000b','b@x.id','{}'),
 ('c0000000-0000-0000-0000-00000000000c','lama@x.id','{}'),
 ('d0000000-0000-0000-0000-00000000000d','admin@x.id','{}');
update public.profiles set is_admin = true where email = 'admin@x.id';
update public.profiles set pro_until = '2099-01-31' where email = 'lama@x.id';
insert into public.upgrade_requests (user_id, plan) values ('c0000000-0000-0000-0000-00000000000c', 'pro_bulanan');   -- permintaan lama

create or replace function pg_temp.sebagai(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
create or replace function pg_temp.pesanan(uid uuid) returns public.upgrade_requests language sql as $$
  select * from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' order by id desc limit 1 $$;

-- ---------- pembelian belum dibuka ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('transfer');
insert into public.upgrade_requests (plan) values ('pro_sekali');
update public.pengaturan_pembayaran set aktif = true, bank_nomor = '1';
reset role;
select 'O1 belum dibuka: tidak ada pesanan; seller tidak bisa insert langsung atau mengubah pengaturan' t,
  (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 0 and (select not aktif and bank_nomor = '' from public.pengaturan_pembayaran) ok;

-- ---------- admin mengatur (data SINTETIS) ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
update public.pengaturan_pembayaran set aktif = true, bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI';
reset role;
select 'O2 tidak bisa dibuka tanpa kontak bantuan' t, (select not aktif from public.pengaturan_pembayaran) ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
update public.pengaturan_pembayaran set aktif = true, bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI', kontak_bantuan = 'bantuan@contoh.invalid';
reset role;
select 'O3 admin membuka pembelian (transfer saja)' t, (select aktif from public.pengaturan_pembayaran) ok;

-- ---------- seller A membuat pesanan ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('qris');
select public.buat_pesanan_pro('transfer');
select public.buat_pesanan_pro('transfer');
reset role;
select 'O4 pesanan: harga resmi server, kode CU-, satu pesanan terbuka, QRIS yang belum diatur ditolak' t,
  (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 1
  and (select amount = 149000 and order_code ~ '^CU-[0-9A-F]{8}$' and status = 'baru' and metode = 'transfer' from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) ok;
select 'O5 histori pesanan tercatat' t, (select count(*) from public.pro_order_events where status_baru = 'baru' and status_lama is null) = 1 ok;

-- ---------- isolasi antar-seller ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select 'O6 seller B tidak melihat pesanan/histori A' t, (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 0
  and (select count(*) from public.pro_order_events) = 0 ok;
select public.konfirmasi_sudah_bayar((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')));
reset role;
select 'O7 B tidak bisa mengonfirmasi pesanan A' t, (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'baru' ok;

-- ---------- klaim "sudah membayar" ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'), 'sudah transfer, ini screenshot')).status;
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'))).status;
select public.batalkan_pesanan((select id from public.upgrade_requests where plan = 'pro_sekali'));
update public.upgrade_requests set status = 'selesai' where plan = 'pro_sekali';
update public.profiles set pro_sekali_bayar = true where id = 'a0000000-0000-0000-0000-00000000000a';
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where plan = 'pro_sekali'), 'transfer', 'TRX-PALSU', 149000);
reset role;
select 'O8 klaim/screenshot → hanya Menunggu Verifikasi; Pro tidak aktif; seller tidak bisa mengesahkan sendiri' t,
  (select status = 'diproses' and claimed_at is not null from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))
  and (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments) = 0 ok;

-- ---------- verifikasi admin ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-001', 100000);
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', '', 149000);
reset role;
select 'O9 kurang bayar / tanpa referensi → Pro tidak aktif' t, (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments) = 0 ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-001', 149000, 'mutasi 21/10');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'trx 001', 149000);
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-999', 149000);
reset role;
select 'O10 aktivasi atomik: Pro aktif + pembayaran + status + histori + admin pencatat' t,
  (select pro_sekali_bayar and pro_until is null from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'selesai'
  and (select count(*) from public.pro_payments where kind = 'pembayaran' and amount = 149000 and reference_norm = 'TRX001'
       and created_by = 'd0000000-0000-0000-0000-00000000000d') = 1
  and (select count(*) from public.pro_order_events where status_baru = 'selesai' and oleh = 'd0000000-0000-0000-0000-00000000000d') = 1 ok;
select 'O11 ulang (referensi sama, format beda) aman; referensi lain pada pesanan aktif ditolak' t, (select count(*) from public.pro_payments) = 1 ok;

-- ---------- seller B: referensi ganda & kelebihan bayar ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select public.buat_pesanan_pro('transfer');
select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 'transfer', 'Trx/001', 149000);
reset role;
select 'O12 satu pembayaran tidak bisa mengaktifkan dua akun' t, (select not pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b') ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 'transfer', 'TRX-002', 150000);
select public.admin_refund_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 200000, 'kelebihan', false);
select public.admin_refund_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 1000, 'kelebihan bayar dikembalikan', false);
reset role;
select 'O13 kelebihan bayar: Pro aktif, refund kelebihan ≤ saldo, Pro tetap' t,
  (select pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b')
  and (select count(*) from public.pro_payments where kind = 'refund' and amount = 1000) = 1
  and (select count(*) from public.pro_payments where kind = 'refund' and amount = 200000) = 0 ok;

-- ---------- transfer ganda dicatat lalu direfund ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_catat_pembayaran_tambahan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'qris', 'QR-777', 149000, 'transfer ganda');
select public.admin_refund_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 149000, 'transfer ganda dikembalikan', false);
reset role;
select 'O14 transfer ganda: tercatat & direfund, hak akses tidak berubah' t,
  (select pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments where order_id = (select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))) = 3 ok;

-- ---------- pesanan baru saat sudah Pro ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('transfer');
reset role;
select 'O15 akun yang sudah Pro tidak bisa membuat pesanan baru' t, (select count(*) from public.upgrade_requests where user_id = 'a0000000-0000-0000-0000-00000000000a' and plan = 'pro_sekali') = 1 ok;

-- ---------- refund penuh ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_refund_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 149000, 'refund atas permintaan pembeli', true);
reset role;
select 'O16 refund penuh: Pro dicabut, status direfund, histori tetap utuh' t,
  (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'direfund'
  and (select count(*) from public.pro_payments where order_id = (select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))) = 4 ok;

-- ---------- RLS buku besar ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select 'O17 seller hanya membaca catatan dananya sendiri' t, (select count(*) from public.pro_payments) = 2
  and (select count(*) from public.pro_payments where user_id <> 'b0000000-0000-0000-0000-00000000000b') = 0 ok;
update public.profiles set pro_sekali_bayar = true where id = 'a0000000-0000-0000-0000-00000000000a';
insert into public.pro_payments (user_id, kind, sumber, reference, amount) values ('b0000000-0000-0000-0000-00000000000b','pembayaran','transfer','X-1',149000);
reset role;
select 'O18 seller tidak bisa menulis buku besar atau mengubah Pro' t, (select count(*) from public.pro_payments where reference = 'X-1') = 0
  and (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') ok;

-- ---------- kedaluwarsa & batal ----------
set role authenticated; select pg_temp.sebagai('c0000000-0000-0000-0000-00000000000c');
select public.buat_pesanan_pro('transfer');
reset role;
update public.upgrade_requests set created_at = now() - interval '5 days' where user_id = 'c0000000-0000-0000-0000-00000000000c' and plan = 'pro_sekali';
set role authenticated; select pg_temp.sebagai('c0000000-0000-0000-0000-00000000000c');
select public.buat_pesanan_pro('transfer');
select public.batalkan_pesanan((select max(id) from public.upgrade_requests where plan = 'pro_sekali'));
reset role;
select 'O19 pesanan lewat batas waktu → dibatalkan otomatis; pesanan baru bisa dibuat lalu dibatalkan pembeli' t,
  (select count(*) from public.upgrade_requests where user_id = 'c0000000-0000-0000-0000-00000000000c' and plan = 'pro_sekali' and status = 'dibatalkan') = 2
  and (select count(*) from public.pro_order_events where catatan like 'Kedaluwarsa%') = 1 ok;

-- ---------- permintaan lama & Pro lama ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_tolak_pesanan((select id from public.upgrade_requests where plan = 'pro_bulanan'), 'paket lama tidak dijual lagi');
reset role;
select 'O20 permintaan lama bisa ditolak admin dengan alasan' t, (select status from public.upgrade_requests where plan = 'pro_bulanan') = 'ditolak' ok;
select 'O21 Pro lama (berjangka) tidak berubah' t, (select pro_until = '2099-01-31' and not pro_sekali_bayar from public.profiles where email = 'lama@x.id') ok;

-- ---------- non-admin & anon ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select public.admin_refund_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 1000, 'coba', true);
select public.admin_cabut_pro('b0000000-0000-0000-0000-00000000000b', 'coba cabut');
reset role; set role anon; select pg_temp.sebagai('');
select public.buat_pesanan_pro('transfer');
select count(*) from public.pengaturan_pembayaran;
reset role;
select 'O22 non-admin tidak bisa refund/cabut; anon tidak bisa memesan atau membaca pengaturan' t,
  (select pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b')
  and (select count(*) from public.pro_payments where kind = 'refund' and user_id = 'b0000000-0000-0000-0000-00000000000b') = 1 ok;

-- ---------- batas riwayat (opsional) ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}');
insert into public.reports (title, summary) values ('4','{}');
select 'O23 akun gratis: riwayat ke-4 ditolak' t, count(*) = 3 ok from public.reports;
select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}'),('4','{}');
select 'O24 akun Pro sekali bayar: riwayat tanpa batas' t, count(*) = 4 ok from public.reports;
reset role;
