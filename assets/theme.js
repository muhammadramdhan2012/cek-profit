/* Pilihan tema: Terang, Gelap, atau Ikuti perangkat.
 * Dimuat di <head> (sinkron) agar tema diterapkan sebelum halaman tampil, tanpa kedip.
 * Elemen dengan atribut [data-theme-toggle] otomatis diisi tombol pemilih.
 * Pilihan disimpan di localStorage (per browser), default: ikuti perangkat.
 */
(() => {
  const KEY = 'cekprofit.theme';
  const MODES = ['light', 'dark', 'system'];
  const LABEL = { light: 'Tema terang', dark: 'Tema gelap', system: 'Ikuti tema perangkat' };
  const ICON = {
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  };
  const get = () => { try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : 'system'; } catch (e) { return 'system'; } };
  const apply = (mode) => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  };
  apply(get());

  function mount() {
    const cur = get();
    document.querySelectorAll('[data-theme-toggle]').forEach((el) => {
      el.innerHTML = `<div class="theme-seg" role="radiogroup" aria-label="Tema tampilan">${MODES.map((m) => `<button type="button" role="radio" aria-checked="${cur === m}" data-theme-set="${m}" title="${LABEL[m]}" aria-label="${LABEL[m]}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[m]}</svg></button>`).join('')}</div>`;
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    try { localStorage.setItem(KEY, b.dataset.themeSet); } catch (err) { /* tetap berlaku sampai halaman ditutup */ }
    apply(b.dataset.themeSet);
    mount();
    try { window.cekTrack && window.cekTrack(`tema-${b.dataset.themeSet}`); } catch (err) { /* abaikan */ }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.CekTheme = { mount, get };
})();
