-- Uji lokal usulan/qris-midtrans.sql (PostgreSQL + supabase/tests/shim-tanpa-ekspos.sql). Data SINTETIS.
-- Urutan: shim-tanpa-ekspos.sql → schema.sql → usulan/pro-sekali-bayar.sql → usulan/hardening-fungsi.sql →
--         usulan/qris-midtrans.sql (2x) → file ini. Setiap baris hasil harus berakhir |t.
-- Status "Midtrans" di sini disusun tangan seperti hasil Get Status; alur Edge Function diuji di tests/e2e/qris-e2e.mjs.
\set ON_ERROR_STOP 0
\set R '''RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR'''
insert into public.gateway_rahasia (id, hash) values (1, encode(sha256(convert_to('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'UTF8')), 'hex'))
  on conflict (id) do update set hash = excluded.hash;
insert into auth.users (id, email, raw_user_meta_data) values
 ('a2000000-0000-0000-0000-0000000000a2','a@q.id','{}'), ('b2000000-0000-0000-0000-0000000000b2','b@q.id','{}'),
 ('c2000000-0000-0000-0000-0000000000c2','c@q.id','{}'), ('d2000000-0000-0000-0000-0000000000d2','d@q.id','{}'),
 ('e2000000-0000-0000-0000-0000000000e2','e@q.id','{}'), ('f2000000-0000-0000-0000-0000000000f2','admin@q.id','{}');
update public.profiles set is_admin = true where email = 'admin@q.id';
create or replace function pg_temp.sebagai(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
create or replace function pg_temp.coba(q text) returns text language plpgsql as $$ begin execute q; return 'LOLOS'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.st(oid text, ts text, txn text, gross text default '149000.00', ekstra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('order_id', oid, 'transaction_status', ts, 'transaction_id', txn, 'gross_amount', gross, 'currency', 'IDR',
    'fraud_status', 'accept', 'status_code', case ts when 'pending' then '201' else '200' end) || ekstra $$;
create or replace function pg_temp.pesanan(uid text) returns public.upgrade_requests language sql as $$
  select * from public.upgrade_requests where user_id = uid::uuid and plan = 'pro_sekali' order by id desc limit 1 $$;
create or replace function pg_temp.coba_terapkan(oid text, ts text, txn text) returns text language plpgsql as $$
  begin return public.gateway_terapkan_status('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', pg_temp.st(oid, ts, txn)); exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.sebagai(text), pg_temp.coba(text), pg_temp.st(text, text, text, text, jsonb), pg_temp.coba_terapkan(text, text, text) to anon, authenticated;

-- ---------- pengaturan ----------
set role authenticated; select pg_temp.sebagai('f2000000-0000-0000-0000-0000000000f2');
select 'Q1 mode otomatis tanpa kontak bantuan ditolak' t, pg_temp.coba($$update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis'$$) like '%pengaturan_siap%' ok;
update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis', kontak_bantuan = 'bantuan@contoh.invalid';
select pg_temp.sebagai('a2000000-0000-0000-0000-0000000000a2');
select 'Q2 seller tidak bisa mengubah mode/masa QR' t, (select count(*) from public.pengaturan_pembayaran) = 1
  and pg_temp.coba($$update public.pengaturan_pembayaran set mode = 'manual', qr_berlaku_menit = 60$$) = 'LOLOS'
  and (select mode = 'otomatis' and qr_berlaku_menit = 15 from public.pengaturan_pembayaran) ok;

-- ---------- pesanan & percobaan ----------
select 'Q3 mode otomatis: pesanan transfer ditolak, QRIS diterima tanpa QRIS statis' t,
  pg_temp.coba($$select public.buat_pesanan_pro('transfer')$$) = 'Metode pembayaran tidak tersedia' and pg_temp.coba($$select public.buat_pesanan_pro('qris')$$) = 'LOLOS' ok;
create temp table m1 as select public.gateway_mulai_percobaan((pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).id) j;
create temp table m2 as select public.gateway_mulai_percobaan((pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).id) j;
grant select on m1, m2 to public;   -- dibaca peran anon (Edge Function) di bawah
select 'Q4 percobaan baru: nominal 149000 dari server, berlaku 15 menit; panggilan kedua memakai QR yang sama' t,
  (select j->>'aksi' = 'baru' and (j->'percobaan'->>'amount')::int = 149000 and j->'percobaan'->>'gateway_order_id' = (pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).order_code || '-1'
     and (j->'percobaan'->>'berlaku_sampai')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes' from m1)
  and (select j->>'aksi' = 'pakai' and j->'percobaan'->>'id' = (select j->'percobaan'->>'id' from m1) from m2)
  and (select count(*) from public.pro_gateway_percobaan) = 1 ok;
select pg_temp.sebagai('b2000000-0000-0000-0000-0000000000b2');
select 'Q5 seller B tidak bisa memakai pesanan A, membaca percobaan A, atau menulis percobaan' t,
  pg_temp.coba(format('select public.gateway_mulai_percobaan(%s)', (select (j->'percobaan'->>'order_id') from m1))) = 'Pesanan tidak ditemukan'
  and (select count(*) from public.pro_gateway_percobaan) = 0
  and pg_temp.coba($$update public.pro_gateway_percobaan set status = 'lunas'$$) like 'permission denied%'
  and public.gateway_percobaan_saya((select (j->'percobaan'->>'order_id')::bigint from m1)) is null ok;
select 'Q6 tanpa/salah rahasia: simpan & terapkan ditolak; tabel & cek rahasia tidak terjangkau' t,
  pg_temp.coba($$select public.gateway_terapkan_status('salah-salah-salah-salah-salah-salah-1', '{}')$$) = 'Akses ditolak'
  and pg_temp.coba($$select public.gateway_simpan_qr('', 1, '{"ok":true}')$$) = 'Akses ditolak'
  and pg_temp.coba($$select * from public.gateway_rahasia$$) like 'permission denied%'
  and pg_temp.coba($$select public._rahasia_gateway_sah('x')$$) like 'permission denied%' ok;
reset role; set role anon;
select 'Q7 anon tanpa rahasia ditolak; anon tidak bisa membuat percobaan' t,
  pg_temp.coba($$select public.gateway_terapkan_status('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRX', '{}')$$) = 'Akses ditolak'
  and pg_temp.coba($$select public.gateway_mulai_percobaan(1)$$) like 'permission denied%' ok;
-- Edge Function: simpan QR (anon key + rahasia)
select public.gateway_simpan_qr(:R, (select (j->'percobaan'->>'id')::bigint from m1), '{"ok":true,"gateway_txn_id":"TXN-A1","qr_url":"https://api.sandbox.midtrans.com/v2/qris/TXN-A1/qr-code","qr_string":"000201"}');
reset role;
select 'Q8 QR tersimpan: status menunggu, Pro belum aktif' t, (select status = 'menunggu' and qr_url like 'https://%' from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-A1')
  and not (select pro_sekali_bayar from public.profiles where email = 'a@q.id') ok;

-- ---------- notifikasi / Get Status ----------
set role anon;
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'pending', 'TXN-A1'));
reset role;
select 'Q9 pending tidak mengaktifkan Pro' t, not (select pro_sekali_bayar from public.profiles where email = 'a@q.id')
  and (select count(*) from public.pro_payments where sumber = 'midtrans') = 0 ok;
set role anon;
create temp table h1 as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'settlement', 'TXN-A1')) h;
create temp table h2 as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'settlement', 'TXN-A1')) h
  union all select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'settlement', 'TXN-A1'));
create temp table h3 as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'expire', 'TXN-A1')) h;
reset role;
select 'Q10 settlement sah → Pro aktif, pesanan selesai, 1 baris dana midtrans 149000' t, (select h = 'aktif' from h1)
  and (select pro_sekali_bayar from public.profiles where email = 'a@q.id') and (pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).status = 'selesai'
  and (select count(*) = 1 and sum(amount) = 149000 from public.pro_payments where sumber = 'midtrans' and kind = 'pembayaran')
  and (select status = 'lunas' and payment_id is not null from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-A1') ok;
select 'Q11 notifikasi ganda & status lama (expire) setelah lunas: tidak ada efek' t, (select bool_and(h = 'tidak_berubah') from h2) and (select h = 'tidak_berubah' from h3)
  and (select count(*) from public.pro_payments where sumber = 'midtrans') = 1
  and (select status from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-A1') = 'lunas'
  and (select count(*) from public.pro_order_events e where e.order_id = (pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).id and e.status_baru = 'selesai') = 1 ok;
select pg_temp.sebagai('a2000000-0000-0000-0000-0000000000a2');
select 'Q12 pesanan selesai: tidak ada percobaan baru' t,
  (select public.gateway_mulai_percobaan((pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).id) ->> 'aksi') = 'selesai' ok;

-- nominal tidak cocok (seller C)
set role authenticated; select pg_temp.sebagai('c2000000-0000-0000-0000-0000000000c2');
select public.buat_pesanan_pro('qris');
create temp table mc as select public.gateway_mulai_percobaan((pg_temp.pesanan('c2000000-0000-0000-0000-0000000000c2')).id) j;
reset role;
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from mc), 'settlement', 'TXN-C1', '1000.00'));
select 'Q13 nominal tidak cocok → perlu_cek, Pro TIDAK aktif, TIDAK masuk buku besar, tercatat di percobaan + audit' t,
  not (select pro_sekali_bayar from public.profiles where email = 'c@q.id') and (pg_temp.pesanan('c2000000-0000-0000-0000-0000000000c2')).status = 'perlu_cek'
  and (select status = 'perlu_cek' and jumlah_diterima = 1000 and payment_id is null from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-C1')
  and not exists (select 1 from public.pro_payments where reference = 'TXN-C1')
  and exists (select 1 from public.pro_audit_log where aksi = 'gateway_nominal_tidak_cocok' and baru ->> 'transaction_id' = 'TXN-C1') ok;
-- REGRESI (audit ChatGPT 1): fraud "challenge" → tidak masuk buku besar; setelah Midtrans menyatakan accept → aktif sekali.
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from mc), 'settlement', 'TXN-C1', '149000.00', '{"fraud_status":"challenge"}'));
select 'Q13a fraud challenge: tetap perlu_cek, tanpa baris dana' t, not exists (select 1 from public.pro_payments where reference = 'TXN-C1')
  and not (select pro_sekali_bayar from public.profiles where email = 'c@q.id') ok;
