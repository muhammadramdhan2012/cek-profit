/* Cek Profit — sistem gerak kecil (tanpa pustaka).
 *
 * Dimuat sinkron di <head> agar kelas `motion` terpasang sebelum halaman tampil (tanpa kedip).
 * Bila pengguna memilih "kurangi gerakan" atau browser tidak punya IntersectionObserver,
 * kelas tidak dipasang: semua isi langsung tampil apa adanya.
 *
 * Pemakaian di HTML:
 *   data-reveal            muncul dari bawah (juga: "up", "left", "right", "fade")
 *   data-delay="120"       jeda tambahan dalam milidetik
 *   data-stagger="80"      pada induk: anak [data-reveal] yang masuk bersamaan muncul bergiliran
 *   data-spotlight         sorotan halus mengikuti kursor (hanya mouse/trackpad)
 *   data-tilt="1.5"        kemiringan maksimal (derajat) mengikuti kursor (hanya mouse/trackpad)
 *   data-parallax          lapisan anak bergeser beberapa piksel mengikuti kursor (--px, --py)
 *   data-scrollvis         porsi elemen yang terlihat (0–1) sebagai --sv, untuk gerak gulir yang sangat ringan
 *
 * Hanya transform dan opacity yang dianimasikan. Isi tidak pernah disembunyikan dari pembaca layar
 * (opacity, bukan display/visibility), dan setiap elemen hanya beranimasi sekali.
 */
(() => {
  const root = document.documentElement;
  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
  const reduce = mq('(prefers-reduced-motion: reduce)').matches;
  const finePointer = mq('(hover: hover) and (pointer: fine)').matches;
  const canReveal = !reduce && 'IntersectionObserver' in window;
  if (canReveal) root.classList.add('motion');

  const DUR = 520;   // sama dengan --dur-reveal di base.css

  /** Tandai elemen sudah tampil, lalu lepas atributnya agar transisi hover kartu tidak ikut tertunda. */
  function show(el, delay) {
    if (delay) el.style.setProperty('--rv-delay', `${delay}ms`);
    el.classList.add('is-in');
    setTimeout(() => {
      el.removeAttribute('data-reveal');
      el.classList.remove('is-in');
      el.style.removeProperty('--rv-delay');
    }, delay + DUR + 80);
  }

  let io = null;
  function reveal(scope = document) {
    const els = scope.querySelectorAll('[data-reveal]');
    if (!canReveal) { els.forEach((el) => el.removeAttribute('data-reveal')); return; }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        const giliran = new Map();   // induk stagger -> urutan dalam batch ini
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          const group = el.parentElement && el.parentElement.closest('[data-stagger]');
          let delay = +el.dataset.delay || 0;
          if (group) {
            const n = giliran.get(group) || 0;
            giliran.set(group, n + 1);
            delay += n * (+group.dataset.stagger || 80);
          }
          show(el, Math.min(delay, 400));   // giliran dibatasi agar isi tidak tertunda lama
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });   // piksel pertama cukup: potongan elemen di tepi atas layar tidak tertinggal transparan
    }
    els.forEach((el) => io.observe(el));
  }

  /** Sorotan radial yang mengikuti kursor. Satu pembaruan per frame. */
  function spotlight(scope = document) {
    if (!finePointer || reduce) return;
    scope.querySelectorAll('[data-spotlight]').forEach((el) => {
      let raf = 0, x = 0, y = 0;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        x = e.clientX - r.left; y = e.clientY - r.top;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; el.style.setProperty('--mx', `${x}px`); el.style.setProperty('--my', `${y}px`); });
      });
    });
  }

  /** Kemiringan sangat kecil (maks. data-tilt derajat). Kembali datar saat kursor keluar. */
  function tilt(scope = document) {
    if (!finePointer || reduce) return;
    scope.querySelectorAll('[data-tilt]').forEach((el) => {
      const max = Math.min(+el.dataset.tilt || 1.5, 2);
      let raf = 0, rx = 0, ry = 0;
      const set = () => { raf = 0; el.style.setProperty('--rx', `${rx.toFixed(2)}deg`); el.style.setProperty('--ry', `${ry.toFixed(2)}deg`); };
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
        rx = -py * max * 2; ry = px * max * 2;
        if (!raf) raf = requestAnimationFrame(set);
      });
      el.addEventListener('pointerleave', () => { rx = 0; ry = 0; if (!raf) raf = requestAnimationFrame(set); });
    });
  }

  /** Paralaks kursor: lapisan [style="--depth:n"] di dalam [data-parallax] bergeser maks. ±depth px. Hanya mouse/trackpad. */
  function parallax(scope = document) {
    if (!finePointer || reduce) return;
    scope.querySelectorAll('[data-parallax]').forEach((el) => {
      let raf = 0, x = 0, y = 0;
      const set = () => { raf = 0; el.style.setProperty('--px', x.toFixed(3)); el.style.setProperty('--py', y.toFixed(3)); };
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)); y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
        if (!raf) raf = requestAnimationFrame(set);
      });
      el.addEventListener('pointerleave', () => { x = 0; y = 0; if (!raf) raf = requestAnimationFrame(set); });
    });
  }

  /** Seberapa banyak elemen terlihat (0–1) → --sv, dari IntersectionObserver bertingkat (bukan event scroll). */
  function scrollvis(scope = document) {
    if (reduce || !('IntersectionObserver' in window)) return;
    const th = Array.from({ length: 21 }, (_, i) => i / 20);
    const vio = new IntersectionObserver((es) => es.forEach((en) => en.target.style.setProperty('--sv', en.intersectionRatio.toFixed(2))), { threshold: th });
    scope.querySelectorAll('[data-scrollvis]').forEach((el) => vio.observe(el));
  }

  function init() { reveal(); spotlight(); tilt(); parallax(); scrollvis(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CekMotion = { reveal, spotlight, tilt, parallax, scrollvis, enabled: canReveal };
})();
