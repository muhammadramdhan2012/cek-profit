-- Uji migrasi price list pada database LAMA (schema.sql sebelum 13 Nov 2026, tanpa kolom price_list), lalu pembatalan.
-- Jalankan: shim.sql + schema.sql versi LAMA (git show 6577231:supabase/schema.sql) pada database KOSONG, lalu file ini.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values ('e1111111-1111-1111-1111-111111111111','citra@x.id');
insert into public.user_data (user_id, settings, profile) values
 ('e1111111-1111-1111-1111-111111111111', '{"packing":1500,"catalog":[{"kode":"A","nama":"Buku A","cost":70000}]}', '{"store":"Toko Citra"}');
select 'MG1 sebelum migrasi: kolom price_list belum ada' t, count(*) = 0 ok
  from information_schema.columns where table_name = 'user_data' and column_name = 'price_list';
\i supabase/migrasi/2026-11-13-price-list.sql
select 'MG2 setelah migrasi: data lama utuh, price_list = {}' t,
  settings->'catalog'->0->>'cost' = '70000' and profile->>'store' = 'Toko Citra' and price_list = '{}'::jsonb ok
  from public.user_data where user_id = 'e1111111-1111-1111-1111-111111111111';
update public.user_data set price_list = '{"v":1,"baris":[["X","Buku X","",90000]]}';
\i supabase/migrasi/2026-11-13-price-list-batal.sql
select 'MG3 setelah dibatalkan: kolom hilang, modal/pengaturan/profil utuh' t,
  settings->'catalog'->0->>'cost' = '70000' and settings->>'packing' = '1500' and profile->>'store' = 'Toko Citra'
  and not exists (select 1 from information_schema.columns where table_name = 'user_data' and column_name = 'price_list') ok
  from public.user_data where user_id = 'e1111111-1111-1111-1111-111111111111';
\i supabase/migrasi/2026-11-13-price-list.sql
select 'MG4 bisa dimigrasi lagi setelah dibatalkan' t, price_list = '{}'::jsonb ok
  from public.user_data where user_id = 'e1111111-1111-1111-1111-111111111111';
