-- ============================================================================================================
-- USULAN v3 — BELUM DIJALANKAN DI PRODUKSI. Jalankan di project Supabase STAGING dulu (docs/usulan/STAGING_SUPABASE.md).
-- Pembayaran manual Pro sekali bayar: Transfer Bank + QRIS STATIS, berbasis akun, diverifikasi admin dari mutasi.
--
-- Satu sistem, memakai ulang tabel yang ada:
--  - profiles.pro_sekali_bayar  : hak akses sekali bayar (eksplisit). Pro berjangka lama (pro_until) tidak disentuh.
--  - upgrade_requests           : PESANAN (kode, metode, nominal dibuat server; batas bayar 48 jam).
--  - pro_order_events           : histori status pesanan; catatan admin internal tidak terlihat pembeli.
--  - pro_payments               : buku besar dana (append-only bagi pengguna): pembayaran, refund, pencabutan.
--                                 Dana yang belum bisa dipastikan pemiliknya tetap tercatat (order_id kosong).
--  - pro_audit_log              : jejak koreksi admin & perubahan pengaturan (hanya admin yang membaca).
--  - pengaturan_pembayaran      : harga resmi, batas jam, rekening, QRIS statis, kontak bantuan (hanya admin mengubah).
--
-- Status pesanan (upgrade_requests.status):
--   baru = Menunggu Pembayaran · diproses = Menunggu Verifikasi · perlu_cek = Perlu Pemeriksaan
--   selesai = Aktif · ditolak = Gagal · dibatalkan = Dibatalkan/Kedaluwarsa · direfund = Dana dikembalikan
-- Prinsip: Pro aktif HANYA lewat fungsi admin yang mencatat dana; klaim pembeli tidak pernah mengaktifkan Pro.
-- Idempoten: aman dijalankan ulang. Uji lokal: supabase/usulan/test-pro-sekali-bayar.sql & test-rls-setelah-migrasi.sql.
-- ============================================================================================================

-- 0. Hak akses sekali bayar (default false). Pengguna tidak punya hak ubah kolom ini (grant update profiles terbatas).
alter table public.profiles add column if not exists pro_sekali_bayar boolean not null default false;

