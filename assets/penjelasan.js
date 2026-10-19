/* Cek Profit — penjelasan setiap angka (tombol "?").
 *
 * Setiap entri berisi:
 *   t  judul
 *   a  artinya, dalam bahasa sehari-hari
 *   h  dari mana angkanya / cara menghitung
 *   b  cara membaca: kapan bagus, kapan perlu waspada (opsional)
 *   d  fungsi (r) → kalimat tambahan berdasarkan data yang sedang dibuka (opsional; r bisa null)
 * Teks ini tampil apa adanya (di-escape), jadi jangan menulis HTML di sini.
 */
const CekInfo = (() => {
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const rp = (v) => (ok(v) ? `${v < 0 ? '−' : ''}Rp${Math.abs(Math.round(v)).toLocaleString('id-ID')}` : '—');
  const pc = (v, d = 1) => (ok(v) ? `${(v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '—');

  const E = {
    /* ---------- nota & ringkasan ---------- */
    penjualan: {
      t: 'Penjualan',
      a: 'Uang yang dibayar pembeli untuk barang Anda, setelah diskon toko dan voucher toko, sebelum dipotong marketplace.',
      h: 'Diambil dari Laporan Penghasilan. Ongkir yang dibayar pembeli tidak termasuk karena diteruskan ke kurir. Pesanan yang batal atau direfund penuh tidak dihitung.',
      d: (r) => (r ? `Di data ini: ${rp(r.totalSales)} dari ${r.orders.toLocaleString('id-ID')} pesanan, rata-rata ${rp(r.totalSales / Math.max(r.orders, 1))} per pesanan.` : ''),
    },
    potongan: {
      t: 'Potongan marketplace',
      a: 'Semua biaya yang dipotong Shopee atau TikTok dari penjualan Anda: biaya admin/komisi, program gratis ongkir, biaya proses per pesanan, komisi afiliasi, dan ongkir yang ditanggung penjual.',
      h: 'Dijumlahkan dari kolom biaya di Laporan Penghasilan, per pesanan. Karena diambil dari laporan, angka ini sudah mengikuti tarif terbaru yang berlaku saat pesanan terjadi.',
      b: 'Umumnya 12–20% dari penjualan. Di atas 20% berarti banyak biaya program atau pesanan bernilai kecil. Rinciannya ada di bagian Rincian biaya pada halaman Laba.',
      d: (r) => (r && r.totalSales ? `Di data ini: ${pc(-r.totalFees / r.totalSales)} dari penjualan, rata-rata ${rp(-r.totalFees / Math.max(r.orders, 1))} per pesanan.` : ''),
    },
    tanpa_modal: {
      t: 'Dana dari pesanan yang HPP-nya belum diketahui',
      a: 'Uang yang Anda terima dari pesanan yang modal barangnya belum diisi, atau yang direfund sebagian tetapi jumlah barang yang direfund tidak tercatat.',
      h: 'Pesanan ini sengaja tidak dihitung dalam laba. Menganggap modalnya nol, atau memotong modal menurut nominal refund, bisa membuat laba terlihat lebih besar atau lebih kecil dari kenyataan.',
      b: 'Isi modal produk di menu Modal & HPP. Untuk refund sebagian, unggah file retur atau export pesanan yang mencatat jumlah barang yang direfund.',
    },
    modal: {
      t: 'Modal barang',
      a: 'Harga beli atau biaya produksi barang yang terjual.',
      h: 'Jumlah terjual × modal per unit yang Anda isi. Untuk reseller: harga acuan dikurangi diskon dari pemasok. Laporan marketplace tidak memuat angka ini, jadi sumbernya dari isian Anda.',
      b: 'Pastikan modal sudah termasuk biaya sampai barang siap dijual (misalnya ongkir dari supplier), tetapi tanpa ongkir ke pembeli.',
    },
    packing: {
      t: 'Packing',
      a: 'Biaya bungkus per pesanan: plastik, kardus, bubble wrap, lakban.',
      h: 'Biaya packing per pesanan yang Anda isi × jumlah pesanan terjual.',
    },
    retur_hilang: {
      t: 'Retur yang tidak kembali',
      a: 'Modal barang yang direfund ke pembeli tetapi barangnya tidak kembali ke Anda.',
      h: 'Dari file retur, hanya kasus yang Anda tandai "Tidak kembali". Nilainya perkiraan modal barang tersebut.',
      b: 'Kasus yang belum dicek tidak dikurangkan, tetapi ditampilkan sebagai risiko di bawah angka laba.',
    },
    margin_kotor: {
      t: 'Laba setelah modal',
      a: 'Perkiraan laba dari data yang tersedia setelah potongan marketplace, modal, packing, dan retur yang hilang, sebelum biaya operasional bulanan.',
      h: 'Dana diterima dari marketplace − modal − packing − retur yang tidak kembali. Hanya dari pesanan yang modalnya diketahui.',
    },
    opex: {
      t: 'Biaya operasional',
      a: 'Biaya tetap toko yang tidak tergantung jumlah pesanan: gaji admin, sewa, internet, iklan di luar marketplace.',
      h: 'Biaya per bulan yang Anda isi × lama periode data (dalam bulan).',
    },
    laba_bersih: {
      t: 'Laba dari data tersedia',
      a: 'Perkiraan laba dari data yang tersedia setelah modal dan biaya yang sudah tercatat, termasuk biaya operasional yang Anda isi. Ini bukan saldo kas.',
      h: 'Laba setelah modal − biaya operasional. Hanya dari pesanan yang modalnya diketahui. Biaya yang belum tercatat di laporan atau isian Anda belum termasuk.',
      b: 'Negatif berarti toko belum menutup biaya. Lihat Temuan dan saran untuk penyebab terbesarnya.',
    },
    margin_total: {
      t: 'Laba setelah modal',
      a: 'Perkiraan laba dari data yang tersedia: penjualan setelah potongan marketplace, modal, packing, dan retur yang hilang.',
      h: 'Dana diterima − modal − packing − retur yang tidak kembali. Hanya dari pesanan yang modalnya diketahui. Isi biaya operasional bulanan agar terlihat laba setelah biaya operasional yang tercatat.',
      b: 'Margin (laba dibagi penjualan) 10–25% umum untuk toko online. Di bawah 10% rawan rugi bila potongan naik.',
    },
    rata_bulan: {
      t: 'Rata-rata per bulan',
      a: 'Perkiraan laba rata-rata dalam satu bulan.',
      h: 'Total laba dibagi lama periode data dalam bulan (jumlah hari ÷ 30,4). Bila data belum sebulan penuh, yang tampil adalah laba periode data, bukan rata-rata per bulan, agar angkanya tidak dibesarkan.',
      b: 'Bandingkan dengan target laba bulanan Anda. Periode data yang pendek (kurang dari sebulan) membuat angka ini kurang stabil.',
    },
    margin_pesanan: {
      t: 'Laba per pesanan',
      a: 'Perkiraan laba rata-rata dari satu pesanan setelah potongan, modal, dan packing.',
      h: 'Total laba setelah modal dibagi jumlah pesanan terjual.',
      b: 'Bila angka ini kecil, satu pesanan retur atau satu voucher bisa menghapus laba beberapa pesanan lain.',
    },
    bulan_ini: {
      t: 'Bulan terakhir',
      a: 'Hasil bulan terakhir di data Anda dibanding bulan sebelumnya.',
      h: 'Dikelompokkan menurut tanggal pesanan dibuat. Bila bulan ini belum selesai, ditandai "berjalan" dan wajar bila angkanya lebih kecil.',
    },
    potongan_bulan: {
      t: 'Potongan bulan terakhir',
      a: 'Persentase potongan marketplace di bulan terakhir dibanding bulan sebelumnya.',
      h: 'Total potongan bulan itu dibagi penjualan bulan itu.',
      b: 'Bila naik, cek apakah ada kenaikan tarif, program baru yang Anda ikuti, atau lebih banyak pesanan bernilai kecil.',
    },
    modal_diketahui: {
      t: 'Modal diketahui',
      a: 'Seberapa banyak penjualan yang modalnya sudah Anda isi.',
      h: 'Penjualan dari pesanan bermodal ÷ seluruh penjualan.',
      b: 'Usahakan 95–100%. Di bawah itu, laba yang tampil hanya mewakili sebagian toko.',
    },
    target_laba: {
      t: 'Target laba per bulan',
      a: 'Berapa bulan di periode ini yang labanya mencapai target yang Anda isi.',
      h: 'Laba dari data tersedia (setelah biaya operasional yang tercatat, atau laba setelah modal bila biaya operasional kosong) per bulan dibanding target di Data & pengaturan.',
    },

    /* ---------- produk ---------- */
    terjual: {
      t: 'Terjual',
      a: 'Jumlah barang yang terjual.',
      h: 'Dari export pesanan. Tanda × berarti jumlah baris pesanan, karena laporan penghasilan Shopee tidak mencatat jumlah barang. Unggah export pesanan agar tepat.',
    },
    margin_produk: {
      t: 'Laba produk',
      a: 'Perkiraan laba dari produk ini setelah potongan marketplace, modal, dan packing.',
      h: 'Potongan dan packing satu pesanan dibagi ke produk-produk di dalamnya sesuai porsi harganya.',
    },
    margin_pct: {
      t: 'Margin',
      a: 'Laba produk dibagi penjualan produk ini, dalam persen. Menunjukkan perkiraan laba dari setiap Rp100 penjualan.',
      b: 'Bandingkan dengan target margin Anda. Produk dengan persen tinggi tetapi terjual sedikit tetap layak dipromosikan.',
    },
    harga_rata: {
      t: 'Harga rata-rata',
      a: 'Harga yang rata-rata dibayar pembeli untuk satu unit, setelah diskon toko.',
      h: 'Penjualan produk ÷ jumlah terjual. Hanya muncul bila jumlah barang diketahui.',
    },
    harga_impas: {
      t: 'Harga impas',
      a: 'Harga terendah agar produk tidak rugi. Di bawah harga ini, setiap penjualan mengurangi uang Anda.',
      h: '(modal per unit + packing per unit) ÷ (1 − persen potongan). Persen potongan diambil dari produk ini sendiri bila datanya cukup, atau dari rata-rata toko di platform tersebut.',
      b: 'Harga coret dan diskon boleh apa saja, asalkan harga yang dibayar pembeli tetap di atas angka ini.',
    },
    harga_target: {
      t: 'Harga target',
      a: 'Harga yang dibayar pembeli agar margin produk mencapai target Anda.',
      h: '(modal + packing per unit) ÷ (1 − persen potongan − target margin). Target margin diatur di menu Pengaturan.',
    },
    status: {
      t: 'Status produk',
      a: 'Rugi: laba negatif atau harga rata-rata di bawah harga impas. Tipis: untung, tetapi di bawah target margin. Sehat: di atas target.',
      b: 'Mulai perbaikan dari produk Rugi dengan penjualan terbesar.',
    },

    /* ---------- biaya ---------- */
    sumber_pesanan: {
      t: 'Sumber pesanan',
      a: 'Asal pesanan di Laporan Penghasilan TikTok Shop: dari aplikasi TikTok Shop atau dari Tokopedia. Pesanan Tokopedia sudah termasuk total TikTok Shop, bukan penjualan tambahan.',
      h: 'Diambil dari kolom "Sumber pesanan" di laporan. Penjualan = Total Pendapatan. Baris pesanan dihitung per baris laporan, tanpa pesanan batal atau direfund penuh.',
      b: 'Porsi penjualan bukan porsi laba. Laba, modal, dan potongan per sumber belum ditampilkan.',
    },
    jejak_uang: {
      t: 'Jejak uang',
      a: 'Alur uang dari penjualan, potongan marketplace, sampai dana pesanan yang dilepas marketplace, lalu ke laba dari data yang tersedia.',
      h: 'Penjualan sudah termasuk refund (refund sudah dikurangkan oleh marketplace), jadi refund hanya ditampilkan sebagai rincian dan tidak dikurangkan lagi. Penyesuaian dicatat terpisah dan belum masuk laba. Pencairan ke rekening belum dianalisis.',
      b: 'Status "Sesuai laporan dan terekonsiliasi" berarti jumlah baris setiap file cocok dengan ringkasan resmi di file itu dan dengan angka yang ditampilkan. "Berdasarkan laporan" berarti angkanya dari laporan tetapi belum bisa dicocokkan penuh, misalnya karena filter bulan aktif. "Perlu dicek" berarti ada selisih dengan ringkasan resmi.',
    },
    dana_diterima: {
      t: 'Dana diterima',
      a: 'Uang yang menjadi bagian Anda setelah potongan marketplace, menurut Laporan Penghasilan. Pencairan ke rekening belum dicocokkan.',
      h: 'Penjualan − potongan marketplace, sesuai Laporan Penghasilan. Totalnya dicocokkan dengan ringkasan resmi di file.',
    },
    tarif_efektif: {
      t: 'Tarif efektif toko Anda',
      a: 'Tarif potongan yang benar-benar Anda bayar, dipisah menjadi bagian persen dan biaya tetap per pesanan.',
      h: 'Biaya pemrosesan dihitung sebagai biaya tetap per pesanan; potongan lainnya dibagi penjualan. Karena diambil dari laporan, angka ini otomatis mengikuti tarif terbaru, kategori produk, dan program yang Anda ikuti.',
      b: 'Ini angka paling akurat untuk simulasi harga. Unggah laporan bulan terbaru agar tetap mutakhir.',
    },
    fee_admin: { t: 'Biaya administrasi (Shopee)', a: 'Persentase dari harga jual yang dipotong Shopee untuk setiap pesanan.', h: 'Besarnya tergantung kategori produk dan status toko (biasa atau Mall).' },
    fee_xtra: { t: 'Gratis Ongkir XTRA dan program sejenis', a: 'Biaya program opsional yang Anda ikuti, misalnya Gratis Ongkir XTRA atau Promo XTRA.', h: 'Persentase dari harga jual. Imbalannya: produk tampil dengan label program dan pembeli mendapat subsidi.', b: 'Bandingkan kenaikan pesanan dengan biayanya. Bila pesanan tidak naik berarti, program ini hanya mengurangi laba.' },
    fee_proses: { t: 'Biaya proses pesanan', a: 'Biaya tetap untuk setiap pesanan yang berhasil, berapa pun nilainya.', h: 'Sekitar Rp1.250 per pesanan.', b: 'Biaya tetap ini paling terasa di pesanan bernilai kecil. Bundling membantu menekannya.' },
    fee_ams: { t: 'Komisi AMS (afiliasi)', a: 'Komisi untuk affiliator atau iklan afiliasi yang membawa pembeli ke produk Anda.', h: 'Persentase sesuai yang Anda atur di program afiliasi.' },
    fee_ship: { t: 'Ongkir ditanggung penjual', a: 'Bagian ongkos kirim yang dibebankan ke Anda, termasuk ongkir pengembalian barang.', h: 'Dari kolom ongkir di Laporan Penghasilan.' },
    fee_lain: { t: 'Biaya lain', a: 'Potongan yang tidak masuk kolom lain, misalnya biaya pre-order atau biaya layanan baru.', h: 'Selisih antara total potongan dan kolom-kolom yang dikenali, sehingga totalnya tetap cocok dengan laporan.' },
    fee_platform: { t: 'Komisi platform (TikTok/Tokopedia)', a: 'Persentase dari harga jual yang dipotong TikTok Shop atau Tokopedia.', h: 'Besarnya tergantung kategori produk dan status toko.' },
    fee_dinamis: { t: 'Komisi dinamis', a: 'Komisi tambahan TikTok Shop yang dicatat terpisah dari komisi platform.', h: 'Besarnya mengikuti kategori dan program yang diikuti; dibaca langsung dari laporan.' },
    fee_tt_proses: { t: 'Biaya pemrosesan pesanan', a: 'Biaya tetap per pesanan di TikTok Shop dan Tokopedia.', h: 'Dibaca dari laporan. Sumber publik menyebut sekitar Rp1.250 per pesanan.' },
    fee_ongkir: { t: 'Ongkir', a: 'Ongkos kirim yang menjadi beban penjual setelah subsidi platform.', h: 'Dari kolom ongkir di Laporan Penghasilan TikTok.' },
    fee_afiliasi: { t: 'Komisi afiliasi', a: 'Komisi untuk kreator atau affiliator yang menjual produk Anda.', h: 'Gabungan semua kolom komisi afiliasi di laporan.' },
    potongan_nilai: {
      t: 'Potongan menurut nilai pesanan',
      a: 'Persentase potongan untuk pesanan kecil dibanding pesanan besar.',
      h: 'Pesanan dikelompokkan berdasarkan nilainya, lalu total potongan tiap kelompok dibagi penjualannya.',
      b: 'Biaya tetap per pesanan membuat pesanan kecil terpotong lebih besar. Bila pesanan di bawah Rp50 ribu rugi, pertimbangkan bundling atau minimal pembelian.',
    },

    /* ---------- retur ---------- */
    perkiraan_modal: { t: 'Perkiraan modal', a: 'Perkiraan harga beli barang di kasus retur ini.', h: 'Dari modal per unit produk tersebut, atau dari nilai refund × rasio modal bila produknya tidak dikenali.' },
    status_barang: { t: 'Status barang', a: 'Apakah barang retur sudah kembali ke gudang Anda.', h: 'Pilih Tidak kembali bila barang hilang atau rusak; modalnya akan dikurangkan dari laba. Kasus yang terindikasi tidak dikirim (menurut alasan di marketplace) belum bisa ditandai di sini; kondisi barangnya tetap perlu dipastikan.' },

    /* ---------- simulator ---------- */
    sim_margin: { t: 'Laba per unit', a: 'Perkiraan laba dari satu penjualan dengan harga dan diskon yang Anda isi. Persen di bawahnya adalah margin terhadap harga yang dibayar pembeli.', h: 'Harga dibayar pembeli − potongan marketplace (persen + biaya tetap) − modal − packing.' },
    sim_potongan: {
      t: 'Potongan marketplace di simulator',
      a: 'Perkiraan potongan untuk satu pesanan: bagian persen dari harga dan bagian tetap per pesanan.',
      h: 'Pilih "Dari laporan toko" untuk tarif yang benar-benar Anda bayar (paling akurat), atau "Tarif umum" untuk perkiraan dari tarif publik marketplace bila belum punya laporan.',
      b: 'Tarif umum adalah perkiraan per kelompok kategori. Angka pastinya ada di Seller Centre, menu biaya per kategori.',
    },
    sim_dibayar: { t: 'Dibayar pembeli', a: 'Harga setelah diskon toko. Inilah dasar potongan marketplace.', h: 'Harga jual normal × (1 − diskon toko).' },
    sim_diskon_maks: { t: 'Diskon maksimal', a: 'Diskon terbesar dari harga jual normal sebelum produk mulai rugi.', h: '1 − harga impas ÷ harga jual normal.', b: 'Negatif berarti harga normal pun sudah di bawah harga impas.' },

    /* ---------- data & modal ---------- */
    jenis_usaha: {
      t: 'Jenis usaha',
      a: 'Cara Anda mendapatkan barang. Pilihan ini mengatur cara modal dihitung dan fitur yang ditampilkan.',
      h: 'Reseller: modal dari harga acuan pemasok dikurangi diskon. Stok sendiri: harga beli per produk + biaya kulakan. Produsen: HPP dari bahan, tenaga, overhead, dan kemasan. Dropshipper: harga dari supplier per pesanan.',
    },
    diskon_pemasok: {
      t: 'Diskon dari pemasok',
      a: 'Potongan yang Anda dapat dari harga acuan saat membeli barang.',
      h: 'Contoh: harga sampul buku Rp100.000, Anda membeli Rp70.000, berarti diskon 30%. Modal = harga acuan × (1 − diskon).',
    },
    harga_coret: {
      t: 'Harga coret TikTok dibanding harga acuan',
      a: 'TikTok mencatat harga sebelum diskon (harga coret). Angka ini memberi tahu berapa harga coret itu dibanding harga acuan pemasok.',
      h: 'Isi 100% bila harga coret sama dengan harga acuan. Isi 110% bila harga coret Anda 10% di atas harga acuan.',
    },
    pola_shopee: {
      t: 'Pola harga Shopee',
      a: 'Laporan Shopee tidak mencatat harga sebelum diskon, jadi modal dihitung dari pola harga yang Anda pakai.',
      h: 'Harga jual = harga acuan × (1 + kenaikan) × (1 − diskon toko). Bila pola berubah, tambah periode baru; pesanan memakai pola sesuai tanggal pesanan.',
    },
    batas_aman: {
      t: 'Batas harga aman',
      a: 'Harga jual terendah dibanding harga acuan agar Anda tidak rugi, dan diskon terbesar yang masih aman.',
      h: 'Memakai diskon pemasok, packing, dan potongan marketplace (dari laporan Anda, atau tarif umum bila belum ada laporan).',
      b: 'Gunakan sebagai pagar saat ikut kampanye atau flash sale: jangan pasang harga di bawah batas impas.',
    },
    modal_rata: {
      t: 'Modal rata-rata',
      a: 'Perkiraan modal sebagai persen dari harga jual, untuk produk yang modalnya belum diisi.',
      h: 'Contoh: 60% berarti barang seharga Rp100.000 dianggap bermodal Rp60.000.',
      b: 'Praktis untuk gambaran cepat, tetapi kurang tepat. Isi modal per produk untuk hasil yang lebih akurat.',
    },
    biaya_kulakan: {
      t: 'Biaya kulakan',
      a: 'Biaya tambahan sampai barang ada di gudang Anda: ongkir dari supplier, biaya angkut, bea.',
      h: 'Ditulis sebagai persen dari harga beli dan ditambahkan ke modal setiap produk. Contoh: belanja Rp5 juta dengan ongkir Rp150 ribu = 3%.',
    },
    hpp: {
      t: 'HPP (harga pokok produksi)',
      a: 'Biaya membuat satu unit produk.',
      h: '(bahan baku + tenaga kerja + overhead untuk satu kali produksi) ÷ jumlah unit jadi + kemasan per unit. Overhead: listrik, gas, sewa dapur atau alat yang dipakai untuk produksi tersebut.',
      b: 'Gaji tetap dan sewa bulanan yang tidak terkait satu kali produksi lebih tepat diisi di Biaya operasional, agar tidak dihitung dua kali.',
    },
    dropship_fee: {
      t: 'Biaya dropship per pesanan',
      a: 'Biaya yang ditagih supplier untuk setiap pesanan selain harga barang, misalnya packing atau jasa kirim atas nama toko Anda.',
      h: 'Dikurangkan dari setiap pesanan terjual, sama seperti biaya packing.',
    },
    packing_in: { t: 'Packing per pesanan', a: 'Rata-rata biaya bungkus untuk satu pesanan.', h: 'Jumlahkan belanja bahan packing sebulan, bagi dengan jumlah pesanan sebulan.' },
    target_margin: { t: 'Target margin per produk', a: 'Persentase sisa uang yang Anda inginkan dari setiap penjualan.', h: 'Dipakai untuk status Tipis/Sehat dan harga target.', b: 'Banyak toko memakai 15–25%. Produk yang cepat laku boleh lebih rendah.' },
    target_laba_in: { t: 'Target laba per bulan', a: 'Laba bulanan yang ingin Anda capai.', h: 'Ditampilkan di ringkasan: berapa bulan yang mencapai target.' },
    opex_in: { t: 'Biaya operasional per bulan', a: 'Biaya tetap toko: gaji, sewa, internet, iklan di luar marketplace.', h: 'Iklan di dalam marketplace yang dipotong dari saldo iklan tidak tercatat di Laporan Penghasilan, jadi masukkan juga di sini.' },
  };

  /** @returns {{t:string,a:string,h?:string,b?:string,d?:string}|null} */
  function get(key, r) {
    const e = E[key];
    if (!e) return null;
    let d = '';
    try { d = e.d ? e.d(r) : ''; } catch (err) { d = ''; }
    return { t: e.t, a: e.a, h: e.h || '', b: e.b || '', d };
  }
  return { get, keys: () => Object.keys(E) };
})();
if (typeof module !== 'undefined') module.exports = CekInfo;
