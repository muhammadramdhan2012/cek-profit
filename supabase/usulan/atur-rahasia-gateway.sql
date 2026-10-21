-- Pasang HASH rahasia gateway (bukan rahasianya). Jalankan SETELAH usulan/qris-midtrans.sql, sekali per project
-- (staging dan produksi memakai rahasia BERBEDA).
--
-- 1. Di Terminal Mac Anda (bukan di chat, bukan di SQL Editor), buat rahasia acak dan hash-nya:
--      RAHASIA=$(openssl rand -hex 32); echo "$RAHASIA"; printf %s "$RAHASIA" | shasum -a 256
--    Baris pertama = RAHASIA → simpan sebagai secret Edge Function GATEWAY_SECRET (Supabase → Edge Functions → Secrets).
--    Baris kedua (64 huruf/angka sebelum tanda "-") = HASH → tempel di bawah menggantikan GANTI_DENGAN_HASH_64_KARAKTER.
-- 2. Run. Database hanya menyimpan hash, sehingga riwayat SQL Editor tidak memuat rahasianya.
insert into public.gateway_rahasia (id, hash)
values (1, lower(trim('GANTI_DENGAN_HASH_64_KARAKTER')))
on conflict (id) do update set hash = excluded.hash, diubah_pada = now();

-- Pemeriksaan (tidak menampilkan hash): harus 1 baris, panjang 64.
select count(*) as baris, max(length(hash)) as panjang_hash from public.gateway_rahasia;