create temp table c_ok as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from mc), 'settlement', 'TXN-C1')) h;
select 'Q13b status sah setelah pemeriksaan → aktif, tepat 1 baris dana' t, (select h = 'aktif' from c_ok) and (select pro_sekali_bayar from public.profiles where email = 'c@q.id')
  and (select count(*) from public.pro_payments where reference = 'TXN-C1' and amount = 149000) = 1 ok;
-- REGRESI (audit ChatGPT 2): transaction_id milik pesanan A tidak boleh dihubungkan ke pesanan lain.
set role authenticated; select pg_temp.sebagai('b2000000-0000-0000-0000-0000000000b2');
select public.buat_pesanan_pro('qris');
create temp table mb as select public.gateway_mulai_percobaan((pg_temp.pesanan('b2000000-0000-0000-0000-0000000000b2')).id) j;
reset role;
create temp table bent as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from mb), 'settlement', 'TXN-A1')) h;
select 'Q13c transaction_id sudah dipakai pesanan lain → perlu_cek, tidak dihubungkan, Pro B tidak aktif, dana A utuh' t, (select h = 'perlu_cek' from bent)
  and not (select pro_sekali_bayar from public.profiles where email = 'b@q.id')
  and (select status = 'perlu_cek' and payment_id is null from public.pro_gateway_percobaan where id = (select (j->'percobaan'->>'id')::bigint from mb))
  and (select count(*) = 1 and bool_and(order_id = (pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).id) from public.pro_payments where reference = 'TXN-A1' and kind = 'pembayaran')
  and exists (select 1 from public.pro_audit_log where aksi = 'gateway_transaksi_bentrok') ok;
