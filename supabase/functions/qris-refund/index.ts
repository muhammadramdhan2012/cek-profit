// Edge Function qris-refund (Supabase, Deno). Logika & pengamanan: ../_shared/qris.mjs. Secret: lihat docs/usulan/QRIS_MIDTRANS.md.
import { handleRefund } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleRefund(req, { env: Deno.env.toObject() }));
