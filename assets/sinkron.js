/* Cek Untung — menggabungkan pengaturan di perangkat dengan pengaturan di akun (perbaikan M2, 13 Nov 2026).
 *
 * Murni: tanpa DOM dan tanpa localStorage. Satu-satunya jaringan adalah fungsi `baca`/`kirim` yang diberikan pemanggil
 * ke `sinkronkan`, sehingga semuanya bisa diuji di Node (tests/sinkron.test.js). Dipakai assets/app.js (dashboard).
 *
 * Aturan (disetujui pemilik 13 Nov 2026):
 *  - "Yang terbaru menang", per modal produk, per kunci pengaturan, dan per kunci profil.
 *  - Waktu ubah sama persis → isian yang sudah ada di AKUN dipertahankan. Data lama tanpa waktu ubah dianggap waktu 0,
 *    jadi data lama di akun menang atas data lama di perangkat (sama dengan perilaku sebelum perbaikan).
 *  - Modal yang dihapus dicatat di `catalogHapus` (bukan di `catalog`, agar mesin hitung tidak pernah melihatnya), dan
 *    catatan itu dibuang setelah 365 hari.
 *  - Bila membaca akun gagal, tidak ada yang dikirim (`sinkronkan` → 'tunda'): mengirim tanpa membaca bisa menimpa isian
 *    yang lebih baru dari perangkat lain.
 *
 * Bentuk data (tambahan, semua opsional; data lama tanpa field ini tetap terbaca):
 *  settings.catalog[i].diubah   waktu ubah (ms) modal itu
 *  settings.catalogHapus        [{ k: kunci modal, diubah: ms }]
 *  settings.diubahKunci         { packing: ms, fixedCosts: ms, … } per kunci pengaturan lain
 *  profile.diubahKunci          { store: ms, owner: ms, logo: ms }
 * Waktu memakai jam perangkat. Jam perangkat yang salah jauh bisa membuat isian kalah (risiko diketahui).
 */