update public.upgrade_requests set status = 'dibatalkan' where id = (pg_temp.pesanan('b2000000-0000-0000-0000-0000000000b2')).id;   -- B dipakai lagi di Q24
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from mc), 'settlement', 'TXN-C1', '1000.00', '{"currency":"USD"}'));
create temp table tk as select public.gateway_terapkan_status(:R, pg_temp.st('CU-TIDAKADA-1', 'settlement', 'TXN-X')) h;
select 'Q14 status ulang tidak menggandakan dana; percobaan tak dikenal dicatat audit tanpa efek' t, (select h = 'tidak_dikenal' from tk)
  and (select count(*) from public.pro_payments where reference = 'TXN-C1') = 1
  and exists (select 1 from public.pro_audit_log where aksi = 'gateway_tidak_dikenal') ok;

-- dua QR untuk satu pesanan (seller D): QR-1 lewat waktu, QR-2 dibayar, lalu QR-1 ternyata juga dibayar
set role authenticated; select pg_temp.sebagai('d2000000-0000-0000-0000-0000000000d2');
select public.buat_pesanan_pro('qris');
create temp table d1 as select public.gateway_mulai_percobaan((pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id) j;
reset role;
select public.gateway_simpan_qr(:R, (select (j->'percobaan'->>'id')::bigint from d1), '{"ok":true,"gateway_txn_id":"TXN-D1","qr_url":"https://x.id/qr"}');
update public.pro_gateway_percobaan set berlaku_sampai = now() - interval '1 minute' where gateway_txn_id = 'TXN-D1';
set role authenticated; select pg_temp.sebagai('d2000000-0000-0000-0000-0000000000d2');
select 'Q15 QR lewat waktu → aksi cek (wajib cek Midtrans dulu), belum ada QR baru' t,
  public.gateway_mulai_percobaan((pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id) ->> 'aksi' = 'cek'
  and (select count(*) from public.pro_gateway_percobaan where order_id = (pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id) = 1 ok;
reset role;
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from d1), 'expire', 'TXN-D1'));
set role authenticated; select pg_temp.sebagai('d2000000-0000-0000-0000-0000000000d2');
create temp table d2 as select public.gateway_mulai_percobaan((pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id) j;
reset role;
select 'Q16 setelah kedaluwarsa tercatat → QR baru -2 untuk pesanan yang sama' t, (select j->>'aksi' = 'baru' and j->'percobaan'->>'gateway_order_id' like '%-2' from d2)
  and (select count(*) from public.upgrade_requests where user_id = 'd2000000-0000-0000-0000-0000000000d2') = 1 ok;
select public.gateway_simpan_qr(:R, (select (j->'percobaan'->>'id')::bigint from d2), '{"ok":true,"gateway_txn_id":"TXN-D2","qr_url":"https://x.id/qr2"}');
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from d2), 'settlement', 'TXN-D2'));
create temp table dg as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from d1), 'settlement', 'TXN-D1')) h;
select 'Q17 dua QR sama-sama dibayar → Pro aktif sekali, 2 baris dana, ditandai pembayaran ganda' t, (select h = 'pembayaran_ganda' from dg)
  and (select pro_sekali_bayar from public.profiles where email = 'd@q.id')
  and (select count(*) from public.pro_payments where reference in ('TXN-D1', 'TXN-D2')) = 2
  and (select count(*) from public.pro_order_events e where e.order_id = (pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id and e.status_baru = 'selesai' and e.status_lama <> 'selesai') = 1
  and exists (select 1 from public.pro_audit_log where aksi = 'gateway_pembayaran_ganda') ok;

-- ---------- refund ----------
set role authenticated; select pg_temp.sebagai('d2000000-0000-0000-0000-0000000000d2');
select 'Q18 seller tidak bisa menyiapkan refund' t, pg_temp.coba(format('select public.admin_refund_gateway_siapkan(%s, 1000, %L)', (select id from public.pro_payments where reference = 'TXN-D1'), 'uji')) = 'Hanya admin' ok;
select pg_temp.sebagai('f2000000-0000-0000-0000-0000000000f2');
create temp table rf as select public.admin_refund_gateway_siapkan((select id from public.pro_payments where reference = 'TXN-D1'), 149000, 'pembayaran ganda') j;
select 'Q19 admin: kunci refund deterministik, nominal > sisa ditolak, dana non-Midtrans ditolak' t,
  (select j->>'refund_key' = 'RF-' || (select id from public.pro_payments where reference = 'TXN-D1') || '-N1' and j->>'gateway_order_id' like '%-1' from rf)
  and pg_temp.coba(format('select public.admin_refund_gateway_siapkan(%s, 149001, %L)', (select id from public.pro_payments where reference = 'TXN-D1'), 'uji')) like 'Nominal refund harus 1 sampai 149000'
  and (select public.admin_refund_gateway_siapkan((select id from public.pro_payments where reference = 'TXN-D1'), 1, 'ulang') ->> 'refund_key') = (select j->>'refund_key' from rf) ok;
reset role;
-- refund pembayaran KEDUA (ganda) → Pro tetap; diterapkan 2x → satu baris refund
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from d1), 'refund', 'TXN-D1', '149000.00',
  jsonb_build_object('refunds', jsonb_build_array(jsonb_build_object('refund_key', (select j->>'refund_key' from rf), 'refund_amount', '149000.00'))))) from generate_series(1, 2);
