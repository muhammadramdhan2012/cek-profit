-- ============================================================================================================
-- USULAN v2 — BELUM DIJALANKAN DI PRODUKSI. Butuh persetujuan pemilik sebelum dijalankan di Supabase.
-- Pembayaran manual Pro sekali bayar (Transfer Bank + QRIS), berbasis akun.
--
-- Satu sistem, memakai ulang tabel yang ada:
--  - profiles.pro_sekali_bayar  : hak akses sekali bayar (eksplisit). Pro berjangka lama (pro_until) tidak disentuh.
--  - upgrade_requests           : PESANAN (dibuat server: kode pesanan, metode, nominal dari harga resmi).
--  - pro_order_events           : histori status pesanan (siapa, kapan, dari → ke).
--  - pro_payments               : buku besar dana: pembayaran terverifikasi, refund, pencabutan.
--  - pengaturan_pembayaran      : harga resmi + instruksi rekening/QRIS (hanya admin yang mengubah).
--
-- Aturan keamanan:
--  - Seller TIDAK bisa menulis langsung ke tabel mana pun di atas; hanya lewat fungsi yang memeriksa auth.uid().
--  - Nominal tagihan diambil dari pengaturan_pembayaran.harga_pro di server, bukan dari browser.
--  - "Saya sudah membayar" hanya mengubah status ke Menunggu Verifikasi; tidak pernah mengaktifkan Pro.
--  - Pro aktif hanya lewat admin_verifikasi_pesanan (is_admin() dari identitas login), dengan referensi dari mutasi
--    resmi; referensi unik per sumber (transfer/qris) → satu pembayaran tidak bisa mengaktifkan dua akun.
--  - Setiap fungsi berjalan dalam satu transaksi; baris pesanan & profil dikunci (FOR UPDATE) → aman dari klik ganda.
--  - Histori tidak dihapus: refund/pencabutan menambah baris baru.
--
-- Status pesanan (upgrade_requests.status):
--   baru = Menunggu Pembayaran · diproses = Menunggu Verifikasi · selesai = Aktif · ditolak = Gagal
--   dibatalkan = Dibatalkan/Kedaluwarsa · direfund = Dana dikembalikan
-- Idempoten: aman dijalankan ulang. Diuji lokal: supabase/usulan/test-pro-sekali-bayar.sql.
-- ============================================================================================================

-- 0. Hak akses sekali bayar (default false: tidak mengubah akun mana pun). Pengguna tidak punya hak ubah kolom ini.
alter table public.profiles add column if not exists pro_sekali_bayar boolean not null default false;

-- 1. Pengaturan pembayaran (satu baris). Dibaca akun yang login; diubah hanya admin.
create table if not exists public.pengaturan_pembayaran (
  id             smallint primary key default 1 check (id = 1),
  aktif          boolean not null default false,
  harga_pro      integer not null default 149000 check (harga_pro between 1000 and 100000000),
  batas_hari     integer not null default 3 check (batas_hari between 1 and 30),
  bank_nama      text not null default '' check (length(bank_nama) <= 60),
  bank_nomor     text not null default '' check (bank_nomor ~ '^[0-9]{0,20}$'),
  bank_pemilik   text not null default '' check (length(bank_pemilik) <= 100),
  qris_merchant  text not null default '' check (length(qris_merchant) <= 100),
  qris_nmid      text not null default '' check (length(qris_nmid) <= 40),
  qris_gambar    text not null default '' check (qris_gambar = '' or qris_gambar ~ '^img/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|svg)$'),
  kontak_bantuan text not null default '' check (length(kontak_bantuan) <= 200),
  diubah_pada    timestamptz not null default now(),
  -- Pembelian hanya bisa dibuka bila ada kontak bantuan dan minimal satu metode lengkap.
  constraint pengaturan_siap check (not aktif or (kontak_bantuan <> '' and (
    (bank_nama <> '' and bank_nomor <> '' and bank_pemilik <> '') or (qris_merchant <> '' and qris_gambar <> ''))))
);
insert into public.pengaturan_pembayaran (id) values (1) on conflict (id) do nothing;
alter table public.pengaturan_pembayaran enable row level security;
drop policy if exists "pengaturan: baca (login)" on public.pengaturan_pembayaran;
create policy "pengaturan: baca (login)" on public.pengaturan_pembayaran for select using (auth.uid() is not null);
drop policy if exists "pengaturan: admin ubah" on public.pengaturan_pembayaran;
create policy "pengaturan: admin ubah" on public.pengaturan_pembayaran for update using (public.is_admin()) with check (public.is_admin());
revoke all on public.pengaturan_pembayaran from anon, authenticated;
grant select on public.pengaturan_pembayaran to authenticated;
grant update (aktif, harga_pro, batas_hari, bank_nama, bank_nomor, bank_pemilik, qris_merchant, qris_nmid, qris_gambar, kontak_bantuan, diubah_pada)
  on public.pengaturan_pembayaran to authenticated;   -- dibatasi policy: hanya admin