const CekSinkron = (() => {
  const SIMPAN_HAPUS_MS = 365 * 24 * 3600 * 1000;
  const META = new Set(['catalog', 'catalogHapus', 'diubahKunci']);

  /** Kunci modal: kode (SKU/ID) bila ada, selain itu nama + variasi. Sama dengan kunci lama di app.js. */
  const kunciModal = (norm) => (e) => (e.kode ? `k:${norm(e.kode)}` : `n:${norm(`${e.nama} ${e.variasi || ''}`)}`);

  const waktu = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    /** JSON dengan kunci objek terurut, agar perbandingan tidak bergantung urutan kunci. */
  const kanon = (x) => (Array.isArray(x) ? `[${x.map(kanon).join(',')}]`
    : x && typeof x === 'object' ? `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${kanon(x[k])}`).join(',')}}`
      : JSON.stringify(x === undefined ? null : x));
  const sama = (a, b) => kanon(a) === kanon(b);
  const isiModal = (e) => { const { diubah, ...isi } = e; return kanon(isi); };
  const salin = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const kunciData = (obj) => Object.keys(obj || {}).filter((k) => !META.has(k));

  /** Buang catatan hapus yang lebih tua dari 365 hari. */
  const pangkas = (hapus, kini) => (hapus || []).filter((h) => waktu(h.diubah) >= kini - SIMPAN_HAPUS_MS);

  /** Beri waktu ubah pada kunci objek (selain META) yang nilainya berbeda dari `sebelum`. */
  function tandaiKunci(sebelum, sesudah, kini) {
    const stempel = { ...((sesudah && sesudah.diubahKunci) || (sebelum && sebelum.diubahKunci) || {}) };
    for (const k of new Set([...kunciData(sebelum), ...kunciData(sesudah)])) {
      if (!sama((sebelum || {})[k], (sesudah || {})[k])) stempel[k] = kini;
    }
    return stempel;
  }

  /**
   * Tandai perubahan sejak penyimpanan terakhir. `sebelum` = salinan pengaturan saat terakhir disimpan/digabung.
   * Mengembalikan pengaturan baru (tidak mengubah masukan).
   */
  function tandai(sebelum, sesudah, kini, kunci) {
    const lama = new Map((sebelum.catalog || []).map((e) => [kunci(e), e]));
    const ada = new Set();
    const catalog = (sesudah.catalog || []).map((e) => {
      const k = kunci(e); ada.add(k);
      const dulu = lama.get(k);
      const tetap = dulu && isiModal(dulu) === isiModal(e);
      return { ...e, diubah: tetap ? (dulu.diubah ?? e.diubah) : kini };
    });
    for (const e of catalog) if (e.diubah === undefined) delete e.diubah;   // entri lama yang tidak diubah tetap tanpa waktu
    const hapus = new Map((sesudah.catalogHapus || sebelum.catalogHapus || []).map((h) => [h.k, h]));
    for (const k of lama.keys()) if (!ada.has(k)) hapus.set(k, { k, diubah: kini });
    for (const k of ada) hapus.delete(k);
    return { ...sesudah, catalog, catalogHapus: pangkas([...hapus.values()], kini), diubahKunci: tandaiKunci(sebelum, sesudah, kini) };
  }

  /** Tandai perubahan profil (nama toko, pemilik, logo). */
  const tandaiProfil = (sebelum, sesudah, kini) => ({ ...sesudah, diubahKunci: tandaiKunci(sebelum, sesudah, kini) });

  /** Keadaan satu kunci modal di satu sisi: entri, catatan hapus, atau tidak ada. */
  function keadaan(entri, hapus) {
    if (entri && hapus) return waktu(hapus.diubah) > waktu(entri.diubah) ? { hapus } : { entri };
    if (entri) return { entri };
    if (hapus) return { hapus };
    return null;
  }
  const waktuKeadaan = (s) => (s.entri ? waktu(s.entri.diubah) : waktu(s.hapus.diubah));
  const samaKeadaan = (a, b) => (!a && !b) || (!!a && !!b && (a.entri ? !!b.entri && isiModal(a.entri) === isiModal(b.entri) : !b.entri));

  /** Pilih sisi: lokal hanya menang bila waktunya LEBIH BARU; waktu sama → akun. */
  const pilih = (lokal, akun) => {
    if (!akun) return lokal;
    if (!lokal) return akun;
    return waktuKeadaan(lokal) > waktuKeadaan(akun) ? lokal : akun;
  };

  function gabungKunci(lokal, akun) {
    const hasil = {}, stempel = {};
    const sl = (lokal && lokal.diubahKunci) || {}, sa = (akun && akun.diubahKunci) || {};
    for (const k of new Set([...kunciData(lokal), ...kunciData(akun)])) {
      const diAkun = akun && Object.prototype.hasOwnProperty.call(akun, k);
      const diLokal = lokal && Object.prototype.hasOwnProperty.call(lokal, k);
      const pakaiLokal = diLokal && (!diAkun || waktu(sl[k]) > waktu(sa[k]));
      hasil[k] = salin(pakaiLokal ? lokal[k] : akun[k]);
      const t = pakaiLokal ? sl[k] : sa[k];
      if (t !== undefined) stempel[k] = t;
    }
    return { hasil, stempel };
  }

  /**
   * Gabungkan pengaturan di perangkat (`lokal`) dengan pengaturan di akun (`akun`).
   * Mengembalikan { settings, kalah }: `kalah` = jumlah modal di perangkat ini yang diganti isian dari akun.
   * Urutan modal: urutan di akun, lalu modal yang hanya ada di perangkat (sama dengan cara lama).
   */
  function gabung(lokal, akun, kini, kunci) {
    lokal = lokal || {}; akun = akun || {};
    const peta = (arr) => { const m = new Map(); for (const e of arr || []) m.set(kunci(e), e); return m; };
    const petaH = (arr) => new Map((arr || []).map((h) => [h.k, h]));
    const eL = peta(lokal.catalog), eA = peta(akun.catalog), hL = petaH(lokal.catalogHapus), hA = petaH(akun.catalogHapus);
    const urutan = [...eA.keys(), ...eL.keys(), ...hA.keys(), ...hL.keys()].filter((k, i, a) => a.indexOf(k) === i);
    const catalog = [], hapus = [];
    let kalah = 0;
    for (const k of urutan) {
      const sL = keadaan(eL.get(k), hL.get(k)), sA = keadaan(eA.get(k), hA.get(k));
      const s = pilih(sL, sA);
      if (sL && s === sA && !samaKeadaan(sL, sA) && sL.entri) kalah++;
      if (s.entri) catalog.push(salin(s.entri)); else hapus.push(salin(s.hapus));
    }
    const { hasil, stempel } = gabungKunci(lokal, akun);
    return { settings: { ...hasil, catalog, catalogHapus: pangkas(hapus, kini), diubahKunci: stempel }, kalah };
  }

  /** Gabungkan profil per kunci (nama toko, pemilik, logo). */
  function gabungProfil(lokal, akun) {
    const { hasil, stempel } = gabungKunci(lokal || {}, akun || {});
    return { ...hasil, diubahKunci: stempel };
  }

  /**
   * Satu putaran sinkron: BACA akun → gabung → kirim hasil gabungan bila berbeda dari isi akun.
   * Bila membaca gagal, tidak ada yang dikirim → { status: 'tunda' }.
   * @returns {Promise<{status:'tunda'|'terkirim'|'sama'|'gagal-kirim', settings?, profile?, kalah?}>}
   */
  async function sinkronkan({ baca, kirim, settings, profile, kini, kunci }) {
    let data;
    try { data = await baca(); } catch (e) { return { status: 'tunda', galat: e }; }
    const akunS = (data && data.settings) || {}, akunP = (data && data.profile) || {};
    const g = gabung(settings, akunS, kini, kunci);
    const p = gabungProfil(profile, akunP);
    const beda = !sama(g.settings, akunS) || !sama(p, akunP);
    if (!beda) return { status: 'sama', settings: g.settings, profile: p, kalah: g.kalah };
    try { await kirim({ settings: g.settings, profile: p }); }
    catch (e) { return { status: 'gagal-kirim', galat: e, settings: g.settings, profile: p, kalah: g.kalah }; }
    return { status: 'terkirim', settings: g.settings, profile: p, kalah: g.kalah };
  }

  return { kunciModal, tandai, tandaiProfil, gabung, gabungProfil, sinkronkan, SIMPAN_HAPUS_MS };
})();
if (typeof module !== 'undefined') module.exports = CekSinkron;
