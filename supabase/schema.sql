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

-- ---------- fungsi bersama: catat pembelian Pro 1 tahun ----------
-- Dipakai admin_catat_pembelian() (manual) dan duitku_terima() (pembayaran online). TIDAK bisa dipanggil langsung
-- oleh pengguna maupun tamu; pemeriksaan hak (admin / tanda tangan Duitku) dilakukan pemanggilnya.
-- Mulai = hari ini, atau sehari setelah Pro yang masih aktif berakhir (perpanjangan). Berlaku 1 tahun.
create or replace function public.catat_pembelian_pro(target uuid, harga integer, pakai_harga_awal boolean, catatan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hari date := public.hari_ini_jakarta();
  p public.profiles%rowtype;
  m date; z date; bid bigint;
begin
  select * into p from public.profiles where id = target for update;
  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  m := greatest(hari, coalesce(p.pro_until + 1, hari));
  z := (m + interval '1 year' - interval '1 day')::date;
  insert into public.pro_purchases (user_id, harga, harga_pengguna_awal, mulai, sampai, catatan)
    values (target, harga, pakai_harga_awal, m, z, catatan) returning id into bid;
  update public.profiles set pro_until = z where id = target;
  update public.upgrade_requests set status = 'selesai' where user_id = target and status in ('baru', 'diproses');
  return jsonb_build_object('id', bid, 'mulai', m, 'sampai', z);
end $$;
revoke all on function public.catat_pembelian_pro(uuid, integer, boolean, text) from public, anon, authenticated;

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
  -- Pencatatan & perpanjangan memakai fungsi bersama yang sama dengan pembayaran online (satu sumber aturan).
  return public.catat_pembelian_pro(target, harga, coalesce(pakai_harga_awal, false), coalesce(catatan, '')) - 'id';
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

-- =====================================================================
-- PEMBAYARAN ONLINE PRO LEWAT DUITKU (keputusan pemilik 5 Nov 2026; tahap Sandbox)
-- Alur: dashboard → Edge Function duitku-buat → pesanan_pro_buat() → invoice Duitku → pembeli membayar →
-- Duitku memanggil Edge Function duitku-callback → duitku_terima() memeriksa tanda tangan & nominal → Pro aktif.
-- TANPA service_role: kedua Edge Function memakai anon key / token login pengguna; perubahan status Pro hanya lewat
-- fungsi security definer di bawah. Kunci Duitku disimpan pemilik di Supabase Vault (dan Edge Function Secrets),
-- TIDAK PERNAH di file ini, di repository, atau di browser.
-- Nama rahasia di Vault: duitku_merchant_code_sandbox, duitku_api_key_sandbox (nanti: *_production).
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;   -- di Supabase sudah terpasang; untuk HMAC-SHA256

alter table public.site_settings add column if not exists pembayaran_mode text not null default 'mati';
alter table public.site_settings drop constraint if exists site_settings_pembayaran_mode;
alter table public.site_settings add constraint site_settings_pembayaran_mode check (pembayaran_mode in ('mati', 'sandbox', 'production'));
alter table public.site_settings add column if not exists harga_pro integer not null default 149000;           -- rupiah, per tahun
alter table public.site_settings add column if not exists harga_pro_pengguna_awal integer not null default 99000;  -- tahun pertama

-- Akun penguji pembayaran: hanya akun ini yang bisa membuat pesanan selama mode Sandbox. Diubah admin saja
-- (pengguna tidak punya hak update kolom ini; lihat grant pada profiles).
alter table public.profiles add column if not exists penguji_pembayaran boolean not null default false;

create table if not exists public.pro_orders (
  id                   bigint generated always as identity primary key,
  order_id             text not null unique check (char_length(order_id) <= 50),   -- merchantOrderId di Duitku
  user_id              uuid not null references auth.users (id) on delete cascade,
  email                text not null,
  harga                integer not null check (harga > 0),
  harga_pengguna_awal  boolean not null default false,
  mode                 text not null check (mode in ('sandbox', 'production')),
  status               text not null default 'menunggu' check (status in ('menunggu', 'lunas', 'gagal', 'kedaluwarsa')),
  referensi            text check (char_length(referensi) <= 100),                 -- reference dari Duitku
  payment_url          text check (char_length(payment_url) <= 500),
  kode_metode          text,                                                         -- paymentCode dari callback
  dibuat               timestamptz not null default now(),
  kedaluwarsa_pada     timestamptz not null,
  dibayar_pada         timestamptz,
  purchase_id          bigint references public.pro_purchases (id),
  callback_terakhir    jsonb                                                         -- ringkasan callback terakhir (tanpa rahasia)
);
create index if not exists pro_orders_user on public.pro_orders (user_id, dibuat desc);
alter table public.pro_orders enable row level security;
drop policy if exists "pesanan: baca sendiri atau admin" on public.pro_orders;
create policy "pesanan: baca sendiri atau admin" on public.pro_orders
  for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_orders from anon, authenticated;
grant select on public.pro_orders to authenticated;   -- menulis hanya lewat fungsi di bawah

-- Ambil rahasia Duitku dari Vault. Hanya dipakai fungsi lain di sini; tidak bisa dipanggil dari luar.
-- plpgsql (bukan sql) agar skema tetap bisa dijalankan walau Vault belum aktif; kunci baru dibaca saat callback.
create or replace function public.duitku_rahasia(nama text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = nama limit 1);
end $$;
revoke all on function public.duitku_rahasia(text) from public, anon, authenticated;

-- Tandai pesanan menunggu yang sudah lewat batas waktu.
create or replace function public.pesanan_kedaluwarsakan(uid uuid) returns void
language sql security definer set search_path = public as $$
  update public.pro_orders set status = 'kedaluwarsa'
    where user_id = uid and status = 'menunggu' and kedaluwarsa_pada < now();
$$;
revoke all on function public.pesanan_kedaluwarsakan(uuid) from public, anon, authenticated;

-- Berhak harga pengguna awal? Aturan yang sama dengan status_akun().harga_awal_tersedia: pengguna awal, belum pernah
-- memakainya, dan pembelian belum dibuka atau masih <= 30 hari sejak dibuka.
create or replace function public.berhak_harga_awal(uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s public.site_settings%rowtype;
begin
  select * into s from public.site_settings where id = 1;
  return coalesce((select p.pengguna_awal from public.profiles p where p.id = uid), false)
    and not exists (select 1 from public.pro_purchases b where b.user_id = uid and b.harga_pengguna_awal)
    and (s.pembelian_dibuka_pada is null or public.hari_ini_jakarta() <= s.pembelian_dibuka_pada + 30);
end $$;
revoke all on function public.berhak_harga_awal(uuid) from public, anon, authenticated;

-- Buat pesanan Pro untuk akun yang login. Harga SELALU dari server.
-- Bila masih ada pesanan menunggu yang belum kedaluwarsa dan sudah punya link bayar, pesanan itu yang dikembalikan
-- (pembeli melanjutkan pembayaran, tidak membuat invoice baru).
create or replace function public.pesanan_pro_buat() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hari date := public.hari_ini_jakarta();
  s public.site_settings%rowtype;
  p public.profiles%rowtype;
  o public.pro_orders%rowtype;
  awal boolean;
  oid text;
begin
  if uid is null then raise exception 'PERLU_LOGIN: Silakan masuk dulu untuk membeli Pro.' using errcode = 'P0001'; end if;
  select * into s from public.site_settings where id = 1;
  select * into p from public.profiles where id = uid for update;   -- kunci: cegah dua pesanan bersamaan
  if not found or coalesce(p.email, '') = '' then raise exception 'PERLU_LOGIN: Akun tidak ditemukan.' using errcode = 'P0001'; end if;
  if s.pembayaran_mode = 'mati'
     or (s.pembayaran_mode = 'sandbox' and not p.penguji_pembayaran)
     or (s.pembayaran_mode = 'production' and not p.penguji_pembayaran
         and (s.pembelian_dibuka_pada is null or hari < s.pembelian_dibuka_pada)) then
    raise exception 'PEMBAYARAN_TUTUP: Pembelian Pro belum dibuka.' using errcode = 'P0001';
  end if;
  perform public.pesanan_kedaluwarsakan(uid);
  select * into o from public.pro_orders
    where user_id = uid and status = 'menunggu' order by dibuat desc limit 1;
  if found then
    if o.payment_url is not null and o.mode = s.pembayaran_mode then
      return jsonb_build_object('order_id', o.order_id, 'harga', o.harga, 'email', o.email, 'mode', o.mode,
                                'payment_url', o.payment_url, 'lanjut', true);
    end if;
    update public.pro_orders set status = 'gagal' where id = o.id;   -- invoice tidak pernah terbentuk; buang
  end if;
  if (select count(*) from public.pro_orders x where x.user_id = uid and x.dibuat > now() - interval '24 hours') >= 10 then
    raise exception 'BATAS_PESANAN: Terlalu banyak percobaan pembelian hari ini. Silakan coba lagi besok atau hubungi kami.' using errcode = 'P0001';
  end if;
  awal := public.berhak_harga_awal(uid);
  oid := 'CU' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));
  insert into public.pro_orders (order_id, user_id, email, harga, harga_pengguna_awal, mode, kedaluwarsa_pada)
    values (oid, uid, p.email, case when awal then s.harga_pro_pengguna_awal else s.harga_pro end, awal,
            s.pembayaran_mode, now() + interval '60 minutes')
    returning * into o;
  return jsonb_build_object('order_id', o.order_id, 'harga', o.harga, 'email', o.email, 'mode', o.mode,
                            'produk', 'Cek Untung Pro 1 tahun', 'lanjut', false);