-- 2. Pesanan = upgrade_requests (data lama tetap sah).
alter table public.upgrade_requests add column if not exists order_code text;
alter table public.upgrade_requests add column if not exists metode text;
alter table public.upgrade_requests add column if not exists amount integer;
alter table public.upgrade_requests add column if not exists claimed_at timestamptz;
alter table public.upgrade_requests add column if not exists updated_at timestamptz not null default now();
alter table public.upgrade_requests drop constraint if exists upgrade_requests_metode_check;
alter table public.upgrade_requests add constraint upgrade_requests_metode_check check (metode is null or metode in ('transfer', 'qris'));
alter table public.upgrade_requests drop constraint if exists upgrade_requests_amount_check;
alter table public.upgrade_requests add constraint upgrade_requests_amount_check check (amount is null or amount > 0);
alter table public.upgrade_requests drop constraint if exists upgrade_requests_plan_check;
alter table public.upgrade_requests add constraint upgrade_requests_plan_check check (plan in ('pro_sekali', 'pro_bulanan', 'pro_tahunan', 'jasa'));
alter table public.upgrade_requests drop constraint if exists upgrade_requests_status_check;
alter table public.upgrade_requests add constraint upgrade_requests_status_check
  check (status in ('baru', 'diproses', 'selesai', 'ditolak', 'dibatalkan', 'direfund'));
create unique index if not exists upgrade_requests_order_code on public.upgrade_requests (order_code) where order_code is not null;
-- Maksimal satu pesanan Pro terbuka per akun (mencegah pesanan ganda).
create unique index if not exists upgrade_requests_satu_terbuka on public.upgrade_requests (user_id)
  where plan = 'pro_sekali' and status in ('baru', 'diproses');
-- Seller tidak lagi menulis langsung: pesanan dibuat/diubah lewat fungsi di bawah.
drop policy if exists "upgrade: buat sendiri" on public.upgrade_requests;
drop policy if exists "upgrade: admin ubah status" on public.upgrade_requests;
revoke insert, update, delete on public.upgrade_requests from anon, authenticated;

-- 3. Histori status pesanan.
create table if not exists public.pro_order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.upgrade_requests (id) on delete cascade,
  status_lama text,
  status_baru text not null,
  oleh        uuid references auth.users (id) on delete set null,   -- null = sistem (mis. kedaluwarsa)
  catatan     text not null default '' check (length(catatan) <= 500),
  waktu       timestamptz not null default now()
);
alter table public.pro_order_events enable row level security;
drop policy if exists "events: baca pesanan sendiri atau admin" on public.pro_order_events;
create policy "events: baca pesanan sendiri atau admin" on public.pro_order_events for select using (
  public.is_admin() or exists (select 1 from public.upgrade_requests r where r.id = order_id and r.user_id = auth.uid()));
revoke all on public.pro_order_events from anon, authenticated;
grant select on public.pro_order_events to authenticated;

-- 4. Buku besar dana. Disimpan walau akun dihapus (user_id menjadi null) — keputusan retensi pemilik.
create table if not exists public.pro_payments (
  id             bigint generated always as identity primary key,
  order_id       bigint references public.upgrade_requests (id) on delete set null,
  user_id        uuid references auth.users (id) on delete set null,
  kind           text not null check (kind in ('pembayaran', 'refund', 'pencabutan')),
  sumber         text check (sumber is null or sumber in ('transfer', 'qris')),
  reference      text check (reference is null or length(reference) <= 100),
  reference_norm text generated always as (upper(regexp_replace(coalesce(reference, ''), '[^A-Za-z0-9]', '', 'g'))) stored,
  amount         integer not null default 0 check (amount >= 0 and amount <= 100000000),
  note           text not null default '' check (length(note) <= 500),
  refund_of      bigint references public.pro_payments (id),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint pembayaran_lengkap check (kind <> 'pembayaran' or (sumber is not null and length(reference_norm) >= 3 and amount > 0))
);
-- Satu referensi mutasi per sumber hanya bisa dicatat sekali sebagai pembayaran.
create unique index if not exists pro_payments_ref on public.pro_payments (sumber, reference_norm) where kind = 'pembayaran';
alter table public.pro_payments enable row level security;
drop policy if exists "pro_payments: baca sendiri atau admin" on public.pro_payments;
create policy "pro_payments: baca sendiri atau admin" on public.pro_payments for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_payments from anon, authenticated;
grant select on public.pro_payments to authenticated;

