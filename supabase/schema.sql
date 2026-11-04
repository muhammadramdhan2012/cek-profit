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

-- =====================================================================
-- TAHAP 2 (keputusan pemilik 1 Nov 2026): status Pro, masa beta, pengguna awal, dan batas riwayat
-- ditegakkan di server. Perhitungan laporan TETAP di browser (file tidak pernah dikirim ke sini), jadi
-- fitur yang dihitung di browser (PDF, Excel, analisis produk) tetap dikunci di browser.
-- Semua tanggal "hari ini" memakai jam server, zona Asia/Jakarta.
-- =====================================================================

create or replace function public.hari_ini_jakarta() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

-- ---------- pengaturan situs (satu baris, hanya admin yang mengubah) ----------
create table if not exists public.site_settings (
  id                     smallint primary key default 1 check (id = 1),
  beta_gratis_sampai     date,         -- inklusif; null = tidak ada masa beta
  pembelian_dibuka_pada  date,         -- null = pembelian Pro belum dibuka
  updated_at             timestamptz not null default now()
);
insert into public.site_settings (id, beta_gratis_sampai) values (1, '2026-12-13') on conflict (id) do nothing;
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;   -- dibaca lewat status_situs()/status_akun() saja

-- ---------- pengguna awal (akun dibuat selama masa beta) ----------
-- Disimpan per akun saat mendaftar, jadi tidak hilang bila masa beta diakhiri atau diubah belakangan.
alter table public.profiles add column if not exists pengguna_awal boolean not null default false;
-- Akun yang sudah ada dan dibuat paling lambat 13 Des 2026 (akhir beta yang ditetapkan pemilik) = pengguna awal.
update public.profiles set pengguna_awal = true
  where not pengguna_awal and (created_at at time zone 'Asia/Jakarta')::date <= date '2026-12-13';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare beta date := (select s.beta_gratis_sampai from public.site_settings s where s.id = 1);
begin
  insert into public.profiles (id, email, full_name, pengguna_awal)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
          coalesce(public.hari_ini_jakarta() <= beta, false))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- catatan pembelian Pro (diisi admin) ----------
create table if not exists public.pro_purchases (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references auth.users (id) on delete cascade,
  harga                integer not null check (harga >= 0),      -- rupiah yang dibayar
  harga_pengguna_awal  boolean not null default false,           -- memakai harga khusus pengguna awal
  mulai                date not null,
  sampai               date not null check (sampai >= mulai),
  catatan              text not null default '',
  dicatat_oleh         uuid default auth.uid(),
  created_at           timestamptz not null default now()
);
alter table public.pro_purchases enable row level security;
drop policy if exists "pembelian: baca sendiri atau admin" on public.pro_purchases;
create policy "pembelian: baca sendiri atau admin" on public.pro_purchases
  for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_purchases from anon, authenticated;
grant select on public.pro_purchases to authenticated;           -- menulis hanya lewat admin_catat_pembelian()
create index if not exists pro_purchases_user on public.pro_purchases (user_id, created_at desc);

-- ---------- status resmi dari server ----------
-- Pengunjung tanpa akun: tanggal server dan masa beta.
create or replace function public.status_situs() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hari_ini', public.hari_ini_jakarta(),
    'beta_gratis_sampai', s.beta_gratis_sampai,
    'beta_aktif', coalesce(public.hari_ini_jakarta() <= s.beta_gratis_sampai, false),
    'pembelian_dibuka_pada', s.pembelian_dibuka_pada,
    'klaim_harga_awal_sampai', s.pembelian_dibuka_pada + 30)
  from public.site_settings s where s.id = 1;
$$;
revoke all on function public.status_situs() from public;
grant execute on function public.status_situs() to anon, authenticated;

-- Fungsi bantu untuk trigger & status_akun: apakah akun ini sedang Pro atau dalam masa beta?
create or replace function public.akses_pro(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.pro_until >= public.hari_ini_jakarta() from public.profiles p where p.id = uid), false)
      or coalesce((select public.hari_ini_jakarta() <= s.beta_gratis_sampai from public.site_settings s where s.id = 1), false);
$$;
revoke all on function public.akses_pro(uuid) from public, anon, authenticated;

-- Pengguna yang login: status situs + status akunnya sendiri.
create or replace function public.status_akun() returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from public.site_settings where id = 1),
       p as (select * from public.profiles where id = auth.uid()),
       sudah as (select exists (select 1 from public.pro_purchases b where b.user_id = auth.uid() and b.harga_pengguna_awal) v)
  select public.status_situs() || jsonb_build_object(
    'login', auth.uid() is not null and exists (select 1 from p),
    'pro_until', (select pro_until from p),
    'pro_aktif', coalesce((select pro_until >= public.hari_ini_jakarta() from p), false),
    'pengguna_awal', coalesce((select pengguna_awal from p), false),
    -- Berhak harga khusus: pengguna awal, belum pernah memakainya, dan (pembelian belum dibuka atau masih ≤ 30 hari).
    'harga_awal_tersedia', coalesce((select pengguna_awal from p), false) and not (select v from sudah)
      and coalesce((select public.hari_ini_jakarta() <= pembelian_dibuka_pada + 30 from s), true),
    'jumlah_riwayat', (select count(*) from public.reports r where r.user_id = auth.uid()),
    'batas_riwayat', case when public.akses_pro(auth.uid()) then null else 3 end);
$$;
revoke all on function public.status_akun() from public, anon;
grant execute on function public.status_akun() to authenticated;

