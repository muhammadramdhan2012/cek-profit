// Edge Function duitku-callback: menerima notifikasi pembayaran dari server Duitku (POST x-www-form-urlencoded).
// Deploy dengan "Enforce JWT verification" DIMATIKAN, karena Duitku tidak mengirim token Supabase.
//
// Fungsi ini TIDAK memutuskan apa pun sendiri: semua parameter diteruskan ke fungsi database duitku_terima(),
// yang memeriksa tanda tangan HMAC-SHA256 dengan kunci di Vault, kode merchant, nominal, dan status pesanan.
// Jadi walaupun ada yang memanggil URL ini dengan data palsu, Pro tidak akan aktif. TANPA service_role: hanya anon key.
//
// Balasan 200 hanya bila database menerima notifikasi; selain itu non-200 agar Duitku mencoba lagi
// (hingga 5 kali) dan mengirim email pemberitahuan ke pemilik.

type Env = (nama: string) => string | undefined;
type FetchFn = typeof fetch;

// Hanya kolom yang dibutuhkan yang diteruskan (data lain dari Duitku, mis. nama pembayar, tidak disimpan).
const KOLOM = ['merchantCode', 'amount', 'merchantOrderId', 'resultCode', 'reference', 'paymentCode', 'signature'] as const;

export function ambilKolom(form: URLSearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of KOLOM) o[k] = (form.get(k) ?? '').slice(0, 200);
  return o;
}

export function buatHandler(env: Env, fetchFn: FetchFn = fetch) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('Metode tidak didukung', { status: 405 });
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY') || env('CEK_ANON_KEY');   // CEK_ANON_KEY: cadangan bila proyek tidak menyediakan anon key lama (nilainya kunci publik di config.js)
    if (!url || !anon) return new Response('Belum disiapkan', { status: 500 });
    let form: URLSearchParams;
    try {
      const jenis = req.headers.get('Content-Type') || '';
      const teks = await req.text();
      form = jenis.includes('application/json') ? new URLSearchParams(JSON.parse(teks)) : new URLSearchParams(teks);
    } catch {
      return new Response('Format tidak dikenal', { status: 400 });
    }
    const data = ambilKolom(form);
    const r = await fetchFn(`${url}/rest/v1/rpc/duitku_terima`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    let hasil: { ok?: boolean; hasil?: string } = {};
    try { hasil = await r.json(); } catch { /* bukan JSON */ }
    // Log tanpa tanda tangan atau kunci: cukup nomor pesanan & hasil, untuk menelusuri bila ada keluhan.
    console.log('duitku callback', data.merchantOrderId, data.resultCode, r.status, hasil.hasil ?? '');
    if (r.ok && hasil.ok) return new Response('OK', { status: 200 });
    return new Response('Ditolak', { status: r.ok ? 400 : 502 });
  };
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve(buatHandler((n: string) => D.env.get(n)));