select 'Q20 refund pembayaran ganda → 1 baris refund, Pro tetap aktif' t,
  (select count(*) from public.pro_payments where kind = 'refund' and sumber = 'midtrans' and refund_of = (select id from public.pro_payments where reference = 'TXN-D1')) = 1
  and (select pro_sekali_bayar from public.profiles where email = 'd@q.id') and (select status from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-D1') = 'direfund'
  and (pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).status = 'selesai' ok;
-- refund penuh pembayaran yang mengaktifkan → seluruh dana kembali → Pro dicabut
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from d2), 'refund', 'TXN-D2', '149000.00',
  '{"refunds":[{"refund_key":"RF-D2-1","refund_amount":"149000.00"}]}'));
select 'Q21 refund penuh terakhir → pesanan direfund, Pro dicabut, histori tetap' t, not (select pro_sekali_bayar from public.profiles where email = 'd@q.id')
  and (pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).status = 'direfund'
  and (select count(*) from public.pro_payments where order_id = (pg_temp.pesanan('d2000000-0000-0000-0000-0000000000d2')).id) = 4 ok;
-- refund sebagian (seller A) → Pro tetap
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from m1), 'partial_refund', 'TXN-A1', '149000.00',
  '{"refunds":[{"refund_key":"RF-A1-1","refund_amount":"50000.00"}]}'));
