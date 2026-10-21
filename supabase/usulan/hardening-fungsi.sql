-- ============================================================================================================
-- HARDENING HAK FUNGSI (usulan, 21 Okt 2026) — dijalankan SETELAH schema.sql dan usulan/pro-sekali-bayar.sql.
-- Staging dulu. Produksi hanya dengan persetujuan pemilik, bersama migrasi pembayaran.
--
-- Bukan migrasi ulang: tidak membuat/menghapus tabel, tidak mengubah data, tidak mengubah isi fungsi, tidak menyentuh RLS.
-- Hanya: (1) mengunci search_path, (2) mencabut EXECUTE yang tidak dibutuhkan siapa pun. Aman dijalankan berulang kali.
--
-- Latar: Supabase memberi EXECUTE setiap fungsi baru langsung ke anon & authenticated. Security Advisor staging:
-- 22 peringatan = 1 search_path _norm_ref + 4 fungsi SECURITY DEFINER yang bisa dipanggil anon + 17 yang bisa dipanggil
-- pengguna login. Rincian dan alasan per fungsi: docs/usulan/AUDIT_FUNGSI_SUPABASE.md.
-- ============================================================================================================

-- 1. _norm_ref: fungsi murni (upper/regexp_replace/coalesce dari pg_catalog). search_path kosong = tidak bisa dibelokkan.
alter function public._norm_ref(text) set search_path = '';

-- 2. Fungsi TRIGGER tidak pernah dipanggil langsung oleh pengguna. PostgreSQL hanya memeriksa EXECUTE saat CREATE TRIGGER
--    (oleh pemilik), bukan saat trigger berjalan, sehingga pendaftaran akun & batas riwayat tetap bekerja.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
do $$ begin
  if to_regprocedure('public.cek_batas_riwayat()') is not null then   -- bagian opsional migrasi (batas 3 riwayat)
    revoke execute on function public.cek_batas_riwayat() from public, anon, authenticated;
  end if;
end $$;

-- 3. is_admin(): dipakai di policy RLS, dan policy dievaluasi dengan hak pengguna yang membuat query → pengguna login
--    WAJIB tetap bisa mengeksekusinya. anon tidak punya akses tabel sama sekali, jadi tidak membutuhkannya.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 4. search_path pg_temp terakhir untuk dua fungsi SECURITY DEFINER dari schema.sql (sama dengan fungsi migrasi).
alter function public.is_admin() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;

-- 5. Penegasan ulang (idempoten): fungsi internal tidak bisa dipanggil pengguna; RPC tidak bisa dipanggil anon.
do $$
declare f text;
begin
  foreach f in array array[
    '_catat_event(bigint, text, text, text, boolean)', '_audit(text, bigint, bigint, jsonb, jsonb, text)',
    '_aktifkan_dari_pesanan(public.upgrade_requests, bigint, integer, text)', '_audit_pengaturan()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'buat_pesanan_pro(text)', 'konfirmasi_sudah_bayar(bigint, text)', 'batalkan_pesanan(bigint)',
    'admin_verifikasi_pesanan(bigint, text, text, integer, text)', 'admin_catat_dana_masuk(text, text, integer, text)',
    'admin_hubungkan_dana(bigint, bigint, text)', 'admin_catat_pembayaran_tambahan(bigint, text, text, integer, text)',
    'admin_refund_pembayaran(bigint, integer, text, boolean)', 'admin_koreksi_referensi(bigint, text, text)',
    'admin_catatan_pesanan(bigint, text, boolean)', 'admin_tolak_pesanan(bigint, text, text)', 'admin_cabut_pro(uuid, text)',
    'admin_set_pro(uuid, date)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- public.rls_auto_enable() SENGAJA tidak disentuh: milik Supabase (opsi "Enable automatic RLS"), bertipe event_trigger
-- sehingga tidak bisa dipanggil langsung. Mengubahnya bisa bentrok dengan pengelolaan Supabase.

notify pgrst, 'reload schema';
