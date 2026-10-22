-- Uji lokal hardening-fungsi.sql. WAJIB memakai shim-tanpa-ekspos.sql (punya peran supabase_auth_admin & rls_auto_enable). Urutan: shim-tanpa-ekspos.sql → schema.sql → usulan/pro-sekali-bayar.sql →
-- usulan/hardening-fungsi.sql (2x) → file ini. Data SINTETIS. Setiap baris hasil harus berakhir |t.
-- Alur bisnis lengkap (checkout, verifikasi, refund, Pro lama) diuji ulang dengan test-pro-sekali-bayar.sql dan
-- test-rls-setelah-migrasi.sql pada database yang sudah di-hardening.
\set ON_ERROR_STOP 0

-- ---------- pendaftaran akun: trigger profil tetap berjalan walau EXECUTE dicabut ----------
set role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
 ('a1000000-0000-0000-0000-0000000000a1', 'seller@x.id', '{"full_name":"Seller Uji"}'),
 ('d1000000-0000-0000-0000-0000000000d1', 'admin@x.id', '{}');
reset role;
select 'H1 daftar akun (peran Supabase Auth) → profil otomatis dibuat' t,
  (select count(*) from public.profiles where id in ('a1000000-0000-0000-0000-0000000000a1','d1000000-0000-0000-0000-0000000000d1')) = 2
  and (select full_name from public.profiles where id = 'a1000000-0000-0000-0000-0000000000a1') = 'Seller Uji' ok;
update public.profiles set is_admin = true where id = 'd1000000-0000-0000-0000-0000000000d1';

-- ---------- hak eksekusi ----------
select 'H2 fungsi trigger & internal tidak bisa dieksekusi anon/login' t,
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('handle_new_user','cek_batas_riwayat','_audit','_catat_event','_aktifkan_dari_pesanan','_audit_pengaturan')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) ok;
select 'H3 is_admin: login bisa (dibutuhkan RLS), anon tidak' t,
  has_function_privilege('authenticated', 'public.is_admin()', 'execute') and not has_function_privilege('anon', 'public.is_admin()', 'execute') ok;
-- Bila migrasi QRIS (qris-midtrans.sql) sudah terpasang, dua fungsi bergerbang RAHASIA GATEWAY memang boleh dipanggil anon
-- (Edge Function memakai anon key), dan dua fungsi pembeli QRIS ikut daftar pengguna login.
create or replace function pg_temp.qris() returns boolean language sql as $$ select to_regprocedure('public.gateway_terapkan_status(text, jsonb)') is not null $$;
create or replace function pg_temp.tamu() returns boolean language sql as $$ select to_regprocedure('public.klaim_pembelian_tamu()') is not null $$;
create or replace function pg_temp.f_tamu() returns text[] language sql as $$ select case when pg_temp.tamu() then
  array['tamu_buat_pesanan', 'tamu_catat_email', 'tamu_perlu_email', 'tamu_simpan_snap', 'tamu_status'] else '{}'::text[] end $$;
