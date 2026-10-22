-- Uji lokal usulan/admin-monitor-pembayaran.sql + pembatasan "Hubungkan dana" untuk dana tamu. Data SINTETIS.
-- Urutan: shim-tanpa-ekspos.sql → schema.sql → pro-sekali-bayar.sql → hardening-fungsi.sql → qris-midtrans.sql →
--         checkout-tamu.sql → admin-monitor-pembayaran.sql (2x) → file ini. Setiap baris hasil harus berakhir |t.
\set ON_ERROR_STOP 0
\set R '''RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR'''
insert into public.gateway_rahasia (id, hash) values (1, encode(sha256(convert_to('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'UTF8')), 'hex'))
  on conflict (id) do update set hash = excluded.hash;
insert into auth.users (id, email, email_confirmed_at) values
 ('a8000000-0000-0000-0000-0000000000a8', 'admin@mon.id', now()), ('b8000000-0000-0000-0000-0000000000b8', 'biasa@mon.id', now()),
 ('c8000000-0000-0000-0000-0000000000c8', 'login@mon.id', now()), ('d8000000-0000-0000-0000-0000000000d8', 'pro@mon.id', now()),
 ('e8000000-0000-0000-0000-0000000000e8', 'lain@mon.id', now());
update public.profiles set is_admin = true where email = 'admin@mon.id';
update public.profiles set pro_sekali_bayar = true where email = 'pro@mon.id';
update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis', kontak_bantuan = 'bantuan@contoh.invalid';
create or replace function pg_temp.coba(q text) returns text language plpgsql as $$ begin execute q; return 'LOLOS'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.sesi(uid text, metode text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false),
         set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'amr', jsonb_build_array(jsonb_build_object('method', metode)))::text, false) $$;
create or replace function pg_temp.st(oid text, ts text, txn text, refunds jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('order_id', oid, 'transaction_status', ts, 'transaction_id', txn, 'gross_amount', '149000.00', 'currency', 'IDR', 'fraud_status', 'accept', 'refunds', refunds) $$;
create or replace function pg_temp.tamu(em text) returns public.pro_pesanan_tamu language sql as $$ select * from public.pro_pesanan_tamu where email = em order by id desc limit 1 $$;
create or replace function pg_temp.monitor(uid text) returns jsonb language plpgsql as $$
declare j jsonb; begin perform pg_temp.sesi(uid, 'password'); set local role authenticated; j := public.admin_monitor_pembayaran(); reset role; return j; end $$;
create or replace function pg_temp.baris(j jsonb, k text) returns jsonb language sql as $$ select x from jsonb_array_elements(j) x where x->>'kode' = k $$;
create or replace function pg_temp.jejak() returns text language sql as $$
  select (select count(*) from public.pro_payments)||'/'||(select count(*) from public.pro_order_events)||'/'||(select count(*) from public.pro_audit_log)||'/'||
         (select count(*) from public.profiles where pro_sekali_bayar)||'/'||(select md5(string_agg(kode||status, ',' order by id)) from public.pro_pesanan_tamu) $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ---------- akses ----------
select 'M1 data kosong: admin menerima [] (bukan null/galat)' t, pg_temp.monitor('a8000000-0000-0000-0000-0000000000a8') = '[]'::jsonb ok;
set role anon;
select 'M2 anon tidak bisa memanggil monitor' t, pg_temp.coba($$select public.admin_monitor_pembayaran()$$) like 'permission denied%' ok;
reset role;
select pg_temp.sesi('b8000000-0000-0000-0000-0000000000b8', 'password');
set role authenticated;
select 'M3 pengguna biasa ditolak ("Hanya admin"); tabel tamu tetap tertutup' t,
  pg_temp.coba($$select public.admin_monitor_pembayaran()$$) = 'Hanya admin'
  and (select count(*) from public.pro_pesanan_tamu) = 0 ok;
reset role;

-- ---------- data: login lunas+ganda+refund, tamu belum diklaim, tamu ganda, tamu perlu_cek ----------
-- login: pesanan + percobaan Snap, lalu dua pembayaran (percobaan kedua = ganda), refund sebagian pada yang ganda
select pg_temp.sesi('c8000000-0000-0000-0000-0000000000c8', 'password');
set role authenticated;
create temp table o1 as select (public.buat_pesanan_pro('qris')).id;
create temp table p1 as select public.gateway_mulai_percobaan((select id from o1)) j;
reset role;
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from p1), 'settlement', 'TX-L1'));
insert into public.pro_gateway_percobaan (order_id, user_id, gateway_order_id, amount, status, berlaku_sampai)
  select id, 'c8000000-0000-0000-0000-0000000000c8', order_code || '-2', 149000, 'kedaluwarsa', now() from public.upgrade_requests where id = (select id from o1);
select public.gateway_terapkan_status(:R, pg_temp.st((select order_code || '-2' from public.upgrade_requests where id = (select id from o1)), 'settlement', 'TX-L2'));
select public.gateway_terapkan_status(:R, pg_temp.st((select order_code || '-2' from public.upgrade_requests where id = (select id from o1)), 'partial_refund', 'TX-L2',
  '[{"refund_chargeback_id":"9","refund_amount":"40000.00"}]'));
