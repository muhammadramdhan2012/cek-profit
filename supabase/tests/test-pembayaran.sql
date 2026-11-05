-- Uji pembayaran online Pro (Duitku Sandbox). Jalankan setelah shim.sql + schema.sql pada database KOSONG.
-- Setiap baris hasil "nama|t"; "f" berarti gagal. Error yang DIHARAPKAN (penolakan) juga tercetak.
-- Kunci di sini kunci TIRUAN untuk uji lokal, bukan kunci Duitku sungguhan.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values
 ('a1111111-1111-1111-1111-111111111111','ani@x.id'),
 ('b2222222-2222-2222-2222-222222222222','budi@x.id'),
 ('c3333333-3333-3333-3333-333333333333','citra@x.id'),
 ('d4444444-4444-4444-4444-444444444444','admin@x.id');
update public.profiles set is_admin = true where email = 'admin@x.id';
update public.profiles set pengguna_awal = false;
update public.profiles set pengguna_awal = true where email = 'budi@x.id';
update public.profiles set penguji_pembayaran = true where email in ('ani@x.id', 'budi@x.id');
insert into vault.decrypted_secrets values ('duitku_merchant_code_sandbox', 'DS12345'), ('duitku_api_key_sandbox', 'kunci-tes-sandbox');

-- Tanda tangan uji: HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey), sama dengan dokumentasi Duitku.
create function pg_temp.sig(m text, a text, o text) returns text language sql as
  $$ select encode(extensions.hmac(m || a || o, 'kunci-tes-sandbox', 'sha256'), 'hex') $$;
create function pg_temp.cb(o text, a text, hasil text, s text default null, m text default 'DS12345') returns jsonb language sql as
  $$ select jsonb_build_object('merchantCode', m, 'amount', a, 'merchantOrderId', o, 'resultCode', hasil,
       'reference', 'DSREF' || left(o, 8), 'paymentCode', 'SP', 'signature', coalesce(s, pg_temp.sig(m, a, o))) $$;

select 'P0 rumus tanda tangan cocok dengan perhitungan independen (Node crypto)' t,
  pg_temp.sig('DS12345', '149000', 'CU-TES-0001') = 'c2aa08e8044ef75be9ca0caa129d1878b92de3ffe8d19172e21ef6ae8bb63132' ok;

-- ---------- membuat pesanan ----------
set role anon; select set_config('request.jwt.claim.sub','',false);
select public.pesanan_pro_buat();                                   -- ditolak: tamu tidak punya hak
reset role;
select 'P1 tamu tidak bisa membuat pesanan' t, count(*) = 0 ok from public.pro_orders;

set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select public.pesanan_pro_buat();                                   -- ditolak: mode masih 'mati'
reset role;
select 'P2 mode mati: pesanan ditolak walau akun penguji' t, count(*) = 0 ok from public.pro_orders;

update public.site_settings set pembayaran_mode = 'sandbox';
set role authenticated; select set_config('request.jwt.claim.sub','c3333333-3333-3333-3333-333333333333',false);
select public.pesanan_pro_buat();                                   -- ditolak: bukan penguji
select 'P3 sandbox: akun bukan penguji tidak melihat tombol beli' t,
  (public.status_pembayaran() ->> 'boleh_beli')::boolean = false ok;
select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select 'P4 sandbox: penguji boleh beli, harga normal Rp149.000' t,
  (public.status_pembayaran() ->> 'boleh_beli')::boolean and (public.status_pembayaran() ->> 'harga')::int = 149000 ok;
create temp table o1 as select public.pesanan_pro_buat() j;
reset role;
select j ->> 'order_id' as oid1 from o1 \gset
select 'P5 pesanan dibuat dengan harga server, mode sandbox, status menunggu' t,
  (select count(*) from public.pro_orders) = 1 and o.harga = 149000 and o.mode = 'sandbox' and o.status = 'menunggu'
  and o.email = 'ani@x.id' and not o.harga_pengguna_awal and o.kedaluwarsa_pada > now() + interval '55 minutes'
  and :'oid1' = o.order_id ok
  from public.pro_orders o where o.user_id = 'a1111111-1111-1111-1111-111111111111';

