/* Laporan PDF (dicetak lewat browser → "Simpan sebagai PDF").
 * CekReport.html(r, ctx) menghasilkan HTML halaman A4; gaya ada di report.css (@media print).
 * Warna grafik ditulis langsung (bukan variabel tema) agar hasil cetak selalu terang dan konsisten.
 */
const CekReport = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const rp = (v) => (ok(v) ? `${Math.round(v) < 0 ? '−' : ''}Rp${Math.abs(Math.round(v)).toLocaleString('id-ID')}` : '—');
  const short = (v) => { if (!ok(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`; if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`; if (a >= 1e3) return `${s}${Math.round(a / 1e3)} rb`; return `${s}${Math.round(a)}`; };
  const pc = (v, d = 1) => (ok(v) ? `${(v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '—');
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const BULAN_P = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const tgl = (d) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${+dd} ${BULAN_P[+m - 1]} ${y}`; };
  const mlabel = (k) => { const [y, m] = k.split('-'); return `${BULAN[+m - 1]} ${y.slice(2)}`; };
  const PN = { shopee: 'Shopee', tiktok: 'TikTok Shop' };
  const COL = { shopee: '#eb6834', tiktok: '#2a78d6', accent: '#0e7a5a', cost: '#c2412d', ink: '#13211b', ink2: '#4b5a52', ink3: '#7a867f', line: '#dfe3d9', soft: '#eef0ea', mark: '#f4c542' };

  function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x || 1)); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

  // Status laba bulanan dari metadata engine (bulan tanpa penjualan bermodal: laba BELUM DIKETAHUI, bukan Rp0).
  const mStat = (t) => (!t || !t.orders ? 'kosong' : t.statusHpp || 'lengkap');
  const mKnown = (t) => { const x = mStat(t); return x === 'sebagian' || x === 'lengkap'; };
  /** Grafik batang bulanan: penjualan (abu) dan margin (hijau). */
  function monthChart(r) {
    const ms = r.months;
    if (!ms.length) return '';
    const W = 700, H = 230, L = 52, R = 6, T = 10, B = 26;
    const vals = ms.flatMap((m) => [m.total.sales, r.ready && mKnown(m.total) ? m.total.margin : 0]);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const step = niceStep((hi - lo) / 4 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const band = (W - L - R) / ms.length, bw = Math.min(22, band * 0.34);
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${COL.line}" ${Math.abs(v) < 1e-9 ? '' : 'stroke-dasharray="2 3"'}/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${short(v)}</text>`;
    ms.forEach((m, i) => {
      const cx = L + band * i + band / 2;
      const bar = (v, x, c) => `<rect x="${x}" y="${Math.min(y(0), y(v))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2" fill="${c}"/>`;
      g += bar(m.total.sales, cx - bw - 1, '#b9c2bc');
      if (r.ready && mKnown(m.total)) g += bar(m.total.margin, cx + 1, m.total.margin < 0 ? COL.cost : COL.accent);
      else if (r.ready) g += `<text x="${cx + 1 + bw / 2}" y="${y(0) - 4}" text-anchor="middle" font-weight="700">?</text>`;
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${mlabel(m.month)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="rchart">${g}</svg>
      <div class="rlegend"><span><i style="background:#b9c2bc"></i>Penjualan</span>${r.ready ? `<span><i style="background:${COL.accent}"></i>Laba setelah modal</span>` : ''}${r.ready && ms.some((m) => mStat(m.total) === 'tidak_diketahui') ? '<span>? = laba belum diketahui (modal belum ada)</span>' : ''}</div>`;
  }
  /** Sel laba bulanan: Belum diketahui / nilai (+ tanda * bila modal hanya sebagian) / — . */
  const mLaba = (r, t, v) => {
    const x = mStat(t);
    if (!r.ready || x === 'kosong') return '—';
    if (x === 'tidak_diketahui') return '<span class="f">Belum diketahui</span>';
    return `${rp(v)}${x === 'sebagian' ? '*' : ''}`;
  };
  /** Batang horizontal sederhana. Nilai yang tidak diketahui (NaN) tidak diberi batang dan tidak dianggap 0. */
  const hbars = (rows, total, color = COL.cost) => {
    const max = Math.max(...rows.filter((x) => ok(x.v)).map((x) => Math.abs(x.v)), 1);
    return `<table class="rbars">${rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="trk">${ok(x.v) ? `<i style="width:${(Math.abs(x.v) / max) * 100}%;background:${x.color || color}"></i>` : ''}</td><td class="n">${ok(x.v) ? rp(x.v) : 'Nilai belum diketahui'}</td><td class="n f">${total && ok(x.v) ? pc(Math.abs(x.v) / total) : ''}</td></tr>`).join('')}</table>`;
  };
  const ICON = { bad: '!', warn: '!', good: '✓', info: 'i' };
  /** Label kategori retur untuk pembaca. "Tidak dikirim" berasal dari alasan di marketplace: indikasi, bukan fakta. */
  const catLabel = (c) => (c.cat === 'tidak_dikirim' ? 'Terindikasi tidak dikirim (menurut alasan di marketplace)' : c.label);

  function html(r, ctx) {
    const s = ctx.settings || {}, p = ctx.profile || {};
    const plats = ['shopee', 'tiktok'].filter((k) => r.has[k]);
    const store = p.store || 'Toko Anda';
    const hasOpex = r.fixedMonthly > 0;
    const marginPct = r.ready && r.knownSales ? r.totalMargin / r.knownSales : NaN;
    const created = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const f = ctx.filter || {};
    const periodNote = f.from || f.to ? `Bulan pesanan ${f.from ? mlabel(f.from) : 'awal'} – ${f.to ? mlabel(f.to) : 'akhir'}` : 'Seluruh data yang diunggah';
    const best = plats.length === 2 && r.ready && ok(r.shopee.margin) && ok(r.tiktok.margin) && r.shopee.knownSales && r.tiktok.knownSales
      ? (r.shopee.margin / r.shopee.knownSales > r.tiktok.margin / r.tiktok.knownSales ? 'shopee' : 'tiktok') : null;
    const header = (title, no) => `<header class="rhead"><span>${esc(store)} · Laporan Profit</span><span>${esc(title)}</span><span>${no}</span></header>`;
    const foot = `<footer class="rfoot">Dibuat dengan ${esc(ctx.brand)} · ${esc(created)} · Angka adalah estimasi dari laporan marketplace dan data modal penjual.</footer>`;
    const products = r.products.filter((x) => ok(x.margin));
    const top = [...products].sort((a, b) => b.margin - a.margin).slice(0, 10);
    const weak = r.products.filter((x) => x.health === 'rugi' || x.health === 'tipis');
    const weakNoUnit = weak.filter((x) => !ok(x.targetPrice)).length;
    const attention = weak.filter((x) => ok(x.targetPrice)).sort((a, b) => (a.health === b.health ? (a.pct || 0) - (b.pct || 0) : a.health === 'rugi' ? -1 : 1)).slice(0, 12);
    const refunds = r.cases.filter((c) => c.cat !== 'batal');
    // Nominal refund yang tidak diketahui tidak dijumlahkan sebagai 0; jumlah kasusnya disebut terpisah.
    const refundAmt = refunds.reduce((a, c) => a + (ok(c.amount) ? c.amount : 0), 0);
    const refundNoValue = refunds.filter((c) => !ok(c.amount)).length;
    const rb = (r.kepastian && r.kepastian.risikoBarang) || {};
    const lostNoValue = rb.kerugianTanpaNilai || 0, riskNoValue = rb.risikoTanpaNilai || 0;
    // Dana dari pesanan yang dikeluarkan dari laba (modal tidak diketahui), langsung dari engine.
    const cak = r.kepastian && r.kepastian.cakupan;
    const excludedOf = (k) => (cak ? cak.perMarketplace[k].dikeluarkan.danaDiterima : r[k].received - r[k].knownReceived);
    const excludedAll = cak ? cak.dikeluarkan.danaDiterima : r.totalReceived - r.knownReceived;

    // ringkasan naratif
    const narr = [
      `Selama periode ${tgl(r.first)} sampai ${tgl(r.last)}, ${esc(store)} mencatat <b>${r.orders.toLocaleString('id-ID')} pesanan</b> dengan penjualan <b>${rp(r.totalSales)}</b> di ${plats.map((k) => PN[k]).join(' dan ')}.`,
      `Marketplace memotong <b>${rp(-r.totalFees)}</b> (${pc(-r.totalFees / r.totalSales)} dari penjualan), sehingga dana yang diterima ${rp(r.totalReceived)}.`,
      r.ready ? `Setelah modal barang${r.totalPacking ? ', packing' : ''}${r.lostCertain ? ' dan barang retur yang hilang' : ''}, laba setelah modal <b>${rp(r.totalMargin)}</b> (${pc(marginPct)} dari penjualan yang modalnya diketahui)${hasOpex ? `; setelah biaya operasional yang tercatat ${rp(r.opex)}, laba dari data tersedia <b>${rp(r.netProfit)}</b>` : ''}.` : 'Modal barang belum diisi, sehingga laba belum dapat dihitung.',
      r.ready && r.coverage < 0.98 ? `Catatan: modal baru diketahui untuk ${pc(r.coverage, 0)} penjualan; laba di laporan ini hanya mencakup bagian tersebut.` : '',
      best ? `${PN[best]} memberi margin per rupiah penjualan yang lebih tinggi pada periode ini.` : '',
    ].filter(Boolean).join(' ');

    // "Laba per bulan" (engine: laba ÷ bulan data) hanya sah bila data mencakup minimal satu bulan. Di bawah itu angkanya
    // ekstrapolasi (data 1 hari → ±30× laba periode), jadi yang tampil laba periode data yang sebenarnya.
    const perMonthOk = r.ready && ok(r.perMonth) && r.monthsSpan >= 1;
    const kpi = (label, value, sub, cls = '') => `<div class="rkpi ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;

    // HPP yang belum diketahui tidak ditulis Rp0 (status dari engine). Rp0 hanya bila HPP memang 0 menurut data.
    const UNK = '<span class="f">Belum diketahui</span>';
    const st = r.statusHpp || { total: r.ready ? 'lengkap' : 'tidak_diketahui' };
    const hk = (k) => st[k] !== 'tidak_diketahui';
    const rh = (k, v) => (hk(k) && ok(v) ? rp(v) : UNK);
    const plRows = [
      ['Pesanan terjual', (k) => r[k].orders.toLocaleString('id-ID'), r.orders.toLocaleString('id-ID'), ''],
      ['Penjualan', (k) => rp(r[k].sales), rp(r.totalSales), '100%', 'b'],
      ['Potongan platform', (k) => rp(r[k].feeTotal), rp(r.totalFees), pc(-r.totalFees / r.totalSales), 'neg'],
      ['Dana diterima', (k) => rp(r[k].received), rp(r.totalReceived), pc(r.totalReceived / r.totalSales), 'b'],
      ['Modal barang', (k) => rh(k, -r[k].modal), rh('total', -r.totalModal), r.ready ? pc(r.totalModal / r.totalSales) : '—', 'neg'],
      ...(r.totalPacking ? [['Packing', (k) => rh(k, -r[k].knownPacking), rh('total', -r.knownPacking), r.ready ? pc(r.knownPacking / r.totalSales) : '—', 'neg']] : []),
      ...(r.coverage < 0.98 && r.ready ? [['Dana dari pesanan tanpa modal (tidak dihitung)', (k) => rp(-excludedOf(k)), rp(-excludedAll), '', 'neg f']] : []),
      ...(r.lostCertain || lostNoValue ? [[`Barang retur hilang${lostNoValue ? ` (${lostNoValue} kasus tanpa nilai belum dikurangkan)` : ''}`, () => '', r.lostCertain ? rp(-r.lostCertain) : '—', r.lostCertain ? pc(r.lostCertain / r.totalSales) : '', 'neg']] : []),
      ['Laba setelah modal', (k) => rh(k, r[k].margin), rh('total', r.totalMargin), pc(marginPct), 'total'],
      ...(hasOpex ? [['Biaya operasional', () => '', rp(-r.opex), pc(r.opex / r.totalSales), 'neg'], ['Laba dari data tersedia (setelah biaya operasional)', () => '', rp(r.netProfit), pc(r.netProfit / r.totalSales), 'total']] : []),
    ];

    return `
${ctx.demo ? '<div class="rwatermark">CONTOH</div>' : ''}
<section class="rpage rcover">
  <div class="rbrand">${p.logo ? `<img src="${esc(p.logo)}" alt="">` : `<svg width="34" height="34" viewBox="0 0 30 30"><rect width="30" height="30" rx="8" fill="${COL.accent}"/><path d="M7 20.5l5-5 3.5 3 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="10.5" r="2.4" fill="${COL.mark}"/></svg>`}
    <span>${p.logo ? esc(store) : esc(ctx.brand)}</span></div>
  <div class="rtitle">
    <span class="reyebrow">Laporan profit toko online</span>
    <h1>${esc(store)}</h1>
    <p class="rperiod">${tgl(r.first)} – ${tgl(r.last)}</p>
    <p class="rmeta">${plats.map((k) => PN[k]).join(' · ')} · ${esc(periodNote)}${p.owner ? `<br>${esc(p.owner)}` : ''}<br>Dibuat ${esc(created)}</p>
  </div>
  <div class="rkpis">
    ${kpi('Penjualan', rp(r.totalSales), `${r.orders.toLocaleString('id-ID')} pesanan`)}
    ${kpi('Potongan platform', pc(-r.totalFees / r.totalSales), rp(-r.totalFees))}
    ${kpi('Laba setelah modal', rp(r.totalMargin), r.ready ? `margin ${pc(marginPct)} dari penjualan bermodal` : 'modal belum diisi')}
    ${hasOpex ? kpi('Laba dari data tersedia', rp(r.netProfit), `setelah biaya operasional yang tercatat ${short(r.opex)}`, 'hero')
    : perMonthOk ? kpi('Laba per bulan', rp(r.perMonth), `rata-rata ${(Math.round(r.monthsSpan * 10) / 10).toLocaleString('id-ID')} bulan data`, 'hero')
      : kpi('Laba periode data', rp(r.totalMargin), r.ready ? `dari ${r.days.toLocaleString('id-ID')} hari data, belum sebulan penuh` : 'modal belum diisi', 'hero')}
  </div>
  <div class="rsummary"><h2>Ringkasan</h2><p>${narr}</p></div>
  ${r.insights.length ? `<div class="rtop"><h2>Hal terpenting</h2><ol>${r.insights.slice(0, 4).map((i) => `<li><b>${esc(i.title)}.</b> ${esc(i.detail)}${i.action ? ` <em>${esc(i.action)}</em>` : ''}</li>`).join('')}</ol></div>` : ''}
  ${foot}
</section>

<section class="rpage">
  ${header('Laba rugi', '2')}
  <h2>Laporan laba rugi</h2>
  <p class="rlead">Dari penjualan sampai ${hasOpex ? 'laba dari data tersedia' : 'laba setelah modal'}, per platform. Persentase terhadap total penjualan, kecuali baris laba setelah modal: terhadap penjualan yang modalnya diketahui.</p>
  <table class="rtable">
    <thead><tr><th></th>${plats.map((k) => `<th>${PN[k]}</th>`).join('')}${plats.length > 1 ? '<th>Total</th>' : ''}<th>%</th></tr></thead>
    <tbody>${plRows.map(([label, fn, tot, share, cls = '']) => `<tr class="${cls}"><td>${esc(label)}</td>${plats.map((k) => `<td>${fn(k)}</td>`).join('')}${plats.length > 1 ? `<td>${tot}</td>` : ''}<td class="f">${share}</td></tr>`).join('')}</tbody>
  </table>
  <div class="rgrid2">
    ${plats.map((k) => { const F = r[k].fees; const rows = k === 'shopee'
      ? [['Biaya administrasi', F.admin], ['Gratis Ongkir XTRA', F.xtra], ['Biaya proses pesanan', F.proses], ['Komisi AMS', F.ams], ['Ongkir ditanggung penjual', F.ship], ['Biaya lain', F.lain]]
      : [['Komisi platform', F.platform], ['Komisi dinamis', F.dinamis], ['Biaya pemrosesan', F.proses], ['Ongkir', F.ongkir], ['Komisi afiliasi', F.afiliasi], ['Biaya lain', F.lain]];
      return `<div><h3><i class="rsw" style="background:${COL[k]}"></i>Rincian potongan ${PN[k]}</h3>${hbars(rows.filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => a[1] - b[1]).map(([label, v]) => ({ label, v })), r[k].sales)}</div>`; }).join('')}
  </div>
  ${r.buckets.length > 1 ? `<h3 class="rmt">Potongan menurut nilai pesanan</h3>${hbars(r.buckets.map((b) => ({ label: `${b.label} (${b.orders.toLocaleString('id-ID')} pesanan)`, v: b.fees })), 0)}
    <p class="rnote">Persentase potongan: ${r.buckets.map((b) => `${esc(b.label)} ${pc(-b.fees / b.value)}`).join(' · ')}.</p>` : ''}
  ${foot}
</section>

<section class="rpage">
  ${header('Tren bulanan', '3')}
  <h2>Tren bulanan</h2>
  <p class="rlead">Menurut bulan pesanan dibuat.</p>
  ${monthChart(r)}
  <table class="rtable rsmall">
    <thead><tr><th>Bulan</th><th>Pesanan</th><th>Penjualan</th><th>Potongan</th><th>% potongan</th><th>Laba setelah modal</th><th>Margin %</th>${hasOpex ? '<th>Laba dari data tersedia</th>' : ''}</tr></thead>
    <tbody>${r.months.map((m) => `<tr><td>${BULAN_P[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)}</td><td>${m.total.orders.toLocaleString('id-ID')}</td><td>${rp(m.total.sales)}</td><td>${rp(m.total.fees)}</td>
      <td class="f">${pc(-m.total.fees / (m.total.sales || 1))}</td><td class="${m.total.margin < 0 && mKnown(m.total) ? 'neg' : ''}">${mLaba(r, m.total, m.total.margin)}</td><td class="f">${r.ready && mKnown(m.total) && m.total.knownSales ? pc(m.total.margin / m.total.knownSales) : '—'}</td>
      ${hasOpex ? `<td class="${m.total.net < 0 && mKnown(m.total) ? 'neg' : ''}">${mLaba(r, m.total, m.total.net)}</td>` : ''}</tr>`).join('')}
      <tr class="total"><td>Total</td><td>${r.orders.toLocaleString('id-ID')}</td><td>${rp(r.totalSales)}</td><td>${rp(r.totalFees)}</td><td class="f">${pc(-r.totalFees / r.totalSales)}</td><td>${rp(r.totalMargin)}</td><td class="f">${pc(marginPct)}</td>${hasOpex ? `<td>${rp(r.netProfit)}</td>` : ''}</tr></tbody>
  </table>
  ${r.ready && r.months.some((m) => mStat(m.total) === 'sebagian') ? '<p class="rnote">* Laba bulan itu hanya dari penjualan yang modalnya diketahui.</p>' : ''}${r.ready && r.months.some((m) => mStat(m.total) === 'tidak_diketahui') ? '<p class="rnote">Belum diketahui: bulan itu belum punya penjualan yang modalnya diketahui, jadi labanya tidak ditulis Rp0.</p>' : ''}
  ${foot}
</section>

${r.products.length ? `<section class="rpage">
  ${header('Produk', '4')}
  <h2>Analisis produk</h2>
  <p class="rlead">${r.products.length.toLocaleString('id-ID')} produk terjual. Harga impas = harga jual minimum agar tidak rugi; harga target = harga agar margin ${pc(r.target, 0)}.</p>
  ${top.length ? `<h3>10 produk dengan laba terbesar</h3>
  <table class="rtable rsmall"><thead><tr><th>Produk</th><th>Terjual</th><th>Penjualan</th><th>Laba</th><th>Margin</th></tr></thead>
    <tbody>${top.map((x) => `<tr><td><i class="rsw" style="background:${COL[x.platform]}"></i>${esc(x.name.slice(0, 70))}</td><td>${x.qtyKnown ? Math.round(x.qty).toLocaleString('id-ID') : `${x.rows}×`}</td><td>${rp(x.sales)}</td><td>${rp(x.margin)}</td><td class="f">${pc(x.pct)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${attention.length ? `<h3 class="rmt">Perlu perhatian: rugi atau di bawah target</h3>
  <table class="rtable rsmall"><thead><tr><th>Produk</th><th>Harga rata-rata</th><th>Modal/unit</th><th>Margin %</th><th>Harga impas</th><th>Harga target</th></tr></thead>
    <tbody>${attention.map((x) => `<tr><td><i class="rsw" style="background:${COL[x.platform]}"></i>${esc(x.name.slice(0, 60))} <span class="rtag ${x.health}">${x.health === 'rugi' ? 'Rugi' : 'Tipis'}</span></td>
      <td>${rp(x.avgPrice)}</td><td>${rp(x.unitCost)}</td><td class="f ${x.pct < 0 ? 'neg' : ''}">${pc(x.pct)}</td><td>${rp(x.breakEven)}</td><td><b>${rp(x.targetPrice)}</b></td></tr>`).join('')}</tbody></table>${weakNoUnit ? `<p class="rnote">${weakNoUnit} produk lain di bawah target belum punya modal per unit, sehingga saran harganya belum bisa dihitung.</p>` : ''}` : weakNoUnit ? `<p class="rnote">${weakNoUnit} produk di bawah target margin, tetapi modal per unitnya belum diisi sehingga saran harga belum bisa dihitung. Isi modal per produk untuk melihat harga impas dan harga target.</p>` : '<p class="rnote">Tidak ada produk yang rugi atau di bawah target margin.</p>'}
  ${foot}
</section>` : ''}

<section class="rpage">
  ${header('Temuan & catatan', r.products.length ? '5' : '4')}
  <h2>Temuan dan saran</h2>
  <ul class="rins">${r.insights.map((i) => `<li class="${i.level}"><span>${ICON[i.level]}</span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p>${i.action ? `<em>Saran: ${esc(i.action)}</em>` : ''}</div></li>`).join('')}</ul>
  ${foot}
</section>

<section class="rpage">
  ${header('Retur & metode', r.products.length ? '6' : '5')}
  ${refunds.length ? `<h2>Retur dan refund</h2>
    <p class="rnote">${refunds.length} kasus${refundNoValue === refunds.length ? ', nilainya belum diketahui' : ` senilai ${rp(refundAmt)} (${pc(refundAmt / r.totalSales)} dari penjualan)${refundNoValue ? `, ditambah ${refundNoValue} kasus yang nilainya belum diketahui` : ''}`}. ${r.cases.filter((c) => c.state === 'hilang').length} ditandai tidak kembali (${r.lostCertain || !lostNoValue ? `modal ${rp(r.lostCertain)} sudah dikurangkan` : 'belum ada nilai yang dikurangkan'}${lostNoValue ? `; ${lostNoValue} kasus tanpa nilai belum dikurangkan` : ''}); ${r.cases.filter((c) => c.state === 'belum').length} belum dicek (${!riskNoValue ? `risiko ${rp(r.unknownRisk)}` : r.unknownRisk ? `risiko ${rp(r.unknownRisk)} dari kasus yang bernilai, ditambah ${riskNoValue} kasus tanpa nilai` : `risiko belum bisa dihitung: ${riskNoValue} kasus tanpa nilai`}). Kasus yang terindikasi tidak dikirim berasal dari alasan di marketplace; kondisi barangnya belum dipastikan.</p>
    ${hbars(r.catSummary.filter((c) => c.cat !== 'batal').sort((a, b) => b.amountKnown - a.amountKnown).map((c) => ({ label: `${catLabel(c)} · ${PN[c.platform]} (${c.count}${c.amountUnknown ? `, ${c.amountUnknown} tanpa nilai` : ''})`, v: c.amountKnown ? -c.amountKnown : (c.amountUnknown ? NaN : 0) })), 0)}` : ''}
  <h2 class="rmt">Metode dan batasan</h2>
  <p class="rlead">Cara angka di laporan ini dihitung, agar pembaca bisa menilai tingkat keyakinannya.</p>
  <ul class="rmethod">
    <li>Periode: ${tgl(r.first)} – ${tgl(r.last)} (tanggal dana diterima). ${esc(periodNote)}. Modal diketahui untuk ${pc(r.coverage, 0)} penjualan.</li>
    <li>Sumber: laporan penghasilan resmi ${plats.map((k) => PN[k]).join(' dan ')}${r.hasOrderExport.shopee || r.hasOrderExport.tiktok ? ', export pesanan' : ''}${r.cases.length ? ', dan file retur' : ''}. Total tiap file dicocokkan dengan ringkasan resmi platform.</li>
    <li>${r.mode === 'acuan' ? 'Modal dihitung dari harga acuan pemasok dikurangi diskon pemasok, mengikuti pola harga jual yang diisi penjual.' : `Modal = modal per unit yang diisi penjual${ok(s.extraCostPct) && s.extraCostPct > 0 ? ` ditambah biaya kulakan ${String(s.extraCostPct).replace('.', ',')}%` : ''} × jumlah terjual${ok(s.fallbackPct) ? `; produk tanpa data modal memakai estimasi ${s.fallbackPct}% dari harga jual` : ''}.`} Pesanan tanpa modal tidak dihitung dalam margin.</li>
    ${r.qtyAssumed ? `<li>${r.qtyAssumed.toLocaleString('id-ID')} item Shopee memakai jumlah = 1 karena export pesanan tidak disertakan.</li>` : ''}
    <li>Laba setelah modal = dana diterima − modal${r.totalPacking ? ' − packing' : ''} − barang retur yang hilang. Margin = laba setelah modal ÷ penjualan yang modalnya diketahui. ${hasOpex ? `Laba dari data tersedia = laba setelah modal − biaya operasional yang tercatat ${rp(r.fixedMonthly)}/bulan × ${(Math.round(r.monthsSpan * 10) / 10).toLocaleString('id-ID')} bulan.` : 'Biaya operasional (gaji, sewa, iklan di luar platform) belum dimasukkan.'}</li>
    <li>Kompensasi dari platform${r.adjustments ? ` (${rp(r.adjustments)})` : ''} tidak ditambahkan ke laba. Pajak penghasilan belum diperhitungkan.</li>
    <li>Laporan ini adalah estimasi untuk pengambilan keputusan usaha, bukan laporan keuangan yang diaudit.</li>
  </ul>
  ${foot}
</section>`;
  }
  return { html };
})();
if (typeof module !== 'undefined') module.exports = CekReport;