-- 1. Pengaturan pembayaran (satu baris). Dibaca akun yang login; diubah hanya admin.
create table if not exists public.pengaturan_pembayaran (
  id             smallint primary key default 1 check (id = 1),
  aktif          boolean not null default false,
  harga_pro      integer not null default 149000 check (harga_pro between 1000 and 100000000),
  batas_jam      integer not null default 48 check (batas_jam between 1 and 720),
  bank_nama      text not null default '' check (length(bank_nama) <= 60),
  bank_nomor     text not null default '' check (bank_nomor ~ '^[0-9]{0,20}$'),
  bank_pemilik   text not null default '' check (length(bank_pemilik) <= 100),
  qris_merchant  text not null default '' check (length(qris_merchant) <= 100),
  qris_nmid      text not null default '' check (length(qris_nmid) <= 40),
  qris_gambar    text not null default '' check (qris_gambar = '' or qris_gambar ~ '^img/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp)$'),
  kontak_bantuan text not null default '' check (length(kontak_bantuan) <= 200),
  diubah_pada    timestamptz not null default now(),
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
grant update (aktif, harga_pro, batas_jam, bank_nama, bank_nomor, bank_pemilik, qris_merchant, qris_nmid, qris_gambar, kontak_bantuan)
  on public.pengaturan_pembayaran to authenticated;   -- dibatasi policy: hanya admin

-- 2. Pesanan = upgrade_requests (data lama tetap sah).
alter table public.upgrade_requests add column if not exists order_code text;
alter table public.upgrade_requests add column if not exists metode text;
alter table public.upgrade_requests add column if not exists amount integer;
alter table public.upgrade_requests add column if not exists claimed_at timestamptz;
alter table public.upgrade_requests add column if not exists expired_at timestamptz;
alter table public.upgrade_requests add column if not exists updated_at timestamptz not null default now();
alter table public.upgrade_requests drop constraint if exists upgrade_requests_metode_check;
alter table public.upgrade_requests add constraint upgrade_requests_metode_check check (metode is null or metode in ('transfer', 'qris'));
alter table public.upgrade_requests drop constraint if exists upgrade_requests_amount_check;
alter table public.upgrade_requests add constraint upgrade_requests_amount_check check (amount is null or amount > 0);
alter table public.upgrade_requests drop constraint if exists upgrade_requests_plan_check;
alter table public.upgrade_requests add constraint upgrade_requests_plan_check check (plan in ('pro_sekali', 'pro_bulanan', 'pro_tahunan', 'jasa'));
alter table public.upgrade_requests drop constraint if exists upgrade_requests_status_check;
alter table public.upgrade_requests add constraint upgrade_requests_status_check
  check (status in ('baru', 'diproses', 'perlu_cek', 'selesai', 'ditolak', 'dibatalkan', 'direfund'));
alter table public.upgrade_requests drop constraint if exists upgrade_requests_pro_lengkap;
alter table public.upgrade_requests add constraint upgrade_requests_pro_lengkap
  check (plan <> 'pro_sekali' or (order_code is not null and metode is not null and amount is not null));
create unique index if not exists upgrade_requests_order_code on public.upgrade_requests (order_code) where order_code is not null;
drop index if exists public.upgrade_requests_satu_terbuka;
create unique index upgrade_requests_satu_terbuka on public.upgrade_requests (user_id)
  where plan = 'pro_sekali' and status in ('baru', 'diproses', 'perlu_cek');
-- Seller tidak lagi menulis langsung: pesanan dibuat/diubah lewat fungsi di bawah.
drop policy if exists "upgrade: buat sendiri" on public.upgrade_requests;
drop policy if exists "upgrade: admin ubah status" on public.upgrade_requests;
revoke insert, update, delete on public.upgrade_requests from anon, authenticated;

-- 3. Histori status pesanan. internal = catatan admin (tidak terlihat pembeli).
create table if not exists public.pro_order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.upgrade_requests (id) on delete cascade,
  status_lama text,
  status_baru text not null,
  oleh        uuid references auth.users (id) on delete set null,   -- null = sistem (mis. kedaluwarsa)
  catatan     text not null default '' check (length(catatan) <= 500),
  internal    boolean not null default false,
  waktu       timestamptz not null default now()
);
alter table public.pro_order_events add column if not exists internal boolean not null default false;
alter table public.pro_order_events enable row level security;
drop policy if exists "events: baca pesanan sendiri atau admin" on public.pro_order_events;
create policy "events: baca pesanan sendiri atau admin" on public.pro_order_events for select using (
  public.is_admin() or (not internal and exists (select 1 from public.upgrade_requests r where r.id = order_id and r.user_id = auth.uid())));
revoke all on public.pro_order_events from anon, authenticated;
grant select on public.pro_order_events to authenticated;

