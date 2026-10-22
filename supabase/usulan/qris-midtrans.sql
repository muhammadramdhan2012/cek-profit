-- ============================================================================================================
-- USULAN — PEMBAYARAN OTOMATIS QRIS DINAMIS (MIDTRANS CORE API). BELUM DIJALANKAN DI STAGING MAUPUN PRODUKSI.
-- Urutan: schema.sql → usulan/pro-sekali-bayar.sql → usulan/hardening-fungsi.sql → FILE INI. Aman dijalankan ulang.
-- Rancangan: dokumen "Desain Pembayaran Otomatis QRIS Dinamis — Cek Untung Pro" + docs/usulan/QRIS_MIDTRANS.md.
--
-- Prinsip:
--  * Dipakai ulang: upgrade_requests (pesanan), pro_payments (buku besar), _aktifkan_dari_pesanan, pro_order_events,
--    pro_audit_log. Alur manual lama TIDAK dihapus (fallback internal admin).
--  * Pro hanya aktif dari gateway_terapkan_status, yang hanya menerima status hasil Get Status Midtrans dari Edge Function.
--  * TANPA service_role: Edge Function memanggil fungsi gateway_* dengan anon key + RAHASIA GATEWAY. Database hanya
--    menyimpan hash SHA-256 rahasia itu (tabel tanpa hak akses API). Fungsi pembeli memakai JWT pembeli sendiri.
--  * Idempoten: satu transaction_id = satu baris dana (indeks unik yang sudah ada); satu refund_key = satu baris refund;
--    aktivasi dalam satu transaksi dengan baris pesanan & profil terkunci.
-- ============================================================================================================

-- 1. Pengaturan: mode pembayaran pembeli + masa berlaku QR.
alter table public.pengaturan_pembayaran add column if not exists mode text not null default 'manual';
alter table public.pengaturan_pembayaran add column if not exists qr_berlaku_menit integer not null default 15;
alter table public.pengaturan_pembayaran drop constraint if exists pengaturan_mode_check;
alter table public.pengaturan_pembayaran add constraint pengaturan_mode_check check (mode in ('manual', 'otomatis'));
alter table public.pengaturan_pembayaran drop constraint if exists pengaturan_qr_menit_check;
alter table public.pengaturan_pembayaran add constraint pengaturan_qr_menit_check check (qr_berlaku_menit between 5 and 60);
-- Mode otomatis tidak butuh rekening/QRIS statis; kontak bantuan tetap wajib.
alter table public.pengaturan_pembayaran drop constraint if exists pengaturan_siap;
alter table public.pengaturan_pembayaran add constraint pengaturan_siap check (not aktif or (kontak_bantuan <> '' and (mode = 'otomatis'
  or (bank_nama <> '' and bank_nomor <> '' and bank_pemilik <> '') or (qris_merchant <> '' and qris_gambar <> ''))));
grant update (mode, qr_berlaku_menit) on public.pengaturan_pembayaran to authenticated;   -- dibatasi policy: hanya admin

-- 2. Buku besar: sumber 'midtrans'; satu refund_key Midtrans = satu baris refund.
alter table public.pro_payments drop constraint if exists pro_payments_sumber_check;
alter table public.pro_payments add constraint pro_payments_sumber_check check (sumber is null or sumber in ('transfer', 'qris', 'midtrans'));
create unique index if not exists pro_payments_refund_ref on public.pro_payments (sumber, reference_norm) where kind = 'refund' and sumber is not null;

-- 3. Rahasia gateway: HANYA hash SHA-256 (hex). Tanpa hak akses untuk anon/authenticated.
create table if not exists public.gateway_rahasia (
  id          smallint primary key default 1 check (id = 1),
  hash        text not null check (hash ~ '^[0-9a-f]{64}$'),
  diubah_pada timestamptz not null default now()
);
alter table public.gateway_rahasia enable row level security;
revoke all on public.gateway_rahasia from public, anon, authenticated;

