-- Uji tahap 2: masa beta, pengguna awal, batas riwayat, catatan pembelian Pro.
-- Jalankan setelah shim.sql + schema.sql pada database KOSONG (lihat supabase/PANDUAN.md, "Uji lokal").
-- Setiap baris hasil berbentuk "nama|t"; "f" berarti gagal. Error yang DIHARAPKAN (penolakan) juga tercetak.
\set ON_ERROR_STOP 0
-- Tanggal server dibekukan lewat fungsi (hanya superuser di uji lokal yang bisa menggantinya).
create or replace function public.tgl_uji(d date) returns void language plpgsql security definer as $$
begin
  execute format('create or replace function public.hari_ini_jakarta() returns date language sql stable set search_path = public as %L',
    format('select %L::date', d));
end $$;
grant execute on function public.tgl_uji(date) to authenticated, anon;   -- uji saja; tidak ada di schema.sql

select public.tgl_uji('2026-11-05');
insert into auth.users (id, email) values
 ('a1111111-1111-1111-1111-111111111111','awal@x.id'),
 ('a3333333-3333-3333-3333-333333333333','admin@x.id');
update public.profiles set is_admin = true where email = 'admin@x.id';
select public.tgl_uji('2026-12-20');
insert into auth.users (id, email) values ('b2222222-2222-2222-2222-222222222222','telat@x.id');
select 'U1 daftar selama beta = pengguna awal; setelah beta bukan' t,
  (select pengguna_awal from public.profiles where email='awal@x.id') and not (select pengguna_awal from public.profiles where email='telat@x.id') ok;

-- anon: hanya status_situs
set role anon; select set_config('request.jwt.claim.sub','',false);
select public.tgl_uji('2026-12-13');
select 'U2 anon: 13 Des masih beta (inklusif), tanggal dari server' t, (public.status_situs() ->> 'beta_aktif')::boolean and public.status_situs() ->> 'hari_ini' = '2026-12-13' ok;
select public.tgl_uji('2026-12-14');
select 'U3 anon: 14 Des beta berakhir' t, not (public.status_situs() ->> 'beta_aktif')::boolean ok;
select public.status_akun();                          -- harus ditolak (permission denied)
select public.akses_pro('a1111111-1111-1111-1111-111111111111');   -- harus ditolak
reset role;

-- pengguna awal (gratis)
set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
update public.profiles set pengguna_awal = false where id = auth.uid();   -- ditolak (kolom tidak boleh diubah)
reset role;
select 'U4 pengguna tidak bisa mengubah status pengguna awal' t, pengguna_awal ok from public.profiles where email='awal@x.id';

set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select public.tgl_uji('2026-12-01');
insert into public.reports (title, summary) select 'R' || g, '{}' from generate_series(1,5) g;
select 'U5 selama beta akun gratis bebas menyimpan riwayat' t, count(*) = 5 ok from public.reports;
select 'U6 status_akun selama beta: tanpa batas riwayat' t, public.status_akun() -> 'batas_riwayat' = 'null'::jsonb and (public.status_akun() ->> 'pengguna_awal')::boolean ok;
select public.tgl_uji('2026-12-14');
insert into public.reports (title, summary) values ('R6', '{}');   -- ditolak: BATAS_RIWAYAT
select 'U7 setelah beta riwayat ke-6 ditolak, 5 riwayat lama tetap ada' t, count(*) = 5 ok from public.reports;
select 'U8 status_akun setelah beta: batas 3, jumlah 5' t, (public.status_akun() ->> 'batas_riwayat')::int = 3 and (public.status_akun() ->> 'jumlah_riwayat')::int = 5 ok;
delete from public.reports where title in ('R1','R2','R3');
insert into public.reports (title, summary) values ('R7', '{}');
select 'U9 setelah dihapus jadi 2, riwayat ke-3 boleh' t, count(*) = 3 ok from public.reports;
insert into public.reports (title, summary) values ('R8', '{}');   -- ditolak
select 'U10 riwayat ke-4 ditolak' t, count(*) = 3 ok from public.reports;
insert into public.pro_purchases (user_id, harga, mulai, sampai) values (auth.uid(), 0, '2026-12-14', '2099-01-01');   -- ditolak
select public.admin_set_situs(null, null);                                                                            -- ditolak: bukan admin
select public.admin_catat_pembelian(auth.uid(), 0, true, '');                                                          -- ditolak: bukan admin
select 'U11 pengguna tidak bisa mencatat pembelian/mengubah situs/membaca pengaturan langsung' t,
  (select count(*) from public.pro_purchases) = 0 and not (public.status_akun() ->> 'pro_aktif')::boolean ok;