-- 4. Buku besar dana. Disimpan walau akun dihapus (user_id menjadi null; minimisasi identitas).
create table if not exists public.pro_payments (
  id               bigint generated always as identity primary key,
  order_id         bigint references public.upgrade_requests (id) on delete set null,
  user_id          uuid references auth.users (id) on delete set null,
  kind             text not null check (kind in ('pembayaran', 'refund', 'pencabutan')),
  sumber           text check (sumber is null or sumber in ('transfer', 'qris')),
  reference        text check (reference is null or length(reference) <= 100),
  reference_norm   text generated always as (upper(regexp_replace(coalesce(reference, ''), '[^A-Za-z0-9]', '', 'g'))) stored,
  amount           integer not null default 0 check (amount >= 0 and amount <= 100000000),
  note             text not null default '' check (length(note) <= 500),
  refund_of        bigint references public.pro_payments (id),
  dihubungkan_pada timestamptz,   -- pembayaran: kapan dipastikan milik pesanan/akun tertentu; null = belum teridentifikasi
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint pembayaran_lengkap check (kind <> 'pembayaran' or (sumber is not null and length(reference_norm) >= 3 and amount > 0)),
  constraint refund_menunjuk_asal check (kind <> 'refund' or (refund_of is not null and amount > 0))
);
alter table public.pro_payments add column if not exists dihubungkan_pada timestamptz;
alter table public.pro_payments drop constraint if exists refund_menunjuk_asal;
alter table public.pro_payments add constraint refund_menunjuk_asal check (kind <> 'refund' or (refund_of is not null and amount > 0));
-- Satu referensi mutasi per sumber hanya bisa dicatat sekali sebagai pembayaran.
create unique index if not exists pro_payments_ref on public.pro_payments (sumber, reference_norm) where kind = 'pembayaran';
alter table public.pro_payments enable row level security;
drop policy if exists "pro_payments: baca sendiri atau admin" on public.pro_payments;
create policy "pro_payments: baca sendiri atau admin" on public.pro_payments for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_payments from anon, authenticated;
grant select on public.pro_payments to authenticated;

-- 5. Jejak audit admin (koreksi referensi, penghubungan dana, perubahan pengaturan). Hanya admin yang membaca.
create table if not exists public.pro_audit_log (
  id         bigint generated always as identity primary key,
  aksi       text not null,
  payment_id bigint references public.pro_payments (id) on delete set null,
  order_id   bigint references public.upgrade_requests (id) on delete set null,
  lama       jsonb,
  baru       jsonb,
  alasan     text not null default '' check (length(alasan) <= 500),
  oleh       uuid references auth.users (id) on delete set null,
  waktu      timestamptz not null default now()
);
alter table public.pro_audit_log enable row level security;
drop policy if exists "audit: admin baca" on public.pro_audit_log;
create policy "audit: admin baca" on public.pro_audit_log for select using (public.is_admin());
revoke all on public.pro_audit_log from anon, authenticated;
grant select on public.pro_audit_log to authenticated;

-- Fungsi bantu internal (tidak diberikan ke pengguna).
create or replace function public._catat_event(p_order bigint, p_lama text, p_baru text, p_catatan text, p_internal boolean default false)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.pro_order_events (order_id, status_lama, status_baru, oleh, catatan, internal)
  values (p_order, p_lama, p_baru, auth.uid(), left(coalesce(p_catatan, ''), 500), coalesce(p_internal, false));
