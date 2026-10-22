// Edge Function tamu-checkout (Supabase, Deno). Tanpa login: deploy dengan --no-verify-jwt. Logika: ../_shared/qris.mjs.
import { handleTamuCheckout } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleTamuCheckout(req, { env: Deno.env.toObject() }));
