-- Uji lokal usulan v3 pro-sekali-bayar.sql (PostgreSQL + supabase/tests/shim.sql). Data SINTETIS, tanpa rekening asli.
-- Urutan: shim.sql → schema.sql → usulan/pro-sekali-bayar.sql → file ini. Setiap baris hasil harus berakhir |t.
\set ON_ERROR_STOP 0
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a','a@x.id','{}'),
 ('b0000000-0000-0000-0000-00000000000b','b@x.id','{}'),
 ('c0000000-0000-0000-0000-00000000000c','lama@x.id','{}'),
 ('d0000000-0000-0000-0000-00000000000d','admin@x.id','{}');
update public.profiles set is_admin = true where email = 'admin@x.id';
update public.profiles set pro_until = '2099-01-31' where email = 'lama@x.id';
insert into public.upgrade_requests (user_id, plan) values ('c0000000-0000-0000-0000-00000000000c', 'pro_bulanan');   -- permintaan lama

create or replace function pg_temp.sebagai(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
create or replace function pg_temp.bayar(ref text) returns bigint language sql as $$
  select id from public.pro_payments where kind = 'pembayaran' and reference_norm = upper(regexp_replace(ref, '[^A-Za-z0-9]', '', 'g')) $$;
create or replace function pg_temp.pesanan(uid uuid) returns public.upgrade_requests language sql as $$
  select * from public.upgrade_requests where user_id = uid and plan = 'pro_sekali' order by id desc limit 1 $$;

-- ---------- pembelian belum dibuka ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('transfer');
insert into public.upgrade_requests (plan) values ('pro_sekali');
update public.pengaturan_pembayaran set aktif = true, bank_nomor = '1';
reset role;
select 'O1 belum dibuka: tidak ada pesanan; seller tidak bisa insert langsung atau mengubah pengaturan' t,
  (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 0 and (select not aktif and bank_nomor = '' from public.pengaturan_pembayaran) ok;

-- ---------- admin mengatur (data SINTETIS) ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
update public.pengaturan_pembayaran set aktif = true, bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI';
reset role;
select 'O2 tidak bisa dibuka tanpa kontak bantuan' t, (select not aktif from public.pengaturan_pembayaran) ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
update public.pengaturan_pembayaran set aktif = true, bank_nama = 'BANK UJI', bank_nomor = '0000000000', bank_pemilik = 'PEMILIK UJI', kontak_bantuan = 'bantuan@contoh.invalid';
reset role;
select 'O3 admin membuka pembelian (transfer saja)' t, (select aktif from public.pengaturan_pembayaran) ok;

-- ---------- seller A membuat pesanan ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('qris');
select public.buat_pesanan_pro('transfer');
select public.buat_pesanan_pro('transfer');
reset role;
select 'O4 pesanan: harga resmi server, kode CU-, satu pesanan terbuka, QRIS yang belum diatur ditolak' t,
  (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 1
  and (select amount = 149000 and order_code ~ '^CU-[0-9A-F]{8}$' and status = 'baru' and metode = 'transfer' from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) ok;
select 'O5 histori pesanan tercatat' t, (select count(*) from public.pro_order_events where status_baru = 'baru' and status_lama is null) = 1 ok;

-- ---------- isolasi antar-seller ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select 'O6 seller B tidak melihat pesanan/histori A' t, (select count(*) from public.upgrade_requests where plan = 'pro_sekali') = 0
  and (select count(*) from public.pro_order_events) = 0 ok;
select public.konfirmasi_sudah_bayar((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')));
reset role;
select 'O7 B tidak bisa mengonfirmasi pesanan A' t, (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'baru' ok;

-- ---------- klaim "sudah membayar" ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'), 'sudah transfer, ini screenshot')).status;
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'))).status;
select public.batalkan_pesanan((select id from public.upgrade_requests where plan = 'pro_sekali'));
update public.upgrade_requests set status = 'selesai' where plan = 'pro_sekali';
update public.profiles set pro_sekali_bayar = true where id = 'a0000000-0000-0000-0000-00000000000a';
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where plan = 'pro_sekali'), 'transfer', 'TRX-PALSU', 149000);
reset role;
select 'O8 klaim/screenshot → hanya Menunggu Verifikasi; Pro tidak aktif; seller tidak bisa mengesahkan sendiri' t,
  (select status = 'diproses' and claimed_at is not null from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))
  and (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments) = 0 ok;

-- ---------- verifikasi admin ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-001', 100000);
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', '', 149000);
reset role;
select 'O9 kurang bayar / tanpa referensi → Pro tidak aktif' t, (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments) = 0 ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-001', 149000, 'mutasi 21/10');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'trx 001', 149000);
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'transfer', 'TRX-999', 149000);
reset role;
select 'O10 aktivasi atomik: Pro aktif + pembayaran + status + histori + admin pencatat' t,
  (select pro_sekali_bayar and pro_until is null from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'selesai'
  and (select count(*) from public.pro_payments where kind = 'pembayaran' and amount = 149000 and reference_norm = 'TRX001'
       and created_by = 'd0000000-0000-0000-0000-00000000000d') = 1
  and (select count(*) from public.pro_order_events where status_baru = 'selesai' and oleh = 'd0000000-0000-0000-0000-00000000000d') = 1 ok;
select 'O11 ulang (referensi sama, format beda) aman; referensi lain pada pesanan aktif ditolak' t, (select count(*) from public.pro_payments) = 1 ok;

-- ---------- seller B: referensi ganda & kelebihan bayar ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select public.buat_pesanan_pro('transfer');
select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 'transfer', 'Trx/001', 149000);
reset role;
select 'O12 satu pembayaran tidak bisa mengaktifkan dua akun' t, (select not pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b') ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from public.upgrade_requests where user_id = 'b0000000-0000-0000-0000-00000000000b' and plan = 'pro_sekali'), 'transfer', 'TRX-002', 150000);
select public.admin_refund_pembayaran(pg_temp.bayar('TRX-002'), 200000, 'kelebihan', false);
select public.admin_refund_pembayaran(pg_temp.bayar('TRX-002'), 1000, 'kelebihan bayar dikembalikan', false);
reset role;
select 'O13 kelebihan bayar: Pro aktif, refund menunjuk pembayaran asal, ≤ sisa dana, Pro tetap' t,
  (select pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b')
  and (select count(*) from public.pro_payments where kind = 'refund' and amount = 1000 and refund_of = pg_temp.bayar('TRX-002')) = 1
  and (select count(*) from public.pro_payments where kind = 'refund' and amount = 200000) = 0 ok;

-- ---------- transfer ganda dicatat lalu direfund ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_catat_pembayaran_tambahan((select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')), 'qris', 'QR-777', 149000, 'transfer ganda');
select public.admin_refund_pembayaran(pg_temp.bayar('QR-777'), 149000, 'transfer ganda dikembalikan', false);
reset role;
select 'O14 transfer ganda: tercatat & direfund, hak akses tidak berubah' t,
  (select pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select count(*) from public.pro_payments where order_id = (select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))) = 3 ok;

-- ---------- pesanan baru saat sudah Pro ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
select public.buat_pesanan_pro('transfer');
reset role;
select 'O15 akun yang sudah Pro tidak bisa membuat pesanan baru' t, (select count(*) from public.upgrade_requests where user_id = 'a0000000-0000-0000-0000-00000000000a' and plan = 'pro_sekali') = 1 ok;

-- ---------- refund penuh ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_refund_pembayaran(pg_temp.bayar('QR-777'), 1, 'refund lagi', false);
select public.admin_refund_pembayaran(pg_temp.bayar('TRX-001'), 149000, 'refund atas permintaan pembeli', true);
reset role;
select 'O16 refund penuh: Pro dicabut, status direfund, histori tetap utuh' t,
  (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select status from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a')) = 'direfund'
  and (select count(*) from public.pro_payments where order_id = (select id from pg_temp.pesanan('a0000000-0000-0000-0000-00000000000a'))) = 4 ok;

-- ---------- RLS buku besar ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select 'O17 seller hanya membaca catatan dananya sendiri' t, (select count(*) from public.pro_payments) = 2
  and (select count(*) from public.pro_payments where user_id <> 'b0000000-0000-0000-0000-00000000000b') = 0 ok;
update public.profiles set pro_sekali_bayar = true where id = 'a0000000-0000-0000-0000-00000000000a';
insert into public.pro_payments (user_id, kind, sumber, reference, amount) values ('b0000000-0000-0000-0000-00000000000b','pembayaran','transfer','X-1',149000);
reset role;
select 'O18 seller tidak bisa menulis buku besar atau mengubah Pro' t, (select count(*) from public.pro_payments where reference = 'X-1') = 0
  and (select not pro_sekali_bayar from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') ok;

-- ---------- kedaluwarsa & batal ----------
set role authenticated; select pg_temp.sebagai('c0000000-0000-0000-0000-00000000000c');
select public.buat_pesanan_pro('transfer');
reset role;
update public.upgrade_requests set created_at = now() - interval '49 hours' where user_id = 'c0000000-0000-0000-0000-00000000000c' and plan = 'pro_sekali';
set role authenticated; select pg_temp.sebagai('c0000000-0000-0000-0000-00000000000c');
select public.buat_pesanan_pro('transfer');
select public.batalkan_pesanan((select max(id) from public.upgrade_requests where plan = 'pro_sekali'));
reset role;
select 'O19 pesanan lewat 48 jam → dibatalkan otomatis (kedaluwarsa); pesanan baru bisa dibuat lalu dibatalkan pembeli' t,
  (select count(*) from public.upgrade_requests where user_id = 'c0000000-0000-0000-0000-00000000000c' and plan = 'pro_sekali' and status = 'dibatalkan') = 2
  and (select count(*) from public.pro_order_events where catatan like 'Kedaluwarsa%') = 1
  and (select count(*) from public.upgrade_requests where user_id = 'c0000000-0000-0000-0000-00000000000c' and expired_at is not null) = 1 ok;

-- ---------- permintaan lama & Pro lama ----------
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_tolak_pesanan((select id from public.upgrade_requests where plan = 'pro_bulanan'), 'paket lama tidak dijual lagi');
reset role;
select 'O20 permintaan lama bisa ditolak admin dengan alasan' t, (select status from public.upgrade_requests where plan = 'pro_bulanan') = 'ditolak' ok;
select 'O21 Pro lama (berjangka) tidak berubah' t, (select pro_until = '2099-01-31' and not pro_sekali_bayar from public.profiles where email = 'lama@x.id') ok;

-- ---------- non-admin & anon ----------
set role authenticated; select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
select public.admin_refund_pembayaran(pg_temp.bayar('TRX-002'), 1000, 'coba', true);
select public.admin_cabut_pro('b0000000-0000-0000-0000-00000000000b', 'coba cabut');
reset role; set role anon; select pg_temp.sebagai('');
select public.buat_pesanan_pro('transfer');
select count(*) from public.pengaturan_pembayaran;
reset role;
select 'O22 non-admin tidak bisa refund/cabut; anon tidak bisa memesan atau membaca pengaturan' t,
  (select pro_sekali_bayar from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b')
  and (select count(*) from public.pro_payments where kind = 'refund' and user_id = 'b0000000-0000-0000-0000-00000000000b') = 1 ok;

-- ========== v3: skenario pembayaran ambigu & 48 jam ==========
insert into auth.users (id, email, raw_user_meta_data) values
 ('e0000000-0000-0000-0000-00000000000e','e@x.id','{}'), ('f0000000-0000-0000-0000-00000000000f','f@x.id','{}'),
 ('90000000-0000-0000-0000-000000000009','g@x.id','{}');
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
update public.pengaturan_pembayaran set qris_merchant = 'MERCHANT UJI', qris_gambar = 'img/qris-uji.png', qris_nmid = 'ID0000UJI';
select pg_temp.sebagai('e0000000-0000-0000-0000-00000000000e'); select public.buat_pesanan_pro('qris');
select public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'));
select pg_temp.sebagai('f0000000-0000-0000-0000-00000000000f'); select public.buat_pesanan_pro('qris');
select public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'));
-- Dua QRIS Rp149.000 masuk berdekatan; pemilik belum pasti → dicatat sebagai dana belum teridentifikasi
select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_catat_dana_masuk('qris', 'QRIS-AMB-1', 149000, '10:01, nama di mutasi tidak jelas');
select public.admin_catat_dana_masuk('qris', 'QRIS-AMB-2', 149000, '10:02, nama di mutasi tidak jelas');
select public.admin_catatan_pesanan((select id from pg_temp.pesanan('e0000000-0000-0000-0000-00000000000e')), 'cocokkan jam bayar via email', true);
select public.admin_catatan_pesanan((select id from pg_temp.pesanan('f0000000-0000-0000-0000-00000000000f')), 'cocokkan jam bayar via email', true);
reset role;
select 'V1 dua pembayaran ambigu: dana tercatat, Pro belum aktif, pesanan Perlu Pemeriksaan' t,
  (select count(*) from public.pro_payments where order_id is null and dihubungkan_pada is null and kind = 'pembayaran') = 2
  and (select count(*) from public.profiles where pro_sekali_bayar and email in ('e@x.id', 'f@x.id')) = 0
  and (select count(*) from public.upgrade_requests where user_id in ('e0000000-0000-0000-0000-00000000000e', 'f0000000-0000-0000-0000-00000000000f') and status = 'perlu_cek') = 2 ok;
set role authenticated; select pg_temp.sebagai('e0000000-0000-0000-0000-00000000000e');
select 'V2 catatan admin internal tidak terlihat pembeli; pembeli tidak melihat dana belum teridentifikasi' t,
  (select count(*) from public.pro_order_events where internal) = 0 and (select count(*) from public.pro_order_events where status_baru = 'perlu_cek') = 1
  and (select count(*) from public.pro_payments) = 0 ok;
select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('e0000000-0000-0000-0000-00000000000e')), 'qris', 'QRIS-AMB-1', 149000);
select public.admin_hubungkan_dana(pg_temp.bayar('QRIS-AMB-1'), (select id from pg_temp.pesanan('e0000000-0000-0000-0000-00000000000e')), '');
select public.admin_hubungkan_dana(pg_temp.bayar('QRIS-AMB-1'), (select id from pg_temp.pesanan('e0000000-0000-0000-0000-00000000000e')), 'jam 10:01 cocok dengan email pembeli');
select public.admin_hubungkan_dana(pg_temp.bayar('QRIS-AMB-1'), (select id from pg_temp.pesanan('f0000000-0000-0000-0000-00000000000f')), 'coba pakai dana yang sama');
reset role;
select 'V3 hubungkan dana setelah bukti: atomik, tercatat di audit; dana yang sama tidak bisa dipakai akun lain' t,
  (select pro_sekali_bayar from public.profiles where email = 'e@x.id') and (select not pro_sekali_bayar from public.profiles where email = 'f@x.id')
  and (select order_id = (select id from pg_temp.pesanan('e0000000-0000-0000-0000-00000000000e')) and dihubungkan_pada is not null from public.pro_payments where id = pg_temp.bayar('QRIS-AMB-1'))
  and (select count(*) from public.pro_audit_log where aksi = 'hubungkan_dana') = 1 ok;
-- Dana kedua ternyata bukan milik siapa pun di sistem → refund dana belum teridentifikasi (tercatat), pesanan F ditolak
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_refund_pembayaran(pg_temp.bayar('QRIS-AMB-2'), 149000, 'tidak ada pembeli yang cocok, dikembalikan ke pengirim', true);
select public.admin_refund_pembayaran(pg_temp.bayar('QRIS-AMB-2'), 149000, 'tidak ada pembeli yang cocok, dikembalikan ke pengirim', false);
select public.admin_tolak_pesanan((select id from pg_temp.pesanan('f0000000-0000-0000-0000-00000000000f')), 'dana tidak ditemukan di mutasi');
select public.admin_hubungkan_dana(pg_temp.bayar('QRIS-AMB-2'), (select id from pg_temp.pesanan('f0000000-0000-0000-0000-00000000000f')), 'coba setelah refund');
reset role;
select 'V4 dana tak bertuan direfund (tanpa cabut Pro), tidak bisa dihubungkan lagi; pesanan tanpa dana ditolak' t,
  (select count(*) from public.pro_payments where kind = 'refund' and refund_of = pg_temp.bayar('QRIS-AMB-2')) = 1
  and (select status from pg_temp.pesanan('f0000000-0000-0000-0000-00000000000f')) = 'ditolak'
  and (select not pro_sekali_bayar from public.profiles where email = 'f@x.id') ok;
-- Admin salah ketik referensi → koreksi tercatat; keunikan tetap dijaga
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_koreksi_referensi(pg_temp.bayar('TRX-002'), 'TRX 001', 'salah ketik (bentrok dengan transfer lain)');
select public.admin_koreksi_referensi(pg_temp.bayar('TRX-002'), 'TRX-0002', 'salah ketik: digit kurang');
reset role;
select 'V5 koreksi referensi: tidak boleh bentrok, nilai lama/baru tercatat' t,
  pg_temp.bayar('TRX-0002') is not null and pg_temp.bayar('TRX-002') is null
  and (select count(*) from public.pro_audit_log where aksi = 'koreksi_referensi' and lama->>'reference' = 'TRX-002' and baru->>'reference' = 'TRX-0002') = 1 ok;
-- Klaim setelah 48 jam → Perlu Pemeriksaan (bukan otomatis aktif); bisa diaktifkan admin setelah rekonsiliasi
set role authenticated; select pg_temp.sebagai('90000000-0000-0000-0000-000000000009'); select public.buat_pesanan_pro('transfer');
reset role; update public.upgrade_requests set created_at = now() - interval '50 hours' where user_id = '90000000-0000-0000-0000-000000000009';
set role authenticated; select pg_temp.sebagai('90000000-0000-0000-0000-000000000009');
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali'), 'transfer jam 23:50 hari ke-2')).status;
select public.buat_pesanan_pro('transfer');
reset role;
select 'V6 bayar setelah 48 jam: status Perlu Pemeriksaan, Pro belum aktif, tidak bisa membuat pesanan baru dulu' t,
  (select status from pg_temp.pesanan('90000000-0000-0000-0000-000000000009')) = 'perlu_cek'
  and (select count(*) from public.upgrade_requests where user_id = '90000000-0000-0000-0000-000000000009') = 1
  and (select not pro_sekali_bayar from public.profiles where email = 'g@x.id') ok;
set role authenticated; select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d');
select public.admin_verifikasi_pesanan((select id from pg_temp.pesanan('90000000-0000-0000-0000-000000000009')), 'transfer', 'TRX-TELAT-1', 149000, 'dana terlambat, cocok di mutasi');
reset role;
select 'V7 dana terlambat diaktifkan admin setelah rekonsiliasi' t, (select pro_sekali_bayar from public.profiles where email = 'g@x.id') ok;
-- Pesanan yang sudah kedaluwarsa (dibatalkan otomatis) lalu pembeli bilang sudah bayar → Perlu Pemeriksaan
set role authenticated; select pg_temp.sebagai('c0000000-0000-0000-0000-00000000000c');
select (public.konfirmasi_sudah_bayar((select id from public.upgrade_requests where plan = 'pro_sekali' and expired_at is not null))).status;
reset role;
select 'V8 klaim pada pesanan kedaluwarsa → Perlu Pemeriksaan; pesanan batal pembeli tidak bisa diklaim' t,
  (select status from public.upgrade_requests where user_id = 'c0000000-0000-0000-0000-00000000000c' and expired_at is not null) = 'perlu_cek'
  and (select count(*) from public.upgrade_requests where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'dibatalkan') = 1 ok;
-- Perubahan pengaturan pembayaran tercatat
select 'V9 perubahan pengaturan pembayaran tercatat di audit (oleh admin)' t,
  (select count(*) from public.pro_audit_log where aksi = 'ubah_pengaturan' and oleh = 'd0000000-0000-0000-0000-00000000000d') >= 2 ok;
-- admin_set_pro (Pro lama) tidak menutup pesanan sekali bayar
set role authenticated; select pg_temp.sebagai('f0000000-0000-0000-0000-00000000000f'); select public.buat_pesanan_pro('transfer');
select pg_temp.sebagai('d0000000-0000-0000-0000-00000000000d'); select public.admin_set_pro('f0000000-0000-0000-0000-00000000000f', '2099-01-01');
reset role;
select 'V10 admin_set_pro tidak menandai pesanan sekali bayar "Aktif" tanpa dana' t,
  (select status from public.upgrade_requests where user_id = 'f0000000-0000-0000-0000-00000000000f' and status in ('baru','diproses','perlu_cek','selesai') ) = 'baru' ok;
select 'V13 admin_set_pro (jalur Pro lama) tercatat di audit dengan nilai lama & baru' t,
  (select count(*) from public.pro_audit_log where aksi = 'set_pro_lama' and oleh = 'd0000000-0000-0000-0000-00000000000d'
     and baru->>'pro_until' = '2099-01-01' and baru->>'user_id' = 'f0000000-0000-0000-0000-00000000000f') = 1 ok;
set role authenticated; select pg_temp.sebagai('f0000000-0000-0000-0000-00000000000f');
select public.admin_set_pro('e0000000-0000-0000-0000-00000000000e', '2099-01-01');
reset role;
select 'V14 non-admin tidak bisa memakai admin_set_pro (tanpa perubahan, tanpa audit)' t,
  (select pro_until is null from public.profiles where id = 'e0000000-0000-0000-0000-00000000000e')
  and (select count(*) from public.pro_audit_log where aksi = 'set_pro_lama') = 1 ok;
select 'V15 semua fungsi SECURITY DEFINER milik migrasi mengunci search_path dengan pg_temp terakhir' t,
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
    and proname not in ('is_admin', 'handle_new_user', 'rls_auto_enable')   -- dua dari schema.sql (diperketat hardening-fungsi.sql), satu milik Supabase
    and coalesce(array_to_string(proconfig, ','), '') <> 'search_path=public, pg_temp') ok;
select 'V16 tidak ada role pengguna yang boleh menghapus catatan keuangan' t,
  not (has_table_privilege('authenticated', 'public.pro_payments', 'delete') or has_table_privilege('authenticated', 'public.pro_audit_log', 'delete')
    or has_table_privilege('authenticated', 'public.pro_order_events', 'delete') or has_table_privilege('authenticated', 'public.upgrade_requests', 'delete')
    or has_table_privilege('anon', 'public.pro_payments', 'delete')) ok;
-- Seller tidak bisa menulis audit
set role authenticated; select pg_temp.sebagai('e0000000-0000-0000-0000-00000000000e');
insert into public.pro_audit_log (aksi) values ('palsu');
select public._audit('palsu', null, null, null, null, 'x');
select 'V11 seller tidak bisa menulis/membaca audit' t, (select count(*) from public.pro_audit_log) = 0 ok;
reset role;
select 'V12 audit tidak berisi entri palsu' t, (select count(*) from public.pro_audit_log where aksi = 'palsu') = 0 ok;

-- ---------- batas riwayat (opsional) ----------
set role authenticated; select pg_temp.sebagai('a0000000-0000-0000-0000-00000000000a');
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}');
insert into public.reports (title, summary) values ('4','{}');
select 'O23 akun gratis: riwayat ke-4 ditolak' t, count(*) = 3 ok from public.reports;
select pg_temp.sebagai('b0000000-0000-0000-0000-00000000000b');
insert into public.reports (title, summary) values ('1','{}'),('2','{}'),('3','{}'),('4','{}');
select 'O24 akun Pro sekali bayar: riwayat tanpa batas' t, count(*) = 4 ok from public.reports;
reset role;