$$;
create or replace function public._audit(p_aksi text, p_payment bigint, p_order bigint, p_lama jsonb, p_baru jsonb, p_alasan text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.pro_audit_log (aksi, payment_id, order_id, lama, baru, alasan, oleh)
  values (p_aksi, p_payment, p_order, p_lama, p_baru, left(coalesce(p_alasan, ''), 500), auth.uid());
$$;
create or replace function public._norm_ref(p text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;
drop function if exists public._catat_event(bigint, text, text, text);
revoke all on function public._catat_event(bigint, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public._audit(text, bigint, bigint, jsonb, jsonb, text) from public, anon, authenticated;

-- Perubahan pengaturan pembayaran tercatat (siapa, kapan, sebelum/sesudah).
create or replace function public._audit_pengaturan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.diubah_pada := now();
  perform public._audit('ubah_pengaturan', null, null, to_jsonb(old) - 'diubah_pada', to_jsonb(new) - 'diubah_pada', '');
  return new;
end $$;
drop trigger if exists audit_pengaturan on public.pengaturan_pembayaran;
create trigger audit_pengaturan before update on public.pengaturan_pembayaran for each row execute function public._audit_pengaturan();

-- 6. PERBAIKAN fungsi lama: admin_set_pro (Pro berjangka lama) tidak boleh menutup pesanan Pro sekali bayar,
--    karena itu akan menandai pesanan "Aktif" tanpa dana tercatat.
create or replace function public.admin_set_pro(target uuid, until date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare lama date;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select pro_until into lama from public.profiles where id = target for update;
  if not found then raise exception 'Akun tidak ditemukan'; end if;
  update public.profiles set pro_until = until where id = target;
  -- Jalur Pro lama tidak mencatat dana; setiap perubahannya tetap masuk jejak audit agar tidak ada aktivasi tanpa jejak.
  perform public._audit('set_pro_lama', null, null, jsonb_build_object('user_id', target, 'pro_until', lama),
    jsonb_build_object('user_id', target, 'pro_until', until), 'admin_set_pro');
  if until is not null then
    update public.upgrade_requests set status = 'selesai' where user_id = target and status in ('baru', 'diproses') and plan <> 'pro_sekali';
  end if;
end $$;

-- 7. SELLER: buat pesanan (atau kembalikan pesanan terbuka). Nominal dari harga resmi di server.
create or replace function public.buat_pesanan_pro(p_metode text)
returns public.upgrade_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.pengaturan_pembayaran; r public.upgrade_requests; kode text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  select * into s from public.pengaturan_pembayaran where id = 1;
  if s is null or not s.aktif then raise exception 'Pembelian Pro belum dibuka'; end if;
  if p_metode is null or p_metode not in ('transfer', 'qris')
     or (p_metode = 'transfer' and not (s.bank_nama <> '' and s.bank_nomor <> '' and s.bank_pemilik <> ''))
     or (p_metode = 'qris' and not (s.qris_merchant <> '' and s.qris_gambar <> '')) then
    raise exception 'Metode pembayaran tidak tersedia';
  end if;
  perform 1 from public.profiles where id = uid for update;   -- serialisasi permintaan bersamaan dari akun yang sama
  if exists (select 1 from public.profiles where id = uid and pro_sekali_bayar) then raise exception 'Akun Anda sudah Pro'; end if;
  -- Pesanan yang belum dikonfirmasi dibayar dan melewati batas jam → dibatalkan (kedaluwarsa), tercatat.
  for r in select * from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' and status = 'baru'
           and created_at < now() - make_interval(hours => s.batas_jam) for update loop
    update public.upgrade_requests set status = 'dibatalkan', expired_at = now(), updated_at = now() where id = r.id;
    perform public._catat_event(r.id, 'baru', 'dibatalkan', 'Kedaluwarsa: belum dibayar dalam batas waktu');
  end loop;
  select * into r from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' and status in ('baru', 'diproses', 'perlu_cek') for update;
  if found then
    if r.status = 'baru' and r.metode is distinct from p_metode then
      update public.upgrade_requests set metode = p_metode, updated_at = now() where id = r.id returning * into r;
      perform public._catat_event(r.id, 'baru', 'baru', 'Metode diganti: ' || p_metode);
    end if;
    return r;   -- pesanan terbuka dikembalikan (tidak ada duplikat)
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

-- 8. SELLER: konfirmasi sudah membayar. Hanya klaim → Menunggu Verifikasi, atau Perlu Pemeriksaan bila lewat batas
--    waktu / pesanan sudah kedaluwarsa. TIDAK pernah mengaktifkan Pro.
create or replace function public.konfirmasi_sudah_bayar(p_order bigint, p_catatan text default '')
returns public.upgrade_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests; s public.pengaturan_pembayaran; lewat boolean; baru text; cat text := left(coalesce(p_catatan, ''), 300);
begin
  select * into r from public.upgrade_requests where id = p_order and user_id = auth.uid() and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status in ('diproses', 'perlu_cek') then return r; end if;   -- klik ulang aman
  select * into s from public.pengaturan_pembayaran where id = 1;
  lewat := r.created_at < now() - make_interval(hours => coalesce(s.batas_jam, 48));
  if r.status = 'baru' then baru := case when lewat then 'perlu_cek' else 'diproses' end;
  elsif r.status = 'dibatalkan' and r.expired_at is not null and r.expired_at > now() - interval '30 days' then baru := 'perlu_cek';
  else raise exception 'Status pesanan tidak dapat diubah';
  end if;
  begin
    update public.upgrade_requests set status = baru, claimed_at = now(), updated_at = now() where id = r.id returning * into r;
  exception when unique_violation then
    raise exception 'Anda masih memiliki pesanan lain yang terbuka. Hubungi bantuan dengan kode pesanan ini';
  end;
  perform public._catat_event(r.id, case when baru = 'perlu_cek' and r.expired_at is not null then 'dibatalkan' else 'baru' end, baru,
    case when baru = 'perlu_cek' then 'Pembeli menyatakan sudah membayar setelah batas waktu; perlu pemeriksaan manual. ' else 'Pembeli menyatakan sudah membayar. ' end || cat);
  return r;
end $$;

-- 9. SELLER: batalkan pesanan yang belum dikonfirmasi dibayar.
create or replace function public.batalkan_pesanan(p_order bigint)
returns public.upgrade_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests;
begin
  select * into r from public.upgrade_requests where id = p_order and user_id = auth.uid() and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status <> 'baru' then raise exception 'Pesanan yang sudah dikonfirmasi dibayar hanya bisa dibatalkan oleh admin'; end if;
  update public.upgrade_requests set status = 'dibatalkan', updated_at = now() where id = r.id returning * into r;
  perform public._catat_event(r.id, 'baru', 'dibatalkan', 'Dibatalkan pembeli');
  return r;
end $$;

-- Bantu: aktifkan Pro dari pesanan + tautkan dana, dalam transaksi pemanggil (dipakai fungsi 10 & 12).
create or replace function public._aktifkan_dari_pesanan(r public.upgrade_requests, p_payment bigint, p_nominal integer, p_ket text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if r.status not in ('baru', 'diproses', 'perlu_cek', 'dibatalkan', 'ditolak') then raise exception 'Pesanan tidak dapat diaktifkan dari status %', r.status; end if;
  if p_nominal < r.amount then raise exception 'Nominal kurang dari tagihan. Pro tidak diaktifkan'; end if;
  perform 1 from public.profiles where id = r.user_id for update;
  if exists (select 1 from public.profiles where id = r.user_id and pro_sekali_bayar) then raise exception 'Akun ini sudah Pro sekali bayar'; end if;
  update public.pro_payments set order_id = r.id, user_id = r.user_id, dihubungkan_pada = now() where id = p_payment;
  update public.profiles set pro_sekali_bayar = true where id = r.user_id;
  update public.upgrade_requests set status = 'selesai', updated_at = now() where id = r.id;
  perform public._catat_event(r.id, r.status, 'selesai', p_ket
    || case when p_nominal > r.amount then '. Kelebihan bayar ' || (p_nominal - r.amount) || ', perlu refund kelebihan' else '' end);
  return case when p_nominal > r.amount then 'aktif_kelebihan' else 'aktif' end;
end $$;
revoke all on function public._aktifkan_dari_pesanan(public.upgrade_requests, bigint, integer, text) from public, anon, authenticated;

-- 10. ADMIN: verifikasi dana dari mutasi → catat + aktifkan, atomik. Ulang dengan referensi sama = aman.
create or replace function public.admin_verifikasi_pesanan(p_order bigint, p_sumber text, p_referensi text, p_nominal integer, p_catatan text default '')
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests; ref text := public._norm_ref(p_referensi); pid bigint; ada public.pro_payments;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_sumber is null or p_sumber not in ('transfer', 'qris') then raise exception 'Sumber pembayaran harus transfer atau qris'; end if;
  if length(ref) < 3 then raise exception 'Referensi transaksi dari mutasi wajib diisi'; end if;
  if p_nominal is null or p_nominal <= 0 then raise exception 'Nominal pembayaran wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  select * into ada from public.pro_payments where kind = 'pembayaran' and sumber = p_sumber and reference_norm = ref for update;
  if found then
    if ada.order_id = r.id and r.status = 'selesai' then return 'sudah_aktif'; end if;   -- percobaan ulang: tidak menggandakan
    if ada.dihubungkan_pada is null then raise exception 'Referensi ini sudah tercatat sebagai dana belum teridentifikasi (#%). Gunakan "Hubungkan dana"', ada.id; end if;
    raise exception 'Referensi ini sudah tercatat untuk pembayaran lain';
  end if;
  if r.status = 'selesai' then raise exception 'Pesanan sudah aktif. Untuk transfer ganda/kelebihan gunakan "Catat pembayaran tambahan"'; end if;
  if r.status = 'direfund' then raise exception 'Pesanan sudah direfund'; end if;
  if p_nominal < r.amount then raise exception 'Nominal kurang dari tagihan. Pro tidak diaktifkan'; end if;
  insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, created_by)
    values (r.id, r.user_id, 'pembayaran', p_sumber, p_referensi, p_nominal, left(coalesce(p_catatan, ''), 500), auth.uid()) returning id into pid;
  return public._aktifkan_dari_pesanan(r, pid, p_nominal, 'Dana terverifikasi (' || p_sumber || ', ' || ref || ')');
end $$;

-- 11. ADMIN: catat dana masuk yang BELUM bisa dipastikan pemiliknya (mis. dua QRIS Rp149.000 berdekatan).
--     Dana tercatat (tidak hilang), Pro tidak aktif, sampai dihubungkan ke pesanan setelah pemeriksaan.
create or replace function public.admin_catat_dana_masuk(p_sumber text, p_referensi text, p_nominal integer, p_catatan text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare pid bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_catatan, ''))) < 3 then raise exception 'Keterangan wajib diisi (mis. waktu & nama di mutasi)'; end if;
  begin
    insert into public.pro_payments (kind, sumber, reference, amount, note, created_by)
      values ('pembayaran', p_sumber, p_referensi, p_nominal, trim(p_catatan), auth.uid()) returning id into pid;
  exception when unique_violation then raise exception 'Referensi ini sudah tercatat';
            when check_violation then raise exception 'Sumber, referensi, dan nominal wajib diisi';
  end;
  perform public._audit('catat_dana_belum_teridentifikasi', pid, null, null, jsonb_build_object('sumber', p_sumber, 'nominal', p_nominal), trim(p_catatan));
  return pid;
end $$;

-- 12. ADMIN: hubungkan dana belum teridentifikasi ke pesanan → aktifkan Pro, atomik.
create or replace function public.admin_hubungkan_dana(p_payment bigint, p_order bigint, p_alasan text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments; r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Dasar penghubungan wajib diisi (bukti yang dicocokkan)'; end if;
  select * into d from public.pro_payments where id = p_payment for update;
  if not found or d.kind <> 'pembayaran' then raise exception 'Dana tidak ditemukan'; end if;
  if d.dihubungkan_pada is not null then raise exception 'Dana ini sudah terhubung ke pesanan'; end if;
  if exists (select 1 from public.pro_payments where refund_of = d.id) then raise exception 'Dana ini sudah (sebagian) direfund'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  perform public._audit('hubungkan_dana', d.id, r.id, null, jsonb_build_object('order_code', r.order_code), trim(p_alasan));
  return public._aktifkan_dari_pesanan(r, d.id, d.amount, 'Dana #' || d.id || ' dihubungkan: ' || trim(p_alasan));
end $$;

-- 13. ADMIN: catat pembayaran tambahan pada pesanan (transfer ganda / kelebihan terpisah) tanpa mengubah hak akses.
create or replace function public.admin_catat_pembayaran_tambahan(p_order bigint, p_sumber text, p_referensi text, p_nominal integer, p_catatan text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests; pid bigint;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_catatan, ''))) < 3 then raise exception 'Keterangan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  begin
    insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, dihubungkan_pada, created_by)
      values (r.id, r.user_id, 'pembayaran', p_sumber, p_referensi, p_nominal, trim(p_catatan), now(), auth.uid()) returning id into pid;
  exception when unique_violation then raise exception 'Referensi ini sudah tercatat untuk pembayaran lain';
            when check_violation then raise exception 'Sumber, referensi, dan nominal wajib diisi';
  end;
  perform public._catat_event(r.id, r.status, r.status, 'Pembayaran tambahan dicatat: ' || trim(p_catatan));
  return pid;
