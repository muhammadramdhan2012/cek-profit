-- ============================================================================================================
-- USULAN — CHECKOUT TAMU (tanpa login) DENGAN MIDTRANS SNAP. BELUM DIJALANKAN DI STAGING MAUPUN PRODUKSI.
-- Urutan: … → usulan/qris-midtrans.sql → FILE INI. Aman dijalankan ulang.
--
-- Prinsip:
--  * Pesanan tamu terpisah (pro_pesanan_tamu); upgrade_requests tidak diubah. Dana tamu masuk buku besar sebagai dana
--    yang belum terhubung ke akun (order_id/user_id kosong), lalu dihubungkan lewat _aktifkan_dari_pesanan saat diklaim.
--  * Pro hanya aktif lewat klaim_pembelian_tamu(): akun yang emailnya SAMA, terkonfirmasi, dan sesi saat ini dibuat
--    dari tautan email (klaim amr). Membayar memakai email orang lain hanya memberi Pro kepada pemilik email itu.
--  * Tanpa service_role: fungsi sistem memakai RAHASIA GATEWAY (lihat qris-midtrans.sql); akun dibuat Supabase Auth
--    sendiri lewat tautan email (OTP), sehingga tidak ada akun ganda.
-- ============================================================================================================

create table if not exists public.pro_pesanan_tamu (
  id               bigint generated always as identity primary key,
  kode             text not null unique check (kode ~ '^CT-[A-Z0-9]{8}$'),   -- juga order_id Midtrans
  email            text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  nama             text not null check (length(nama) between 2 and 100),
  whatsapp         text not null default '' check (whatsapp ~ '^(\+62[0-9]{8,13})?$'),
  amount           integer not null check (amount > 0),
  status           text not null default 'dibuat' check (status in
                     ('dibuat', 'menunggu', 'lunas', 'diklaim', 'kedaluwarsa', 'batal', 'gagal', 'perlu_cek', 'refund_sebagian', 'direfund')),
  snap_token       text check (snap_token is null or length(snap_token) <= 200),
  snap_url         text check (snap_url is null or (snap_url ~ '^https?://' and length(snap_url) <= 500)),
  berlaku_sampai   timestamptz not null,
  gateway_txn_id   text check (gateway_txn_id is null or length(gateway_txn_id) <= 100),
  jumlah_diterima  numeric,
  payment_id       bigint references public.pro_payments (id) on delete set null,
  order_id         bigint references public.upgrade_requests (id) on delete set null,   -- dibuat saat diklaim
  diklaim_oleh     uuid references auth.users (id) on delete set null,
  diklaim_pada     timestamptz,
  email_status     text not null default 'belum' check (email_status in ('belum', 'terkirim', 'gagal')),
  email_percobaan  integer not null default 0,
  email_dicoba     timestamptz,
  pesan            text not null default '' check (length(pesan) <= 300),
  dicek_pada       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Satu tagihan berjalan per email: membayar ulang memakai Snap yang sama sampai kedaluwarsa.
create unique index if not exists pro_tamu_satu_terbuka on public.pro_pesanan_tamu (email) where status in ('dibuat', 'menunggu');
create index if not exists pro_tamu_email on public.pro_pesanan_tamu (email, created_at desc);
alter table public.pro_pesanan_tamu enable row level security;
drop policy if exists "tamu: admin baca" on public.pro_pesanan_tamu;
create policy "tamu: admin baca" on public.pro_pesanan_tamu for select using (public.is_admin());
revoke all on public.pro_pesanan_tamu from public, anon, authenticated;
grant select on public.pro_pesanan_tamu to authenticated;   -- dibatasi policy: hanya admin

-- 1. EDGE FUNCTION (rahasia): buat/ambil pesanan tamu. aksi: 'pakai' | 'cek' (lewat waktu, cek Midtrans dulu) | 'baru'.
create or replace function public.tamu_buat_pesanan(p_rahasia text, p_email text, p_nama text, p_whatsapp text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.pengaturan_pembayaran; t public.pro_pesanan_tamu; em text := lower(trim(coalesce(p_email, ''))); v_kode text;
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  select * into s from public.pengaturan_pembayaran where id = 1;
  if s is null or not s.aktif or s.mode <> 'otomatis' then raise exception 'Pembayaran otomatis belum dibuka'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 254 then raise exception 'Email tidak valid'; end if;
  if length(trim(coalesce(p_nama, ''))) < 2 then raise exception 'Nama lengkap wajib diisi'; end if;
  perform pg_advisory_xact_lock(hashtext('tamu:' || em));   -- serialisasi klik bersamaan untuk email yang sama
  select * into t from public.pro_pesanan_tamu where email = em and status in ('dibuat', 'menunggu') for update;
  if found then
    return jsonb_build_object('aksi', case when t.berlaku_sampai > now() + interval '20 seconds' then 'pakai' else 'cek' end, 'pesanan', to_jsonb(t));
  end if;
  if (select count(*) from public.pro_pesanan_tamu where email = em and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Terlalu banyak percobaan pembayaran untuk email ini. Coba lagi besok atau hubungi bantuan';
  end if;
  loop
    v_kode := 'CT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.pro_pesanan_tamu x where x.kode = v_kode);
  end loop;
  insert into public.pro_pesanan_tamu (kode, email, nama, whatsapp, amount, berlaku_sampai)
    values (v_kode, em, left(trim(p_nama), 100), coalesce(p_whatsapp, ''), s.harga_pro, now() + make_interval(mins => s.qr_berlaku_menit))
    returning * into t;
  return jsonb_build_object('aksi', 'baru', 'pesanan', to_jsonb(t), 'qr_menit', s.qr_berlaku_menit);
end $$;

-- 2. EDGE FUNCTION (rahasia): simpan hasil Snap (token & URL) untuk pesanan berstatus 'dibuat'.
create or replace function public.tamu_simpan_snap(p_rahasia text, p_pesanan bigint, p_hasil jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.pro_pesanan_tamu;
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  select * into t from public.pro_pesanan_tamu where id = p_pesanan for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if t.status <> 'dibuat' then return to_jsonb(t); end if;
  if coalesce((p_hasil ->> 'ok')::boolean, false) and coalesce(p_hasil ->> 'snap_url', '') <> '' then
    update public.pro_pesanan_tamu set status = 'menunggu', snap_token = nullif(p_hasil ->> 'snap_token', ''), snap_url = p_hasil ->> 'snap_url',
      updated_at = now() where id = t.id returning * into t;
  else
    update public.pro_pesanan_tamu set status = 'gagal', pesan = left(coalesce(p_hasil ->> 'pesan', 'Snap gagal dibuat'), 300), updated_at = now()
      where id = t.id returning * into t;
  end if;
  return to_jsonb(t);
end $$;

-- 3. Bantu: terapkan status Midtrans (hasil Get Status) untuk pesanan tamu. Dipanggil gateway_terapkan_status.
create or replace function public._tamu_terapkan_status(p_status jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.pro_pesanan_tamu; ts text := lower(coalesce(p_status ->> 'transaction_status', '')); txn text := coalesce(p_status ->> 'transaction_id', '');
  gross numeric; pid bigint; hasil text := 'tidak_berubah'; f jsonb; kunci text; jml numeric; rid bigint; r public.upgrade_requests; bersih bigint;
begin
  select * into t from public.pro_pesanan_tamu where kode = p_status ->> 'order_id' for update;
  if not found then return null; end if;
  update public.pro_pesanan_tamu set dicek_pada = now() where id = t.id;
  if ts in ('settlement', 'capture', 'refund', 'partial_refund') then
    if t.payment_id is null then
      if length(txn) < 3 then raise exception 'transaction_id kosong'; end if;
      gross := (p_status ->> 'gross_amount')::numeric;
      if not (gross = t.amount and gross = trunc(gross) and upper(coalesce(p_status ->> 'currency', 'IDR')) = 'IDR'
              and lower(coalesce(p_status ->> 'fraud_status', 'accept')) = 'accept') then
        update public.pro_pesanan_tamu set status = 'perlu_cek', gateway_txn_id = txn, jumlah_diterima = gross,
          pesan = 'Nominal/mata uang/fraud status tidak cocok; tidak dicatat sebagai pembayaran', updated_at = now() where id = t.id;
        perform public._audit('gateway_nominal_tidak_cocok', null, null, null,
          jsonb_build_object('kode', t.kode, 'transaction_id', txn, 'gross_amount', gross, 'tagihan', t.amount), 'checkout tamu');
        return 'perlu_cek';
      end if;
      insert into public.pro_payments (kind, sumber, reference, amount, note)
        values ('pembayaran', 'midtrans', txn, gross::integer, 'Checkout tamu ' || t.kode || ' (menunggu klaim email)')
        on conflict (sumber, reference_norm) where kind = 'pembayaran' do nothing returning id into pid;
      if pid is null then   -- transaction_id sudah dipakai transaksi lain: tidak dihubungkan
        update public.pro_pesanan_tamu set status = 'perlu_cek', pesan = 'transaction_id sudah tercatat untuk pesanan lain', updated_at = now() where id = t.id;
        perform public._audit('gateway_transaksi_bentrok', null, null, null, jsonb_build_object('kode', t.kode, 'transaction_id', txn), 'checkout tamu');
        return 'perlu_cek';
      end if;
      update public.pro_pesanan_tamu set status = 'lunas', payment_id = pid, gateway_txn_id = txn, jumlah_diterima = gross, updated_at = now()
        where id = t.id returning * into t;
      hasil := 'lunas_tamu';
    end if;
    for f in select * from jsonb_array_elements(case when jsonb_typeof(p_status -> 'refunds') = 'array' then p_status -> 'refunds' else '[]'::jsonb end) loop
      kunci := coalesce(nullif(f ->> 'refund_key', ''), case when f ->> 'refund_chargeback_id' is not null then txn || '-CB' || (f ->> 'refund_chargeback_id') end);
      jml := (f ->> 'refund_amount')::numeric;
      continue when kunci is null or length(public._norm_ref(kunci)) < 3 or jml is null or jml <= 0 or t.payment_id is null;
      insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, refund_of)
        values (t.order_id, t.diklaim_oleh, 'refund', 'midtrans', kunci, jml::integer, 'Refund checkout tamu ' || t.kode, t.payment_id)
        on conflict (sumber, reference_norm) where kind = 'refund' and sumber is not null do nothing returning id into rid;
      if rid is not null then hasil := 'refund'; end if;
    end loop;
    if t.payment_id is not null and exists (select 1 from public.pro_payments where refund_of = t.payment_id and kind = 'refund') then
      if (select coalesce(sum(amount), 0) from public.pro_payments where refund_of = t.payment_id and kind = 'refund') >= t.amount then
        update public.pro_pesanan_tamu set status = 'direfund', updated_at = now() where id = t.id;
        hasil := 'direfund';
        if t.order_id is not null then   -- sudah diklaim: cabut Pro bila seluruh dana pesanan kembali
          select * into r from public.upgrade_requests where id = t.order_id for update;
          select coalesce(sum(case when p.kind = 'pembayaran' then p.amount else -p.amount end), 0) into bersih
            from public.pro_payments p where p.order_id = r.id and p.kind in ('pembayaran', 'refund');
          if bersih <= 0 and r.status = 'selesai' then
            perform 1 from public.profiles where id = r.user_id for update;
            update public.profiles set pro_sekali_bayar = false where id = r.user_id;
            update public.upgrade_requests set status = 'direfund', updated_at = now() where id = r.id;
            perform public._catat_event(r.id, 'selesai', 'direfund', 'Seluruh dana checkout tamu dikembalikan lewat Midtrans; Pro dicabut');
          end if;
        end if;
      elsif t.status in ('lunas', 'diklaim') then
        update public.pro_pesanan_tamu set status = case when t.status = 'diklaim' then 'diklaim' else 'refund_sebagian' end, updated_at = now() where id = t.id;
      end if;
    end if;
    return hasil;
  end if;
  if t.status not in ('dibuat', 'menunggu', 'gagal') then return 'tidak_berubah'; end if;
  if ts = 'pending' and t.status in ('dibuat', 'gagal') then
    update public.pro_pesanan_tamu set status = 'menunggu', updated_at = now() where id = t.id; return 'menunggu';
  elsif ts = 'expire' then update public.pro_pesanan_tamu set status = 'kedaluwarsa', updated_at = now() where id = t.id; return 'kedaluwarsa';
  elsif ts = 'cancel' then update public.pro_pesanan_tamu set status = 'batal', updated_at = now() where id = t.id; return 'batal';
  elsif ts in ('deny', 'failure') then update public.pro_pesanan_tamu set status = 'gagal', updated_at = now() where id = t.id; return 'gagal';
  end if;
  return 'tidak_berubah';
end $$;
revoke all on function public._tamu_terapkan_status(jsonb) from public, anon, authenticated;

-- 4. gateway_terapkan_status (qris-midtrans.sql) meneruskan order_id yang bukan percobaan anggota ke _tamu_terapkan_status.

-- 5. EDGE FUNCTION (rahasia): pesanan tamu yang lunas tetapi tautan aktivasi belum terkirim (maks. 5 kali, jeda 1 menit).
create or replace function public.tamu_perlu_email(p_rahasia text, p_kode text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.pro_pesanan_tamu;
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  select * into t from public.pro_pesanan_tamu where kode = p_kode and status = 'lunas' and email_status <> 'terkirim'
    and email_percobaan < 5 and (email_dicoba is null or email_dicoba < now() - interval '1 minute') for update;
  if not found then return null; end if;
  update public.pro_pesanan_tamu set email_percobaan = email_percobaan + 1, email_dicoba = now() where id = t.id;
  return jsonb_build_object('id', t.id, 'email', t.email);
end $$;
create or replace function public.tamu_catat_email(p_rahasia text, p_pesanan bigint, p_ok boolean, p_pesan text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  update public.pro_pesanan_tamu set email_status = case when p_ok then 'terkirim' else 'gagal' end,
    pesan = case when p_ok then pesan else left('Email aktivasi gagal: ' || coalesce(p_pesan, ''), 300) end, updated_at = now()
    where id = p_pesanan and email_status <> 'terkirim';
end $$;

-- 6. EDGE FUNCTION (rahasia): status untuk halaman kembali dari Snap. Wajib kode + email yang cocok (tanpa membuka data lain).
create or replace function public.tamu_status(p_rahasia text, p_kode text, p_email text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when not public._rahasia_gateway_sah(p_rahasia) then null else (
    select jsonb_build_object('kode', kode, 'status', status, 'amount', amount, 'berlaku_sampai', berlaku_sampai, 'snap_url', snap_url,
      'email_status', email_status, 'dicek_pada', dicek_pada)
    from public.pro_pesanan_tamu where kode = p_kode and email = lower(trim(coalesce(p_email, '')))) end;
$$;

-- 7. PEMBELI (JWT): klaim pembelian tamu ke akun ini. Syarat: email akun terkonfirmasi DAN sesi dibuat dari tautan email.
create or replace function public.klaim_pembelian_tamu()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); em text; konfirm timestamptz; metode text[]; t public.pro_pesanan_tamu; r public.upgrade_requests;
  aktif int := 0; ganda int := 0;
begin
  if uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  select lower(email), email_confirmed_at into em, konfirm from auth.users where id = uid;
  select coalesce(array_agg(x ->> 'method'), '{}') into metode
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) x;
  if em is null or konfirm is null or not (metode && array['otp', 'magiclink', 'email/signup', 'recovery', 'invite']) then
    return jsonb_build_object('aktif', 0, 'ganda', 0, 'perlu_tautan_email',
      exists (select 1 from public.pro_pesanan_tamu where email = em and status = 'lunas'));
  end if;
  for t in select * from public.pro_pesanan_tamu where email = em and status = 'lunas' order by id for update loop
    perform 1 from public.profiles where id = uid for update;
    -- Pertahanan berlapis: dana yang sudah terhubung ke pesanan lain tidak boleh mengaktifkan akun kedua.
    if exists (select 1 from public.pro_payments where id = t.payment_id and dihubungkan_pada is not null) then
      update public.pro_pesanan_tamu set status = 'perlu_cek', pesan = 'Dana sudah terhubung ke pesanan lain; periksa manual', updated_at = now() where id = t.id;
      perform public._audit('gateway_transaksi_bentrok', t.payment_id, null, null, jsonb_build_object('kode', t.kode, 'user_id', uid), 'klaim tamu');
      continue;
    end if;
    if exists (select 1 from public.profiles where id = uid and pro_sekali_bayar) then
      update public.pro_pesanan_tamu set status = 'perlu_cek', diklaim_oleh = uid, diklaim_pada = now(),
        pesan = 'Akun sudah Pro: pembayaran ganda, perlu refund', updated_at = now() where id = t.id;
      perform public._audit('gateway_pembayaran_ganda', t.payment_id, null, null, jsonb_build_object('kode', t.kode, 'user_id', uid), 'checkout tamu');
      ganda := ganda + 1;
      continue;
    end if;
    -- Pesanan anggota dibuat langsung berstatus 'dibatalkan' (bukan "terbuka", sehingga tidak bentrok dengan pesanan
    -- terbuka yang mungkin ada), lalu _aktifkan_dari_pesanan menautkan dana & menyelesaikannya dalam transaksi yang sama.
    insert into public.upgrade_requests (user_id, plan, status, order_code, metode, amount)
      values (uid, 'pro_sekali', 'dibatalkan', t.kode, 'qris', t.amount) returning * into r;
    perform public._catat_event(r.id, null, 'dibatalkan', 'Pesanan dari checkout tamu ' || t.kode, true);
    perform public._aktifkan_dari_pesanan(r, t.payment_id, t.amount, 'Pembelian tamu diklaim lewat email terverifikasi');
    update public.pro_pesanan_tamu set status = 'diklaim', order_id = r.id, diklaim_oleh = uid, diklaim_pada = now(), updated_at = now() where id = t.id;
    update public.profiles set full_name = case when full_name = '' then t.nama else full_name end,
      whatsapp = case when whatsapp = '' then t.whatsapp else whatsapp end where id = uid;
    aktif := aktif + 1;
  end loop;
  return jsonb_build_object('aktif', aktif, 'ganda', ganda, 'perlu_tautan_email', false);
end $$;

-- 7b. ADMIN: "Hubungkan dana" (pro-sekali-bayar.sql) TIDAK berlaku untuk dana checkout tamu. Dana tamu hanya bisa
--     mengaktifkan Pro lewat klaim_pembelian_tamu (pembuktian email); tanpa ini satu dana bisa mengaktifkan dua akun.
create or replace function public.admin_hubungkan_dana(p_payment bigint, p_order bigint, p_alasan text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments; r public.upgrade_requests;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Dasar penghubungan wajib diisi (bukti yang dicocokkan)'; end if;
  select * into d from public.pro_payments where id = p_payment for update;
  if not found or d.kind <> 'pembayaran' then raise exception 'Dana tidak ditemukan'; end if;
  if exists (select 1 from public.pro_pesanan_tamu where payment_id = d.id) then
    raise exception 'Dana checkout tamu hanya aktif lewat tautan email pembelinya. Refund bila perlu';
  end if;
  if d.dihubungkan_pada is not null then raise exception 'Dana ini sudah terhubung ke pesanan'; end if;
  if exists (select 1 from public.pro_payments where refund_of = d.id) then raise exception 'Dana ini sudah (sebagian) direfund'; end if;
  select * into r from public.upgrade_requests where id = p_order and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  perform public._audit('hubungkan_dana', d.id, r.id, null, jsonb_build_object('order_code', r.order_code), trim(p_alasan));
  return public._aktifkan_dari_pesanan(r, d.id, d.amount, 'Dana #' || d.id || ' dihubungkan: ' || trim(p_alasan));
end $$;

-- 8. ADMIN: refund lewat Midtrans juga berlaku untuk dana checkout tamu.
create or replace function public.admin_refund_gateway_siapkan(p_payment bigint, p_nominal integer, p_alasan text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments; oid text; sisa integer; ke integer; kunci text;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into d from public.pro_payments where id = p_payment for update;
  if not found or d.kind <> 'pembayaran' or d.sumber is distinct from 'midtrans' then raise exception 'Pembayaran Midtrans tidak ditemukan'; end if;
  select gateway_order_id into oid from public.pro_gateway_percobaan where payment_id = d.id;
  if oid is null then select kode into oid from public.pro_pesanan_tamu where payment_id = d.id; end if;
  if oid is null then raise exception 'Percobaan pembayaran untuk dana ini tidak ditemukan'; end if;
  select d.amount - coalesce(sum(amount), 0), count(*) + 1 into sisa, ke from public.pro_payments where refund_of = d.id and kind = 'refund';
  if p_nominal is null or p_nominal <= 0 or p_nominal > sisa then raise exception 'Nominal refund harus 1 sampai %', sisa; end if;
  kunci := 'RF-' || d.id || '-N' || ke;
  perform public._audit('gateway_refund_diminta', d.id, d.order_id, null, jsonb_build_object('refund_key', kunci, 'nominal', p_nominal), trim(p_alasan));
  return jsonb_build_object('gateway_order_id', oid, 'refund_key', kunci, 'nominal', p_nominal, 'alasan', left(trim(p_alasan), 200));
end $$;

-- 9. Hak eksekusi.
do $$
declare f text;
begin
  foreach f in array array['tamu_buat_pesanan(text, text, text, text)', 'tamu_simpan_snap(text, bigint, jsonb)', 'tamu_perlu_email(text, text)',
      'tamu_catat_email(text, bigint, boolean, text)', 'tamu_status(text, text, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['klaim_pembelian_tamu()', 'admin_refund_gateway_siapkan(bigint, integer, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
