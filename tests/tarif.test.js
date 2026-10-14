/* Uji tabel tarif umum. Jalankan: node tests/tarif.test.js */
const T = require('../assets/tarif.js');
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('GAGAL', name, '\n     ', e.message); } };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} ${a} !== ${b}`); };
const truthy = (c, msg) => { if (!c) throw new Error(msg); };

test('struktur data lengkap dan masuk akal', () => {
  truthy(/^\d{4}-\d{2}-\d{2}$/.test(T.DATA.dicek), 'tanggal dicek');
  for (const k of T.PLATFORMS) {
    const d = T.DATA[k];
    truthy(d.sumber.length && d.sumber.every((s) => /^https:\/\//.test(s.url)), `${k}: sumber`);
    truthy(d.kategori.length, `${k}: kategori`);
    for (const c of d.kategori) truthy(c.nonmall > 0 && c.nonmall < 30 && c.mall > 0 && c.mall < 30, `${k}/${c.id}: persen wajar`);
    for (const t of d.tetap) truthy(t.rp >= 0 && t.rp < 20000, `${k}/${t.id}: biaya tetap wajar`);
  }
});
test('Shopee toko biasa kategori umum + Gratis Ongkir XTRA', () => {
  const e = T.estimate({ platform: 'shopee', kategori: 'umum', opsi: ['gox'] });
  eq(e.pct, 14); eq(e.fixed, 1250);
});
test('Mall lebih mahal dari toko biasa, afiliasi ditambahkan', () => {
  const a = T.estimate({ platform: 'tiktok', status: 'mall' }), b = T.estimate({ platform: 'tiktok' });
  truthy(a.pct > b.pct, 'mall > nonmall');
  eq(T.estimate({ platform: 'tiktok', afiliasi: 5 }).pct, b.pct + 5);
  eq(b.fixed, 2250);
});
test('kategori tidak dikenal memakai kategori pertama; platform tidak dikenal ditolak', () => {
  eq(T.estimate({ platform: 'shopee', kategori: 'xx' }).pct, T.DATA.shopee.kategori[0].nonmall);
  let threw = false; try { T.estimate({ platform: 'lazada' }); } catch (e) { threw = true; }
  truthy(threw, 'harus error');
});
console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji lulus');
process.exitCode = failed ? 1 : 0;