-- Fungsi bantu internal (tidak diberikan ke pengguna).
create or replace function public._catat_event(p_order bigint, p_lama text, p_baru text, p_catatan text)
returns void language sql security definer set search_path = public as $$
  insert into public.pro_order_events (order_id, status_lama, status_baru, oleh, catatan)
  values (p_order, p_lama, p_baru, auth.uid(), left(coalesce(p_catatan, ''), 500));
$$;
revoke all on function public._catat_event(bigint, text, text, text) from public, anon, authenticated;

-- 5. SELLER: buat pesanan (atau kembalikan pesanan terbuka). Nominal dari harga resmi di server.
create or replace function public.buat_pesanan_pro(p_metode text)
returns public.upgrade_requests language plpgsql security definer set search_path = public as $$
declare
  s public.pengaturan_pembayaran; r public.upgrade_requests; kode text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  select * into s from public.pengaturan_pembayaran where id = 1;
  if s is null or not s.aktif then raise exception 'Pembelian Pro belum dibuka'; end if;
  if p_metode = 'transfer' and not (s.bank_nama <> '' and s.bank_nomor <> '' and s.bank_pemilik <> '') then raise exception 'Metode pembayaran tidak tersedia'; end if;
  if p_metode = 'qris' and not (s.qris_merchant <> '' and s.qris_gambar <> '') then raise exception 'Metode pembayaran tidak tersedia'; end if;
  if p_metode is null or p_metode not in ('transfer', 'qris') then raise exception 'Metode pembayaran tidak tersedia'; end if;
  perform 1 from public.profiles where id = uid for update;
  if exists (select 1 from public.profiles where id = uid and pro_sekali_bayar) then raise exception 'Akun Anda sudah Pro'; end if;
  -- Pesanan yang belum dibayar melewati batas waktu → dibatalkan (kedaluwarsa), tercatat.
  for r in select * from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' and status = 'baru'
           and created_at < now() - make_interval(days => s.batas_hari) for update loop
    update public.upgrade_requests set status = 'dibatalkan', updated_at = now() where id = r.id;
    perform public._catat_event(r.id, 'baru', 'dibatalkan', 'Kedaluwarsa: belum dibayar dalam batas waktu');
  end loop;
  select * into r from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' and status in ('baru', 'diproses') for update;
  if found then
    if r.status = 'baru' and r.metode is distinct from p_metode then
      update public.upgrade_requests set metode = p_metode, updated_at = now() where id = r.id returning * into r;
      perform public._catat_event(r.id, 'baru', 'baru', 'Metode diganti: ' || p_metode);
    end if;
    return r;
  end if;
  loop
    kode := 'CU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.upgrade_requests where order_code = kode);
  end loop;
  insert into public.upgrade_requests (user_id, plan, status, order_code, metode, amount)
    values (uid, 'pro_sekali', 'baru', kode, p_metode, s.harga_pro) returning * into r;
  perform public._catat_event(r.id, null, 'baru', 'Pesanan dibuat');
  return r;
end $$;

-- 6. SELLER: konfirmasi sudah membayar (hanya klaim → Menunggu Verifikasi; TIDAK mengaktifkan Pro).
create or replace function public.konfirmasi_sudah_bayar(p_order bigint, p_catatan text default '')
returns public.upgrade_requests language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests;
begin
  select * into r from public.upgrade_requests where id = p_order and user_id = auth.uid() and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status = 'diproses' then return r; end if;   -- klik ulang aman
  if r.status <> 'baru' then raise exception 'Status pesanan tidak dapat diubah'; end if;
  update public.upgrade_requests set status = 'diproses', claimed_at = now(), updated_at = now() where id = r.id returning * into r;
  perform public._catat_event(r.id, 'baru', 'diproses', 'Pembeli menyatakan sudah membayar. ' || left(coalesce(p_catatan, ''), 300));
  return r;
end $$;