-- ---------- referensi & link bayar ----------
set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
select public.pesanan_pro_set_referensi(:'oid1', 'DSHACK', 'https://app-sandbox.duitku.com/redirect_checkout?reference=DSHACK');  -- ditolak: bukan miliknya
select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select public.pesanan_pro_set_referensi(:'oid1', 'DSREF1', 'https://jahat.example/bayar');     -- ditolak: bukan domain Duitku
select public.pesanan_pro_set_referensi(:'oid1', 'DS REF<1>', 'https://app-sandbox.duitku.com/x'); -- ditolak: referensi aneh
select public.pesanan_pro_set_referensi(:'oid1', 'DSREF1', 'https://app-sandbox.duitku.com/redirect_checkout?reference=DSREF1');
select public.pesanan_pro_set_referensi(:'oid1', 'DSREF2', 'https://app-sandbox.duitku.com/redirect_checkout?reference=DSREF2'); -- ditolak: sudah diisi
create temp table o1b as select public.pesanan_pro_buat() j;
reset role;
select 'P6 referensi hanya bisa diisi sekali, oleh pemilik pesanan, dengan link Duitku' t,
  o.referensi = 'DSREF1' and o.payment_url like 'https://app-sandbox.duitku.com/%' ok
  from public.pro_orders o where o.order_id = :'oid1';
select 'P7 pesanan menunggu dilanjutkan (tidak membuat invoice baru)' t,
  (select count(*) from public.pro_orders) = 1 and (select (j ->> 'lanjut')::boolean and j ->> 'order_id' = :'oid1' from o1b) ok;

set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
update public.pro_orders set status = 'lunas', harga = 1;                 -- ditolak: tidak ada hak update
insert into public.pro_orders (order_id, user_id, email, harga, mode, kedaluwarsa_pada)
  values ('CU-PALSU', 'a1111111-1111-1111-1111-111111111111', 'ani@x.id', 1, 'sandbox', now() + interval '1 hour');  -- ditolak
update public.profiles set penguji_pembayaran = true, pro_until = '2030-01-01';   -- ditolak: kolom tidak boleh diubah sendiri
select public.admin_set_pembayaran('production');                         -- ditolak: bukan admin
select public.admin_set_penguji('c3333333-3333-3333-3333-333333333333', true);  -- ditolak: bukan admin
select public.catat_pembelian_pro('a1111111-1111-1111-1111-111111111111', 1, false, 'curang');  -- ditolak: fungsi internal
select public.duitku_rahasia('duitku_api_key_sandbox');                   -- ditolak: fungsi internal
reset role;
select 'P8 pengguna tidak bisa mengubah pesanan, status Pro, penguji, atau membaca kunci' t,
  (select count(*) from public.pro_orders) = 1
  and (select status = 'menunggu' and harga = 149000 from public.pro_orders limit 1)
  and (select pro_until is null from public.profiles where email = 'ani@x.id')
  and (select not penguji_pembayaran from public.profiles where email = 'citra@x.id')
  and (select pembayaran_mode = 'sandbox' from public.site_settings)
  and not exists (select 1 from public.pro_purchases) ok;

-- ---------- callback Duitku ----------
set role anon; select set_config('request.jwt.claim.sub','',false);
create temp table h1 as select public.duitku_terima(pg_temp.cb(:'oid1', '149000', '00', repeat('0', 64))) j;
create temp table h2 as select public.duitku_terima(pg_temp.cb(:'oid1', '1000', '00')) j;            -- tanda tangan sah, nominal salah
create temp table h3 as select public.duitku_terima(pg_temp.cb(:'oid1', '149000', '00', null, 'DSXXXXX')) j; -- merchant lain
create temp table h4 as select public.duitku_terima(pg_temp.cb('CU-TIDAK-ADA', '149000', '00')) j;
create temp table h5 as select public.duitku_terima(pg_temp.cb(:'oid1', '149001', '00', pg_temp.sig('DS12345', '149000', :'oid1'))) j;
reset role;
select 'P9 callback palsu ditolak: tanda tangan, nominal, merchant, pesanan tak dikenal' t,
  not (select (j ->> 'ok')::boolean from h1) and (select j ->> 'hasil' from h1) = 'tanda tangan tidak sah'
  and not (select (j ->> 'ok')::boolean from h2) and (select j ->> 'hasil' from h2) = 'nominal tidak cocok'
  and not (select (j ->> 'ok')::boolean from h3)
  and not (select (j ->> 'ok')::boolean from h4) and (select j ->> 'hasil' from h4) = 'pesanan tidak dikenal'
  and not (select (j ->> 'ok')::boolean from h5) ok;