create or replace function public._rahasia_gateway_sah(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select length(coalesce(p, '')) >= 32
     and exists (select 1 from public.gateway_rahasia where hash = encode(sha256(convert_to(p, 'UTF8')), 'hex'));
$$;
revoke all on function public._rahasia_gateway_sah(text) from public, anon, authenticated;

-- 4. Percobaan bayar: satu baris per QR yang dibuat. Pesanan tetap di upgrade_requests.
create table if not exists public.pro_gateway_percobaan (
  id               bigint generated always as identity primary key,
  order_id         bigint not null references public.upgrade_requests (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  provider         text not null default 'midtrans' check (provider = 'midtrans'),
  gateway_order_id text not null unique check (length(gateway_order_id) between 3 and 50),
  gateway_txn_id   text check (gateway_txn_id is null or length(gateway_txn_id) <= 100),
  amount           integer not null check (amount > 0),
  status           text not null default 'dibuat' check (status in
                     ('dibuat', 'menunggu', 'lunas', 'kedaluwarsa', 'batal', 'gagal', 'perlu_cek', 'refund_sebagian', 'direfund')),
  qr_url           text check (qr_url is null or (qr_url ~ '^https?://' and length(qr_url) <= 500)),
  qr_string        text check (qr_string is null or length(qr_string) <= 1000),
  berlaku_sampai   timestamptz not null,
  payment_id       bigint references public.pro_payments (id) on delete set null,
  jumlah_diterima  numeric,
  pesan            text not null default '' check (length(pesan) <= 300),
  dicek_pada       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Satu QR terbuka per pesanan: QR baru hanya dibuat setelah QR lama selesai/kedaluwarsa (tanpa tagihan ganda).
alter table public.pro_gateway_percobaan add column if not exists jumlah_diterima numeric;   -- nominal yang dilaporkan Midtrans
create unique index if not exists pro_gateway_satu_terbuka on public.pro_gateway_percobaan (order_id) where status in ('dibuat', 'menunggu');
create index if not exists pro_gateway_percobaan_order on public.pro_gateway_percobaan (order_id, id desc);
alter table public.pro_gateway_percobaan enable row level security;
drop policy if exists "percobaan: baca sendiri atau admin" on public.pro_gateway_percobaan;
create policy "percobaan: baca sendiri atau admin" on public.pro_gateway_percobaan for select using (user_id = auth.uid() or public.is_admin());
revoke all on public.pro_gateway_percobaan from public, anon, authenticated;
grant select on public.pro_gateway_percobaan to authenticated;

-- 5. Pesanan: pada mode otomatis pembeli hanya bisa memesan QRIS dinamis (rekening/QRIS statis tidak ditawarkan).
--    Sama dengan versi pro-sekali-bayar.sql, ditambah cabang mode. Pesanan yang masih punya QR berjalan tidak dikedaluwarsakan.
create or replace function public.buat_pesanan_pro(p_metode text)
returns public.upgrade_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.pengaturan_pembayaran; r public.upgrade_requests; kode text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  select * into s from public.pengaturan_pembayaran where id = 1;
  if s is null or not s.aktif then raise exception 'Pembelian Pro belum dibuka'; end if;
  if s.mode = 'otomatis' then
    if p_metode is distinct from 'qris' then raise exception 'Metode pembayaran tidak tersedia'; end if;
  elsif p_metode is null or p_metode not in ('transfer', 'qris')
     or (p_metode = 'transfer' and not (s.bank_nama <> '' and s.bank_nomor <> '' and s.bank_pemilik <> ''))
     or (p_metode = 'qris' and not (s.qris_merchant <> '' and s.qris_gambar <> '')) then
    raise exception 'Metode pembayaran tidak tersedia';
  end if;
  perform 1 from public.profiles where id = uid for update;   -- serialisasi permintaan bersamaan dari akun yang sama
  if exists (select 1 from public.profiles where id = uid and pro_sekali_bayar) then raise exception 'Akun Anda sudah Pro'; end if;
  for r in select * from public.upgrade_requests u where u.user_id = uid and u.plan = 'pro_sekali' and u.status = 'baru'
           and u.created_at < now() - make_interval(hours => s.batas_jam)
           and not exists (select 1 from public.pro_gateway_percobaan g where g.order_id = u.id and g.status in ('dibuat', 'menunggu'))
           for update loop
    update public.upgrade_requests set status = 'dibatalkan', expired_at = now(), updated_at = now() where id = r.id;
    perform public._catat_event(r.id, 'baru', 'dibatalkan', 'Kedaluwarsa: belum dibayar dalam batas waktu');
  end loop;
  select * into r from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' and status in ('baru', 'diproses', 'perlu_cek') for update;
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

-- 6. PEMBELI (JWT sendiri): siapkan percobaan bayar. Mengembalikan QR yang masih berlaku bila ada (tanpa tagihan ganda).
--    aksi: 'selesai' (sudah Pro) | 'pakai' (QR berjalan) | 'cek' (QR lama lewat waktu: Edge Function wajib cek status
--    di Midtrans dulu) | 'baru' (baris baru berstatus 'dibuat'; Edge Function lalu membuat charge di Midtrans).
create or replace function public.gateway_mulai_percobaan(p_order bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.pengaturan_pembayaran; r public.upgrade_requests; g public.pro_gateway_percobaan; n integer; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  select * into s from public.pengaturan_pembayaran where id = 1;
  if s is null or not s.aktif or s.mode <> 'otomatis' then raise exception 'Pembayaran otomatis belum dibuka'; end if;
  select * into r from public.upgrade_requests where id = p_order and user_id = uid and plan = 'pro_sekali' for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if r.status = 'selesai' or exists (select 1 from public.profiles where id = uid and pro_sekali_bayar) then
    return jsonb_build_object('aksi', 'selesai', 'pesanan_status', r.status);
  end if;
  select * into g from public.pro_gateway_percobaan where order_id = r.id and status in ('dibuat', 'menunggu') for update;
  if found then
    return jsonb_build_object('aksi', case when g.berlaku_sampai > now() + interval '20 seconds' then 'pakai' else 'cek' end,
                              'percobaan', to_jsonb(g), 'qr_menit', s.qr_berlaku_menit);
  end if;
  if r.status not in ('baru', 'diproses', 'perlu_cek') then raise exception 'Pesanan ini sudah tidak aktif. Buat pesanan baru'; end if;
  if r.created_at < now() - make_interval(hours => s.batas_jam) then raise exception 'Pesanan sudah melewati batas waktu. Buat pesanan baru'; end if;
  select count(*) + 1 into n from public.pro_gateway_percobaan where order_id = r.id;
  if n > 20 then raise exception 'Terlalu banyak percobaan pembayaran untuk pesanan ini. Hubungi bantuan'; end if;
  insert into public.pro_gateway_percobaan (order_id, user_id, gateway_order_id, amount, berlaku_sampai)
    values (r.id, uid, r.order_code || '-' || n, r.amount, now() + make_interval(mins => s.qr_berlaku_menit)) returning * into g;
  return jsonb_build_object('aksi', 'baru', 'percobaan', to_jsonb(g), 'qr_menit', s.qr_berlaku_menit);
end $$;

-- 7. EDGE FUNCTION (rahasia gateway): simpan hasil pembuatan QR. Hanya mengubah percobaan berstatus 'dibuat'.
--    p_hasil: {ok, gateway_txn_id, qr_url, qr_string, pesan}
create or replace function public.gateway_simpan_qr(p_rahasia text, p_percobaan bigint, p_hasil jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.pro_gateway_percobaan;
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  select * into g from public.pro_gateway_percobaan where id = p_percobaan for update;
  if not found then raise exception 'Percobaan tidak ditemukan'; end if;
  -- Notifikasi "pending" bisa tiba lebih dulu dan mengubah status ke 'menunggu' tanpa QR; QR tetap dilengkapi di sini.
  if g.status not in ('dibuat', 'menunggu') or (g.status = 'menunggu' and g.qr_url is not null) then return to_jsonb(g); end if;
  if coalesce((p_hasil ->> 'ok')::boolean, false) and coalesce(p_hasil ->> 'gateway_txn_id', '') <> '' then
    update public.pro_gateway_percobaan set status = 'menunggu', gateway_txn_id = coalesce(gateway_txn_id, p_hasil ->> 'gateway_txn_id'),
      qr_url = nullif(p_hasil ->> 'qr_url', ''), qr_string = nullif(p_hasil ->> 'qr_string', ''), updated_at = now()
      where id = g.id returning * into g;
  elsif g.status = 'menunggu' then
    return to_jsonb(g);
  else
    update public.pro_gateway_percobaan set status = 'gagal', pesan = left(coalesce(p_hasil ->> 'pesan', 'QR gagal dibuat'), 300), updated_at = now()
      where id = g.id returning * into g;
  end if;
  return to_jsonb(g);
end $$;

-- 8. EDGE FUNCTION (rahasia gateway): terapkan status HASIL GET STATUS MIDTRANS. Satu-satunya jalan aktivasi otomatis.
--    p_status (ringkas): order_id, transaction_id, transaction_status, status_code, gross_amount, currency, fraud_status,
--    refunds[] {refund_key, refund_amount}. Aman dipanggil berulang/bersamaan.
create or replace function public.gateway_terapkan_status(p_rahasia text, p_status jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.pro_gateway_percobaan; r public.upgrade_requests; ts text := lower(coalesce(p_status ->> 'transaction_status', ''));
  txn text := coalesce(p_status ->> 'transaction_id', ''); gross numeric; pid bigint; sah boolean; hasil text := 'tidak_berubah';
  f jsonb; kunci text; jml numeric; bersih bigint; refund_pembayaran bigint;
begin
  if not public._rahasia_gateway_sah(p_rahasia) then raise exception 'Akses ditolak'; end if;
  select * into g from public.pro_gateway_percobaan where gateway_order_id = p_status ->> 'order_id' for update;
  if not found then
    -- Bukan percobaan anggota: mungkin pesanan checkout tamu (usulan/checkout-tamu.sql, bila sudah terpasang).
    if to_regprocedure('public._tamu_terapkan_status(jsonb)') is not null then
      hasil := public._tamu_terapkan_status(p_status);
      if hasil is not null then return hasil; end if;
    end if;
    perform public._audit('gateway_tidak_dikenal', null, null, null,
      jsonb_build_object('order_id', left(p_status ->> 'order_id', 60), 'status', ts), 'Status Midtrans untuk percobaan yang tidak dikenal');
    return 'tidak_dikenal';
  end if;
  select * into r from public.upgrade_requests where id = g.order_id for update;
  update public.pro_gateway_percobaan set dicek_pada = now() where id = g.id;

  if ts in ('settlement', 'capture', 'refund', 'partial_refund') then
    -- (a) Dana tercatat sekali per transaction_id, HANYA bila sah (nominal, mata uang, fraud) dan transaction_id belum
    --     dipakai pesanan lain. Selain itu tidak masuk buku besar: dicatat di percobaan (perlu_cek) + audit untuk investigasi.
    if g.payment_id is null then
      if length(txn) < 3 then raise exception 'transaction_id kosong'; end if;
      gross := (p_status ->> 'gross_amount')::numeric;
      sah := gross = g.amount and gross = r.amount and upper(coalesce(p_status ->> 'currency', 'IDR')) = 'IDR'
             and lower(coalesce(p_status ->> 'fraud_status', 'accept')) = 'accept' and gross = trunc(gross);
      if not sah then
        update public.pro_gateway_percobaan set status = 'perlu_cek', gateway_txn_id = txn, jumlah_diterima = gross,
          pesan = 'Nominal/mata uang/fraud status tidak cocok; tidak dicatat sebagai pembayaran', updated_at = now() where id = g.id;
        if r.status in ('baru', 'diproses') then
          update public.upgrade_requests set status = 'perlu_cek', updated_at = now() where id = r.id;
          perform public._catat_event(r.id, r.status, 'perlu_cek', 'Pembayaran sedang diperiksa manual');
        end if;
        perform public._audit('gateway_nominal_tidak_cocok', null, r.id, null,
          jsonb_build_object('transaction_id', txn, 'gross_amount', gross, 'tagihan', r.amount, 'currency', p_status ->> 'currency', 'fraud_status', p_status ->> 'fraud_status'), g.gateway_order_id);
        return 'perlu_cek';
      end if;
      insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, dihubungkan_pada)
        values (r.id, r.user_id, 'pembayaran', 'midtrans', txn, gross::integer, 'QRIS Midtrans ' || g.gateway_order_id, now())
        on conflict (sumber, reference_norm) where kind = 'pembayaran' do nothing returning id into pid;
      if pid is null then
        -- transaction_id sudah tercatat: hanya boleh dipakai bila milik pesanan & akun yang sama.
        select id into pid from public.pro_payments where kind = 'pembayaran' and sumber = 'midtrans' and reference_norm = public._norm_ref(txn)
          and order_id = r.id and user_id = r.user_id;
        if pid is null then
          update public.pro_gateway_percobaan set status = 'perlu_cek', pesan = 'transaction_id sudah tercatat untuk pesanan lain', updated_at = now() where id = g.id;
          perform public._audit('gateway_transaksi_bentrok', null, r.id, null, jsonb_build_object('transaction_id', txn), g.gateway_order_id);
          return 'perlu_cek';
        end if;
      end if;
      update public.pro_gateway_percobaan set payment_id = pid, gateway_txn_id = txn, jumlah_diterima = gross, updated_at = now() where id = g.id;
      g.payment_id := pid;
      if r.status in ('baru', 'diproses', 'perlu_cek', 'dibatalkan')
            and not exists (select 1 from public.profiles where id = r.user_id and pro_sekali_bayar) then
        hasil := public._aktifkan_dari_pesanan(r, pid, gross::integer, 'Pembayaran QRIS terverifikasi Midtrans (' || txn || ')');
        update public.pro_gateway_percobaan set status = 'lunas', updated_at = now() where id = g.id;
        select * into r from public.upgrade_requests where id = r.id;
      else
        -- Pesanan sudah aktif dari pembayaran lain / akun sudah Pro / pesanan ditolak: dana tercatat, admin merefund.
        update public.pro_gateway_percobaan set status = 'lunas', pesan = 'Pembayaran ganda: perlu refund', updated_at = now() where id = g.id;
        perform public._catat_event(r.id, r.status, r.status, 'Pembayaran QRIS tambahan ' || txn || ' tercatat; perlu refund', true);
        perform public._audit('gateway_pembayaran_ganda', pid, r.id, null, jsonb_build_object('transaction_id', txn), g.gateway_order_id);
        hasil := 'pembayaran_ganda';
      end if;
    end if;

    -- (b) Refund dari Midtrans: satu baris per refund_key; Pro dicabut hanya bila seluruh dana pesanan sudah kembali.
    for f in select * from jsonb_array_elements(case when jsonb_typeof(p_status -> 'refunds') = 'array' then p_status -> 'refunds' else '[]'::jsonb end) loop
      -- Refund dari dasbor Midtrans tanpa refund_key tetap tercatat: kunci cadangan = transaction_id + nomor refund.
      kunci := coalesce(nullif(f ->> 'refund_key', ''), case when f ->> 'refund_chargeback_id' is not null then txn || '-CB' || (f ->> 'refund_chargeback_id') end);
      jml := (f ->> 'refund_amount')::numeric;
      continue when kunci is null or length(public._norm_ref(kunci)) < 3 or jml is null or jml <= 0;
      insert into public.pro_payments (order_id, user_id, kind, sumber, reference, amount, note, refund_of)
        values (r.id, r.user_id, 'refund', 'midtrans', kunci, jml::integer, 'Refund QRIS Midtrans ' || g.gateway_order_id, g.payment_id)
        on conflict (sumber, reference_norm) where kind = 'refund' and sumber is not null do nothing returning id into refund_pembayaran;
      if refund_pembayaran is not null then
        perform public._catat_event(r.id, r.status, r.status, 'Refund QRIS ' || jml::integer || ' tercatat');
        hasil := 'refund';
      end if;
    end loop;
    if g.payment_id is not null and exists (select 1 from public.pro_payments where refund_of = g.payment_id and kind = 'refund') then
      update public.pro_gateway_percobaan set status = case when
          (select coalesce(sum(amount), 0) from public.pro_payments where refund_of = g.payment_id and kind = 'refund')
          >= (select amount from public.pro_payments where id = g.payment_id) then 'direfund' else 'refund_sebagian' end,
        updated_at = now() where id = g.id;
      select coalesce(sum(case when p.kind = 'pembayaran' then p.amount else -p.amount end), 0) into bersih
        from public.pro_payments p where p.order_id = r.id and p.kind in ('pembayaran', 'refund');
      if bersih <= 0 and r.status = 'selesai' then
        perform 1 from public.profiles where id = r.user_id for update;
        update public.profiles set pro_sekali_bayar = false where id = r.user_id;
        update public.upgrade_requests set status = 'direfund', updated_at = now() where id = r.id;
        perform public._catat_event(r.id, 'selesai', 'direfund', 'Seluruh dana dikembalikan lewat Midtrans; Pro dicabut');
        hasil := 'direfund';
      end if;
    end if;
    return hasil;
  end if;

  -- Status tanpa dana: hanya untuk percobaan yang belum lunas (status tidak pernah mundur dari lunas/refund).
  if g.status in ('lunas', 'refund_sebagian', 'direfund', 'perlu_cek') then return 'tidak_berubah'; end if;
  if ts = 'pending' and g.status in ('dibuat', 'gagal') then
    update public.pro_gateway_percobaan set status = 'menunggu', gateway_txn_id = coalesce(nullif(txn, ''), gateway_txn_id), updated_at = now() where id = g.id;
    return 'menunggu';
  elsif ts = 'expire' and g.status in ('dibuat', 'menunggu', 'gagal') then
    update public.pro_gateway_percobaan set status = 'kedaluwarsa', updated_at = now() where id = g.id; return 'kedaluwarsa';
  elsif ts = 'cancel' and g.status in ('dibuat', 'menunggu', 'gagal') then
    update public.pro_gateway_percobaan set status = 'batal', updated_at = now() where id = g.id; return 'batal';
  elsif ts in ('deny', 'failure') and g.status in ('dibuat', 'menunggu') then
    update public.pro_gateway_percobaan set status = 'gagal', pesan = 'Ditolak penyedia pembayaran', updated_at = now() where id = g.id; return 'gagal';
  end if;
  return 'tidak_berubah';
end $$;

-- 9. PEMBELI (JWT sendiri): status pesanan + percobaan terakhir, untuk halaman checkout.
create or replace function public.gateway_percobaan_saya(p_order bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when r.id is null then null else jsonb_build_object(
    'pesanan', jsonb_build_object('id', r.id, 'order_code', r.order_code, 'status', r.status, 'amount', r.amount),
    'pro', coalesce((select pro_sekali_bayar from public.profiles where id = r.user_id), false),
    'percobaan', (select to_jsonb(g) - 'payment_id' from public.pro_gateway_percobaan g where g.order_id = r.id order by g.id desc limit 1)) end
  from (select * from public.upgrade_requests where id = p_order and user_id = auth.uid() and plan = 'pro_sekali') r;
$$;

-- 10. ADMIN (JWT admin): siapkan refund lewat Midtrans. Kunci refund deterministik → mengulang tidak membuat refund baru.
create or replace function public.admin_refund_gateway_siapkan(p_payment bigint, p_nominal integer, p_alasan text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.pro_payments; g public.pro_gateway_percobaan; sisa integer; ke integer; kunci text;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if length(trim(coalesce(p_alasan, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into d from public.pro_payments where id = p_payment for update;
  if not found or d.kind <> 'pembayaran' or d.sumber is distinct from 'midtrans' then raise exception 'Pembayaran Midtrans tidak ditemukan'; end if;
  select * into g from public.pro_gateway_percobaan where payment_id = d.id;
  if not found then raise exception 'Percobaan pembayaran untuk dana ini tidak ditemukan'; end if;
  select d.amount - coalesce(sum(amount), 0), count(*) + 1 into sisa, ke from public.pro_payments where refund_of = d.id and kind = 'refund';
  if p_nominal is null or p_nominal <= 0 or p_nominal > sisa then raise exception 'Nominal refund harus 1 sampai %', sisa; end if;
  -- Huruf pemisah agar tidak bertabrakan setelah normalisasi referensi (RF-5-11 dan RF-51-1 sama-sama menjadi RF511).
  kunci := 'RF-' || d.id || '-N' || ke;
  perform public._audit('gateway_refund_diminta', d.id, d.order_id, null,
    jsonb_build_object('refund_key', kunci, 'nominal', p_nominal), trim(p_alasan));
  return jsonb_build_object('gateway_order_id', g.gateway_order_id, 'refund_key', kunci, 'nominal', p_nominal, 'alasan', left(trim(p_alasan), 200));
end $$;

-- 11. Hak eksekusi. Fungsi dengan rahasia gateway boleh dipanggil anon (Edge Function memakai anon key), dan menolak
--     siapa pun tanpa rahasia. Fungsi pembeli/admin hanya untuk pengguna login.
do $$
declare f text;
begin
  foreach f in array array['gateway_simpan_qr(text, bigint, jsonb)', 'gateway_terapkan_status(text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['gateway_mulai_percobaan(bigint)', 'gateway_percobaan_saya(bigint)',
      'admin_refund_gateway_siapkan(bigint, integer, text)', 'buat_pesanan_pro(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
