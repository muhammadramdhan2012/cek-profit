-- Uji masukan pengguna (tabel feedback). Jalankan setelah shim.sql + schema.sql pada database KOSONG.
-- Setiap baris hasil "nama|t"; "f" berarti gagal. Error yang DIHARAPKAN (penolakan) juga tercetak.
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values
 ('a1111111-1111-1111-1111-111111111111','ani@x.id'),
 ('b2222222-2222-2222-2222-222222222222','budi@x.id'),
 ('a3333333-3333-3333-3333-333333333333','admin@x.id');
update public.profiles set is_admin = true where email = 'admin@x.id';

set role anon; select set_config('request.jwt.claim.sub','',false);
insert into public.feedback (jenis, pesan) values ('saran', 'tamu mencoba kirim');   -- ditolak: tamu
reset role;
select 'M1 tamu tidak bisa mengirim' t, count(*) = 0 ok from public.feedback;

set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
insert into public.feedback (jenis, pesan, halaman, boleh_dihubungi) values ('saran', 'Tolong tambah laporan Lazada', 'produk', true);
select 'M2 pengguna bisa mengirim, tetapi tidak bisa membaca masukan (termasuk miliknya)' t, count(*) = 0 ok from public.feedback;
insert into public.feedback (jenis, pesan, user_id) values ('saran', 'atas nama orang lain', 'b2222222-2222-2222-2222-222222222222');   -- ditolak
insert into public.feedback (jenis, pesan, status) values ('saran', 'langsung selesai', 'selesai');   -- ditolak (kolom status tidak boleh diisi)
insert into public.feedback (jenis, pesan) values ('pujian', 'jenis tidak dikenal');                  -- ditolak
insert into public.feedback (jenis, pesan) values ('saran', '   ab  ');                                -- ditolak: terlalu pendek
insert into public.feedback (jenis, pesan) values ('saran', repeat('x', 2001));                       -- ditolak: terlalu panjang
update public.feedback set status = 'selesai';                                                        -- tidak berpengaruh (bukan admin)
reset role;
select 'M3 kiriman palsu/tidak valid ditolak; hanya 1 masukan sah, status baru' t,
  count(*) = 1 and bool_and(status = 'baru' and user_id = 'a1111111-1111-1111-1111-111111111111' and halaman = 'produk' and boleh_dihubungi) ok from public.feedback;

set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
insert into public.feedback (jenis, pesan) select 'lainnya', 'pesan ke-' || g from generate_series(2, 5) g;
insert into public.feedback (jenis, pesan) values ('lainnya', 'pesan ke-6');   -- ditolak: BATAS_MASUKAN
reset role;
select 'M4 batas 5 masukan per 24 jam per akun' t, count(*) = 5 ok from public.feedback where user_id = 'a1111111-1111-1111-1111-111111111111';
update public.feedback set created_at = now() - interval '25 hours' where user_id = 'a1111111-1111-1111-1111-111111111111';
set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
insert into public.feedback (jenis, pesan) values ('masalah', 'besoknya boleh lagi');
select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
insert into public.feedback (jenis, pesan) values ('masalah', 'akun lain tidak terkena batas akun Ani');
reset role;
select 'M5 setelah 24 jam boleh lagi; batas per akun' t, count(*) = 7 ok from public.feedback;

set role authenticated; select set_config('request.jwt.claim.sub','a3333333-3333-3333-3333-333333333333',false);
select 'M6 admin membaca semua masukan' t, count(*) = 7 ok from public.feedback;
update public.feedback set status = 'dibaca' where pesan = 'Tolong tambah laporan Lazada';
update public.feedback set pesan = 'diubah admin' where pesan = 'pesan ke-2';   -- ditolak: admin hanya boleh ubah status
select 'M7 admin mengubah status, bukan isi pesan' t,
  (select status from public.feedback where pesan = 'Tolong tambah laporan Lazada') = 'dibaca'
  and exists (select 1 from public.feedback where pesan = 'pesan ke-2') ok;
reset role;
delete from auth.users where email = 'budi@x.id';
select 'M8 akun dihapus → masukannya ikut terhapus' t, not exists (select 1 from public.feedback where user_id = 'b2222222-2222-2222-2222-222222222222') ok;
