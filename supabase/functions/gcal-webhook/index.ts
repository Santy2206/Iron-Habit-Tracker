// Receives Google Calendar push notifications (no user JWT — Google calls
// this directly). Deploy with --no-verify-jwt.
// The channel id is the user_id (set by registerWatch).

import { corsHeaders, json } from "../_shared/cors.ts";
import { pullFromGoogle } from "../_shared/google.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const channelId = req.headers.get("x-goog-channel-id");
  const state = req.headers.get("x-goog-resource-state");

  if (channelId && state && state !== "sync") {
    // fire-and-forget: Google only needs a fast 2xx
    pullFromGoogle(channelId).catch(() => {});
  }
  return json({ ok: true });
});
