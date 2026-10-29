// Persists the Google provider tokens captured right after OAuth login,
// so the server side can call the Calendar API even after the Supabase
// session refreshes (provider_token is only present in the fresh session).
// POST (JWT): { provider_token, provider_refresh_token? }

import { corsHeaders, json } from "../_shared/cors.ts";
import { getUser, serviceClient } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const user = await getUser(req);
  if (!user) return json({ ok: false, reason: "unauthorized" }, 401);

  const body = (await req.json()) as {
    provider_token?: string;
    provider_refresh_token?: string;
    expires_in?: number;
  };
  if (!body.provider_token && !body.provider_refresh_token) {
    return json({ ok: false, reason: "no-tokens" }, 400);
  }

  await serviceClient().from("google_tokens").upsert(
    {
      user_id: user.id,
      access_token: body.provider_token ?? null,
      ...(body.provider_refresh_token
        ? { refresh_token: body.provider_refresh_token }
        : {}),
      expires_at: new Date(
        Date.now() + (body.expires_in ?? 3500) * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return json({ ok: true });
});
