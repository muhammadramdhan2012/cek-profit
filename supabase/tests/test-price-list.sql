-- Uji kolom user_data.price_list (Langkah 2a). Jalankan setelah shim.sql + schema.sql pada database KOSONG.
-- Setiap baris hasil "nama|t"; "f" berarti gagal. Error yang DIHARAPKAN (penolakan) juga tercetak.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values
 ('c1111111-1111-1111-1111-111111111111','ani@x.id'),
 ('d2222222-2222-2222-2222-222222222222','budi@x.id');

-- Ani menyimpan pengaturan lama (tanpa price list), lalu price list.
set role authenticated; select set_config('request.jwt.claim.sub','c1111111-1111-1111-1111-111111111111',false);
insert into public.user_data (settings) values ('{"packing":1000,"catalog":[{"kode":"A","cost":50000}]}');
reset role;
select 'PL1 baris lama: price_list bawaan {} (data lama utuh)' t,
  price_list = '{}'::jsonb and settings->>'packing' = '1000' ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';

set role authenticated; select set_config('request.jwt.claim.sub','c1111111-1111-1111-1111-111111111111',false);
update public.user_data set price_list = '{"v":1,"baris":[["978602","Buku A","",100000]]}' where user_id = auth.uid();
reset role;
select 'PL2 pemilik bisa menyimpan price list; settings tidak berubah' t,
  price_list->'baris'->0->>1 = 'Buku A' and settings->>'packing' = '1000' ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';

-- Upsert hanya settings (cara website menyimpan modal) tidak menghapus price list.
set role authenticated; select set_config('request.jwt.claim.sub','c1111111-1111-1111-1111-111111111111',false);
insert into public.user_data (user_id, settings) values ('c1111111-1111-1111-1111-111111111111', '{"packing":2000}')
  on conflict (user_id) do update set settings = excluded.settings;
reset role;
select 'PL3 simpan settings saja tidak menghapus price list' t,
  price_list->'baris'->0->>1 = 'Buku A' and settings->>'packing' = '2000' ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';

-- Budi tidak bisa membaca atau mengubah price list Ani.
set role authenticated; select set_config('request.jwt.claim.sub','d2222222-2222-2222-2222-222222222222',false);
select 'PL4 akun lain tidak bisa membaca price list' t, count(*) = 0 ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';
update public.user_data set price_list = '{"v":1,"baris":[]}' where user_id = 'c1111111-1111-1111-1111-111111111111';
insert into public.user_data (user_id, price_list) values ('c1111111-1111-1111-1111-111111111111', '{"v":9}');   -- ditolak RLS
reset role;
select 'PL5 akun lain tidak bisa mengubah/menimpa price list' t,
  price_list->'baris'->0->>1 = 'Buku A' ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';

-- Tamu (anon) tidak punya akses.
select 'PL6 tamu (anon) tidak punya hak baca/tulis tabel user_data' t,
  not has_table_privilege('anon', 'public.user_data', 'select') and not has_table_privilege('anon', 'public.user_data', 'insert') ok;

-- Batas ukuran dan bentuk.
set role authenticated; select set_config('request.jwt.claim.sub','d2222222-2222-2222-2222-222222222222',false);
insert into public.user_data (price_list) values (jsonb_build_object('baris', repeat('x', 3000000)));   -- ditolak: terlalu besar
insert into public.user_data (price_list) values ('[1,2,3]');                                           -- ditolak: bukan objek
reset role;
select 'PL7 price list > 3 MB atau bukan objek ditolak' t, count(*) = 0 ok from public.user_data where user_id = 'd2222222-2222-2222-2222-222222222222';
set role authenticated; select set_config('request.jwt.claim.sub','d2222222-2222-2222-2222-222222222222',false);
insert into public.user_data (price_list) values (jsonb_build_object('baris', repeat('x', 2900000)));   -- diterima: ± 2,9 MB
reset role;
select 'PL8 price list ± 2,9 MB diterima; tidak memakan batas settings 2 MB' t, count(*) = 1 ok from public.user_data where user_id = 'd2222222-2222-2222-2222-222222222222';

-- Hapus akun → baris ikut terhapus (on delete cascade yang sudah ada).
delete from auth.users where id = 'd2222222-2222-2222-2222-222222222222';
select 'PL9 akun dihapus → price list ikut terhapus' t, count(*) = 0 ok from public.user_data where user_id = 'd2222222-2222-2222-2222-222222222222';

-- Migrasi berdiri sendiri aman dijalankan ulang (idempoten) dan tidak mengubah data.
\i supabase/migrasi/2026-11-13-price-list.sql
select 'PL10 migrasi dijalankan ulang: data tetap' t,
  price_list->'baris'->0->>1 = 'Buku A' ok from public.user_data where user_id = 'c1111111-1111-1111-1111-111111111111';
