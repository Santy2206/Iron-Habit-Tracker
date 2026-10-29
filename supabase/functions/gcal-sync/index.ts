// Incremental pull Google Calendar -> local events for the calling user.
// POST (JWT) -> { ok, upserts, deletes }

import { corsHeaders, json } from "../_shared/cors.ts";
import { getUser } from "../_shared/auth.ts";
import { pullFromGoogle } from "../_shared/google.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const user = await getUser(req);
  if (!user) return json({ ok: false, reason: "unauthorized" }, 401);

  const result = await pullFromGoogle(user.id);
  return json(result);
});
