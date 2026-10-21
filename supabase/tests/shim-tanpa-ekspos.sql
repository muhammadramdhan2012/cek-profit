-- Tiruan lingkungan Supabase untuk project yang dibuat dengan:
--   "Automatically expose new tables" = NONAKTIF  → tabel/sequence baru di public TIDAK mendapat grant otomatis
--                                                    untuk anon, authenticated, service_role (default PostgreSQL).
--   "Enable automatic RLS"            = AKTIF     → event trigger menyalakan RLS pada setiap tabel baru di public.
-- Dipakai menggantikan shim.sql untuk membuktikan schema.sql + migrasi tidak bergantung pada grant otomatis.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Sama dengan perintah dasbor Supabase saat opsi ekspos otomatis dimatikan.
alter default privileges in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke usage, select on sequences from anon, authenticated, service_role;
-- Supabase memberi EXECUTE fungsi baru langsung ke anon/authenticated/service_role (opsi ekspos tabel tidak mengubahnya).
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- Peran yang dipakai Supabase Auth saat menulis auth.users (untuk membuktikan trigger profil tetap jalan).
create role supabase_auth_admin nologin; grant usage on schema auth to supabase_auth_admin;
grant select, insert, update, delete on auth.users to supabase_auth_admin;
-- Tiruan RLS otomatis (nama & bentuk mengikuti fungsi yang terlihat di Security Advisor: public.rls_auto_enable,
-- SECURITY DEFINER, dapat dieksekusi publik).
create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$
declare o record;
begin
  for o in select * from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE' and schema_name = 'public' loop
    execute format('alter table %s enable row level security', o.object_identity);
  end loop;
end $$;
create event trigger tiruan_rls_otomatis on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable();
