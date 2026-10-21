-- =====================================================================================================
-- JADIKAN SATU AKUN ADMIN — HANYA UNTUK PROJECT SUPABASE STAGING (cekuntung-staging, ref epyhhazihfolbdtjxxfd).
-- JANGAN PERNAH DIJALANKAN DI PRODUKSI. File ini menolak berjalan bila penanda staging tidak cocok.
--
-- Cara pakai (SQL Editor project cekuntung-staging):
--   1. Ganti GANTI_DENGAN_EMAIL_ADMIN_UJI dengan email akun uji yang SUDAH daftar & konfirmasi email di preview.
--   2. Run. Hasilnya satu baris ringkasan. Bila ada pemeriksaan gagal, TIDAK ADA yang diubah (seluruh blok dibatalkan).
-- Hanya mengubah profiles.is_admin untuk SATU akun, dan mencatatnya di pro_audit_log.
-- =====================================================================================================
do $$
declare
  v_email   text := lower(trim('GANTI_DENGAN_EMAIL_ADMIN_UJI'));
  v_ref     text;
  v_id      uuid;
  v_jumlah  int;
  v_lama    boolean;
begin
  -- 1. Pastikan ini project STAGING yang benar (fungsi penanda hanya ada di staging).
  if to_regprocedure('public.info_lingkungan()') is null then
    raise exception 'DIBATALKAN: penanda staging tidak ada. Kemungkinan ini BUKAN project staging.';
  end if;
  v_ref := public.info_lingkungan() ->> 'ref';
  if v_ref is distinct from 'epyhhazihfolbdtjxxfd' or (public.info_lingkungan() ->> 'lingkungan') is distinct from 'staging' then
    raise exception 'DIBATALKAN: ref project % bukan cekuntung-staging (epyhhazihfolbdtjxxfd).', coalesce(v_ref, '(kosong)');
  end if;
  if v_ref = 'ikjcbgfexhpksbewkpym' then
    raise exception 'DIBATALKAN: ini ref PRODUKSI.';
  end if;

  -- 2. Email harus diisi dan cocok dengan tepat satu akun yang sudah konfirmasi email.
  if v_email = '' or v_email like 'ganti_dengan%' or v_email not like '%@%' then
    raise exception 'DIBATALKAN: isi email admin uji terlebih dahulu.';
  end if;
  select count(*) into v_jumlah from auth.users where lower(email) = v_email;
  if v_jumlah <> 1 then
    raise exception 'DIBATALKAN: ditemukan % akun dengan email %. Harus tepat 1.', v_jumlah, v_email;
  end if;
  select id into v_id from auth.users where lower(email) = v_email and email_confirmed_at is not null;
  if v_id is null then
    raise exception 'DIBATALKAN: email % belum dikonfirmasi. Klik tautan konfirmasi dulu.', v_email;
  end if;
  select is_admin into v_lama from public.profiles where id = v_id for update;
  if not found then
    raise exception 'DIBATALKAN: profil akun ini tidak ada (trigger pendaftaran tidak berjalan?).';
  end if;

  -- 3. Ubah satu baris + catat jejak.
  update public.profiles set is_admin = true where id = v_id;
  insert into public.pro_audit_log (aksi, lama, baru, alasan)
  values ('set_admin_staging', jsonb_build_object('user_id', v_id, 'is_admin', v_lama),
          jsonb_build_object('user_id', v_id, 'is_admin', true), 'SQL Editor staging: jadikan-admin-staging.sql');
  raise notice 'OK: % sekarang admin di cekuntung-staging (sebelumnya is_admin = %).', v_email, v_lama;
end $$;

-- Ringkasan (hanya membaca).
select p.email, p.is_admin, u.email_confirmed_at is not null as email_terkonfirmasi,
       (select count(*) from public.profiles where is_admin) as total_admin
from public.profiles p join auth.users u on u.id = p.id
where p.is_admin order by p.email;