select 'P10 setelah callback palsu: Pro tetap tidak aktif, pesanan tetap menunggu' t,
  (select pro_until is null from public.profiles where email = 'ani@x.id')
  and (select status = 'menunggu' from public.pro_orders where order_id = :'oid1')
  and not exists (select 1 from public.pro_purchases) ok;

set role anon; select set_config('request.jwt.claim.sub','',false);
create temp table h6 as select public.duitku_terima(pg_temp.cb(:'oid1', '149000', '00')) j;
select public.duitku_terima(pg_temp.cb(:'oid1', '149000', '00'));   -- kiriman ulang
select public.duitku_terima(pg_temp.cb(:'oid1', '149000', '00'));
select public.duitku_terima(pg_temp.cb(:'oid1', '149000.00', '00'));  -- format desimal
reset role;
select 'P11 callback sah: Pro aktif 1 tahun, pembelian tercatat, pesanan lunas' t,
  (select (j ->> 'ok')::boolean and j ->> 'hasil' = 'lunas' from h6)
  and (select pro_until = (public.hari_ini_jakarta() + interval '1 year' - interval '1 day')::date from public.profiles where email = 'ani@x.id')
  and (select o.status = 'lunas' and o.dibayar_pada is not null and o.kode_metode = 'SP' and o.purchase_id is not null
       from public.pro_orders o where o.order_id = :'oid1') ok;
select 'P12 kiriman ulang tidak memperpanjang dua kali' t,
  (select count(*) from public.pro_purchases where user_id = 'a1111111-1111-1111-1111-111111111111') = 1
  and (select harga = 149000 and not harga_pengguna_awal from public.pro_purchases limit 1) ok;

-- ---------- pengguna awal & gagal ----------
set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
select 'P13 pengguna awal melihat harga Rp99.000' t, (public.status_pembayaran() ->> 'harga')::int = 99000 ok;
create temp table o2 as select public.pesanan_pro_buat() j;
reset role;
select j ->> 'order_id' as oid2 from o2 \gset
set role anon; select set_config('request.jwt.claim.sub','',false);
create temp table h7 as select public.duitku_terima(pg_temp.cb(:'oid2', '99000', '01')) j;  -- pembayaran gagal
reset role;
select 'P14 pembayaran gagal: pesanan gagal, Pro tidak aktif' t,
  (select j ->> 'hasil' = 'gagal' from h7)
  and (select status = 'gagal' and harga = 99000 and harga_pengguna_awal from public.pro_orders where order_id = :'oid2')
  and (select pro_until is null from public.profiles where email = 'budi@x.id') ok;

set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
create temp table o3 as select public.pesanan_pro_buat() j;
reset role;
select j ->> 'order_id' as oid3 from o3 \gset
-- Pesanan lewat batas waktu, tetapi Duitku tetap menyatakan berhasil → tetap diaktifkan (uang sudah masuk).
update public.pro_orders set kedaluwarsa_pada = now() - interval '1 minute' where order_id = :'oid3';
set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
select public.status_pembayaran();
create temp table o3b as select public.pesanan_pro_buat() j;   -- menandai o3 kedaluwarsa, membuat pesanan baru
reset role;
select 'P15 pesanan lewat batas waktu ditandai kedaluwarsa' t,
  (select status = 'kedaluwarsa' from public.pro_orders where order_id = :'oid3')
  and (select j ->> 'order_id' from o3b) <> :'oid3' ok;
set role anon; select set_config('request.jwt.claim.sub','',false);
create temp table h8 as select public.duitku_terima(pg_temp.cb(:'oid3', '99000', '00')) j;
reset role;
select 'P16 pembayaran berhasil pada pesanan kedaluwarsa tetap mengaktifkan Pro (harga pengguna awal)' t,
  (select j ->> 'hasil' = 'lunas' from h8)
  and (select count(*) = 1 and bool_and(harga = 99000 and harga_pengguna_awal) from public.pro_purchases where user_id = 'b2222222-2222-2222-2222-222222222222')
  and (select pro_until is not null from public.profiles where email = 'budi@x.id') ok;
