-- PEMERIKSAAN STAGING (hanya membaca katalog; tidak mengubah apa pun). Jalankan di SQL Editor project STAGING setelah
-- schema.sql, pro-sekali-bayar.sql, dan penanda-staging.sql. Setiap baris harus ok = true.
with
-- Dibatasi ke objek milik Cek Untung, agar tabel/fungsi bawaan Supabase (mis. fungsi RLS otomatis) tidak memicu alarm palsu.
tabel as (select c.oid, c.relname, c.relrowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname in ('profiles','user_data','reports','upgrade_requests','pengaturan_pembayaran','pro_order_events','pro_payments','pro_audit_log')),
definer as (select p.proname, coalesce(array_to_string(p.proconfig, ','), '') cfg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and (p.proname like 'admin\_%' or p.proname like '\_%' or p.proname in ('buat_pesanan_pro','konfirmasi_sudah_bayar','batalkan_pesanan','is_admin','handle_new_user','cek_batas_riwayat')))
select * from (values
 ('01 project ini BUKAN produksi (penanda staging ada, ref bukan produksi)',
   to_regprocedure('public.info_lingkungan()') is not null and (select public.info_lingkungan()->>'ref') <> 'ikjcbgfexhpksbewkpym'),
 ('02 delapan tabel aplikasi ada',
   (select count(*) from tabel where relname in ('profiles','user_data','reports','upgrade_requests','pengaturan_pembayaran','pro_order_events','pro_payments','pro_audit_log')) = 8),
 ('03 RLS aktif di 8 tabel Cek Untung', not exists (select 1 from tabel where not relrowsecurity)),
 ('04 setiap tabel Cek Untung punya policy', not exists (select 1 from tabel t where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname))),
 ('05 anon tidak punya hak apa pun di tabel Cek Untung',
   not exists (select 1 from tabel t where has_table_privilege('anon', t.oid, 'select') or has_table_privilege('anon', t.oid, 'insert') or has_table_privilege('anon', t.oid, 'update') or has_table_privilege('anon', t.oid, 'delete'))),
 ('06 login: hanya boleh baca tabel pembayaran (tanpa insert/update/delete langsung)',
   not exists (select 1 from tabel t where t.relname in ('upgrade_requests','pro_order_events','pro_payments','pro_audit_log')
     and (has_table_privilege('authenticated', t.oid, 'insert') or has_table_privilege('authenticated', t.oid, 'delete') or has_table_privilege('authenticated', t.oid, 'update')))
   and (select bool_and(has_table_privilege('authenticated', t.oid, 'select')) from tabel t)),
 ('07 kolom sensitif profil tidak bisa diubah pengguna',
   not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'update') and not has_column_privilege('authenticated', 'public.profiles', 'pro_until', 'update')
   and not has_column_privilege('authenticated', 'public.profiles', 'pro_sekali_bayar', 'update')),
 ('08 Data API: login boleh simpan modal & riwayat sendiri',
   has_table_privilege('authenticated', 'public.user_data', 'insert') and has_table_privilege('authenticated', 'public.reports', 'insert')),
 ('09 semua fungsi security definer Cek Untung mengunci search_path', (select count(*) from definer) >= 19 and not exists (select 1 from definer where cfg not like 'search_path=%')),
 ('10 fungsi admin & pembeli: anon tidak bisa, login bisa (admin tetap dicek is_admin)',
   (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'admin\_%' or p.proname in ('buat_pesanan_pro','konfirmasi_sudah_bayar','batalkan_pesanan')))),
 ('11 fungsi internal tidak bisa dipanggil pengguna',
   (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_audit','_catat_event','_aktifkan_dari_pesanan','_audit_pengaturan'))),
 ('12 trigger profil otomatis & audit pengaturan terpasang',
   exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') and exists (select 1 from pg_trigger where tgname = 'audit_pengaturan')),
 ('13 pembayaran nonaktif, data rekening/QRIS kosong',
   (select bool_and(not aktif and coalesce(bank_nomor,'') = '' and coalesce(qris_gambar,'') = '') from public.pengaturan_pembayaran)
   and (select count(*) from public.pengaturan_pembayaran) = 1),
 ('14 belum ada data pengguna/transaksi (project baru)',
   (select count(*) from public.pro_payments) = 0 and (select count(*) from public.upgrade_requests) = 0)
) as h(pemeriksaan, ok) order by 1;