end $$;

-- 14. ADMIN: refund yang MENUNJUK pembayaran asal. Nominal ≤ sisa dana pembayaran itu. Pro dicabut hanya bila diminta.
create or replace function public.admin_refund_pembayaran(p_payment bigint, p_nominal integer, p_alasan text, p_cabut_pro boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments; r public.upgrade_requests; sisa integer;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into d from public.pro_payments where id = p_payment for update;
  if not found or d.kind <> 'pembayaran' then raise exception 'Pembayaran asal tidak ditemukan'; end if;
  select d.amount - coalesce(sum(amount), 0) into sisa from public.pro_payments where refund_of = d.id and kind = 'refund';
  if p_nominal is null or p_nominal <= 0 or p_nominal > sisa then raise exception 'Nominal refund harus 1 sampai %', sisa; end if;
  insert into public.pro_payments (order_id, user_id, kind, amount, note, refund_of, created_by)
    values (d.order_id, d.user_id, 'refund', p_nominal, trim(p_alasan), d.id, auth.uid());
  if d.order_id is not null then
    select * into r from public.upgrade_requests where id = d.order_id for update;
    if p_cabut_pro then
      if r.status <> 'selesai' then raise exception 'Pencabutan hanya untuk pesanan yang aktif'; end if;
      perform 1 from public.profiles where id = r.user_id for update;
      update public.profiles set pro_sekali_bayar = false where id = r.user_id;
      update public.upgrade_requests set status = 'direfund', updated_at = now() where id = r.id;
      perform public._catat_event(r.id, r.status, 'direfund', 'Refund ' || p_nominal || ', Pro dicabut: ' || trim(p_alasan));
    else
      perform public._catat_event(r.id, r.status, r.status, 'Refund ' || p_nominal || ' (Pro tetap): ' || trim(p_alasan));
    end if;
  elsif p_cabut_pro then raise exception 'Dana belum terhubung ke pesanan; tidak ada Pro yang dicabut';
  end if;
end $$;

-- 15. ADMIN: koreksi referensi yang salah ketik. Nilai lama & baru tercatat di audit; keunikan tetap dijaga.
create or replace function public.admin_koreksi_referensi(p_payment bigint, p_referensi_baru text, p_alasan text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  if length(public._norm_ref(p_referensi_baru)) < 3 then raise exception 'Referensi baru tidak valid'; end if;
  select * into d from public.pro_payments where id = p_payment and kind = 'pembayaran' for update;
  if not found then raise exception 'Pembayaran tidak ditemukan'; end if;
  begin
    update public.pro_payments set reference = p_referensi_baru where id = d.id;
  exception when unique_violation then raise exception 'Referensi baru sudah tercatat untuk pembayaran lain';
  end;
  perform public._audit('koreksi_referensi', d.id, d.order_id, jsonb_build_object('reference', d.reference), jsonb_build_object('reference', p_referensi_baru), trim(p_alasan));
end $$;

-- 16. ADMIN: tandai Perlu Pemeriksaan / tambah catatan internal (tidak terlihat pembeli).
create or replace function public.admin_catatan_pesanan(p_order bigint, p_catatan text, p_perlu_cek boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_catatan, ''))) < 3 then raise exception 'Catatan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if p_perlu_cek and r.status in ('baru', 'diproses') then
    update public.upgrade_requests set status = 'perlu_cek', updated_at = now() where id = r.id;
    perform public._catat_event(r.id, r.status, 'perlu_cek', 'Pembayaran sedang diperiksa manual');   -- terlihat pembeli, tanpa detail
  end if;
  perform public._catat_event(r.id, r.status, r.status, trim(p_catatan), true);   -- catatan internal admin
