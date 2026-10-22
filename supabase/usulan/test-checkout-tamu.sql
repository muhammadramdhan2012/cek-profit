-- Uji lokal usulan/checkout-tamu.sql. Urutan: shim-tanpa-ekspos.sql → schema.sql → pro-sekali-bayar.sql →
-- hardening-fungsi.sql → qris-midtrans.sql → checkout-tamu.sql (2x) → file ini. Data SINTETIS. Setiap baris harus |t.
\set ON_ERROR_STOP 0
\set R '''RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR'''
insert into public.gateway_rahasia (id, hash) values (1, encode(sha256(convert_to('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'UTF8')), 'hex'))
  on conflict (id) do update set hash = excluded.hash;
insert into auth.users (id, email, email_confirmed_at) values
 ('a4000000-0000-0000-0000-0000000000a4', 'lama@t.id', now()),          -- akun lama (kata sandi)
 ('b4000000-0000-0000-0000-0000000000b4', 'belum@t.id', null),          -- belum konfirmasi
 ('c4000000-0000-0000-0000-0000000000c4', 'pro@t.id', now()),           -- sudah Pro
 ('d4000000-0000-0000-0000-0000000000d4', 'lain@t.id', now()),
 ('f4000000-0000-0000-0000-0000000000f4', 'admin@t.id', now());
update public.profiles set is_admin = true where email = 'admin@t.id';
update public.profiles set pro_sekali_bayar = true where email = 'pro@t.id';
update public.pengaturan_pembayaran set aktif = true, mode = 'otomatis', kontak_bantuan = 'bantuan@contoh.invalid';
create or replace function pg_temp.coba(q text) returns text language plpgsql as $$ begin execute q; return 'LOLOS'; exception when others then return sqlerrm; end $$;
-- Sesi: uid + metode login (amr). 'password' = masuk dengan kata sandi; 'otp' = lewat tautan email.
create or replace function pg_temp.sesi(uid text, metode text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false),
         set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'amr', jsonb_build_array(jsonb_build_object('method', metode)))::text, false) $$;
create or replace function pg_temp.st(oid text, ts text, txn text, gross text default '149000.00', ekstra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('order_id', oid, 'transaction_status', ts, 'transaction_id', txn, 'gross_amount', gross, 'currency', 'IDR', 'fraud_status', 'accept') || ekstra $$;
create or replace function pg_temp.tamu(em text) returns public.pro_pesanan_tamu language sql as $$
  select * from public.pro_pesanan_tamu where email = em order by id desc limit 1 $$;
grant execute on function pg_temp.coba(text), pg_temp.sesi(text, text) to anon, authenticated;

-- ---------- pesanan tamu ----------
set role anon;
select 'K1 tanpa rahasia ditolak; anon tidak bisa membaca pesanan tamu' t,
  pg_temp.coba($$select public.tamu_buat_pesanan('salah-salah-salah-salah-salah-salah-1', 'x@t.id', 'X', '')$$) = 'Akses ditolak'
  and pg_temp.coba($$select * from public.pro_pesanan_tamu$$) like 'permission denied%'
  and pg_temp.coba($$select public.klaim_pembelian_tamu()$$) like 'permission denied%' ok;
create temp table b1 as select public.tamu_buat_pesanan(:R, ' Baru@T.id ', 'Pembeli Baru', '+6281234567890', repeat('a', 64)) j;
create temp table b2 as select public.tamu_buat_pesanan(:R, 'baru@t.id', 'Pembeli Baru', '', repeat('a', 64)) j;
reset role;
select 'K2 pesanan tamu: kode CT-, Rp149.000 dari server, email dinormalkan; klik ulang dari browser yang sama (token) = pesanan sama' t,
  (select j->>'aksi' = 'baru' and j->'pesanan'->>'kode' ~ '^CT-[A-Z0-9]{8}$' and (j->'pesanan'->>'amount')::int = 149000 and j->'pesanan'->>'email' = 'baru@t.id' from b1)
  and (select j->>'aksi' = 'pakai' and j->'pesanan'->>'id' = (select j->'pesanan'->>'id' from b1) from b2)
  and (select count(*) from public.pro_pesanan_tamu where email = 'baru@t.id') = 1 ok;
select 'K3 email/nama tidak valid ditolak' t, pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'bukan-email', 'X Y', '')$$) = 'Email tidak valid'
  and pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'a@b.id', ' ', '')$$) = 'Nama lengkap wajib diisi' ok;
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('baru@t.id')), '{"ok":true,"snap_token":"tok","snap_url":"https://app.sandbox.midtrans.com/snap/v4/redirection/tok"}');
select 'K4 Snap tersimpan → menunggu; Pro belum aktif di mana pun' t, (pg_temp.tamu('baru@t.id')).status = 'menunggu'
  and (select count(*) from public.profiles where pro_sekali_bayar) = 1 ok;