-- 7. SELLER: batalkan pesanan yang belum dibayar.
create or replace function public.batalkan_pesanan(p_order bigint)
returns public.upgrade_requests language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests;
begin
  select * into r from public.upgrade_requests where id = p_order and user_id = auth.uid() and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status <> 'baru' then raise exception 'Pesanan yang sudah dikonfirmasi dibayar hanya bisa dibatalkan oleh admin'; end if;
  update public.upgrade_requests set status = 'dibatalkan', updated_at = now() where id = r.id returning * into r;
  perform public._catat_event(r.id, 'baru', 'dibatalkan', 'Dibatalkan pembeli');
  return r;
end $$;

-- 8. ADMIN: verifikasi dana masuk → catat pembayaran + aktifkan Pro, atomik. Ulang dengan referensi yang sama = aman.
create or replace function public.admin_verifikasi_pesanan(p_order bigint, p_sumber text, p_referensi text, p_nominal integer, p_catatan text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests; ref text := upper(regexp_replace(coalesce(p_referensi, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_sumber is null or p_sumber not in ('transfer', 'qris') then raise exception 'Sumber pembayaran harus transfer atau qris'; end if;
  if length(ref) < 3 then raise exception 'Referensi transaksi dari mutasi wajib diisi'; end if;
  if p_nominal is null or p_nominal <= 0 then raise exception 'Nominal pembayaran wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status = 'selesai' then
    if exists (select 1 from public.pro_payments where order_id = r.id and kind = 'pembayaran' and sumber = p_sumber and reference_norm = ref)
      then return 'sudah_aktif'; end if;   -- percobaan ulang: tidak menggandakan
    raise exception 'Pesanan sudah aktif. Untuk transfer ganda/kelebihan gunakan "Catat pembayaran tambahan"';
  end if;
  if r.status = 'direfund' then raise exception 'Pesanan sudah direfund'; end if;
  if p_nominal < r.amount then raise exception 'Nominal kurang dari tagihan. Pro tidak diaktifkan'; end if;
  perform 1 from public.profiles where id = r.user_id for update;
  if exists (select 1 from public.profiles where id = r.user_id and pro_sekali_bayar) then raise exception 'Akun ini sudah Pro sekali bayar'; end if;
  begin
    insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, created_by)
      values (r.id, r.user_id, 'pembayaran', p_sumber, p_referensi, p_nominal, left(coalesce(p_catatan, ''), 500), auth.uid());
  exception when unique_violation then
    raise exception 'Referensi ini sudah tercatat untuk pembayaran lain';
  end;
  update public.profiles set pro_sekali_bayar = true where id = r.user_id;
  update public.upgrade_requests set status = 'selesai', updated_at = now() where id = r.id;
  perform public._catat_event(r.id, r.status, 'selesai', 'Dana terverifikasi (' || p_sumber || ', ' || ref || ')'
    || case when p_nominal > r.amount then '. Kelebihan bayar ' || (p_nominal - r.amount) || ', perlu refund kelebihan' else '' end);
  return case when p_nominal > r.amount then 'aktif_kelebihan' else 'aktif' end;
end $$;

-- 9. ADMIN: catat pembayaran tambahan (transfer ganda / kelebihan terpisah) tanpa mengubah hak akses.
create or replace function public.admin_catat_pembayaran_tambahan(p_order bigint, p_sumber text, p_referensi text, p_nominal integer, p_catatan text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_catatan, ''))) < 3 then raise exception 'Keterangan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  begin
    insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, created_by)
      values (r.id, r.user_id, 'pembayaran', p_sumber, p_referensi, p_nominal, trim(p_catatan), auth.uid());
  exception when unique_violation then raise exception 'Referensi ini sudah tercatat untuk pembayaran lain';
            when check_violation then raise exception 'Sumber, referensi, dan nominal wajib diisi';
  end;
  perform public._catat_event(r.id, r.status, r.status, 'Pembayaran tambahan dicatat: ' || trim(p_catatan));
end $$;