end $$;

-- 17. ADMIN: tolak / batalkan pesanan (dana tidak ditemukan, dll.). Berlaku juga untuk permintaan lama.
create or replace function public.admin_tolak_pesanan(p_order bigint, p_alasan text, p_status text default 'ditolak')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_status not in ('ditolak', 'dibatalkan') then raise exception 'Status harus ditolak atau dibatalkan'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into r from public.upgrade_requests where id = p_order for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status not in ('baru', 'diproses', 'perlu_cek') then raise exception 'Hanya pesanan yang belum selesai yang bisa ditolak'; end if;
  update public.upgrade_requests set status = p_status, updated_at = now() where id = r.id;
  perform public._catat_event(r.id, r.status, p_status, trim(p_alasan));
end $$;

-- 18. ADMIN: cabut Pro sekali bayar tanpa refund (mis. pelanggaran ketentuan), tercatat.
create or replace function public.admin_cabut_pro(target uuid, catatan text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(catatan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  perform 1 from public.profiles where id = target for update;
  if not exists (select 1 from public.profiles where id = target and pro_sekali_bayar) then raise exception 'Akun ini tidak memiliki Pro sekali bayar'; end if;
  insert into public.pro_payments (user_id, kind, amount, note, created_by) values (target, 'pencabutan', 0, trim(catatan), auth.uid());
  update public.profiles set pro_sekali_bayar = false where id = target;   -- pro_until (Pro lama) tidak disentuh
end $$;

-- Fungsi usulan versi lama tidak dipakai lagi.
drop function if exists public.admin_aktifkan_pro_sekali(uuid, integer, text, text);
drop function if exists public.admin_cabut_pro(uuid, text, integer, text);
drop function if exists public.admin_refund_pesanan(bigint, integer, text, boolean);

-- Hak eksekusi eksplisit: dicabut dari public/anon, diberikan ke authenticated (fungsi admin tetap memeriksa is_admin()).
do $$
declare f text;
begin
  foreach f in array array[
    'buat_pesanan_pro(text)', 'konfirmasi_sudah_bayar(bigint, text)', 'batalkan_pesanan(bigint)',
    'admin_verifikasi_pesanan(bigint, text, text, integer, text)', 'admin_catat_dana_masuk(text, text, integer, text)',
    'admin_hubungkan_dana(bigint, bigint, text)', 'admin_catat_pembayaran_tambahan(bigint, text, text, integer, text)',
    'admin_refund_pembayaran(bigint, integer, text, boolean)', 'admin_koreksi_referensi(bigint, text, text)',
    'admin_catatan_pesanan(bigint, text, boolean)', 'admin_tolak_pesanan(bigint, text, text)', 'admin_cabut_pro(uuid, text)',
    'admin_set_pro(uuid, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public._audit_pengaturan() from public, anon, authenticated;

-- 19. (OPSIONAL, keputusan pemilik) Batas 3 riwayat untuk akun gratis ditegakkan di database (M5).
create or replace function public.cek_batas_riwayat() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and (pro_sekali_bayar or pro_until >= current_date)) then return new; end if;
  if (select count(*) from public.reports where user_id = new.user_id) >= 3 then
    raise exception 'Akun gratis menyimpan 3 riwayat. Hapus yang lama atau gunakan Pro.';
  end if;
  return new;
end $$;
drop trigger if exists batas_riwayat on public.reports;
create trigger batas_riwayat before insert on public.reports for each row execute function public.cek_batas_riwayat();
-- Fungsi trigger tidak perlu dieksekusi pengguna (EXECUTE hanya diperiksa saat CREATE TRIGGER, bukan saat berjalan).
revoke execute on function public.cek_batas_riwayat() from public, anon, authenticated;

notify pgrst, 'reload schema';
