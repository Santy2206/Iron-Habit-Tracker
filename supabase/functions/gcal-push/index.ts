// Push local event changes -> Google Calendar.
// POST (JWT): { eventId } -> upsert | { gcalEventId } -> delete

import { corsHeaders, json } from "../_shared/cors.ts";
import { getUser, serviceClient } from "../_shared/auth.ts";
import {
  deleteEventFromGoogle,
  pushEventToGoogle,
  type LocalEvent,
} from "../_shared/google.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const user = await getUser(req);
  if (!user) return json({ ok: false, reason: "unauthorized" }, 401);

  const body = (await req.json()) as { eventId?: string; gcalEventId?: string };
  const admin = serviceClient();

  if (body.gcalEventId) {
    const ok = await deleteEventFromGoogle(user.id, body.gcalEventId);
    return json({ ok });
  }

  if (!body.eventId) return json({ ok: false }, 400);

  const { data: ev } = await admin
    .from("events")
    .select("*")
    .eq("id", body.eventId)
    .eq("user_id", user.id)
    .single();
  if (!ev) return json({ ok: false }, 404);

  const gcalId = await pushEventToGoogle(user.id, ev as LocalEvent);
  if (gcalId) {
    await admin
      .from("events")
      .update({
        ...(gcalId !== ev.gcal_event_id ? { gcal_event_id: gcalId } : {}),
        synced_at: new Date().toISOString(),
      })
      .eq("id", ev.id);
  }
  return json({ ok: !!gcalId });
});
