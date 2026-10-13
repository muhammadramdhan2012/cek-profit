/* Uji kode akses dengan pasangan kunci sementara. Jalankan: node tests/license.test.js */
const L = require('../assets/license.js');
(async () => {
  let failed = 0;
  const t = (name, c) => { console.log(c ? 'ok  ' : 'GAGAL', name); if (!c) failed++; };
  const s = globalThis.crypto.subtle;
  const kp = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = Buffer.from(await s.exportKey('raw', kp.publicKey)).toString('base64url');
  const jwk = await s.exportKey('jwk', kp.privateKey);
  const code = await L.sign({ v: 1, n: 'Toko Uji', e: '2027-01-31', i: '2026-10-13' }, jwk);
  const r = await L.verify(code, pub, '2026-10-13');
  t('kode sah diterima', r.ok && r.name === 'Toko Uji' && r.exp === '2027-01-31');
  t('kode dengan spasi/baris baru (salin dari WA) tetap diterima', (await L.verify(code.replace(/(.{20})/g, '$1\n '), pub, '2026-10-13')).ok);
  t('kode kedaluwarsa ditolak', !(await L.verify(code, pub, '2027-02-01')).ok);
  const [a, b, c] = code.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, n: 'Toko Uji', e: '2099-12-31' })).toString('base64url');
  t('payload diubah (perpanjang sendiri) ditolak', !(await L.verify(`${a}.${forged}.${c}`, pub, '2026-10-13')).ok);
  t('teks acak ditolak', !(await L.verify('halo', pub)).ok);
  const kp2 = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub2 = Buffer.from(await s.exportKey('raw', kp2.publicKey)).toString('base64url');
  t('kode dari kunci lain ditolak', !(await L.verify(code, pub2, '2026-10-13')).ok);
  const forever = await L.sign({ v: 1, n: 'Selamanya', e: '', i: '2026-10-13' }, jwk);
  t('kode tanpa batas waktu', (await L.verify(forever, pub, '2099-01-01')).ok);
  console.log(failed ? `${failed} uji GAGAL` : 'Semua uji lulus');
  process.exitCode = failed ? 1 : 0;
})();