select * from public.site_settings;                    -- ditolak (permission denied)
reset role;

-- admin
set role authenticated; select set_config('request.jwt.claim.sub','a3333333-3333-3333-3333-333333333333',false);
select public.admin_catat_pembelian('a1111111-1111-1111-1111-111111111111', 99000, true, 'sebelum dibuka');   -- ditolak: pembelian belum dibuka
select public.admin_set_situs('2026-12-13', '2027-01-01');
select public.tgl_uji('2027-01-31');   -- hari ke-30 sejak dibuka: masih boleh
select 'U12 klaim harga awal pada hari ke-30: Pro 1 tahun (mulai hari ini, sampai sehari sebelum ulang tahun)' t,
  public.admin_catat_pembelian('a1111111-1111-1111-1111-111111111111', 99000, true, 'transfer') = '{"mulai": "2027-01-31", "sampai": "2028-01-30"}'::jsonb ok;
select public.admin_catat_pembelian('a1111111-1111-1111-1111-111111111111', 99000, true, 'kedua');   -- ditolak: hanya tahun pertama
select public.admin_catat_pembelian('b2222222-2222-2222-2222-222222222222', 99000, true, '');        -- ditolak: bukan pengguna awal
select 'U13 perpanjangan saat Pro masih aktif dimulai setelah Pro lama berakhir (harga normal)' t,
  public.admin_catat_pembelian('a1111111-1111-1111-1111-111111111111', 149000, false, 'perpanjang') = '{"mulai": "2028-01-31", "sampai": "2029-01-30"}'::jsonb ok;
select public.tgl_uji('2027-02-01');   -- hari ke-31: lewat batas klaim
-- Pengguna awal kedua (dibuat sebagai superuser untuk uji) yang baru mengklaim pada hari ke-31.
reset role;
insert into auth.users (id, email) values ('c4444444-4444-4444-4444-444444444444','awal2@x.id');
update public.profiles set pengguna_awal = true where email = 'awal2@x.id';
set role authenticated; select set_config('request.jwt.claim.sub','a3333333-3333-3333-3333-333333333333',false);
select public.admin_catat_pembelian('c4444444-4444-4444-4444-444444444444', 99000, true, '');   -- ditolak: lewat 30 hari
select 'U14 klaim hari ke-31 ditolak; tetap 2 pembelian; Pro A sampai 2029-01-30' t,
  (select count(*) from public.pro_purchases) = 2 and (select pro_until from public.profiles where email='awal@x.id') = '2029-01-30'
  and (select pro_until from public.profiles where email='awal2@x.id') is null ok;
select 'U14b pengguna awal kedua tetap bisa membeli harga normal' t,
  (public.admin_catat_pembelian('c4444444-4444-4444-4444-444444444444', 149000, false, '') ->> 'mulai') = '2027-02-01' ok;
reset role;

-- pengguna awal setelah membeli
set role authenticated; select set_config('request.jwt.claim.sub','a1111111-1111-1111-1111-111111111111',false);
select 'U15 status_akun: Pro aktif, harga awal sudah terpakai, tanpa batas riwayat' t,
  (public.status_akun() ->> 'pro_aktif')::boolean and not (public.status_akun() ->> 'harga_awal_tersedia')::boolean and public.status_akun() -> 'batas_riwayat' = 'null'::jsonb ok;
insert into public.reports (title, summary) values ('R9', '{}');
select 'U16 akun Pro menyimpan riwayat ke-4' t, count(*) = 4 ok from public.reports;
select 'U17 pengguna melihat pembeliannya sendiri' t, count(*) = 2 ok from public.pro_purchases;
select set_config('request.jwt.claim.sub','b2222222-2222-2222-2222-222222222222',false);
select 'U18 pengguna lain tidak melihat pembelian A; tidak berhak harga awal' t,
  (select count(*) from public.pro_purchases) = 0 and not (public.status_akun() ->> 'harga_awal_tersedia')::boolean ok;
reset role;

-- admin mengakhiri beta lebih awal: pendaftar baru bukan pengguna awal, yang lama tetap
select public.tgl_uji('2026-11-10');
update public.site_settings set beta_gratis_sampai = '2026-11-09';
insert into auth.users (id, email) values ('d5555555-5555-5555-5555-555555555555','baru@x.id');
select 'U19 beta diakhiri: pendaftar baru bukan pengguna awal, pengguna awal lama tetap' t,
  not (select pengguna_awal from public.profiles where email='baru@x.id') and (select pengguna_awal from public.profiles where email='awal@x.id') ok;