-- ---------- notifikasi (Get Status) ----------
create temp table h1 as select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('baru@t.id')).kode, 'settlement', 'TXN-T1')) h;
create temp table h2 as select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('baru@t.id')).kode, 'settlement', 'TXN-T1')) h;
select 'K5 settlement tamu → lunas, 1 dana belum terhubung akun, tanpa Pro; notifikasi ulang tanpa efek' t,
  (select h = 'lunas_tamu' from h1) and (select h = 'tidak_berubah' from h2) and (pg_temp.tamu('baru@t.id')).status = 'lunas'
  and (select count(*) = 1 and bool_and(order_id is null and user_id is null and dihubungkan_pada is null and amount = 149000) from public.pro_payments where reference = 'TXN-T1')
  and (select count(*) from public.profiles where pro_sekali_bayar) = 1 ok;
select public.tamu_buat_pesanan(:R, 'salah@t.id', 'Nominal Salah', '');
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('salah@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/x"}');
select 'K6 nominal salah → perlu_cek, TIDAK masuk buku besar' t,
  public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('salah@t.id')).kode, 'settlement', 'TXN-T2', '1000.00')) = 'perlu_cek' ok;
select 'K6b (cek)' t, (pg_temp.tamu('salah@t.id')).status = 'perlu_cek' and (pg_temp.tamu('salah@t.id')).jumlah_diterima = 1000
  and not exists (select 1 from public.pro_payments where reference = 'TXN-T2') ok;
select public.tamu_buat_pesanan(:R, 'bentrok@t.id', 'Bentrok', '');
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('bentrok@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/y"}');
select 'K7 transaction_id milik transaksi lain → perlu_cek, tidak dihubungkan' t,
  public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('bentrok@t.id')).kode, 'settlement', 'TXN-T1')) = 'perlu_cek' ok;
select 'K7b (cek)' t, (pg_temp.tamu('bentrok@t.id')).payment_id is null and (select count(*) from public.pro_payments where reference = 'TXN-T1') = 1 ok;

-- ---------- email aktivasi ----------
create temp table e1 as select public.tamu_perlu_email(:R, (pg_temp.tamu('baru@t.id')).kode) j;
create temp table e2 as select public.tamu_perlu_email(:R, (pg_temp.tamu('baru@t.id')).kode) j;
select public.tamu_catat_email(:R, (select (j->>'id')::bigint from e1), false, 'HTTP 500');
select 'K8 email: diminta sekali per menit; gagal kirim tercatat, pembayaran tetap lunas' t, (select j->>'email' = 'baru@t.id' from e1) and (select j is null from e2)
  and (pg_temp.tamu('baru@t.id')).email_status = 'gagal' and (pg_temp.tamu('baru@t.id')).status = 'lunas' ok;
update public.pro_pesanan_tamu set email_dicoba = now() - interval '2 minutes' where email = 'baru@t.id';
create temp table e3 as select public.tamu_perlu_email(:R, (pg_temp.tamu('baru@t.id')).kode) j;
select public.tamu_catat_email(:R, (select (j->>'id')::bigint from e3), true, 'HTTP 200');
select 'K9 pemulihan: dicoba lagi lalu terkirim; setelah terkirim tidak dikirim lagi' t, (select j is not null from e3) and (pg_temp.tamu('baru@t.id')).email_status = 'terkirim'
  and public.tamu_perlu_email(:R, (pg_temp.tamu('baru@t.id')).kode) is null ok;
select 'K10 status tamu wajib kode + email yang cocok' t, public.tamu_status(:R, (pg_temp.tamu('baru@t.id')).kode, 'orang@lain.id') is null
  and public.tamu_status(:R, (pg_temp.tamu('baru@t.id')).kode, 'BARU@t.id') ->> 'status' = 'lunas' ok;

