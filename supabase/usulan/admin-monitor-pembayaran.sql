-- ============================================================================================================
-- USULAN — MONITOR PEMBAYARAN ADMIN v1 (baca saja). BELUM DIJALANKAN DI STAGING MAUPUN PRODUKSI.
-- Urutan: … → usulan/qris-midtrans.sql → usulan/checkout-tamu.sql → FILE INI. Aman dijalankan ulang.
--
-- Satu daftar pembayaran Midtrans untuk pengguna login (pro_gateway_percobaan) dan tamu (pro_pesanan_tamu), lengkap
-- dengan tanda yang dihitung DATABASE: perlu_cek, ganda, refund, belum_diklaim. Fungsi ini hanya membaca: tidak ada
-- kemampuan baru untuk mencatat dana atau mengaktifkan Pro. Hanya admin (is_admin() dari login) yang mendapat data.
-- ============================================================================================================

create or replace function public.admin_monitor_pembayaran(p_batas integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare hasil jsonb;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  with
  refund as (
    select refund_of, sum(amount)::bigint as total from public.pro_payments where kind = 'refund' and refund_of is not null group by refund_of
  ),
  login as (
    select 'login' as jenis, g.gateway_order_id as kode, u.order_code as pesanan, pr.email as akun, null::text as nama,
      g.amount, g.status, u.status as status_pesanan, null::text as klaim, null::text as email_status,
      g.gateway_txn_id as referensi, g.payment_id, coalesce(rf.total, 0) as refund, g.pesan, g.created_at, g.updated_at,
      array_remove(array[
        case when g.status = 'perlu_cek' or u.status = 'perlu_cek' then 'perlu_cek' end,
        case when g.pesan like 'Pembayaran ganda%' then 'ganda' end,
        case when coalesce(rf.total, 0) > 0 or g.status in ('refund_sebagian', 'direfund') then 'refund' end], null) as tanda
    from public.pro_gateway_percobaan g
    join public.upgrade_requests u on u.id = g.order_id
    left join public.profiles pr on pr.id = g.user_id
    left join refund rf on rf.refund_of = g.payment_id
  ),
  tamu as (
    select 'tamu', t.kode, u.order_code, coalesce(pk.email, t.email), t.nama,
      t.amount, t.status, u.status, case when t.diklaim_oleh is not null then 'diklaim' when t.payment_id is not null then 'belum' end,
      t.email_status, t.gateway_txn_id, t.payment_id, coalesce(rf.total, 0), t.pesan, t.created_at, t.updated_at,
      array_remove(array[
        case when t.status = 'perlu_cek' then 'perlu_cek' end,
        case when t.pesan like 'Akun sudah Pro%' then 'ganda' end,
        case when coalesce(rf.total, 0) > 0 or t.status in ('refund_sebagian', 'direfund') then 'refund' end,
        case when t.payment_id is not null and t.diklaim_oleh is null and t.status in ('lunas', 'refund_sebagian') then 'belum_diklaim' end], null)
    from public.pro_pesanan_tamu t
    left join public.upgrade_requests u on u.id = t.order_id
    left join public.profiles pk on pk.id = t.diklaim_oleh
    left join refund rf on rf.refund_of = t.payment_id
  ),
  semua as (select * from login union all select * from tamu)
  select coalesce(jsonb_agg(to_jsonb(x) order by cardinality(x.tanda) > 0 desc, x.created_at desc), '[]'::jsonb) into hasil
  from (select * from semua
        -- Percobaan tanpa dana yang sudah berakhir hanya mengotori daftar; yang terbuka/berdana/bertanda tetap tampil.
        where payment_id is not null or status in ('dibuat', 'menunggu', 'perlu_cek') or cardinality(tanda) > 0
        order by cardinality(tanda) > 0 desc, created_at desc
        limit greatest(1, least(coalesce(p_batas, 200), 500))) x;
  return hasil;
end $$;
revoke all on function public.admin_monitor_pembayaran(integer) from public, anon;
grant execute on function public.admin_monitor_pembayaran(integer) to authenticated;   -- ditolak di dalam bila bukan admin
