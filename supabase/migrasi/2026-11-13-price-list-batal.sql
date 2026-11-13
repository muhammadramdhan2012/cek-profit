-- =====================================================================
-- Cek Untung — MEMBATALKAN migrasi price list (2026-11-13-price-list.sql)
-- PERHATIAN: semua price list yang tersimpan di akun pengguna IKUT TERHAPUS dan tidak bisa dikembalikan.
-- Price list yang masih ada di browser pengguna tidak terhapus. Modal, pengaturan, dan profil tidak tersentuh.
-- Jalankan hanya bila diminta. Supabase: SQL Editor → New query → tempel → Run.
-- Setelah dibatalkan, website tetap jalan: price list hanya tersimpan di browser dengan pemberitahuan
-- "belum tersimpan di akun".
-- =====================================================================
alter table public.user_data drop constraint if exists user_data_price_list_size;
alter table public.user_data drop column if exists price_list;

-- Pemeriksaan: harus "0 rows" / tidak ada baris.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'user_data' and column_name = 'price_list';
