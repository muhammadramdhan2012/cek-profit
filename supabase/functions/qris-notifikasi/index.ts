// Edge Function qris-notifikasi (Supabase, Deno). Logika & pengamanan: ../_shared/qris.mjs. Secret: lihat docs/usulan/QRIS_MIDTRANS.md.
import { handleNotifikasi } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleNotifikasi(req, { env: Deno.env.toObject() }));