-- ---------- klaim ----------
insert into auth.users (id, email, email_confirmed_at) values ('e4000000-0000-0000-0000-0000000000e4', 'baru@t.id', null);   -- akun dibuat Supabase via OTP
set role authenticated;
select pg_temp.sesi('d4000000-0000-0000-0000-0000000000d4', 'otp');
select 'K11 email lain tidak bisa mengklaim' t, (public.klaim_pembelian_tamu() ->> 'aktif')::int = 0 ok;
select pg_temp.sesi('e4000000-0000-0000-0000-0000000000e4', 'otp');
select 'K12 email belum terkonfirmasi tidak bisa mengklaim' t, (public.klaim_pembelian_tamu() ->> 'aktif')::int = 0
  and not (select pro_sekali_bayar from public.profiles where id = auth.uid()) ok;
reset role; update auth.users set email_confirmed_at = now() where id = 'e4000000-0000-0000-0000-0000000000e4'; set role authenticated;
select pg_temp.sesi('e4000000-0000-0000-0000-0000000000e4', 'password');
select 'K13 masuk dengan kata sandi saja tidak cukup → diminta tautan email' t, (select (j->>'aktif')::int = 0 and (j->>'perlu_tautan_email')::boolean from (select public.klaim_pembelian_tamu() j) x) ok;
select pg_temp.sesi('e4000000-0000-0000-0000-0000000000e4', 'otp');
create temp table k1 as select public.klaim_pembelian_tamu() j;
create temp table k2 as select public.klaim_pembelian_tamu() j;
reset role;
select 'K14 tautan email + email terkonfirmasi → Pro aktif, pesanan anggota selesai, dana terhubung; klaim ulang tanpa efek' t,
  (select (j->>'aktif')::int = 1 from k1) and (select (j->>'aktif')::int = 0 from k2)
  and (select pro_sekali_bayar and full_name = 'Pembeli Baru' and whatsapp = '+6281234567890' from public.profiles where id = 'e4000000-0000-0000-0000-0000000000e4')
  and (select status = 'selesai' and order_code = (pg_temp.tamu('baru@t.id')).kode from public.upgrade_requests where user_id = 'e4000000-0000-0000-0000-0000000000e4')
  and (select order_id is not null and user_id = 'e4000000-0000-0000-0000-0000000000e4' and dihubungkan_pada is not null from public.pro_payments where reference = 'TXN-T1')
  and (pg_temp.tamu('baru@t.id')).status = 'diklaim' ok;
-- akun lama (sudah Pro) membayar lagi sebagai tamu → tidak ada aktivasi ganda
select public.tamu_buat_pesanan(:R, 'pro@t.id', 'Sudah Pro', '');
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('pro@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/z"}');
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('pro@t.id')).kode, 'settlement', 'TXN-T3'));
set role authenticated; select pg_temp.sesi('c4000000-0000-0000-0000-0000000000c4', 'magiclink');
create temp table k3 as select public.klaim_pembelian_tamu() j;
reset role;
select 'K15 email terdaftar yang sudah Pro → pembayaran ganda ditandai perlu_cek, tanpa pesanan/aktivasi baru' t,
  (select (j->>'ganda')::int = 1 from k3) and (pg_temp.tamu('pro@t.id')).status = 'perlu_cek'
  and (select count(*) from public.upgrade_requests where user_id = 'c4000000-0000-0000-0000-0000000000c4') = 0 ok;
-- akun lama dengan kata sandi (belum Pro) → klaim lewat tautan email, akun yang SAMA (tanpa duplikat)
select public.tamu_buat_pesanan(:R, 'lama@t.id', 'Akun Lama', '');
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('lama@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/w"}');
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('lama@t.id')).kode, 'settlement', 'TXN-T4'));
set role authenticated; select pg_temp.sesi('a4000000-0000-0000-0000-0000000000a4', 'otp'); select public.klaim_pembelian_tamu(); reset role;
select 'K16 email yang sudah punya akun → Pro di akun yang sama, tidak ada akun baru' t,
  (select pro_sekali_bayar from public.profiles where id = 'a4000000-0000-0000-0000-0000000000a4') and (select count(*) from auth.users where email = 'lama@t.id') = 1 ok;

