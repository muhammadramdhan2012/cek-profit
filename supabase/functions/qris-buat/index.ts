// Edge Function qris-buat (Supabase, Deno). Logika & pengamanan: ../_shared/qris.mjs. Secret: lihat docs/usulan/QRIS_MIDTRANS.md.
import { handleBuat } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleBuat(req, { env: Deno.env.toObject() }));