-- tamu: belum diklaim (lunas), ganda (akun sudah Pro), perlu_cek (nominal salah)
select public.tamu_buat_pesanan(:R, 'tamu@mon.id', 'Tamu Satu', '+6281234567890') is not null as _;
select public.tamu_buat_pesanan(:R, 'pro@mon.id', 'Sudah Pro', '') is not null as _;
select public.tamu_buat_pesanan(:R, 'salah@mon.id', 'Nominal Salah', '') is not null as _;
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('tamu@mon.id')).kode, 'settlement', 'TX-T1'));
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('pro@mon.id')).kode, 'settlement', 'TX-T2'));
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('salah@mon.id')).kode, 'settlement', 'TX-T3') || '{"gross_amount":"1000.00"}');
select pg_temp.sesi('d8000000-0000-0000-0000-0000000000d8', 'otp');
set role authenticated;
select public.klaim_pembelian_tamu();
reset role;

create temp table m as select pg_temp.monitor('a8000000-0000-0000-0000-0000000000a8') j;
select 'M4 login: lunas tanpa tanda; percobaan ganda bertanda ganda+refund dengan total refund & referensi Midtrans' t,
  (select pg_temp.baris(j, (select j->'percobaan'->>'gateway_order_id' from p1)) from m) ->> 'tanda' = '[]'
  and (select x->>'jenis' = 'login' and x->>'akun' = 'login@mon.id' and x->>'referensi' = 'TX-L1' and (x->>'amount')::int = 149000
       from (select pg_temp.baris(j, (select j->'percobaan'->>'gateway_order_id' from p1)) x from m) y)
  and (select x->'tanda' @> '["ganda","refund"]' and (x->>'refund')::int = 40000 and x->>'referensi' = 'TX-L2'
       from (select pg_temp.baris(j, (select order_code || '-2' from public.upgrade_requests where id = (select id from o1))) x from m) y) ok;
select 'M5 tamu: belum_diklaim (dengan email, tanpa WhatsApp), ganda, perlu_cek; baris bertanda tampil lebih dulu' t,
  (select x->'tanda' = '["belum_diklaim"]' and x->>'klaim' = 'belum' and x->>'akun' = 'tamu@mon.id' and not (x ? 'whatsapp')
     from (select pg_temp.baris(j, (pg_temp.tamu('tamu@mon.id')).kode) x from m) y)
  and (select x->'tanda' @> '["ganda","perlu_cek"]' from (select pg_temp.baris(j, (pg_temp.tamu('pro@mon.id')).kode) x from m) y)
  and (select x->'tanda' = '["perlu_cek"]' and x->>'klaim' is null from (select pg_temp.baris(j, (pg_temp.tamu('salah@mon.id')).kode) x from m) y)
  and (select jsonb_array_length(j->0->'tanda') > 0 and jsonb_array_length(j->(jsonb_array_length(j) - 1)->'tanda') = 0 from m) ok;
create temp table m2 as select pg_temp.jejak() j;
create temp table m3 as select pg_temp.monitor('a8000000-0000-0000-0000-0000000000a8') j;
select 'M6 monitor hanya membaca: buku besar, event, audit, Pro, pesanan tamu tidak berubah' t,
  (select j from m2) = pg_temp.jejak() and (select j from m3) = (select j from m) ok;

-- ---------- pembatasan admin: dana tamu tidak bisa dihubungkan ke pesanan lain ----------
select pg_temp.sesi('e8000000-0000-0000-0000-0000000000e8', 'password');
set role authenticated;
create temp table o2 as select (public.buat_pesanan_pro('qris')).id;
reset role;
select pg_temp.sesi('a8000000-0000-0000-0000-0000000000a8', 'password');
set role authenticated;
create temp table hb as select pg_temp.coba(format('select public.admin_hubungkan_dana(%s, %s, %L)',
  (select payment_id from public.pro_pesanan_tamu where email = 'tamu@mon.id'), (select id from o2), 'uji penghubungan')) h;
reset role;
select 'M7 admin tidak bisa "Hubungkan dana" untuk dana tamu: ditolak, akun lain tidak menjadi Pro, dana tetap menunggu klaim' t,
  (select h from hb) like 'Dana checkout tamu hanya aktif lewat tautan email%'
  and not (select pro_sekali_bayar from public.profiles where email = 'lain@mon.id')
  and (select dihubungkan_pada is null from public.pro_payments where reference = 'TX-T1') and (pg_temp.tamu('tamu@mon.id')).status = 'lunas' ok;
-- pertahanan berlapis di klaim: dana yang (dengan cara apa pun) sudah terhubung tidak mengaktifkan akun kedua
update public.pro_payments set dihubungkan_pada = now(), order_id = (select id from o2), user_id = 'e8000000-0000-0000-0000-0000000000e8' where reference = 'TX-T1';
insert into auth.users (id, email, email_confirmed_at) values ('f8000000-0000-0000-0000-0000000000f8', 'tamu@mon.id', now());
select pg_temp.sesi('f8000000-0000-0000-0000-0000000000f8', 'otp');
set role authenticated;
create temp table kl as select public.klaim_pembelian_tamu() k;
reset role;
select 'M8 klaim atas dana yang sudah terhubung: tidak aktif, ditandai perlu_cek + audit' t,
  (select (k->>'aktif')::int = 0 from kl) and not (select pro_sekali_bayar from public.profiles where email = 'tamu@mon.id')
  and (pg_temp.tamu('tamu@mon.id')).status = 'perlu_cek'
  and exists (select 1 from public.pro_audit_log where aksi = 'gateway_transaksi_bentrok' and alasan = 'klaim tamu') ok;