select 'Q22 refund sebagian → refund_sebagian, Pro tetap aktif' t, (select status from public.pro_gateway_percobaan where gateway_txn_id = 'TXN-A1') = 'refund_sebagian'
  and (select pro_sekali_bayar from public.profiles where email = 'a@q.id') and (pg_temp.pesanan('a2000000-0000-0000-0000-0000000000a2')).status = 'selesai' ok;

-- ---------- percobaan gagal & pesanan kedaluwarsa ----------
set role authenticated; select pg_temp.sebagai('e2000000-0000-0000-0000-0000000000e2');
select public.buat_pesanan_pro('qris');
create temp table e1 as select public.gateway_mulai_percobaan((pg_temp.pesanan('e2000000-0000-0000-0000-0000000000e2')).id) j;
reset role;
select public.gateway_simpan_qr(:R, (select (j->'percobaan'->>'id')::bigint from e1), '{"ok":false,"pesan":"Gagal menghubungi penyedia pembayaran"}');
update public.upgrade_requests set status = 'dibatalkan', expired_at = now() where id = (pg_temp.pesanan('e2000000-0000-0000-0000-0000000000e2')).id;
create temp table te as select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from e1), 'settlement', 'TXN-E1')) h;
select 'Q23 charge "gagal" yang ternyata dibayar (pesanan sempat kedaluwarsa) → tetap aktif sekali' t,
  (select h = 'aktif' from te)
  and (select pro_sekali_bayar from public.profiles where email = 'e@q.id') ok;
