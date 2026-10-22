/* Cek Profit — aplikasi.
 * Bergantung pada: CEK_CONFIG, XLSX (vendor), Engine, CekDemo, CekLicense, CekCloud, CekReport.
 *
 * Susunan file:
 *   1. utilitas & penyimpanan      5. tampilan per halaman (ringkasan, produk, biaya, retur, simulator, riwayat, data)
 *   2. status & akun                6. dialog (upgrade, simpan riwayat)
 *   3. hitung                       7. ekspor & laporan PDF
 *   4. kerangka (menu, judul)       8. event & mulai
 */
(() => {
  /* ================= 1. utilitas & penyimpanan ================= */
  const C = window.CEK_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const fmt = (v) => (ok(v) ? (Math.round(v) < 0 ? '−Rp' : 'Rp') + Math.abs(Math.round(v)).toLocaleString('id-ID') : '—');
  const fmtShort = (v) => { if (!ok(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`; if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)} rb`; return `${s}${Math.round(a)}`; };
  const pct = (v, d = 1) => (ok(v) ? `${(Math.abs(v) < 0.0005 ? 0 : v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '—');
  const num = (n) => (ok(n) ? Math.round(n).toLocaleString('id-ID') : '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const monthLabel = (k) => { const [y, mm] = k.split('-'); return `${MONTHS[+mm - 1]} ${y.slice(2)}`; };
  // Status laba per bulan dari metadata engine: kosong (tanpa transaksi), tidak_diketahui (tanpa penjualan bermodal:
  // margin 0 di objek BUKAN laba Rp0), sebagian, lengkap. UI tidak menghitung angka baru.
  const mStat = (t) => (!t || !t.orders ? 'kosong' : t.statusHpp || 'lengkap');
  const mKnown = (t) => { const x = mStat(t); return x === 'sebagian' || x === 'lengkap'; };
  /** Sel laba bulanan (HTML). ready = r.ready. */
  const mLaba = (ready, t, v) => {
    const x = mStat(t);
    if (!ready || x === 'kosong') return '<span class="faint">—</span>';
    if (x === 'tidak_diketahui') return '<span class="unk">Belum diketahui</span>';
    return `<span class="${v < 0 ? 'neg' : ''}">${fmt(v)}</span>${x === 'sebagian' ? '<span class="faint tiny"> (modal sebagian)</span>' : ''}`;
  };
  const monthLong = (k) => { const [y, mm] = k.split('-'); return `${MONTHS_L[+mm - 1]} ${y}`; };
  const tgl = (d) => { if (!d) return '—'; const [y, m, dd] = d.slice(0, 10).split('-'); return `${+dd} ${MONTHS[+m - 1]} ${y}`; };
  const PNAME = { shopee: 'Shopee', tiktok: 'TikTok Shop' };
  const KIND = {
    shopee_income: ['shopee', 'Shopee, laporan penghasilan'], shopee_return: ['shopee', 'Shopee, retur'], shopee_orders: ['shopee', 'Shopee, export pesanan'],
    tiktok_income: ['tiktok', 'TikTok, laporan penghasilan'], tiktok_return: ['tiktok', 'TikTok, retur'], tiktok_orders: ['tiktok', 'TikTok, export pesanan'],
    modal_template: ['modal', 'Template modal'], shopee_balance: ['', 'Shopee, saldo (tidak diperlukan)'], unknown: ['bad', 'Belum dikenali'],
  };
  // Export pesanan Shopee/TikTok: parser belum diuji dengan semua format file asli (CLAUDE.md §2.5).
  // Pembayaran Pro manual hanya bisa diselesaikan bila kontak WhatsApp sudah diisi (config.js).
  // Pembelian Pro (checkout berbasis akun di akun.html?view=pro) hanya dibuka bila proPembayaranAktif = true di config.js.
  // Tidak bergantung pada WhatsApp. Kesiapan rekening/QRIS dicek lagi di server (pengaturan_pembayaran.aktif).
  const PAY_READY = C.proPembayaranAktif === true;
  const BETA_NOTE = 'Format export marketplace dapat berubah. Hasil pencocokan ditandai bila belum dapat diverifikasi.';
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  /* Pengumuman: #toast selalu ada di halaman sebagai area status (role=status). Isi dikosongkan dulu lalu diisi,
   * agar pesan yang sama tetap dibacakan pembaca layar; tampilannya hanya dimunculkan/disembunyikan lewat kelas. */
  const toast = (msg) => {
    const t = $('#toast');
    clearTimeout(toast.t); clearTimeout(toast.c);
    t.textContent = '';
    toast.c = setTimeout(() => { t.textContent = msg; t.classList.add('show'); }, 40);
    toast.t = setTimeout(() => { t.classList.remove('show'); toast.c = setTimeout(() => { t.textContent = ''; }, 300); }, 3640);
  };
  const ICON = {
    ringkasan: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    produk: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    biaya: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    retur: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    simulator: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    riwayat: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    data: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    laba: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    laporan: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    modal: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    pengaturan: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    lainnya: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    unduh: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  };
  /** Ikon kecil kartu angka (hiasan). */
  const KPI_IC = {
    sales: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    modal: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
    fees: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  };
  const kpiIc = (k) => (KPI_IC[k] ? `<span class="m-ic m-ic-${k}" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${KPI_IC[k]}</svg></span>` : '');
  const svg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };
  const KEYS = { settings: 'cekprofit.v3', profile: 'cekprofit.profile', license: 'cekprofit.license', cases: 'cekprofit.cases', done: 'cekprofit.done' };
  const DEFAULTS = { modalMode: 'produk', catalog: [], fallbackPct: null, mitra: null, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }],
    packing: null, targetMargin: 15, targetProfit: null, fixedCosts: [],
    sellerType: null, extraCostPct: null, hppList: [], acuanContoh: 100000 };
  function loadSettings() {
    const s = store.get(KEYS.settings, null);
    if (s && Array.isArray(s.periods)) return { ...structuredClone(DEFAULTS), ...s };
    const old = store.get('cekprofit.v2', null);
    if (old && Array.isArray(old.periods)) return { ...structuredClone(DEFAULTS), ...old, modalMode: ok(old.mitra) ? 'acuan' : 'produk' };
    return structuredClone(DEFAULTS);
  }

  /* ================= 2. status & akun ================= */
  let settings = loadSettings();
  let profile = { store: '', owner: '', logo: '', ...store.get(KEYS.profile, {}) };
  let caseState = store.get(KEYS.cases, {});
  let done = store.get(KEYS.done, {});              // {pdf: true, saved: true}
  let files = [];
  let demo = false;
  let license = { ok: false };
  let viewName = 'ringkasan';
  const view = { openSec: {}, section: 'unggah', platform: 'all', from: '', to: '', metric: 'margin', q: '', sort: 'margin', showAll: false, onlyCheck: true, costQ: '', costAll: false, compare: null, typeOpen: false, prodFilter: 'all', prodKey: null, platCol: 'total', mp: '' };
  const sim = { listPrice: null, disc: null, cost: null, feePct: null, feeFixed: null, src: null, plat: null, status: 'nonmall', kat: null, opsi: [], afiliasi: 0 };
  let last = null;
  const cloud = CekCloud.init({ url: C.supabaseUrl, key: C.supabaseAnonKey });
  const account = { user: cloud.auth.user(), profile: null, sync: '', reports: null, loading: false, menu: false };

  const isPro = () => demo || license.ok || CekCloud.isPro(account.profile);
  const st = () => (demo ? CekDemo.settings() : settings);
  const prof = () => (demo ? CekDemo.profile() : profile);
  const cases = () => (demo ? {} : caseState);
  /* jenis usaha: menentukan cara modal dihitung dan fitur yang tampil */
  const TYPES = {
    reseller: { label: 'Reseller', desc: 'Beli dari pemasok dengan diskon dari harga acuan, misalnya harga sampul buku atau harga katalog.', cost: 'Harga beli', icon: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>' },
    stok: { label: 'Penjual stok sendiri', desc: 'Kulakan atau beli grosir, simpan stok, lalu jual lagi. Harga beli per produk diketahui.', cost: 'Harga beli', icon: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>' },
    produsen: { label: 'Produsen / brand sendiri', desc: 'Membuat produk sendiri: makanan, skincare, konveksi, kerajinan. Modal dihitung dari HPP.', cost: 'HPP', icon: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>' },
    dropship: { label: 'Dropshipper', desc: 'Tidak menyimpan stok. Supplier mengirim langsung ke pembeli atas nama toko Anda.', cost: 'Harga supplier', icon: '<path d="M1 4h13v12H1zM14 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>' },
  };
  const typeOf = (s) => (TYPES[s.sellerType] ? s.sellerType : s.modalMode === 'acuan' ? 'reseller' : null);
  /** Pengaturan yang dipakai menghitung: biaya kulakan hanya berlaku untuk penjual stok sendiri. */
  const effective = (s) => ({ ...s, extraCostPct: typeOf(s) === 'stok' ? s.extraCostPct : null });
  /** Label kategori retur. "Tidak dikirim" berasal dari alasan di marketplace: indikasi, bukan fakta. */
  const catLabel = (cat) => (cat === 'tidak_dikirim' ? 'Terindikasi tidak dikirim (menurut alasan di marketplace)' : Engine.CAT_LABEL[cat]);
  const qi = (key, label = '') => `<button type="button" class="qi" data-info="${key}" aria-label="Penjelasan${label ? ` ${esc(label)}` : ''}" aria-haspopup="dialog">?</button>`;

  const parsedAll = () => (demo ? CekDemo.make().map((wb) => Engine.parseWorkbook(wb)) : files.filter((f) => f.parsed && f.parsed.kind !== 'modal_template').map((f) => f.parsed));

  const save = () => { store.set(KEYS.settings, settings); queueSync(); };
  const saveProfile = () => { if (!store.set(KEYS.profile, profile)) toast('Logo terlalu besar untuk disimpan di browser ini.'); queueSync(); };
  const markDone = (k) => { done[k] = true; store.set(KEYS.done, done); };

  /* sinkron ke akun (debounce) */
  let syncTimer = null;
  function queueSync() {
    if (!account.user || demo) return;
    clearTimeout(syncTimer);
    account.sync = 'Menyimpan…'; renderAccount();
    syncTimer = setTimeout(async () => {
      try {
        await cloud.db.saveData({ settings, profile });
        if (account.profile && profile.store && account.profile.store_name !== profile.store) account.profile = await cloud.db.updateProfile({ store_name: profile.store }) || account.profile;
        account.sync = 'Tersimpan di akun';
      }
      catch (e) { account.sync = 'Gagal menyimpan ke akun'; }
      renderAccount();
    }, 1200);
  }
  const catKeyOf = (e) => (e.kode ? `k:${Engine.norm(e.kode)}` : `n:${Engine.norm(`${e.nama} ${e.variasi || ''}`)}`);
  const unionCatalog = (base, extra) => { const m = new Map(base.map((e) => [catKeyOf(e), e])); for (const e of extra) if (!m.has(catKeyOf(e))) m.set(catKeyOf(e), e); return [...m.values()]; };
  async function loadAccount() {
    account.user = cloud.auth.user();
    if (!account.user) { account.profile = null; renderAccount(); return; }
    account.loading = true; renderAccount();
    try {
      const [p, data] = await Promise.all([cloud.db.profile(), cloud.db.loadData()]);
      account.profile = p;
      if (data && data.settings && Object.keys(data.settings).length) {
        // Pengaturan di akun dipakai; modal lokal yang belum ada di akun tetap dipertahankan.
        const localCat = settings.catalog || [];
        settings = { ...structuredClone(DEFAULTS), ...data.settings, catalog: unionCatalog(data.settings.catalog || [], localCat) };
        store.set(KEYS.settings, settings);
        if (data.profile) { profile = { ...profile, ...data.profile }; store.set(KEYS.profile, profile); }
        account.sync = 'Tersimpan di akun';
        if (settings.catalog.length > (data.settings.catalog || []).length) queueSync();
      } else if (settings.catalog.length || settings.fixedCosts.length || ok(settings.mitra) || ok(settings.fallbackPct)) {
        queueSync();   // pertama kali: unggah pengaturan lokal ke akun
      } else account.sync = 'Tersimpan di akun';
      if (p && !profile.store && p.store_name) { profile.store = p.store_name; store.set(KEYS.profile, profile); }
    } catch (e) { account.sync = e.message; }
    account.loading = false;
    render();
  }

  async function checkLicense(code, quiet) {
    const res = await CekLicense.verify(code, C.publicKey);
    if (res.ok) { license = { ok: true, name: res.name, exp: res.exp, code }; store.set(KEYS.license, code); }
    else license = quiet ? { ok: false } : { ok: false, error: res.reason };
    return res;
  }

  /* ================= 3. hitung ================= */
  function compute() {
    const parsed = parsedAll();
    const hasIncome = parsed.some((p) => p.kind === 'shopee_income' || p.kind === 'tiktok_income');
    if (!hasIncome) { last = null; return null; }
    const s = effective(st());
    const filter = { platforms: view.platform === 'all' ? ['shopee', 'tiktok'] : [view.platform], from: view.from, to: view.to };
    const r = Engine.compute(parsed, s, cases(), filter);
    const all = filter.platforms.length === 2 && !filter.from && !filter.to ? r : Engine.compute(parsed, s, cases());
    last = { r, all, st: s, parsed };
    return last;
  }
  const catKey = (p) => (p.platform === 'tiktok' ? (p.code || p.sku) : (p.sku || p.code)) || '';

  /** Ringkasan kecil untuk riwayat (tanpa data pesanan/pembeli). */
  function snapshot(r) {
    const R = (v) => (ok(v) ? Math.round(v) : null);
    const prods = r.products.filter((p) => ok(p.margin));
    const pick = (arr) => arr.map((p) => ({ name: p.name.slice(0, 80), platform: p.platform, sales: R(p.sales), margin: R(p.margin) }));
    return { v: 1, store: prof().store || '', first: r.first, last: r.last, platforms: ['shopee', 'tiktok'].filter((k) => r.has[k]),
      orders: r.orders, sales: R(r.totalSales), fees: R(r.totalFees), received: R(r.totalReceived), modal: R(r.totalModal), margin: R(r.totalMargin),
      opex: R(r.opex), net: R(r.netProfit), coverage: +r.coverage.toFixed(4), feePct: r.totalSales ? +(-r.totalFees / r.totalSales).toFixed(4) : null,
      months: r.months.map((m) => ({ month: m.month, sales: R(m.total.sales), fees: R(m.total.fees), margin: mKnown(m.total) ? R(m.total.margin) : null, net: mKnown(m.total) ? R(m.total.net) : null, orders: m.total.orders })),
      top: pick([...prods].sort((a, b) => b.margin - a.margin).slice(0, 10)), worst: pick([...prods].sort((a, b) => a.margin - b.margin).slice(0, 5)),
      insights: r.insights.slice(0, 6).map((i) => ({ level: i.level, title: i.title })) };
  }

  /* ================= 4. kerangka ================= */
  const VIEWS = [
    ['ringkasan', 'Ringkasan', 'Laba toko Anda dalam satu nota'],
    ['produk', 'Produk', 'Lihat produk mana yang menghasilkan laba dan mana yang perlu diperbaiki'],
    ['biaya', 'Laba', 'Lihat bagaimana penjualan berubah menjadi laba setelah biaya dan modal yang tercatat'],
    ['retur', 'Retur & refund', 'Barang yang kembali dan yang belum jelas'],
    ['simulator', 'Simulator harga', 'Uji harga dan diskon sebelum dipasang'],
    ['riwayat', 'Laporan & riwayat', 'Unduh laporan, simpan, dan bandingkan periode'],
    ['data', 'Data & pengaturan', 'Unggah laporan, isi modal, dan atur biaya'],
  ];
  /* Menu: label untuk seller → tampilan yang sudah ada. "Unggah data", "Modal & HPP", dan "Pengaturan" adalah
   * bagian dari tampilan Data yang sama (tidak ada halaman baru); menu membawa ke bagiannya. */
  const NAV = [
    ['Utama', [['ringkasan', 'Ringkasan', 'ringkasan'], ['laba', 'Laba', 'biaya'], ['produk', 'Produk', 'produk'], ['retur', 'Retur & refund', 'retur'], ['simulator', 'Simulator harga', 'simulator']]],
    ['Data & laporan', [['laporan', 'Laporan & riwayat', 'riwayat'], ['data', 'Unggah data', 'data', 'unggah'], ['modal', 'Modal & HPP', 'data', 'modal']]],
    ['Lainnya', [['pengaturan', 'Pengaturan', 'data', 'pengaturan']]],
  ];
  const BOTTOM = ['ringkasan', 'laba', 'produk', 'retur'];
  const SHORT = { retur: 'Retur' };
  const navItems = () => NAV.flatMap(([, items]) => items);
  const isActive = ([, , v, section]) => viewName === v && (v !== 'data' || (view.section || 'unggah') === section);
  function navButton(item, cls = '') {
    const [k, label, v, section] = item;
    const r = last && last.r;
    const open = r ? r.cases.filter((c) => c.state === 'belum').length : 0;
    const count = k === 'produk' && r ? `<span class="count">${num(r.products.length)}</span>`
      : k === 'retur' && open ? `<span class="count attn" title="${open} kasus belum dicek">${num(open)}</span>`
        : k === 'data' && !demo && !files.length ? '<span class="count attn">mulai</span>' : '';
    // Bilah bawah HP memakai label pendek; nama lengkap tetap tersedia untuk pembaca layar.
    const shortLbl = cls === 'bn' && SHORT[k] ? SHORT[k] : label;
    return `<button type="button" class="${cls}" data-go="${v}" ${section ? `data-section="${section}"` : ''} ${isActive(item) ? 'aria-current="page"' : ''} ${shortLbl !== label ? `aria-label="${label}"` : ''}>${svg(k)}<span class="lbl">${shortLbl}</span>${count}</button>`;
  }
  function renderNav() {
    // Menu hanya ditulis ulang bila isinya berubah, agar animasi penanda aktif tidak berulang di setiap ketikan.
    const side = NAV.map(([group, items]) => `<div class="nav-group" role="group" aria-label="${group}"><span class="nav-label" aria-hidden="true">${group}</span>${items.map((i) => navButton(i)).join('')}</div>`).join('');
    if (renderNav.side !== side) { $('#nav').innerHTML = side; renderNav.side = side; }
    // Bilah bawah (HP): 4 menu utama + "Lainnya" untuk sisanya, sehingga tidak ada menu tersembunyi tanpa penanda.
    const more = navItems().filter((i) => !BOTTOM.includes(i[0]));
    const moreActive = more.some(isActive);
    const bottom = BOTTOM.map((k) => navButton(navItems().find((i) => i[0] === k), 'bn')).join('')
      + `<button type="button" class="bn" data-sheet="more" aria-haspopup="dialog" ${moreActive ? 'aria-current="page"' : ''}>${svg('lainnya')}<span class="lbl">Lainnya</span></button>`;
    if (renderNav.bottom !== bottom) { $('#bnav').innerHTML = bottom; renderNav.bottom = bottom; }
  }
  /** Teks status Pro dari akun: sekali bayar (tanggal penanda) atau sampai tanggal tertentu (Pro lama). */
  const proText = (p) => (CekCloud.isProSekaliBayar(p) ? 'Pro sekali bayar' : `Pro sampai ${tgl(p.pro_until)}`);
  const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  function renderAccount() {
    const p = account.profile, u = account.user;
    const pro = isPro();
    const planText = demo ? 'Mode contoh' : CekCloud.isPro(p) ? proText(p) : license.ok ? `Pro (kode)${license.exp ? ` sampai ${tgl(license.exp)}` : ''}` : 'Paket gratis';
    $('#plan-box').innerHTML = pro ? `<div class="plan-pro"><span class="badge pro">PRO</span><span>${demo ? 'Mode contoh: semua fitur terbuka' : 'Semua fitur Pro aktif'}</span></div>` : `<div class="upsell"><span class="badge pro">PRO</span><b>Cek Untung Pro</b><p>Laporan PDF, analisis semua produk, dan saran harga.</p>${hargaPro('mini')}<button class="btn sm primary" type="button" data-upgrade>Lihat paket</button></div>`;
    if (!cloud.enabled) {
      $('#account-box').innerHTML = `<div class="acct-box"><div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${svg('data', 16)}</div><div class="who"><b>${planText}</b><span>Tersimpan di browser ini</span></div></div>`;
      $('#account-sm').innerHTML = pro ? '<span class="badge pro">PRO</span>' : '<button class="btn sm" type="button" data-upgrade>Pro</button>';
      return;
    }
    if (!u) {
      $('#account-box').innerHTML = `<div class="acct-cta"><p>Simpan modal produk dan riwayat di akun agar bisa dibuka dari perangkat lain.</p>
        <div class="row-actions"><a class="btn sm primary" href="akun.html?mode=daftar&next=dashboard.html">Daftar gratis</a><a class="btn sm" href="akun.html?next=dashboard.html">Masuk</a></div></div>`;
      $('#account-sm').innerHTML = '<a class="btn sm" href="akun.html?next=dashboard.html">Masuk</a>';
      return;
    }
    const name = (p && p.full_name) || u.email;
    $('#account-box').innerHTML = `<div class="menu">${account.menu ? `<div class="menu-pop" role="menu"><a href="akun.html" role="menuitem">Akun dan profil</a>${!pro ? '<button type="button" data-upgrade role="menuitem">Upgrade ke Pro</button>' : ''}${p && p.is_admin ? '<a href="admin.html" role="menuitem">Halaman admin</a>' : ''}<button type="button" id="logout" role="menuitem">Keluar</button></div>` : ''}
      <button class="acct-box btn quiet" type="button" id="acct-toggle" aria-expanded="${account.menu}" style="width:100%;justify-content:flex-start;padding:8px"><span class="avatar">${esc(initials(name))}</span>
      <span class="who"><b>${esc(name)}</b><span>${account.loading ? 'Memuat akun…' : esc(account.sync && account.sync !== 'Tersimpan di akun' ? account.sync : planText)}</span></span></button></div>`;
    $('#account-sm').innerHTML = `<a href="akun.html" class="avatar" style="width:30px;height:30px;font-size:12px;text-decoration:none" aria-label="Akun">${esc(initials(name))}</a>`;
  }
  const LOGO = '<svg class="logo" width="26" height="26" viewBox="0 0 16 16" aria-hidden="true"><rect class="lg-bg" width="16" height="16" rx="4.5" fill="var(--accent)"/><rect class="lg-b" x="3" y="9" width="2" height="4" rx="1" fill="var(--accent-ink)" opacity=".62"/><rect class="lg-b" x="7" y="7" width="2" height="6" rx="1" fill="var(--accent-ink)" opacity=".85"/><rect class="lg-b" x="11" y="5" width="2" height="8" rx="1" fill="var(--accent-ink)"/><circle class="lg-d" cx="12.6" cy="2.9" r="1.5" fill="var(--mark)"/></svg>';
  /** Kontrol filter & unduhan. Dipakai di bilah atas (desktop) dan di lembar Filter (HP); di lembar memakai
   *  data-filter/data-act agar id tidak ganda. */
  function topControls(r, inSheet) {
    const pro = isPro();
    const filters = !['data', 'riwayat', 'simulator'].includes(viewName) && r;
    const canExport = r && !['data', 'simulator'].includes(viewName);
    const monthOpts = (sel, label) => `<option value="">${label}</option>` + r.allMonths.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    const sel = (k, label, cur) => `<select class="compact" ${inSheet ? `data-filter="${k}"` : `id="${k}"`} aria-label="${label}">${monthOpts(cur, k === 'from' ? 'Dari awal' : 'Sampai akhir')}</select>`;
    const seg = r && r.available.shopee && r.available.tiktok ? `<div class="seg" role="group" aria-label="Marketplace">${[['all', 'Semua'], ['shopee', 'Shopee'], ['tiktok', 'TikTok']].map(([k, l]) => `<button type="button" data-platform="${k}" aria-pressed="${view.platform === k}">${l}</button>`).join('')}</div>` : '';
    const badge = pro ? '' : ' <span class="badge pro">PRO</span>';
    const act = (id, label, extra = '') => (inSheet ? `<button class="btn ${extra}" type="button" data-act="${id}">${label}</button>` : `<button type="button" role="menuitem" id="${id}">${label}</button>`);
    const actions = [act('pdf', `Laporan PDF${badge}`, 'primary'), act('export', `Excel${badge}`), act('save-hist', 'Simpan ke riwayat')];
    if (inSheet) {
      return `${filters ? `<div class="sheet-sec"><span class="sheet-k">Marketplace</span>${seg || '<span class="small faint">Hanya satu marketplace di data ini</span>'}</div>
        <div class="sheet-sec"><span class="sheet-k">Periode (bulan pesanan)</span><div class="sheet-row">${sel('from', 'Dari bulan', view.from)}${sel('to', 'Sampai bulan', view.to)}</div></div>` : ''}
        ${canExport ? `<div class="sheet-sec"><span class="sheet-k">Unduh dan simpan</span><div class="sheet-actions">${actions.join('')}</div></div>` : ''}`;
    }
    return { filters: filters ? `${seg}<div class="period-pick">${sel('from', 'Dari bulan', view.from)}<span class="faint" aria-hidden="true">–</span>${sel('to', 'Sampai bulan', view.to)}</div>` : '',
      download: canExport ? `<details class="dd"><summary class="btn sm">${svg('unduh', 16)}<span>Unduh</span></summary><div class="dd-menu" role="menu">${actions.join('')}</div></details>` : '',
      any: !!(filters || canExport) };
  }
  // Tampilan Data berisi tiga bagian; judul bilah atas mengikuti bagian yang dipilih dari menu.
  const DATA_SEC = { unggah: ['Unggah data', 'Unggah laporan marketplace dan periksa file yang terbaca'], modal: ['Modal & HPP', 'Isi harga beli atau HPP agar laba bisa dihitung'], pengaturan: ['Pengaturan opsional', 'Biaya tambahan, target bisnis, dan identitas laporan PDF'] };
  function renderTop() {
    const base = VIEWS.find((v) => v[0] === viewName);
    const meta = viewName === 'data' ? [base[0], ...(DATA_SEC[view.section] || DATA_SEC.unggah)] : base;
    const r = last && last.r;
    const sub = r ? `${demo ? 'Data contoh, ' : ''}${prof().store ? `${esc(prof().store)}, ` : ''}${tgl(r.first)} sampai ${tgl(r.last)}` : meta[2];
    const short = r ? `${tgl(r.first)} – ${tgl(r.last)}${view.platform !== 'all' ? `, ${PNAME[view.platform]}` : ''}${view.from || view.to ? ', difilter' : ''}` : meta[2];
    const c = topControls(r, false);
    const extra = viewName === 'data' && !demo && !files.length ? '<button class="btn sm" type="button" data-demo>Lihat dengan data contoh</button>'
      : viewName === 'data' && demo ? '<button class="btn sm" type="button" id="exit-demo">Keluar dari mode contoh</button>' : '';
    $('#main-top').innerHTML = `<div class="top-title"><a class="m-brand" href="./" aria-label="Cek Untung, halaman depan">${LOGO}</a>
        <div class="top-text"><h1>${meta[1]}</h1><p class="sub"><span class="sub-long">${sub}</span><span class="sub-short">${short}</span></p></div></div>
      <div class="top-tools">${c.filters}${c.filters && c.download ? '<span class="divider" aria-hidden="true"></span>' : ''}${c.download}</div>
      ${extra ? `<div class="top-extra">${extra}</div>` : ''}
      ${c.any ? `<button class="btn sm top-sheet-btn" type="button" data-sheet="filter" aria-haspopup="dialog">${svg('filter', 16)}<span>Filter & unduh</span></button>` : ''}`;
  }

  /* ---------- lembar bawah (HP): "Lainnya" dan "Filter & unduh" ---------- */
  let sheetKind = null;
  function renderSheet() {
    const d = $('#sheet');
    if (!d || !sheetKind) return;
    const r = last && last.r;
    const head = (t) => `<div class="d-head"><h2 id="sheet-t">${t}</h2><button class="x" type="button" data-sheet-close aria-label="Tutup">×</button></div>`;
    if (sheetKind === 'kepastian') {
      if (!r) { d.innerHTML = `${head('Kepastian Profit')}<div class="d-body"><p class="small muted">Belum ada data.</p></div>`; return; }
      const items = certaintyItems(r), why = r.kepastian.laba.alasanTidakFinal;
      d.innerHTML = `${head('Kepastian Profit')}<div class="d-body">
        <div class="kd-state">${r.kepastian.laba.final ? '<span class="status verified">Final</span>' : '<span class="status pending">Belum final</span>'}
          <p class="small muted">${r.kepastian.laba.final ? 'Semua syarat kepastian terpenuhi.' : 'Laba ditampilkan dari data yang tersedia. Hal di bawah ini membuatnya belum final.'}</p></div>
        <dl class="kd-def">
          <div><dt>Cakupan</dt><dd>${r.ready ? `${pct(r.coverage, 0)} penjualan masuk dalam perhitungan laba.` : 'Belum ada penjualan yang bisa dihitung labanya.'} Ini bukan tingkat akurasi.</dd></div>
          <div><dt>Kualitas dasar perhitungan</dt><dd>${covParts(r).filter((p) => p.v > 0).map((p) => `${p.label} ${pct(p.share)}`).join(', ') || '—'}.${covCaveat(r.kepastian.cakupan)}</dd></div>
        </dl>
        <ul class="attn-list kd-list">${items.map(attnItem).join('')}
          ${why.includes('periode_belum_divalidasi') ? `<li class="attn-item info"><span class="status estimate" aria-hidden="true"></span><div class="attn-body"><b>Kelengkapan periode belum dicek</b><p>Cek Untung belum bisa memastikan laporan mencakup bulan penuh. Pastikan rentang tanggal unduhan sama di semua laporan.</p></div><div class="attn-cta">${ctaBtn({ label: 'Lihat file', go: 'data', section: 'unggah' })}</div></li>` : ''}</ul>
        <p class="tiny faint">Profit Confidence menunjukkan seberapa kuat dan lengkap data di balik laba, bukan peluang angka laba benar. Cakupan dan kualitas ditampilkan terpisah; tidak digabung menjadi satu skor.</p></div>`;
      return;
    }
    if (sheetKind === 'produk') { d.innerHTML = productSheet(r); return; }
    if (sheetKind === 'filter') {
      d.innerHTML = `${head('Filter & unduh')}<div class="d-body">${topControls(r, true) || '<p class="small muted">Belum ada data untuk difilter.</p>'}</div>`;
    } else {
      const items = navItems().filter((i) => !BOTTOM.includes(i[0]));
      d.innerHTML = `${head('Menu lainnya')}<div class="d-body">
        <div class="sheet-nav">${items.map((i) => navButton(i, 'sheet-item')).join('')}</div>
        <div class="sheet-sec"><span class="sheet-k">Akun</span>${accountSheet()}</div>
        <div class="sheet-sec sheet-inline"><span class="sheet-k">Tampilan</span><span data-theme-toggle></span></div></div>`;
      if (window.CekTheme) window.CekTheme.mount();
    }
  }
  function openSheet(kind) {
    sheetKind = kind;
    const d = $('#sheet');
    d.classList.toggle('drawer', kind === 'kepastian' || kind === 'produk');   // desktop: laci kanan; HP: lembar bawah
    renderSheet();
    if (!d.open) d.showModal();
  }
  /** Tombol sedang memproses: nonaktif + spinner (teks tetap terbaca pembaca layar). */
  const busy = (b, on) => { b.disabled = on; b.classList.toggle('is-loading', on); if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); };
  function openProduct(key) {
    view.prodKey = key;
    document.querySelectorAll('tr[data-prod]').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.prod === key));
    openSheet('produk');
  }
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Tutup lembar dengan animasi singkat (langsung bila pengguna memilih kurangi gerakan). */
  function closeSheet() {
    const d = $('#sheet');
    if (!d || !d.open) return;
    if (reducedMotion()) { d.close(); return; }
    d.classList.add('closing');
    setTimeout(() => { d.classList.remove('closing'); d.close(); }, 160);
  }
  /** Ringkasan akun untuk lembar "Lainnya" (di HP menu samping tidak tampil). */
  function accountSheet() {
    const p = account.profile, u = account.user, pro = isPro();
    const plan = demo ? 'Mode contoh' : CekCloud.isPro(p) ? proText(p) : license.ok ? 'Pro (kode akses)' : 'Paket gratis';
    const up = pro ? '' : '<button class="btn sm" type="button" data-upgrade>Lihat paket Pro</button>';
    if (!cloud.enabled) return `<div class="sheet-acct"><span class="small">${plan}. Tersimpan di browser ini.</span>${up}</div>`;
    if (!u) return `<div class="sheet-acct"><a class="btn sm primary" href="akun.html?mode=daftar&next=dashboard.html">Daftar gratis</a><a class="btn sm" href="akun.html?next=dashboard.html">Masuk</a>${up}</div>`;
    const name = (p && p.full_name) || u.email;
    return `<div class="sheet-acct"><span class="avatar">${esc(initials(name))}</span><span class="who"><b>${esc(name)}</b><span class="tiny faint">${esc(plan)}</span></span>
      <a class="btn sm" href="akun.html">Akun</a>${up}<button class="btn sm quiet" type="button" id="logout">Keluar</button></div>`;
  }

  function render() {
    hideInfo();
    compute();
    renderNav(); renderAccount(); renderTop(); renderSheet();
    const v = $('#view');
    const needData = ['ringkasan', 'produk', 'biaya', 'retur'].includes(viewName) && !last;
    v.innerHTML = needData ? emptyView() : ({ ringkasan: viewRingkasan, produk: viewProduk, biaya: viewBiaya, retur: viewRetur, simulator: viewSimulator, riwayat: viewRiwayat, data: viewData }[viewName])();
    afterRender();
  }
  function afterRender() {
    if (window.CekMotion) { window.CekMotion.reveal($('#view')); window.CekMotion.spotlight($('#view')); }
    if (viewName === 'ringkasan' || viewName === 'biaya') bindTrend($('#monthly'));
    if (viewName === 'produk') renderProducts();
    if (viewName === 'simulator') renderSimOut();
    if (viewName === 'data') { renderFiles(); renderCostTable(); }
    if (viewName === 'riwayat') maybeLoadReports();
  }
  function go(name, push = true, section = '') {
    if (!VIEWS.some((v) => v[0] === name)) name = 'ringkasan';
    viewName = name;
    if (name === 'data') view.section = section || 'unggah';
    // Menu "Pengaturan" / tombol "Atur biaya" langsung membuka bagian biaya tambahan.
    if (name === 'data' && section === 'pengaturan') view.openSec.biaya = true;
    if (push && location.hash !== `#${name}`) history.pushState(null, '', `#${name}`);
    render();
    // Animasi masuk halaman hanya saat berpindah halaman (bukan setiap render ulang).
    const v = $('#view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    clearTimeout(go.t); go.t = setTimeout(() => v.classList.remove('enter'), 400);   // render berikutnya tanpa animasi
    // Menu "Modal & HPP" dan "Pengaturan" membawa ke bagiannya di tampilan Data.
    const target = name === 'data' && view.section !== 'unggah' ? $(`#sec-${view.section}`) : null;
    // Bilah judul menempel di atas, jadi tinggi bilah itu dikurangkan agar judul bagian tidak tertutup.
    if (target) window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - $('#main-top').offsetHeight - 12) });
    else window.scrollTo({ top: 0 });
  }

  /* ================= 5. tampilan ================= */
  const emptyView = () => `<div class="panel empty"><span class="ic">${svg('data', 24)}</span><h2>Mulai dari laporan penghasilan</h2>
    <p>Unggah Laporan Penghasilan Shopee atau TikTok Shop. Hitungan terjadi di browser Anda; file tidak dikirim ke mana pun.</p>
    <button class="btn primary" type="button" data-go="data">Unggah laporan</button><button class="btn link" type="button" data-demo>atau lihat dengan data contoh</button></div>`;

  /* ---------- ringkasan ---------- */
  /* ---------- ringkasan (UI-2): semua angka diambil apa adanya dari engine ---------- */
  // Status cakupan kepastian (kepastian.cakupan): kunci engine → kelas, simbol (lewat CSS), label, penjelasan.
  const COV = [
    ['terverifikasi', 'verified', 'Terverifikasi', 'Jumlah barang dan modal cocok dari export pesanan dan daftar modal Anda.'],
    ['estimasi', 'estimate', 'Perkiraan', 'Modal dari persen atau harga acuan yang Anda isi, bukan modal per produk.'],
    ['estimasiMinimum', 'minimum', 'Perkiraan minimum', 'Export pesanan belum ada, jadi dihitung minimal 1 barang. Laba sebenarnya bisa lebih kecil.'],
    ['belum', 'pending', 'Perlu dicek', 'Angkanya dipakai, tetapi ada refund atau data yang belum cocok.'],
    ['tidakDiketahui', 'unknown', 'Belum diketahui', 'Modal belum diketahui, jadi penjualan ini tidak dihitung dalam laba (bukan dianggap nol).'],
  ];
  /** Porsi tiap status terhadap total cakupan dari engine (pembagian hanya untuk tampilan, tidak menghasilkan angka finansial baru). */
  function covParts(r) {
    const c = r.kepastian.cakupan, tot = c.penjualan.total;
    return COV.map(([k, cls, label, tip]) => ({ k, cls, label, tip, v: c.penjualan[k], n: c.jumlahPesanan[k], share: tot > 0 ? c.penjualan[k] / tot : NaN }));
  }
  /** Kalimat pengingat bahwa persen di atas adalah cakupan, bukan tingkat akurasi (berdasarkan status dari engine). */
  /** P11/P13: catatan singkat di kartu angka bila total belum lengkap (ditahan) atau perlu diverifikasi (ambigu). */
  const heldShort = (r) => { const w = CekReport.peringatanTotal(r);
    return `${w.ditahan.n ? ` · Belum lengkap: ${num(w.ditahan.n)} transaksi ditahan` : ''}${w.ambigu.n ? ` · Perlu verifikasi: ${num(w.ambigu.n)} transaksi belum pasti` : ''}`; };
  const warnTotal = (r) => { const w = CekReport.peringatanTotal(r); return w.ada ? `<p class="small warn-text">${esc(w.teks)}</p>` : ''; };
  const covCaveat = (c) => (c.penjualan.belum > 0 ? ' Namun sebagian angka masih perlu diperiksa.'
    : c.penjualan.estimasiMinimum > 0 || c.penjualan.estimasi > 0 ? ' Namun sebagian HPP masih perkiraan.' : '');
  const ctaBtn = (c, cls = 'btn sm') => (!c ? '' : c.sheet ? `<button class="${cls}" type="button" data-sheet="${c.sheet}">${c.label}</button>`
    : `<button class="${cls}" type="button" data-go="${c.go}" ${c.section ? `data-section="${c.section}"` : ''}>${c.label}</button>`);
  /**
   * Hal yang membuat laba belum final / perlu ditindaklanjuti, dari metadata engine (alasanTidakFinal, cakupan,
   * risikoBarang, bukuUnit). Setiap item punya satu tindakan. prio hanya untuk urutan tampilan.
   */
  function certaintyItems(r) {
    const K = r.kepastian, why = K.laba.alasanTidakFinal, c = K.cakupan, rb = K.risikoBarang, ftp = c.refundTanpaCatatanFisik;
    const sh = (k) => covParts(r).find((p) => p.k === k);
    const out = [];
    const add = (cls, title, desc, cta, prio, impact = '') => out.push({ cls, title, desc, cta, prio, impact });
    const MODAL = { label: 'Lengkapi modal', go: 'data', section: 'modal' }, UNGGAH = { label: 'Unggah data', go: 'data', section: 'unggah' }, RETUR = { label: 'Periksa retur', go: 'retur' };
    // H2-B3b: pesanan refund parsial tanpa jumlah unit dikeluarkan dengan alasannya sendiri (bukan "modal belum diketahui").
    const rpx = c.dikeluarkan.refundParsial || { jumlahPesanan: 0, penjualan: 0 };
    if (!r.ready) add('unknown', 'Laba belum bisa dihitung', rpx.jumlahPesanan && rpx.jumlahPesanan === c.dikeluarkan.jumlahPesanan
      ? 'Pesanan yang ada direfund sebagian tanpa jumlah barang yang tercatat, jadi modalnya belum dapat dihitung.' : 'Modal produk belum diisi, jadi baru penjualan dan potongan yang terlihat.',
      rpx.jumlahPesanan && rpx.jumlahPesanan === c.dikeluarkan.jumlahPesanan ? UNGGAH : MODAL, 100);
    else if (c.penjualan.tidakDiketahui - rpx.penjualan > 0.5 && c.dikeluarkan.jumlahPesanan > rpx.jumlahPesanan && why.includes('modal_tidak_diketahui')) {
      const al = c.dikeluarkan.alasan, n = c.dikeluarkan.jumlahPesanan - rpx.jumlahPesanan, sales = c.dikeluarkan.penjualan - rpx.penjualan;
      const noDetail = al.tanpa_rincian_produk || 0;
      add('unknown', 'Modal belum diketahui', `${pct(c.penjualan.total > 0 ? sales / c.penjualan.total : NaN)} penjualan (${num(n)} pesanan) belum punya modal yang cukup, jadi tidak dihitung dalam laba.${noDetail ? ` ${num(noDetail)} pesanan tidak mencantumkan produk di laporan.` : ''}`,
        noDetail > (n / 2) ? { label: 'Unggah export pesanan', go: 'data', section: 'unggah' } : MODAL, 90, `${fmt(sales)} penjualan tidak dihitung`);
    }
    // H2-B3b: refund parsial tanpa bukti unit (C). Bagian yang bukti unitnya bertentangan ditampilkan terpisah.
    const rpKonflik = rpx.konflik || 0, rpBiasa = rpx.jumlahPesanan - rpKonflik;
    if (rpBiasa > 0) {
      add('pending', 'Refund parsial: jumlah unit belum diketahui', `Sebagian penjualan tidak masuk dalam perhitungan laba karena jumlah unit pada refund parsial belum dapat diverifikasi. ${num(rpBiasa)} pesanan direfund sebagian tanpa jumlah barang yang tercatat. Nilai refund tidak dipakai untuk menebak jumlah barang.`,
        { label: 'Unggah file retur', go: 'data', section: 'unggah' }, 85, `${fmt(rpx.penjualan - (rpx.penjualanKonflik || 0))} penjualan tidak dihitung`);
    }
    // P11: transaksi dengan versi berbeda antarlaporan ditahan (tidak masuk total maupun laba).
    const gb = K.gabungan || {}, ditahan = ['shopee', 'tiktok'].reduce((a, k) => a + ((gb[k] || {}).pesananDitahan || 0) + ((gb[k] || {}).penyesuaianDitahan || 0), 0);
    if (ditahan > 0) {
      add('pending', 'Perlu rekonsiliasi: laporan berbeda', `${num(ditahan)} transaksi muncul di beberapa Laporan Penghasilan dengan isi berbeda. Transaksi ini ditahan: tidak dihitung dalam penjualan, dana, maupun laba, dan tidak dipilih salah satu versinya. Cek di Seller Centre, lalu unggah hanya versi laporan yang benar.`,
        { label: 'Lihat file', go: 'data', section: 'unggah' }, 95, 'total belum final');
    }
    const tl = ['shopee', 'tiktok'].reduce((a, k) => a + ((gb[k] || {}).tidakLengkap || 0), 0);
    if (tl > 0) {
      add('pending', 'Laporan tidak saling lengkap', `${num(tl)} transaksi tercatat di satu Laporan Penghasilan, tetapi tidak ada di laporan lain yang mencakup tanggal yang sama. Transaksi tetap dihitung; pastikan rentang tanggal unduhan benar.`,
        { label: 'Lihat file', go: 'data', section: 'unggah' }, 58);
    }
    // P13: perbedaan yang hanya terlihat dengan periode resmi → identitas transaksi belum pasti (angka tidak diubah).
    const bp = ['shopee', 'tiktok'].reduce((a, k) => a + ((gb[k] || {}).identitasBelumPasti || 0), 0);
    if (bp > 0) {
      add('pending', 'Rekonsiliasi antarlaporan belum pasti', `${num(bp)} transaksi punya nomor yang sama di beberapa Laporan Penghasilan dengan periode yang tumpang tindih, tetapi isinya berbeda. Belum bisa dipastikan apakah itu versi berbeda dari transaksi yang sama atau transaksi yang memang berbeda, jadi semuanya tetap dihitung apa adanya. Cek di Seller Centre.`,
        { label: 'Lihat file', go: 'data', section: 'unggah' }, 59);
    }
    if (why.includes('periode_laporan_perlu_dicek')) {
      add('pending', 'Periode laporan TikTok perlu dicek', 'Periode resmi di sheet Laporan tidak terbaca, atau ada transaksi yang tanggal pembayarannya di luar periode itu. Semua transaksi tetap dihitung.',
        { label: 'Lihat file', go: 'data', section: 'unggah' }, 57);
    }
    // R4: refund susulan TikTok yang pesanan asalnya tidak ada di laporan yang diunggah.
    const rsx = (K.refundTiktok || {}).refundSusulanTidakCocok || { baris: 0 };
    if (rsx.baris > 0) {
      add('pending', 'Refund susulan belum dapat dicocokkan', `${num(rsx.baris)} refund TikTok tercatat sebagai baris terpisah, tetapi pesanan asalnya tidak ada di laporan yang diunggah. HPP-nya belum diketahui, jadi baris ini tidak dihitung dalam laba. Nilai refund tidak dipakai untuk menebak jumlah barang.`,
        UNGGAH, 84, `${fmt(rsx.nilai)} refund`);
    }
    if (rpKonflik > 0) {
      add('pending', 'Data refund perlu dicek', `${num(rpKonflik)} pesanan: file retur menyebut semua barang direfund, tetapi laporan penghasilan menunjukkan refund sebagian. Pesanan ini tidak masuk dalam perhitungan laba sampai datanya dicek di Seller Centre.`,
        RETUR, 86, `${fmt(rpx.penjualanKonflik || 0)} penjualan tidak dihitung`);
    }
    if (c.penjualan.estimasiMinimum > 0) {
      const m = sh('estimasiMinimum');
      add('minimum', 'Export pesanan Shopee belum lengkap', `HPP ${pct(m.share)} penjualan masih perkiraan minimum (dihitung minimal 1 barang per produk). Laba sebenarnya bisa lebih kecil.`,
        { label: 'Unggah export Shopee', go: 'data', section: 'unggah' }, 70, `${num(m.n)} pesanan`);
    }
    if (c.penjualan.belum > 0) {
      const b = sh('belum'), rp = c.refundParsialTanpaUnit.jumlahPesanan;
      add('pending', 'Sebagian HPP perlu dicek', `${pct(b.share)} penjualan memakai angka yang belum pasti, misalnya karena refund atau data yang belum cocok.${rp ? ` ${num(rp)} pesanan direfund sebagian tanpa jumlah barang yang jelas.` : ''}`,
        rp ? RETUR : UNGGAH, 60, `${num(b.n)} pesanan`);
    }
    if (c.penjualan.estimasi > 0) {
      const e = sh('estimasi');
      add('estimate', 'Sebagian modal masih perkiraan', `${pct(e.share)} penjualan memakai modal rata-rata atau harga acuan, bukan modal per produk.`, { label: 'Isi modal per produk', go: 'data', section: 'modal' }, 40, `${num(e.n)} pesanan`);
    }
    if (ftp.jumlahPesanan > 0) {
      const ind = ftp.indikasi && ftp.indikasi.tidak_dikirim;
      add('pending', 'Refund perlu diperiksa', `${num(ftp.jumlahPesanan)} pesanan direfund penuh, tetapi kondisi barangnya belum dicatat.${ftp.nilaiModalDiketahui > 0 ? ` Modal yang mungkin terdampak ${fmt(ftp.nilaiModalDiketahui)}.` : ''}${ftp.kasusModalTidakDiketahui ? ` ${num(ftp.kasusModalTidakDiketahui)} di antaranya belum diketahui nilainya.` : ''}${ind ? ` ${num(ind)} terindikasi tidak dikirim menurut alasan di marketplace (belum dipastikan).` : ''}`,
        RETUR, 55, 'bukan kerugian, tetapi risiko');
    }
    if (why.includes('retur_belum_dicek')) {
      const n = r.cases.filter((x) => x.needsCheck && x.state === 'belum').length;
      add('pending', 'Retur belum dicek', `${num(n)} kasus retur belum ditandai sudah kembali atau tidak kembali.${r.unknownRisk > 0 ? ` Laba bisa turun hingga ${fmt(r.unknownRisk)}.` : ''}${rb.risikoTanpaNilai ? ` ${num(rb.risikoTanpaNilai)} kasus belum punya nilai.` : ''}`, RETUR, 50);
    }
    if (why.includes('kondisi_fisik_unit_refund_belum_diketahui') && K.bukuUnit.unitBelumDiketahui) {
      add('pending', 'Barang refund belum diketahui kondisinya', `${num(K.bukuUnit.unitBelumDiketahui)} barang dari export pesanan sudah direfund, tetapi belum diketahui kembali atau tidak.`, RETUR, 45);
    }
    if (why.includes('kerugian_retur_sementara') || why.includes('kerugian_retur_tanpa_nilai') || why.includes('jumlah_retur_belum_terverifikasi')) {
      add('estimate', 'Kerugian retur masih perkiraan', `Nilai barang yang tidak kembali dihitung dari perkiraan${rb.kerugianTanpaNilai ? `, dan ${num(rb.kerugianTanpaNilai)} kasus belum punya nilai` : ''}.`, RETUR, 30);
    }
    if (why.includes('total_file_tidak_cocok')) add('danger', 'Total file tidak cocok dengan ringkasan resmi', 'Ada laporan penghasilan yang totalnya berbeda dari ringkasan di file. Periksa apakah file terunduh lengkap.', UNGGAH, 95);
    if (why.includes('ringkasan_resmi_tidak_ada')) add('pending', 'Ringkasan resmi tidak ditemukan', 'Total file tidak bisa dicocokkan dengan ringkasan marketplace.', UNGGAH, 35);
    if (why.includes('penyesuaian_belum_diklasifikasikan')) add('estimate', 'Penyesuaian belum masuk laba', `Kompensasi atau penyesuaian ${fmt(r.adjustments)} ditampilkan terpisah dan belum dihitung dalam laba.`, { label: 'Lihat Laba', go: 'biaya' }, 20);
    return out.sort((a, b) => b.prio - a.prio);
  }
  /** Temuan engine yang menuntut tindakan (bad/warn), dengan tujuan tindakan. Tidak menggandakan item kepastian. */
  function insightItems(r, list) {
    const dest = (t) => (/produk/i.test(t) ? { label: 'Lihat produk', go: 'produk' } : /retur|refund/i.test(t) ? { label: 'Periksa retur', go: 'retur' }
      : /biaya operasional/i.test(t) ? { label: 'Atur biaya', go: 'data', section: 'pengaturan' } : { label: 'Lihat Laba', go: 'biaya' });
    return list.filter((i) => (i.level === 'bad' || i.level === 'warn') && !/^Modal baru diketahui|belum bisa dihitung|^Retur & refund/.test(i.title))
      .map((i) => ({ cls: i.level === 'bad' ? 'danger' : 'pending', title: i.title, desc: i.detail, cta: dest(i.title), prio: Math.round(i.score * 0.6), insight: true }));
  }
  const attnItem = (i) => `<li class="attn-item ${i.cls}"><span class="status ${i.cls}" aria-hidden="true"></span>
    <div class="attn-body"><b>${esc(i.title)}</b><p>${esc(i.desc)}</p>${i.impact ? `<span class="attn-impact">${esc(i.impact)}</span>` : ''}</div>
    <div class="attn-cta">${ctaBtn(i.cta)}</div></li>`;

  function viewRingkasan() {
    const { r } = last;
    const pro = isPro();
    const FREE = 2;
    const ins = pro ? r.insights : r.insights.slice(0, FREE);   // akun gratis: 2 temuan pertama (aturan lama tetap)
    const K = r.kepastian, c = K.cakupan;
    const opex = r.fixedMonthly > 0;
    const laba = opex ? r.netProfit : r.totalMargin;
    const parts = covParts(r);
    const barOk = c.penjualan.total > 0 && parts.every((p) => p.v >= 0);
    const cert = certaintyItems(r);
    const attn = [...cert, ...insightItems(r, ins)].sort((a, b) => b.prio - a.prio);
    const others = ins.filter((i) => !attn.some((a) => a.insight && a.title === i.title));
    const finalBadge = K.laba.final ? '<span class="status verified">Final</span>'
      : `<button type="button" class="status pending final-badge" data-sheet="kepastian" aria-haspopup="dialog" aria-label="Status laba: belum final. Lihat alasannya">Belum final</button>`;
    const hppMixed = r.ready && (c.penjualan.estimasi || c.penjualan.estimasiMinimum || c.penjualan.belum);
    const kpi = (label, value, note, cls = '', extra = '', kind = '') => `<div class="metric-card ${cls}" ${kind ? `data-kpi="${kind}"` : ''}><span class="m-label">${kpiIc(kind)}${label}</span><span class="m-value ${typeof value === 'number' && value < 0 ? 'neg' : ''}">${typeof value === 'number' ? fmt(value) : value}</span>${extra}<span class="m-note">${note}</span></div>`;
    // Garis tren kecil di kartu laba: bentuk dari nilai bulanan engine (r.months), hanya untuk gambar, tanpa angka baru.
    const sk = opex ? 'net' : 'margin';
    const sv = r.ready ? r.months.filter((m) => mKnown(m.total)).map((m) => m.total[sk]).filter(ok) : [];
    const spark = (() => {
      if (sv.length < 2) return '';
      const lo = Math.min(...sv), hi = Math.max(...sv), span = hi - lo || 1, W = 220, H = 56;
      const pts = sv.map((v, i) => `${(i * W / (sv.length - 1)).toFixed(1)},${(H - 4 - (v - lo) * (H - 8) / span).toFixed(1)}`);
      return `<figure class="ph-spark" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="area" d="M0,${H} L${pts.join(' L')} L${W},${H} Z"/><path class="line" d="M${pts.join(' L')}"/></svg>
        <figcaption>${opex ? 'Laba dari data tersedia' : 'Laba setelah modal'} per bulan, ${num(sv.length)} bulan</figcaption></figure>`;
    })();
    const kpiTiles = `<section class="d3-tiles" aria-label="Angka pendukung">
        ${kpi(`Penjualan${qi('penjualan', 'Penjualan')}`, r.totalSales, `${num(r.orders)} pesanan terjual${heldShort(r)}`, '', '', 'sales')}
        ${kpi(`Modal / HPP${qi('modal', 'Modal')}`, r.ready ? r.totalModal : '<span class="faint">—</span>', r.ready ? 'dari penjualan yang modalnya diketahui' : 'modal belum diisi', '',
          hppMixed ? '<div class="m-status"><span class="status estimate">Sebagian perkiraan</span></div>' : r.ready && c.penjualan.terverifikasi > 0 ? '<div class="m-status"><span class="status verified">Terverifikasi</span></div>' : '', 'modal')}
        ${kpi(`Potongan marketplace${qi('potongan', 'Potongan marketplace')}`, -r.totalFees, 'dipotong dari penjualan oleh marketplace', '', '', 'fees')}
      </section>`;
    return `<div class="dash d3">
      <div class="d3-top">
        <section class="dash-hero d3-profit" aria-label="Laba">
          ${kpi(`Laba dari data tersedia${qi('laba_bersih', 'Laba dari data tersedia')}`, r.ready ? laba : '<span class="faint">Belum dihitung</span>',
            `${r.ready ? `${opex ? 'setelah biaya operasional yang tercatat. ' : ''}${pct(r.coverage, 0)} penjualan masuk dalam perhitungan` : 'isi modal produk agar laba bisa dihitung'}${heldShort(r)}`,
            'is-hero', `<div class="m-status">${finalBadge}</div>${spark}<div class="ph-cta">${r.ready ? '<button type="button" class="btn sm ph-btn" data-go="biaya">Lihat rincian laba<svg class="arr" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' : '<button type="button" class="btn sm ph-btn" data-go="data" data-section="modal">Isi modal</button>'}</div>`)}
        </section>

        <section class="section-card kep d3-conf" aria-labelledby="kep-t" data-spotlight>
          <div class="kep-head">
            <div><h2 id="kep-t" class="kep-title">Kepastian Profit</h2><p class="kep-sub">Seberapa kuat data yang mendasari perhitungan laba Anda</p></div>
            <div class="kep-state">${finalBadge}</div>
          </div>
          <div class="kep-body">
            <div class="kep-main">
              ${barOk ? `<div class="cov-bar" role="group" aria-label="Kualitas dasar perhitungan, porsi penjualan per status: ${parts.filter((p) => p.v > 0).map((p) => `${p.label} ${pct(p.share)}`).join(', ')}">
                ${parts.filter((p) => p.v > 0).map((p) => `<button type="button" class="cov-seg ${p.cls}" style="--w:${(p.share * 100).toFixed(3)}%" data-sheet="kepastian" aria-haspopup="dialog" data-tip="${p.label} · ${pct(p.share)}" aria-label="${p.label} ${pct(p.share)}. Buka penjelasan"></button>`).join('')}</div>`
                : '<p class="small muted">Sebagian penjualan bernilai minus (refund atau potongan), jadi porsinya tidak digambar sebagai batang. Rinciannya ada di daftar.</p>'}
              <p class="kep-note">${r.ready ? `<b>${pct(r.coverage, 0)}</b> penjualan (${fmt(c.labaTerhitung.dasarPenjualan)}) masuk dalam perhitungan laba.${covCaveat(c)}` : 'Laba belum bisa dihitung karena modal belum diisi.'}${CekReport.peringatanTotal(r).ada ? ` ${esc(CekReport.peringatanTotal(r).teks)}` : ''}</p>
              <div class="kep-actions">${cert.length ? `<button type="button" class="kep-count" data-sheet="kepastian" aria-haspopup="dialog"><b>${num(cert.length)}</b><span>hal perlu dilengkapi</span></button>` : '<span class="status verified">Tidak ada yang perlu dilengkapi</span>'}
                <button type="button" class="btn sm" data-sheet="kepastian" aria-haspopup="dialog">Lihat detail kepastian</button></div>
            </div>
            <div class="cov-side"><p class="cov-k">Kualitas dasar perhitungan <span>porsi penjualan per status</span></p><ul class="cov-legend">${parts.map((p) => `<li class="${p.v ? '' : 'is-zero'}"><span class="status ${p.cls}">${p.label}</span><b>${ok(p.share) ? pct(p.share) : '—'}</b><span class="cov-amt">${fmt(p.v)} · ${num(p.n)} pesanan</span></li>`).join('')}</ul></div>
          </div>
        </section>
      </div>

      ${kpiTiles}

      <section class="section-card trend d3-trend" id="monthly" aria-labelledby="trend-t">${trendCard(r)}</section>

      <section class="section-card attn d3-attn" aria-labelledby="attn-t">
        <div class="card-header"><h3 id="attn-t">Perlu perhatian</h3><p>${attn.length ? `${num(attn.length)} hal, diurutkan dari yang paling berdampak` : 'Tidak ada'}</p></div>
        ${attn.length ? `<ul class="attn-list attn-rail">${attn.slice(0, 6).map(attnItem).join('')}</ul>
          ${attn.length > 6 ? `<details class="disclose"><summary>${num(attn.length - 6)} hal lainnya</summary><ul class="attn-list">${attn.slice(6).map(attnItem).join('')}</ul></details>` : ''}`
          : '<div class="mini-empty"><span class="status verified">Tidak ada yang perlu ditindaklanjuti</span><p class="small muted">Data yang diunggah tidak menunjukkan masalah yang perlu dilengkapi.</p></div>'}
        ${!pro && r.insights.length > FREE ? `<p class="tiny faint">${num(r.insights.length - FREE)} temuan lain tersedia di Pro. <button class="btn link" type="button" data-upgrade>Lihat paket</button></p>` : ''}
      </section>

      <div class="d3-pair">
        <section class="section-card money" aria-labelledby="money-t">${moneyCard(r)}</section>
        <section class="section-card prod-prev" aria-labelledby="prod-t">${productPreview(r)}</section>
      </div>

      ${others.length ? `<section class="section-card dash-ins" aria-labelledby="ins-t"><div class="card-header"><h3 id="ins-t">Temuan lain</h3><p>Dibuat otomatis dari data Anda</p></div>
        <ul class="insights">${others.map(insightItem).join('')}</ul></section>` : ''}

      <details class="section-card rincian" ${view.rincian ? 'open' : ''}>
        <summary><span><b>Rincian laba</b><span class="small muted">Nota laba dan angka per bulan/pesanan</span></span><span class="btn sm rincian-cta" aria-hidden="true">Lihat rincian laba</span></summary>
        <div class="grid-nota rincian-body">${nota(r)}<div class="stack">${facts(r)}</div></div>
      </details>
    </div>`;
  }

  /** Grafik tren bulanan: total per bulan dari r.months (tidak ada angka baru). Bisa disorot, diketuk, dan difokus keyboard. */
  /** opt.title dan opt.table: halaman Laba memakai judul sendiri dan tabel bulanannya sendiri (tanpa margin % buatan UI). */
  function trendCard(r, opt = {}) {
    const key = view.metric === 'sales' || !r.ready ? 'sales' : 'margin';
    const ms = r.months;
    const head = `<div class="card-header"><h3 id="trend-t">${opt.title || 'Tren bisnis'}</h3>
      <div class="seg" role="group" aria-label="Ukuran tren">${[['margin', 'Laba'], ['sales', 'Penjualan']].filter(([k]) => k !== 'margin' || r.ready).map(([k, l]) => `<button type="button" data-metric="${k}" aria-pressed="${key === k}">${l}</button>`).join('')}</div></div>`;
    if (!ms.length) return `${head}<div class="mini-empty"><p class="small muted">Belum ada data per bulan.</p></div>`;
    const last1 = ms[ms.length - 1];
    const monthEnd = new Date(+last1.month.slice(0, 4), +last1.month.slice(5), 0).toLocaleDateString('sv-SE');
    const running = r.last && r.last < monthEnd;
    const val = (m) => m.total[key];
    // Bulan yang labanya belum diketahui tidak digambar sebagai batang 0; diberi tanda "?" (dari metadata engine).
    const unknownM = (m) => key === 'margin' && !mKnown(m.total);
    const W = 640, H = 220, L = 52, R = 8, T = 12, B = 28;
    const vals = ms.map((m) => (unknownM(m) ? 0 : val(m)));
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const step = niceStep((hi - lo) / 4 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const band = (W - L - R) / ms.length, bw = Math.max(6, Math.min(34, band * 0.56));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${Math.abs(v) < 1e-9 ? 'axis0' : 'grid'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtShort(v)}</text>`;
    const label = key === 'margin' ? 'Laba setelah modal' : 'Penjualan';
    ms.forEach((m, i) => {
      const unk = unknownM(m), v = unk ? 0 : val(m), cx = L + band * i + band / 2, x = cx - bw / 2, top = Math.min(y(0), y(v)), h = Math.max(1, Math.abs(y(v) - y(0)));
      const isRun = running && i === ms.length - 1;
      const part = key === 'margin' && mStat(m.total) === 'sebagian' ? ' (sebagian penjualan belum punya modal)' : '';
      const tip = unk ? `${monthLong(m.month)}${isRun ? ' (berjalan)' : ''}: ${label} belum diketahui, modal belum ada untuk ${num(m.total.orders)} pesanan`
        : `${monthLong(m.month)}${isRun ? ' (berjalan)' : ''}: ${label} ${fmt(v)} dari ${num(m.total.orders)} pesanan${part}`;
      g += `<g class="tbar ${v < 0 ? 'neg' : ''} ${isRun ? 'run' : ''} ${unk ? 'unknown' : ''}" tabindex="0" role="listitem" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
        <rect class="hit" x="${cx - band / 2}" y="${T}" width="${band}" height="${H - T - B}"/>${unk ? `<text class="t-unk" x="${cx}" y="${y(0) - 6}" text-anchor="middle">?</text>` : `<rect class="bar" x="${x}" y="${top}" width="${bw}" height="${h}" rx="${Math.min(5, bw / 3)}"/>`}
        <text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(m.month)}${isRun ? '*' : ''}</text></g>`;
    });
    const best = r.insights.find((x) => /^Laba tertinggi di /.test(x.title));
    return `${head}
      <div class="tchart"><svg viewBox="0 0 ${W} ${H}" role="list" aria-label="${label} per bulan. Gunakan Tab untuk membaca tiap bulan."><defs aria-hidden="true"><linearGradient id="tg-pos" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tg-a"/><stop offset="1" class="tg-b"/></linearGradient><linearGradient id="tg-neg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tg-c"/><stop offset="1" class="tg-d"/></linearGradient></defs>${g}</svg><div class="tip" hidden></div></div>
      <p class="tiny faint">${ms.length < 2 ? 'Tren butuh minimal 2 bulan data. ' : ''}${running ? '* Bulan berjalan: datanya belum lengkap. ' : ''}${key === 'margin' ? 'Laba setelah modal, dari pesanan yang modalnya diketahui.' : 'Penjualan per bulan pesanan.'}</p>
      ${best && key === 'margin' ? `<p class="trend-sum small"><span class="status estimate" aria-hidden="true"></span>${esc(best.title)}. ${esc(best.detail)}</p>` : ''}
      ${opt.table === false ? '' : `<details class="disclose"><summary>Lihat tabel per bulan</summary>
        <div class="tablewrap"><table class="data"><thead><tr><th>Bulan</th><th>Pesanan</th><th>Penjualan</th><th>Potongan</th><th>Laba setelah modal</th><th>Margin %</th>${r.fixedMonthly ? '<th>Laba dari data tersedia</th>' : ''}</tr></thead>
        <tbody>${ms.map((m) => `<tr><td>${monthLong(m.month)}</td><td>${num(m.total.orders)}</td><td>${fmt(m.total.sales)}</td><td class="neg">${fmt(m.total.fees)}</td>
          <td>${mLaba(r.ready, m.total, m.total.margin)}</td><td>${r.ready && mKnown(m.total) && m.total.knownSales ? pct(m.total.margin / m.total.knownSales) : '—'}</td>
          ${r.fixedMonthly ? `<td>${mLaba(r.ready, m.total, m.total.net)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`}`;
  }
  function bindTrend(box) {
    if (!box) return;
    const tip = box.querySelector('.tip'), wrap = box.querySelector('.tchart');
    if (!tip || !wrap) return;
    const show = (el) => {
      box.querySelectorAll('.tbar.on').forEach((x) => x.classList.remove('on'));
      el.classList.add('on');
      const b = wrap.getBoundingClientRect(), r = el.querySelector('.bar').getBoundingClientRect();
      tip.textContent = el.dataset.tip; tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(r.left - b.left + r.width / 2, 70), b.width - 70)}px`; tip.style.top = `${r.top - b.top}px`;
    };
    const hide = (el) => { el.classList.remove('on'); tip.hidden = true; };
    box.querySelectorAll('.tbar').forEach((el) => {
      el.addEventListener('mouseenter', () => show(el)); el.addEventListener('mouseleave', () => hide(el));
      el.addEventListener('focus', () => show(el)); el.addEventListener('blur', () => hide(el));
      el.addEventListener('click', () => show(el));   // ketuk di HP
    });
  }

  /** Ke mana uang pergi: nominal dari engine, tidak dipaksa menjadi 100%. */
  function moneyCard(r) {
    const c = r.kepastian.cakupan, rb = r.kepastian.risikoBarang;
    const opex = r.fixedMonthly > 0;
    const rows = [
      { label: 'Penjualan', v: r.totalSales, cls: 'base', note: `${num(r.orders)} pesanan terjual` },
      { label: 'Potongan marketplace', v: -r.totalFees, cls: 'cost', note: 'admin, ongkir, komisi, dan biaya lain dari laporan' },
      ...(ok(r.totalReceived) ? [{ label: 'Dana diterima', v: r.totalReceived, cls: 'base sub', note: 'menurut laporan penghasilan' }] : []),
      ...(r.ready ? [{ label: 'Modal / HPP', v: r.totalModal, cls: 'cost', note: 'dari penjualan yang modalnya diketahui' }] : [{ label: 'Modal / HPP', v: NaN, cls: 'unknown', note: 'modal belum diisi' }]),
      ...(r.knownPacking ? [{ label: typeOf(st()) === 'dropship' ? 'Biaya dropship' : 'Packing', v: r.knownPacking, cls: 'cost', note: 'biaya per pesanan yang Anda isi' }] : []),
      ...(r.lostCertain || rb.kerugianTanpaNilai ? [{ label: 'Kerugian barang retur', v: r.lostCertain || NaN, cls: 'cost', note: rb.kerugianTanpaNilai ? `${num(rb.kerugianTanpaNilai)} kasus tanpa nilai belum dikurangkan` : 'barang yang Anda tandai tidak kembali' }] : []),
      ...(opex ? [{ label: 'Biaya operasional', v: r.opex, cls: 'cost', note: `${fmt(r.fixedMonthly)} per bulan yang Anda isi` }] : []),
      ...(Math.abs(c.dikeluarkan.danaDiterima) >= 1 ? [{ label: 'Tidak dihitung', v: c.dikeluarkan.danaDiterima, cls: 'unknown', note: `dana dari ${num(c.dikeluarkan.jumlahPesanan)} pesanan yang HPP-nya belum dapat dihitung` }] : []),
      ...(r.ready ? [{ label: 'Laba dari data tersedia', v: opex ? r.netProfit : r.totalMargin, cls: 'profit', note: opex ? 'setelah biaya operasional yang tercatat' : 'setelah modal dan biaya yang tercatat' }] : []),
    ];
    const max = Math.max(...rows.filter((x) => ok(x.v)).map((x) => Math.abs(x.v)), 1);
    return `<div class="card-header"><h3 id="money-t">Ke mana uang pergi</h3><p>Nominal dari laporan dan isian Anda</p></div>
      <ul class="flow">${rows.map((x) => `<li class="flow-row ${x.cls} ${ok(x.v) && x.v < 0 ? 'is-neg' : ''}"><div class="flow-lbl"><b>${x.label}</b><span>${esc(x.note)}</span></div>
        <div class="flow-track" aria-hidden="true">${ok(x.v) ? `<i style="--w:${((Math.abs(x.v) / max) * 100).toFixed(2)}%"></i>` : ''}</div>
        <span class="flow-val ${ok(x.v) && x.v < 0 ? 'neg' : ''}">${ok(x.v) ? fmt(x.cls === 'cost' ? -x.v : x.v) : 'Belum diketahui'}</span></li>`).join('')}</ul>
      ${warnTotal(r)}<p class="tiny faint">Komponen tidak dijumlahkan menjadi 100%: sebagian penjualan belum dihitung dan tiap laporan punya definisi sendiri. Berdasarkan laporan yang diunggah. Belum merupakan rekonsiliasi pencairan dana.</p>`;
  }

  /** Cuplikan produk: urutan dari angka engine (laba produk, status), tanpa status kepastian baru. */
  function productPreview(r) {
    const head = (n) => `<div class="card-header"><h3 id="prod-t">Produk</h3>${n ? `<button class="card-action" type="button" data-go="produk">Lihat semua produk (${num(n)})</button>` : ''}</div>`;
    if (!r.products.length) return `${head(0)}<div class="mini-empty"><p class="small muted">Belum ada rincian produk. Laporan penghasilan TikTok sering tidak mencantumkan produk.</p>${ctaBtn({ label: 'Unggah export pesanan', go: 'data', section: 'unggah' })}</div>`;
    const known = r.products.filter((p) => ok(p.margin));
    if (!known.length) return `${head(r.products.length)}<div class="mini-empty"><p class="small muted">Laba per produk muncul setelah modal produk diisi.</p>${ctaBtn({ label: 'Lengkapi modal', go: 'data', section: 'modal' })}</div>`;
    const top = [...known].sort((a, b) => b.margin - a.margin).slice(0, 3);
    const weak = known.filter((p) => p.health === 'rugi' || p.health === 'tipis' ).sort((a, b) => a.margin - b.margin).filter((p) => !top.includes(p)).slice(0, 3);
    const HL = { rugi: ['danger', 'Rugi'], tipis: ['pending', 'Tipis'], sehat: ['verified', 'Sehat'] };
    const row = (p) => `<li class="pp-row"><i class="sw" style="background:var(--${p.platform})" aria-hidden="true"></i><span class="pp-name">${esc(p.name)}<span class="sr-only"> (${PNAME[p.platform]})</span></span>
      <span class="pp-val ${p.margin < 0 ? 'neg' : ''}">${fmt(p.margin)}</span><span class="pp-pct">${pct(p.pct)}</span>${HL[p.health] ? `<span class="status ${HL[p.health][0]}">${HL[p.health][1]}</span>` : '<span></span>'}</li>`;
    const list = (title, arr) => (arr.length ? `<div class="pp-group"><span class="pp-k">${title}</span><ul>${arr.map(row).join('')}</ul></div>` : '');
    return `${head(r.products.length)}<div class="pp-cols">${list('Laba terbesar', top)}${list('Rugi atau di bawah target', weak)}</div>
      <p class="tiny faint">Laba produk dan margin (laba ÷ penjualan produk) dari perhitungan per produk.</p>`;
  }

  /**
   * Nota laba: Penjualan − potongan = dana diterima − modal − packing − kerugian retur (− biaya operasional) = laba.
   * Semua nilai dari engine. Nilai yang belum diketahui ditulis "Belum diketahui", tidak pernah Rp0.
   * Tanda "=" hanya dipakai bila angka engine memang cocok; bila laporan memuat komponen lain, tanda tidak dipaksakan.
   */
  function nota(r) {
    const lines = [];
    const L = (op, label, v, cls = '', note = '', key = '') => lines.push(`<div class="ln ${cls}"><dt>${op ? `<span class="op" aria-hidden="true">${op}</span>` : ''}<span class="lbl-t">${label}${key ? qi(key, label) : ''}</span>${note ? `<small>${note}</small>` : ''}</dt><dd>${ok(v) ? fmt(v) : '<span class="unk">Belum diketahui</span>'}</dd></div>`);
    const isDrop = typeOf(st()) === 'dropship';
    const rb = r.kepastian.risikoBarang, opex = r.fixedMonthly > 0;
    // Pengecekan kecocokan hanya memilih tanda "=", tidak menghasilkan angka baru.
    const near = (a, b) => ok(a) && ok(b) && Math.abs(a - b) < 1;
    L('', 'Penjualan', r.totalSales, '', `${num(r.orders)} pesanan terjual${heldShort(r)}`, 'penjualan');
    L('−', 'Potongan marketplace', r.totalFees, 'minus', `${pct(-r.totalFees / r.totalSales)} dari penjualan`, 'potongan');
    L(near(r.totalSales + r.totalFees, r.totalReceived) ? '=' : '', 'Dana diterima', r.totalReceived, 'sub', near(r.totalSales + r.totalFees, r.totalReceived) ? '' : 'menurut laporan; ada komponen lain di luar penjualan dan potongan', 'dana_diterima');
    if (r.ready) {
      // Dana dari pesanan yang dikeluarkan dari laba (modal tidak diketahui), langsung dari engine. Bisa negatif.
      const unknown = r.kepastian.cakupan.dikeluarkan.danaDiterima;
      if (Math.abs(unknown) >= 1) L('−', 'Dana dari pesanan yang HPP-nya belum diketahui', -unknown, 'muted', 'tidak dihitung sampai modal atau jumlah unitnya diketahui', 'tanpa_modal');
      L('−', 'Modal / HPP', -r.totalModal, 'minus', '', 'modal');
      if (r.knownPacking) L('−', isDrop ? 'Biaya dropship' : 'Packing', -r.knownPacking, 'minus', '', isDrop ? 'dropship_fee' : 'packing');
      // Kasus "tidak kembali" tanpa nilai tidak dikurangkan dan tidak ditampilkan sebagai Rp0.
      if (r.lostCertain || rb.kerugianTanpaNilai) L('−', 'Kerugian retur', r.lostCertain ? -r.lostCertain : NaN, 'minus', rb.kerugianTanpaNilai ? `+ ${num(rb.kerugianTanpaNilai)} kasus nilainya belum diketahui.` : 'barang yang Anda tandai tidak kembali', 'retur_hilang');
      if (opex) { L('=', 'Laba setelah modal', r.totalMargin, 'sub', '', 'margin_kotor'); L('−', 'Biaya operasional', -r.opex, 'minus', `${fmt(r.fixedMonthly)} per bulan yang Anda isi`, 'opex'); }
    } else L('−', 'Modal / HPP', NaN, 'minus', 'modal produk belum diisi', 'modal');
    const total = opex ? r.netProfit : r.totalMargin;
    const label = 'Laba dari data tersedia';
    const notes = [CekReport.peringatanTotal(r).teks, opex ? 'Setelah biaya operasional yang tercatat.' : 'Biaya operasional belum dicatat.',
      r.coverage < 0.995 ? `Dari ${pct(r.coverage, 0)} penjualan yang masuk dalam perhitungan.` : '',
      r.unknownRisk > 0 ? `Bisa turun ${fmt(r.unknownRisk)} bila retur yang belum dicek tidak kembali.` : '',
      rb.risikoTanpaNilai ? `${num(rb.risikoTanpaNilai)} kasus retur yang belum dicek belum punya nilai, jadi risikonya belum bisa dihitung.` : ''].filter(Boolean).join(' ');
    return `<section class="nota" aria-label="Nota laba">
      <div class="nota-head"><b>Nota laba</b><span>${tgl(r.first)} sampai ${tgl(r.last)}<br>${['shopee', 'tiktok'].filter((k) => r.has[k]).map((k) => PNAME[k]).join(' dan ')}</span></div>
      <dl>${lines.join('')}</dl>
      <div class="nota-total"><span class="lbl"><span class="op" aria-hidden="true">=</span>${label}${qi(opex ? 'laba_bersih' : 'margin_total', label)}</span>
        ${r.ready ? `<span class="big ${total < 0 ? 'neg' : ''}">${fmt(total)}</span><span class="note">${notes}</span>`
          : `<span class="big faint">Belum dihitung</span><span class="note">${CekReport.peringatanTotal(r).teks} Isi modal produk agar laba bisa dihitung.</span>`
          + '<button class="btn sm primary" type="button" data-go="data" data-section="modal" style="justify-self:start;margin-top:6px">Isi modal</button>'}
      </div></section>`;
  }
  function facts(r) {
    const ms = r.months.filter((m) => m.total.sales > 0);
    const a = ms[ms.length - 1], b = ms[ms.length - 2];
    const monthEnd = a ? new Date(+a.month.slice(0, 4), +a.month.slice(5), 0).toLocaleDateString('sv-SE') : '';
    const running = a && r.last < monthEnd;
    const delta = (x, y) => { if (!ok(x) || !ok(y) || !y) return ''; const d = (x - y) / Math.abs(y); return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${pct(Math.abs(d), 0)}</span>`; };
    const target = st().targetProfit;
    const msKnown = r.months.filter((m) => mKnown(m.total));
    const hitN = ok(target) && target > 0 && r.ready ? msKnown.filter((m) => (r.fixedMonthly ? m.total.net : m.total.margin) >= target).length : null;
    // Laba bulan tanpa penjualan bermodal belum diketahui → NaN (tampil "—"), bukan Rp0; selisih juga tidak dihitung.
    const key = (m) => (r.ready ? (mKnown(m.total) ? m.total.margin : NaN) : m.total.sales);
    // Sama dengan sampul PDF: rata-rata hanya untuk data ≥ 1 bulan; di bawah itu laba periode data (bukan ekstrapolasi).
    const lb = CekReport.labaBulanan(r), lbDasar = lb.dasar === 'laba_dari_data_tersedia' ? 'laba dari data tersedia' : 'laba setelah modal';
    const lbSeb = r.statusHpp && r.statusHpp.total === 'sebagian' ? ', dari penjualan yang modalnya diketahui' : '';
    const lbNote = lb.jenis === 'rata' ? `${lbDasar} dibagi ${(Math.round(r.monthsSpan * 10) / 10).toLocaleString('id-ID')} bulan data (dinormalisasi per 30,4 hari)${lbSeb}`
      : lb.jenis === 'periode' ? `${lbDasar} selama ${num(r.days)} hari data, belum sebulan penuh${lbSeb}` : 'modal belum diisi';
    return `<div class="facts">
      <div class="fact"><span>${lb.label}${qi('rata_bulan')}</span><b class="${lb.nilai < 0 ? 'neg' : ''}">${lb.jenis === 'belum' ? '<span class="unk">Belum diketahui</span>' : fmt(lb.nilai)}</b><small>${lbNote}</small></div>
      <div class="fact"><span>Laba per pesanan${qi('margin_pesanan')}</span><b>${r.ready ? fmt(r.perOrder) : '—'}</b><small>dari ${num(r.orders)} pesanan</small></div>
      ${a && b ? `<div class="fact"><span>${monthLong(a.month)}${running ? ' (berjalan)' : ''}${qi('bulan_ini')}</span><b>${ok(key(a)) ? fmt(key(a)) : '<span class="unk">Belum diketahui</span>'}</b><small>${r.ready ? 'laba' : 'penjualan'} ${delta(key(a), key(b))} dibanding ${monthLabel(b.month)}</small></div>
      <div class="fact"><span>Potongan ${monthLabel(a.month)}${qi('potongan_bulan')}</span><b>${pct(-a.total.fees / (a.total.sales || 1))}</b><small>${pct(-b.total.fees / (b.total.sales || 1))} di ${monthLabel(b.month)}</small></div>`
      : `<div class="fact"><span>Potongan marketplace${qi('potongan')}</span><b>${pct(-r.totalFees / r.totalSales)}</b><small>${fmt(-r.totalFees)}</small></div><div class="fact"><span>Modal diketahui${qi('modal_diketahui')}</span><b>${pct(r.coverage, 0)}</b><small>dari penjualan</small></div>`}
      ${hitN !== null ? `<div class="fact" style="grid-column:1/-1;border-right:0;border-top:1px solid var(--line)"><span>Target ${r.fixedMonthly ? 'laba' : 'laba setelah modal'} ${fmt(target)} per bulan${qi('target_laba')}</span><b>${hitN} dari ${msKnown.length} bulan</b><small>mencapai target</small></div>` : ''}
    </div>`;
  }
  const insightItem = (i) => `<li class="insight ${i.level}"><span class="bar" aria-hidden="true"></span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p>${i.action ? `<div class="act">${esc(i.action)}</div>` : ''}</div></li>`;
  const lockVeil = (title, body) => `<div class="veil"><div><span class="badge pro">PRO</span><b>${esc(title)}</b><span class="small muted">${esc(body)}</span>
    <button class="btn sm primary" type="button" data-upgrade>Buka dengan Pro</button></div></div>`;

  function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  /* ---------- produk (UI-3): angka per produk dari engine; UI hanya menyaring, mengurutkan, dan menampilkan ---------- */
  const HEALTH = { sehat: 'Sehat', tipis: 'Tipis', rugi: 'Rugi', unknown: 'Modal belum ada' };
  const healthChip = (h) => `<span class="chip ${HEALTH[h] ? h : 'unknown'}">${HEALTH[h] || HEALTH.unknown}</span>`;
  const healthWhy = (p, r) => ({
    sehat: `Laba positif dan margin mencapai target ${pct(r.target, 0)}.`,
    tipis: `Masih untung, tetapi margin di bawah target ${pct(r.target, 0)}.`,
    rugi: 'Laba produk negatif, atau harga rata-rata di bawah harga impas.',
  })[p.health] || 'Modal produk belum diketahui, jadi laba produk belum dihitung (bukan dianggap nol).';
  const SORTS = [['margin', 'Laba terbesar'], ['margin-asc', 'Laba terkecil'], ['sales', 'Penjualan terbesar'], ['qty', 'Terjual terbanyak'], ['pct-asc', 'Margin terendah']];
  const sold = (p) => (p.qtyKnown ? num(p.qty) : `${num(p.rows)}×`);
  const money = (v, unknownText = 'Belum diketahui') => (ok(v) ? `<span class="${v < 0 ? 'neg' : ''}">${fmt(v)}</span>` : `<span class="unk">${unknownText}</span>`);
  function viewProduk() {
    const { r } = last;
    if (!r.products.length) return `<div class="panel empty"><span class="ic">${svg('produk', 24)}</span><h2>Belum ada rincian produk</h2><p>Laporan penghasilan TikTok sering tidak mencantumkan produk. Unggah export pesanan TikTok atau laporan Shopee untuk melihat analisis per produk.</p><button class="btn primary" type="button" data-go="data">Unggah file</button></div>`;
    return `<section class="section-card prod-card" aria-label="Daftar produk">
      <div class="prod-toolbar">
        <div class="prod-search"><label class="sr-only" for="q">Cari produk atau SKU</label>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input class="plain" id="q" type="search" placeholder="Cari produk atau SKU" value="${esc(view.q)}" autocomplete="off"></div>
        <div class="prod-sort"><label for="sort">Urutkan</label><select class="compact" id="sort">${SORTS.map(([k, l]) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="prod-filters" id="prod-filters" role="group" aria-label="Saring menurut status"></div>
      <p class="sr-only" id="prod-count" aria-live="polite"></p>
      <div id="product-table" class="prod-list"></div>
    </section>`;
  }
  function renderProducts(animate = false) {
    const box = $('#product-table');
    if (!box || !last) return;
    const { r } = last;
    const q = Engine.norm(view.q);
    const val = (x) => (ok(x) ? x : -Infinity);
    const sorters = { margin: (a, b) => val(b.margin) - val(a.margin), 'margin-asc': (a, b) => (ok(a.margin) ? a.margin : Infinity) - (ok(b.margin) ? b.margin : Infinity),
      'pct-asc': (a, b) => (ok(a.pct) ? a.pct : Infinity) - (ok(b.pct) ? b.pct : Infinity), sales: (a, b) => b.sales - a.sales, qty: (a, b) => b.qty - a.qty };
    // Saringan status hanya menampilkan status yang memang ada di data.
    const counts = {}; r.products.forEach((p) => { const h = HEALTH[p.health] ? p.health : 'unknown'; counts[h] = (counts[h] || 0) + 1; });
    if (view.prodFilter !== 'all' && !counts[view.prodFilter]) view.prodFilter = 'all';
    const fbox = $('#prod-filters');
    if (fbox) fbox.innerHTML = [['all', 'Semua', r.products.length], ...['sehat', 'tipis', 'rugi', 'unknown'].filter((h) => counts[h]).map((h) => [h, HEALTH[h], counts[h]])]
      .map(([k, l, n]) => `<button type="button" class="fchip psum ${k}" data-pfilter="${k}" aria-pressed="${view.prodFilter === k}"><b class="n">${num(n)}</b><span class="pl">${k === 'all' ? '' : `<i class="fdot ${k}" aria-hidden="true"></i>`}${k === 'all' ? 'Semua produk' : l}</span></button>`).join('')
      // sebaran status (lebar = jumlah produk per status; gambar saja)
      + `<div class="ps-dist" aria-hidden="true">${['sehat', 'tipis', 'rugi', 'unknown'].filter((h) => counts[h]).map((h) => `<i class="${h}" style="flex:${counts[h]}"></i>`).join('')}</div>`;
    let list = r.products.filter((p) => (!q || Engine.norm(`${p.name} ${p.sku} ${p.code}`).includes(q)) && (view.prodFilter === 'all' || (HEALTH[p.health] ? p.health : 'unknown') === view.prodFilter));
    if (view.sort === 'pct-asc') list = list.filter((p) => p.rows >= 3);
    list.sort(sorters[view.sort] || sorters.margin);
    const pro = isPro(), FREE = 5;
    const shown = !pro ? list.slice(0, FREE) : view.showAll ? list : list.slice(0, 20);
    const nameCell = (p) => `<button type="button" class="prod-open" data-prod="${esc(p.key)}">${PLAT_DOT(p.platform)}<span class="pn">${esc(p.name)}</span></button>${p.variant && p.variant !== 'Default' ? `<span class="pv">${esc(p.variant)}</span>` : ''}<span class="sr-only">, ${PNAME[p.platform]}</span>`;
    const row = (p, i) => `<tr data-prod="${esc(p.key)}" style="--i:${Math.min(i, 12)}" class="h-${HEALTH[p.health] ? p.health : 'unknown'} ${p.key === view.prodKey && sheetKind === 'produk' ? 'is-selected' : ''}"><th scope="row">${nameCell(p)}</th><td>${sold(p)}</td><td>${fmt(p.sales)}</td><td>${p.modalKnown ? fmt(p.modal) : '<span class="unk">Belum diketahui</span>'}</td>
      <td>${money(p.margin)}</td><td>${ok(p.pct) ? `<span class="mcell"><span class="${p.pct < 0 ? 'neg' : ''}">${pct(p.pct)}</span><span class="mbar" aria-hidden="true"><i style="--m:${Math.max(2, Math.min(100, Math.abs(p.pct) * 200)).toFixed(0)}%"></i></span></span>` : '<span class="faint">—</span>'}</td><td>${ok(p.breakEven) ? fmt(p.breakEven) : '<span class="faint">—</span>'}</td><td>${healthChip(p.health)}</td><td class="row-go" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td></tr>`;
    const card = (p, i) => `<li style="--i:${Math.min(i, 12)}"><button type="button" class="pcard" data-prod="${esc(p.key)}" aria-label="${esc(p.name)}, ${PNAME[p.platform]}. Laba ${ok(p.margin) ? fmt(p.margin) : 'belum diketahui'}. Status ${HEALTH[p.health] || HEALTH.unknown}. Buka detail.">
      <span class="pc-top"><span class="pc-name">${PLAT_DOT(p.platform)}${esc(p.name)}</span>${healthChip(p.health)}</span>
      <span class="pc-meta"><span class="pc-plat">${PNAME[p.platform]}</span>${sold(p)} terjual${p.variant && p.variant !== 'Default' ? ` · ${esc(p.variant)}` : ''}</span>
      <span class="pc-nums"><span><small>Laba</small>${money(p.margin)}</span><span><small>Margin</small>${ok(p.pct) ? pct(p.pct) : '—'}</span><span><small>Penjualan</small>${fmt(p.sales)}</span></span></button></li>`;
    const head = `<thead><tr><th scope="col">Produk</th><th scope="col">Terjual${qi('terjual')}</th><th scope="col">Penjualan</th><th scope="col">HPP / Modal${qi('modal')}</th><th scope="col">Laba${qi('margin_produk')}</th><th scope="col">Margin${qi('margin_pct')}</th><th scope="col">Harga impas${qi('harga_impas')}</th><th scope="col">Status${qi('status')}</th><th scope="col" class="row-go"><span class="sr-only">Detail</span></th></tr></thead>`;
    const empty = `<div class="mini-empty"><p class="small muted">Tidak ada produk yang cocok${view.q ? ` dengan “${esc(view.q)}”` : ''}.</p></div>`;
    box.innerHTML = `${shown.length ? `<div class="tablewrap prod-table"><table class="data">${head}<tbody>${shown.map(row).join('')}</tbody></table></div>
      <ul class="pcards">${shown.map(card).join('')}</ul>` : empty}
      ${!pro && list.length > FREE ? `<div class="locked" style="min-height:200px"><div class="tablewrap blur" aria-hidden="true"><table class="data"><tbody>${list.slice(FREE, FREE + 4).map(row).join('')}</tbody></table></div>${lockVeil(`${num(list.length - FREE)} produk lainnya`, 'Lihat semua produk, status rugi atau tipis, dan harga yang disarankan.')}</div>` : ''}
      ${pro && list.length > 20 ? `<button class="btn quiet" type="button" id="show-all" style="margin-top:8px">${view.showAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${num(list.length)} produk`}</button>` : ''}
      <p class="tiny faint prod-foot">${num(list.length)} produk${list.length !== r.products.length ? ` dari ${num(r.products.length)}` : ''}. Harga impas: harga minimum agar tidak rugi. Tanda × berarti jumlah baris, karena jumlah barang tidak tercatat.${view.sort === 'pct-asc' ? ' Urutan margin terendah hanya memuat produk dengan minimal 3 baris pesanan.' : ''} Ketuk produk untuk melihat detail dan harga target.</p>`;
    const live = $('#prod-count'); if (live) live.textContent = `${num(list.length)} produk ditampilkan.`;
    if (animate) { box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap'); }
  }
  /** Laci detail produk: hanya angka engine untuk produk itu. */
  function productSheet(r) {
    const p = r && r.products.find((x) => x.key === view.prodKey);
    const head = (t) => `<div class="d-head"><h2 id="sheet-t">${t}</h2><button class="x" type="button" data-sheet-close aria-label="Tutup">×</button></div>`;
    if (!p) return `${head('Produk')}<div class="d-body"><p class="small muted">Produk tidak ditemukan pada filter saat ini.</p></div>`;
    const item = (k, v, sub = '') => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
    const ids = [p.sku && `SKU ${esc(p.sku)}`, p.code && p.code !== p.sku && `Kode ${esc(p.code)}`, p.variant && p.variant !== 'Default' && `Variasi ${esc(p.variant)}`].filter(Boolean);
    return `${head(esc(p.name))}<div class="d-body pd">
      <div class="pd-meta"><span class="pd-plat">${PLAT_DOT(p.platform)}${PNAME[p.platform]}</span>${ids.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="pd-status">${healthChip(p.health)}<p class="small muted">${healthWhy(p, r)}</p></div>
      <h3 class="pd-sec">Angka produk</h3>
      <dl class="pd-grid">
        ${item('Laba', money(p.margin), ok(p.margin) ? 'setelah potongan, modal, dan packing produk ini' : '')}
        ${item('Margin', ok(p.pct) ? pct(p.pct) : '<span class="unk">Belum diketahui</span>', ok(p.pct) ? 'laba ÷ penjualan produk' : '')}
        ${item('Terjual', p.qtyKnown ? `${num(p.qty)} barang` : `${num(p.rows)} baris pesanan`, p.qtyKnown ? `${num(p.rows)} baris pesanan` : 'jumlah barang tidak tercatat')}
        ${item('Penjualan', fmt(p.sales))}
        ${item('Potongan marketplace', money(p.fees))}
        ${item('Modal / HPP', p.modalKnown ? fmt(p.modal) : '<span class="unk">Belum diketahui</span>', ok(p.unitCost) ? `${fmt(p.unitCost)} per unit` : 'modal per unit belum diisi')}
        ${ok(p.packing) && p.packing ? item('Packing', fmt(p.packing)) : ''}
      </dl>
      <h3 class="pd-sec">Harga</h3>
      <div class="pd-prices">
        <div><span>Harga rata-rata</span><b>${ok(p.avgPrice) ? fmt(p.avgPrice) : '—'}</b></div>
        <div><span>Harga impas</span><b>${ok(p.breakEven) ? fmt(p.breakEven) : '—'}</b></div>
        <div class="tgt"><span>Harga target <small>margin ${pct(r.target, 0)}</small></span><b>${ok(p.targetPrice) ? fmt(p.targetPrice) : '—'}</b></div>
      </div>
      <div class="pd-cta">
        <button class="btn primary" type="button" data-sim-prod="${esc(p.key)}">Buka simulator harga</button>
        ${demo ? '' : `<button class="btn" type="button" data-fix-modal="${esc(p.key)}">${p.modalKnown ? 'Perbaiki modal' : 'Isi modal'}</button>`}
      </div>
      <p class="tiny faint">Angka dari perhitungan per produk di Cek Untung. Simulator diisi harga rata-rata${ok(p.unitCost) ? ' dan modal per unit' : ''} produk ini.</p>
    </div>`;
  }

  /* ---------- laba (UI-3): semua angka dari engine; UI hanya menyusun dan memberi label ---------- */
  const barRows = (rows, total) => {
    const max = Math.max(...rows.map((x) => Math.abs(x.v)), 1);
    return rows.map((x) => `<div class="barrow"><span>${esc(x.label)}${x.k ? qi(x.k, x.label) : ''}</span><div class="track"><i style="width:${(Math.abs(x.v) / max) * 100}%"></i></div><span class="num">${fmt(x.v)} <span class="faint">${pct(Math.abs(x.v) / total)}</span></span></div>`).join('');
  };
  const PLAT_DOT = (k) => `<i class="sw" style="background:var(--${k})" aria-hidden="true"></i>`;
  /** Status laba & modal: dipakai kartu angka utama halaman Laba (sama dengan Ringkasan). */
  function labaKpis(r) {
    const K = r.kepastian, c = K.cakupan, opex = r.fixedMonthly > 0;
    const finalBadge = K.laba.final ? '<span class="status verified">Final</span>'
      : '<button type="button" class="status pending final-badge" data-sheet="kepastian" aria-haspopup="dialog" aria-label="Status laba: belum final. Lihat alasannya">Belum final</button>';
    const hppMixed = r.ready && (c.penjualan.estimasi || c.penjualan.estimasiMinimum || c.penjualan.belum);
    const card = (label, value, note, cls = '', extra = '', kind = '') => `<div class="metric-card ${cls}" ${kind ? `data-kpi="${kind}"` : ''}><span class="m-label">${kpiIc(kind)}${label}</span><span class="m-value ${typeof value === 'number' && value < 0 ? 'neg' : ''}">${typeof value === 'number' ? fmt(value) : value}</span>${extra}<span class="m-note">${note}</span></div>`;
    return `<section class="dash-hero laba-kpis" aria-label="Angka utama">
      ${card(`Laba dari data tersedia${qi(opex ? 'laba_bersih' : 'margin_total', 'Laba dari data tersedia')}`, r.ready ? (opex ? r.netProfit : r.totalMargin) : '<span class="faint">Belum dihitung</span>',
        `${r.ready ? `${opex ? 'setelah biaya operasional yang tercatat' : 'biaya operasional belum dicatat'}. ${pct(r.coverage, 0)} penjualan masuk dalam perhitungan` : 'isi modal produk agar laba bisa dihitung'}${heldShort(r)}`, 'is-hero', `<div class="m-status">${finalBadge}</div>`)}
      ${card(`Penjualan${qi('penjualan', 'Penjualan')}`, r.totalSales, `${num(r.orders)} pesanan terjual${heldShort(r)}`, '', '', 'sales')}
      ${card(`Modal / HPP${qi('modal', 'Modal')}`, r.ready ? r.totalModal : '<span class="faint">Belum diketahui</span>', r.ready ? 'dari penjualan yang modalnya diketahui' : 'modal belum diisi', '',
        hppMixed ? '<div class="m-status"><span class="status estimate">Sebagian perkiraan</span></div>' : r.ready && c.penjualan.terverifikasi > 0 ? '<div class="m-status"><span class="status verified">Terverifikasi</span></div>' : !r.ready ? '<div class="m-status"><span class="status unknown">Belum diketahui</span></div>' : '', 'modal')}
      ${card(`Potongan marketplace${qi('potongan', 'Potongan marketplace')}`, -r.totalFees, 'dipotong dari penjualan oleh marketplace', '', '', 'fees')}
    </section>`;
  }
  /** Jejak uang (agregat): tahapan dari penjualan sampai laba. Bukan pencocokan pencairan dana. */
  /* ---------- Jejak uang (Money Trace A1) ----------
   * Angka langkah 1–3 dan penyesuaian = angka engine yang sama (r.totalSales, r.totalFees, r.totalReceived,
   * r.adjustments). Yang baru hanya rincian refund dan status rekonsiliasi dari r.jejakUang; UI tidak menghitung apa pun. */
  const TR_ST = { terekonsiliasi: ['verified', 'Sesuai laporan dan terekonsiliasi'], berdasarkan_laporan: ['estimate', 'Berdasarkan laporan, belum sepenuhnya terekonsiliasi'],
    belum_tersedia: ['unknown', 'Belum tersedia'], perlu_dicek: ['pending', 'Perlu dicek'], perlu_rekonsiliasi: ['pending', 'Perlu rekonsiliasi'] };
  const trStatus = (s) => { const [c, l] = TR_ST[s] || TR_ST.belum_tersedia; return `<span class="status ${c} tr-st">${l}</span>`; };
  const TR_WHY = {
    tidak_cocok_ringkasan: 'jumlah baris tidak cocok dengan ringkasan resmi di file',
    gabungan_tidak_cocok: 'jumlah gabungan file tidak cocok dengan angka yang ditampilkan',
    tanda_refund_tidak_wajar: 'ada refund bernilai positif, tidak sesuai pola laporan',
    identitas_refund_tidak_cocok: 'di sebagian baris, subtotal setelah diskon + refund tidak sama dengan Total Pendapatan',
    kolom_tidak_ada: 'kolom yang dibutuhkan tidak ada di laporan yang diunggah',
    ringkasan_resmi_tidak_ada: 'ringkasan resmi untuk angka ini tidak ada di file',
    sheet_penyesuaian_tidak_ada: 'sheet Adjustment tidak ada di file',
    filter_tanggal: 'filter bulan sedang aktif, sedangkan ringkasan resmi mencakup seluruh periode file',
    konflik_antar_laporan: 'ada transaksi dengan isi berbeda di beberapa laporan; transaksi itu ditahan dan tidak dihitung',
    identitas_transaksi_belum_pasti: 'ada nomor transaksi yang sama dengan isi berbeda pada periode resmi yang tumpang tindih; belum pasti versi lain atau transaksi lain, jadi tetap dihitung',
    periode_resmi_rusak: 'periode resmi di sheet Laporan tidak terbaca',
    baris_di_luar_periode_resmi: 'ada transaksi dengan tanggal pembayaran di luar periode resmi file',
    zona_waktu_berbeda: 'zona waktu antarlaporan berbeda',
    cakupan_teramati: 'sebagian laporan tidak mencantumkan periode resmi; cakupannya hanya dari tanggal transaksi yang terlihat',
    laporan_tidak_saling_lengkap: 'ada transaksi yang tidak muncul di laporan lain yang mencakup tanggal yang sama',
    baris_non_pesanan: 'ringkasan file ikut memuat baris non-pesanan',
    hubungan_refund_belum_terbukti: 'kolom subtotal setelah diskon tidak ada, jadi hubungan refund dengan penjualan belum bisa dibuktikan',
  };
  // Sumber dan basis tanggal per komponen (teks tetap; angka tetap dari engine).
  const TR_SRC = {
    shopee: {
      penjualan: ['Penjualan', 'Sheet Penghasilan: Harga Produk + Jumlah Pengembalian Dana ke Pembeli + voucher penjual. Dicocokkan dengan "1. Total Pendapatan" di sheet Summary.', 'tanggal pesanan dibuat'],
      refund: ['Refund (sudah termasuk penjualan)', 'Kolom "Jumlah Pengembalian Dana ke Pembeli". Dicocokkan dengan baris yang sama di sheet Summary.', 'tanggal pesanan dibuat'],
      potongan: ['Potongan marketplace', 'Kolom biaya di sheet Penghasilan. Dicocokkan dengan "2. Total Pengeluaran".', 'tanggal pesanan dibuat'],
      dana: ['Dana pesanan dilepas', 'Kolom "Total Penghasilan". Dicocokkan dengan "3. Total yang Dilepas".', 'tanggal pesanan dibuat'],
      penyesuaian: ['Penyesuaian', 'Sheet Adjustment, kolom "Biaya Penyesuaian". Dicocokkan dengan "Total Penyesuaian".', 'tanggal penyesuaian dibuat'],
    },
    tiktok: {
      penjualan: ['Penjualan', 'Sheet Detail pesanan, kolom "Total Pendapatan" baris pesanan. Dicocokkan dengan sheet Laporan.', 'waktu pemesanan'],
      refund: ['Refund (sudah termasuk penjualan)', 'Kolom "Total pengembalian dana setelah diskon". Subtotal setelah diskon + refund = Total Pendapatan.', 'waktu pemesanan'],
      potongan: ['Potongan marketplace', 'Kolom "Total Biaya". Dicocokkan dengan sheet Laporan.', 'waktu pemesanan'],
      dana: ['Dana pesanan dilepas', 'Kolom "Jumlah penyelesaian pembayaran" baris pesanan. Dana pesanan + penyesuaian dicocokkan dengan sheet Laporan.', 'waktu pemesanan'],
      penyesuaian: ['Penyesuaian', 'Baris selain "Pesanan" di sheet Detail pesanan.', 'waktu pembayaran'],
    },
  };
  function traceSources(J) {
    const rows = (pf, x) => Object.entries(TR_SRC[pf]).map(([k, [label, src, basis]]) => {
      const c = x[k], why = (c.alasan || []).map((w) => TR_WHY[w]).filter(Boolean);
      const extra = k === 'refund' && ok(c.nilai) && c.jumlahPesanan ? ` ${num(c.jumlahPesanan)} pesanan (${num(c.penuh)} penuh, ${num(c.parsial)} sebagian).` : k === 'penyesuaian' ? ` ${num(c.jumlah)} transaksi; belum masuk laba.` : '';
      // Sheet Adjustment tidak ada → bukan "Rp0", melainkan tidak tercatat di file.
      const noSheet = k === 'penyesuaian' && !c.jumlah && (c.alasan || []).includes('sheet_penyesuaian_tidak_ada');
      return `<li><div class="ts-h"><b>${label}</b><span class="tr-v ${ok(c.nilai) && c.nilai < 0 ? 'neg' : ''}">${noSheet ? 'Tidak tercatat' : ok(c.nilai) ? fmt(c.nilai) : 'Belum tersedia'}</span></div>
        <p>${esc(src)}${extra} Basis tanggal: ${basis}.</p><div class="ts-st">${trStatus(c.status)}${why.length ? `<span>Alasan: ${esc(why.join('; '))}.</span>` : ''}</div></li>`;
    }).join('');
    const mp = Object.entries(J.marketplace).filter(([, x]) => x);
    return `<details class="tr-src"><summary>Sumber, tanggal, dan status per marketplace</summary>
      ${mp.map(([pf, x]) => `<p class="ts-pf">${PLAT_DOT(pf)}${PNAME[pf]} · ${num(x.file.jumlah)} Laporan Penghasilan${x.file.identik ? ` (+${num(x.file.identik)} file sama diabaikan)` : ''}</p>${x.gabungan.ditahan ? `<p class="ts-gab">${trStatus('perlu_rekonsiliasi')} ${num(x.gabungan.ditahan)} transaksi berbeda antarlaporan ditahan, tidak masuk angka di bawah.</p>` : x.gabungan.identitasBelumPasti ? `<p class="ts-gab">${trStatus('perlu_dicek')} ${num(x.gabungan.identitasBelumPasti)} transaksi dengan identitas belum pasti tetap dihitung; total perlu diverifikasi.</p>` : x.gabungan.duplikatDiabaikan ? `<p class="ts-gab">${num(x.gabungan.duplikatDiabaikan)} baris yang sama di beberapa laporan dihitung sekali.</p>` : ''}<ul class="ts-list">${rows(pf, x)}</ul>`).join('')}
      <p class="tiny faint">Angka pesanan dikelompokkan menurut tanggal pesanan, sedangkan periode Laporan Penghasilan mengikuti tanggal dana dilepas atau dibayar. Penyesuaian memakai tanggalnya sendiri. Jadi tidak semua angka di atas memakai basis tanggal yang sama.</p></details>`;
  }
  function moneyTrace(r) {
    const opex = r.fixedMonthly > 0, rb = r.kepastian.risikoBarang, isDrop = typeOf(st()) === 'dropship';
    const out = r.kepastian.cakupan.dikeluarkan;
    const J = r.jejakUang, JT = J.total;
    const others = [
      ...(r.ready && r.knownPacking ? [[isDrop ? 'Biaya dropship' : 'Packing', -r.knownPacking]] : []),
      ...(r.ready && (r.lostCertain || rb.kerugianTanpaNilai) ? [['Kerugian retur', r.lostCertain ? -r.lostCertain : NaN, rb.kerugianTanpaNilai ? `+ ${num(rb.kerugianTanpaNilai)} kasus nilainya belum diketahui.` : '']] : []),
      ...(r.ready && opex ? [['Biaya operasional', -r.opex]] : []),
    ];
    const val = (v, cls = '') => `<b class="tr-v ${cls} ${ok(v) && v < 0 ? 'neg' : ''}">${ok(v) ? fmt(v) : 'Belum diketahui'}</b>`;
    const step = (n, title, body, cls = '') => `<li class="tr-step ${cls}"><span class="tr-n" aria-hidden="true">${n}</span><div class="tr-body"><span class="tr-k">${title}</span>${body}</div></li>`;
    const rf = JT.refund;
    // Refund hanya rincian: sudah termasuk di penjualan, tidak pernah dikurangkan lagi.
    const rfSome = Object.values(J.marketplace).some((x) => x && ok(x.refund.nilai));
    const refundLine = !ok(rf.nilai) ? `<span class="tr-sub">Rincian refund belum tersedia${rfSome ? ' untuk sebagian marketplace' : ''}; penjualan tetap sesuai laporan. ${trStatus(rf.status)}</span>`
      : `<span class="tr-sub">${rf.nilai ? `Sudah termasuk refund <b class="neg">${fmt(rf.nilai)}</b> dari ${num(rf.jumlahPesanan)} pesanan. Refund tidak dikurangkan lagi.` : 'Refund menurut laporan: Rp0.'} ${trStatus(rf.status)}${rf.susulanTidakCocok ? ` Total cocok dengan laporan, tetapi ${num(rf.susulanTidakCocok)} refund susulan TikTok belum dapat dicocokkan ke pesanan asalnya.` : ''}</span>`;
    const adj = JT.penyesuaian;
    return `<div class="card-header"><h3 id="trace-t">Jejak uang ${qi('jejak_uang', 'jejak uang')}</h3><p>Agregat dari laporan dan isian Anda</p></div>
      <ol class="trace">
        ${step(1, 'Penjualan sesuai laporan', `${val(r.totalSales)}<span class="tr-note">${num(r.orders)} pesanan ${trStatus(JT.penjualan.status)}</span>${refundLine}`)}
        ${step(2, 'Potongan marketplace', `${val(r.totalFees)}<span class="tr-note">admin, komisi, ongkir, dan program ${trStatus(JT.potongan.status)}</span>`)}
        ${step(3, 'Dana pesanan dilepas', `${val(r.totalReceived)}<span class="tr-note">${r.ready && Math.abs(out.danaDiterima) >= 1 ? `${fmt(out.danaDiterima)} dari ${num(out.jumlahPesanan)} pesanan yang HPP-nya belum diketahui tidak dihitung dalam laba` : 'menurut Laporan Penghasilan'} ${trStatus(JT.dana.status)}</span>`)}
        ${step(4, 'Modal / HPP', `${val(r.ready ? -r.totalModal : NaN)}<span class="tr-note">${r.ready ? 'dari modal yang Anda isi' : 'modal belum diisi'}</span>`, r.ready ? '' : 'is-unknown')}
        ${step(5, 'Biaya lain', others.length ? `<ul class="tr-list">${others.map(([l, v, n]) => `<li><span>${l}${n ? `<small>${n}</small>` : ''}</span>${val(v)}</li>`).join('')}</ul>` : '<span class="tr-note">Tidak ada biaya lain yang tercatat</span>')}
        ${step(6, 'Laba dari data tersedia', `${val(r.ready ? (opex ? r.netProfit : r.totalMargin) : NaN)}<span class="tr-note">${r.ready ? `${pct(r.coverage, 0)} penjualan masuk dalam perhitungan` : 'belum bisa dihitung'}</span>`, 'is-result')}
      </ol>
      <div class="tr-after">
        <p class="tr-after-k">Di luar perhitungan laba</p>
        <ul class="tr-list">
          <li><span>Penyesuaian dari marketplace${adj.jumlah ? `<small>${num(adj.jumlah)} transaksi, dicatat terpisah</small>` : '<small>Tidak ada penyesuaian tercatat di laporan</small>'}${trStatus(adj.status)}</span>${adj.jumlah ? val(adj.nilai) : ''}</li>
          <li><span>Pencairan dana ke rekening<small>Data pencairan belum tersedia dalam analisis ini.</small>${trStatus(J.pencairan.status)}</span></li>
        </ul>
      </div>
      ${traceSources(J)}
      ${warnTotal(r)}<p class="tiny faint">Berdasarkan laporan yang diunggah. Dana dilepas belum tentu sama dengan dana yang sudah masuk rekening.</p>`;
  }
  /** Satu baris rincian biaya: label, nilai, arti singkat, dan sumbernya (teks dari penjelasan.js). */
  function costRow(label, v, key, src, share) {
    const info = key && CekInfo.get(key, null);
    return `<li class="cb-row"><div class="cb-l"><b>${esc(label)}</b>${info ? `<span>${esc(info.a)}</span>` : ''}${src ? `<span class="cb-src">Sumber: ${esc(src)}</span>` : ''}</div>
      <div class="cb-v"><b class="${ok(v) && v < 0 ? 'neg' : ''}">${ok(v) ? fmt(v) : 'Belum diketahui'}</b>${ok(share) ? `<span class="faint">${pct(share)} dari penjualan</span>` : ''}</div></li>`;
  }
  function costGroup(title, total, rows, open = false, note = '') {
    return `<details class="cost-group" ${open ? 'open' : ''}><summary><span class="cg-t">${title}</span><span class="cg-v ${ok(total) && total < 0 ? 'neg' : ''}">${ok(total) ? fmt(total) : 'Belum diketahui'}</span><span class="cg-chev" aria-hidden="true"></span></summary>
      <div class="cg-body">${rows.length ? `<ul class="cb-list">${rows.join('')}</ul>` : ''}${note ? `<p class="tiny faint">${note}</p>` : ''}</div></details>`;
  }
  function costBreakdown(r) {
    const S = r.shopee, T = r.tiktok, rb = r.kepastian.risikoBarang, isDrop = typeOf(st()) === 'dropship';
    const fee = (P, list, src) => list.filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => a[1] - b[1]).map(([l, v, k]) => costRow(l, v, k, src, Math.abs(v) / P.sales));
    const groups = [];
    if (r.has.shopee) groups.push(costGroup(`${PLAT_DOT('shopee')}Potongan Shopee`, S.feeTotal, fee(S, [['Biaya administrasi', S.fees.admin, 'fee_admin'], ['Gratis Ongkir XTRA dan program', S.fees.xtra, 'fee_xtra'], ['Biaya proses pesanan', S.fees.proses, 'fee_proses'],
      ['Komisi AMS (afiliasi)', S.fees.ams, 'fee_ams'], ['Ongkir ditanggung penjual', S.fees.ship, 'fee_ship'], ['Biaya lain', S.fees.lain, 'fee_lain']], 'Laporan Penghasilan Shopee'), true));
    if (r.has.tiktok) groups.push(costGroup(`${PLAT_DOT('tiktok')}Potongan TikTok Shop`, T.feeTotal, fee(T, [['Komisi platform', T.fees.platform, 'fee_platform'], ['Komisi dinamis', T.fees.dinamis, 'fee_dinamis'], ['Biaya pemrosesan', T.fees.proses, 'fee_tt_proses'],
      ['Ongkir', T.fees.ongkir, 'fee_ongkir'], ['Komisi afiliasi', T.fees.afiliasi, 'fee_afiliasi'], ['Biaya lain', T.fees.lain, 'fee_lain']], 'Laporan Penghasilan TikTok Shop'), !r.has.shopee));
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    if (r.totalPacking) groups.push(costGroup(isDrop ? 'Biaya dropship' : 'Packing', r.ready ? -r.knownPacking : NaN,
      plats.map((k) => costRow(PNAME[k], r.ready ? -r[k].knownPacking : NaN, isDrop ? 'dropship_fee' : 'packing', 'isian Anda di Pengaturan')), false, r.ready ? 'Hanya pesanan yang modalnya diketahui.' : 'Packing dihitung setelah modal produk diisi.'));
    const retur = [];
    if (r.lostCertain || rb.kerugianTanpaNilai) retur.push(costRow('Kerugian retur (tidak kembali)', r.lostCertain ? -r.lostCertain : NaN, 'retur_hilang', 'file retur dan tanda dari Anda'));
    if (r.unknownRisk > 0) retur.push(costRow('Risiko retur yang belum dicek', -r.unknownRisk, '', 'file retur; belum dikurangkan dari laba'));
    if (r.cases.length || r.lostCertain) groups.push(costGroup('Refund & retur', r.lostCertain || rb.kerugianTanpaNilai ? (r.lostCertain ? -r.lostCertain : NaN) : 0, retur, false,
      [rb.kerugianTanpaNilai ? `+ ${num(rb.kerugianTanpaNilai)} kasus nilainya belum diketahui.` : '', rb.risikoTanpaNilai ? `${num(rb.risikoTanpaNilai)} kasus yang belum dicek belum punya nilai.` : '',
        'Refund ke pembeli sudah termasuk dalam penjualan, jadi tidak dikurangkan lagi di sini. Rinciannya ada di Jejak uang.'].filter(Boolean).join(' ')));
    if (r.fixedMonthly > 0) {
      const fc = (st().fixedCosts || []).filter((x) => ok(x.amount) && x.amount > 0);
      groups.push(costGroup('Biaya operasional', r.ready ? -r.opex : NaN, fc.map((x) => `<li class="cb-row"><div class="cb-l"><b>${esc(x.label || 'Tanpa nama')}</b><span class="cb-src">Sumber: isian Anda</span></div><div class="cb-v"><b>${fmt(x.amount)}</b><span class="faint">per bulan</span></div></li>`), false,
        `${fmt(r.fixedMonthly)} per bulan × ${(Math.round(r.monthsSpan * 10) / 10).toLocaleString('id-ID')} bulan data, dihitung mesin hitung.`));
    }
    // Komposisi biaya: lebar batang = besar tiap kelompok dari engine (gambar saja, tanpa persen buatan UI).
    const comp = [['Potongan Shopee', r.has.shopee ? S.feeTotal : 0, 'c-sh'], ['Potongan TikTok Shop', r.has.tiktok ? T.feeTotal : 0, 'c-tt'],
      [isDrop ? 'Biaya dropship' : 'Packing', r.ready ? -r.knownPacking : 0, 'c-pk'], ['Kerugian retur', r.ready ? -r.lostCertain : 0, 'c-rt'], ['Biaya operasional', r.ready && r.fixedMonthly > 0 ? -r.opex : 0, 'c-op']]
      .filter(([, v]) => ok(v) && Math.abs(v) >= 1);
    const compBar = comp.length > 1 ? `<div class="cost-comp" role="img" aria-label="Komposisi biaya: ${comp.map(([l, v]) => `${l} ${fmt(v)}`).join(', ')}">
        <div class="cc-bar">${comp.map(([, v, c]) => `<i class="${c}" style="flex:${Math.abs(v).toFixed(0)}"></i>`).join('')}</div>
        <ul class="cc-leg">${comp.map(([l, v, c]) => `<li><i class="${c}" aria-hidden="true"></i>${l}<b>${fmt(v)}</b></li>`).join('')}</ul></div>` : '';
    return `<div class="card-header"><h3 id="cost-t">Rincian biaya</h3><p>Ketuk untuk membuka rincian</p></div>${compBar}<div class="cost-groups">${groups.join('')}</div>
      ${r.adjustments ? `<p class="small muted">Kompensasi atau penyesuaian dari platform ${fmt(r.adjustments)} ditampilkan terpisah dan belum dihitung dalam laba.</p>` : ''}`;
  }
  /** Perbandingan per platform: nilai engine per platform berdampingan. Tidak ada peringkat "platform terbaik". */
  function platformCompare(r) {
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const cols = plats.length > 1 ? [['total', 'Total'], ...plats.map((k) => [k, PNAME[k]])] : plats.map((k) => [k, PNAME[k]]);
    const sel = cols.some(([k]) => k === view.platCol) ? view.platCol : cols[0][0];
    const cell = (k, f) => f(k === 'total' ? null : r[k], k);
    const unk = '<span class="unk">Belum diketahui</span>';
    // HPP per kolom: modal 0 pada platform yang belum punya penjualan bermodal BUKAN HPP Rp0 (status dari engine).
    const hppOk = (k) => (r.statusHpp ? r.statusHpp[k === 'total' || !k ? 'total' : k] !== 'tidak_diketahui' : r.ready);
    const rows = [
      ['Pesanan terjual', (P) => num(P ? P.orders : r.orders)],
      ['Penjualan', (P) => fmt(P ? P.sales : r.totalSales)],
      [`Potongan marketplace${qi('potongan')}`, (P) => `<span class="neg">${fmt(P ? P.feeTotal : r.totalFees)}</span>`],
      [`Dana diterima${qi('dana_diterima')}`, (P) => fmt(P ? P.received : r.totalReceived)],
      ['Modal / HPP', (P, k) => (hppOk(k) ? `<span class="neg">${fmt(-(P ? P.modal : r.totalModal))}</span>` : unk)],
      ...(r.totalPacking ? [['Packing', (P, k) => (hppOk(k) ? `<span class="neg">${fmt(-(P ? P.knownPacking : r.knownPacking))}</span>` : unk)]] : []),
      ['Laba setelah modal', (P, k) => { const v = P ? P.margin : r.totalMargin; return hppOk(k) && ok(v) ? `<b class="${v < 0 ? 'neg' : ''}">${fmt(v)}</b>` : unk; }, 'total'],
      [`Tarif efektif${qi('tarif_efektif')}`, (P, k) => { const f = P && r.feeModel[k]; return f ? `${pct(f.pct)} + ${fmt(f.fixed)}<span class="faint tiny"> /pesanan</span>` : '<span class="faint">—</span>'; }],
      ['Modal diketahui', (P) => `<span class="faint">${pct(P ? P.coverage : r.coverage, 0)}</span>`],
    ];
    return `<div class="card-header"><h3 id="plat-t">Per platform</h3>
        ${cols.length > 1 ? `<div class="seg plat-seg" role="group" aria-label="Kolom yang ditampilkan di layar kecil">${cols.map(([k, l]) => `<button type="button" data-plat-col="${k}" aria-pressed="${k === sel}">${l}</button>`).join('')}</div>` : ''}</div>
      <div class="tablewrap"><table class="data plat-table show-${sel}"><thead><tr><th scope="col"><span class="sr-only">Komponen</span></th>${cols.map(([k, l]) => `<th scope="col" class="c-${k}">${k === 'total' ? l : `${PLAT_DOT(k)} ${l}`}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, f, cls]) => `<tr class="${cls || ''}"><th scope="row">${label}</th>${cols.map(([k]) => `<td class="c-${k}">${cell(k, f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="row-actions">${plats.filter((k) => r.feeModel[k]).map((k) => `<button class="btn sm" type="button" data-sim-use="${k}">Simulasikan harga dengan tarif ${PNAME[k]}</button>`).join('')}</div>
      ${r.has.tiktok ? `<p class="small muted">TikTok: diskon toko rata-rata ${pct(r.tiktok.discount)}.</p>${sourceBlock(r)}` : ''}`;
  }
  // Label sumber pesanan TikTok. Engine memakai "Lainnya" bila kolom "Sumber pesanan" kosong: tidak ditebak.
  const srcLabel = (k) => (k === 'Lainnya' ? 'Tanpa keterangan sumber' : k);
  /**
   * V1A: penjualan TikTok Shop menurut "Sumber pesanan" (data engine r.tiktok.bySource, sudah mengikuti filter).
   * Hanya penjualan dan jumlah baris pesanan; laba, modal, potongan, dan dana per sumber TIDAK ditampilkan karena
   * engine tidak mencatat kelengkapannya per sumber. Rincian disembunyikan bila jumlahnya tidak cocok dengan total.
   */
  function sourceBlock(r) {
    const all = Object.entries(r.tiktok.bySource || {});
    if (!all.length) return '';
    const known = all.filter(([k]) => k !== 'Lainnya');
    const sum = all.reduce((a, [, v]) => a + v.sales, 0);
    if (Math.abs(sum - r.tiktok.sales) > 1) return '<p class="small muted">Rincian penjualan per sumber pesanan tidak ditampilkan karena jumlahnya tidak cocok dengan total TikTok Shop.</p>';
    const noDetail = ((r.kepastian.cakupan.perMarketplace.tiktok || {}).dikeluarkan || { alasan: {} }).alasan.tanpa_rincian_produk || 0;
    const NOTE_INC = 'Pesanan Tokopedia dalam bagian ini sudah termasuk total Laporan Penghasilan TikTok Shop, bukan penjualan tambahan.';
    if (all.length === 1) {
      // Satu sumber: tidak perlu tabel. Bila sumbernya Tokopedia, tetap dijelaskan agar tidak diunggah ulang.
      return known.length && known[0][0] === 'Tokopedia' ? `<p class="small muted">Semua pesanan TikTok Shop pada periode ini bersumber Tokopedia. ${NOTE_INC}</p>` : '';
    }
    const tot = r.tiktok.sales;
    return `<section class="src-block" aria-labelledby="src-t"><h4 id="src-t">Penjualan TikTok Shop menurut sumber pesanan${qi('sumber_pesanan', 'Sumber pesanan')}</h4>
      <div class="tablewrap"><table class="data src-table"><thead><tr><th scope="col">Sumber</th><th scope="col">Baris pesanan</th><th scope="col">Penjualan</th><th scope="col"><span title="Porsi terhadap penjualan TikTok Shop">Porsi</span></th></tr></thead>
      <tbody>${all.sort((a, b) => b[1].sales - a[1].sales).map(([k, v]) => `<tr><th scope="row">${esc(srcLabel(k))}</th><td>${num(v.orders)}</td><td>${fmt(v.sales)}</td><td>${tot > 0 ? pct(v.sales / tot) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="tiny faint">${NOTE_INC} Laba dan modal per sumber belum ditampilkan karena data belum cukup untuk memastikan kelengkapannya.${all.some(([k]) => k === 'Lainnya') ? ' Sebagian baris tidak punya keterangan sumber di laporan dan tidak dimasukkan ke sumber mana pun.' : ''}${noDetail ? ` ${num(noDetail)} pesanan TikTok Shop tidak mencantumkan produk, jadi modalnya belum lengkap.` : ''} Baris pesanan dihitung per baris laporan (tanpa pesanan batal atau direfund penuh); satu nomor pesanan bisa muncul di lebih dari satu baris.</p></section>`;
  }
  /** Tabel bulanan: nilai per bulan dari engine (r.months). Tanpa margin bulanan buatan UI. */
  function monthTable(r) {
    if (!r.months.length) return '';
    const opex = r.fixedMonthly > 0;
    const lastM = r.months[r.months.length - 1];
    const running = r.last && r.last < new Date(+lastM.month.slice(0, 4), +lastM.month.slice(5), 0).toLocaleDateString('sv-SE');
    const lab = (m, v) => mLaba(r.ready, m.total, v);
    return `<details class="disclose month-table" ${view.monthOpen ? 'open' : ''} id="month-table"><summary>Tabel per bulan (${num(r.months.length)} bulan)</summary>
      <div class="tablewrap"><table class="data"><thead><tr><th scope="col">Bulan</th><th scope="col">Pesanan</th><th scope="col">Penjualan</th><th scope="col">Potongan</th><th scope="col">Dana diterima</th><th scope="col">Laba setelah modal</th>${opex ? '<th scope="col">Laba dari data tersedia</th>' : ''}</tr></thead>
      <tbody>${r.months.map((m, i) => `<tr><th scope="row">${monthLong(m.month)}${running && i === r.months.length - 1 ? ' <span class="faint tiny">(berjalan)</span>' : ''}</th><td>${num(m.total.orders)}</td><td>${fmt(m.total.sales)}</td><td class="neg">${fmt(m.total.fees)}</td><td>${fmt(m.total.received)}</td><td>${lab(m, m.total.margin)}</td>${opex ? `<td>${lab(m, m.total.net)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      ${r.ready ? '' : '<p class="tiny faint">Laba per bulan muncul setelah modal produk diisi.</p>'}</details>`;
  }
  function viewBiaya() {
    const { r } = last;
    return `<div class="laba-page">
      ${labaKpis(r)}
      <div class="laba-main">
        <div class="laba-nota">${nota(r)}</div>
        <section class="section-card trace-card" aria-labelledby="trace-t" data-reveal="fade">${moneyTrace(r)}</section>
      </div>
      <section class="section-card cost-card" aria-labelledby="cost-t">${costBreakdown(r)}</section>
      <section class="section-card plat-card" aria-labelledby="plat-t">${platformCompare(r)}</section>
      <section class="section-card trend" id="monthly" aria-labelledby="trend-t">${trendCard(r, { title: 'Tren laba', table: false })}${monthTable(r)}</section>
      ${r.buckets.length > 1 ? `<section class="section-card"><div class="card-header"><h3>Potongan menurut nilai pesanan${qi('potongan_nilai')}</h3><p>Biaya tetap per pesanan membuat pesanan kecil terpotong lebih besar</p></div>
        <div>${r.buckets.map((b) => { const p = -b.fees / b.value; const maxp = Math.max(...r.buckets.map((x) => -x.fees / x.value));
          return `<div class="barrow"><span>${esc(b.label)} <span class="faint tiny">${num(b.orders)} pesanan${r.ready && b.known ? `, laba ${fmt(b.margin / b.known)} per pesanan` : ''}</span></span><div class="track"><i style="width:${(p / maxp) * 100}%"></i></div><span class="num">${pct(p)}</span></div>`; }).join('')}</div>
      </section>` : ''}
    </div>`;
  }

  /* ---------- retur ---------- */
  /* Status barang retur: kunci engine (c.state) → kelas, label. */
  const CASE_ST = { belum: ['pending', 'Belum dicek'], kembali: ['verified', 'Sudah kembali'], hilang: ['danger', 'Tidak kembali'] };
  function viewRetur() {
    const { r } = last;
    if (!r.cases.length) return `<div class="panel empty"><span class="ic">${svg('retur', 24)}</span><h2>Belum ada file retur</h2><p>Unggah file pengembalian Shopee atau retur TikTok untuk menandai barang yang tidak kembali. Tanpa data retur, kondisi barang setelah refund mungkin belum dapat dipastikan.</p><button class="btn primary" type="button" data-go="data">Unggah file retur</button></div>`;
    const rb = r.kepastian.risikoBarang;
    // Hanya menghitung jumlah kasus per status untuk tampilan; nilai rupiah diambil apa adanya dari engine.
    const chk = r.cases.filter((c) => c.needsCheck);
    const by = (st) => chk.filter((c) => c.state === st).length;
    const noVal = chk.filter((c) => !ok(c.estModal)).length;
    const tile = (cls, k, v, note) => `<div class="rt-tile ${cls}"><span class="rt-k">${k}</span><b>${v}</b>${note ? `<small>${note}</small>` : ''}</div>`;
    const lossV = r.lostCertain ? fmt(-r.lostCertain) : rb.kerugianTanpaNilai ? 'Belum diketahui' : fmt(0);
    const riskV = r.unknownRisk > 0 ? fmt(r.unknownRisk) : rb.risikoTanpaNilai ? 'Belum diketahui' : fmt(0);
    const list = r.cases.filter((c) => !view.onlyCheck || c.needsCheck).sort((a, b) => (b.needsCheck - a.needsCheck) || ((b.estModal || 0) - (a.estModal || 0))).slice(0, 300);
    const row = (c) => {
      const [cls, lbl] = c.needsCheck ? CASE_ST[c.state] || CASE_ST.belum : ['none', c.cat === 'tidak_dikirim' ? 'Belum bisa ditandai' : 'Pengajuan batal'];
      return `<li class="rt-case st-${cls}">
        <div class="rt-main"><span class="rt-plat"><i class="sw" style="background:var(--${c.platform})"></i>${PNAME[c.platform]}</span>
          <b>${esc(c.product || '-')}${c.variant && !/^(Default|Not Specified)$/.test(c.variant) ? ` <span class="faint">${esc(c.variant)}</span>` : ''}</b>
          <span class="rt-why">${esc(catLabel(c.cat))}${c.note ? `: “${esc(c.note.slice(0, 70))}”` : ''}</span></div>
        <div class="rt-meta"><span class="rt-k">Resi retur</span><span>${esc(c.resi || '–')}</span></div>
        <div class="rt-meta"><span class="rt-k">Perkiraan modal${qi('perkiraan_modal')}</span>${ok(c.estModal) ? `<b class="num">${fmt(c.estModal)}</b>` : '<span class="unk-v">Nilai belum diketahui</span>'}</div>
        <div class="rt-state"><span class="status ${cls}" aria-hidden="true"></span>${c.needsCheck ? `<select class="compact" data-case="${esc(c.key)}" aria-label="Status barang ${esc(c.product || '')}" ${demo ? 'disabled' : ''}>${[['belum', 'Belum dicek'], ['kembali', 'Sudah kembali'], ['hilang', 'Tidak kembali']].map(([v, l]) => `<option value="${v}" ${c.state === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<span class="faint small">${lbl}</span>`}</div></li>`;
    };
    return `<section class="rt-sum" aria-label="Ringkasan retur dan refund">
        ${tile('rt-all', 'Kasus retur & refund', num(r.cases.length), `${num(chk.length)} perlu ditandai`)}
        ${tile(by('belum') ? 'rt-warn' : 'rt-ok', 'Belum dicek', num(by('belum')), by('belum') ? 'tandai kembali atau tidak' : 'semua sudah ditandai')}
        ${tile('rt-risk', `Risiko, belum kerugian${qi('perkiraan_modal')}`, riskV, `Perkiraan modal kasus yang belum dicek. Baru menjadi kerugian bila barangnya Anda tandai Tidak kembali.${rb.risikoTanpaNilai ? ` + ${num(rb.risikoTanpaNilai)} kasus nilainya belum diketahui.` : ''}`)}
        ${tile('rt-loss', 'Kerugian retur (tidak kembali)', lossV, `Hanya barang yang Anda tandai Tidak kembali; sudah dikurangkan dari laba.${rb.kerugianTanpaNilai ? ` + ${num(rb.kerugianTanpaNilai)} kasus nilainya belum diketahui.` : ''}`)}
      </section>
      <section class="panel rt-panel">
        <div class="rt-head"><div class="rt-dist" aria-label="Status kasus">${['belum', 'kembali', 'hilang'].map((k) => `<span class="rt-pill st-${CASE_ST[k][0]}"><span class="status ${CASE_ST[k][0]}" aria-hidden="true"></span>${CASE_ST[k][1]} <b>${num(by(k))}</b></span>`).join('')}${noVal ? `<span class="rt-pill st-unknown"><span class="status unknown" aria-hidden="true"></span>Nilai belum diketahui <b>${num(noVal)}</b></span>` : ''}</div>
          ${r.cases.some((c) => !c.needsCheck) ? `<button class="btn sm quiet" type="button" id="only-check">${view.onlyCheck ? 'Tampilkan semua kasus' : 'Hanya yang perlu dicek'}</button>` : ''}</div>
        <div class="chips rt-cats">${r.catSummary.sort((a, b) => b.count - a.count).map((c) => `<span class="chip"><i class="sw" style="background:var(--${c.platform})"></i>${esc(catLabel(c.cat))}: ${c.count}</span>`).join('')}</div>
        <p class="note-box rt-note">Pilih <b>Tidak kembali</b> bila barangnya tidak Anda terima lagi; modalnya akan dikurangkan dari laba. Beberapa refund terindikasi tidak dikirim menurut alasan di marketplace. Kondisi barangnya tetap perlu dipastikan.${r.unknownRisk > 0 ? ` Kasus yang belum dicek berisiko ${fmt(r.unknownRisk)} (belum dihitung sebagai kerugian)${rb.risikoTanpaNilai ? `, ditambah ${num(rb.risikoTanpaNilai)} kasus yang nilainya belum diketahui` : ''}.` : rb.risikoTanpaNilai ? ` ${num(rb.risikoTanpaNilai)} kasus yang belum dicek nilainya belum diketahui.` : ''}</p>
        <ul class="rt-list">${list.map(row).join('') || '<li class="muted small">Tidak ada kasus yang perlu dicek.</li>'}</ul>
      </section>`;
  }

  /* ---------- simulator ---------- */
  const resetSimFee = () => { sim.feePct = null; sim.feeFixed = null; };
  /** Sumber potongan untuk simulator: tarif efektif dari laporan (paling akurat) atau tabel tarif umum. */
  function simFee() {
    const r = last && last.r;
    const fm = (r && r.feeModel) || {};
    const avail = ['shopee', 'tiktok'].filter((k) => fm[k]);
    const src = sim.src === 'umum' || !avail.length ? 'umum' : 'laporan';
    const plat = src === 'laporan' ? (avail.includes(sim.plat) ? sim.plat : avail[0]) : (sim.plat === 'tiktok' ? 'tiktok' : 'shopee');
    if (src === 'laporan') {
      const f = fm[plat];
      return { src, plat, avail, pct: +(f.pct * 100).toFixed(2), fixed: Math.round(f.fixed), rincian: null, note: `Tarif efektif dari ${num(f.orders)} pesanan ${PNAME[plat]} di laporan Anda.` };
    }
    const d = CekTarif.DATA[plat];
    const kat = d.kategori.some((k) => k.id === sim.kat) ? sim.kat : d.kategori[0].id;
    const est = CekTarif.estimate({ platform: plat, status: sim.status, kategori: kat, opsi: sim.opsi, afiliasi: ok(sim.afiliasi) ? sim.afiliasi : 0 });
    return { src, plat, avail, kat, pct: est.pct, fixed: est.fixed, rincian: est.rincian, note: '' };
  }
  function viewSimulator() {
    const f = simFee();
    const s = st();
    const field = (k, label, unit, v, info = '', hint = '') => `<div class="field"><label for="sim-${k}">${label}${info ? qi(info, label) : ''}</label><div class="input">${unit === 'Rp' ? '<span>Rp</span>' : ''}<input id="sim-${k}" type="number" step="${unit === 'Rp' ? (k === 'feeFixed' ? 50 : 1000) : 0.5}" inputmode="decimal" value="${v ?? ''}">${unit === '%' ? '<span>%</span>' : ''}</div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const d = CekTarif.DATA[f.plat];
    const umum = f.src === 'umum' ? `<div class="fields two">
        <div class="field span-all"><label for="simx-kat">Kategori produk</label><select class="plain" id="simx-kat">${d.kategori.map((x) => `<option value="${x.id}" ${f.kat === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="simx-status">Status toko</label><select class="plain" id="simx-status">${d.status.map((x) => `<option value="${x.id}" ${sim.status === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="simx-aff">Komisi afiliasi</label><div class="input"><input id="simx-aff" type="number" min="0" max="50" step="0.5" value="${ok(sim.afiliasi) && sim.afiliasi ? sim.afiliasi : ''}" placeholder="0"><span>%</span></div></div>
        <div class="field span-all"><span class="label">Program yang diikuti</span><div class="checks">${d.opsi.map((o) => `<label class="check"><input type="checkbox" data-sim-opsi="${o.id}" ${sim.opsi.includes(o.id) ? 'checked' : ''}><span>${esc(o.label)} <span class="faint">${String(o.pct).replace('.', ',')}%</span></span></label>`).join('')}</div></div></div>
      <p class="tiny faint">Perkiraan dari tarif publik ${esc(d.nama)} (${esc(d.berlaku)}), dicek ${tgl(CekTarif.DATA.dicek)}. Angka pasti per subkategori ada di Seller Centre. Sumber: ${d.sumber.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(', ')}.</p>` : `<p class="tiny faint">${esc(f.note)} Angka ini otomatis mengikuti tarif terbaru, kategori, dan program yang Anda ikuti.</p>`;
    return `<section class="panel"><div class="sim"><div class="sim-in">
        <div class="sim-src">
          <div class="sim-src-head"><h3>Potongan marketplace${qi('sim_potongan')}</h3>
            <div class="seg" role="group" aria-label="Sumber potongan"><button type="button" data-sim-src="laporan" aria-pressed="${f.src === 'laporan'}" ${f.avail.length ? '' : 'disabled title="Unggah laporan penghasilan dulu"'}>Dari laporan toko</button><button type="button" data-sim-src="umum" aria-pressed="${f.src === 'umum'}">Tarif umum</button></div></div>
          <div class="seg" role="group" aria-label="Marketplace">${(f.src === 'laporan' ? f.avail : CekTarif.PLATFORMS).map((k) => `<button type="button" data-sim-plat="${k}" aria-pressed="${f.plat === k}">${f.src === 'umum' ? esc(CekTarif.DATA[k].nama) : PNAME[k]}</button>`).join('')}</div>
          ${umum}
        </div>
        <fieldset class="sim-grp"><legend><span class="sg-n">1</span>Harga</legend><div class="fields two align">
          ${field('listPrice', 'Harga jual normal', 'Rp', sim.listPrice ?? 100000)}
          ${field('disc', 'Diskon toko', '%', sim.disc ?? 0)}</div></fieldset>
        <fieldset class="sim-grp"><legend><span class="sg-n">2</span>Modal &amp; biaya</legend><div class="fields two align">
          ${field('cost', `${(TYPES[typeOf(s)] || { cost: 'Modal' }).cost} per unit`, 'Rp', sim.cost ?? 60000, 'modal')}
          ${field('packing', typeOf(s) === 'dropship' ? 'Biaya dropship per pesanan' : 'Packing per pesanan', 'Rp', ok(sim.packing) ? sim.packing : (ok(s.packing) ? s.packing : 0), typeOf(s) === 'dropship' ? 'dropship_fee' : 'packing_in')}</div></fieldset>
        <fieldset class="sim-grp"><legend><span class="sg-n">3</span>Potongan marketplace</legend><div class="fields two align">
          ${field('feePct', 'Potongan persen', '%', ok(sim.feePct) ? sim.feePct : f.pct, '', 'Terisi dari sumber di atas; boleh diubah.')}
          ${field('feeFixed', 'Biaya tetap per pesanan', 'Rp', ok(sim.feeFixed) ? sim.feeFixed : f.fixed, '', 'Biaya proses pesanan dan sejenisnya.')}
        </div></fieldset>
      </div><div class="sim-out" id="sim-out" aria-live="polite"></div></div></section>`;
  }
  function renderSimOut() {
    const box = $('#sim-out');
    if (!box) return;
    const s = st(), f = simFee();
    const g = (k, d) => (ok(sim[k]) ? sim[k] : d);
    const target = ok(s.targetMargin) ? s.targetMargin : 15;
    const res = Engine.simulate({ listPrice: g('listPrice', 100000), disc: g('disc', 0), cost: g('cost', 60000), feePct: g('feePct', f.pct),
      feeFixed: g('feeFixed', f.fixed), packing: g('packing', ok(s.packing) ? s.packing : 0), target });
    if (!(res.price > 0)) { box.innerHTML = '<p class="muted small">Isi harga dan diskon yang masuk akal.</p>'; return; }
    // Warna di atas kartu hijau gelap: dibuat terang agar tiap bagian terbaca.
    const parts = [['Modal', res.cost, 'rgb(255 255 255 / 52%)'], ['Potongan', res.fees, '#ff9a82'], [typeOf(s) === 'dropship' ? 'Dropship' : 'Packing', res.packing, 'var(--mark)'], ['Laba', Math.max(res.margin, 0), '#5fe0b3']].filter((p) => p[1] > 0);
    const tot = parts.reduce((a, p) => a + p[1], 0);
    box.innerHTML = `<div class="sim-hero ${res.margin < 0 ? 'is-neg' : ''}"><span class="sh-k">Laba per unit · simulasi${qi('sim_margin')}</span>
      <span class="sim-big ${res.margin < 0 ? 'neg' : ''}">${fmt(res.margin)}</span><span class="sh-m">margin <b>${pct(res.marginPct)}</b> dari harga dibayar pembeli</span>
      <div class="bar-stack" role="img" aria-label="Pembagian harga jual: ${parts.map(([l, v]) => `${l} ${fmt(v)}`).join(', ')}">${parts.map(([l, v, c]) => `<div title="${l}: ${fmt(v)}" style="flex:${v / tot};background:${c}"></div>`).join('')}</div>
      <div class="legend">${parts.map(([l, v, c]) => `<span><i class="sw" style="background:${c}"></i>${l} ${fmt(v)}</span>`).join('')}</div></div>
      <div class="facts" style="margin-top:4px"><div class="fact"><span>Harga impas${qi('harga_impas')}</span><b>${fmt(res.breakEvenPrice)}</b><small>di bawah ini rugi</small></div>
        <div class="fact"><span>Harga untuk target ${target}%${qi('harga_target')}</span><b>${fmt(res.targetPrice)}</b><small>dibayar pembeli</small></div>
        <div class="fact"><span>Dibayar pembeli${qi('sim_dibayar')}</span><b>${fmt(res.price)}</b><small>setelah diskon</small></div>
        <div class="fact"><span>Diskon maksimal${qi('sim_diskon_maks')}</span><b class="${res.maxDisc < 0 ? 'neg' : ''}">${pct(res.maxDisc / 100)}</b><small>sebelum rugi</small></div></div>
      ${f.rincian && !ok(sim.feePct) && !ok(sim.feeFixed) ? `<details class="small"><summary style="cursor:pointer;font-weight:650">Rincian potongan tarif umum</summary><ul class="plain-list">${f.rincian.map((x) => `<li><span>${esc(x.label)}</span><b>${x.pct !== undefined ? `${String(x.pct).replace('.', ',')}%` : fmt(x.rp)}</b></li>`).join('')}</ul></details>` : ''}`;
  }

  /* ---------- riwayat ---------- */
  async function maybeLoadReports(force) {
    if (!account.user || (account.reports && !force)) return;
    try { account.reports = await cloud.db.listReports(); } catch (e) { account.reports = []; toast(e.message); }
    if (viewName === 'riwayat') $('#view').innerHTML = viewRiwayat();
  }
  const FREE_HIST = 3;
  function viewRiwayat() {
    if (!cloud.enabled) return `<div class="panel empty"><span class="ic">${svg('riwayat', 24)}</span><h2>Riwayat butuh akun</h2><p>Fitur akun belum diaktifkan di situs ini. Sementara itu, gunakan Laporan PDF atau Excel untuk menyimpan hasil.</p></div>`;
    if (!account.user) return `<div class="panel empty"><span class="ic">${svg('riwayat', 24)}</span><h2>Simpan hasil tiap bulan, bandingkan kapan saja</h2><p>Dengan akun gratis, ringkasan angka toko Anda tersimpan dan bisa dibandingkan antarperiode dari perangkat mana pun. File laporan tetap tidak diunggah.</p>
      <ol class="empty-steps"><li><b>1</b>Simpan ringkasan periode ini</li><li><b>2</b>Unggah laporan bulan berikutnya</li><li><b>3</b>Bandingkan penjualan dan laba antarperiode</li></ol>
      <div class="row-actions" style="justify-content:center"><a class="btn primary" href="akun.html?mode=daftar&next=dashboard.html%23riwayat">Daftar gratis</a><a class="btn" href="akun.html?next=dashboard.html%23riwayat">Masuk</a></div></div>`;
    if (!account.reports) return '<div class="skel-list" aria-busy="true"><span class="sr-only">Memuat riwayat…</span><i class="skeleton"></i><i class="skeleton"></i><i class="skeleton"></i></div>';
    const reps = account.reports;
    const cur = last && last.r && !demo ? snapshot(last.r) : null;
    const cmp = view.compare && reps.find((x) => x.id === view.compare);
    if (!reps.length) return `<div class="panel empty"><span class="ic">${svg('riwayat', 24)}</span><h2>Belum ada riwayat</h2><p>Setelah melihat hasil, klik <b>Simpan ke riwayat</b> di bagian atas. Simpan setiap bulan untuk melihat perkembangan toko.</p>${cur ? '<button class="btn primary" type="button" id="save-hist">Simpan hasil sekarang</button>' : '<button class="btn primary" type="button" data-go="data">Unggah laporan</button>'}</div>`;
    return `<div class="hist tl">${reps.map((x) => { const s = x.summary || {}; return `<div class="hist-row">
        <div><b>${esc(x.title || 'Tanpa judul')}</b><span class="k">${tgl(s.first)} sampai ${tgl(s.last)}, disimpan ${tgl(x.created_at)}</span></div>
        <div><span class="k">Penjualan</span><b>${fmt(s.sales)}</b></div><div><span class="k">Laba setelah modal</span><b class="${s.margin < 0 ? 'neg' : ''}">${fmt(s.margin)}</b></div>
        <div><span class="k">Laba dari data tersedia</span><b class="${s.net < 0 ? 'neg' : ''}">${s.opex ? fmt(s.net) : '—'}</b></div>
        <div class="row-actions">${cur ? `<button class="btn sm" type="button" data-compare="${esc(x.id)}">${view.compare === x.id ? 'Tutup' : 'Bandingkan'}</button>` : ''}<button class="btn sm quiet danger" type="button" data-del-report="${esc(x.id)}" aria-label="Hapus ${esc(x.title)}">Hapus</button></div></div>`; }).join('')}</div>
      ${!isPro() ? `<p class="small muted">Akun gratis menyimpan ${FREE_HIST} riwayat; Pro tanpa batas.</p>` : ''}
      ${!cur ? '<p class="small muted">Buka laporan Anda di Data &amp; modal untuk membandingkannya dengan riwayat.</p>' : ''}
      ${cmp && cur ? compareTable(cmp, cur) : ''}`;
  }
  function compareTable(saved, cur) {
    const s = saved.summary || {};
    const rows = [['Pesanan', s.orders, cur.orders, 'n'], ['Penjualan', s.sales, cur.sales], ['Potongan marketplace', s.feePct, cur.feePct, 'p', true], ['Laba setelah modal', s.margin, cur.margin], ['Laba dari data tersedia', s.opex ? s.net : null, cur.opex ? cur.net : null], ['Modal diketahui', s.coverage, cur.coverage, 'p']];
    const show = (v, t) => (v === null || v === undefined ? '—' : t === 'n' ? num(v) : t === 'p' ? pct(v) : fmt(v));
    const d = (a, b, t, inv) => { if (!ok(a) || !ok(b)) return ''; const diff = b - a; if (Math.abs(diff) < 1e-9) return '<span class="faint">sama</span>'; const good = inv ? diff < 0 : diff > 0; return `<span class="delta ${good ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${t === 'p' ? `${pct(Math.abs(diff))} poin` : t === 'n' ? num(Math.abs(diff)) : fmt(Math.abs(diff))}</span>`; };
    return `<section class="panel"><div class="panel-head"><h3>Perbandingan</h3><p>${esc(saved.title)} dibanding data yang sedang dibuka</p></div>
      <div class="tablewrap"><table class="data"><thead><tr><th></th><th>${esc(saved.title)}</th><th>Sekarang</th><th>Selisih</th></tr></thead><tbody>
      ${rows.map(([l, a, b, t, inv]) => `<tr><td>${l}</td><td>${show(a, t)}</td><td>${show(b, t)}</td><td>${d(a, b, t, inv)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- data & modal ---------- */
  const typeIcon = (k, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TYPES[k].icon}</svg>`;
  function typePicker(cur) {
    return `<section class="panel type-pick" aria-labelledby="tp-h"><div class="panel-head" style="margin-bottom:12px"><h3 id="tp-h">Anda berjualan sebagai apa?${qi('jenis_usaha')}</h3><p>Mengatur cara modal dihitung. Bisa diubah kapan saja.</p></div>
      <div class="type-grid" role="radiogroup" aria-label="Jenis usaha">${Object.entries(TYPES).map(([k, t]) => `<button type="button" class="type-opt" role="radio" aria-checked="${cur === k}" data-type="${k}">
        <span class="ic">${typeIcon(k)}</span><span><b>${t.label}</b><span>${t.desc}</span></span></button>`).join('')}</div>
      ${cur ? '<div><button class="btn sm quiet" type="button" data-type-close>Batal</button></div>' : ''}</section>`;
  }
  /* ---------- Pusat Data Marketplace ----------
   * Peta jenis laporan per marketplace dan kategori. Hanya jenis yang punya parser di engine yang bisa diunggah;
   * sisanya ditampilkan jujur sebagai "Memerlukan sampel data" (tanpa parser, tanpa angka). Status unggah diambil dari
   * hasil parser dan engine (files, last.all.jejakUang), bukan dihitung ulang di sini. */
  const MP_NAMA = { shopee: 'Shopee', tiktok: 'TikTok Shop', tokopedia: 'Tokopedia', lazada: 'Lazada' };
  const KATEGORI = [
    ['income', 'Penghasilan dan biaya marketplace', 'Sumber penjualan, potongan marketplace, dan dana diterima. Wajib untuk analisis laba.'],
    ['orders', 'Penjualan dan pesanan', 'Jumlah barang, SKU, dan variasi tiap pesanan agar modal per produk lebih tepat. Tidak menambah penjualan.'],
    ['ads', 'Iklan dan promosi', 'Biaya iklan dan promosi di luar potongan per pesanan.'],
    ['return', 'Retur dan refund', 'Kasus retur dan refund, termasuk barang yang tidak kembali.'],
    ['balance', 'Saldo marketplace', 'Mutasi saldo penjual.'],
    ['payout', 'Penarikan atau pencairan dana', 'Dana yang dipindahkan ke rekening Anda.'],
    ['product', 'Produk, SKU, variasi, dan stok', 'Daftar produk dan stok dari Seller Centre.'],
    ['modal', 'Modal, HPP, dan biaya tambahan', 'Modal per produk lewat template Cek Untung. Biaya tetap dan packing diisi di Pengaturan.'],
  ];
  const DUK = {   // st: ok | beta | via | ignored | need | na
    ok: ['ok', 'Didukung'], beta: ['beta', 'Beta'], via: ['via', 'Lewat TikTok Shop'], ignored: ['ign', 'Dikenali, tidak dipakai'],
    need: ['need', 'Memerlukan sampel data'], na: ['need', 'Belum berlaku'] };
  const PERLU = { st: 'need' };
  const BETA_EXPORT = 'Format export marketplace dapat berubah. Hasil pencocokan ditandai bila belum dapat diverifikasi.';
  const MODAL_SUP = { st: 'ok', kind: 'modal_template', fmt: '.xlsx / .csv', how: 'Unduh template di bagian Modal & HPP, isi, lalu unggah kembali.' };
  const SUMBER = {
    shopee: {
      income: { st: 'ok', kind: 'shopee_income', fmt: '.xlsx', how: 'Keuangan › Penghasilan Saya › tab Sudah Dilepas › Unduh' },
      orders: { st: 'beta', kind: 'shopee_orders', fmt: '.xlsx', how: 'Pesanan Saya › Export', note: BETA_EXPORT },
      ads: { st: 'need', note: 'Laporan iklan belum dibaca. Agar tidak terhitung dua kali, biaya iklan bisa dicatat sebagai biaya tetap di Pengaturan.' },
      return: { st: 'ok', kind: 'shopee_return', fmt: '.xlsx' },
      balance: { st: 'ignored', kind: 'shopee_balance', fmt: '.xlsx', note: 'File saldo dikenali tetapi tidak dipakai dalam laba: isinya memuat pencairan dan mutasi yang bukan penjualan.' },
      payout: { st: 'need', note: 'Pencairan dana tidak pernah dihitung sebagai penjualan.' },
      product: PERLU, modal: MODAL_SUP,
    },
    tiktok: {
      income: { st: 'ok', kind: 'tiktok_income', fmt: '.xlsx', how: 'Keuangan › Transaksi › Unduh (pesanan Tokopedia ikut di sini)' },
      orders: { st: 'beta', kind: 'tiktok_orders', fmt: '.csv', how: 'Pesanan › Kelola pesanan › Ekspor', note: BETA_EXPORT },
      ads: { st: 'need', note: 'Laporan iklan belum dibaca. Agar tidak terhitung dua kali, biaya iklan bisa dicatat sebagai biaya tetap di Pengaturan.' },
      return: { st: 'ok', kind: 'tiktok_return', fmt: '.csv' },
      balance: PERLU, payout: { st: 'need', note: 'Pencairan dana tidak pernah dihitung sebagai penjualan.' }, product: PERLU, modal: MODAL_SUP,
    },
    tokopedia: {
      income: { st: 'via', note: 'Pesanan bersumber Tokopedia terbaca dari Laporan Penghasilan TikTok Shop. Jangan unggah laporan Tokopedia terpisah untuk pesanan yang sama.' },
      orders: PERLU, ads: PERLU, return: PERLU,
      balance: PERLU, payout: PERLU, product: PERLU, modal: MODAL_SUP,
    },
    lazada: { income: PERLU, orders: PERLU, ads: PERLU, return: PERLU, balance: PERLU, payout: PERLU, product: PERLU,
      modal: { st: 'na', note: 'Berlaku setelah laporan Lazada didukung.' } },
  };
  /** Status unggah & validasi satu kategori: dari file yang terbaca (kind) dan rekonsiliasi engine. */
  function statusKategori(pf, cat, sup) {
    const ok1 = files.filter((f) => !f.error && f.kind === sup.kind);
    const salah = files.filter((f) => f.expect === sup.kind && f.kind !== sup.kind);
    const bits = [];
    if (salah.length) bits.push(`<span class="warn">${num(salah.length)} file yang dipilih di sini bukan ${esc(KIND[sup.kind] ? KIND[sup.kind][1] : 'jenis ini')}</span>`);
    if (!sup.kind || sup.st === 'via') return bits.join(' · ');
    if (!ok1.length) return bits.length ? bits.join(' · ') : '<span class="faint">Belum ada file</span>';
    bits.unshift(`<span class="ok">${num(ok1.length)} file terbaca</span>`);
    if (sup.st === 'ignored') bits.push('tidak masuk perhitungan');
    if (cat === 'income') {
      const J = last && last.all && last.all.jejakUang && last.all.jejakUang.marketplace && last.all.jejakUang.marketplace[pf];
      const cocok = ok1.filter((f) => { const p = f.parsed; const ref = pf === 'shopee' ? p.check.summaryTotal : p.check.reportSettle; return ref !== null && Math.abs(ref - p.check.sum) <= 1; }).length;
      bits.push(cocok === ok1.length ? 'cocok dengan ringkasan resmi' : `<span class="warn">${num(ok1.length - cocok)} file tidak cocok atau tanpa ringkasan</span>`);
      if (J && J.file && J.file.identik) bits.push(`${num(J.file.identik)} file sama diabaikan`);
      if (J && J.gabungan) {
        if (J.gabungan.ditahan) bits.push(`<span class="warn">${num(J.gabungan.ditahan)} transaksi berbeda antarlaporan ditahan</span>`);
        else if (J.gabungan.duplikatDiabaikan) bits.push(`${num(J.gabungan.duplikatDiabaikan)} baris yang sama di beberapa laporan dihitung sekali`);
        if (J.gabungan.status === 'periode_perlu_dicek') bits.push('<span class="warn">periode perlu dicek</span>');
      }
    }
    return bits.join(' · ');
  }
  function pusatData() {
    const ada = (k) => files.some((f) => f.kind && f.kind.startsWith(k));
    const mp = view.mp || (ada('tiktok') && !ada('shopee') ? 'tiktok' : 'shopee');
    const aktif = KATEGORI.filter(([cat]) => SUMBER[mp][cat].st !== 'need' && SUMBER[mp][cat].st !== 'na');
    const belum = KATEGORI.filter(([cat]) => !aktif.some(([c]) => c === cat));
    const baris = aktif.map(([cat, nama, guna]) => {
      const sup = SUMBER[mp][cat];
      const [cls, lbl] = DUK[sup.st];
      const bisa = !demo && sup.kind && ['ok', 'beta'].includes(sup.st);
      const id = `in-${mp}-${cat}`;
      const st = statusKategori(mp, cat, sup);
      return `<li class="pd-k pd-${cls}">
        <div class="pd-h"><b>${nama}</b><span class="pd-st ${cls}">${lbl}</span></div>
        <p class="pd-guna">${guna}</p>
        ${sup.how || sup.fmt ? `<p class="pd-meta">${sup.how ? `<span><span class="pd-l">Cara unduh</span> ${esc(sup.how)}</span>` : ''}${sup.fmt ? `<span><span class="pd-l">Format</span> ${esc(sup.fmt)}</span>` : ''}</p>` : ''}
        ${sup.note ? `<p class="pd-note">${esc(sup.note)}</p>` : ''}
        ${bisa || st ? `<div class="pd-foot">${st ? `<span class="pd-v">${st}</span>` : '<span></span>'}${bisa ? `<label class="btn sm" for="${id}">Pilih file</label><input id="${id}" type="file" multiple accept="${sup.fmt && sup.fmt.includes('.csv') && !sup.fmt.includes('.xlsx') ? '.csv' : '.xlsx,.xls,.csv'}" data-expect="${sup.kind}" hidden>` : ''}</div>` : ''}
      </li>`;
    }).join('');
    return `<section class="panel pusat-data" aria-labelledby="pd-t">
      <div class="panel-head" style="margin-bottom:10px"><h3 id="pd-t">Pusat Data Marketplace</h3><p>Pilih marketplace, lalu unggah laporan sesuai kategorinya. Jenis file tetap dikenali dari isinya, bukan dari nama file.</p></div>
      <div class="pd-mp" role="tablist" aria-label="Marketplace">${Object.entries(MP_NAMA).map(([k, l]) => `<button type="button" role="tab" aria-selected="${mp === k}" data-mp="${k}"><i class="sw ${k}" aria-hidden="true"></i>${l}</button>`).join('')}</div>
      <div role="tabpanel" aria-label="Kategori laporan ${MP_NAMA[mp]}" class="pd-panel">
        ${aktif.length ? `<ul class="pd-list">${baris}</ul>` : `<p class="pd-kosong">Laporan ${MP_NAMA[mp]} belum bisa dibaca. Kami memerlukan sampel file ekspor asli sebelum membuat pembacanya, agar tidak menghasilkan angka yang salah.</p>`}
        ${belum.length ? `<details class="pd-lain" ${aktif.length ? '' : 'open'}><summary>${num(belum.length)} kategori belum didukung untuk ${MP_NAMA[mp]}</summary><ul>${belum.map(([cat, nama, guna]) => { const sup = SUMBER[mp][cat]; const [cls, lbl] = DUK[sup.st]; return `<li><div class="pd-h"><b>${nama}</b><span class="pd-st ${cls}">${lbl}</span></div><p class="pd-guna">${guna}</p>${sup.note ? `<p class="pd-note">${esc(sup.note)}</p>` : ''}</li>`; }).join('')}</ul></details>` : ''}
      </div>
      <p class="tiny faint">Hanya kategori berstatus Didukung atau Beta yang masuk perhitungan. Kategori "Memerlukan sampel data" belum punya pembaca file dan tidak menghasilkan angka. Unduh semua laporan untuk periode yang sama.</p>
    </section>`;
  }
  function viewData() {
    const s = st();
    const r = last && last.all;
    const dis = demo ? 'disabled' : '';
    const type = demo ? 'stok' : typeOf(s);
    const isDrop = type === 'dropship';
    // Langkah persiapan: status diambil dari isian dan hasil engine yang sudah ada (tanpa perhitungan baru).
    const hasIncome = !!(r && r.totalSales);
    const steps = [['Jenis usaha', !!type, 'cara modal dihitung'], ['Laporan penghasilan', hasIncome || demo, 'wajib, dari Seller Centre'],
      ['Modal & HPP', !!(r && r.totalSales && r.coverage >= 0.98), r && r.totalSales ? `${pct(r.coverage, 0)} penjualan punya modal` : 'agar laba bisa dihitung'], ['Biaya & target', !!((s.fixedCosts || []).length || ok(s.packing)), 'opsional']];
    const sec = view.section || 'unggah';
    return `
      ${demo ? '<p class="note-box warn">Mode contoh memakai data dan modal Toko Contoh Sejahtera. Unggah file Anda untuk mulai; data contoh akan diganti.</p>' : ''}
      <ol class="setup-steps" aria-label="Langkah persiapan">${steps.map(([t, done, d], i) => `<li class="${done ? 'done' : ''}"><span class="ss-n" aria-hidden="true">${done ? '✓' : i + 1}</span><span><b>${t}</b><small>${done ? 'selesai' : d}</small></span><span class="sr-only">${done ? 'selesai' : 'belum'}</span></li>`).join('')}</ol>
      <nav class="sec-tabs" aria-label="Bagian halaman data">${[['unggah', 'Unggah data'], ['modal', 'Modal & HPP'], ['pengaturan', 'Pengaturan']].map(([k, l]) => `<button type="button" data-go="data" data-section="${k}" ${sec === k ? 'aria-current="true"' : ''}>${l}</button>`).join('')}</nav>
      ${!demo && (!type || view.typeOpen) ? typePicker(type) : ''}
      ${pusatData()}
      <div class="grid-2 data-grid" style="align-items:start">
        <section class="stack" id="sec-unggah" aria-label="Data penghasilan">
          <div class="grp-head"><span class="grp-n" aria-hidden="true">1</span><b>Data penghasilan</b><span class="badge todo">Wajib</span><span class="tiny faint grp-sub">Laporan Penghasilan dari Seller Centre: sumber penjualan, potongan, dan dana diterima.</span></div>
          <div class="drop" id="drop"><span class="ic">${svg('data', 24)}</span><strong>Tarik file laporan ke sini</strong>
            <span class="small muted drop-sub">atau pilih dari komputer / HP Anda. File dibaca di browser ini, tidak dikirim ke server.</span>
            <label class="btn primary" for="file-input">Pilih file</label><input id="file-input" type="file" multiple accept=".xlsx,.xls,.csv" hidden>
            <span class="drop-fmt"><span>.xlsx</span><span>.xls</span><span>.csv</span><span class="faint">boleh banyak sekaligus; file yang sama tidak dihitung dua kali</span></span></div>
          <ul class="files" id="file-list"></ul>
          <div id="upload-status" aria-live="polite"></div>
          ${files.length ? '<div><button class="btn sm quiet danger" type="button" id="clear-btn">Hapus semua file</button></div>' : ''}
        </section>
        <section class="panel modal-panel" id="sec-modal" aria-label="Modal dan HPP">
          <div class="panel-head" style="margin:0"><h3><span class="grp-n" aria-hidden="true">2</span>${type === 'produsen' ? 'Modal produksi (HPP)' : 'Modal barang / HPP'}${qi('modal')} <span class="badge todo">Wajib untuk laba</span></h3>${r && r.totalSales ? `<span class="badge ${r.coverage >= 0.98 ? 'ok' : 'todo'}">${r.coverage >= 0.98 ? 'Lengkap' : `${pct(r.coverage, 0)} penjualan`}</span>` : ''}</div>
          ${type ? `<div class="type-chip"><span class="ic">${typeIcon(type, 16)}</span><span>${TYPES[type].label}</span>${demo ? '' : '<button class="btn link" type="button" data-type-open>Ubah</button>'}</div>` : ''}
          <p class="small muted">Laporan marketplace tidak berisi harga beli Anda. Pesanan tanpa modal tidak dihitung dalam laba, bukan dianggap nol.</p>
          ${modalBody(s, r, dis, type)}
        </section>
      </div>
      <section class="stack opt-groups" id="sec-pengaturan" aria-label="Pengaturan opsional">
        <div class="opt-intro"><h3>Pengaturan opsional</h3><p class="small muted">Tidak wajib. Laba sudah bisa dihitung dari laporan penghasilan dan modal barang. Buka bagian di bawah hanya bila perlu.</p></div>
        ${optSec('biaya', '4', 'Biaya tambahan', 'Biaya yang tidak tercatat di laporan marketplace, misalnya packing dan gaji admin.',
          [ok(s.packing) && s.packing > 0 ? `${isDrop ? 'Dropship' : 'Packing'} ${fmt(s.packing)}/pesanan` : '', (s.fixedCosts || []).length ? `${num(s.fixedCosts.length)} biaya operasional` : ''].filter(Boolean).join(' · ') || 'Belum diisi', `
          <div class="fields align">
            <div class="field"><label for="s-packing">${isDrop ? 'Biaya dropship per pesanan' : 'Packing per pesanan'}${qi(isDrop ? 'dropship_fee' : 'packing_in')}</label><div class="input"><span>Rp</span><input id="s-packing" type="number" min="0" step="100" inputmode="numeric" placeholder="Misalnya 2000" value="${ok(s.packing) && s.packing > 0 ? s.packing : ''}" ${dis}></div><span class="hint">${isDrop ? 'Packing atau jasa yang ditagih supplier per pesanan. Contoh: Rp3.000 per paket.' : 'Plastik, bubble wrap, dan lakban per paket. Contoh: Rp1.500. Dikurangkan dari laba setiap pesanan.'}</span></div>
          </div>
          <div class="field"><span class="label">Biaya operasional per bulan${qi('opex_in')}</span>
            <span class="hint" style="margin:0 0 6px">Biaya tetap toko yang tidak ada di laporan marketplace. Contoh: gaji admin Rp2.000.000, sewa gudang Rp1.000.000. Dikurangkan dari laba sesuai lama periode data.</span>
            <div class="costs-list">${(s.fixedCosts || []).map((c, i) => `<div class="cost-row"><input class="plain" id="fc-label-${i}" value="${esc(c.label)}" placeholder="Misalnya gaji admin" aria-label="Nama biaya ${i + 1}" ${dis}>
              <div class="input"><span>Rp</span><input id="fc-amount-${i}" type="number" min="0" step="10000" value="${ok(c.amount) ? c.amount : ''}" aria-label="Jumlah biaya ${i + 1}" ${dis}></div>
              ${demo ? '<span></span>' : `<button class="x" type="button" data-fc-del="${i}" aria-label="Hapus biaya ${i + 1}">×</button>`}</div>`).join('')}</div>
            ${demo ? '' : `<div><button class="btn sm quiet" type="button" id="fc-add">+ Tambah biaya: gaji, sewa, iklan${type === 'produsen' ? ', sewa dapur/alat' : ''}</button></div>`}</div>`)}
        ${optSec('target', '5', 'Target bisnis', 'Patokan untuk menilai produk dan bulan. Tidak mengubah angka laba.',
          `Margin ${ok(s.targetMargin) ? s.targetMargin : 15}%${!ok(s.targetMargin) || s.targetMargin === 15 ? ' (nilai bawaan)' : ''}${ok(s.targetProfit) && s.targetProfit > 0 ? ` · laba ${fmt(s.targetProfit)}/bulan` : ''}`, `
          <div class="fields align">
            <div class="field"><label for="s-target">Target margin per produk${qi('target_margin')}</label><div class="input"><input id="s-target" type="number" min="0" max="80" step="1" inputmode="decimal" value="${ok(s.targetMargin) ? s.targetMargin : 15}" ${dis}><span>% dari harga</span></div><span class="hint">Contoh: 20% berarti dari harga jual Rp100.000 Anda ingin sisa laba Rp20.000. Dipakai untuk status produk dan harga target. Bawaan 15% bila tidak diubah; tidak mengubah angka laba.</span></div>
            <div class="field"><label for="s-tprofit">Target laba per bulan${qi('target_laba_in')}</label><div class="input"><span>Rp</span><input id="s-tprofit" type="number" min="0" step="100000" inputmode="numeric" placeholder="Misalnya 5000000" value="${ok(s.targetProfit) ? s.targetProfit : ''}" ${dis}></div><span class="hint">Contoh: Rp5.000.000. Ringkasan menunjukkan berapa bulan yang mencapai target.</span></div>
          </div>`)}
        ${optSec('identitas', '', 'Identitas laporan PDF (opsional)', 'Nama toko, penyusun, dan logo untuk sampul PDF. Tidak memengaruhi perhitungan laba.',
          prof().store ? esc(prof().store) : 'Belum diisi', `
          <p class="note-box">Informasi ini hanya digunakan sebagai identitas pada laporan PDF. Tidak memengaruhi perhitungan laba.</p>
          <div class="fields">
            <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(prof().store)}" placeholder="Toko Sejahtera" ${dis}><span class="hint">Judul di sampul PDF. Contoh: Toko Buku Sejahtera.</span></div>
            <div class="field"><label for="pf-owner">Disusun oleh atau untuk</label><input class="plain" id="pf-owner" value="${esc(prof().owner)}" placeholder="Untuk: Bapak Andi" ${dis}><span class="hint">Baris kecil di sampul. Contoh: "Disusun oleh Rina untuk pemilik toko".</span></div>
            <div class="field"><span class="label">Logo</span><div class="row-actions">${prof().logo ? `<img src="${esc(prof().logo)}" alt="Logo toko" style="height:38px;max-width:120px;object-fit:contain;border-radius:6px">` : ''}
              <label class="btn sm" for="pf-logo" ${demo ? 'hidden' : ''}>${prof().logo ? 'Ganti' : 'Pilih gambar'}</label><input id="pf-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden>
              ${prof().logo && !demo ? '<button class="btn sm quiet" type="button" id="pf-logo-del">Hapus</button>' : ''}</div><span class="hint">PNG atau JPG. Tampil di pojok sampul PDF, menggantikan logo Cek Untung.</span></div>
          </div>`)}
      </section>`;
  }
  /** Bagian pengaturan opsional yang bisa dibuka-tutup. Status buka disimpan di view.openSec agar tidak tertutup saat render ulang. */
  function optSec(key, n, title, desc, summary, body) {
    return `<details class="panel opt-sec" data-sec="${key}" ${view.openSec[key] ? 'open' : ''}>
      <summary><span class="grp-n ${n ? '' : 'blank'}" aria-hidden="true">${n}</span><span class="opt-t"><b>${title}</b>${/opsional/i.test(title) ? '' : ' <span class="badge">Opsional</span>'}<small>${desc}</small></span><span class="opt-val">${summary}</span></summary>
      <div class="opt-body">${body}</div></details>`;
  }
  /** Isi panel modal sesuai jenis usaha. */
  function modalBody(s, r, dis, type) {
    if (!type) return '<p class="note-box">Pilih jenis usaha di atas, lalu isi modal sesuai cara Anda mendapatkan barang.</p>';
    if (type === 'reseller') {
      const mode = s.modalMode === 'acuan' ? 'acuan' : 'produk';
      return `<div class="tabs" role="tablist" aria-label="Cara menghitung modal">
          <button type="button" role="tab" data-mode="acuan" aria-selected="${mode === 'acuan'}" ${dis}>Diskon dari harga acuan</button>
          <button type="button" role="tab" data-mode="produk" aria-selected="${mode === 'produk'}" ${dis}>Harga beli per produk</button></div>
        ${mode === 'acuan' ? acuanPanel(s, dis) : produkPanel(s, r, dis, type)}`;
    }
    return produkPanel(s, r, dis, type);
  }
  function produkPanel(s, r, dis, type) {
    const hasData = r && r.products.length;
    const missing = hasData ? r.products.filter((p) => !ok(p.unitCost)).length : 0;
    const word = (TYPES[type] || { cost: 'Modal' }).cost;
    const intro = { stok: 'Isi harga beli per unit setiap produk. Biaya kulakan ditambahkan otomatis.', produsen: 'Hitung HPP dengan kalkulator di bawah, lalu terapkan ke produk. Atau isi langsung lewat template.', dropship: 'Isi harga yang Anda bayar ke supplier untuk satu unit. Biaya dropship per pesanan diisi di bagian Biaya lain.', reseller: 'Isi harga beli per unit bila diskon pemasok berbeda-beda per produk.' }[type] || '';
    return `
      ${intro ? `<p class="small">${intro}</p>` : ''}
      <div class="row-actions"><button class="btn sm" type="button" id="tpl-download" ${hasData ? '' : 'disabled'}>Unduh template modal</button>
        <label class="btn sm" for="tpl-input" ${demo ? 'hidden' : ''}>Unggah template terisi</label><input id="tpl-input" type="file" accept=".xlsx,.xls,.csv" hidden></div>
      <p class="tiny faint" style="margin-top:-8px">${hasData ? `Template berisi ${num(r.products.length)} produk dari laporan Anda. Isi kolom Modal per unit (${lower(word)}), simpan, lalu unggah.` : 'Unggah laporan penghasilan dulu agar template berisi produk Anda.'}${s.catalog.length ? ` Tersimpan: ${num(s.catalog.length)} modal produk.` : ''}</p>
      ${type === 'stok' ? `<div class="field"><label for="s-extra">Biaya kulakan${qi('biaya_kulakan')}</label><div class="input"><input id="s-extra" type="number" min="0" max="100" step="0.5" inputmode="decimal" placeholder="Misalnya 3" value="${ok(s.extraCostPct) && s.extraCostPct > 0 ? s.extraCostPct : ''}" ${dis}><span>% dari harga beli</span></div><span class="hint">Ongkir dari supplier dan biaya angkut, ditambahkan ke modal setiap produk.</span></div>` : ''}
      ${type === 'produsen' ? hppPanel(s, r, dis) : ''}
      <div class="field"><label for="s-fallback">Modal rata-rata untuk produk yang belum diisi${qi('modal_rata')}</label>
        <div class="input"><input id="s-fallback" type="number" min="0" max="99" step="1" inputmode="decimal" placeholder="Misalnya 60" value="${ok(s.fallbackPct) ? s.fallbackPct : ''}" ${dis}><span>% dari harga jual</span></div>
        <span class="hint">Perkiraan cepat. Kosongkan bila hanya ingin memakai modal per produk yang Anda isi.</span></div>
      ${r && r.totalSales ? `<div class="cover-meter"><div class="small"><b>${pct(r.coverage, 0)}</b> penjualan sudah punya modal${missing ? `, ${num(missing)} produk belum diisi` : ''}.</div>
        <div class="progress" aria-hidden="true"><i style="width:${Math.round(r.coverage * 100)}%"></i></div>
        ${r.ttNoDetail && !r.hasOrderExport.tiktok ? `<p class="tiny faint">${num(r.ttNoDetail)} pesanan TikTok tidak mencantumkan produk. Unggah export pesanan TikTok, atau isi modal rata-rata.</p>` : ''}
        ${r.qtyAssumed && !r.hasOrderExport.shopee ? '<p class="tiny faint">Jumlah barang Shopee dianggap 1 per produk per pesanan. Unggah export pesanan Shopee agar tepat.</p>' : ''}</div>` : ''}
      ${hasData ? `<details ${(missing && missing <= 40) || view.costQ ? 'open' : ''}><summary class="small" style="cursor:pointer;font-weight:700">Isi ${lower(word)} per unit langsung di sini</summary>
        <div class="searchrow" style="margin-top:10px"><input class="plain" id="cost-q" type="search" placeholder="Cari produk" value="${esc(view.costQ)}" aria-label="Cari produk"></div><div id="cost-table"></div></details>` : ''}`;
  }
  const lower = (w) => (w === 'HPP' ? w : w.toLowerCase());
  const HPP_FIELDS = [['bahan', 'Bahan baku', 'Rp', 'per produksi'], ['tenaga', 'Tenaga kerja', 'Rp', 'per produksi'], ['overhead', 'Overhead', 'Rp', 'listrik, gas, alat'], ['hasil', 'Hasil jadi', 'unit', 'per produksi'], ['kemasan', 'Kemasan', 'Rp', 'per unit']];
  function hppPanel(s, r, dis) {
    const list = s.hppList || [];
    const prods = r && r.products.length ? [...r.products].sort((a, b) => b.sales - a.sales) : [];
    const row = (h, i) => `<div class="hpp-row">
        <div class="hpp-top"><input class="plain" id="h-nama-${i}" value="${esc(h.nama)}" placeholder="Nama produk, misalnya Keripik 100 g" aria-label="Nama produk ${i + 1}" ${dis}>
          ${demo ? '' : `<button class="x" type="button" data-hpp-del="${i}" aria-label="Hapus perhitungan ${i + 1}">×</button>`}</div>
        <div class="hpp-fields">${HPP_FIELDS.map(([k, l, u, hint]) => `<div class="field"><label for="h-${k}-${i}">${l}</label><div class="input">${u === 'Rp' ? '<span>Rp</span>' : ''}<input id="h-${k}-${i}" type="number" min="0" step="${u === 'Rp' ? 100 : 1}" inputmode="numeric" value="${ok(h[k]) ? h[k] : ''}" ${dis}>${u === 'unit' ? '<span>unit</span>' : ''}</div><span class="hint">${hint}</span></div>`).join('')}</div>
        <div class="hpp-out"><span>HPP per unit <b id="h-out-${i}">${fmt(Engine.hpp(h))}</b></span>
          ${prods.length && !demo ? `<span class="row-actions"><select class="compact" id="h-prod-${i}" aria-label="Produk untuk HPP ${i + 1}"><option value="">Pakai untuk produk…</option>${prods.map((p) => `<option value="${esc(p.key)}" ${h.prod === p.key ? 'selected' : ''}>${esc(p.name.slice(0, 60))} (${PNAME[p.platform]})</option>`).join('')}</select>
            <button class="btn sm" type="button" data-hpp-apply="${i}">Terapkan</button></span>` : '<span class="tiny faint">Unggah laporan untuk menerapkan HPP ke produk.</span>'}</div></div>`;
    return `<div class="subsec"><div class="subsec-head"><b>Kalkulator HPP${qi('hpp')}</b><span class="tiny faint">Biaya satu kali produksi ÷ hasil jadi + kemasan</span></div>
      ${list.map(row).join('')}
      ${demo ? '' : `<div><button class="btn sm quiet" type="button" id="hpp-add">+ ${list.length ? 'Tambah produk' : 'Hitung HPP produk'}</button></div>`}</div>`;
  }
  /** Batas harga aman untuk reseller: dinyatakan sebagai persen dari harga acuan. */
  function batasAman(s) {
    if (!ok(s.mitra)) return '';
    const r = last && last.all;
    const A = ok(s.acuanContoh) && s.acuanContoh > 0 ? s.acuanContoh : 100000;
    const target = ok(s.targetMargin) ? s.targetMargin : 15;
    const packing = ok(s.packing) ? s.packing : 0;
    const plats = r && (r.feeModel.shopee || r.feeModel.tiktok) ? ['shopee', 'tiktok'].filter((k) => r.feeModel[k]) : ['shopee', 'tiktok'];
    const cols = plats.map((k) => {
      const fm = r && r.feeModel[k];
      const f = fm ? { pct: fm.pct * 100, fixed: fm.fixed, src: 'laporan Anda' } : { ...CekTarif.estimate({ platform: k }), src: 'tarif umum (perkiraan)' };
      const x = Engine.simulate({ listPrice: A, disc: 0, cost: A * (1 - s.mitra / 100), feePct: f.pct, feeFixed: f.fixed, packing, target });
      return { k, f, x };
    });
    const cell = (v) => `<b>${fmt(v)}</b><span class="faint tiny sub-val">${pct(v / A, 0)} dari acuan</span>`;
    return `<div class="subsec"><div class="subsec-head"><b>Batas harga aman${qi('batas_aman')}</b>
        <div class="input sm-input"><span>Harga acuan Rp</span><input id="s-acuan-contoh" type="number" min="1000" step="1000" inputmode="numeric" value="${A}" aria-label="Contoh harga acuan"></div></div>
      <div class="tablewrap"><table class="data tight"><thead><tr><th></th>${cols.map((c) => `<th>${PNAME[c.k]}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Harga beli Anda</td>${cols.map(() => `<td>${fmt(A * (1 - s.mitra / 100))}</td>`).join('')}</tr>
        <tr><td>Harga jual minimum (impas)</td>${cols.map((c) => `<td>${cell(c.x.breakEvenPrice)}</td>`).join('')}</tr>
        <tr><td>Diskon maksimal dari harga acuan</td>${cols.map((c) => `<td class="${c.x.maxDisc < 0 ? 'neg' : ''}"><b>${pct(c.x.maxDisc / 100)}</b></td>`).join('')}</tr>
        <tr><td>Harga untuk margin ${target}%</td>${cols.map((c) => `<td>${cell(c.x.targetPrice)}</td>`).join('')}</tr>
      </tbody></table></div>
      <p class="tiny faint">Potongan: ${cols.map((c) => `${PNAME[c.k]} ${pct(c.f.pct / 100)} + ${fmt(c.f.fixed)} per pesanan (${c.f.src})`).join('; ')}. Packing ${fmt(packing)} per pesanan. Satu barang per pesanan; bila pembeli membeli lebih dari satu, batasnya sedikit lebih rendah.</p></div>`;
  }
  function acuanPanel(s, dis) {
    const ready = ok(s.mitra);
    const p = s.periods[s.periods.length - 1];
    // Bagian lanjutan otomatis terbuka bila seller sudah mengisi nilai selain bawaan.
    const resellerCustom = (s.coret || 100) !== 100 || s.periods.length > 1 || s.periods.some((q) => q.markup || q.disc || q.start);
    const sell = 100 * (1 + (p.markup || 0) / 100) * (1 - (p.disc || 0) / 100), cost = 100 - (s.mitra || 0);
    return `<p class="small muted">Untuk reseller yang membeli dengan potongan dari harga acuan pemasok, misalnya harga sampul buku atau harga katalog distributor.</p>
      <div class="fields two align">
        <div class="field"><label for="s-mitra">Diskon dari pemasok${qi('diskon_pemasok')}</label><div class="input ${!ready && files.length ? 'need' : ''}"><input id="s-mitra" type="number" min="0" max="99" step="0.5" inputmode="decimal" placeholder="Misalnya 30" value="${ready ? s.mitra : ''}" ${dis}><span>%</span></div><span class="hint">Harga beli = harga acuan − diskon ini. Contoh: mitra penerbit dapat diskon 30% dari harga sampul.</span></div>
      </div>
      <details class="opt-sec sub" data-sec="reseller" ${(view.openSec.reseller ?? resellerCustom) ? 'open' : ''}>
        <summary><span class="grp-n" aria-hidden="true">3</span><span class="opt-t"><b>Pengaturan harga reseller</b> <span class="badge">Opsional</span><small>Isi bila harga jual Anda berbeda dari harga acuan, misalnya dinaikkan atau didiskon toko.</small></span><span class="opt-val">${resellerCustom ? 'Sudah Anda atur' : 'Memakai nilai bawaan: harga coret = harga acuan, harga jual Shopee = harga acuan. Nilai ini ikut menentukan perkiraan modal.'}</span></summary>
        <div class="opt-body"><div class="fields two align">
        <div class="field"><label for="s-coret">Harga coret di TikTok${qi('harga_coret')}</label><div class="input"><input id="s-coret" type="number" min="1" step="1" value="${s.coret || 100}" ${dis}><span>% dari acuan</span></div><span class="hint">100% bila harga coret sama dengan harga acuan. Contoh: buku harga sampul Rp100.000 dicoret Rp110.000 → isi 110.</span></div></div>
      <div class="subsec"><div class="subsec-head"><b>Pola harga di Shopee${qi('pola_shopee')}</b><span class="tiny faint">Shopee tidak mencatat harga sebelum diskon</span></div>
        <div class="periods"><div class="period period-head"><span>Mulai tanggal pesanan</span><span>Kenaikan dari acuan</span><span>Diskon toko</span><span></span></div>
        ${s.periods.map((q, i) => `<div class="period"><div class="input"><input type="date" id="p-start-${i}" value="${esc(q.start)}" aria-label="Mulai periode ${i + 1}" ${dis}></div>
          <div class="input"><input type="number" id="p-markup-${i}" step="0.5" value="${q.markup}" aria-label="Kenaikan dari harga acuan periode ${i + 1}" ${dis}><span>%</span></div>
          <div class="input"><input type="number" id="p-disc-${i}" step="0.5" min="0" max="99" value="${q.disc}" aria-label="Diskon toko periode ${i + 1}" ${dis}><span>%</span></div>
          ${s.periods.length > 1 && !demo ? `<button class="x" type="button" data-del="${i}" aria-label="Hapus periode ${i + 1}">×</button>` : '<span></span>'}</div>`).join('')}</div>
        ${demo ? '' : '<div><button class="btn sm quiet" type="button" id="add-period">+ Tambah periode harga</button></div>'}</div>
        </div></details>
      <p class="formula">${ready ? `Contoh harga acuan Rp100.000: Anda membeli Rp${(cost * 1000).toLocaleString('id-ID')} dan menjual Rp${Math.round(sell * 1000).toLocaleString('id-ID')} di Shopee (periode terakhir), sisa ${pct((sell - cost) / sell)} sebelum potongan marketplace.` : 'Isi diskon dari pemasok untuk menghitung modal.'}</p>
      ${batasAman(s)}`;
  }
  function renderCostTable() {
    const box = $('#cost-table');
    if (!box || !last) return;
    const q = Engine.norm(view.costQ);
    const list = last.all.products.filter((p) => !q || Engine.norm(`${p.name} ${p.sku} ${p.code}`).includes(q));
    list.sort((a, b) => (ok(a.baseCost) - ok(b.baseCost)) || b.sales - a.sales);
    const shown = view.costAll ? list : list.slice(0, 25);
    const word = (TYPES[demo ? 'stok' : typeOf(st())] || { cost: 'Modal' }).cost;
    box.innerHTML = `<div class="tablewrap"><table class="data cost-table"><thead><tr><th>Produk</th><th>Terjual</th><th>Harga rata-rata</th><th>${word} per unit</th></tr></thead><tbody>
      ${shown.map((p) => `<tr><td><i class="sw" style="background:var(--${p.platform})"></i> ${esc(p.name)}<br><span class="tiny faint">${esc(catKey(p) || '-')}</span></td>
        <td>${p.qtyKnown ? num(p.qty) : `${p.rows}×`}</td><td>${fmt(p.avgPrice)}</td>
        <td><input type="number" min="0" step="100" inputmode="numeric" class="${ok(p.baseCost) ? '' : 'missing'}" data-cost="${esc(p.key)}" value="${ok(p.baseCost) ? p.baseCost : ''}" placeholder="Rp" aria-label="${word} per unit ${esc(p.name)}" ${demo ? 'disabled' : ''}></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada produk yang cocok.</td></tr>'}</tbody></table></div>
      ${list.length > 25 ? `<button class="btn sm quiet" type="button" id="cost-all">${view.costAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${num(list.length)} produk`}</button>` : ''}`;
  }
  function setProductCost(key, raw) {
    const p = last && last.all.products.find((x) => x.key === key);
    if (!p) return;
    const kode = catKey(p), nama = p.name;
    const same = (e) => (kode ? Engine.norm(e.kode) === Engine.norm(kode) : !e.kode && Engine.norm(e.nama) === Engine.norm(nama));
    settings.catalog = settings.catalog.filter((e) => !same(e));
    if (raw !== '' && +raw >= 0) settings.catalog.push({ kode, nama, variasi: '', cost: +raw });
    settings.modalMode = 'produk';
    save();
  }
  function mergeCatalog(entries) {
    const map = new Map(settings.catalog.map((e) => [catKeyOf(e), e]));
    for (const e of entries) map.set(catKeyOf(e), e);
    settings.catalog = [...map.values()];
    settings.modalMode = 'produk';
    save();
  }
  function downloadTemplate() {
    if (!last) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(Engine.templateRows(last.all));
    ws['!cols'] = [{ wch: 11 }, { wch: 22 }, { wch: 52 }, { wch: 16 }, { wch: 9 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Modal');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Petunjuk'],
      ['1. Isi kolom "Modal per unit (Rp)": harga beli atau produksi satu unit, tanpa ongkir ke pembeli.'],
      ['2. Jangan ubah kolom "Kode"; kolom ini dipakai untuk mencocokkan dengan laporan marketplace.'],
      ['3. Boleh menambah baris: isi Kode (SKU) atau Nama produk, lalu Modal per unit.'],
      ['4. Simpan, lalu unggah file ini di Cek Untung, halaman Data & modal.']]), 'Petunjuk');
    XLSX.writeFile(wb, 'template-modal-cekuntung.xlsx');
    track('unduh-template');
  }

  /* ---------- daftar file ---------- */
  const readFile = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    const isCsv = /\.csv$/i.test(file.name);
    reader.onload = () => {
      try {
        if (!window.XLSX) throw new Error('Pembaca Excel gagal dimuat. Muat ulang halaman.');
        const wbx = isCsv ? XLSX.read(reader.result, { type: 'string', raw: true }) : XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        const sheets = Engine.sheetsFromSheetJS(XLSX, wbx);
        // File tanpa satu pun sel berisi: beri tahu terus terang, jangan dianggap laporan dengan nilai nol.
        const isi = Object.values(sheets).some((rows) => (rows || []).some((r) => (r || []).some((c) => c !== null && c !== undefined && String(c).trim() !== '')));
        if (!isi) { resolve({ name: file.name, kind: 'unknown', error: 'File kosong: tidak ada data yang bisa dibaca.' }); return; }
        const parsed = Engine.parseWorkbook({ name: file.name, sheets });
        resolve({ name: file.name, kind: parsed.kind, parsed });
      } catch (err) { resolve({ name: file.name, kind: 'unknown', error: err.message || 'File tidak bisa dibaca.' }); }
    };
    reader.onerror = () => resolve({ name: file.name, kind: 'unknown', error: 'File tidak bisa dibaca.' });
    if (isCsv) reader.readAsText(file, 'utf-8'); else reader.readAsArrayBuffer(file);
  });
  async function addFiles(list, expect = '') {
    if (!list || !list.length) return;
    if (demo) { demo = false; files = []; resetView(); }
    const fl = $('#file-list'); if (fl) fl.insertAdjacentHTML('beforeend', `<li class="file small muted">Membaca ${list.length} file…</li>`);
    toast(`Membaca ${list.length} file…`);
    const results = await Promise.all([...list].map(readFile));
    if (expect) results.forEach((f) => { f.expect = expect; });
    for (const f of results) if (f.parsed && f.parsed.kind === 'modal_template') { mergeCatalog(f.parsed.entries); f.note = `${num(f.parsed.entries.length)} modal produk dimuat`; toast(f.note); }
    const hadIncome = !!last;
    files.push(...results);
    track('unggah-file');
    render();
    if (!hadIncome && last) toast(last.all.ready ? 'Laporan terbaca. Tekan "Lihat hasil analisis" untuk membuka hasilnya.' : 'Laporan terbaca. Langkah berikutnya: isi modal barang.');
    else if (!last) toast('File terbaca. Laporan Penghasilan masih dibutuhkan untuk analisis laba.');
    // Bawa seller ke status unggah agar langkah berikutnya terlihat (terutama di HP).
    const box = $('#upload-status'); if (box && box.firstElementChild) box.scrollIntoView({ block: 'center' });
  }
  function fileStatus(f) {
    const beda = f.expect && f.kind !== f.expect
      ? `<br><span class="warn">Dipilih untuk ${esc(KIND[f.expect] ? KIND[f.expect][1] : 'kategori lain')}, tetapi ${f.kind === 'unknown' ? 'isinya tidak sesuai format itu' : `isinya ${esc(KIND[f.kind] ? KIND[f.kind][1] : 'jenis lain')}. Diproses sesuai isinya`}.</span>` : '';
    return fileStatusDasar(f) + beda;
  }
  function fileStatusDasar(f) {
    if (f.error) return `<span class="bad">${esc(f.error)}</span>`;
    if (f.note) return `<span class="ok">${esc(f.note)}</span>`;
    const p = f.parsed;
    if (p.kind === 'shopee_income' || p.kind === 'tiktok_income') {
      const ref = p.kind === 'shopee_income' ? p.check.summaryTotal : p.check.reportSettle;
      const n = p.kind === 'shopee_income' ? `${num(p.orders.length)} pesanan` : `${num(p.rows.length)} transaksi`;
      const chk = ref === null ? '<span class="warn">Ringkasan tidak ditemukan, total tidak bisa dicocokkan</span>'
        : Math.abs(ref - p.check.sum) <= 1 ? `<span class="ok">Cocok dengan ringkasan resmi (${fmt(p.check.sum)})</span>` : `<span class="warn">Selisih ${fmt(p.check.sum - ref)} dengan ringkasan resmi</span>`;
      // P13: TikTok membedakan periode resmi (sheet Laporan) dari rentang tanggal transaksi yang teramati.
      const per = p.check.periode;
      const range = p.kind === 'tiktok_income' && per
        ? (per.status === 'resmi' ? `, periode ${tgl(per.from)} sampai ${tgl(per.to)}${per.diLuar ? ` <span class="warn">(${num(per.diLuar)} transaksi di luar periode)</span>` : ''}`
          : `${p.check.from ? `, transaksi teramati ${tgl(p.check.from)} sampai ${tgl(p.check.to)}` : ''}${per.status === 'rusak' ? ' <span class="warn">(periode resmi tidak terbaca)</span>' : ''}`)
        : p.check.from ? `, ${tgl(p.check.from)} sampai ${tgl(p.check.to)}` : '';
      return `${n}${range}<br>${chk}`;
    }
    if (p.kind === 'shopee_orders' || p.kind === 'tiktok_orders') return `${num(p.lines.length)} baris produk`;
    if (p.kind === 'shopee_return' || p.kind === 'tiktok_return') return `${p.cases.length} pengajuan retur atau refund`;
    if (p.kind === 'shopee_balance') return 'Tidak diperlukan. Gunakan Laporan Penghasilan.';
    return '<span class="bad">Format belum dikenali. Lihat daftar file yang dibaca.</span>';
  }
  // Kegunaan tiap jenis file, agar seller tahu mengapa file itu diunggah.
  const FILE_USE = { shopee_income: 'penjualan, potongan marketplace, dan dana diterima', tiktok_income: 'penjualan, potongan marketplace, dan dana diterima',
    shopee_orders: 'jumlah barang dan variasi tiap pesanan, agar modal lebih tepat', tiktok_orders: 'jumlah barang dan variasi tiap pesanan, agar modal lebih tepat',
    shopee_return: 'kasus retur dan refund, termasuk barang yang tidak kembali', tiktok_return: 'kasus retur dan refund, termasuk barang yang tidak kembali',
    modal_template: 'modal per produk' };
  /**
   * Status setelah unggah: apa yang sudah terbaca dan apakah sudah cukup untuk analisis laba. Semua dari hasil parser
   * dan engine (last.all); tidak ada angka baru. "Terbaca" ≠ tervalidasi.
   */
  function uploadStatus() {
    if (demo || !files.length) return '';
    const ok1 = files.filter((f) => !f.error && f.kind !== 'unknown');
    const kinds = new Set(ok1.map((f) => f.kind));
    const bad = files.length - ok1.length;
    const r = last && last.all;
    const plat = ['shopee', 'tiktok'].filter((k) => [...kinds].some((x) => x.startsWith(k)));
    // Pesanan bersumber Tokopedia sudah ada di Laporan Penghasilan TikTok Shop (kolom "Sumber pesanan").
    const toko = r && r.tiktok && r.tiktok.bySource && r.tiktok.bySource.Tokopedia;
    const tokoNote = (k) => (k === 'tiktok' && kinds.has('tiktok_income') && toko ? `<span class="tiny faint up-st-toko">Termasuk ${num(toko.orders)} baris pesanan bersumber Tokopedia. Tidak perlu mengunggah laporan Tokopedia terpisah untuk pesanan yang sama.</span>` : '');
    const rows = plat.map((k) => `<li><span class="ftag ${k}">${PNAME[k]}</span>${kinds.has(`${k}_income`) ? '<span class="ok">Laporan Penghasilan ada</span>' : '<span class="warn">Laporan Penghasilan belum ada</span>'}${kinds.has(`${k}_orders`) ? ' · export pesanan' : ''}${kinds.has(`${k}_return`) ? ' · file retur' : ''}${tokoNote(k)}</li>`).join('');
    const MODAL = '<button class="btn" type="button" data-go="data" data-section="modal">Isi modal barang</button>';
    const HASIL = '<button class="btn primary" type="button" data-go="ringkasan">Lihat hasil analisis</button>';
    let cls, title, body, ctas;
    if (!r || !(r.totalSales || r.orders)) {
      cls = 'pending'; title = 'File terbaca, tetapi belum cukup untuk analisis laba';
      body = 'Laporan Penghasilan dari Seller Centre masih dibutuhkan. File itulah sumber penjualan, potongan marketplace, dan dana yang Anda terima. Export pesanan dan file retur hanya melengkapi. Cara mengunduhnya ada di daftar "Laporan yang didukung" di bawah.';
      ctas = '';
    } else if (!r.ready) {
      cls = 'pending'; title = 'Penjualan dan potongan sudah bisa dilihat';
      body = 'Laba belum bisa dihitung karena modal barang (HPP) belum diisi. Pesanan tanpa modal tidak dihitung dalam laba, bukan dianggap nol.';
      ctas = HASIL + MODAL;
    } else if (r.statusHpp && r.statusHpp.total === 'sebagian') {
      cls = 'estimate'; title = 'Data cukup untuk analisis awal';
      body = `${pct(r.coverage, 0)} penjualan masuk dalam perhitungan laba karena modalnya sudah diketahui. Sisanya belum dihitung sampai modalnya diisi, jadi laba belum final.`;
      ctas = HASIL + MODAL;
    } else {
      cls = 'verified'; title = 'Data cukup untuk analisis laba';
      body = 'Semua penjualan sudah punya modal. Laba tetap ditandai belum final sampai semua komponen terverifikasi; rinciannya ada di Kepastian Profit.';
      ctas = HASIL;
    }
    return `<section class="up-status ${cls}" aria-labelledby="up-st-h"><div class="up-st-head"><span class="status ${cls}" aria-hidden="true"></span><h3 id="up-st-h">${title}</h3></div>
      ${rows ? `<ul class="up-st-plat">${rows}</ul>` : ''}<p class="small">${body}</p>
      ${bad ? `<p class="small warn">${num(bad)} file belum dikenali dan tidak dipakai. Lihat keterangan di daftar file.</p>` : ''}
      ${ctas ? `<div class="row-actions">${ctas}</div>` : ''}
      <p class="tiny faint">"Terbaca" berarti format file dikenali. Total Laporan Penghasilan dicocokkan dengan ringkasan resmi; hal lain yang belum pasti ditandai di Kepastian Profit.</p></section>`;
  }
  function renderFiles() {
    const st0 = $('#upload-status'); if (st0) st0.innerHTML = uploadStatus();
    const el = $('#file-list');
    if (!el) return;
    const list = demo ? CekDemo.make().map((wb) => ({ name: wb.name, demo: true, kind: Engine.detect(wb) })) : files;
    el.innerHTML = list.map((f, i) => {
      const [cls, label] = KIND[f.kind] || KIND.unknown;
      const [plat, ...rest] = label.split(', ');
      const st = f.demo ? 'ok' : f.error || f.kind === 'unknown' ? 'bad' : f.kind === 'shopee_balance' ? 'warn' : /class="warn"/.test(fileStatus(f)) ? 'warn' : 'ok';
      return `<li class="file fs-${st}"><span class="file-ic ${cls}" aria-hidden="true">${svg('laporan', 18)}</span><div class="file-body"><div class="name">${esc(f.name)}</div>
        <div class="file-tags"><span class="ftag ${cls}">${esc(plat)}</span>${rest.length ? `<span class="ftag">${esc(rest.join(', '))}</span>` : ''}${f.kind === 'shopee_orders' || f.kind === 'tiktok_orders' ? `<span class="ftag beta-tag" title="${BETA_NOTE}">Beta</span>` : ''}<span class="ftag st ${st}">${st === 'ok' ? '✓ Terbaca' : st === 'warn' ? '! Periksa' : '✕ Tidak terbaca'}</span></div>
        <div class="muted file-st">${f.demo ? 'Data contoh' : fileStatus(f)}</div>${!f.demo && FILE_USE[f.kind] ? `<div class="tiny faint file-use">Dipakai untuk: ${FILE_USE[f.kind]}</div>` : ''}</div>
        ${f.demo ? '<span></span>' : `<button class="x" type="button" data-rm="${i}" aria-label="Hapus ${esc(f.name)}">×</button>`}</li>`;
    }).join('');
    const drop = $('#drop');
    if (drop && !drop.dataset.bound) {
      drop.dataset.bound = '1';
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    }
  }
  const resetView = () => Object.assign(view, { platform: 'all', from: '', to: '', showAll: false, q: '', costQ: '', costAll: false, compare: null, prodFilter: 'all', prodKey: null, platCol: 'total' });

  /* ---------- penjelasan angka (tombol ?) ---------- */
  function infoPop() {
    let pop = $('#info-pop');
    if (!pop) { document.body.insertAdjacentHTML('beforeend', '<div id="info-pop" class="info-pop" role="dialog" aria-labelledby="info-pop-t" hidden></div>'); pop = $('#info-pop'); }
    return pop;
  }
  function hideInfo() {
    const pop = $('#info-pop');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll('.qi[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function showInfo(btn) {
    const info = CekInfo.get(btn.dataset.info, last && last.r);
    if (!info) return;
    const pop = infoPop();
    if (!pop.hidden && pop.dataset.key === btn.dataset.info) { hideInfo(); return; }
    hideInfo();
    pop.dataset.key = btn.dataset.info;
    pop.innerHTML = `<div class="ip-head"><b id="info-pop-t">${esc(info.t)}</b><button class="x" type="button" data-info-close aria-label="Tutup">×</button></div>
      <p>${esc(info.a)}</p>${info.h ? `<p><span class="ip-k">Cara dihitung</span>${esc(info.h)}</p>` : ''}${info.b ? `<p><span class="ip-k">Cara membaca</span>${esc(info.b)}</p>` : ''}
      ${info.d ? `<p class="ip-d">${esc(info.d)}</p>` : ''}`;
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const sheet = window.innerWidth < 600;
    pop.classList.toggle('sheet', sheet);
    if (sheet) { pop.style.left = ''; pop.style.top = ''; return; }
    const b = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(12, b.left - 16), window.innerWidth - w - 12);
    const below = b.bottom + 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${below + h > window.innerHeight - 12 && b.top - h - 8 > 12 ? b.top - h - 8 : below}px`;
  }

  /* ================= 6. dialog ================= */
  const dlg = () => $('#dlg');
  // Satu paket Pro, sekali bayar. Nama paket lama tetap dikenali untuk permintaan yang sudah tercatat.
  const planName = (k) => ({ pro_sekali: 'Pro sekali bayar', pro_bulanan: 'Pro bulanan (paket lama)', pro_tahunan: 'Pro tahunan (paket lama)' }[k] || 'Pro');
  /** Harga Pro dari config: harga peluncuran + harga reguler yang direncanakan (dicoret, berlabel). Tidak menampilkan hitung mundur maupun jumlah slot promosi. */
  function hargaPro(gaya = '') {
    const pr = C.prices || {};
    if (!pr.pro) return '';
    return `<div class="harga-pro ${gaya}">${pr.proLabel ? `<span class="hp-label">${esc(pr.proLabel)}</span>` : ''}
      ${pr.proRegular ? `<span class="hp-was">Harga reguler yang direncanakan <s>${esc(pr.proRegular)}</s></span>` : ''}
      <span class="hp-now"><b>${esc(pr.pro)}</b> ${esc(pr.proUnit || '')}</span><span class="hp-note">Bayar satu kali, tanpa tagihan bulanan atau tahunan.</span></div>`;
  }
  const dHead = (t, s) => `<div class="d-head"><div><h2 style="font-size:22px">${t}</h2>${s ? `<p class="small muted" style="margin-top:4px">${s}</p>` : ''}</div><button class="x" type="button" data-close aria-label="Tutup">×</button></div>`;
  async function openUpgrade() {
    track('buka-upgrade');
    const d = dlg();
    const p = account.profile;
    let pending = null;
    if (account.user && !isPro()) { try { pending = (await cloud.db.myRequests()).find((x) => x.status === 'baru' || x.status === 'diproses'); } catch (e) { /* abaikan */ } }
    if (isPro() && !demo) {
      d.innerHTML = `${dHead('Pro aktif', CekCloud.isPro(p) ? (CekCloud.isProSekaliBayar(p) ? 'Sekali bayar, aktif selama layanan Cek Untung beroperasi' : `Sampai ${tgl(p.pro_until)}`) : license.ok ? `Kode atas nama ${esc(license.name || '-')}${license.exp ? `, sampai ${tgl(license.exp)}` : ''}` : '')}
        <div class="d-body"><ul class="benefits"><li>Laporan PDF dengan nama dan logo toko</li><li>Analisis semua produk dan saran harga</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
        ${license.ok ? '<button class="btn quiet" type="button" id="code-remove">Hapus kode dari browser ini</button>' : ''}</div>`;
    } else {
      const codeBlock = `<details><summary class="small" style="cursor:pointer;font-weight:650">Punya kode akses?</summary><div style="display:grid;gap:8px;margin-top:10px">
        <textarea class="plain code" id="code-input" placeholder="Tempel kode yang diawali CP1." spellcheck="false"></textarea><span class="tiny" id="code-msg">${license.error ? `<span class="bad">${esc(license.error)}</span>` : ''}</span>
        <button class="btn" type="button" id="code-apply">Aktifkan kode</button></div></details>`;
      let action;
      const SOON = '<p class="note-box"><span class="badge">Segera hadir</span> Pembelian Pro belum dibuka. Semua fitur gratis tetap bisa Anda pakai. Bila sudah punya kode akses, aktifkan di bawah.</p>';
      const pendingInfo = pending ? `<p class="note-box">Pesanan <b>${esc(planName(pending.plan))}</b> tercatat ${tgl(pending.created_at)}. Pro aktif setelah pembayaran terverifikasi.</p>` : '';
      if (!PAY_READY) action = `${pendingInfo}${SOON}`;
      else if (cloud.enabled && !account.user) action = '<a class="btn primary" href="akun.html?view=pro" data-track="buka-checkout">Beli Pro</a><p class="tiny faint">Bisa tanpa daftar dulu. Akun dibuat dari email Anda setelah pembayaran berhasil.</p>';
      else if (cloud.enabled) action = `${pendingInfo}<a class="btn primary" href="akun.html?view=pro" data-track="buka-checkout">${pending ? 'Lihat status pesanan' : 'Lanjut ke pembelian'}</a><p class="tiny faint">Bayar dengan QRIS. Pro aktif di akun ini setelah pembayaran terverifikasi.</p>`;
      else action = '<p class="small warn">Pembelian Pro membutuhkan akun.</p>';
      d.innerHTML = `${dHead('Cek Untung Pro', 'Untuk keputusan harga dan produk yang berbasis angka.')}
        <div class="d-body"><ul class="benefits"><li>Laporan PDF siap kirim, dengan nama dan logo toko</li><li>Semua produk dengan status rugi, tipis, atau sehat</li><li>Harga impas dan harga target per produk</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
        ${hargaPro()}<p class="tiny faint">Akses Pro berlaku untuk akun ini selama layanan Cek Untung beroperasi. Fitur berbayar baru di masa depan tidak otomatis termasuk.</p>
        ${action}${codeBlock}</div>`;
    }
    if (!d.open) d.showModal();
  }
  async function saveHistory() {
    if (!last) return;
    if (!cloud.enabled) { toast('Fitur akun belum aktif. Gunakan Laporan PDF atau Excel untuk menyimpan hasil.'); return; }
    if (!account.user) { location.href = 'akun.html?mode=daftar&next=dashboard.html%23riwayat'; return; }
    if (demo) { toast('Data contoh tidak disimpan. Unggah laporan Anda dulu.'); return; }
    if (!account.reports) { try { account.reports = await cloud.db.listReports(); } catch (e) { account.reports = []; } }
    if (!isPro() && account.reports.length >= FREE_HIST) { toast(`Akun gratis menyimpan ${FREE_HIST} riwayat. Hapus yang lama atau upgrade ke Pro.`); openUpgrade(); return; }
    const r = last.r;
    const def = `${prof().store ? `${prof().store}, ` : ''}${r.first.slice(0, 7) === r.last.slice(0, 7) ? monthLong(r.first.slice(0, 7)) : `${monthLabel(r.first.slice(0, 7))} sampai ${monthLabel(r.last.slice(0, 7))}`}`;
    const d = dlg();
    d.innerHTML = `${dHead('Simpan ke riwayat', 'Yang disimpan hanya ringkasan angka, bukan data pesanan atau pembeli.')}
      <div class="d-body"><div class="field"><label for="hist-title">Nama</label><input class="plain" id="hist-title" value="${esc(def)}"></div><button class="btn primary" type="button" id="hist-confirm">Simpan</button></div>`;
    if (!d.open) d.showModal();
  }

  /* ================= 7. ekspor & laporan ================= */
  function exportXlsx() {
    if (!last) return;
    if (!isPro()) { openUpgrade(); return; }
    const { r } = last;
    const R = (v) => (ok(v) ? Math.round(v) : '');
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    // HPP yang belum diketahui ditulis sebagai teks, bukan 0 (status dari engine; 0 hanya bila HPP memang 0).
    const UNK = 'Belum diketahui';
    const st = r.statusHpp || { total: r.ready ? 'lengkap' : 'tidak_diketahui' };
    const known = (k) => st[k] !== 'tidak_diketahui';
    const RH = (k, v) => (known(k) && ok(v) ? Math.round(v) : UNK);
    const wb = XLSX.utils.book_new();
    const held = CekReport.peringatanTotal(r);   // P11/P13: total belum lengkap (ditahan) / perlu diverifikasi (ambigu)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cek Untung', prof().store || ''], ['Periode data', `${r.first} s.d. ${r.last}`],
      ...[held.ditahan, held.ambigu].filter((x) => x.n).map((x) => ['Status total', x.teks]), [], ['Komponen', ...plats.map((k) => PNAME[k]), 'Total'],
      ['Pesanan terjual', ...plats.map((k) => r[k].orders), r.orders], ['Penjualan', ...plats.map((k) => R(r[k].sales)), R(r.totalSales)],
      ['Potongan marketplace', ...plats.map((k) => R(r[k].feeTotal)), R(r.totalFees)], ['Dana diterima', ...plats.map((k) => R(r[k].received)), R(r.totalReceived)],
      ['Modal', ...plats.map((k) => RH(k, -r[k].modal)), RH('total', -r.totalModal)], ['Packing', ...plats.map((k) => RH(k, -r[k].knownPacking)), RH('total', -r.knownPacking)],
      ['Retur tidak kembali', ...plats.map(() => ''), R(-r.lostCertain)],
      ...(r.kepastian.risikoBarang.kerugianTanpaNilai ? [['Kasus retur tidak kembali tanpa nilai (belum dikurangkan)', ...plats.map(() => ''), r.kepastian.risikoBarang.kerugianTanpaNilai]] : []),
      ['Laba setelah modal', ...plats.map((k) => RH(k, r[k].margin)), RH('total', r.totalMargin)],
      ['Biaya operasional', ...plats.map(() => ''), R(-r.opex)], ['Laba dari data tersedia (setelah biaya operasional)', ...plats.map(() => ''), R(r.netProfit)],
      ['Porsi penjualan dengan modal diketahui (%)', ...plats.map((k) => +(r[k].coverage * 100).toFixed(1)), +(r.coverage * 100).toFixed(1)]]), 'Ringkasan');
    // Laba bulanan: "Belum diketahui" bila bulan itu tanpa penjualan bermodal; kosong bila tanpa transaksi (bukan 0).
    const STATUS_BLN = { tidak_diketahui: 'Belum diketahui', sebagian: 'Modal sebagian', lengkap: 'Modal lengkap', kosong: 'Tidak ada transaksi' };
    const RM = (t, v) => (!r.ready || mStat(t) === 'kosong' ? '' : mKnown(t) ? R(v) : UNK);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bulan pesanan', 'Pesanan', 'Penjualan', 'Potongan', 'Dana diterima', 'Laba setelah modal', 'Laba dari data tersedia', 'Status modal', ...plats.flatMap((k) => [`Penjualan ${PNAME[k]}`, `Laba setelah modal ${PNAME[k]}`])],
      ...r.months.map((m) => [m.month, m.total.orders, R(m.total.sales), R(m.total.fees), R(m.total.received), RM(m.total, m.total.margin), RM(m.total, m.total.net), STATUS_BLN[mStat(m.total)] || '',
        ...plats.flatMap((k) => [R(m[k].sales), RM(m[k], m[k].margin)])])]), 'Per bulan');
    if (r.products.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'Kode', 'Produk', 'Terjual', 'Penjualan', 'Dana diterima', 'Modal', 'Laba', 'Margin %', 'Modal per unit', 'Harga rata-rata', 'Harga impas', 'Harga target', 'Status'],
      ...[...r.products].sort((a, b) => (ok(b.margin) ? b.margin : -1e15) - (ok(a.margin) ? a.margin : -1e15)).map((p) => [PNAME[p.platform], catKey(p), p.name, p.qtyKnown ? Math.round(p.qty) : '', R(p.sales), R(p.received), p.modalKnown ? R(p.modal) : UNK, p.modalKnown && ok(p.margin) ? R(p.margin) : UNK, ok(p.pct) ? +(p.pct * 100).toFixed(1) : '', R(p.unitCost), R(p.avgPrice), R(p.breakEven), R(p.targetPrice), p.health])]), 'Produk');
    if (r.insights.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tingkat', 'Temuan', 'Rincian', 'Saran'], ...r.insights.map((i) => [i.level, i.title, i.detail, i.action])]), 'Temuan');
    if (r.cases.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'No. pesanan', 'Produk', 'Kategori', 'Alasan', 'Resi retur', 'Nilai refund', 'Perkiraan modal', 'Status barang'],
      ...r.cases.map((c) => [PNAME[c.platform], c.orderId, c.product, Engine.CAT_LABEL[c.cat], c.reason, c.resi, R(c.amount), R(c.estModal), c.needsCheck ? c.state : 'tidak perlu'])]), 'Retur');
    XLSX.writeFile(wb, `cek-untung-${(prof().store || 'toko').replace(/[^\w-]+/g, '-')}-${r.first || ''}-${r.last || ''}.xlsx`);
    track('unduh-excel');
  }
  function buildReport() {
    if (!last) return false;
    $('#report').innerHTML = CekReport.html(last.r, { settings: last.st, profile: prof(), demo, filter: { ...view }, brand: C.brand || 'Cek Untung' });
    return true;
  }
  function openReport() {
    if (!last) return;
    if (!isPro()) { openUpgrade(); return; }
    buildReport();
    const old = document.title;
    document.title = `Laporan Profit ${prof().store || 'Toko'} ${last.r.first} sd ${last.r.last}`;
    const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    track(demo ? 'pdf-contoh' : 'unduh-pdf');
    if (!demo) markDone('pdf');
    toast('Pilih "Simpan sebagai PDF" di jendela cetak.');
    setTimeout(() => window.print(), 50);
  }

  /* ================= 8. event & mulai ================= */
  document.addEventListener('input', (e) => {
    const t = e.target, id = t.id || '', v = t.value;
    if (id === 'q') { view.q = v; renderProducts(); return; }
    if (id === 'cost-q') { view.costQ = v; renderCostTable(); return; }
    if (id.startsWith('sim-')) { sim[id.slice(4)] = v === '' ? null : +v; renderSimOut(); return; }
    if (demo) return;
    const n = (x, lo, hi) => (x === '' ? null : Math.min(hi, Math.max(lo, +x)));
    if (id === 's-mitra') settings.mitra = n(v, 0, 99);
    else if (id === 's-packing') settings.packing = n(v, 0, 1e9);
    else if (id === 's-coret') settings.coret = Math.max(1, +v || 100);
    else if (id === 's-fallback') settings.fallbackPct = n(v, 0, 99);
    else if (id === 's-target') settings.targetMargin = n(v, 0, 80) ?? 15;
    else if (id === 's-tprofit') settings.targetProfit = n(v, 0, 1e13);
    else if (id === 's-extra') settings.extraCostPct = n(v, 0, 100);
    else if (id === 's-acuan-contoh') settings.acuanContoh = n(v, 1000, 1e10) ?? 100000;
    else if (/^h-\w+-\d+$/.test(id)) {
      const [, f, i] = id.split('-'); const h = settings.hppList[+i];
      if (!h) return;
      if (f === 'nama' || f === 'prod') h[f] = v; else h[f] = v === '' ? null : Math.max(0, +v);
      const out = $(`#h-out-${i}`); if (out) out.textContent = fmt(Engine.hpp(h));
      store.set(KEYS.settings, settings); queueSync();
      return;
    }
    else if (id.startsWith('p-')) { const [, f, i] = id.split('-'); const p = settings.periods[+i]; if (f === 'start') p.start = v; else p[f] = +v || 0; }
    else if (id.startsWith('fc-')) { const [, f, i] = id.split('-'); const c = settings.fixedCosts[+i]; if (f === 'label') { c.label = v; save(); return; } c.amount = n(v, 0, 1e12); }
    else if (id === 'pf-store' || id === 'pf-owner') { profile[id === 'pf-store' ? 'store' : 'owner'] = v; saveProfile(); return; }
    else return;
    save();
    clearTimeout(render.t);
    render.t = setTimeout(() => { const a = document.activeElement && document.activeElement.id; const y = window.scrollY; render(); window.scrollTo({ top: y }); if (a && $(`#${a}`)) $(`#${a}`).focus(); }, 300);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.cost !== undefined) { setProductCost(t.dataset.cost, t.value); const y = window.scrollY; render(); window.scrollTo({ top: y }); return; }
    if (t.dataset.case) { caseState[t.dataset.case] = t.value; store.set(KEYS.cases, caseState); render(); }
    else if (t.id === 'from' || t.dataset.filter === 'from') { view.from = t.value; render(); }
    else if (t.id === 'to' || t.dataset.filter === 'to') { view.to = t.value; render(); }
    else if (t.id === 'sort') { view.sort = t.value; renderProducts(true); }
    else if (t.id === 'simx-status' || t.id === 'simx-kat') { sim[t.id.slice(5)] = t.value; resetSimFee(); render(); }
    else if (t.id === 'simx-aff') { sim.afiliasi = Math.min(50, Math.max(0, +t.value || 0)); resetSimFee(); render(); }
    else if (t.dataset.simOpsi) { const k = t.dataset.simOpsi; sim.opsi = t.checked ? [...new Set([...sim.opsi, k])] : sim.opsi.filter((x) => x !== k); resetSimFee(); render(); }
    else if (t.id === 'file-input' || t.id === 'tpl-input') { addFiles(t.files); t.value = ''; }
    else if (t.dataset.expect) { addFiles(t.files, t.dataset.expect); t.value = ''; }
    else if (t.id === 'pf-logo' && t.files[0]) {
      const f = t.files[0];
      if (f.size > 400000) { toast('Logo maksimal 400 KB.'); t.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { profile.logo = rd.result; saveProfile(); render(); };
      rd.readAsDataURL(f); t.value = '';
    }
  });
  document.addEventListener('click', async (e) => {
    // Menu "Unduh" (details): tutup bila klik di luar, atau setelah memilih salah satu isinya.
    document.querySelectorAll('details.dd[open]').forEach((d) => { if (!d.contains(e.target) || e.target.closest('.dd-menu button')) d.open = false; });
    // Klik di latar lembar bawah (di luar isinya) menutup lembar.
    if (e.target.id === 'sheet') { closeSheet(); return; }
    const qb = e.target.closest('[data-info]');
    if (qb) { e.preventDefault(); showInfo(qb); return; }
    if (e.target.closest('[data-info-close]') || !e.target.closest('#info-pop')) hideInfo();
    if (e.target.closest('#info-pop')) return;
    const prow = e.target.closest('tr[data-prod]');
    if (prow && !e.target.closest('button, a, select, input')) { openProduct(prow.dataset.prod); return; }
    const t = e.target.closest('button, a[data-track]');
    if (!t) { if (account.menu && !e.target.closest('.menu')) { account.menu = false; renderAccount(); } return; }
    if (t.dataset.track) { track(t.dataset.track); return; }
    if (t.dataset.sheet) { openSheet(t.dataset.sheet); return; }
    if (t.dataset.prod) { openProduct(t.dataset.prod); return; }
    if (t.dataset.pfilter) { view.prodFilter = t.dataset.pfilter; view.showAll = false; renderProducts(true); return; }
    if (t.dataset.platCol) { view.platCol = t.dataset.platCol; const tb = $('.plat-table'); if (tb) { tb.className = `data plat-table show-${view.platCol}`; } document.querySelectorAll('[data-plat-col]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.platCol === view.platCol))); return; }
    if (t.dataset.simProd) {
      // Simulator diisi angka produk dari engine (harga rata-rata, modal per unit); tidak ada hitungan baru di sini.
      const p = last && last.r.products.find((x) => x.key === t.dataset.simProd);
      if (p) { sim.listPrice = ok(p.avgPrice) ? Math.round(p.avgPrice) : null; sim.disc = 0; if (ok(p.unitCost)) sim.cost = Math.round(p.unitCost); sim.src = last.r.feeModel[p.platform] ? 'laporan' : 'umum'; sim.plat = p.platform; sim.kat = null; resetSimFee(); }
      closeSheet(); go('simulator'); return;
    }
    if (t.dataset.fixModal) { const p = last && last.r.products.find((x) => x.key === t.dataset.fixModal); view.costQ = p ? p.name : ''; closeSheet(); go('data', true, 'modal'); return; }
    if (t.hasAttribute('data-sheet-close')) { closeSheet(); return; }
    if (t.dataset.mp) { view.mp = t.dataset.mp; render(); const b = document.querySelector(`[data-mp="${t.dataset.mp}"]`); if (b) b.focus(); return; }
    if (t.dataset.go) { closeSheet(); go(t.dataset.go, true, t.dataset.section); return; }
    // Tombol di lembar Filter & unduh memakai fungsi yang sama dengan menu Unduh di bilah atas.
    if (t.dataset.act) { closeSheet(); ({ pdf: openReport, export: exportXlsx, 'save-hist': saveHistory })[t.dataset.act](); return; }
    if (t.hasAttribute('data-upgrade')) { closeSheet(); account.menu = false; renderAccount(); openUpgrade(); return; }
    if (t.dataset.close !== undefined) { dlg().close(); return; }
    if (t.id === 'acct-toggle') { account.menu = !account.menu; renderAccount(); return; }
    if (t.id === 'logout') { await cloud.auth.signOut(); account.user = null; account.profile = null; account.reports = null; account.menu = false; toast('Anda sudah keluar.'); render(); return; }
    if (t.id === 'code-apply') {
      busy(t, true);
      const res = await checkLicense($('#code-input').value, false);
      busy(t, false);
      if (res.ok) { dlg().close(); toast(`Pro aktif${res.name ? ` atas nama ${res.name}` : ''}.`); track('kode-aktif'); render(); }
      else $('#code-msg').innerHTML = `<span class="bad">${esc(res.reason)}</span>`;
      return;
    }
    if (t.id === 'code-remove') { store.del(KEYS.license); license = { ok: false }; dlg().close(); render(); return; }
    if (t.id === 'hist-confirm') {
      busy(t, true);
      try {
        const r = last.r;
        const row = await cloud.db.addReport({ title: $('#hist-title').value.trim() || 'Tanpa judul', period_from: r.first || null, period_to: r.last || null, summary: snapshot(r) });
        account.reports = [row, ...(account.reports || [])];
        markDone('saved'); dlg().close(); toast('Tersimpan di riwayat.'); track('simpan-riwayat'); render();
      } catch (err) { toast(err.message); busy(t, false); }
      return;
    }
    if (t.dataset.compare) { view.compare = view.compare === t.dataset.compare ? null : t.dataset.compare; $('#view').innerHTML = viewRiwayat(); return; }
    if (t.dataset.delReport) {
      if (!confirm('Hapus riwayat ini?')) return;
      try { await cloud.db.deleteReport(t.dataset.delReport); account.reports = account.reports.filter((x) => x.id !== t.dataset.delReport); toast('Riwayat dihapus.'); $('#view').innerHTML = viewRiwayat(); } catch (err) { toast(err.message); }
      return;
    }
    if (t.dataset.mode && !demo) { settings.modalMode = t.dataset.mode; save(); render(); return; }
    if (t.dataset.type && !demo) {
      const k = t.dataset.type;
      settings.sellerType = k;
      settings.modalMode = k === 'reseller' ? 'acuan' : 'produk';
      view.typeOpen = false; save(); render(); track(`jenis-${k}`);
      toast(`Jenis usaha: ${TYPES[k].label}. ${k === 'reseller' ? 'Isi diskon dari pemasok.' : k === 'produsen' ? 'Hitung HPP di kalkulator.' : 'Isi modal per produk.'}`);
      return;
    }
    if (t.hasAttribute('data-type-open')) { view.typeOpen = true; render(); return; }
    if (t.hasAttribute('data-type-close')) { view.typeOpen = false; render(); return; }
    if (t.dataset.simSrc) { sim.src = t.dataset.simSrc; sim.plat = null; resetSimFee(); render(); return; }
    if (t.dataset.simPlat) { sim.plat = t.dataset.simPlat; sim.kat = null; resetSimFee(); render(); return; }
    if (t.dataset.simUse) { sim.src = 'laporan'; sim.plat = t.dataset.simUse; resetSimFee(); go('simulator'); return; }
    if (t.id === 'hpp-add' && !demo) { settings.hppList = [...(settings.hppList || []), { nama: '', bahan: null, tenaga: null, overhead: null, hasil: null, kemasan: null, prod: '' }]; save(); render(); const i = settings.hppList.length - 1; const el = $(`#h-nama-${i}`); if (el) el.focus(); return; }
    if (t.dataset.hppDel !== undefined && !demo) { settings.hppList.splice(+t.dataset.hppDel, 1); save(); render(); return; }
    if (t.dataset.hppApply !== undefined && !demo) {
      const i = +t.dataset.hppApply, h = settings.hppList[i], key = ($(`#h-prod-${i}`) || {}).value;
      const v = Engine.hpp(h || {});
      if (!ok(v)) { toast('Isi biaya dan hasil jadi dulu agar HPP bisa dihitung.'); return; }
      if (!key) { toast('Pilih produk yang memakai HPP ini.'); return; }
      h.prod = key; setProductCost(key, String(Math.round(v)));
      const p = last && last.all.products.find((x) => x.key === key);
      toast(`HPP ${fmt(v)} dipakai untuk ${p ? p.name.slice(0, 40) : 'produk'}.`); track('hpp-terapkan'); render();
      return;
    }
    if (t.dataset.del !== undefined) { settings.periods.splice(+t.dataset.del, 1); save(); render(); }
    else if (t.id === 'add-period') { const p = settings.periods[settings.periods.length - 1]; settings.periods.push({ start: '', markup: p.markup, disc: p.disc }); save(); render(); }
    else if (t.dataset.fcDel !== undefined) { settings.fixedCosts.splice(+t.dataset.fcDel, 1); save(); render(); }
    else if (t.id === 'fc-add') { settings.fixedCosts.push({ label: '', amount: null }); save(); render(); const i = settings.fixedCosts.length - 1; $(`#fc-label-${i}`).focus(); }
    else if (t.id === 'pf-logo-del') { profile.logo = ''; saveProfile(); render(); }
    else if (t.id === 'tpl-download') downloadTemplate();
    else if (t.id === 'cost-all') { view.costAll = !view.costAll; renderCostTable(); }
    else if (t.hasAttribute('data-demo')) { demo = true; files = []; resetView(); track('klik-demo'); go('ringkasan'); }
    else if (t.id === 'exit-demo') { demo = false; resetView(); render(); }
    else if (t.id === 'clear-btn') { files = []; demo = false; resetView(); render(); }
    else if (t.dataset.rm !== undefined) { files.splice(+t.dataset.rm, 1); render(); }
    else if (t.dataset.platform) { view.platform = t.dataset.platform; render(); }
    else if (t.dataset.metric) { view.metric = t.dataset.metric; render(); }
    else if (t.id === 'show-all') { view.showAll = !view.showAll; renderProducts(); }
    else if (t.id === 'only-check') { view.onlyCheck = !view.onlyCheck; render(); }
    else if (t.id === 'export') exportXlsx();
    else if (t.id === 'pdf') openReport();
    else if (t.id === 'save-hist') saveHistory();
    else if (t.id === 'wipe-btn') {
      if (!confirm('Hapus modal produk, pengaturan, profil laporan, status retur, dan kode akses yang tersimpan di browser ini? Data di akun tidak ikut terhapus.')) return;
      Object.values(KEYS).forEach((k) => store.del(k)); store.del('cekprofit.v2');
      settings = structuredClone(DEFAULTS); profile = { store: '', owner: '', logo: '' }; caseState = {}; license = { ok: false }; done = {};
      render(); toast('Data di browser ini sudah dihapus.');
    }
  });
  // Ingat apakah "Rincian laba" sedang dibuka, agar tidak tertutup saat halaman dirender ulang (mis. ganti filter).
  // Baris produk terpilih hanya ditandai selama lacinya terbuka.
  $('#sheet').addEventListener('close', () => document.querySelectorAll('tr.is-selected').forEach((tr) => tr.classList.remove('is-selected')));
  // Bilah judul: garis bawah & bayangan tipis muncul setelah halaman digulir (penanda di atas halaman, bukan event scroll).
  if ('IntersectionObserver' in window && $('#top-sentinel')) new IntersectionObserver(([en]) => $('#main-top').classList.toggle('is-stuck', !en.isIntersecting)).observe($('#top-sentinel'));
  document.addEventListener('toggle', (e) => { if (!e.target.classList) return; if (e.target.classList.contains('rincian')) view.rincian = e.target.open; if (e.target.id === 'month-table') view.monthOpen = e.target.open; if (e.target.dataset && e.target.dataset.sec) view.openSec[e.target.dataset.sec] = e.target.open; }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    hideInfo();
    document.querySelectorAll('details.dd[open]').forEach((d) => { d.open = false; d.querySelector('summary').focus(); });
  });
  window.addEventListener('scroll', () => { const pop = $('#info-pop'); if (pop && !pop.hidden && !pop.classList.contains('sheet')) hideInfo(); }, { passive: true });
  window.addEventListener('resize', hideInfo);
  window.addEventListener('popstate', () => go(location.hash.slice(1) || 'ringkasan', false));
  cloud.auth.onChange((s) => { if (!s && account.user) { account.user = null; account.profile = null; renderAccount(); } });

  const params = new URLSearchParams(location.search);
  if (params.has('demo')) demo = true;
  const hash = location.hash.slice(1);
  viewName = VIEWS.some((v) => v[0] === hash) ? hash : (demo ? 'ringkasan' : 'data');
  render();
  const savedCode = store.get(KEYS.license, '');
  if (savedCode) checkLicense(savedCode, true).then(render);
  if (account.user) loadAccount();
  if (hash === 'upgrade' || params.has('pro')) openUpgrade();
  if (params.has('demo') && params.has('print')) { buildReport(); document.documentElement.classList.add('print-preview'); }
  window.CekApp = { buildReport, state: () => ({ demo, files: files.length, view: viewName, license: license.ok, account: { user: !!account.user, pro: CekCloud.isPro(account.profile) }, last }) };
})();
