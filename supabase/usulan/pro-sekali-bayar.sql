-- ============================================================================================================
-- USULAN — BELUM DIJALANKAN DI PRODUKSI. Butuh persetujuan pemilik sebelum dijalankan di Supabase.
-- Pro sekali bayar (Rp149.000) dengan catatan pembayaran yang dapat diaudit.
--
-- Prinsip:
--  - Hak akses sekali bayar disimpan EKSPLISIT di kolom baru profiles.pro_sekali_bayar (boolean), bukan tanggal penanda.
--    Pro berjangka lama tetap di profiles.pro_until dan tidak diubah → akun Pro lama tetap berfungsi.
--    Pengguna tidak bisa mengubah kolom ini: grant update di profiles hanya untuk full_name, store_name, whatsapp.
--  - Pro hanya diaktifkan admin lewat fungsi security definer, SETELAH dana benar-benar diterima.
--  - Siklus pesanan memakai upgrade_requests.status yang sudah ada:
--      baru = Menunggu Pembayaran · diproses = Menunggu Verifikasi · selesai = Aktif · ditolak = Gagal/Dibatalkan.
--  - Setiap aktivasi/pencabutan tercatat di pro_payments; referensi transaksi unik → satu transfer tidak bisa
--    mengaktifkan Pro dua kali; akun yang sudah Pro sekali bayar tidak bisa diaktifkan ulang.
--  - Tidak menyimpan data pembayaran sensitif (nomor rekening/kartu). Hanya nominal, status, waktu, referensi.
-- Idempoten: aman dijalankan ulang. Diuji lokal: supabase/usulan/test-pro-sekali-bayar.sql.
-- ============================================================================================================

-- 0. Kolom hak akses sekali bayar (default false: tidak mengubah akun mana pun).
alter table public.profiles add column if not exists pro_sekali_bayar boolean not null default false;

-- 1. Paket baru di permintaan pembelian (paket lama tetap sah untuk data lama).
alter table public.upgrade_requests drop constraint if exists upgrade_requests_plan_check;
alter table public.upgrade_requests add constraint upgrade_requests_plan_check
  check (plan in ('pro_sekali', 'pro_bulanan', 'pro_tahunan', 'jasa'));

-- 2. Catatan pembayaran & perubahan hak akses (audit). Pengguna hanya membaca miliknya; tidak bisa menulis.
create table if not exists public.pro_payments (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('aktivasi', 'pencabutan', 'refund')),   -- status entri: terverifikasi/dicabut/direfund
  request_id   bigint references public.upgrade_requests (id) on delete set null,
  amount       integer not null default 0 check (amount >= 0 and amount <= 100000000),
  reference    text check (reference is null or (length(reference) between 3 and 100)),
  note         text not null default '' check (length(note) <= 500),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now()
);
-- Satu referensi transaksi hanya bisa dipakai untuk satu aktivasi.
create unique index if not exists pro_payments_ref_aktivasi on public.pro_payments (reference) where kind = 'aktivasi';
alter table public.pro_payments enable row level security;
drop policy if exists "pro_payments: baca sendiri atau admin" on public.pro_payments;
create policy "pro_payments: baca sendiri atau admin" on public.pro_payments
  for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_payments from anon, authenticated;
grant select on public.pro_payments to authenticated;   -- tanpa insert/update/delete: hanya lewat fungsi admin

-- 3. Admin: aktifkan Pro sekali bayar setelah pembayaran terverifikasi.
create or replace function public.admin_aktifkan_pro_sekali(target uuid, nominal integer, referensi text, catatan text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if nominal is null or nominal <= 0 then raise exception 'Nominal pembayaran wajib diisi'; end if;
  if referensi is null or length(trim(referensi)) < 3 then raise exception 'Referensi transaksi wajib diisi'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'Akun tidak ditemukan'; end if;
  if exists (select 1 from public.profiles where id = target and pro_sekali_bayar) then
    raise exception 'Akun ini sudah Pro sekali bayar';
  end if;
  insert into public.pro_payments (user_id, kind, amount, reference, note, created_by, request_id)
    values (target, 'aktivasi', nominal, trim(referensi), coalesce(catatan, ''), auth.uid(),
            (select max(id) from public.upgrade_requests where user_id = target and status in ('baru', 'diproses')));
    -- referensi ganda → gagal (indeks unik)
  update public.profiles set pro_sekali_bayar = true where id = target;
  update public.upgrade_requests set status = 'selesai' where user_id = target and status in ('baru', 'diproses');
end $$;

-- 4. Admin: cabut Pro (refund atau pelanggaran), tercatat.
create or replace function public.admin_cabut_pro(target uuid, jenis text, nominal integer default 0, catatan text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if jenis not in ('pencabutan', 'refund') then raise exception 'Jenis harus pencabutan atau refund'; end if;
  if length(trim(coalesce(catatan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  if not exists (select 1 from public.profiles where id = target and pro_sekali_bayar) then
    raise exception 'Akun ini tidak memiliki Pro sekali bayar';
  end if;
  insert into public.pro_payments (user_id, kind, amount, note, created_by)
    values (target, jenis, greatest(coalesce(nominal, 0), 0), trim(catatan), auth.uid());
  update public.profiles set pro_sekali_bayar = false where id = target;   -- pro_until (Pro lama) tidak disentuh
end $$;

revoke all on function public.admin_aktifkan_pro_sekali(uuid, integer, text, text) from public, anon;
revoke all on function public.admin_cabut_pro(uuid, text, integer, text) from public, anon;
grant execute on function public.admin_aktifkan_pro_sekali(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_cabut_pro(uuid, text, integer, text) to authenticated;

-- 5. (OPSIONAL, keputusan pemilik) Batas 3 riwayat untuk akun gratis ditegakkan di database (M5).
create or replace function public.cek_batas_riwayat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and (pro_sekali_bayar or pro_until >= current_date)) then return new; end if;
  if (select count(*) from public.reports where user_id = new.user_id) >= 3 then
    raise exception 'Akun gratis menyimpan 3 riwayat. Hapus yang lama atau gunakan Pro.';
  end if;
  return new;
end $$;
drop trigger if exists batas_riwayat on public.reports;
create trigger batas_riwayat before insert on public.reports for each row execute function public.cek_batas_riwayat();