set role authenticated; select pg_temp.sebagai('b2000000-0000-0000-0000-0000000000b2');
select public.buat_pesanan_pro('qris');
reset role;
select public.gateway_terapkan_status(:R, pg_temp.st((select j->'percobaan'->>'gateway_order_id' from e1), 'refund', 'TXN-E1', '149000.00',
  '{"refunds":[{"refund_chargeback_id":1,"refund_amount":"149000.00"}]}')) from generate_series(1, 2);
select 'Q23b refund dari dasbor Midtrans tanpa refund_key → tercatat sekali, Pro dicabut' t,
  (select count(*) from public.pro_payments where kind = 'refund' and reference = 'TXN-E1-CB1') = 1
  and not (select pro_sekali_bayar from public.profiles where email = 'e@q.id') ok;
update public.upgrade_requests set created_at = now() - interval '72 hours' where user_id = 'b2000000-0000-0000-0000-0000000000b2';
set role authenticated; select pg_temp.sebagai('b2000000-0000-0000-0000-0000000000b2');
select 'Q24 pesanan lewat batas jam tanpa QR berjalan → tidak bisa membuat QR' t,
  pg_temp.coba(format('select public.gateway_mulai_percobaan(%s)', (pg_temp.pesanan('b2000000-0000-0000-0000-0000000000b2')).id)) like 'Pesanan sudah melewati batas waktu%' ok;
select 'Q25 percobaan_saya: tanpa payment_id, hanya milik sendiri' t,
  public.gateway_percobaan_saya((pg_temp.pesanan('b2000000-0000-0000-0000-0000000000b2')).id) ->> 'pesanan' is not null ok;
reset role;
-- mode manual kembali: QR otomatis tertutup, alur manual lama tetap ada
update public.pengaturan_pembayaran set mode = 'manual', bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI';
set role authenticated; select pg_temp.sebagai('c2000000-0000-0000-0000-0000000000c2');
select 'Q26 mode manual: percobaan QR ditolak; fungsi manual lama tetap ada' t,
  pg_temp.coba(format('select public.gateway_mulai_percobaan(%s)', (pg_temp.pesanan('c2000000-0000-0000-0000-0000000000c2')).id)) = 'Pembayaran otomatis belum dibuka'
  and to_regprocedure('public.admin_verifikasi_pesanan(bigint, text, text, integer, text)') is not null
  and to_regprocedure('public.konfirmasi_sudah_bayar(bigint, text)') is not null ok;
reset role;
select 'Q27 hak eksekusi: rahasia-only untuk anon; pembeli/admin hanya login; cek rahasia privat' t,
  has_function_privilege('anon', 'public.gateway_terapkan_status(text, jsonb)', 'execute') and has_function_privilege('anon', 'public.gateway_simpan_qr(text, bigint, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.gateway_mulai_percobaan(bigint)', 'execute') and not has_function_privilege('anon', 'public.admin_refund_gateway_siapkan(bigint, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._rahasia_gateway_sah(text)', 'execute') and not has_function_privilege('anon', 'public._rahasia_gateway_sah(text)', 'execute')
  and not has_table_privilege('authenticated', 'public.gateway_rahasia', 'select') and not has_table_privilege('authenticated', 'public.pro_gateway_percobaan', 'insert')
  and not has_table_privilege('anon', 'public.pro_gateway_percobaan', 'select') ok;
select 'Q28 semua fungsi baru SECURITY DEFINER mengunci search_path' t, not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
  and (proname like 'gateway\_%' or proname in ('admin_refund_gateway_siapkan', '_rahasia_gateway_sah', 'buat_pesanan_pro'))
  and coalesce(array_to_string(proconfig, ','), '') <> 'search_path=public, pg_temp') ok;
