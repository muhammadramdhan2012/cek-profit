// Edge Function duitku-buat: membuat invoice Duitku untuk pesanan Cek Untung Pro.
// Dipanggil dashboard oleh pengguna yang login (header Authorization = token login pengguna).
//
// Prinsip keamanan (CLAUDE.md §2, rencana 5 Nov 2026):
// - TANPA service_role. Database dipanggil dengan anon key + token pengguna, jadi RLS & pemeriksaan di fungsi
//   database tetap berlaku. Harga dihitung database (pesanan_pro_buat), bukan dari browser.
// - Kunci Duitku hanya dibaca dari Secrets Supabase (DUITKU_MERCHANT_CODE_<MODE>, DUITKU_API_KEY_<MODE>);
//   tidak pernah ditulis ke log atau dikirim ke browser.
// - File laporan & data pembeli marketplace tidak pernah sampai ke sini; yang dikirim ke Duitku hanya email akun,
//   nama produk, dan nominal.
//
// Fungsi ini sengaja tanpa dependensi (hanya fetch & WebCrypto) agar bisa ditempel langsung di editor Supabase.

type Env = (nama: string) => string | undefined;
type FetchFn = typeof fetch;

const DUITKU_INVOICE: Record<string, string> = {
  sandbox: 'https://api-sandbox.duitku.com/api/merchant/createInvoice',
  production: 'https://api-prod.duitku.com/api/merchant/createInvoice',
};

// Asal halaman yang boleh memanggil fungsi ini (CORS): situs resmi dan preview Cloudflare Pages.
export function asalDiizinkan(origin: string | null): boolean {
  if (!origin) return false;
  return origin === 'https://cekuntung.id' || /^https:\/\/[a-z0-9-]+\.cekuntung\.pages\.dev$/.test(origin);
}

export function headerCors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (asalDiizinkan(origin)) h['Access-Control-Allow-Origin'] = origin as string;
  return h;
}

// HMAC-SHA256, hasil hex huruf kecil (format yang diminta Duitku).
export async function hmacHex(pesan: string, kunci: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(kunci), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(pesan)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Pesanan { order_id: string; harga: number; email: string; mode: string; produk?: string; lanjut: boolean; payment_url?: string }

export function isiInvoice(p: Pesanan, supabaseUrl: string, situs: string) {
  const produk = p.produk || 'Cek Untung Pro 1 tahun';
  return {
    paymentAmount: p.harga,
    merchantOrderId: p.order_id,
    productDetails: produk,
    email: p.email,
    customerVaName: 'Cek Untung',
    itemDetails: [{ name: produk, price: p.harga, quantity: 1 }],
    callbackUrl: `${supabaseUrl}/functions/v1/duitku-callback`,
    returnUrl: `${situs}/dashboard.html?bayar=${encodeURIComponent(p.order_id)}`,
    expiryPeriod: 60,
  };
}

function balas(status: number, isi: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(isi), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Pesan error database (RAISE '...: pesan') → teks untuk pengguna.
function pesanDb(teks: string): string {
  const m = /(PERLU_LOGIN|PEMBAYARAN_TUTUP|BATAS_PESANAN):\s*([^"]+)/.exec(teks);
  return m ? m[2].trim() : 'Pesanan belum bisa dibuat. Silakan coba lagi sebentar lagi.';
}

export function buatHandler(env: Env, fetchFn: FetchFn = fetch) {
  return async (req: Request): Promise<Response> => {
    const cors = headerCors(req.headers.get('Origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: asalDiizinkan(req.headers.get('Origin')) ? 204 : 403, headers: cors });
    if (req.method !== 'POST') return balas(405, { error: 'Metode tidak didukung.' }, cors);
    if (!asalDiizinkan(req.headers.get('Origin'))) return balas(403, { error: 'Asal permintaan tidak diizinkan.' }, cors);

    const token = req.headers.get('Authorization') || '';
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY') || env('CEK_ANON_KEY');   // CEK_ANON_KEY: cadangan bila proyek tidak menyediakan anon key lama (nilainya kunci publik di config.js)
    if (!/^Bearer\s+\S+$/.test(token)) return balas(401, { error: 'Silakan masuk dulu untuk membeli Pro.' }, cors);
    if (!url || !anon) return balas(500, { error: 'Pembayaran belum disiapkan. Silakan hubungi kami.' }, cors);
    const rpc = (nama: string, body: unknown) => fetchFn(`${url}/rest/v1/rpc/${nama}`, {
      method: 'POST', headers: { apikey: anon, Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    // 1. Pesanan dari database (harga, mode, dan hak beli diperiksa di sana).
    const r1 = await rpc('pesanan_pro_buat', {});
    const t1 = await r1.text();
    if (!r1.ok) return balas(r1.status === 401 ? 401 : 400, { error: pesanDb(t1) }, cors);
    const p = JSON.parse(t1) as Pesanan;
    if (p.lanjut && p.payment_url) return balas(200, { payment_url: p.payment_url, order_id: p.order_id, lanjut: true }, cors);

    // 2. Invoice Duitku.
    const mode = p.mode === 'production' ? 'production' : 'sandbox';
    const kode = env(`DUITKU_MERCHANT_CODE_${mode.toUpperCase()}`), kunci = env(`DUITKU_API_KEY_${mode.toUpperCase()}`);
    if (!kode || !kunci) return balas(500, { error: 'Pembayaran belum disiapkan. Silakan hubungi kami.' }, cors);
    const waktu = String(Date.now());
    let r2: Response;
    try {
      r2 = await fetchFn(DUITKU_INVOICE[mode], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'Accept': 'application/json',
          'x-duitku-signature': await hmacHex(kode + waktu, kunci), 'x-duitku-timestamp': waktu, 'x-duitku-merchantcode': kode,
        },
        body: JSON.stringify(isiInvoice(p, url, env('SITUS_URL') || 'https://cekuntung.id')),
      });
    } catch {
      return balas(502, { error: 'Layanan pembayaran sedang tidak bisa dihubungi. Silakan coba lagi.' }, cors);
    }
    const t2 = await r2.text();
    let inv: { statusCode?: string; reference?: string; paymentUrl?: string } = {};
    try { inv = JSON.parse(t2); } catch { /* balasan bukan JSON */ }
    if (!r2.ok || inv.statusCode !== '00' || !inv.reference || !inv.paymentUrl) {
      console.error('duitku createInvoice gagal', r2.status, inv.statusCode ?? '');   // tanpa kunci/token
      return balas(502, { error: 'Halaman pembayaran belum bisa dibuat. Silakan coba lagi sebentar lagi.' }, cors);
    }

    // 3. Simpan referensi & link bayar ke pesanan (fungsi database memeriksa pemilik dan domain link).
    const r3 = await rpc('pesanan_pro_set_referensi', { p_order_id: p.order_id, p_referensi: inv.reference, p_payment_url: inv.paymentUrl });
    if (!r3.ok) {
      console.error('simpan referensi gagal', r3.status);
      return balas(502, { error: 'Halaman pembayaran belum bisa dibuat. Silakan coba lagi sebentar lagi.' }, cors);
    }
    return balas(200, { payment_url: inv.paymentUrl, order_id: p.order_id, lanjut: false }, cors);
  };
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve(buatHandler((n: string) => D.env.get(n)));