end $$;
revoke all on function public.pesanan_pro_buat() from public, anon;
grant execute on function public.pesanan_pro_buat() to authenticated;

-- Simpan referensi & link bayar dari Duitku ke pesanan milik sendiri (dipanggil Edge Function dengan token pengguna).
-- Tidak bisa mengubah status; status hanya berubah lewat duitku_terima().
create or replace function public.pesanan_pro_set_referensi(p_order_id text, p_referensi text, p_payment_url text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.pro_orders%rowtype;
begin
  select * into o from public.pro_orders where order_id = p_order_id and user_id = auth.uid() for update;
  if not found or o.status <> 'menunggu' or o.referensi is not null then
    raise exception 'PESANAN_TIDAK_VALID' using errcode = 'P0001';
  end if;
  if p_referensi is null or p_referensi !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'REFERENSI_TIDAK_VALID' using errcode = 'P0001'; end if;
  if p_payment_url is null or char_length(p_payment_url) > 500
     or not (p_payment_url like 'https://app-sandbox.duitku.com/%' or p_payment_url like 'https://app-prod.duitku.com/%') then
    raise exception 'URL_TIDAK_VALID' using errcode = 'P0001';
  end if;
  update public.pro_orders set referensi = p_referensi, payment_url = p_payment_url where id = o.id;
end $$;
revoke all on function public.pesanan_pro_set_referensi(text, text, text) from public, anon;
grant execute on function public.pesanan_pro_set_referensi(text, text, text) to authenticated;

-- Terima callback Duitku (server ke server). Boleh dipanggil siapa saja karena keasliannya dibuktikan tanda tangan:
--   signature = HMAC-SHA256(merchantCode + amount + merchantOrderId, apiKey), hex huruf kecil (dokumentasi Duitku POP).
-- Aman dipanggil berulang: pesanan lunas tidak diproses dua kali (Duitku mengirim ulang hingga 5 kali).
-- Mengembalikan {ok, hasil}; ok=false → Edge Function membalas non-200 agar Duitku mencoba lagi / memberi tahu pemilik.
create or replace function public.duitku_terima(data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_merchant text := coalesce(data ->> 'merchantCode', '');
  v_amount   text := coalesce(data ->> 'amount', '');
  v_order    text := coalesce(data ->> 'merchantOrderId', '');
  v_sig      text := lower(coalesce(data ->> 'signature', ''));
  v_result   text := coalesce(data ->> 'resultCode', '');
  v_ref      text := left(coalesce(data ->> 'reference', ''), 100);
  v_metode   text := left(coalesce(data ->> 'paymentCode', ''), 10);
  o public.pro_orders%rowtype;
  kode text; kunci text; hitung text; ringkas jsonb; r jsonb;
begin
  select * into o from public.pro_orders where order_id = v_order for update;
  if not found then return jsonb_build_object('ok', false, 'hasil', 'pesanan tidak dikenal'); end if;
  kode  := public.duitku_rahasia('duitku_merchant_code_' || o.mode);
  kunci := public.duitku_rahasia('duitku_api_key_' || o.mode);
  if kode is null or kunci is null then return jsonb_build_object('ok', false, 'hasil', 'kunci Duitku belum dipasang di Vault'); end if;
  hitung := encode(extensions.hmac(v_merchant || v_amount || v_order, kunci, 'sha256'), 'hex');
  ringkas := jsonb_build_object('waktu', now(), 'resultCode', v_result, 'reference', v_ref, 'amount', v_amount);
  if v_sig = '' or hitung <> v_sig or v_merchant <> kode then
    update public.pro_orders set callback_terakhir = ringkas || '{"hasil":"tanda tangan tidak sah"}' where id = o.id;
    return jsonb_build_object('ok', false, 'hasil', 'tanda tangan tidak sah');
  end if;
  if v_amount !~ '^[0-9]+(\.0+)?$' or v_amount::numeric <> o.harga then
    update public.pro_orders set callback_terakhir = ringkas || '{"hasil":"nominal tidak cocok"}' where id = o.id;
    return jsonb_build_object('ok', false, 'hasil', 'nominal tidak cocok');
  end if;
  if o.status = 'lunas' then
    return jsonb_build_object('ok', true, 'hasil', 'sudah lunas');   -- kiriman ulang: tidak diperpanjang lagi
  end if;
  if v_result = '00' then
    -- Pesanan yang sempat ditandai kedaluwarsa/gagal tetap diaktifkan bila Duitku menyatakan pembayaran berhasil.
    r := public.catat_pembelian_pro(o.user_id, o.harga, o.harga_pengguna_awal,
                                    'Duitku ' || o.mode || ' ' || o.order_id || ' ref ' || v_ref);
    update public.pro_orders set status = 'lunas', dibayar_pada = now(), purchase_id = (r ->> 'id')::bigint,
      referensi = coalesce(referensi, nullif(v_ref, '')), kode_metode = nullif(v_metode, ''),
      callback_terakhir = ringkas || '{"hasil":"lunas"}' where id = o.id;
    return jsonb_build_object('ok', true, 'hasil', 'lunas', 'sampai', r ->> 'sampai');
  end if;
  update public.pro_orders set status = case when status = 'menunggu' then 'gagal' else status end,
    callback_terakhir = ringkas || '{"hasil":"gagal"}' where id = o.id;
  return jsonb_build_object('ok', true, 'hasil', 'gagal');
end $$;
revoke all on function public.duitku_terima(jsonb) from public;
grant execute on function public.duitku_terima(jsonb) to anon, authenticated;

-- Admin: buka/tutup pembayaran online dan tandai akun penguji.
create or replace function public.admin_set_pembayaran(mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  update public.site_settings set pembayaran_mode = mode, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_set_pembayaran(text) from public, anon;
grant execute on function public.admin_set_pembayaran(text) to authenticated;

create or replace function public.admin_set_penguji(target uuid, nilai boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  update public.profiles set penguji_pembayaran = coalesce(nilai, false) where id = target;
end $$;
revoke all on function public.admin_set_penguji(uuid, boolean) from public, anon;
grant execute on function public.admin_set_penguji(uuid, boolean) to authenticated;

-- Status pembayaran untuk dashboard (akun yang login): apakah tombol beli ditampilkan, dan berapa harganya.
create or replace function public.status_pembayaran() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.site_settings%rowtype;
  p public.profiles%rowtype;
  hari date := public.hari_ini_jakarta();
  awal boolean; boleh boolean;
begin
  select * into s from public.site_settings where id = 1;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('mode', s.pembayaran_mode, 'boleh_beli', false); end if;
  boleh := (s.pembayaran_mode = 'sandbox' and p.penguji_pembayaran)
        or (s.pembayaran_mode = 'production' and (p.penguji_pembayaran
            or (s.pembelian_dibuka_pada is not null and hari >= s.pembelian_dibuka_pada)));
  awal := public.berhak_harga_awal(p.id);
  return jsonb_build_object('mode', s.pembayaran_mode, 'boleh_beli', boleh, 'penguji', p.penguji_pembayaran,
    'harga', case when awal then s.harga_pro_pengguna_awal else s.harga_pro end, 'harga_pengguna_awal', awal);
end $$;
revoke all on function public.status_pembayaran() from public, anon;
grant execute on function public.status_pembayaran() to authenticated;
