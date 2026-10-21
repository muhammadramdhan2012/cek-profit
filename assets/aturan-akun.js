/* Aturan formulir akun: kata sandi baru dan nomor HP/WhatsApp.
 *
 * Murni (tanpa DOM) agar bisa diuji di Node (tests/cloud.test.js). Dipakai halaman akun.html.
 * Aturan kata sandi di sini harus SAMA dengan pengaturan Supabase (Authentication → Policies/Passwords):
 * panjang minimal 8 dan "lowercase, uppercase letters and digits". Browser hanya memberi umpan balik lebih awal;
 * yang menegakkan aturan tetap server.
 */
const CekAturanAkun = (() => {
  const SANDI_MIN = 8;
  const SANDI_MAKS = 72;   // batas Supabase Auth (bcrypt)
  const SYARAT = [
    { id: 'panjang', teks: 'Minimal 8 karakter', label: 'minimal 8 karakter', cek: (s) => s.length >= SANDI_MIN },
    { id: 'kapital', teks: 'Huruf kapital (A–Z)', label: 'huruf kapital', cek: (s) => /[A-Z]/.test(s) },
    { id: 'kecil', teks: 'Huruf kecil (a–z)', label: 'huruf kecil', cek: (s) => /[a-z]/.test(s) },
    { id: 'angka', teks: 'Angka (0–9)', label: 'angka', cek: (s) => /[0-9]/.test(s) },
  ];

  /** Status tiap syarat untuk kata sandi BARU (daftar, ganti sandi). Simbol boleh dan tidak diwajibkan. */
  function cekSandi(sandi) {
    const s = String(sandi ?? '');
    const hasil = {};
    for (const x of SYARAT) hasil[x.id] = x.cek(s);
    hasil.ok = SYARAT.every((x) => hasil[x.id]) && s.length <= SANDI_MAKS;
    return hasil;
  }

  /** Pesan untuk kata sandi baru yang belum memenuhi syarat, atau '' bila sudah. */
  function pesanSandi(sandi) {
    const s = String(sandi ?? '');
    if (!s) return 'Kata sandi wajib diisi.';
    if (s.length > SANDI_MAKS) return `Kata sandi maksimal ${SANDI_MAKS} karakter.`;
    const h = cekSandi(s);
    if (h.ok) return '';
    return `Kata sandi belum memenuhi syarat: ${SYARAT.filter((x) => !h[x.id]).map((x) => x.label).join(', ')}.`;
  }

  /**
   * Nomor HP Indonesia → format +62. Kosong diperbolehkan (nilai '').
   * Menerima 08…, 8…, 62…, +62…, termasuk spasi, titik, tanda hubung, dan kurung. Nomor tidak dianggap terverifikasi.
   * @returns {{ok: boolean, nilai: string}}
   */
  function normalisasiHp(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return { ok: true, nilai: '' };
    if (!/^\+?[\d\s().-]+$/.test(raw)) return { ok: false, nilai: '' };
    let d = raw.replace(/[\s().-]/g, '');
    const plus = d.startsWith('+');
    if (plus) d = d.slice(1);
    if (d.startsWith('62')) d = d.slice(2).replace(/^0/, '');
    else if (plus) return { ok: false, nilai: '' };          // kode negara selain Indonesia
    else if (d.startsWith('0')) d = d.slice(1);
    if (!/^8\d{8,11}$/.test(d)) return { ok: false, nilai: '' };
    return { ok: true, nilai: `+62${d}` };
  }
  const PESAN_HP = 'Nomor HP belum valid. Gunakan nomor Indonesia, contoh 081234567890.';

  return { SYARAT, SANDI_MIN, SANDI_MAKS, cekSandi, pesanSandi, normalisasiHp, PESAN_HP };
})();
if (typeof module !== 'undefined') module.exports = CekAturanAkun;
