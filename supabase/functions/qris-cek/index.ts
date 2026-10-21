// Edge Function qris-cek (Supabase, Deno). Logika & pengamanan: ../_shared/qris.mjs. Secret: lihat docs/usulan/QRIS_MIDTRANS.md.
import { handleCek } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleCek(req, { env: Deno.env.toObject() }));
