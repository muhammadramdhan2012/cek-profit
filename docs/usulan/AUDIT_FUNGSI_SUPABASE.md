# Audit fungsi Supabase — peringatan Security Advisor staging (21 Okt 2026)

Status: **USULAN; patch belum dijalankan di Supabase mana pun.** Patch: `supabase/usulan/hardening-fungsi.sql`.
Tes: `supabase/usulan/test-hardening.sql` (H1–H14) dengan `supabase/tests/shim-tanpa-ekspos.sql`.

## Asal 22 peringatan

Supabase memberi hak EXECUTE setiap fungsi baru **langsung** ke `anon` dan `authenticated` (opsi "Automatically expose new
tables" hanya mengatur tabel). Tiruan lokal dengan perilaku yang sama menghasilkan daftar yang persis 22:

| Lint Supabase | Jumlah | Fungsi |
|---|---|---|
| Function Search Path Mutable | 1 | `_norm_ref` |
| Public (anon) Can Execute SECURITY DEFINER | 4 | `cek_batas_riwayat`, `handle_new_user`, `is_admin`, `rls_auto_enable` |
| Signed-In Users Can Execute SECURITY DEFINER | 17 | 4 di atas + 10 RPC admin + 3 RPC pembeli (`buat_pesanan_pro`, `konfirmasi_sudah_bayar`, `batalkan_pesanan`) |

Fungsi internal `_audit`, `_catat_event`, `_aktifkan_dari_pesanan`, `_audit_pengaturan` **tidak** termasuk: hak
EXECUTE-nya sudah dicabut migrasi v3.

## Temuan

**P0: tidak ada.** Tidak ada jalur bagi pengguna biasa untuk mengaktifkan Pro, mengubah dana, membaca data akun lain, atau
mematikan RLS.

**P1: tidak ada.**

**P2: diperbaiki oleh patch (kebersihan hak akses, tidak bisa dieksploitasi saat ini):**

| # | Temuan | Kenapa bukan celah nyata | Perbaikan |
|---|---|---|---|
| P2-1 | `_norm_ref` tanpa `search_path` | Bukan SECURITY DEFINER; fungsi murni; dipanggil dari fungsi admin yang search_path-nya terkunci | `set search_path = ''` (juga di sumber v3) |
| P2-2 | `handle_new_user`, `cek_batas_riwayat` bisa dieksekusi anon/login | Fungsi trigger: PostgreSQL menolak pemanggilan langsung ("can only be called as triggers") | Cabut EXECUTE dari `public, anon, authenticated`. Trigger tetap berjalan karena EXECUTE hanya diperiksa saat `CREATE TRIGGER` (tes H1, H11) |
| P2-3 | `is_admin` bisa dieksekusi anon | Hanya menjawab "apakah saya admin" untuk pemanggil sendiri; anon selalu `false` | Cabut dari `public, anon`. **Tetap** untuk `authenticated` karena dipakai policy RLS (tes H9, H10) |
| P2-4 | `is_admin`, `handle_new_user` (dari `schema.sql`) memakai `search_path = public` tanpa `pg_temp` | Tidak bisa dieksploitasi lewat Data API (pengguna tidak bisa membuat tabel sementara) | `search_path = public, pg_temp` |

**Peringatan yang sengaja diterima (by design):**

| Fungsi | Alasan diterima | Pengaman |
|---|---|---|
| 10 RPC admin (`admin_*`) | Website admin memanggilnya lewat Data API dengan sesi login | Baris pertama setiap fungsi `if not public.is_admin() then raise exception 'Hanya admin'`. Tes H8 memanggil ke-10 fungsi sebagai seller: semuanya ditolak "Hanya admin" |
| 3 RPC pembeli | Checkout memang dipanggil pembeli | Hanya bekerja pada `auth.uid()` sendiri; harga dari server; tidak bisa mengaktifkan Pro (tes O/V di `test-pro-sekali-bayar.sql`) |
| `is_admin` (login) | Wajib untuk RLS | Tidak menerima argumen; hanya membaca baris profil pemanggil |
| `rls_auto_enable` (anon & login) | Dibuat Supabase untuk opsi "Enable automatic RLS"; bukan milik kita | Bertipe `event_trigger`, tidak bisa dipanggil langsung (tes H13). Tidak diubah agar tidak bentrok dengan pengelolaan Supabase |

Perkiraan Security Advisor setelah patch: **0 error, 16 peringatan** (14 by design + 2 `rls_auto_enable`).

## Rekomendasi lanjutan (belum dikerjakan, perlu keputusan pemilik)

- **P2-5:** pindahkan `is_admin` dan fungsi internal ke schema non-publik (mis. `private`) agar tidak terlihat di Data API
  sama sekali. Ini mengubah policy dan semua fungsi admin, jadi butuh migrasi terencana.
- **P2-6:** pembeli bisa membaca kolom `note` dan `created_by` pada baris `pro_payments` miliknya lewat Data API (website tidak
  menampilkannya). Usulan: hak SELECT per kolom.

## Catatan pemeliharaan

Menjalankan ulang `schema.sql` mengembalikan `search_path` `is_admin`/`handle_new_user` ke nilai lama (hak EXECUTE tetap
tercabut). **Setiap kali `schema.sql` atau migrasi dijalankan ulang, jalankan ulang `hardening-fungsi.sql`.**

Tidak ada perubahan pada mesin hitung, tabel, data, atau RLS. `schema.sql` produksi tidak diubah.