-- ---------- refund ----------
set role authenticated; select pg_temp.sesi('f4000000-0000-0000-0000-0000000000f4', 'password');
create temp table rf as select public.admin_refund_gateway_siapkan((select id from public.pro_payments where reference = 'TXN-T1'), 149000, 'uji refund') j;
reset role;
select 'K17 admin: refund dana tamu memakai kode CT- sebagai order Midtrans' t, (select j->>'gateway_order_id' = (pg_temp.tamu('baru@t.id')).kode and j->>'refund_key' like 'RF-%-N1' from rf) ok;
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('baru@t.id')).kode, 'refund', 'TXN-T1', '149000.00',
  jsonb_build_object('refunds', jsonb_build_array(jsonb_build_object('refund_key', (select j->>'refund_key' from rf), 'refund_amount', '149000.00'))))) from generate_series(1, 3);
select 'K18 refund penuh setelah klaim → Pro dicabut, pesanan direfund; refund berulang = 1 baris' t,
  not (select pro_sekali_bayar from public.profiles where id = 'e4000000-0000-0000-0000-0000000000e4')
  and (select status from public.upgrade_requests where user_id = 'e4000000-0000-0000-0000-0000000000e4') = 'direfund'
  and (pg_temp.tamu('baru@t.id')).status = 'direfund'
  and (select count(*) from public.pro_payments where kind = 'refund' and refund_of = (select id from public.pro_payments where reference = 'TXN-T1')) = 1 ok;
-- refund sebelum diklaim → tidak bisa diklaim lagi
select public.tamu_buat_pesanan(:R, 'refundawal@t.id', 'Refund Awal', '');
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('refundawal@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/v"}');
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('refundawal@t.id')).kode, 'settlement', 'TXN-T5'));
select public.gateway_terapkan_status(:R, pg_temp.st((pg_temp.tamu('refundawal@t.id')).kode, 'refund', 'TXN-T5', '149000.00', '{"refunds":[{"refund_key":"RF-X","refund_amount":"149000.00"}]}'));
insert into auth.users (id, email, email_confirmed_at) values ('e5000000-0000-0000-0000-0000000000e5', 'refundawal@t.id', now());
set role authenticated; select pg_temp.sesi('e5000000-0000-0000-0000-0000000000e5', 'otp'); create temp table k5 as select public.klaim_pembelian_tamu() j; reset role;
select 'K19 dana yang sudah direfund sebelum diklaim tidak mengaktifkan Pro' t, (select (j->>'aktif')::int = 0 from k5)
  and not (select pro_sekali_bayar from public.profiles where id = 'e5000000-0000-0000-0000-0000000000e5') ok;

-- ---------- kedaluwarsa & batas ----------
select public.tamu_buat_pesanan(:R, 'lewat@t.id', 'Lewat Waktu', '', repeat('b', 64));
select public.tamu_simpan_snap(:R, (select id from pg_temp.tamu('lewat@t.id')), '{"ok":true,"snap_url":"https://app.sandbox.midtrans.com/u"}');
update public.pro_pesanan_tamu set berlaku_sampai = now() - interval '1 minute' where email = 'lewat@t.id';
create temp table l1 as select public.tamu_buat_pesanan(:R, 'lewat@t.id', 'Lewat Waktu', '', repeat('b', 64)) j;
create temp table l2 as select public.gateway_terapkan_status(:R, jsonb_build_object('order_id', (pg_temp.tamu('lewat@t.id')).kode, 'transaction_status', 'expire')) h;
create temp table l3 as select public.tamu_buat_pesanan(:R, 'lewat@t.id', 'Lewat Waktu', '', repeat('b', 64)) j;
select 'K20 Snap lewat waktu → aksi cek; setelah kedaluwarsa tercatat → pesanan baru dengan kode baru' t,
  (select j->>'aksi' = 'cek' from l1) and (select h = 'kedaluwarsa' from l2) and (select j->>'aksi' = 'baru' from l3)
  and (select count(*) from public.pro_pesanan_tamu where email = 'lewat@t.id') = 2 ok;
