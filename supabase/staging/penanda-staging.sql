-- =====================================================================================================
-- PENANDA STAGING — HANYA UNTUK PROJECT SUPABASE STAGING. JANGAN PERNAH DIJALANKAN DI PRODUKSI.
--
-- Fungsi public.info_lingkungan() dipanggil website (assets/situs.js) di alamat staging. Pita "STAGING" hanya tampil
-- bila database menjawab {"lingkungan":"staging","ref":"<ref project>"} DAN ref itu sama dengan URL yang dipakai.
-- Di produksi fungsi ini tidak ada, sehingga website menampilkan PERINGATAN, bukan pita STAGING.
--
-- Cara pakai (pemilik, di SQL Editor project STAGING):
--   1. Ganti GANTI_DENGAN_REF_STAGING di bawah dengan ref project staging (20 huruf/angka dari URL
--      https://<ref>.supabase.co). Ref produksi (ikjcbgfexhpksbewkpym) ditolak.
--   2. Run. Aman dijalankan ulang.
-- Fungsi tidak membaca tabel apa pun dan tidak mengembalikan data pengguna.
-- =====================================================================================================
do $$
declare
  v_ref text := 'GANTI_DENGAN_REF_STAGING';
begin
  if v_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'Isi v_ref dengan ref project STAGING (20 huruf kecil/angka) sebelum menjalankan file ini.';
  end if;
  if v_ref = 'ikjcbgfexhpksbewkpym' then
    raise exception 'Ref ini milik project PRODUKSI. File penanda staging tidak boleh dijalankan di produksi.';
  end if;
  execute format($f$
    create or replace function public.info_lingkungan()
    returns jsonb language sql immutable set search_path = ''
    as $b$ select jsonb_build_object('lingkungan', 'staging', 'ref', %L) $b$;
  $f$, v_ref);
end $$;

revoke all on function public.info_lingkungan() from public;
grant execute on function public.info_lingkungan() to anon, authenticated;
