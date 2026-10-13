/* Cek Profit — logika halaman aplikasi.
 * Bergantung pada: CEK_CONFIG (config.js), XLSX (vendor), Engine, CekDemo, CekLicense, CekReport.
 * Semua file diolah di browser. Yang disimpan di localStorage hanya pengaturan, modal produk, profil toko, dan kode akses.
 */
(() => {
  const C = window.CEK_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const fmt = (v) => (ok(v) ? (Math.round(v) < 0 ? '−Rp' : 'Rp') + Math.abs(Math.round(v)).toLocaleString('id-ID') : '—');
  const fmtShort = (v) => { if (!ok(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`; if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)} rb`; return `${s}${Math.round(a)}`; };
  const pct = (v, d = 1) => (ok(v) ? `${(Math.abs(v) < 0.0005 ? 0 : v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthLabel = (k) => { const [y, mm] = k.split('-'); return `${MONTHS[+mm - 1]} ${y.slice(2)}`; };
  const PNAME = { shopee: 'Shopee', tiktok: 'TikTok Shop' };
  const KIND = {
    shopee_income: ['shopee', 'Shopee · Penghasilan'], shopee_return: ['shopee', 'Shopee · Retur'], shopee_orders: ['shopee', 'Shopee · Export pesanan'],
    tiktok_income: ['tiktok', 'TikTok · Penghasilan'], tiktok_return: ['tiktok', 'TikTok · Retur'], tiktok_orders: ['tiktok', 'TikTok · Export pesanan'],
    modal_template: ['modal', 'Template modal'], shopee_balance: ['', 'Shopee · Saldo (tidak diperlukan)'], unknown: ['bad', 'Belum dikenali'],
  };
  const track = (e) => { try { window.cekTrack && window.cekTrack(e); } catch (err) { /* abaikan */ } };
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3600); };

  /* ---------- penyimpanan (aman jika diblokir browser) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };
  const KEYS = { settings: 'cekprofit.v3', profile: 'cekprofit.profile', license: 'cekprofit.license', cases: 'cekprofit.cases' };
  const DEFAULTS = { modalMode: 'produk', catalog: [], fallbackPct: null, mitra: null, coret: 100, periods: [{ start: '', markup: 0, disc: 0 }],
    packing: null, targetMargin: 15, fixedCosts: [] };
  function loadSettings() {
    const s = store.get(KEYS.settings, null);
    if (s && Array.isArray(s.periods)) return { ...structuredClone(DEFAULTS), ...s };
    const old = store.get('cekprofit.v2', null);      // migrasi dari versi sebelumnya
    if (old && Array.isArray(old.periods)) return { ...structuredClone(DEFAULTS), ...old, modalMode: ok(old.mitra) ? 'acuan' : 'produk' };
    return structuredClone(DEFAULTS);
  }
  let settings = loadSettings();
  let profile = { store: '', owner: '', logo: '', ...store.get(KEYS.profile, {}) };
  let caseState = store.get(KEYS.cases, {});
  const save = () => store.set(KEYS.settings, settings);
  const saveProfile = () => { if (!store.set(KEYS.profile, profile)) toast('Logo terlalu besar untuk disimpan di browser ini.'); };

  /* ---------- status ---------- */
  let files = [];
  let demo = false;
  let license = { ok: false };
  let last = null;           // { r, all, st, parsed }
  const view = { platform: 'all', from: '', to: '', metric: 'margin', q: '', sort: 'margin', showAll: false, onlyCheck: true, costQ: '', costAll: false };
  let sim = { listPrice: null, disc: null, cost: null, feePct: null, feeFixed: 1250 };

  const isPro = () => demo || license.ok;
  const st = () => (demo ? CekDemo.settings() : settings);
  const prof = () => (demo ? CekDemo.profile() : profile);
  const cases = () => (demo ? {} : caseState);
  const parsedAll = () => (demo ? CekDemo.make().map((wb) => Engine.parseWorkbook(wb)) : files.filter((f) => f.parsed && f.parsed.kind !== 'modal_template').map((f) => f.parsed));

  /* ---------- kode akses ---------- */
  async function checkLicense(code, quiet) {
    const res = await CekLicense.verify(code, C.publicKey);
    if (res.ok) { license = { ok: true, name: res.name, exp: res.exp, code }; store.set(KEYS.license, code); }
    else if (!quiet) license = { ok: false, error: res.reason };
    else license = { ok: false };
    renderProBtn();
    return res;
  }
  function renderProBtn() {
    $('#pro-label').textContent = license.ok ? (license.name ? `Pro · ${license.name}` : 'Pro aktif') : 'Masukkan kode';
    $('#pro-pill').textContent = license.ok ? '✓ PRO' : 'PRO';
  }
  const waLink = (msg) => (C.whatsapp ? `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(msg)}` : '');
  function openPro(reason = '') {
    const d = $('#pro-dialog');
    const p = C.prices || {};
    const wa = waLink(C.waMessage || 'Halo, saya ingin membeli kode akses Cek Profit Pro.');
    d.innerHTML = `<div class="head" style="position:relative">
        <button class="x close" type="button" data-close aria-label="Tutup">×</button>
        <span class="eyebrow" style="color:inherit;opacity:.85">Cek Profit Pro</span>
        <h2 id="h-pro" style="font-size:24px">${license.ok ? 'Pro aktif di browser ini' : esc(reason || 'Buka laporan lengkap toko Anda')}</h2>
      </div>
      <div class="body">
        ${license.ok ? `<p>Atas nama <b>${esc(license.name || '-')}</b>${license.exp ? `, berlaku sampai <b>${esc(license.exp)}</b>` : ', tanpa batas waktu'}.</p>
          <button class="btn" type="button" id="pro-remove">Hapus kode dari browser ini</button>` : `
        <ul>
          <li><b>Laporan PDF profesional</b> siap kirim ke pemilik toko, mitra, atau investor</li>
          <li>Analisis <b>semua produk</b>: margin, status rugi/tipis/sehat, harga impas & harga target</li>
          <li><b>Semua temuan & saran</b> otomatis</li>
          <li>Ekspor lengkap ke Excel</li>
        </ul>
        <div><span class="price">${esc(p.pro || '')}</span> <span class="muted">${esc(p.proUnit || '')}</span>${p.proNote ? `<div class="small faint">${esc(p.proNote)}</div>` : ''}</div>
        ${wa ? `<a class="btn primary" href="${esc(wa)}" target="_blank" rel="noopener" data-track="beli-wa">Beli kode lewat WhatsApp</a>` : '<p class="small warn">Nomor WhatsApp penjual belum diatur.</p>'}
        <div class="field"><label for="code-input">Sudah punya kode?</label>
          <textarea id="code-input" placeholder="Tempel kode yang diawali CP1." spellcheck="false"></textarea>
          <span class="hint" id="code-msg">${license.error ? `<span class="bad">${esc(license.error)}</span>` : 'Kode diperiksa di browser ini; data toko Anda tidak dikirim ke mana pun.'}</span></div>
        <button class="btn primary" type="button" id="code-apply">Aktifkan</button>`}
      </div>`;
    if (!d.open) d.showModal();
  }

  /* ---------- pengaturan modal ---------- */
  function renderSettings() {
    const s = st();
    const box = $('#modal');
    const r = last && last.all;
    const mode = s.modalMode === 'acuan' ? 'acuan' : 'produk';
    const dis = demo ? 'disabled' : '';
    const coverage = r && r.totalSales ? r.coverage : null;
    const pill = coverage === null ? (Engine.modeOf(s) === 'acuan' && ok(s.mitra) ? ['ready', 'Siap'] : ['todo', 'Belum diatur'])
      : coverage >= 0.98 ? ['ready', 'Lengkap'] : coverage > 0 ? ['todo', `${pct(coverage, 0)} penjualan`] : ['todo', 'Belum diatur'];
    box.innerHTML = `
      <div class="card-top"><div><h3 id="h-modal">2 · Atur modal &amp; biaya</h3>
        <p class="small muted">Laporan marketplace tidak berisi harga beli Anda. Tanpa modal, margin tidak dihitung (bukan dianggap nol).</p></div>
        <span class="pill ${pill[0]}" id="modal-pill">${pill[1]}</span></div>
      ${demo ? '<p class="demo-note">Mode contoh: memakai modal & biaya Toko Contoh. Unggah file Anda untuk mengatur modal sendiri.</p>' : ''}
      <div class="tabs" role="tablist" aria-label="Cara menghitung modal">
        <button type="button" role="tab" data-mode="produk" aria-selected="${mode === 'produk'}" ${dis}>Modal per produk</button>
        <button type="button" role="tab" data-mode="acuan" aria-selected="${mode === 'acuan'}" ${dis}>Reseller: diskon dari harga acuan</button>
      </div>
      ${mode === 'produk' ? produkPanel(s, r, dis) : acuanPanel(s, dis)}
      <div class="subhead"><h4>Biaya lain</h4></div>
      <div class="fields">
        <div class="field"><label for="s-packing">Packing per pesanan</label>
          <div class="input"><span>Rp</span><input id="s-packing" type="number" min="0" step="100" inputmode="numeric" placeholder="contoh: 2000" value="${ok(s.packing) && s.packing > 0 ? s.packing : ''}" ${dis}></div>
          <span class="hint">Plastik, bubble wrap, lakban.</span></div>
        <div class="field"><label for="s-target">Target margin</label>
          <div class="input"><input id="s-target" type="number" min="0" max="80" step="1" inputmode="decimal" value="${ok(s.targetMargin) ? s.targetMargin : 15}" ${dis}><span>% dari harga</span></div>
          <span class="hint">Dipakai untuk saran harga & status produk.</span></div>
        <div class="field opex"><span class="label">Biaya operasional / bulan</span>
          <div class="costs-list">${(s.fixedCosts || []).map((c, i) => `<div class="cost-row">
            <input class="plain" id="fc-label-${i}" value="${esc(c.label)}" placeholder="mis. Gaji admin" aria-label="Nama biaya ${i + 1}" ${dis}>
            <div class="input"><span>Rp</span><input id="fc-amount-${i}" type="number" min="0" step="10000" value="${ok(c.amount) ? c.amount : ''}" aria-label="Jumlah biaya ${i + 1}" ${dis}></div>
            ${demo ? '<span></span>' : `<button class="x" type="button" data-fc-del="${i}" aria-label="Hapus biaya ${i + 1}">×</button>`}</div>`).join('')}</div>
          ${demo ? '' : '<div><button class="btn ghost" type="button" id="fc-add">+ Tambah biaya (gaji, sewa, iklan luar platform)</button></div>'}
          <span class="hint">Mengubah margin menjadi <b>laba bersih</b>.</span></div>
      </div>
      <div class="subhead"><h4>Profil laporan</h4><span class="tiny faint">Tampil di sampul laporan PDF</span></div>
      <div class="fields">
        <div class="field"><label for="pf-store">Nama toko</label><input class="plain" id="pf-store" value="${esc(prof().store)}" placeholder="mis. Toko Sejahtera" ${dis}></div>
        <div class="field"><label for="pf-owner">Disusun oleh / untuk</label><input class="plain" id="pf-owner" value="${esc(prof().owner)}" placeholder="mis. Untuk: Bapak Andi (investor)" ${dis}></div>
        <div class="field"><span class="label">Logo (opsional)</span>
          <div class="row-actions">${prof().logo ? `<img src="${esc(prof().logo)}" alt="Logo toko" style="height:36px;max-width:120px;object-fit:contain;border-radius:6px">` : ''}
            <label class="btn" for="pf-logo" ${demo ? 'hidden' : ''}>${prof().logo ? 'Ganti' : 'Pilih gambar'}</label><input id="pf-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden>
            ${prof().logo && !demo ? '<button class="btn ghost" type="button" id="pf-logo-del">Hapus</button>' : ''}</div></div>
      </div>`;
    renderCostTable();
  }
  function produkPanel(s, r, dis) {
    const hasData = r && r.products.length;
    const missing = hasData ? r.products.filter((p) => !ok(p.unitCost)).length : 0;
    return `
      <div class="fields two">
        <div class="field"><span class="label">Modal per produk (paling akurat)</span>
          <div class="row-actions">
            <button class="btn" type="button" id="tpl-download" ${hasData ? '' : 'disabled'}>Unduh template modal</button>
            <label class="btn" for="tpl-input" ${demo ? 'hidden' : ''}>Unggah template terisi</label><input id="tpl-input" type="file" accept=".xlsx,.xls,.csv" hidden>
          </div>
          <span class="hint">${hasData ? `Template berisi ${r.products.length.toLocaleString('id-ID')} produk dari laporan Anda. Isi kolom “Modal per unit”.` : 'Unggah laporan penghasilan dulu agar template berisi produk Anda.'}
            ${s.catalog.length ? ` Tersimpan: ${s.catalog.length.toLocaleString('id-ID')} modal produk.` : ''}</span></div>
        <div class="field"><label for="s-fallback">Modal rata-rata (cadangan)</label>
          <div class="input"><input id="s-fallback" type="number" min="0" max="99" step="1" inputmode="decimal" placeholder="mis. 60" value="${ok(s.fallbackPct) ? s.fallbackPct : ''}" ${dis}><span>% dari harga jual</span></div>
          <span class="hint">Dipakai untuk produk yang modalnya belum diisi. Kosongkan jika ingin hanya angka pasti.</span></div>
      </div>
      ${r && r.totalSales ? `<div class="coverage"><div class="small"><b>${pct(r.coverage, 0)}</b> penjualan sudah punya modal${missing ? ` · ${missing.toLocaleString('id-ID')} produk belum diisi` : ''}${r.ttNoDetail && !r.hasOrderExport.tiktok ? ` · ${r.ttNoDetail.toLocaleString('id-ID')} pesanan TikTok tanpa rincian produk (unggah export pesanan TikTok)` : ''}${r.qtyAssumed && !r.hasOrderExport.shopee ? ' · jumlah barang Shopee dianggap 1 (unggah export pesanan Shopee)' : ''}</div>
        <div class="meter" aria-hidden="true"><i style="width:${Math.round(r.coverage * 100)}%"></i></div></div>` : ''}
      ${hasData ? `<details class="costs" ${missing && missing <= 40 ? 'open' : ''}><summary class="small">Isi modal langsung di sini (${r.products.length.toLocaleString('id-ID')} produk)</summary>
        <div class="searchrow" style="margin-top:10px"><input id="cost-q" type="search" placeholder="Cari produk…" value="${esc(view.costQ)}" aria-label="Cari produk"></div>
        <div id="cost-table"></div></details>` : ''}`;
  }
  function acuanPanel(s, dis) {
    const ready = ok(s.mitra);
    const p = s.periods[s.periods.length - 1];
    const sell = 100 * (1 + (p.markup || 0) / 100) * (1 - (p.disc || 0) / 100), cost = 100 - (s.mitra || 0);
    return `
      <p class="small muted">Untuk reseller yang membeli dengan diskon dari harga acuan pemasok (mis. harga sampul buku, harga katalog distributor).</p>
      <div class="fields">
        <div class="field"><label for="s-mitra">Diskon dari pemasok</label>
          <div class="input ${!ready && files.length ? 'need' : ''}"><input id="s-mitra" type="number" min="0" max="99" step="0.5" inputmode="decimal" placeholder="contoh: 30" value="${ready ? s.mitra : ''}" ${dis}><span>%</span></div>
          <span class="hint">Harga beli = harga acuan × (1 − diskon).</span></div>
        <div class="field"><label for="s-coret">TikTok: harga coret vs harga acuan</label>
          <div class="input"><input id="s-coret" type="number" min="1" step="1" inputmode="numeric" value="${s.coret || 100}" ${dis}><span>%</span></div>
          <span class="hint">100 = harga coret sama dengan harga acuan.</span></div>
      </div>
      <div class="field"><span class="label">Shopee: pola harga jual dibanding harga acuan</span>
        <span class="hint">Shopee tidak mencatat harga sebelum diskon. Periode dipilih menurut tanggal pesanan.</span>
        <div class="periods"><div class="period period-head"><span>Mulai tanggal pesanan</span><span>Kenaikan dari harga acuan</span><span>Diskon toko</span><span></span></div>
          ${s.periods.map((q, i) => `<div class="period">
            <div class="input"><input type="date" id="p-start-${i}" value="${esc(q.start)}" aria-label="Mulai tanggal periode ${i + 1}" ${dis}></div>
            <div class="input"><input type="number" id="p-markup-${i}" step="0.5" value="${q.markup}" aria-label="Kenaikan harga periode ${i + 1}" ${dis}><span>%</span></div>
            <div class="input"><input type="number" id="p-disc-${i}" step="0.5" min="0" max="99" value="${q.disc}" aria-label="Diskon toko periode ${i + 1}" ${dis}><span>%</span></div>
            ${s.periods.length > 1 && !demo ? `<button class="x" type="button" data-del="${i}" aria-label="Hapus periode ${i + 1}">×</button>` : '<span></span>'}</div>`).join('')}</div>
        ${demo ? '' : '<div><button class="btn ghost" type="button" id="add-period">+ Tambah periode harga</button></div>'}
        <p class="formula">${ready ? `Contoh harga acuan Rp100.000 → Anda membeli Rp${(cost * 1000).toLocaleString('id-ID')} dan menjual di Shopee Rp${Math.round(sell * 1000).toLocaleString('id-ID')} (periode terakhir). Sisa sebelum potongan platform: ${pct((sell - cost) / sell)}.` : 'Isi diskon dari pemasok untuk menghitung modal.'}</p>
      </div>`;
  }
  const catKey = (p) => (p.platform === 'tiktok' ? (p.code || p.sku) : (p.sku || p.code)) || '';
  function renderCostTable() {
    const box = $('#cost-table');
    if (!box || !last) return;
    const q = Engine.norm(view.costQ);
    let list = last.all.products.filter((p) => !q || Engine.norm(`${p.name} ${p.sku} ${p.code}`).includes(q));
    list.sort((a, b) => (ok(a.unitCost) - ok(b.unitCost)) || b.sales - a.sales);
    const shown = view.costAll ? list : list.slice(0, 25);
    const dis = demo ? 'disabled' : '';
    box.innerHTML = `<div class="tablewrap"><table class="data cost-table"><thead><tr><th>Produk</th><th>Terjual</th><th>Harga rata-rata</th><th>Modal / unit</th></tr></thead><tbody>
      ${shown.map((p) => `<tr><td><i class="sw" style="background:var(--${p.platform});width:8px;height:8px"></i> ${esc(p.name)}<br><span class="tiny faint">${esc(catKey(p) || '-')}</span></td>
        <td>${p.qtyKnown ? Math.round(p.qty).toLocaleString('id-ID') : `${p.rows}×`}</td><td>${fmt(p.avgPrice)}</td>
        <td><input type="number" min="0" step="100" inputmode="numeric" class="${ok(p.unitCost) ? '' : 'missing'}" data-cost="${esc(p.key)}" value="${ok(p.unitCost) ? p.unitCost : ''}" placeholder="Rp" aria-label="Modal per unit ${esc(p.name)}" ${dis}></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">Tidak ada produk yang cocok.</td></tr>'}</tbody></table></div>
      ${list.length > 25 ? `<button class="btn ghost" type="button" id="cost-all">${view.costAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${list.length.toLocaleString('id-ID')} produk`}</button>` : ''}`;
  }
  /** Simpan modal satu produk ke katalog (kode bila ada, jika tidak memakai nama). */
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
    const keyOf = (e) => (e.kode ? `k:${Engine.norm(e.kode)}` : `n:${Engine.norm(`${e.nama} ${e.variasi || ''}`)}`);
    const map = new Map(settings.catalog.map((e) => [keyOf(e), e]));
    for (const e of entries) map.set(keyOf(e), e);
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
      ['1. Isi kolom "Modal per unit (Rp)" untuk setiap produk: harga beli/produksi satu unit, tanpa ongkir ke pembeli.'],
      ['2. Jangan ubah kolom "Kode": dipakai untuk mencocokkan dengan laporan marketplace.'],
      ['3. Boleh menambah baris sendiri: isi Kode (SKU) atau Nama produk + Modal per unit.'],
      ['4. Simpan, lalu unggah file ini di Cek Profit (langkah 1 atau tombol "Unggah template terisi").'],
      ['Modal tersimpan di browser Anda saja, tidak dikirim ke server.']]), 'Petunjuk');
    XLSX.writeFile(wb, 'template-modal-cekprofit.xlsx');
    track('unduh-template');
  }

  /* ---------- unggah ---------- */
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
    $('#file-list').insertAdjacentHTML('beforeend', `<li class="file small muted">Membaca ${list.length} file…</li>`);
    const results = await Promise.all([...list].map(readFile));
    for (const f of results) {
      if (f.parsed && f.parsed.kind === 'modal_template') {
        mergeCatalog(f.parsed.entries);
        f.note = `${f.parsed.entries.length.toLocaleString('id-ID')} modal produk dimuat ke pengaturan`;
        toast(f.note);
      }
    }
    files.push(...results);
    track('unggah-file');
    renderFiles(); render();
    const r = last && last.all;
    if (r && r.totalSales && !r.ready) $('#modal').scrollIntoView({ behavior: 'smooth' });
  }
  function fileStatus(f) {
    if (f.error) return `<span class="bad">${esc(f.error)}</span>`;
    if (f.note) return `<span class="ok">${esc(f.note)}</span>`;
    const p = f.parsed;
    if (p.kind === 'shopee_income' || p.kind === 'tiktok_income') {
      const ref = p.kind === 'shopee_income' ? p.check.summaryTotal : p.check.reportSettle;
      const n = p.kind === 'shopee_income' ? `${p.orders.length.toLocaleString('id-ID')} pesanan` : `${p.rows.length.toLocaleString('id-ID')} transaksi`;
      const period = p.check.from ? ` · ${p.check.from} s.d. ${p.check.to}` : '';
      const chk = ref === null ? '<span class="warn">Ringkasan tidak ditemukan, total tidak bisa dicocokkan</span>'
        : Math.abs(ref - p.check.sum) <= 1 ? `<span class="ok">✓ Cocok dengan ringkasan (${fmt(p.check.sum)})</span>`
          : `<span class="warn">Selisih ${fmt(p.check.sum - ref)} dengan ringkasan — mohon laporkan</span>`;
      return `${n}${period}<br>${chk}`;
    }
    if (p.kind === 'shopee_orders' || p.kind === 'tiktok_orders') return `${p.lines.length.toLocaleString('id-ID')} baris produk`;
    if (p.kind === 'shopee_return' || p.kind === 'tiktok_return') return `${p.cases.length} pengajuan retur/refund`;
    if (p.kind === 'shopee_balance') return 'Tidak diperlukan. Gunakan Laporan Penghasilan.';
    return '<span class="bad">Format belum dikenali. Lihat “Cara unduh laporan”.</span>';
  }
  function renderFiles() {
    const list = demo ? CekDemo.make().map((wb) => ({ name: wb.name, demo: true, kind: Engine.detect(wb) })) : files;
    $('#file-list').innerHTML = list.map((f, i) => {
      const [cls, label] = KIND[f.kind] || KIND.unknown;
      return `<li class="file"><i class="dot ${cls}"></i><div><div class="name">${esc(f.name)}</div><div class="muted">${label}${f.demo ? ' · data contoh' : ` · ${fileStatus(f)}`}</div></div>
        ${f.demo ? '<span></span>' : `<button class="x" type="button" data-rm="${i}" aria-label="Hapus ${esc(f.name)}">×</button>`}</li>`;
    }).join('');
    $('#clear-btn').hidden = !list.length;
    $('#demo-btn').hidden = demo || files.length > 0;
  }

  /* ---------- grafik ---------- */
  function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function waterfall(r) {
    const steps = [{ label: 'Penjualan', v: r.totalSales, total: true }, { label: 'Potongan platform', v: r.totalFees }];
    if (r.ready) {
      const unknown = r.totalReceived - r.knownReceived;
      if (Math.abs(unknown) >= 1) steps.push({ label: 'Belum ada modal', v: -unknown, muted: true });
      steps.push({ label: 'Modal', v: -r.totalModal });
      if (r.knownPacking) steps.push({ label: 'Packing', v: -r.knownPacking });
      if (r.lostCertain) steps.push({ label: 'Retur hilang', v: -r.lostCertain });
      steps.push({ label: 'Margin', v: r.totalMargin, total: true, accent: r.opex <= 0 });
      if (r.opex > 0) { steps.push({ label: 'Biaya operasional', v: -r.opex }); steps.push({ label: 'Laba bersih', v: r.netProfit, total: true, accent: true }); }
    } else steps.push({ label: 'Dana diterima', v: r.totalReceived, total: true, accent: true });
    const W = 760, H = 300, L = 8, R = 8, T = 30, B = 46;
    const lo = Math.min(0, ...steps.map((s) => s.v)), max = Math.max(r.totalSales, 1);
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (max - lo));
    const band = (W - L - R) / steps.length, bw = Math.min(74, band * 0.62);
    let run = 0, g = `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>`;
    steps.forEach((s, i) => {
      const x = L + band * i + (band - bw) / 2;
      let top, bot, fill;
      if (s.total) { top = y(Math.max(s.v, 0)); bot = y(Math.min(s.v, 0)); fill = s.accent ? 'var(--accent)' : 'var(--ink-2)'; run = s.v; }
      else { const a = run, b = run + s.v; top = y(Math.max(a, b)); bot = y(Math.min(a, b)); fill = s.muted ? 'var(--line)' : 'var(--cost)'; run = b; }
      g += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" rx="4" fill="${fill}"/>`;
      if (i < steps.length - 1 && !steps[i + 1].total) g += `<line x1="${x + bw}" x2="${x + band}" y1="${y(run)}" y2="${y(run)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
      const share = s.label === 'Penjualan' ? '' : pct(Math.abs(s.v) / r.totalSales);
      g += `<text class="val" x="${x + bw / 2}" y="${top - 8}" text-anchor="middle">${fmtShort(s.v)}</text>`;
      g += `<text x="${x + bw / 2}" y="${H - 26}" text-anchor="middle">${esc(s.label)}</text><text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${share}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Alur dari penjualan ke margin">${g}</svg>`;
  }
  function monthly(r) {
    const months = r.months;
    if (!months.length) return '<p class="muted small">Tidak ada data bulanan.</p>';
    const series = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const key = view.metric === 'margin' && !r.ready ? 'sales' : view.metric;
    const get = (m, k) => (key === 'fees' ? -m[k].fees : m[k][key]);
    const W = 860, H = 280, L = 56, R = 8, T = 14, B = 30;
    const vals = months.flatMap((m) => series.map((k) => get(m, k)));
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const step = niceStep((hi - lo) / 4 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const band = (W - L - R) / months.length;
    const bw = Math.max(4, Math.min(24, (band * 0.7) / series.length - 2));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${Math.abs(v) < 1e-9 ? '' : 'stroke-dasharray="2 4"'}/>`;
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
        const tip = `${PNAME[k]} · ${monthLabel(m.month)}: ${fmt(v)} · ${m[k].orders} pesanan`;
        g += `<path d="${path}" fill="var(--${k})"/><rect x="${x - 2}" y="${T}" width="${bw + 4}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
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
  const barRows = (rows, total) => {
    const max = Math.max(...rows.map((r) => Math.abs(r.v)), 1);
    return rows.map((r) => `<div class="barrow"><span>${esc(r.label)}</span><div class="bar-track"><div class="bar" style="width:${(Math.abs(r.v) / max) * 100}%"></div></div>
      <span class="num">${fmt(r.v)} <span class="faint">· ${pct(Math.abs(r.v) / total)}</span></span></div>`).join('');
  };
  const lockVeil = (title, body) => `<div class="veil"><div><span class="pill pro">PRO</span><b>${esc(title)}</b><span class="small muted">${esc(body)}</span>
    <button class="btn primary" type="button" data-open-pro="${esc(title)}">Buka dengan kode akses</button></div></div>`;

  /* ---------- hasil ---------- */
  const setSteps = (hasFiles, ready, hasResult) => {
    $('#step1').className = hasFiles ? 'done' : 'active';
    $('#step2').className = ready ? 'done' : hasFiles ? 'active' : '';
    $('#step3').className = hasResult && ready ? 'done' : '';
  };
  const resetView = () => Object.assign(view, { platform: 'all', from: '', to: '', showAll: false, q: '', costQ: '', costAll: false });

  function render() {
    const parsed = parsedAll();
    const s = st();
    const hasIncome = parsed.some((p) => p.kind === 'shopee_income' || p.kind === 'tiktok_income');
    const out = $('#results');
    if (!hasIncome) {
      last = null;
      setSteps(demo || files.length > 0, false, false);
      renderSettings();
      out.innerHTML = `<div class="card empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/></svg>
        <h3>Hasil akan muncul di sini</h3>
        <p class="muted small" style="max-width:52ch">${files.length ? 'File yang diunggah belum berisi laporan penghasilan. Export pesanan, retur, atau template modal saja belum cukup untuk menghitung profit.' : 'Unggah laporan penghasilan Shopee atau TikTok Shop di langkah 1. Belum punya file? Lihat dulu dengan data contoh.'}</p>
        ${files.length ? '' : '<button class="btn primary" type="button" data-demo>Lihat dengan data contoh</button>'}</div>`;
      return;
    }
    const filter = { platforms: view.platform === 'all' ? ['shopee', 'tiktok'] : [view.platform], from: view.from, to: view.to };
    const r = Engine.compute(parsed, s, cases(), filter);
    const all = filter.platforms.length === 2 && !filter.from && !filter.to ? r : Engine.compute(parsed, s, cases());
    last = { r, all, st: s, parsed };
    setSteps(true, r.ready, true);
    renderSettings();
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const S = r.shopee, T = r.tiktok;
    const monthOpts = (sel, label) => `<option value="">${label}</option>` + r.allMonths.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    const worst = r.totalMargin - r.unknownRisk;
    const pro = isPro();
    const ins = r.insights;
    const freeIns = 2;
    const hasOpex = r.fixedMonthly > 0;

    out.innerHTML = `
      <div class="toolbar" role="toolbar" aria-label="Filter hasil">
        <div class="group"><h2>3 · Hasil</h2>
          ${r.available.shopee && r.available.tiktok ? `<div class="seg" role="group" aria-label="Platform">
            ${[['all', 'Semua'], ['shopee', 'Shopee'], ['tiktok', 'TikTok']].map(([k, l]) => `<button type="button" data-platform="${k}" aria-pressed="${view.platform === k}">${l}</button>`).join('')}</div>` : ''}</div>
        <div class="group">
          <label class="small muted" for="from">Bulan</label>
          <select id="from">${monthOpts(view.from, 'Dari awal')}</select><span class="faint">–</span><select id="to">${monthOpts(view.to, 'Sampai akhir')}</select>
          <button class="btn" type="button" id="export">${pro ? '' : '<span class="pill pro">PRO</span>'}Excel</button>
          <button class="btn primary" type="button" id="pdf">${pro ? '' : '<span class="pill pro">PRO</span>'}Laporan PDF</button>
        </div>
      </div>
      ${demo ? `<div class="banner info"><span><b>Data contoh (fiktif)</b> dari Toko Contoh Sejahtera, semua fitur Pro terbuka. Unggah laporan Anda untuk melihat angka toko Anda.</span></div>` : ''}
      ${files.some((f) => f.error) ? '<div class="banner err">Ada file yang gagal dibaca. Lihat keterangan di daftar file.</div>' : ''}
      ${r.mode === 'acuan' && r.ready && s.periods.length === 1 && !s.periods[0].markup && !s.periods[0].disc && r.has.shopee && !demo ? '<div class="banner info"><span>Pola harga Shopee masih 0% kenaikan dan 0% diskon toko. Jika Anda memberi diskon di Shopee, isi di langkah 2 agar modal tidak terlalu rendah.</span></div>' : ''}

      <div class="kpis">
        <div class="kpi hero">
          <span class="eyebrow">${hasOpex ? 'Laba bersih' : 'Margin setelah biaya tercatat'}</span>
          ${r.ready ? `<span class="v">${fmt(hasOpex ? r.netProfit : r.totalMargin)}</span>
            <span class="sub">${r.coverage < 0.98 ? `Dari ${pct(r.coverage, 0)} penjualan yang modalnya diketahui` : r.unknownRisk > 0 ? `Bisa turun ke ${fmt((hasOpex ? r.netProfit : r.totalMargin) - r.unknownRisk)} jika retur yang belum dicek tidak kembali` : `${pct((hasOpex ? r.netProfit : r.totalMargin) / r.totalSales)} dari penjualan · ${r.first} s.d. ${r.last}`}</span>`
            : `<span class="v">Belum dihitung</span><span class="sub">Atur modal di langkah 2 agar margin bisa dihitung.</span><button class="btn" type="button" id="go-modal">Atur modal</button>`}
        </div>
        <div class="kpi"><span class="eyebrow">${hasOpex ? 'Margin kotor' : 'Rata-rata per bulan'}</span><span class="v">${r.ready ? fmt(hasOpex ? r.totalMargin : r.perMonth) : '—'}</span><span class="sub">${hasOpex ? `sebelum biaya operasional ${fmt(r.opex)}` : `${r.days} hari data`}</span></div>
        <div class="kpi"><span class="eyebrow">Per pesanan</span><span class="v">${r.ready ? fmt(r.perOrder) : '—'}</span><span class="sub">${r.orders.toLocaleString('id-ID')} pesanan terjual</span></div>
        <div class="kpi"><span class="eyebrow">Potongan platform</span><span class="v">${pct(-r.totalFees / r.totalSales)}</span><span class="sub">${fmt(-r.totalFees)} dari ${fmt(r.totalSales)}</span></div>
      </div>

      ${ins.length ? `<div class="card" id="insights">
        <div class="card-head"><h3>Temuan &amp; saran</h3><p>Dibuat otomatis dari data Anda</p></div>
        <ul class="insights">${ins.slice(0, pro ? ins.length : freeIns).map(insightItem).join('')}</ul>
        ${!pro && ins.length > freeIns ? `<div class="locked" style="margin-top:10px;min-height:150px"><ul class="insights blur">${ins.slice(freeIns, freeIns + 2).map(insightItem).join('')}</ul>
          ${lockVeil(`${ins.length - freeIns} temuan lainnya`, 'Termasuk produk yang merugi dan saran tindakan.')}</div>` : ''}
      </div>` : ''}

      <div class="card chart">
        <div class="card-head"><h3>Ke mana uang penjualan pergi</h3><p>${plats.map((k) => PNAME[k]).join(' + ')}${view.from || view.to ? ' · periode terpilih' : ''}</p></div>
        ${waterfall(r)}
        <p class="small muted" style="margin-top:8px">Margin = dana dari platform − modal${r.totalPacking ? ' − packing' : ''}${r.lostCertain ? ' − barang retur yang hilang' : ''}.${hasOpex ? ' Laba bersih = margin − biaya operasional.' : ' Tambahkan biaya operasional di langkah 2 untuk melihat laba bersih.'}</p>
      </div>

      <div class="card chart" id="monthly">
        <div class="card-head"><h3>Per bulan</h3>
          <div class="seg" role="group" aria-label="Ukuran">${[['margin', 'Margin'], ['sales', 'Penjualan'], ['fees', 'Potongan']].filter(([k]) => k !== 'margin' || r.ready).map(([k, l]) => `<button type="button" data-metric="${k}" aria-pressed="${view.metric === k || (view.metric === 'margin' && !r.ready && k === 'sales')}">${l}</button>`).join('')}</div></div>
        ${monthly(r)}
        <details style="margin-top:10px"><summary class="small">Lihat tabel per bulan</summary>
          <div class="tablewrap" style="margin-top:8px"><table class="data"><thead><tr><th>Bulan</th><th>Penjualan</th><th>Potongan</th><th>Margin</th><th>Margin %</th>${hasOpex ? '<th>Laba bersih</th>' : ''}</tr></thead>
          <tbody>${r.months.map((m) => `<tr><td>${monthLabel(m.month)}</td><td>${fmt(m.total.sales)}</td><td class="neg">${fmt(m.total.fees)}</td>
            <td class="${m.total.margin < 0 ? 'neg' : ''}">${r.ready ? fmt(m.total.margin) : '—'}</td><td>${r.ready && m.total.knownSales ? pct(m.total.margin / m.total.knownSales) : '—'}</td>
            ${hasOpex ? `<td class="${m.total.net < 0 ? 'neg' : ''}">${r.ready ? fmt(m.total.net) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="card-head"><h3>Per platform</h3></div>
          <div class="tablewrap"><table class="data"><thead><tr><th></th>${plats.map((k) => `<th>${PNAME[k]}</th>`).join('')}</tr></thead><tbody>
            <tr><td>Pesanan terjual</td>${plats.map((k) => `<td>${r[k].orders.toLocaleString('id-ID')}</td>`).join('')}</tr>
            <tr><td>Penjualan</td>${plats.map((k) => `<td>${fmt(r[k].sales)}</td>`).join('')}</tr>
            <tr><td>Potongan platform</td>${plats.map((k) => `<td class="neg">${fmt(r[k].feeTotal)} <span class="faint">${pct(-r[k].feeTotal / r[k].sales)}</span></td>`).join('')}</tr>
            <tr><td>Dana diterima</td>${plats.map((k) => `<td>${fmt(r[k].received)}</td>`).join('')}</tr>
            <tr><td>Modal</td>${plats.map((k) => `<td class="neg">${r.ready ? fmt(-r[k].modal) : '—'}</td>`).join('')}</tr>
            ${r.totalPacking ? `<tr><td>Packing</td>${plats.map((k) => `<td class="neg">${fmt(-r[k].packing)}</td>`).join('')}</tr>` : ''}
            <tr class="total"><td>Margin</td>${plats.map((k) => `<td class="${r[k].margin < 0 ? 'neg' : ''}">${fmt(r[k].margin)} <span class="faint">${ok(r[k].margin) && r[k].knownSales ? pct(r[k].margin / r[k].knownSales) : ''}</span></td>`).join('')}</tr>
            <tr><td class="small faint">Modal diketahui</td>${plats.map((k) => `<td class="small faint">${pct(r[k].coverage, 0)}</td>`).join('')}</tr>
          </tbody></table></div>
          ${r.has.tiktok ? `<p class="small muted" style="margin-top:10px">TikTok: diskon toko rata-rata ${pct(T.discount)}. ${Object.entries(T.bySource).map(([k, v]) => `${esc(k)} ${v.orders.toLocaleString('id-ID')} pesanan${r.ready ? `, margin ${fmt(v.margin)}` : ''}`).join(' · ')}.</p>` : ''}
          ${r.adjustments ? `<p class="small muted" style="margin-top:6px">Kompensasi/penyesuaian dari platform ${fmt(r.adjustments)} ditampilkan terpisah, tidak ditambahkan ke margin.</p>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h3>Rincian potongan</h3><p>% dari penjualan</p></div>
          ${r.has.shopee ? `<p class="small" style="font-weight:600;margin-bottom:4px"><i class="sw" style="background:var(--shopee)"></i> Shopee</p>${barRows([
            { label: 'Biaya administrasi', v: S.fees.admin }, { label: 'Gratis Ongkir XTRA', v: S.fees.xtra }, { label: 'Biaya proses pesanan', v: S.fees.proses },
            { label: 'Komisi AMS (afiliasi)', v: S.fees.ams }, { label: 'Ongkir ditanggung penjual', v: S.fees.ship }, { label: 'Biaya lain', v: S.fees.lain }].filter((x) => Math.abs(x.v) >= 1).sort((a, b) => a.v - b.v), S.sales)}` : ''}
          ${r.has.tiktok ? `<p class="small" style="font-weight:600;margin:12px 0 4px"><i class="sw" style="background:var(--tiktok)"></i> TikTok Shop</p>${barRows([
            { label: 'Komisi platform', v: T.fees.platform }, { label: 'Komisi dinamis', v: T.fees.dinamis }, { label: 'Biaya pemrosesan', v: T.fees.proses },
            { label: 'Ongkir', v: T.fees.ongkir }, { label: 'Komisi afiliasi', v: T.fees.afiliasi }, { label: 'Biaya lain', v: T.fees.lain }].filter((x) => Math.abs(x.v) >= 1).sort((a, b) => a.v - b.v), T.sales)}` : ''}
        </div>
      </div>

      ${r.buckets.length > 1 ? `<div class="card">
        <div class="card-head"><h3>Potongan menurut nilai pesanan</h3><p>Biaya tetap per pesanan membuat pesanan kecil terpotong lebih besar</p></div>
        ${r.buckets.map((b) => { const p = -b.fees / b.value; const maxp = Math.max(...r.buckets.map((x) => -x.fees / x.value));
          return `<div class="barrow"><span>${esc(b.label)} <span class="faint tiny">${b.orders.toLocaleString('id-ID')} pesanan${r.ready && b.known ? ` · margin ${fmt(b.margin / b.known)}/pesanan` : ''}</span></span><div class="bar-track"><div class="bar" style="width:${(p / maxp) * 100}%"></div></div><span class="num">${pct(p)}</span></div>`; }).join('')}
      </div>` : ''}

      ${r.products.length ? `<div class="card" id="products">
        <div class="card-head"><h3>Produk &amp; saran harga</h3><p>Harga impas dan harga target memakai potongan platform produk itu sendiri</p></div>
        <div class="chips" style="margin-bottom:12px">${['rugi', 'tipis', 'sehat', 'unknown'].map((h) => { const n = r.products.filter((p) => p.health === h).length; return n ? `<span class="chip ${h}">${{ rugi: 'Rugi', tipis: `Di bawah target ${pct(r.target, 0)}`, sehat: 'Sehat', unknown: 'Modal belum ada' }[h]}: ${n}</span>` : ''; }).join('')}</div>
        <div class="searchrow"><input id="q" type="search" placeholder="Cari produk…" value="${esc(view.q)}" aria-label="Cari produk">
          <select id="sort" aria-label="Urutkan">${[['margin', 'Margin terbesar'], ['margin-asc', 'Margin terkecil / rugi'], ['pct-asc', 'Margin % paling tipis'], ['sales', 'Penjualan terbesar'], ['qty', 'Paling laku']].map(([k, l]) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div id="product-table"></div>
      </div>` : ''}

      <div class="card" id="returns">
        <div class="card-head"><h3>Retur dan refund</h3>${r.cases.some((c) => c.needsCheck) ? `<button class="btn ghost" type="button" id="only-check">${view.onlyCheck ? 'Tampilkan semua' : 'Hanya yang perlu dicek'}</button>` : ''}</div>
        ${r.cases.length ? `<div class="chips">${r.catSummary.sort((a, b) => b.count - a.count).map((c) => `<span class="chip"><i class="sw" style="background:var(--${c.platform});width:8px;height:8px"></i> ${esc(c.label)}: ${c.count}</span>`).join('')}</div>
          <p class="small muted" style="margin-block:10px">Barang yang tidak jadi dikirim (stok kosong) tidak memakan modal. Untuk retur dan paket bermasalah, pilih <b>Tidak kembali/rusak</b> bila barangnya tidak kembali; modalnya dikurangkan dari margin.${r.unknownRisk > 0 ? ` Kasus yang belum dicek berisiko ${fmt(r.unknownRisk)}.` : ''}</p>
          <div class="tablewrap"><table class="data"><thead><tr><th>Produk / alasan</th><th>Resi retur</th><th>Est. modal</th><th>Status barang</th></tr></thead><tbody>
          ${r.cases.filter((c) => !view.onlyCheck || c.needsCheck).sort((a, b) => (b.needsCheck - a.needsCheck) || ((b.estModal || 0) - (a.estModal || 0))).slice(0, 200).map((c) => `<tr>
            <td><i class="sw" style="background:var(--${c.platform});width:8px;height:8px"></i> <b>${esc(c.product || '-')}</b>${c.variant && !/^(Default|Not Specified)$/.test(c.variant) ? ` · ${esc(c.variant)}` : ''}<br><span class="tiny faint">${esc(Engine.CAT_LABEL[c.cat])}${c.note ? ` · “${esc(c.note.slice(0, 70))}”` : ''}</span></td>
            <td>${esc(c.resi || '–')}</td><td>${fmt(c.estModal)}</td>
            <td>${c.needsCheck ? `<select class="case-select" data-case="${esc(c.key)}" aria-label="Status barang" ${demo ? 'disabled' : ''}>${[['belum', 'Belum dicek'], ['kembali', 'Sudah kembali'], ['hilang', 'Tidak kembali/rusak']].map(([v, l]) => `<option value="${v}" ${c.state === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '<span class="faint small">Tidak perlu</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada kasus yang perlu dicek.</td></tr>'}
          </tbody></table></div>`
          : '<p class="small muted">Belum ada file retur. Unggah file retur Shopee/TikTok untuk menandai barang yang tidak kembali. Tanpa file ini, refund dianggap tidak memakan modal.</p>'}
      </div>

      <div class="card" id="sim">
        <div class="card-head"><h3>Simulator harga satu produk</h3><p>Uji harga & diskon sebelum dipasang. Potongan platform diambil dari data Anda.</p></div>
        <div class="sim"><div class="fields">
            ${simField('listPrice', 'Harga jual normal', 'Rp', sim.listPrice ?? 100000)}
            ${simField('disc', 'Diskon toko', '%', sim.disc ?? 0)}
            ${simField('cost', 'Modal per unit', 'Rp', sim.cost ?? 60000)}
            ${simField('feePct', 'Potongan platform', '%', sim.feePct ?? +(-r.totalFees / r.totalSales * 100).toFixed(1))}
          </div><div class="sim-out" id="sim-out"></div></div>
      </div>

      <details class="card"><summary>Cara hitung dan batasan</summary>
        <ul class="notes" style="margin-top:12px">
          <li><b>Penjualan</b> = harga produk setelah diskon toko & voucher penjual, setelah refund. <b>Dana diterima</b> = angka resmi dari laporan penghasilan.</li>
          <li><b>Modal per produk</b> = modal per unit × jumlah terjual. Jumlah diambil dari export pesanan atau kolom "Detail produk terjual" TikTok. ${r.qtyAssumed ? `<b>${r.qtyAssumed.toLocaleString('id-ID')}</b> item Shopee memakai jumlah = 1 karena export pesanan belum diunggah.` : ''}</li>
          <li>Pesanan yang modalnya tidak diketahui <b>tidak dihitung</b> dalam margin (bukan dianggap modal nol). Porsi penjualan yang sudah punya modal ditunjukkan sebagai “modal diketahui”.</li>
          ${r.mode === 'acuan' ? '<li>Mode reseller: modal Shopee = (harga + refund) × (1 − diskon pemasok) ÷ [(1 + kenaikan) × (1 − diskon toko)] per periode; modal TikTok = harga sebelum diskon × (1 − diskon pemasok) ÷ harga coret vs acuan.</li>' : ''}
          <li>Refund dianggap tidak memakan modal sampai Anda menandai barangnya tidak kembali di bagian retur.</li>
          <li>Kompensasi dari platform tidak ditambahkan ke margin. Biaya operasional dibagi rata per bulan dari rentang tanggal dana diterima.</li>
          <li>Grafik dan filter memakai bulan pesanan dibuat.</li>
          ${r.dupes ? `<li>${r.dupes.toLocaleString('id-ID')} baris dari file yang terunggah dua kali tidak dihitung ulang.</li>` : ''}
        </ul>
      </details>`;
    bindTips($('#monthly'));
    renderProducts();
    renderSimOut();
  }
  const ICON = { bad: '!', warn: '!', good: '✓', info: 'i' };
  const insightItem = (i) => `<li class="insight ${i.level}"><span class="ic" aria-hidden="true">${ICON[i.level]}</span><div><b>${esc(i.title)}</b><span class="small muted">${esc(i.detail)}</span>${i.action ? `<div class="act">→ ${esc(i.action)}</div>` : ''}</div></li>`;
  const simField = (k, label, unit, v) => `<div class="field"><label for="sim-${k}">${label}</label><div class="input">${unit === 'Rp' ? '<span>Rp</span>' : ''}<input id="sim-${k}" type="number" step="${unit === 'Rp' ? 1000 : 0.5}" value="${v ?? ''}">${unit === '%' ? '<span>%</span>' : ''}</div></div>`;

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
    const pro = isPro();
    const FREE = 5;
    const shown = !pro ? list.slice(0, FREE) : view.showAll ? list : list.slice(0, 15);
    const HL = { rugi: 'Rugi', tipis: 'Tipis', sehat: 'Sehat', unknown: '—' };
    const rowHtml = (p) => `<tr><td><i class="sw" style="background:var(--${p.platform});width:8px;height:8px"></i> ${esc(p.name)}${p.variant && p.variant !== 'Default' ? ` <span class="faint">· ${esc(p.variant)}</span>` : ''}</td>
      <td>${p.qtyKnown ? Math.round(p.qty).toLocaleString('id-ID') : `${p.rows}×`}</td><td>${fmt(p.sales)}</td><td class="${p.margin < 0 ? 'neg' : ''}">${fmt(p.margin)}</td><td class="${p.pct < 0 ? 'neg' : ''}">${pct(p.pct)}</td>
      <td>${fmt(p.avgPrice)}</td><td>${fmt(p.breakEven)}</td><td>${fmt(p.targetPrice)}</td><td>${p.health === 'unknown' ? '—' : `<span class="chip ${p.health}">${HL[p.health]}</span>`}</td></tr>`;
    const head = '<thead><tr><th>Produk</th><th>Terjual</th><th>Penjualan</th><th>Margin</th><th>%</th><th>Harga rata-rata</th><th>Harga impas</th><th>Harga target</th><th>Status</th></tr></thead>';
    box.innerHTML = `<div class="tablewrap"><table class="data">${head}<tbody>${shown.map(rowHtml).join('') || '<tr><td colspan="9" class="muted">Tidak ada produk yang cocok.</td></tr>'}</tbody></table></div>
      ${!pro && list.length > FREE ? `<div class="locked" style="min-height:190px;margin-top:4px"><div class="tablewrap blur"><table class="data"><tbody>${list.slice(FREE, FREE + 4).map(rowHtml).join('')}</tbody></table></div>
        ${lockVeil(`${(list.length - FREE).toLocaleString('id-ID')} produk lainnya`, 'Lihat semua produk, status rugi/tipis, dan saran harga.')}</div>` : ''}
      ${pro && list.length > 15 ? `<button class="btn ghost" type="button" id="show-all">${view.showAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${list.length.toLocaleString('id-ID')} produk`}</button>` : ''}
      <p class="tiny faint" style="margin-top:8px">Harga impas = harga jual minimum agar tidak rugi. Harga target = harga agar margin mencapai ${pct(r.target, 0)}. “×” = jumlah baris karena jumlah barang tidak diketahui.</p>`;
  }

  function renderSimOut() {
    const box = $('#sim-out');
    if (!box || !last) return;
    const { r, st: s } = last;
    const g = (k, d) => (ok(sim[k]) ? sim[k] : d);
    const res = Engine.simulate({ listPrice: g('listPrice', 100000), disc: g('disc', 0), cost: g('cost', 60000), feePct: g('feePct', -r.totalFees / r.totalSales * 100),
      feeFixed: 0, packing: ok(s.packing) ? s.packing : 0, target: ok(s.targetMargin) ? s.targetMargin : 15 });
    if (!(res.price > 0)) { box.innerHTML = '<p class="muted small">Isi harga dan diskon yang masuk akal.</p>'; return; }
    const parts = [['Modal', res.cost, 'var(--ink-2)'], ['Potongan platform', res.fees, 'var(--cost)'], ['Packing', res.packing, 'var(--warn)'], ['Margin', Math.max(res.margin, 0), 'var(--accent)']].filter((p) => p[1] > 0);
    const tot = parts.reduce((a, p) => a + p[1], 0);
    box.innerHTML = `
      <span class="eyebrow">Margin per unit</span>
      <span class="sim-big ${res.margin < 0 ? 'neg' : ''}">${fmt(res.margin)} <span class="small faint">${pct(res.marginPct)}</span></span>
      <div class="stack" role="img" aria-label="Pembagian harga jual">${parts.map(([l, v, c]) => `<div title="${l}: ${fmt(v)}" style="flex:${v / tot};background:${c}"></div>`).join('')}</div>
      <div class="legend">${parts.map(([l, v, c]) => `<span><i class="sw" style="background:${c}"></i>${l} ${fmt(v)}</span>`).join('')}</div>
      <p class="small">Dibayar pembeli ${fmt(res.price)}. <b>Harga impas</b> ${fmt(res.breakEvenPrice)} · <b>harga untuk target</b> ${fmt(res.targetPrice)}.</p>
      <p class="small ${res.margin < 0 ? 'bad' : ''}"><b>${res.margin < 0 ? 'Rugi di harga ini.' : 'Batas aman:'}</b> diskon toko maksimal sekitar <b>${pct(res.maxDisc / 100)}</b> dari harga normal sebelum rugi.</p>`;
  }

  /* ---------- ekspor & laporan ---------- */
  function exportXlsx() {
    if (!last) return;
    if (!isPro()) return openPro('Ekspor Excel lengkap');
    const { r } = last;
    const R = (v) => (ok(v) ? Math.round(v) : '');
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const wb = XLSX.utils.book_new();
    const sum = [['Cek Profit', prof().store || ''], ['Periode data', `${r.first} s.d. ${r.last}`], [], ['Komponen', ...plats.map((k) => PNAME[k]), 'Total'],
      ['Pesanan terjual', ...plats.map((k) => r[k].orders), r.orders],
      ['Penjualan', ...plats.map((k) => R(r[k].sales)), R(r.totalSales)],
      ['Potongan platform', ...plats.map((k) => R(r[k].feeTotal)), R(r.totalFees)],
      ['Dana diterima', ...plats.map((k) => R(r[k].received)), R(r.totalReceived)],
      ['Modal', ...plats.map((k) => R(-r[k].modal)), R(-r.totalModal)],
      ['Packing', ...plats.map((k) => R(-r[k].packing)), R(-r.totalPacking)],
      ['Retur hilang', ...plats.map(() => ''), R(-r.lostCertain)],
      ['Margin', ...plats.map((k) => R(r[k].margin)), R(r.totalMargin)],
      ['Biaya operasional', ...plats.map(() => ''), R(-r.opex)],
      ['Laba bersih', ...plats.map(() => ''), R(r.netProfit)],
      ['Porsi penjualan dengan modal diketahui', ...plats.map((k) => +(r[k].coverage * 100).toFixed(1)), +(r.coverage * 100).toFixed(1)]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bulan pesanan', 'Penjualan', 'Potongan', 'Dana diterima', 'Margin', 'Laba bersih', ...plats.flatMap((k) => [`Penjualan ${PNAME[k]}`, `Margin ${PNAME[k]}`])],
      ...r.months.map((m) => [m.month, R(m.total.sales), R(m.total.fees), R(m.total.received), R(m.total.margin), R(m.total.net), ...plats.flatMap((k) => [R(m[k].sales), R(m[k].margin)])])]), 'Per bulan');
    if (r.products.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'Kode', 'Produk', 'Terjual', 'Penjualan', 'Dana diterima', 'Modal', 'Margin', 'Margin %', 'Modal/unit', 'Harga rata-rata', 'Harga impas', 'Harga target', 'Status'],
      ...[...r.products].sort((a, b) => (ok(b.margin) ? b.margin : -1e15) - (ok(a.margin) ? a.margin : -1e15)).map((p) => [PNAME[p.platform], catKey(p), p.name, p.qtyKnown ? Math.round(p.qty) : '', R(p.sales), R(p.received), R(p.modal), R(p.margin), ok(p.pct) ? +(p.pct * 100).toFixed(1) : '', R(p.unitCost), R(p.avgPrice), R(p.breakEven), R(p.targetPrice), p.health])]), 'Produk');
    if (r.insights.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tingkat', 'Temuan', 'Rincian', 'Saran'], ...r.insights.map((i) => [i.level, i.title, i.detail, i.action])]), 'Temuan');
    if (r.cases.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Platform', 'No. pesanan', 'Produk', 'Kategori', 'Alasan', 'Resi retur', 'Nilai refund', 'Est. modal', 'Status barang'],
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
    if (!isPro()) return openPro('Laporan PDF siap kirim');
    buildReport();
    const old = document.title;
    const p = prof();
    document.title = `Laporan Profit ${p.store || 'Toko'} ${last.r.first} sd ${last.r.last}`;
    const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    track(demo ? 'pdf-contoh' : 'unduh-pdf');
    toast('Pilih “Simpan sebagai PDF” di jendela cetak.');
    setTimeout(() => window.print(), 50);
  }

  /* ---------- event ---------- */
  document.addEventListener('input', (e) => {
    const t = e.target, id = t.id || '', v = t.value;
    if (demo && !id.startsWith('sim-') && id !== 'q' && id !== 'cost-q') return;
    const num = (x, lo, hi) => (x === '' ? null : Math.min(hi, Math.max(lo, +x)));
    if (id === 's-mitra') settings.mitra = num(v, 0, 99);
    else if (id === 's-packing') settings.packing = num(v, 0, 1e9);
    else if (id === 's-coret') settings.coret = Math.max(1, +v || 100);
    else if (id === 's-fallback') settings.fallbackPct = num(v, 0, 99);
    else if (id === 's-target') settings.targetMargin = num(v, 0, 80) ?? 15;
    else if (id.startsWith('p-')) { const [, f, i] = id.split('-'); const p = settings.periods[+i]; if (f === 'start') p.start = v; else p[f] = +v || 0; }
    else if (id.startsWith('fc-')) { const [, f, i] = id.split('-'); const c = settings.fixedCosts[+i]; if (f === 'label') { c.label = v; save(); return; } c.amount = num(v, 0, 1e12); }
    else if (id === 'pf-store' || id === 'pf-owner') { profile[id === 'pf-store' ? 'store' : 'owner'] = v; saveProfile(); return; }
    else if (id === 'q') { view.q = v; renderProducts(); return; }
    else if (id === 'cost-q') { view.costQ = v; renderCostTable(); return; }
    else if (id.startsWith('sim-')) { sim[id.slice(4)] = v === '' ? null : +v; renderSimOut(); return; }
    else return;
    save();
    clearTimeout(render.t);
    render.t = setTimeout(() => { const a = document.activeElement && document.activeElement.id; render(); if (a && $(`#${a}`)) { const el = $(`#${a}`); el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }, 250);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.cost !== undefined) { setProductCost(t.dataset.cost, t.value); render(); return; }
    if (t.dataset.case) { caseState[t.dataset.case] = t.value; store.set(KEYS.cases, caseState); render(); }
    else if (t.id === 'from') { view.from = t.value; render(); }
    else if (t.id === 'to') { view.to = t.value; render(); }
    else if (t.id === 'sort') { view.sort = t.value; renderProducts(); }
    else if (t.id === 'file-input') { addFiles(t.files); t.value = ''; }
    else if (t.id === 'tpl-input') { addFiles(t.files); t.value = ''; }
    else if (t.id === 'pf-logo' && t.files[0]) {
      const f = t.files[0];
      if (f.size > 400000) { toast('Logo maksimal 400 KB.'); t.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { profile.logo = rd.result; saveProfile(); renderSettings(); };
      rd.readAsDataURL(f); t.value = '';
    }
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a[data-track], [data-open-pro]');
    if (!t) return;
    if (t.dataset.track) { track(t.dataset.track); return; }
    if (t.dataset.openPro !== undefined) { openPro(t.dataset.openPro || ''); track('buka-pro'); return; }
    if (t.dataset.close !== undefined) { $('#pro-dialog').close(); return; }
    if (t.id === 'code-apply') {
      const res = await checkLicense($('#code-input').value, false);
      if (res.ok) { $('#pro-dialog').close(); toast(`Pro aktif${res.name ? ` · ${res.name}` : ''}. Terima kasih!`); track('kode-aktif'); render(); }
      else $('#code-msg').innerHTML = `<span class="bad">${esc(res.reason)}</span>`;
      return;
    }
    if (t.id === 'pro-remove') { store.del(KEYS.license); license = { ok: false }; renderProBtn(); $('#pro-dialog').close(); render(); return; }
    if (t.dataset.mode && !demo) { settings.modalMode = t.dataset.mode; save(); render(); return; }
    if (t.dataset.del !== undefined) { settings.periods.splice(+t.dataset.del, 1); save(); render(); }
    else if (t.id === 'add-period') { const p = settings.periods[settings.periods.length - 1]; settings.periods.push({ start: '', markup: p.markup, disc: p.disc }); save(); renderSettings(); }
    else if (t.dataset.fcDel !== undefined) { settings.fixedCosts.splice(+t.dataset.fcDel, 1); save(); render(); }
    else if (t.id === 'fc-add') { settings.fixedCosts.push({ label: '', amount: null }); save(); renderSettings(); const i = settings.fixedCosts.length - 1; $(`#fc-label-${i}`).focus(); }
    else if (t.id === 'pf-logo-del') { profile.logo = ''; saveProfile(); renderSettings(); }
    else if (t.id === 'tpl-download') downloadTemplate();
    else if (t.id === 'cost-all') { view.costAll = !view.costAll; renderCostTable(); }
    else if (t.id === 'demo-btn' || t.hasAttribute('data-demo')) { demo = true; files = []; resetView(); track('klik-demo'); renderFiles(); render(); $('#results').scrollIntoView({ behavior: 'smooth' }); }
    else if (t.id === 'clear-btn') { files = []; demo = false; resetView(); renderFiles(); render(); }
    else if (t.dataset.rm !== undefined) { files.splice(+t.dataset.rm, 1); renderFiles(); render(); }
    else if (t.dataset.platform) { view.platform = t.dataset.platform; render(); }
    else if (t.dataset.metric) { view.metric = t.dataset.metric; render(); }
    else if (t.id === 'show-all') { view.showAll = !view.showAll; renderProducts(); }
    else if (t.id === 'only-check') { view.onlyCheck = !view.onlyCheck; render(); }
    else if (t.id === 'go-modal') { $('#modal').scrollIntoView({ behavior: 'smooth' }); }
    else if (t.id === 'export') exportXlsx();
    else if (t.id === 'pdf') openReport();
    else if (t.id === 'wipe-btn') {
      if (!confirm('Hapus modal produk, pengaturan, profil toko, status retur, dan kode akses yang tersimpan di browser ini?')) return;
      Object.values(KEYS).forEach((k) => store.del(k)); store.del('cekprofit.v2');
      settings = structuredClone(DEFAULTS); profile = { store: '', owner: '', logo: '' }; caseState = {}; license = { ok: false };
      renderProBtn(); render(); toast('Data tersimpan sudah dihapus.');
    }
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  /* ---------- mulai ---------- */
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) demo = true;
  renderFiles(); render(); renderProBtn();
  const saved = store.get(KEYS.license, '');
  if (saved) checkLicense(saved, true).then(() => render());
  if (params.has('demo') && params.has('print')) { buildReport(); document.documentElement.classList.add('print-preview'); }
  if (params.has('pro')) openPro('');
  window.CekApp = { buildReport, state: () => ({ demo, files: files.length, license: license.ok, last }) };
})();
