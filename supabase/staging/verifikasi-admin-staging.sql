-- VERIFIKASI ADMIN STAGING — hanya membaca; semua di dalam transaksi yang dibatalkan (rollback).
-- Ganti GANTI_DENGAN_EMAIL_ADMIN_UJI dengan email yang sama seperti di jadikan-admin-staging.sql. Semua baris ok = true.
begin;
select 'V1 project staging' as cek, public.info_lingkungan() ->> 'ref' = 'epyhhazihfolbdtjxxfd' as ok
union all select 'V2 tepat satu admin', (select count(*) from public.profiles where is_admin) = 1
union all select 'V3 admin = email yang dimaksud', exists (select 1 from public.profiles where is_admin and lower(email) = lower('GANTI_DENGAN_EMAIL_ADMIN_UJI'))
union all select 'V4 tercatat di audit', exists (select 1 from public.pro_audit_log where aksi = 'set_admin_staging')
union all select 'V5 pengguna tidak bisa mengubah is_admin/pro sendiri', not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'pro_until', 'update') and not has_column_privilege('authenticated', 'public.profiles', 'pro_sekali_bayar', 'update');
-- V6: is_admin() dilihat dari sesi login admin itu sendiri (disimulasikan, lalu dibatalkan)
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where is_admin limit 1), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', (select id::text from public.profiles where is_admin limit 1), true);
set local role authenticated;
select 'V6 is_admin() = true untuk sesi admin' as cek, public.is_admin() as ok;
rollback;
