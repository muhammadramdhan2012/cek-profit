-- =====================================================================
-- Cek Untung — price list di akun (Langkah 2a, disetujui pemilik 13 Nov 2026)
-- Jalankan di Supabase: SQL Editor → New query → tempel SEMUA isi file ini → Run.
-- Aman dijalankan ulang. Isi yang sama juga sudah ada di supabase/schema.sql.
--
-- Apa yang berubah:
--  - Kolom baru user_data.price_list (jsonb, bawaan {}): baris price list seller (kode, nama, variasi, harga).
--    Dipisah dari kolom settings agar price list besar tidak ikut dikirim setiap kali modal/pengaturan disimpan.
--  - Batas ukuran sendiri: < 3.000.000 byte (± 30.000 baris berjudul pendek). Batas lama settings + profil tetap.
--  - Keamanan: kolom ini ikut aturan RLS baris yang SUDAH ADA ("data: milik sendiri"): pengguna hanya bisa membaca
--    dan menulis baris miliknya. Tidak ada policy atau hak akses baru.
--  - File price list mentah TIDAK disimpan; hanya baris terstruktur. Data pembeli tidak ada di price list.
-- Batalkan: supabase/migrasi/2026-11-13-price-list-batal.sql
-- =====================================================================
alter table public.user_data add column if not exists price_list jsonb not null default '{}'::jsonb;
alter table public.user_data drop constraint if exists user_data_price_list_size;
alter table public.user_data add constraint user_data_price_list_size
  check (jsonb_typeof(price_list) = 'object' and octet_length(price_list::text) < 3000000);

-- Pemeriksaan: harus menampilkan satu baris "price_list | jsonb".
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'user_data' and column_name = 'price_list';