set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
select 'P17 harga pengguna awal hanya sekali: berikutnya Rp149.000' t, (public.status_pembayaran() ->> 'harga')::int = 149000 ok;
reset role;

-- ---------- perpanjangan ----------
update public.pro_orders set status = 'gagal' where user_id = 'b2222222-2222-2222-2222-222222222222' and status = 'menunggu';
update public.profiles set pro_until = public.hari_ini_jakarta() + 100 where email = 'budi@x.id';
set role authenticated; select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
create temp table o4 as select public.pesanan_pro_buat() j;
reset role;
select j ->> 'order_id' as oid4, j ->> 'harga' as harga4 from o4 \gset
set role anon; select set_config('request.jwt.claim.sub','',false);
select public.duitku_terima(pg_temp.cb(:'oid4', :'harga4', '00'));
reset role;
select 'P18 Pro yang masih aktif diperpanjang dari tanggal akhirnya' t,
  (select pro_until = (public.hari_ini_jakarta() + 101 + interval '1 year' - interval '1 day')::date from public.profiles where email = 'budi@x.id')
  and (select harga = 149000 from public.pro_orders where order_id = :'oid4') ok;

-- ---------- RLS & admin ----------
set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select 'P19 pengguna hanya membaca pesanannya sendiri' t,
  count(*) = 1 and bool_and(user_id = 'a1111111-1111-1111-1111-111111111111') ok from public.pro_orders;
select set_config('request.jwt.claim.sub','d4444444-4444-4444-4444-444444444444',false);
select 'P20 admin membaca semua pesanan' t, count(*) = (select count(*) from public.pro_orders) and count(*) >= 5 ok from public.pro_orders;
select public.admin_set_penguji('c3333333-3333-3333-3333-333333333333', true);
select public.admin_set_pembayaran('mati');
select public.admin_set_pembayaran('gratis');   -- ditolak: mode tidak dikenal
reset role;
select 'P21 admin menandai penguji dan menutup pembayaran' t,
  (select penguji_pembayaran from public.profiles where email = 'citra@x.id')
  and (select pembayaran_mode = 'mati' from public.site_settings) ok;

-- ---------- kunci belum dipasang ----------
update public.site_settings set pembayaran_mode = 'sandbox';
set role authenticated; select set_config('request.jwt.claim.sub','c3333333-3333-3333-3333-333333333333',false);
create temp table o5 as select public.pesanan_pro_buat() j;
reset role;
select j ->> 'order_id' as oid5 from o5 \gset
delete from vault.decrypted_secrets where name = 'duitku_api_key_sandbox';
set role anon; select set_config('request.jwt.claim.sub','',false);
create temp table h9 as select public.duitku_terima(pg_temp.cb(:'oid5', '149000', '00')) j;
reset role;
select 'P22 kunci belum dipasang di Vault: callback ditolak, Pro tidak aktif' t,
  not (select (j ->> 'ok')::boolean from h9) and (select pro_until is null from public.profiles where email = 'citra@x.id') ok;

-- ---------- batas percobaan ----------
insert into public.pro_orders (order_id, user_id, email, harga, mode, status, kedaluwarsa_pada)
  select 'CU-BATAS-' || g, 'c3333333-3333-3333-3333-333333333333', 'citra@x.id', 149000, 'sandbox', 'gagal', now()
  from generate_series(1, 10) g;
update public.pro_orders set status = 'gagal' where order_id = :'oid5';
set role authenticated; select set_config('request.jwt.claim.sub','c3333333-3333-3333-3333-333333333333',false);
select public.pesanan_pro_buat();   -- ditolak: BATAS_PESANAN
reset role;
select 'P23 maksimal 10 percobaan pesanan per 24 jam' t,
  (select count(*) from public.pro_orders where user_id = 'c3333333-3333-3333-3333-333333333333') = 11 ok;

delete from auth.users where email = 'ani@x.id';
select 'P24 akun dihapus → pesanannya ikut terhapus' t,
  not exists (select 1 from public.pro_orders where user_id = 'a1111111-1111-1111-1111-111111111111') ok;