-- ---------- batas 3 riwayat untuk akun gratis (masalah M5) ----------
-- Hanya menolak riwayat BARU. Riwayat yang sudah tersimpan tidak pernah dihapus.
create or replace function public.cek_batas_riwayat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('riwayat:' || new.user_id::text, 0));   -- cegah dua simpan bersamaan lolos
  if not public.akses_pro(new.user_id)
     and (select count(*) from public.reports r where r.user_id = new.user_id) >= 3 then
    raise exception 'BATAS_RIWAYAT: Akun gratis menyimpan 3 riwayat. Hapus riwayat lama atau upgrade ke Pro.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists reports_batas_gratis on public.reports;
create trigger reports_batas_gratis before insert on public.reports
  for each row execute function public.cek_batas_riwayat();

-- ---------- fungsi admin tahap 2 ----------
-- Catat pembelian Pro 1 tahun. Mulai = hari ini, atau sehari setelah Pro yang masih aktif berakhir (perpanjangan).
create or replace function public.admin_catat_pembelian(target uuid, harga integer, pakai_harga_awal boolean, catatan text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hari date := public.hari_ini_jakarta();
  s public.site_settings%rowtype;
  p public.profiles%rowtype;
  m date; z date;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if harga is null or harga < 0 then raise exception 'Harga tidak valid'; end if;
  select * into p from public.profiles where id = target for update;
  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  select * into s from public.site_settings where id = 1;
  if pakai_harga_awal then
    if not p.pengguna_awal then raise exception 'Akun ini bukan pengguna awal'; end if;
    if exists (select 1 from public.pro_purchases b where b.user_id = target and b.harga_pengguna_awal) then
      raise exception 'Harga pengguna awal sudah pernah dipakai (hanya tahun pertama)'; end if;
    if s.pembelian_dibuka_pada is null or hari > s.pembelian_dibuka_pada + 30 then
      raise exception 'Batas klaim harga pengguna awal (30 hari sejak pembelian dibuka) sudah lewat atau pembelian belum dibuka'; end if;
  end if;
  m := greatest(hari, coalesce(p.pro_until + 1, hari));
  z := (m + interval '1 year' - interval '1 day')::date;
  insert into public.pro_purchases (user_id, harga, harga_pengguna_awal, mulai, sampai, catatan)
    values (target, harga, coalesce(pakai_harga_awal, false), m, z, coalesce(catatan, ''));
  update public.profiles set pro_until = z where id = target;
  update public.upgrade_requests set status = 'selesai' where user_id = target and status in ('baru', 'diproses');
  return jsonb_build_object('mulai', m, 'sampai', z);
end $$;
revoke all on function public.admin_catat_pembelian(uuid, integer, boolean, text) from public, anon;
grant execute on function public.admin_catat_pembelian(uuid, integer, boolean, text) to authenticated;

-- Ubah tanggal akhir beta / tanggal pembelian dibuka.
create or replace function public.admin_set_situs(beta_sampai date, dibuka_pada date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  update public.site_settings set beta_gratis_sampai = beta_sampai, pembelian_dibuka_pada = dibuka_pada, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_set_situs(date, date) from public, anon;
grant execute on function public.admin_set_situs(date, date) to authenticated;

-- =====================================================================
-- MASUKAN PENGGUNA (keputusan pemilik 4 Nov 2026)
-- Hanya akun yang sudah masuk bisa mengirim (tamu diarahkan ke WhatsApp). Pengguna hanya bisa MENGIRIM;
-- yang bisa membaca & mengubah status hanya admin. Isi laporan/angka tidak pernah ikut dikirim oleh website.
-- =====================================================================
create table if not exists public.feedback (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  jenis            text not null check (jenis in ('saran', 'masalah', 'lainnya')),
  pesan            text not null check (char_length(btrim(pesan)) between 5 and 2000),
  halaman          text not null default '' check (char_length(halaman) <= 40),
  boleh_dihubungi  boolean not null default false,
  status           text not null default 'baru' check (status in ('baru', 'dibaca', 'selesai')),
  created_at       timestamptz not null default now()
);
create index if not exists feedback_user_created on public.feedback (user_id, created_at desc);
create index if not exists feedback_created on public.feedback (created_at desc);
alter table public.feedback enable row level security;
drop policy if exists "masukan: kirim sendiri" on public.feedback;
create policy "masukan: kirim sendiri" on public.feedback
  for insert with check (user_id = auth.uid() and status = 'baru');
drop policy if exists "masukan: admin baca" on public.feedback;
create policy "masukan: admin baca" on public.feedback
  for select using (public.is_admin());
drop policy if exists "masukan: admin ubah status" on public.feedback;
create policy "masukan: admin ubah status" on public.feedback
  for update using (public.is_admin()) with check (public.is_admin());
revoke all on public.feedback from anon, authenticated;
grant insert (jenis, pesan, halaman, boleh_dihubungi) on public.feedback to authenticated;
grant select on public.feedback to authenticated;           -- baris tetap dibatasi RLS (admin saja)
grant update (status) on public.feedback to authenticated;  -- baris tetap dibatasi RLS (admin saja)

-- Batas 5 masukan per akun per 24 jam (mencegah spam). Ditegakkan di database, bukan hanya di browser.
create or replace function public.feedback_batas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.feedback f where f.user_id = new.user_id and f.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'BATAS_MASUKAN: Anda sudah mengirim 5 masukan dalam 24 jam terakhir. Terima kasih! Silakan kirim lagi besok, atau hubungi kami lewat WhatsApp.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists feedback_batas on public.feedback;
create trigger feedback_batas before insert on public.feedback for each row execute function public.feedback_batas();
