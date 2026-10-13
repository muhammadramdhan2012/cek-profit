/* Kode akses Cek Profit Pro.
 *
 * Format: CP1.<payload base64url>.<tanda tangan base64url>
 *   payload = JSON {v:1, n: nama pembeli, e: 'YYYY-MM-DD' (berlaku sampai, kosong = selamanya), i: tanggal terbit}
 *   tanda tangan = ECDSA P-256 / SHA-256 atas teks payload base64url.
 *
 * Halaman hanya memegang KUNCI PUBLIK, jadi tidak bisa membuat kode baru. Pemeriksaan terjadi di browser
 * (tanpa server), sehingga orang yang paham teknis tetap bisa mengakali tampilan; ini kunci "jujur",
 * bukan DRM. Data toko tidak pernah ikut terkirim.
 */
const CekLicense = (() => {
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
  const b64uToBytes = (s) => {
    const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  const utf8 = (s) => new TextEncoder().encode(s);
  const today = () => new Date().toISOString().slice(0, 10);

  /** @returns {Promise<{ok:boolean, name?:string, exp?:string, reason?:string}>} */
  async function verify(code, publicKeyB64u, now = today()) {
    const clean = String(code || '').replace(/\s+/g, '');
    const parts = clean.split('.');
    if (parts.length !== 3 || parts[0] !== 'CP1') return { ok: false, reason: 'Format kode tidak dikenali. Kode diawali "CP1."' };
    if (!subtle()) return { ok: false, reason: 'Browser ini tidak mendukung pemeriksaan kode. Coba Chrome/Safari terbaru.' };
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1]))); } catch (e) { return { ok: false, reason: 'Kode rusak atau terpotong saat disalin.' }; }
    try {
      const key = await subtle().importKey('raw', b64uToBytes(publicKeyB64u), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const good = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(parts[2]), utf8(parts[1]));
      if (!good) return { ok: false, reason: 'Kode tidak sah.' };
    } catch (e) { return { ok: false, reason: 'Kode tidak sah.' }; }
    if (payload.e && payload.e < now) return { ok: false, reason: `Kode sudah berakhir pada ${payload.e}.`, name: payload.n, exp: payload.e };
    return { ok: true, name: payload.n || '', exp: payload.e || '' };
  }

  /** Hanya untuk alat pembuat kode (memerlukan kunci privat). */
  async function sign(payload, privateJwk) {
    const b64u = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const body = b64u(utf8(JSON.stringify(payload)));
    const key = await subtle().importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(body)));
    return `CP1.${body}.${b64u(sig)}`;
  }

  return { verify, sign };
})();
if (typeof module !== 'undefined') module.exports = CekLicense;
