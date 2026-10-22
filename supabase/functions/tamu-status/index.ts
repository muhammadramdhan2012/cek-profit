// Edge Function tamu-status (Supabase, Deno). Tanpa login: deploy dengan --no-verify-jwt. Logika: ../_shared/qris.mjs.
import { handleTamuStatus } from '../_shared/qris.mjs';

Deno.serve((req: Request) => handleTamuStatus(req, { env: Deno.env.toObject() }));