-- 10. ADMIN: refund (penuh/kelebihan). Nominal ≤ saldo dana pesanan. cabut_pro = true untuk refund penuh.
create or replace function public.admin_refund_pesanan(p_order bigint, p_nominal integer, p_alasan text, p_cabut_pro boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests; saldo integer; asal bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  select coalesce(sum(case when kind = 'pembayaran' then amount when kind = 'refund' then -amount else 0 end), 0)
    into saldo from public.pro_payments where order_id = r.id;
  if p_nominal is null or p_nominal <= 0 or p_nominal > saldo then raise exception 'Nominal refund harus 1 sampai %', saldo; end if;
  select max(id) into asal from public.pro_payments where order_id = r.id and kind = 'pembayaran';
  insert into public.pro_payments (order_id, user_id, kind, amount, note, refund_of, created_by)
    values (r.id, r.user_id, 'refund', p_nominal, trim(p_alasan), asal, auth.uid());
  if p_cabut_pro then
    perform 1 from public.profiles where id = r.user_id for update;
    update public.profiles set pro_sekali_bayar = false where id = r.user_id;
    update public.upgrade_requests set status = 'direfund', updated_at = now() where id = r.id;
    perform public._catat_event(r.id, r.status, 'direfund', 'Refund ' || p_nominal || ', Pro dicabut: ' || trim(p_alasan));
  else
    perform public._catat_event(r.id, r.status, r.status, 'Refund sebagian/kelebihan ' || p_nominal || ': ' || trim(p_alasan));
  end if;
end $$;

-- 11. ADMIN: tolak / batalkan pesanan (dana tidak ditemukan, kurang bayar, dll.). Berlaku juga untuk permintaan lama.
create or replace function public.admin_tolak_pesanan(p_order bigint, p_alasan text, p_status text default 'ditolak')
returns void language plpgsql security definer set search_path = public as $$
declare r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_status not in ('ditolak', 'dibatalkan') then raise exception 'Status harus ditolak atau dibatalkan'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status not in ('baru', 'diproses') then raise exception 'Hanya pesanan yang belum selesai yang bisa ditolak'; end if;
  update public.upgrade_requests set status = p_status, updated_at = now() where id = r.id;
  perform public._catat_event(r.id, r.status, p_status, trim(p_alasan));
end $$;

-- 12. ADMIN: cabut Pro sekali bayar tanpa refund (mis. pelanggaran ketentuan), tercatat.
create or replace function public.admin_cabut_pro(target uuid, catatan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(catatan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  perform 1 from public.profiles where id = target for update;
  if not exists (select 1 from public.profiles where id = target and pro_sekali_bayar) then raise exception 'Akun ini tidak memiliki Pro sekali bayar'; end if;
  insert into public.pro_payments (user_id, kind, amount, note, created_by) values (target, 'pencabutan', 0, trim(catatan), auth.uid());
  update public.profiles set pro_sekali_bayar = false where id = target;   -- pro_until (Pro lama) tidak disentuh
end $$;

-- Usulan v1 (tanpa pesanan) tidak dipakai lagi.
drop function if exists public.admin_aktifkan_pro_sekali(uuid, integer, text, text);
drop function if exists public.admin_cabut_pro(uuid, text, integer, text);

revoke all on function public.buat_pesanan_pro(text) from public, anon;
revoke all on function public.konfirmasi_sudah_bayar(bigint, text) from public, anon;
revoke all on function public.batalkan_pesanan(bigint) from public, anon;
revoke all on function public.admin_verifikasi_pesanan(bigint, text, text, integer, text) from public, anon;
revoke all on function public.admin_catat_pembayaran_tambahan(bigint, text, text, integer, text) from public, anon;
revoke all on function public.admin_refund_pesanan(bigint, integer, text, boolean) from public, anon;
revoke all on function public.admin_tolak_pesanan(bigint, text, text) from public, anon;
revoke all on function public.admin_cabut_pro(uuid, text) from public, anon;
grant execute on function public.buat_pesanan_pro(text) to authenticated;
grant execute on function public.konfirmasi_sudah_bayar(bigint, text) to authenticated;
grant execute on function public.batalkan_pesanan(bigint) to authenticated;
grant execute on function public.admin_verifikasi_pesanan(bigint, text, text, integer, text) to authenticated;
grant execute on function public.admin_catat_pembayaran_tambahan(bigint, text, text, integer, text) to authenticated;
grant execute on function public.admin_refund_pesanan(bigint, integer, text, boolean) to authenticated;
grant execute on function public.admin_tolak_pesanan(bigint, text, text) to authenticated;
grant execute on function public.admin_cabut_pro(uuid, text) to authenticated;

-- 13. (OPSIONAL, keputusan pemilik) Batas 3 riwayat untuk akun gratis ditegakkan di database (M5).
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

-- Supabase/PostgREST: muat ulang cache skema agar fungsi baru langsung terlihat.
notify pgrst, 'reload schema';