-- ---------- pengamanan: tanpa pengungkapan kode, tanpa pemblokiran kuota per email ----------
create temp table x1 as select public.tamu_buat_pesanan(:R, 'korban@t.id', 'Korban Asli', '', repeat('c', 64)) j;   -- pembeli sah
create temp table x2 as select public.tamu_buat_pesanan(:R, 'korban@t.id', 'Penyusup', '') j;                       -- hanya tahu email
create temp table x3 as select public.tamu_buat_pesanan(:R, 'Korban@T.id', 'Penyusup', '', repeat('d', 64)) j;     -- token lain
select 'K21 hanya tahu email (tanpa/dengan token lain): pesanan baru, kode & tautan pembeli lain tidak terungkap, bentuk respons sama' t,
  (select j->>'aksi' = 'baru' from x2) and (select j->>'aksi' = 'baru' from x3)
  and (select j->'pesanan'->>'kode' from x2) <> (select j->'pesanan'->>'kode' from x1) and (select j->'pesanan'->>'kode' from x3) <> (select j->'pesanan'->>'kode' from x1)
  and (select array(select jsonb_object_keys(j)) from x1) = (select array(select jsonb_object_keys(j)) from x2) ok;
create temp table x4 as select public.tamu_buat_pesanan(:R, 'korban@t.id', 'Korban Asli', '', repeat('c', 64)) j;
select 'K21b pembeli sah (token sama) tetap memakai pesanannya sendiri' t, (select j->>'aksi' = 'pakai' and j->'pesanan'->>'kode' = (select j->'pesanan'->>'kode' from x1) from x4) ok;
select public.tamu_buat_pesanan(:R, 'korban@t.id', 'Penyusup', '', null, md5('penyusup')) from generate_series(1, 8);
select 'K21c batas per peminta 8/jam: ke-9 ditolak (pesan umum), peminta lain & pembeli sah tetap bisa' t,
  pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'acak@t.id', 'Penyusup', '', null, md5('penyusup'))$$) = 'Terlalu banyak percobaan pembayaran. Coba lagi beberapa saat lagi'
  and pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'korban@t.id', 'Korban Asli', '', repeat('e', 64), md5('korban'))$$) = 'LOLOS' ok;
select 'K21d banyak pesanan atas email korban tidak menghabiskan kuota email korban (tidak ada batas per email)' t,
  (select count(*) from public.pro_pesanan_tamu where email = 'korban@t.id') >= 10
  and pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'korban@t.id', 'Korban Asli', '', repeat('f', 64))$$) = 'LOLOS' ok;
update public.pro_pesanan_tamu set created_at = now() - interval '25 hours' where peminta = md5('penyusup');
select public.tamu_buat_pesanan(:R, 'lain2@t.id', 'Orang Lain', '');
select 'K21e penanda peminta dihapus setelah 24 jam (privasi); batas peminta pulih' t,
  (select count(*) from public.pro_pesanan_tamu where peminta = md5('penyusup')) = 0 ok;
insert into public.pro_pesanan_tamu (kode, email, nama, amount, berlaku_sampai, status)
  select 'CT-' || upper(substr(md5(g::text), 1, 8)), 'massal' || g || '@t.id', 'Massal', 149000, now(), 'kedaluwarsa' from generate_series(1, 120) g;
select 'K21f batas global 120/jam: ditolak dengan pesan umum yang sama (tidak bergantung email)' t,
  pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'siapa@t.id', 'Siapa', '', repeat('9', 64))$$) = 'Terlalu banyak percobaan pembayaran. Coba lagi beberapa saat lagi' ok;
delete from public.pro_pesanan_tamu where email like 'massal%@t.id';
update public.pengaturan_pembayaran set mode = 'manual', bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI';
select 'K22 mode manual: checkout tamu tertutup' t, pg_temp.coba($$select public.tamu_buat_pesanan('RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', 'z@t.id', 'Zed', '')$$) = 'Pembayaran otomatis belum dibuka' ok;
select 'K23 hak: fungsi tamu bergerbang rahasia (anon boleh), klaim hanya login, bantu privat, search_path terkunci' t,
  has_function_privilege('anon', 'public.tamu_buat_pesanan(text, text, text, text, text, text)', 'execute') and to_regprocedure('public.tamu_buat_pesanan(text, text, text, text)') is null and not has_function_privilege('anon', 'public.klaim_pembelian_tamu()', 'execute')
  and not has_function_privilege('authenticated', 'public._tamu_terapkan_status(jsonb)', 'execute') and not has_function_privilege('anon', 'public._tamu_terapkan_status(jsonb)', 'execute')
  and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and (proname like 'tamu\_%' or proname in ('_tamu_terapkan_status', 'klaim_pembelian_tamu'))
    and coalesce(array_to_string(proconfig, ','), '') <> 'search_path=public, pg_temp') ok;
