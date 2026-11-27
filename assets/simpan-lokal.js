/* Simpan hasil olahan laporan di perangkat pengguna (IndexedDB), agar tidak hilang saat halaman dimuat ulang.
 * Keputusan pemilik 27 Nov 2026 ("setuju rencana"):
 *  - hanya untuk pengguna yang masuk ke akun; tamu tidak disimpan;
 *  - yang disimpan HASIL OLAHAN (bukan file asli), tanpa catatan bebas dari pembeli (bisa berisi alamat);
 *  - satu data per perangkat, milik satu akun; akun lain / tanpa akun → dihapus;
 *  - dihapus saat keluar, lewat tombol hapus, atau bila mesin hitung berubah versi (data lama tidak dipakai menebak).
 * Data tidak pernah dikirim ke server.
 * Bagian murni (bungkus/buka/bersihkan) diuji di Node: node tests/simpan-lokal.test.js */
const CekSimpanLokal = (() => {
  const FORMAT = 1;
  const DB = 'cekprofit', STORE = 'laporan', KUNCI = 'aktif';
  // Kolom teks bebas yang diisi pembeli (alasan/catatan retur). Tidak disimpan: data minimal.
  const TEKS_PEMBELI = ['note'];

  const salin = (x) => JSON.parse(JSON.stringify(x));

  /** Satu file hasil baca → bentuk yang aman disimpan. File gagal baca / template modal tidak disimpan. */
  function bersihkan(f) {
    if (!f || f.error || !f.parsed || f.parsed.kind === 'modal_template') return null;
    const x = salin({ name: f.name, kind: f.kind, parsed: f.parsed, saldo: f.saldo, expect: f.expect, note: f.note, warn: f.warn });
    if (Array.isArray(x.parsed.cases)) for (const c of x.parsed.cases) for (const k of TEKS_PEMBELI) if (k in c) c[k] = '';
    return x;
  }

  /** Bungkus daftar file untuk disimpan. versiMesin = penanda versi mesin hitung (hash engine.js). */
  function bungkus(files, { userId, versiMesin, waktu = new Date().toISOString() }) {
    if (!userId) return null;
    const isi = (files || []).map(bersihkan).filter(Boolean);
    if (!isi.length) return null;
    return { format: FORMAT, userId: String(userId), versiMesin: String(versiMesin || ''), waktu, files: isi };
  }

  /**
   * Buka data tersimpan. Hasil: { files, waktu } bila boleh dipakai, atau { tolak: alasan }.
   * Alasan: kosong | akun_lain | format | versi_mesin.
   */
  function buka(rec, { userId, versiMesin }) {
    if (!rec || !Array.isArray(rec.files) || !rec.files.length) return { tolak: 'kosong' };
    if (!userId || String(rec.userId) !== String(userId)) return { tolak: 'akun_lain' };
    if (rec.format !== FORMAT) return { tolak: 'format' };
    if (!versiMesin || rec.versiMesin !== String(versiMesin)) return { tolak: 'versi_mesin' };
    return { files: rec.files, waktu: rec.waktu };
  }

  /* ---------- IndexedDB (hanya di browser) ---------- */
  const adaIDB = () => typeof indexedDB !== 'undefined';
  function bukaDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('blocked'));
    });
  }
  async function jalan(mode, fn) {
    const db = await bukaDB();
    try {
      return await new Promise((res, rej) => {
        const tx = db.transaction(STORE, mode), st = tx.objectStore(STORE);
        let hasil;
        const q = fn(st);
        if (q) q.onsuccess = () => { hasil = q.result; };
        tx.oncomplete = () => res(hasil);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
      });
    } finally { db.close(); }
  }
  /** Simpan; true bila berhasil. Gagal (mis. penyimpanan penuh) → false, pemanggil memberi tahu pengguna. */
  async function simpan(rec) {
    if (!adaIDB()) return false;
    try { await jalan('readwrite', (st) => (rec ? st.put(rec, KUNCI) : st.delete(KUNCI))); return true; } catch (e) { return false; }
  }
  async function muat() {
    if (!adaIDB()) return null;
    try { return (await jalan('readonly', (st) => st.get(KUNCI))) || null; } catch (e) { return null; }
  }
  async function hapus() { return simpan(null); }

  return { FORMAT, bersihkan, bungkus, buka, simpan, muat, hapus };
})();
if (typeof module !== 'undefined') module.exports = CekSimpanLokal;