select 'H4 anon: SECURITY DEFINER yang bisa dieksekusi hanya rls_auto_enable (Supabase) [+ 2 fungsi bergerbang rahasia QRIS]' t,
  (select coalesce(array_agg(proname::text order by proname), '{}') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute'))
  = (select array_agg(n order by n) from unnest(case when pg_temp.qris() then array['gateway_simpan_qr', 'gateway_terapkan_status', 'rls_auto_enable'] else array['rls_auto_enable'] end
       || pg_temp.f_tamu()) n) ok;
select 'H5 login: SECURITY DEFINER yang bisa dieksekusi = RPC admin + 3 pembeli + is_admin + rls_auto_enable [+ 4 fungsi QRIS]' t,
  (select array_agg(proname::text order by proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute'))
  = (select array_agg(n order by n) from (
       select proname::text n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%'
       union select unnest(array['buat_pesanan_pro', 'konfirmasi_sudah_bayar', 'batalkan_pesanan', 'is_admin', 'rls_auto_enable'])
       union select unnest(case when pg_temp.qris() then array['gateway_mulai_percobaan', 'gateway_percobaan_saya', 'gateway_simpan_qr', 'gateway_terapkan_status'] else '{}'::text[] end)
       union select unnest(pg_temp.f_tamu() || case when pg_temp.tamu() then array['klaim_pembelian_tamu'] else '{}'::text[] end)) x)
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%') >= 10 ok;
select 'H6 search_path: _norm_ref kosong; semua SECURITY DEFINER Cek Untung public, pg_temp' t,
  (select array_to_string(proconfig, ',') from pg_proc where proname = '_norm_ref') = 'search_path=""'
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname <> 'rls_auto_enable'
    and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=public, pg_temp') ok;
select 'H7 _norm_ref tetap menormalkan referensi' t, public._norm_ref(' bca-uji 001/x ') = 'BCAUJI001X' and public._norm_ref(null) = '' ok;

-- ---------- semua RPC admin menolak pengguna biasa (dipanggil dengan argumen kosong) ----------
create temp table hasil_admin (fungsi text, pesan text);
grant insert on hasil_admin to authenticated;
set role authenticated; select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', false);
do $$
declare f record; args text;
begin
  for f in select p.oid, p.proname, p.pronargs from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%' loop
    select string_agg('null::' || format_type(t, null), ', ') into args from unnest(string_to_array((select proargtypes::text from pg_proc where oid = f.oid), ' ')::oid[]) t;
    begin
      execute format('select public.%I(%s)', f.proname, coalesce(args, ''));
      insert into pg_temp.hasil_admin values (f.proname, 'LOLOS');
    exception when others then insert into pg_temp.hasil_admin values (f.proname, sqlerrm);
    end;
  end loop;
end $$;
reset role;
select 'H8 semua RPC admin (10, atau 11 dengan QRIS) (+1 monitor) menolak seller dengan "Hanya admin" (bukan error lain, tidak ada yang lolos)' t,
  (select count(*) from pg_temp.hasil_admin) = case when pg_temp.qris() then 11 else 10 end
    + case when to_regprocedure('public.admin_monitor_pembayaran(integer)') is not null then 1 else 0 end   -- monitor admin (usulan)
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%') = (select count(*) from pg_temp.hasil_admin) and not exists (select 1 from pg_temp.hasil_admin where pesan <> 'Hanya admin') ok;
select fungsi, pesan from pg_temp.hasil_admin where pesan <> 'Hanya admin';

-- ---------- RLS dengan is_admin tetap bekerja ----------
set role authenticated; select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a1', false);
select 'H9 seller hanya melihat profil sendiri' t, (select count(*) from public.profiles) = 1 ok;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-0000000000d1', false);
select public.admin_set_pro('a1000000-0000-0000-0000-0000000000a1', '2099-12-31');
select 'H10 admin melihat semua profil & admin_set_pro berjalan' t,
  (select count(*) from public.profiles) >= 2 and (select pro_until from public.profiles where id = 'a1000000-0000-0000-0000-0000000000a1') = '2099-12-31' ok;
reset role;

-- ---------- batas riwayat (trigger dengan EXECUTE dicabut) ----------
set role supabase_auth_admin;
insert into auth.users (id, email) values ('f1000000-0000-0000-0000-0000000000f1', 'gratis@x.id');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-0000000000f1', false);
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}');
insert into public.reports (title, summary) values ('4','{}');
select 'H11 trigger batas riwayat tetap berjalan: akun gratis berhenti di 3' t, count(*) = 3 ok from public.reports;
reset role;

-- ---------- fungsi trigger & event trigger tidak bisa dipanggil langsung ----------
create or replace function pg_temp.coba(q text) returns text language plpgsql as $$
begin execute q; return 'LOLOS'; exception when others then return sqlerrm; end $$;
set role authenticated;
select 'H12 pengguna login tidak bisa memanggil fungsi trigger (permission denied)' t,
  pg_temp.coba('select public.handle_new_user()') like 'permission denied%' and pg_temp.coba('select public.cek_batas_riwayat()') like 'permission denied%' ok;
reset role;
select 'H13 rls_auto_enable tidak bisa dipanggil langsung, bahkan oleh pemilik' t, pg_temp.coba('select public.rls_auto_enable()') <> 'LOLOS' ok;

-- ---------- tidak ada perubahan RLS/tabel ----------
select 'H14 RLS tetap aktif di 8 tabel; tidak ada hak tabel baru untuk anon' t,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('profiles','user_data','reports','upgrade_requests','pengaturan_pembayaran','pro_order_events','pro_payments','pro_audit_log')) = 8
  and not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')) ok;
