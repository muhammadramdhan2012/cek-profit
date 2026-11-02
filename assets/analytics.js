/* Analytics ramah privasi (GoatCounter): tanpa cookie, tanpa data pribadi.
 * Aktif hanya jika CEK_CONFIG.goatcounter diisi. Yang dikirim: halaman yang dibuka dan nama tombol
 * (mis. "klik-demo", "unduh-pdf"). Isi file, angka penjualan, dan nama toko TIDAK PERNAH dikirim.
 */
(() => {
  const code = (window.CEK_CONFIG || {}).goatcounter;
  const queue = [];
  window.cekTrack = (event) => {
    if (!code) return;
    const send = () => window.goatcounter.count({ path: `event/${event}`, title: event, event: true });
    if (window.goatcounter && window.goatcounter.count) send(); else queue.push(event);
  };
  if (!code || !/^[a-z0-9-]+$/i.test(code)) return;
  // Hanya nama halaman yang dikirim (mis. "/akun"), tanpa ?query dan #hash: alamat halaman akun bisa sementara memuat
  // kode/token login (masuk dengan Google, tautan email). Event tombol tetap memakai path "event/…" dari cekTrack.
  window.goatcounter = Object.assign(window.goatcounter || {}, { path: () => location.pathname || '/' });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  s.onload = () => { while (queue.length) window.cekTrack(queue.shift()); };
  document.head.appendChild(s);
})();
