-- =====================================================================
-- Cek Profit — skema database Supabase
-- Jalankan SEKALI di Supabase: SQL Editor → New query → tempel semua → Run.
-- Aman dijalankan ulang (memakai IF NOT EXISTS / OR REPLACE).
--
-- Prinsip: file laporan & data pembeli TIDAK PERNAH disimpan di sini.
-- Yang disimpan: profil akun, status Pro, modal/pengaturan, dan ringkasan angka (riwayat).
-- =====================================================================

-- ---------- profil pengguna ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  store_name  text not null default '',
  whatsapp    text not null default '',
  pro_until   date,                                   -- Pro aktif jika >= hari ini
  is_admin    boolean not null default false,         -- set manual lewat Table Editor
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Fungsi bantu: apakah pengguna yang sedang login adalah admin?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

drop policy if exists "profil: baca sendiri atau admin" on public.profiles;
create policy "profil: baca sendiri atau admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profil: ubah sendiri" on public.profiles;
create policy "profil: ubah sendiri" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Pengguna hanya boleh mengubah kolom biasa. pro_until & is_admin TIDAK bisa diubah sendiri.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, store_name, whatsapp) on public.profiles to authenticated;

-- Buat profil otomatis saat ada pendaftar baru.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- modal & pengaturan (sinkron antarperangkat) ----------
create table if not exists public.user_data (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,     -- modal per produk, biaya, target
  profile     jsonb not null default '{}'::jsonb,     -- nama toko & logo untuk laporan PDF
  updated_at  timestamptz not null default now(),
  constraint user_data_size check (octet_length(settings::text) + octet_length(profile::text) < 2000000)
);
alter table public.user_data enable row level security;
drop policy if exists "data: milik sendiri" on public.user_data;
create policy "data: milik sendiri" on public.user_data
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_data from anon, authenticated;
grant select, insert, update, delete on public.user_data to authenticated;

-- ---------- riwayat ringkasan laporan ----------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  title        text not null default '',
  period_from  date,
  period_to    date,
  summary      jsonb not null,                        -- hanya angka ringkasan, bukan data pesanan
  constraint reports_size check (octet_length(summary::text) < 200000)
);
alter table public.reports enable row level security;
drop policy if exists "riwayat: milik sendiri" on public.reports;
create policy "riwayat: milik sendiri" on public.reports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.reports from anon, authenticated;
grant select, insert, delete on public.reports to authenticated;
create index if not exists reports_user_created on public.reports (user_id, created_at desc);

-- ---------- permintaan upgrade (pembayaran manual) ----------
create table if not exists public.upgrade_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan        text not null check (plan in ('pro_bulanan', 'pro_tahunan', 'jasa')),
  note        text not null default '',
  status      text not null default 'baru' check (status in ('baru', 'diproses', 'selesai', 'ditolak')),
  created_at  timestamptz not null default now()
);
alter table public.upgrade_requests enable row level security;
drop policy if exists "upgrade: buat sendiri" on public.upgrade_requests;
create policy "upgrade: buat sendiri" on public.upgrade_requests
  for insert with check (user_id = auth.uid() and status = 'baru');
drop policy if exists "upgrade: baca sendiri atau admin" on public.upgrade_requests;
create policy "upgrade: baca sendiri atau admin" on public.upgrade_requests
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "upgrade: admin ubah status" on public.upgrade_requests;
create policy "upgrade: admin ubah status" on public.upgrade_requests
  for update using (public.is_admin()) with check (public.is_admin());
revoke all on public.upgrade_requests from anon, authenticated;
grant select, insert on public.upgrade_requests to authenticated;
grant update (status) on public.upgrade_requests to authenticated;

-- ---------- fungsi admin ----------
-- Aktifkan / perpanjang / matikan Pro. until = null untuk mematikan.
create or replace function public.admin_set_pro(target uuid, until date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  update public.profiles set pro_until = until where id = target;
  if until is not null then
    update public.upgrade_requests set status = 'selesai' where user_id = target and status in ('baru', 'diproses');
  end if;
end $$;
revoke all on function public.admin_set_pro(uuid, date) from public, anon;
grant execute on function public.admin_set_pro(uuid, date) to authenticated;
