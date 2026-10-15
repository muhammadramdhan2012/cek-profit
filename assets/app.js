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
  const monthLong = (k) => { const [y, mm] = k.split('-'); return `${MONTHS_L[+mm - 1]} ${y}`; };
  const tgl = (d) => { if (!d) return '—'; const [y, m, dd] = d.slice(0, 10).split('-'); return `${+dd} ${MONTHS[+m - 1]} ${y}`; };
  const PNAME = { shopee: 'Shopee', tiktok: 'TikTok Shop' };
  const KIND = {
    shopee_income: ['shopee', 'Shopee, laporan penghasilan'], shopee_return: ['shopee', 'Shopee, retur'], shopee_orders: ['shopee', 'Shopee, export pesanan'],
    tiktok_income: ['tiktok', 'TikTok, laporan penghasilan'], tiktok_return: ['tiktok', 'TikTok, retur'], tiktok_orders: ['tiktok', 'TikTok, export pesanan'],
    modal_template: ['modal', 'Template modal'], shopee_balance: ['', 'Shopee, saldo (tidak diperlukan)'], unknown: ['bad', 'Belum dikenali'],
  };
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3600); };
  const ICON = {
    ringkasan: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    produk: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    biaya: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    retur: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    simulator: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    riwayat: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    data: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  };
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
  const view = { platform: 'all', from: '', to: '', metric: 'margin', q: '', sort: 'margin', showAll: false, onlyCheck: true, costQ: '', costAll: false, compare: null, typeOpen: false };
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
      months: r.months.map((m) => ({ month: m.month, sales: R(m.total.sales), fees: R(m.total.fees), margin: R(m.total.margin), net: R(m.total.net), orders: m.total.orders })),
      top: pick([...prods].sort((a, b) => b.margin - a.margin).slice(0, 10)), worst: pick([...prods].sort((a, b) => a.margin - b.margin).slice(0, 5)),
      insights: r.insights.slice(0, 6).map((i) => ({ level: i.level, title: i.title })) };
  }

  /* ================= 4. kerangka ================= */
  const VIEWS = [
    ['ringkasan', 'Ringkasan', 'Laba toko Anda dalam satu nota'],
    ['produk', 'Produk', 'Laba, margin, status, dan saran harga per produk'],
    ['biaya', 'Biaya & potongan', 'Ke mana potongan marketplace pergi'],
    ['retur', 'Retur', 'Barang yang kembali dan yang hilang'],
    ['simulator', 'Simulator harga', 'Uji harga dan diskon sebelum dipasang'],
    ['riwayat', 'Riwayat', 'Simpan dan bandingkan periode'],
    ['data', 'Data & modal', 'Unggah laporan, atur modal dan biaya'],
  ];
  function renderNav() {
    const r = last && last.r;
    const open = r ? r.cases.filter((c) => c.state === 'belum').length : 0;
    $('#nav').innerHTML = VIEWS.map(([k, label], i) => `${i === 6 ? '<div class="sep" role="presentation"></div>' : ''}<button type="button" data-go="${k}" ${viewName === k ? 'aria-current="page"' : ''}>${svg(k)}<span>${label}</span>
      ${k === 'produk' && r ? `<span class="count">${r.products.length}</span>` : ''}${k === 'retur' && open ? `<span class="count">${open}</span>` : ''}
      ${k === 'data' && !demo && !files.length ? '<span class="count">mulai</span>' : ''}</button>`).join('');
  }
  const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  function renderAccount() {
    const p = account.profile, u = account.user;
    const pro = isPro();
    const planText = demo ? 'Mode contoh' : CekCloud.isPro(p) ? `Pro sampai ${tgl(p.pro_until)}` : license.ok ? `Pro (kode)${license.exp ? ` sampai ${tgl(license.exp)}` : ''}` : 'Paket gratis';
    $('#plan-box').innerHTML = pro ? '' : `<div class="upsell"><b>Cek Profit Pro</b><p>Laporan PDF, analisis semua produk, dan saran harga.</p><button class="btn sm primary" type="button" data-upgrade>Lihat paket</button></div>`;
    if (!cloud.enabled) {
      $('#account-box').innerHTML = `<div class="acct-box"><div class="avatar" style="background:var(--surface-3);color:var(--ink-2)">${svg('data', 16)}</div><div class="who"><b>${planText}</b><span>Tersimpan di browser ini</span></div></div>`;
      $('#account-sm').innerHTML = pro ? '<span class="badge pro">PRO</span>' : '<button class="btn sm" type="button" data-upgrade>Pro</button>';
      return;
    }
    if (!u) {
      $('#account-box').innerHTML = `<div style="display:grid;gap:8px"><a class="btn primary" href="akun.html?mode=daftar&next=dashboard.html">Daftar gratis</a><a class="btn quiet" href="akun.html?next=dashboard.html">Masuk</a>
        <p class="tiny faint" style="padding-inline:4px">Akun menyimpan modal produk dan riwayat agar bisa dibuka dari perangkat lain.</p></div>`;
      $('#account-sm').innerHTML = '<a class="btn sm" href="akun.html?next=dashboard.html">Masuk</a>';
      return;
    }
    const name = (p && p.full_name) || u.email;
    $('#account-box').innerHTML = `<div class="menu">${account.menu ? `<div class="menu-pop" role="menu"><a href="akun.html" role="menuitem">Akun dan profil</a>${!pro ? '<button type="button" data-upgrade role="menuitem">Upgrade ke Pro</button>' : ''}${p && p.is_admin ? '<a href="admin.html" role="menuitem">Halaman admin</a>' : ''}<button type="button" id="logout" role="menuitem">Keluar</button></div>` : ''}
      <button class="acct-box btn quiet" type="button" id="acct-toggle" aria-expanded="${account.menu}" style="width:100%;justify-content:flex-start;padding:8px"><span class="avatar">${esc(initials(name))}</span>
      <span class="who"><b>${esc(name)}</b><span>${account.loading ? 'Memuat akun…' : esc(account.sync && account.sync !== 'Tersimpan di akun' ? account.sync : planText)}</span></span></button></div>`;
    $('#account-sm').innerHTML = `<a href="akun.html" class="avatar" style="width:30px;height:30px;font-size:12px;text-decoration:none" aria-label="Akun">${esc(initials(name))}</a>`;
  }
  function renderTop() {
    const meta = VIEWS.find((v) => v[0] === viewName);
    const r = last && last.r;
    const analysis = !['data', 'riwayat', 'simulator'].includes(viewName) && r;
    const monthOpts = (sel, label) => `<option value="">${label}</option>` + r.allMonths.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    const sub = r ? `${demo ? 'Data contoh, ' : ''}${prof().store ? `${esc(prof().store)}, ` : ''}${tgl(r.first)} sampai ${tgl(r.last)}` : meta[2];
    const pro = isPro();
    $('#main-top').innerHTML = `<div><h1>${meta[1]}</h1><p class="sub">${sub}</p></div>
      ${analysis ? `<div class="tools">
        ${r.available.shopee && r.available.tiktok ? `<div class="seg" role="group" aria-label="Platform">${[['all', 'Semua'], ['shopee', 'Shopee'], ['tiktok', 'TikTok']].map(([k, l]) => `<button type="button" data-platform="${k}" aria-pressed="${view.platform === k}">${l}</button>`).join('')}</div>` : ''}
        <select class="compact" id="from" aria-label="Dari bulan">${monthOpts(view.from, 'Dari awal')}</select><select class="compact" id="to" aria-label="Sampai bulan">${monthOpts(view.to, 'Sampai akhir')}</select>
        <span class="divider" aria-hidden="true"></span>
        <button class="btn sm" type="button" id="save-hist">Simpan ke riwayat</button>
        <button class="btn sm" type="button" id="export">${pro ? '' : '<span class="badge pro">PRO</span>'}Excel</button>
        <button class="btn sm primary" type="button" id="pdf">${pro ? '' : '<span class="badge pro">PRO</span>'}Laporan PDF</button></div>` : ''}
      ${viewName === 'data' && !demo && !files.length ? '<div class="tools"><button class="btn sm" type="button" data-demo>Lihat dengan data contoh</button></div>' : ''}
      ${viewName === 'data' && demo ? '<div class="tools"><button class="btn sm" type="button" id="exit-demo">Keluar dari mode contoh</button></div>' : ''}`;
  }

  function render() {
    hideInfo();
    compute();
    renderNav(); renderAccount(); renderTop();
    const v = $('#view');
    const needData = ['ringkasan', 'produk', 'biaya', 'retur'].includes(viewName) && !last;
    v.innerHTML = needData ? emptyView() : ({ ringkasan: viewRingkasan, produk: viewProduk, biaya: viewBiaya, retur: viewRetur, simulator: viewSimulator, riwayat: viewRiwayat, data: viewData }[viewName])();
    afterRender();
  }
  function afterRender() {
    if (viewName === 'ringkasan') bindTips($('#monthly'));
    if (viewName === 'produk') renderProducts();
    if (viewName === 'simulator') renderSimOut();
    if (viewName === 'data') { renderFiles(); renderCostTable(); }
    if (viewName === 'riwayat') maybeLoadReports();
  }
  function go(name, push = true) {
    if (!VIEWS.some((v) => v[0] === name)) name = 'ringkasan';
    viewName = name;
    if (push && location.hash !== `#${name}`) history.pushState(null, '', `#${name}`);
    render();
    window.scrollTo({ top: 0 });
  }

  /* ================= 5. tampilan ================= */
  const emptyView = () => `<div class="panel empty"><span class="ic">${svg('data', 24)}</span><h2>Mulai dari laporan penghasilan</h2>
    <p>Unggah Laporan Penghasilan Shopee atau TikTok Shop. Hitungan terjadi di browser Anda; file tidak dikirim ke mana pun.</p>
    <div class="row-actions" style="justify-content:center"><button class="btn primary" type="button" data-go="data">Unggah laporan</button><button class="btn" type="button" data-demo>Lihat dengan data contoh</button></div></div>`;

  /* ---------- ringkasan ---------- */
  function checklistItems() {
    const all = last.all;
    return [
      { done: true, text: 'Unggah laporan penghasilan' },
      { done: all.coverage >= 0.95, text: all.ready ? `Lengkapi modal (${pct(all.coverage, 0)} penjualan)` : 'Isi modal produk', go: 'data' },
      ...(all.qtyAssumed || all.ttNoDetail ? [{ done: false, text: 'Tambah export pesanan agar jumlah barang tepat', go: 'data' }] : []),
      { done: all.fixedMonthly > 0, text: 'Isi biaya operasional bulanan', go: 'data' },
      { done: !!(done.pdf || done.saved), text: 'Unduh laporan PDF atau simpan ke riwayat', act: 'pdf' },
    ];
  }
  function viewRingkasan() {
    const { r } = last;
    const items = demo ? [] : checklistItems();
    const nDone = items.filter((i) => i.done).length;
    const pro = isPro();
    const ins = r.insights;
    const FREE = 2;
    return `
      ${items.length && nDone < items.length ? `<section class="panel checklist"><div class="panel-head" style="margin:0"><h3>Lengkapi supaya angkanya tepat</h3><p>${nDone} dari ${items.length} selesai</p></div>
        <div class="progress" aria-hidden="true"><i style="width:${(nDone / items.length) * 100}%"></i></div>
        <ol>${items.map((i) => `<li class="${i.done ? 'done' : ''}"><span class="tick">${i.done ? '✓' : ''}</span>${i.done ? esc(i.text) : `<button type="button" ${i.go ? `data-go="${i.go}"` : 'id="pdf-check"'}>${esc(i.text)}</button>`}</li>`).join('')}</ol></section>` : ''}
      <div class="grid-nota">
        ${nota(r)}
        <div class="stack">
          ${facts(r)}
          ${ins.length ? `<section class="panel"><div class="panel-head"><h3>Temuan dan saran</h3><p>Dibuat otomatis dari data Anda</p></div>
            <ul class="insights">${ins.slice(0, pro ? 6 : FREE).map(insightItem).join('')}</ul>
            ${pro && ins.length > 6 ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:650">${ins.length - 6} temuan lainnya</summary><ul class="insights">${ins.slice(6).map(insightItem).join('')}</ul></details>` : ''}
            ${!pro && ins.length > FREE ? `<div class="locked" style="min-height:150px"><ul class="insights blur">${ins.slice(FREE, FREE + 2).map(insightItem).join('')}</ul>${lockVeil(`${ins.length - FREE} temuan lainnya`, 'Termasuk produk yang merugi dan saran tindakannya.')}</div>` : ''}
          </section>` : ''}
        </div>
      </div>
      <section class="panel chart" id="monthly">
        <div class="panel-head"><h3>Per bulan</h3>
          <div class="seg" role="group" aria-label="Ukuran">${[['margin', 'Laba'], ['sales', 'Penjualan'], ['fees', 'Potongan']].filter(([k]) => k !== 'margin' || r.ready).map(([k, l]) => `<button type="button" data-metric="${k}" aria-pressed="${view.metric === k || (view.metric === 'margin' && !r.ready && k === 'sales')}">${l}</button>`).join('')}</div></div>
        ${monthly(r)}
        <details style="margin-top:12px"><summary class="small" style="cursor:pointer;font-weight:650">Lihat tabel per bulan</summary>
          <div class="tablewrap" style="margin-top:8px"><table class="data"><thead><tr><th>Bulan</th><th>Pesanan</th><th>Penjualan</th><th>Potongan</th><th>Laba setelah modal</th><th>Margin %</th>${r.fixedMonthly ? '<th>Laba bersih</th>' : ''}</tr></thead>
          <tbody>${r.months.map((m) => `<tr><td>${monthLong(m.month)}</td><td>${num(m.total.orders)}</td><td>${fmt(m.total.sales)}</td><td class="neg">${fmt(m.total.fees)}</td>
            <td class="${m.total.margin < 0 ? 'neg' : ''}">${r.ready ? fmt(m.total.margin) : '—'}</td><td>${r.ready && m.total.knownSales ? pct(m.total.margin / m.total.knownSales) : '—'}</td>
            ${r.fixedMonthly ? `<td class="${m.total.net < 0 ? 'neg' : ''}">${r.ready ? fmt(m.total.net) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>
      </section>`;
  }
  function nota(r) {
    const lines = [];
    const L = (label, v, cls = '', note = '', key = '') => lines.push(`<div class="ln ${cls}"><dt>${label}${key ? qi(key, label) : ''}${note ? `<small>${note}</small>` : ''}</dt><dd>${fmt(v)}</dd></div>`);
    const isDrop = typeOf(st()) === 'dropship';
    L('Penjualan', r.totalSales, '', `${num(r.orders)} pesanan terjual`, 'penjualan');
    L('Potongan marketplace', r.totalFees, 'minus', `${pct(-r.totalFees / r.totalSales)} dari penjualan`, 'potongan');
    const rb = r.kepastian.risikoBarang;
    if (r.ready) {
      // Dana dari pesanan yang dikeluarkan dari laba (modal tidak diketahui), langsung dari engine. Bisa negatif.
      const unknown = r.kepastian.cakupan.dikeluarkan.danaDiterima;
      if (Math.abs(unknown) >= 1) L('Dana dari pesanan tanpa modal', -unknown, 'muted', 'tidak dihitung sampai modalnya diisi', 'tanpa_modal');
      L('Modal barang', -r.totalModal, 'minus', '', 'modal');
      if (r.knownPacking) L(isDrop ? 'Biaya dropship' : 'Packing', -r.knownPacking, 'minus', '', isDrop ? 'dropship_fee' : 'packing');
      // Kasus "tidak kembali" tanpa nilai tidak dikurangkan dan tidak ditampilkan sebagai Rp0.
      if (r.lostCertain || rb.kerugianTanpaNilai) L('Retur yang tidak kembali', r.lostCertain ? -r.lostCertain : NaN, 'minus', rb.kerugianTanpaNilai ? `${num(rb.kerugianTanpaNilai)} kasus tanpa nilai belum dikurangkan` : '', 'retur_hilang');
      if (r.fixedMonthly > 0) { L('Laba setelah modal', r.totalMargin, 'sub', '', 'margin_kotor'); L('Biaya operasional', -r.opex, 'minus', `${fmt(r.fixedMonthly)} per bulan`, 'opex'); }
    } else L('Dana diterima', r.totalReceived, 'sub', '', 'dana_diterima');
    const total = r.fixedMonthly > 0 ? r.netProfit : r.totalMargin;
    const label = r.fixedMonthly > 0 ? 'Laba bersih' : 'Laba setelah modal';
    const labelKey = r.fixedMonthly > 0 ? 'laba_bersih' : 'margin_total';
    return `<section class="nota" aria-label="Nota laba">
      <div class="nota-head"><b>Nota laba</b><span>${tgl(r.first)} sampai ${tgl(r.last)}<br>${['shopee', 'tiktok'].filter((k) => r.has[k]).map((k) => PNAME[k]).join(' dan ')}</span></div>
      <dl>${lines.join('')}</dl>
      <div class="nota-total"><span class="lbl">${label}${qi(labelKey, label)}</span>
        ${r.ready ? `<span class="big ${total < 0 ? 'neg' : ''}">${fmt(total)}</span>
          <span class="note">${r.coverage < 0.98 ? `Dari ${pct(r.coverage, 0)} penjualan yang modalnya diketahui.` : `${pct(total / r.totalSales)} dari seluruh penjualan.`}${r.unknownRisk > 0 ? ` Bisa turun ${fmt(r.unknownRisk)} bila retur yang belum dicek tidak kembali.` : ''}${rb.risikoTanpaNilai ? ` ${num(rb.risikoTanpaNilai)} kasus retur yang belum dicek belum punya nilai, jadi risikonya belum bisa dihitung.` : ''}</span>`
          : '<span class="big faint">Belum dihitung</span><span class="note">Isi modal produk agar laba bisa dihitung.</span><button class="btn sm primary" type="button" data-go="data" style="justify-self:start;margin-top:6px">Isi modal</button>'}
      </div></section>`;
  }
  function facts(r) {
    const ms = r.months.filter((m) => m.total.sales > 0);
    const a = ms[ms.length - 1], b = ms[ms.length - 2];
    const monthEnd = a ? new Date(+a.month.slice(0, 4), +a.month.slice(5), 0).toLocaleDateString('sv-SE') : '';
    const running = a && r.last < monthEnd;
    const delta = (x, y) => { if (!ok(x) || !ok(y) || !y) return ''; const d = (x - y) / Math.abs(y); return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${pct(Math.abs(d), 0)}</span>`; };
    const target = st().targetProfit;
    const hitN = ok(target) && target > 0 && r.ready ? r.months.filter((m) => (r.fixedMonthly ? m.total.net : m.total.margin) >= target).length : null;
    const key = (m) => (r.ready ? m.total.margin : m.total.sales);
    return `<div class="facts">
      <div class="fact"><span>Rata-rata per bulan${qi('rata_bulan')}</span><b class="${r.perMonth < 0 ? 'neg' : ''}">${r.ready ? fmt(r.fixedMonthly ? r.netProfit / Math.max(r.monthsSpan, 1) : r.perMonth) : '—'}</b><small>${r.fixedMonthly ? 'laba bersih' : 'laba setelah modal'}, ${(Math.round(r.monthsSpan * 10) / 10).toLocaleString('id-ID')} bulan data</small></div>
      <div class="fact"><span>Laba per pesanan${qi('margin_pesanan')}</span><b>${r.ready ? fmt(r.perOrder) : '—'}</b><small>dari ${num(r.orders)} pesanan</small></div>
      ${a && b ? `<div class="fact"><span>${monthLong(a.month)}${running ? ' (berjalan)' : ''}${qi('bulan_ini')}</span><b>${fmt(key(a))}</b><small>${r.ready ? 'laba' : 'penjualan'} ${delta(key(a), key(b))} dibanding ${monthLabel(b.month)}</small></div>
      <div class="fact"><span>Potongan ${monthLabel(a.month)}${qi('potongan_bulan')}</span><b>${pct(-a.total.fees / (a.total.sales || 1))}</b><small>${pct(-b.total.fees / (b.total.sales || 1))} di ${monthLabel(b.month)}</small></div>`
      : `<div class="fact"><span>Potongan marketplace${qi('potongan')}</span><b>${pct(-r.totalFees / r.totalSales)}</b><small>${fmt(-r.totalFees)}</small></div><div class="fact"><span>Modal diketahui${qi('modal_diketahui')}</span><b>${pct(r.coverage, 0)}</b><small>dari penjualan</small></div>`}
      ${hitN !== null ? `<div class="fact" style="grid-column:1/-1;border-right:0;border-top:1px solid var(--line)"><span>Target ${r.fixedMonthly ? 'laba bersih' : 'laba setelah modal'} ${fmt(target)} per bulan${qi('target_laba')}</span><b>${hitN} dari ${r.months.length} bulan</b><small>mencapai target</small></div>` : ''}
    </div>`;
  }
  const insightItem = (i) => `<li class="insight ${i.level}"><span class="bar" aria-hidden="true"></span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p>${i.action ? `<div class="act">${esc(i.action)}</div>` : ''}</div></li>`;
  const lockVeil = (title, body) => `<div class="veil"><div><span class="badge pro">PRO</span><b>${esc(title)}</b><span class="small muted">${esc(body)}</span>
    <button class="btn sm primary" type="button" data-upgrade>Buka dengan Pro</button></div></div>`;

  function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function monthly(r) {
    const months = r.months;
    if (!months.length) return '<p class="muted small">Tidak ada data bulanan.</p>';
    const series = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const key = view.metric === 'margin' && !r.ready ? 'sales' : view.metric;
    const get = (m, k) => (key === 'fees' ? -m[k].fees : m[k][key]);
    const W = 860, H = 270, L = 56, R = 8, T = 14, B = 30;
    const vals = months.flatMap((m) => series.map((k) => get(m, k)));
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const step = niceStep((hi - lo) / 4 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const band = (W - L - R) / months.length;
    const bw = Math.max(4, Math.min(22, (band * 0.66) / series.length - 2));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${Math.abs(v) < 1e-9 ? 'var(--line-strong)' : 'var(--line)'}"/>`;
      g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtShort(v)}</text>`;
    }
    months.forEach((m, i) => {
      const cx = L + band * i + band / 2;
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(m.month)}</text>`;
      series.forEach((k, j) => {
        const v = get(m, k);
        const x = cx - (series.length * (bw + 2)) / 2 + j * (bw + 2);
        const y0 = y(0), y1 = y(v), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0)), rr = Math.min(4, h / 2, bw / 2);
        const path = v >= 0 ? `M${x},${y0}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${y0}Z`
          : `M${x},${y0}V${top + h - rr}Q${x},${top + h} ${x + rr},${top + h}H${x + bw - rr}Q${x + bw},${top + h} ${x + bw},${top + h - rr}V${y0}Z`;
        g += `<path d="${path}" fill="var(--${k})"/><rect x="${x - 2}" y="${T}" width="${bw + 4}" height="${H - T - B}" fill="transparent" data-tip="${esc(`${PNAME[k]}, ${monthLabel(m.month)}: ${fmt(v)} dari ${m[k].orders} pesanan`)}"/>`;
      });
    });
    return `<div class="legend">${series.map((k) => `<span><i class="sw" style="background:var(--${k})"></i>${PNAME[k]}</span>`).join('')}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik per bulan">${g}</svg><div class="tip" hidden></div>`;
  }
  function bindTips(box) {
    if (!box) return;
    const tip = box.querySelector('.tip');
    box.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => { tip.textContent = el.dataset.tip; tip.hidden = false; });
      el.addEventListener('mousemove', (e) => { const b = box.getBoundingClientRect(); tip.style.left = `${e.clientX - b.left}px`; tip.style.top = `${e.clientY - b.top}px`; });
      el.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  /* ---------- produk ---------- */
  function viewProduk() {
    const { r } = last;
    if (!r.products.length) return `<div class="panel empty"><span class="ic">${svg('produk', 24)}</span><h2>Belum ada rincian produk</h2><p>Laporan penghasilan TikTok sering tidak mencantumkan produk. Unggah export pesanan TikTok atau laporan Shopee untuk melihat analisis per produk.</p><button class="btn primary" type="button" data-go="data">Unggah file</button></div>`;
    return `<section class="panel">
      <div class="chips" style="margin-bottom:14px">${['rugi', 'tipis', 'sehat', 'unknown'].map((h) => { const n = r.products.filter((p) => p.health === h).length; return n ? `<span class="chip ${h}">${{ rugi: 'Rugi', tipis: `Di bawah target ${pct(r.target, 0)}`, sehat: 'Sehat', unknown: 'Modal belum ada' }[h]}: ${n}</span>` : ''; }).join('')}</div>
      <div class="searchrow"><input class="plain" id="q" type="search" placeholder="Cari produk atau SKU" value="${esc(view.q)}" aria-label="Cari produk">
        <select class="compact" id="sort" aria-label="Urutkan">${[['margin', 'Laba terbesar'], ['margin-asc', 'Laba terkecil atau rugi'], ['pct-asc', 'Margin paling tipis'], ['sales', 'Penjualan terbesar'], ['qty', 'Paling laku']].map(([k, l]) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="product-table"></div></section>`;
  }
  function renderProducts() {
    const box = $('#product-table');
    if (!box || !last) return;
    const { r } = last;
    const q = Engine.norm(view.q);
    const val = (x) => (ok(x) ? x : -Infinity);
    const sorters = { margin: (a, b) => val(b.margin) - val(a.margin), 'margin-asc': (a, b) => (ok(a.margin) ? a.margin : Infinity) - (ok(b.margin) ? b.margin : Infinity),
      'pct-asc': (a, b) => (ok(a.pct) ? a.pct : Infinity) - (ok(b.pct) ? b.pct : Infinity), sales: (a, b) => b.sales - a.sales, qty: (a, b) => b.qty - a.qty };
    let list = r.products.filter((p) => !q || Engine.norm(`${p.name} ${p.sku} ${p.code}`).includes(q));
    if (view.sort === 'pct-asc') list = list.filter((p) => p.rows >= 3);
    list.sort(sorters[view.sort] || sorters.margin);
    const pro = isPro(), FREE = 5;
    const shown = !pro ? list.slice(0, FREE) : view.showAll ? list : list.slice(0, 20);
    const HL = { rugi: 'Rugi', tipis: 'Tipis', sehat: 'Sehat' };
    const row = (p) => `<tr><td><i class="sw" style="background:var(--${p.platform})"></i> ${esc(p.name)}${p.variant && p.variant !== 'Default' ? ` <span class="faint">${esc(p.variant)}</span>` : ''}</td>
      <td>${p.qtyKnown ? num(p.qty) : `${p.rows}×`}</td><td>${fmt(p.sales)}</td><td class="${p.margin < 0 ? 'neg' : ''}">${fmt(p.margin)}</td><td class="${p.pct < 0 ? 'neg' : ''}">${pct(p.pct)}</td>
      <td>${fmt(p.avgPrice)}</td><td>${fmt(p.breakEven)}</td><td><b>${fmt(p.targetPrice)}</b></td><td>${HL[p.health] ? `<span class="chip ${p.health}">${HL[p.health]}</span>` : '<span class="faint">—</span>'}</td></tr>`;
    const head = `<thead><tr><th>Produk</th><th>Terjual${qi('terjual')}</th><th>Penjualan</th><th>Laba${qi('margin_produk')}</th><th>Margin${qi('margin_pct')}</th><th>Harga rata-rata${qi('harga_rata')}</th><th>Harga impas${qi('harga_impas')}</th><th>Harga target${qi('harga_target')}</th><th>Status${qi('status')}</th></tr></thead>`;
    box.innerHTML = `<div class="tablewrap"><table class="data">${head}<tbody>${shown.map(row).join('') || '<tr><td colspan="9" class="muted">Tidak ada produk yang cocok.</td></tr>'}</tbody></table></div>
      ${!pro && list.length > FREE ? `<div class="locked" style="min-height:200px"><div class="tablewrap blur"><table class="data"><tbody>${list.slice(FREE, FREE + 4).map(row).join('')}</tbody></table></div>${lockVeil(`${num(list.length - FREE)} produk lainnya`, 'Lihat semua produk, status rugi atau tipis, dan harga yang disarankan.')}</div>` : ''}
      ${pro && list.length > 20 ? `<button class="btn quiet" type="button" id="show-all" style="margin-top:8px">${view.showAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${num(list.length)} produk`}</button>` : ''}
      <p class="tiny faint" style="margin-top:10px">Harga impas: harga minimum agar tidak rugi. Harga target: harga agar margin mencapai ${pct(r.target, 0)}. Tanda × berarti jumlah baris, karena jumlah barang tidak tercatat.</p>`;
  }

  /* ---------- biaya ---------- */
  const barRows = (rows, total) => {
    const max = Math.max(...rows.map((x) => Math.abs(x.v)), 1);
    return rows.map((x) => `<div class="barrow"><span>${esc(x.label)}${x.k ? qi(x.k, x.label) : ''}</span><div class="track"><i style="width:${(Math.abs(x.v) / max) * 100}%"></i></div><span class="num">${fmt(x.v)} <span class="faint">${pct(Math.abs(x.v) / total)}</span></span></div>`).join('');
  };
  function viewBiaya() {
    const { r } = last;
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const S = r.shopee, T = r.tiktok;
    return `<div class="grid-2">
      <section class="panel"><div class="panel-head"><h3>Per platform</h3></div>
        <div class="tablewrap"><table class="data"><thead><tr><th></th>${plats.map((k) => `<th>${PNAME[k]}</th>`).join('')}</tr></thead><tbody>
          <tr><td>Pesanan terjual</td>${plats.map((k) => `<td>${num(r[k].orders)}</td>`).join('')}</tr>
          <tr><td>Penjualan</td>${plats.map((k) => `<td>${fmt(r[k].sales)}</td>`).join('')}</tr>
          <tr><td>Potongan marketplace${qi('potongan')}</td>${plats.map((k) => `<td class="neg">${fmt(r[k].feeTotal)} <span class="faint">${pct(-r[k].feeTotal / r[k].sales)}</span></td>`).join('')}</tr>
          <tr><td>Dana diterima${qi('dana_diterima')}</td>${plats.map((k) => `<td>${fmt(r[k].received)}</td>`).join('')}</tr>
          <tr><td>Modal</td>${plats.map((k) => `<td class="neg">${r.ready ? fmt(-r[k].modal) : '—'}</td>`).join('')}</tr>
          ${r.totalPacking ? `<tr><td>Packing</td>${plats.map((k) => `<td class="neg">${fmt(-r[k].knownPacking)}</td>`).join('')}</tr>` : ''}
          <tr class="total"><td>Laba setelah modal</td>${plats.map((k) => `<td class="${r[k].margin < 0 ? 'neg' : ''}">${fmt(r[k].margin)} <span class="faint">${ok(r[k].margin) && r[k].knownSales ? pct(r[k].margin / r[k].knownSales) : ''}</span></td>`).join('')}</tr>
          <tr><td>Tarif efektif${qi('tarif_efektif')}</td>${plats.map((k) => { const f = r.feeModel[k]; return `<td>${f ? `${pct(f.pct)} + ${fmt(f.fixed)}<span class="faint tiny"> /pesanan</span>` : '—'}</td>`; }).join('')}</tr>
          <tr><td class="small faint">Modal diketahui</td>${plats.map((k) => `<td class="small faint">${pct(r[k].coverage, 0)}</td>`).join('')}</tr>
        </tbody></table></div>
        <div class="row-actions" style="margin-top:12px">${plats.filter((k) => r.feeModel[k]).map((k) => `<button class="btn sm" type="button" data-sim-use="${k}">Simulasikan harga dengan tarif ${PNAME[k]}</button>`).join('')}</div>
        ${r.has.tiktok ? `<p class="small muted" style="margin-top:12px">TikTok: diskon toko rata-rata ${pct(T.discount)}. ${Object.entries(T.bySource).map(([k, v]) => `${esc(k)} ${num(v.orders)} pesanan${r.ready ? ` dengan laba ${fmt(v.margin)}` : ''}`).join('; ')}.</p>` : ''}
        ${r.adjustments ? `<p class="small muted" style="margin-top:6px">Kompensasi dari platform ${fmt(r.adjustments)} ditampilkan terpisah dan tidak ditambahkan ke margin.</p>` : ''}
      </section>
      <section class="panel"><div class="panel-head"><h3>Rincian potongan</h3><p>Persen dari penjualan</p></div>
        ${r.has.shopee ? `<p class="small" style="font-weight:700;margin-bottom:4px"><i class="sw" style="background:var(--shopee)"></i> Shopee</p>${barRows([
          { label: 'Biaya administrasi', v: S.fees.admin, k: 'fee_admin' }, { label: 'Gratis Ongkir XTRA', v: S.fees.xtra, k: 'fee_xtra' }, { label: 'Biaya proses pesanan', v: S.fees.proses, k: 'fee_proses' },
          { label: 'Komisi AMS (afiliasi)', v: S.fees.ams, k: 'fee_ams' }, { label: 'Ongkir ditanggung penjual', v: S.fees.ship, k: 'fee_ship' }, { label: 'Biaya lain', v: S.fees.lain, k: 'fee_lain' }].filter((x) => Math.abs(x.v) >= 1).sort((a, b) => a.v - b.v), S.sales)}` : ''}
        ${r.has.tiktok ? `<p class="small" style="font-weight:700;margin:14px 0 4px"><i class="sw" style="background:var(--tiktok)"></i> TikTok Shop</p>${barRows([
          { label: 'Komisi platform', v: T.fees.platform, k: 'fee_platform' }, { label: 'Komisi dinamis', v: T.fees.dinamis, k: 'fee_dinamis' }, { label: 'Biaya pemrosesan', v: T.fees.proses, k: 'fee_tt_proses' },
          { label: 'Ongkir', v: T.fees.ongkir, k: 'fee_ongkir' }, { label: 'Komisi afiliasi', v: T.fees.afiliasi, k: 'fee_afiliasi' }, { label: 'Biaya lain', v: T.fees.lain, k: 'fee_lain' }].filter((x) => Math.abs(x.v) >= 1).sort((a, b) => a.v - b.v), T.sales)}` : ''}
      </section></div>
      ${r.buckets.length > 1 ? `<section class="panel"><div class="panel-head"><h3>Potongan menurut nilai pesanan${qi('potongan_nilai')}</h3><p>Biaya tetap per pesanan membuat pesanan kecil terpotong lebih besar</p></div>
        ${r.buckets.map((b) => { const p = -b.fees / b.value; const maxp = Math.max(...r.buckets.map((x) => -x.fees / x.value));
          return `<div class="barrow"><span>${esc(b.label)} <span class="faint tiny">${num(b.orders)} pesanan${r.ready && b.known ? `, laba ${fmt(b.margin / b.known)} per pesanan` : ''}</span></span><div class="track"><i style="width:${(p / maxp) * 100}%"></i></div><span class="num">${pct(p)}</span></div>`; }).join('')}
      </section>` : ''}`;
  }

  /* ---------- retur ---------- */
  function viewRetur() {
    const { r } = last;
    if (!r.cases.length) return `<div class="panel empty"><span class="ic">${svg('retur', 24)}</span><h2>Belum ada file retur</h2><p>Unggah file pengembalian Shopee atau retur TikTok untuk menandai barang yang tidak kembali. Tanpa data retur, kondisi barang setelah refund mungkin belum dapat dipastikan.</p><button class="btn primary" type="button" data-go="data">Unggah file retur</button></div>`;
    return `<section class="panel">
      <div class="chips">${r.catSummary.sort((a, b) => b.count - a.count).map((c) => `<span class="chip"><i class="sw" style="background:var(--${c.platform})"></i>${esc(catLabel(c.cat))}: ${c.count}</span>`).join('')}</div>
      <p class="small muted" style="margin-block:14px">Untuk retur dan paket bermasalah, pilih <b>Tidak kembali</b> bila barangnya tidak Anda terima lagi; modalnya akan dikurangkan dari laba. Beberapa refund terindikasi tidak dikirim menurut alasan di marketplace. Kondisi barangnya tetap perlu dipastikan.${r.unknownRisk > 0 ? ` Kasus yang belum dicek berisiko ${fmt(r.unknownRisk)}${r.kepastian.risikoBarang.risikoTanpaNilai ? `, ditambah ${num(r.kepastian.risikoBarang.risikoTanpaNilai)} kasus yang nilainya belum diketahui` : ''}.` : r.kepastian.risikoBarang.risikoTanpaNilai ? ` ${num(r.kepastian.risikoBarang.risikoTanpaNilai)} kasus yang belum dicek nilainya belum diketahui.` : ''}</p>
      <div class="row-actions" style="margin-bottom:8px">${r.cases.some((c) => !c.needsCheck) ? `<button class="btn sm quiet" type="button" id="only-check">${view.onlyCheck ? 'Tampilkan semua kasus' : 'Hanya yang perlu dicek'}</button>` : ''}</div>
      <div class="tablewrap"><table class="data"><thead><tr><th>Produk dan alasan</th><th>Resi retur</th><th>Perkiraan modal${qi('perkiraan_modal')}</th><th>Status barang${qi('status_barang')}</th></tr></thead><tbody>
      ${r.cases.filter((c) => !view.onlyCheck || c.needsCheck).sort((a, b) => (b.needsCheck - a.needsCheck) || ((b.estModal || 0) - (a.estModal || 0))).slice(0, 300).map((c) => `<tr>
        <td><i class="sw" style="background:var(--${c.platform})"></i> <b>${esc(c.product || '-')}</b>${c.variant && !/^(Default|Not Specified)$/.test(c.variant) ? ` <span class="faint">${esc(c.variant)}</span>` : ''}<br><span class="tiny faint">${esc(catLabel(c.cat))}${c.note ? `: “${esc(c.note.slice(0, 70))}”` : ''}</span></td>
        <td>${esc(c.resi || '–')}</td><td>${ok(c.estModal) ? fmt(c.estModal) : '<span class="faint small">Nilai belum diketahui</span>'}</td>
        <td>${c.needsCheck ? `<select class="compact" data-case="${esc(c.key)}" aria-label="Status barang" ${demo ? 'disabled' : ''}>${[['belum', 'Belum dicek'], ['kembali', 'Sudah kembali'], ['hilang', 'Tidak kembali']].map(([v, l]) => `<option value="${v}" ${c.state === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<span class="faint small">${c.cat === 'tidak_dikirim' ? 'Belum bisa ditandai' : 'Pengajuan batal'}</span>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada kasus yang perlu dicek.</td></tr>'}
      </tbody></table></div></section>`;
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
        <div class="fields two align">
          ${field('listPrice', 'Harga jual normal', 'Rp', sim.listPrice ?? 100000)}
          ${field('disc', 'Diskon toko', '%', sim.disc ?? 0)}
          ${field('cost', `${(TYPES[typeOf(s)] || { cost: 'Modal' }).cost} per unit`, 'Rp', sim.cost ?? 60000, 'modal')}
          ${field('packing', typeOf(s) === 'dropship' ? 'Biaya dropship per pesanan' : 'Packing per pesanan', 'Rp', ok(sim.packing) ? sim.packing : (ok(s.packing) ? s.packing : 0), typeOf(s) === 'dropship' ? 'dropship_fee' : 'packing_in')}
          ${field('feePct', 'Potongan persen', '%', ok(sim.feePct) ? sim.feePct : f.pct, '', 'Terisi dari sumber di atas; boleh diubah.')}
          ${field('feeFixed', 'Biaya tetap per pesanan', 'Rp', ok(sim.feeFixed) ? sim.feeFixed : f.fixed, '', 'Biaya proses pesanan dan sejenisnya.')}
        </div>
      </div><div class="sim-out" id="sim-out"></div></div></section>`;
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
    const parts = [['Modal', res.cost, 'var(--ink-2)'], ['Potongan', res.fees, 'var(--cost)'], [typeOf(s) === 'dropship' ? 'Dropship' : 'Packing', res.packing, 'var(--mark)'], ['Laba', Math.max(res.margin, 0), 'var(--accent)']].filter((p) => p[1] > 0);
    const tot = parts.reduce((a, p) => a + p[1], 0);
    box.innerHTML = `<span class="small muted">Laba per unit${qi('sim_margin')}</span>
      <span class="sim-big ${res.margin < 0 ? 'neg' : ''}">${fmt(res.margin)} <span class="small faint">${pct(res.marginPct)}</span></span>
      <div class="bar-stack" role="img" aria-label="Pembagian harga jual">${parts.map(([l, v, c]) => `<div title="${l}: ${fmt(v)}" style="flex:${v / tot};background:${c}"></div>`).join('')}</div>
      <div class="legend">${parts.map(([l, v, c]) => `<span><i class="sw" style="background:${c}"></i>${l} ${fmt(v)}</span>`).join('')}</div>
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
      <div class="row-actions" style="justify-content:center"><a class="btn primary" href="akun.html?mode=daftar&next=dashboard.html%23riwayat">Daftar gratis</a><a class="btn" href="akun.html?next=dashboard.html%23riwayat">Masuk</a></div></div>`;
    if (!account.reports) return '<p class="muted">Memuat riwayat…</p>';
    const reps = account.reports;
    const cur = last && last.r && !demo ? snapshot(last.r) : null;
    const cmp = view.compare && reps.find((x) => x.id === view.compare);
    if (!reps.length) return `<div class="panel empty"><span class="ic">${svg('riwayat', 24)}</span><h2>Belum ada riwayat</h2><p>Setelah melihat hasil, klik <b>Simpan ke riwayat</b> di bagian atas. Simpan setiap bulan untuk melihat perkembangan toko.</p>${cur ? '<button class="btn primary" type="button" id="save-hist">Simpan hasil sekarang</button>' : '<button class="btn primary" type="button" data-go="data">Unggah laporan</button>'}</div>`;
    return `<div class="hist">${reps.map((x) => { const s = x.summary || {}; return `<div class="hist-row">
        <div><b>${esc(x.title || 'Tanpa judul')}</b><span class="k">${tgl(s.first)} sampai ${tgl(s.last)}, disimpan ${tgl(x.created_at)}</span></div>
        <div><span class="k">Penjualan</span><b>${fmt(s.sales)}</b></div><div><span class="k">Laba setelah modal</span><b class="${s.margin < 0 ? 'neg' : ''}">${fmt(s.margin)}</b></div>
        <div><span class="k">Laba bersih</span><b class="${s.net < 0 ? 'neg' : ''}">${s.opex ? fmt(s.net) : '—'}</b></div>
        <div class="row-actions">${cur ? `<button class="btn sm" type="button" data-compare="${esc(x.id)}">${view.compare === x.id ? 'Tutup' : 'Bandingkan'}</button>` : ''}<button class="btn sm quiet danger" type="button" data-del-report="${esc(x.id)}" aria-label="Hapus ${esc(x.title)}">Hapus</button></div></div>`; }).join('')}</div>
      ${!isPro() ? `<p class="small muted">Akun gratis menyimpan ${FREE_HIST} riwayat; Pro tanpa batas.</p>` : ''}
      ${!cur ? '<p class="small muted">Buka laporan Anda di Data &amp; modal untuk membandingkannya dengan riwayat.</p>' : ''}
      ${cmp && cur ? compareTable(cmp, cur) : ''}`;
  }
  function compareTable(saved, cur) {
    const s = saved.summary || {};
    const rows = [['Pesanan', s.orders, cur.orders, 'n'], ['Penjualan', s.sales, cur.sales], ['Potongan marketplace', s.feePct, cur.feePct, 'p', true], ['Laba setelah modal', s.margin, cur.margin], ['Laba bersih', s.opex ? s.net : null, cur.opex ? cur.net : null], ['Modal diketahui', s.coverage, cur.coverage, 'p']];
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
  function viewData() {
    const s = st();
    const r = last && last.all;
    const dis = demo ? 'disabled' : '';
    const type = demo ? 'stok' : typeOf(s);
    const isDrop = type === 'dropship';
    return `
      ${demo ? '<p class="note-box warn">Mode contoh memakai data dan modal Toko Contoh Sejahtera. Unggah file Anda untuk mulai; data contoh akan diganti.</p>' : ''}
      ${!demo && (!type || view.typeOpen) ? typePicker(type) : ''}
      <div class="grid-2" style="align-items:start">
        <section class="stack">
          <div class="drop" id="drop"><span class="ic">${svg('data', 22)}</span><strong>Tarik file laporan ke sini</strong>
            <label class="btn primary" for="file-input">Pilih file</label><input id="file-input" type="file" multiple accept=".xlsx,.xls,.csv" hidden>
            <span class="tiny faint">.xlsx, .xls, atau .csv. Boleh banyak sekaligus; file yang sama tidak dihitung dua kali.</span></div>
          <ul class="files" id="file-list"></ul>
          ${files.length ? '<div><button class="btn sm quiet" type="button" id="clear-btn">Hapus semua file</button></div>' : ''}
          <details class="panel" ${files.length ? '' : 'open'}><summary style="cursor:pointer;font-weight:700">File apa yang perlu diunduh?</summary>
            <div style="display:grid;gap:12px;margin-top:12px" class="small">
              <p><b>Wajib.</b> Laporan Penghasilan. Shopee: Keuangan, Penghasilan Saya, tab Sudah Dilepas, Unduh. TikTok Shop: Keuangan, Transaksi, Unduh (pesanan Tokopedia ikut di sini).</p>
              <p><b>Disarankan.</b> Export pesanan untuk jumlah barang dan SKU. Shopee: Pesanan Saya, Export. TikTok: Pesanan, Kelola pesanan, Ekspor.</p>
              <p><b>Opsional.</b> File retur atau pengembalian, dan template modal yang sudah diisi.</p>
              <p class="faint">Unduh untuk periode yang sama di semua laporan. Nama menu bisa sedikit berubah dari waktu ke waktu.</p></div></details>
        </section>
        <section class="panel modal-panel">
          <div class="panel-head" style="margin:0"><h3>${type === 'produsen' ? 'Modal produksi (HPP)' : 'Modal barang'}${qi('modal')}</h3>${r && r.totalSales ? `<span class="badge ${r.coverage >= 0.98 ? 'ok' : 'todo'}">${r.coverage >= 0.98 ? 'Lengkap' : `${pct(r.coverage, 0)} penjualan`}</span>` : ''}</div>
          ${type ? `<div class="type-chip"><span class="ic">${typeIcon(type, 16)}</span><span>${TYPES[type].label}</span>${demo ? '' : '<button class="btn link" type="button" data-type-open>Ubah</button>'}</div>` : ''}
          <p class="small muted">Laporan marketplace tidak berisi harga beli Anda. Pesanan tanpa modal tidak dihitung dalam laba, bukan dianggap nol.</p>
          ${modalBody(s, r, dis, type)}
        </section>
      </div>
      <section class="panel" style="display:grid;gap:16px">
        <div class="panel-head" style="margin:0"><h3>Biaya lain dan target</h3><p>Mengubah margin menjadi laba bersih</p></div>
        <div class="fields align">
          <div class="field"><label for="s-packing">${isDrop ? 'Biaya dropship per pesanan' : 'Packing per pesanan'}${qi(isDrop ? 'dropship_fee' : 'packing_in')}</label><div class="input"><span>Rp</span><input id="s-packing" type="number" min="0" step="100" inputmode="numeric" placeholder="2000" value="${ok(s.packing) && s.packing > 0 ? s.packing : ''}" ${dis}></div><span class="hint">${isDrop ? 'Packing atau jasa yang ditagih supplier per pesanan.' : 'Plastik, bubble wrap, lakban.'}</span></div>
          <div class="field"><label for="s-target">Target margin per produk${qi('target_margin')}</label><div class="input"><input id="s-target" type="number" min="0" max="80" step="1" inputmode="decimal" value="${ok(s.targetMargin) ? s.targetMargin : 15}" ${dis}><span>% dari harga</span></div><span class="hint">Untuk status produk dan harga target.</span></div>
          <div class="field"><label for="s-tprofit">Target laba per bulan${qi('target_laba_in')}</label><div class="input"><span>Rp</span><input id="s-tprofit" type="number" min="0" step="100000" inputmode="numeric" placeholder="5000000" value="${ok(s.targetProfit) ? s.targetProfit : ''}" ${dis}></div><span class="hint">Ditampilkan di ringkasan.</span></div>
        </div>
        <div class="field"><span class="label">Biaya operasional per bulan${qi('opex_in')}</span>
          <div class="costs-list">${(s.fixedCosts || []).map((c, i) => `<div class="cost-row"><input class="plain" id="fc-label-${i}" value="${esc(c.label)}" placeholder="Misalnya gaji admin" aria-label="Nama biaya ${i + 1}" ${dis}>
            <div class="input"><span>Rp</span><input id="fc-amount-${i}" type="number" min="0" step="10000" value="${ok(c.amount) ? c.amount : ''}" aria-label="Jumlah biaya ${i + 1}" ${dis}></div>
            ${demo ? '<span></span>' : `<button class="x" type="button" data-fc-del="${i}" aria-label="Hapus biaya ${i + 1}">×</button>`}</div>`).join('')}</div>
          ${demo ? '' : `<div><button class="btn sm quiet" type="button" id="fc-add">+ Tambah biaya: gaji, sewa, iklan${type === 'produsen' ? ', sewa dapur/alat' : ''}</button></div>`}</div>
      </section>
      <section class="panel" style="display:grid;gap:16px">
        <div class="panel-head" style="margin:0"><h3>Identitas laporan</h3><p>Tampil di sampul laporan PDF</p></div>
        <div class="fields">
          <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(prof().store)}" placeholder="Toko Sejahtera" ${dis}></div>
          <div class="field"><label for="pf-owner">Disusun oleh atau untuk</label><input class="plain" id="pf-owner" value="${esc(prof().owner)}" placeholder="Untuk: Bapak Andi" ${dis}></div>
          <div class="field"><span class="label">Logo</span><div class="row-actions">${prof().logo ? `<img src="${esc(prof().logo)}" alt="Logo toko" style="height:38px;max-width:120px;object-fit:contain;border-radius:6px">` : ''}
            <label class="btn sm" for="pf-logo" ${demo ? 'hidden' : ''}>${prof().logo ? 'Ganti' : 'Pilih gambar'}</label><input id="pf-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden>
            ${prof().logo && !demo ? '<button class="btn sm quiet" type="button" id="pf-logo-del">Hapus</button>' : ''}</div></div>
        </div>
      </section>`;
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
      ${hasData ? `<details ${missing && missing <= 40 ? 'open' : ''}><summary class="small" style="cursor:pointer;font-weight:700">Isi ${lower(word)} per unit langsung di sini</summary>
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
    const sell = 100 * (1 + (p.markup || 0) / 100) * (1 - (p.disc || 0) / 100), cost = 100 - (s.mitra || 0);
    return `<p class="small muted">Untuk reseller yang membeli dengan potongan dari harga acuan pemasok, misalnya harga sampul buku atau harga katalog distributor.</p>
      <div class="fields two align">
        <div class="field"><label for="s-mitra">Diskon dari pemasok${qi('diskon_pemasok')}</label><div class="input ${!ready && files.length ? 'need' : ''}"><input id="s-mitra" type="number" min="0" max="99" step="0.5" inputmode="decimal" placeholder="30" value="${ready ? s.mitra : ''}" ${dis}><span>%</span></div><span class="hint">Harga beli = harga acuan − diskon ini.</span></div>
        <div class="field"><label for="s-coret">Harga coret di TikTok${qi('harga_coret')}</label><div class="input"><input id="s-coret" type="number" min="1" step="1" value="${s.coret || 100}" ${dis}><span>% dari acuan</span></div><span class="hint">100% bila harga coret sama dengan harga acuan.</span></div></div>
      <div class="subsec"><div class="subsec-head"><b>Pola harga di Shopee${qi('pola_shopee')}</b><span class="tiny faint">Shopee tidak mencatat harga sebelum diskon</span></div>
        <div class="periods"><div class="period period-head"><span>Mulai tanggal pesanan</span><span>Kenaikan dari acuan</span><span>Diskon toko</span><span></span></div>
        ${s.periods.map((q, i) => `<div class="period"><div class="input"><input type="date" id="p-start-${i}" value="${esc(q.start)}" aria-label="Mulai periode ${i + 1}" ${dis}></div>
          <div class="input"><input type="number" id="p-markup-${i}" step="0.5" value="${q.markup}" aria-label="Kenaikan dari harga acuan periode ${i + 1}" ${dis}><span>%</span></div>
          <div class="input"><input type="number" id="p-disc-${i}" step="0.5" min="0" max="99" value="${q.disc}" aria-label="Diskon toko periode ${i + 1}" ${dis}><span>%</span></div>
          ${s.periods.length > 1 && !demo ? `<button class="x" type="button" data-del="${i}" aria-label="Hapus periode ${i + 1}">×</button>` : '<span></span>'}</div>`).join('')}</div>
        ${demo ? '' : '<div><button class="btn sm quiet" type="button" id="add-period">+ Tambah periode harga</button></div>'}</div>
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
      ['4. Simpan, lalu unggah file ini di Cek Profit, halaman Data & modal.']]), 'Petunjuk');
    XLSX.writeFile(wb, 'template-modal-cekprofit.xlsx');
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
        const parsed = Engine.parseWorkbook({ name: file.name, sheets: Engine.sheetsFromSheetJS(XLSX, wbx) });
        resolve({ name: file.name, kind: parsed.kind, parsed });
      } catch (err) { resolve({ name: file.name, kind: 'unknown', error: err.message || 'File tidak bisa dibaca.' }); }
    };
    reader.onerror = () => resolve({ name: file.name, kind: 'unknown', error: 'File tidak bisa dibaca.' });
    if (isCsv) reader.readAsText(file, 'utf-8'); else reader.readAsArrayBuffer(file);
  });
  async function addFiles(list) {
    if (!list || !list.length) return;
    if (demo) { demo = false; files = []; resetView(); }
    const fl = $('#file-list'); if (fl) fl.insertAdjacentHTML('beforeend', `<li class="file small muted">Membaca ${list.length} file…</li>`);
    const results = await Promise.all([...list].map(readFile));
    for (const f of results) if (f.parsed && f.parsed.kind === 'modal_template') { mergeCatalog(f.parsed.entries); f.note = `${num(f.parsed.entries.length)} modal produk dimuat`; toast(f.note); }
    const hadIncome = !!last;
    files.push(...results);
    track('unggah-file');
    render();
    if (!hadIncome && last) toast(last.all.ready ? 'Laporan terbaca. Buka Ringkasan untuk melihat hasil.' : 'Laporan terbaca. Langkah berikutnya: isi modal barang.');
  }
  function fileStatus(f) {
    if (f.error) return `<span class="bad">${esc(f.error)}</span>`;
    if (f.note) return `<span class="ok">${esc(f.note)}</span>`;
    const p = f.parsed;
    if (p.kind === 'shopee_income' || p.kind === 'tiktok_income') {
      const ref = p.kind === 'shopee_income' ? p.check.summaryTotal : p.check.reportSettle;
      const n = p.kind === 'shopee_income' ? `${num(p.orders.length)} pesanan` : `${num(p.rows.length)} transaksi`;
      const chk = ref === null ? '<span class="warn">Ringkasan tidak ditemukan, total tidak bisa dicocokkan</span>'
        : Math.abs(ref - p.check.sum) <= 1 ? `<span class="ok">Cocok dengan ringkasan resmi (${fmt(p.check.sum)})</span>` : `<span class="warn">Selisih ${fmt(p.check.sum - ref)} dengan ringkasan resmi</span>`;
      return `${n}${p.check.from ? `, ${tgl(p.check.from)} sampai ${tgl(p.check.to)}` : ''}<br>${chk}`;
    }
    if (p.kind === 'shopee_orders' || p.kind === 'tiktok_orders') return `${num(p.lines.length)} baris produk`;
    if (p.kind === 'shopee_return' || p.kind === 'tiktok_return') return `${p.cases.length} pengajuan retur atau refund`;
    if (p.kind === 'shopee_balance') return 'Tidak diperlukan. Gunakan Laporan Penghasilan.';
    return '<span class="bad">Format belum dikenali. Lihat daftar file yang dibaca.</span>';
  }
  function renderFiles() {
    const el = $('#file-list');
    if (!el) return;
    const list = demo ? CekDemo.make().map((wb) => ({ name: wb.name, demo: true, kind: Engine.detect(wb) })) : files;
    el.innerHTML = list.map((f, i) => {
      const [cls, label] = KIND[f.kind] || KIND.unknown;
      return `<li class="file"><i class="dot ${cls}"></i><div><div class="name">${esc(f.name)}</div><div class="muted">${label}${f.demo ? ', data contoh' : `. ${fileStatus(f)}`}</div></div>
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
  const resetView = () => Object.assign(view, { platform: 'all', from: '', to: '', showAll: false, q: '', costQ: '', costAll: false, compare: null });

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
  const PLANS = () => { const p = C.prices || {}; return [['pro_bulanan', 'Pro bulanan', `${p.pro || ''} ${p.proUnit || ''}`.trim()], ['pro_tahunan', 'Pro tahunan', (p.proNote || '').replace(/^atau\s+/i, '')]]; };
  const waLink = (msg) => (C.whatsapp ? `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(msg)}` : '');
  const dHead = (t, s) => `<div class="d-head"><div><h2 style="font-size:22px">${t}</h2>${s ? `<p class="small muted" style="margin-top:4px">${s}</p>` : ''}</div><button class="x" type="button" data-close aria-label="Tutup">×</button></div>`;
  async function openUpgrade() {
    track('buka-upgrade');
    const d = dlg();
    const p = account.profile;
    let pending = null;
    if (account.user && !isPro()) { try { pending = (await cloud.db.myRequests()).find((x) => x.status === 'baru' || x.status === 'diproses'); } catch (e) { /* abaikan */ } }
    if (isPro() && !demo) {
      d.innerHTML = `${dHead('Pro aktif', CekCloud.isPro(p) ? `Sampai ${tgl(p.pro_until)}` : license.ok ? `Kode atas nama ${esc(license.name || '-')}${license.exp ? `, sampai ${tgl(license.exp)}` : ''}` : '')}
        <div class="d-body"><ul class="benefits"><li>Laporan PDF dengan nama dan logo toko</li><li>Analisis semua produk dan saran harga</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
        ${license.ok ? '<button class="btn quiet" type="button" id="code-remove">Hapus kode dari browser ini</button>' : ''}</div>`;
    } else {
      const codeBlock = `<details><summary class="small" style="cursor:pointer;font-weight:650">Punya kode akses?</summary><div style="display:grid;gap:8px;margin-top:10px">
        <textarea class="plain code" id="code-input" placeholder="Tempel kode yang diawali CP1." spellcheck="false"></textarea><span class="tiny" id="code-msg">${license.error ? `<span class="bad">${esc(license.error)}</span>` : ''}</span>
        <button class="btn" type="button" id="code-apply">Aktifkan kode</button></div></details>`;
      let action;
      if (pending) action = `<p class="note-box">Permintaan <b>${pending.plan === 'pro_tahunan' ? 'Pro tahunan' : 'Pro bulanan'}</b> tercatat ${tgl(pending.created_at)} dan sedang diproses. Pro aktif setelah pembayaran dikonfirmasi.</p>
        ${C.whatsapp ? `<a class="btn primary" href="${esc(waLink(`${C.waMessage} Email akun: ${account.user.email}. Paket: ${pending.plan === 'pro_tahunan' ? 'Pro tahunan' : 'Pro bulanan'}.`))}" target="_blank" rel="noopener">Kirim bukti bayar lewat WhatsApp</a>` : ''}`;
      else if (cloud.enabled && !account.user) action = '<a class="btn primary" href="akun.html?mode=daftar&next=dashboard.html%23upgrade">Daftar atau masuk untuk berlangganan</a>';
      else if (cloud.enabled) action = '<button class="btn primary" type="button" id="req-upgrade">Lanjut ke pembayaran</button><p class="tiny faint">Kami catat permintaan Anda, lalu Anda membayar lewat transfer atau QRIS melalui WhatsApp. Pro aktif di akun ini setelah dikonfirmasi.</p>';
      else action = C.whatsapp ? `<a class="btn primary" href="${esc(waLink(C.waMessage))}" target="_blank" rel="noopener" data-track="beli-wa">Pesan lewat WhatsApp</a>` : '<p class="small warn">Kontak pembelian belum diatur.</p>';
      d.innerHTML = `${dHead('Cek Profit Pro', 'Untuk keputusan harga dan produk yang berbasis angka.')}
        <div class="d-body"><ul class="benefits"><li>Laporan PDF siap kirim, dengan nama dan logo toko</li><li>Semua produk dengan status rugi, tipis, atau sehat</li><li>Harga impas dan harga target per produk</li><li>Semua temuan, ekspor Excel, riwayat tanpa batas</li></ul>
        ${pending ? '' : `<div class="plans">${PLANS().map(([k, l, pr], i) => `<label class="plan-opt"><input type="radio" name="plan" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${l}</b></span><span class="p">${esc(pr)}</span></label>`).join('')}</div>`}
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cek Profit', prof().store || ''], ['Periode data', `${r.first} s.d. ${r.last}`], [], ['Komponen', ...plats.map((k) => PNAME[k]), 'Total'],
      ['Pesanan terjual', ...plats.map((k) => r[k].orders), r.orders], ['Penjualan', ...plats.map((k) => R(r[k].sales)), R(r.totalSales)],
      ['Potongan marketplace', ...plats.map((k) => R(r[k].feeTotal)), R(r.totalFees)], ['Dana diterima', ...plats.map((k) => R(r[k].received)), R(r.totalReceived)],
      ['Modal', ...plats.map((k) => R(-r[k].modal)), R(-r.totalModal)], ['Packing', ...plats.map((k) => R(-r[k].knownPacking)), R(-r.knownPacking)],
      ['Retur tidak kembali', ...plats.map(() => ''), R(-r.lostCertain)],
      ...(r.kepastian.risikoBarang.kerugianTanpaNilai ? [['Kasus retur tidak kembali tanpa nilai (belum dikurangkan)', ...plats.map(() => ''), r.kepastian.risikoBarang.kerugianTanpaNilai]] : []),
      ['Laba setelah modal', ...plats.map((k) => R(r[k].margin)), R(r.totalMargin)],
      ['Biaya operasional', ...plats.map(() => ''), R(-r.opex)], ['Laba bersih', ...plats.map(() => ''), R(r.netProfit)],
      ['Porsi penjualan dengan modal diketahui (%)', ...plats.map((k) => +(r[k].coverage * 100).toFixed(1)), +(r.coverage * 100).toFixed(1)]]), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bulan pesanan', 'Pesanan', 'Penjualan', 'Potongan', 'Dana diterima', 'Laba setelah modal', 'Laba bersih', ...plats.flatMap((k) => [`Penjualan ${PNAME[k]}`, `Laba setelah modal ${PNAME[k]}`])],
      ...r.months.map((m) => [m.month, m.total.orders, R(m.total.sales), R(m.total.fees), R(m.total.received), R(m.total.margin), R(m.total.net), ...plats.flatMap((k) => [R(m[k].sales), R(m[k].margin)])])]), 'Per bulan');
    if (r.products.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'Kode', 'Produk', 'Terjual', 'Penjualan', 'Dana diterima', 'Modal', 'Laba', 'Margin %', 'Modal per unit', 'Harga rata-rata', 'Harga impas', 'Harga target', 'Status'],
      ...[...r.products].sort((a, b) => (ok(b.margin) ? b.margin : -1e15) - (ok(a.margin) ? a.margin : -1e15)).map((p) => [PNAME[p.platform], catKey(p), p.name, p.qtyKnown ? Math.round(p.qty) : '', R(p.sales), R(p.received), R(p.modal), R(p.margin), ok(p.pct) ? +(p.pct * 100).toFixed(1) : '', R(p.unitCost), R(p.avgPrice), R(p.breakEven), R(p.targetPrice), p.health])]), 'Produk');
    if (r.insights.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tingkat', 'Temuan', 'Rincian', 'Saran'], ...r.insights.map((i) => [i.level, i.title, i.detail, i.action])]), 'Temuan');
    if (r.cases.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'No. pesanan', 'Produk', 'Kategori', 'Alasan', 'Resi retur', 'Nilai refund', 'Perkiraan modal', 'Status barang'],
      ...r.cases.map((c) => [PNAME[c.platform], c.orderId, c.product, Engine.CAT_LABEL[c.cat], c.reason, c.resi, R(c.amount), R(c.estModal), c.needsCheck ? c.state : 'tidak perlu'])]), 'Retur');
    XLSX.writeFile(wb, `cek-profit-${(prof().store || 'toko').replace(/[^\w-]+/g, '-')}-${r.first || ''}-${r.last || ''}.xlsx`);
    track('unduh-excel');
  }
  function buildReport() {
    if (!last) return false;
    $('#report').innerHTML = CekReport.html(last.r, { settings: last.st, profile: prof(), demo, filter: { ...view }, brand: C.brand || 'Cek Profit' });
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
    else if (t.id === 'from') { view.from = t.value; render(); }
    else if (t.id === 'to') { view.to = t.value; render(); }
    else if (t.id === 'sort') { view.sort = t.value; renderProducts(); }
    else if (t.id === 'simx-status' || t.id === 'simx-kat') { sim[t.id.slice(5)] = t.value; resetSimFee(); render(); }
    else if (t.id === 'simx-aff') { sim.afiliasi = Math.min(50, Math.max(0, +t.value || 0)); resetSimFee(); render(); }
    else if (t.dataset.simOpsi) { const k = t.dataset.simOpsi; sim.opsi = t.checked ? [...new Set([...sim.opsi, k])] : sim.opsi.filter((x) => x !== k); resetSimFee(); render(); }
    else if (t.id === 'file-input' || t.id === 'tpl-input') { addFiles(t.files); t.value = ''; }
    else if (t.id === 'pf-logo' && t.files[0]) {
      const f = t.files[0];
      if (f.size > 400000) { toast('Logo maksimal 400 KB.'); t.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { profile.logo = rd.result; saveProfile(); render(); };
      rd.readAsDataURL(f); t.value = '';
    }
  });
  document.addEventListener('click', async (e) => {
    const qb = e.target.closest('[data-info]');
    if (qb) { e.preventDefault(); showInfo(qb); return; }
    if (e.target.closest('[data-info-close]') || !e.target.closest('#info-pop')) hideInfo();
    if (e.target.closest('#info-pop')) return;
    const t = e.target.closest('button, a[data-track]');
    if (!t) { if (account.menu && !e.target.closest('.menu')) { account.menu = false; renderAccount(); } return; }
    if (t.dataset.track) { track(t.dataset.track); return; }
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.hasAttribute('data-upgrade')) { account.menu = false; renderAccount(); openUpgrade(); return; }
    if (t.dataset.close !== undefined) { dlg().close(); return; }
    if (t.id === 'acct-toggle') { account.menu = !account.menu; renderAccount(); return; }
    if (t.id === 'logout') { await cloud.auth.signOut(); account.user = null; account.profile = null; account.reports = null; account.menu = false; toast('Anda sudah keluar.'); render(); return; }
    if (t.id === 'code-apply') {
      const res = await checkLicense($('#code-input').value, false);
      if (res.ok) { dlg().close(); toast(`Pro aktif${res.name ? ` atas nama ${res.name}` : ''}.`); track('kode-aktif'); render(); }
      else $('#code-msg').innerHTML = `<span class="bad">${esc(res.reason)}</span>`;
      return;
    }
    if (t.id === 'code-remove') { store.del(KEYS.license); license = { ok: false }; dlg().close(); render(); return; }
    if (t.id === 'req-upgrade') {
      const plan = (document.querySelector('input[name="plan"]:checked') || {}).value || 'pro_bulanan';
      t.disabled = true;
      try {
        await cloud.db.requestUpgrade(plan, '');
        track('minta-upgrade');
        if (C.whatsapp) window.open(waLink(`${C.waMessage} Email akun: ${account.user.email}. Paket: ${plan === 'pro_tahunan' ? 'Pro tahunan' : 'Pro bulanan'}.`), '_blank', 'noopener');
        openUpgrade();
      } catch (err) { toast(err.message); t.disabled = false; }
      return;
    }
    if (t.id === 'hist-confirm') {
      t.disabled = true;
      try {
        const r = last.r;
        const row = await cloud.db.addReport({ title: $('#hist-title').value.trim() || 'Tanpa judul', period_from: r.first || null, period_to: r.last || null, summary: snapshot(r) });
        account.reports = [row, ...(account.reports || [])];
        markDone('saved'); dlg().close(); toast('Tersimpan di riwayat.'); track('simpan-riwayat'); render();
      } catch (err) { toast(err.message); t.disabled = false; }
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
    else if (t.id === 'pdf' || t.id === 'pdf-check') openReport();
    else if (t.id === 'save-hist') saveHistory();
    else if (t.id === 'wipe-btn') {
      if (!confirm('Hapus modal produk, pengaturan, profil laporan, status retur, dan kode akses yang tersimpan di browser ini? Data di akun tidak ikut terhapus.')) return;
      Object.values(KEYS).forEach((k) => store.del(k)); store.del('cekprofit.v2');
      settings = structuredClone(DEFAULTS); profile = { store: '', owner: '', logo: '' }; caseState = {}; license = { ok: false }; done = {};
      render(); toast('Data di browser ini sudah dihapus.');
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideInfo(); });
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
