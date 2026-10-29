import { serviceClient } from "./auth.ts";

const GCAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary";

/* capital <-> google colorId (mirrors src/lib/capitals.ts) */
export const CAPITAL_GCAL_COLOR: Record<string, string> = {
  productive: "3", // grape
  intellectual: "9", // blueberry
  social: "11", // tomato
  spiritual: "1", // lavender
  physical: "10", // basil
};
const COLOR_TO_CAPITAL: Record<string, string> = Object.fromEntries(
  Object.entries(CAPITAL_GCAL_COLOR).map(([k, v]) => [v, k]),
);

export interface LocalEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  gcal_event_id: string | null;
  task_id: string | null;
}

interface GcalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/* ------------------------------ tokens ------------------------------ */

export async function getGoogleAccessToken(
  userId: string,
): Promise<string | null> {
  const admin = serviceClient();
  const { data: row } = await admin
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!row?.access_token && !row?.refresh_token) return null;

  if (row.access_token && row.expires_at) {
    if (new Date(row.expires_at).getTime() - Date.now() > 60_000) {
      return row.access_token as string;
    }
  }
  if (!row.refresh_token) return row.access_token ?? null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token: string; expires_in: number };
  await admin
    .from("google_tokens")
    .update({
      access_token: j.access_token,
      expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return j.access_token;
}

/* ------------------------------ mapping ------------------------------ */

function toGcalEvent(ev: LocalEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: ev.title,
    description: ev.description ?? undefined,
    colorId: CAPITAL_GCAL_COLOR[ev.category],
    extendedProperties: { private: { capital: ev.category } },
  };
  if (ev.all_day) {
    body.start = { date: ev.start_at.slice(0, 10) };
    body.end = { date: ev.end_at.slice(0, 10) };
  } else {
    body.start = { dateTime: ev.start_at };
    body.end = { dateTime: ev.end_at };
  }
  return body;
}

function fromGcalEvent(ge: GcalEvent, userId: string) {
  const allDay = !ge.start?.dateTime;
  return {
    user_id: userId,
    title: ge.summary || "(sin título)",
    description: ge.description ?? null,
    category:
      ge.extendedProperties?.private?.capital ??
      (ge.colorId ? COLOR_TO_CAPITAL[ge.colorId] : undefined) ??
      "productive",
    start_at: allDay ? `${ge.start?.date}T00:00:00Z` : ge.start!.dateTime!,
    end_at: allDay ? `${ge.end?.date}T00:00:00Z` : ge.end!.dateTime!,
    all_day: allDay,
    gcal_event_id: ge.id,
    source: "gcal",
    synced_at: new Date().toISOString(),
  };
}

/* ------------------------------ low-level ------------------------------ */

function gcalFetch(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${GCAL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/* ------------------------------ push ------------------------------ */

export async function pushEventToGoogle(
  userId: string,
  ev: LocalEvent,
): Promise<string | null> {
  const token = await getGoogleAccessToken(userId);
  if (!token) return null;
  const body = JSON.stringify(toGcalEvent(ev));
  const res = ev.gcal_event_id
    ? await gcalFetch(token, `/events/${ev.gcal_event_id}`, {
        method: "PATCH",
        body,
      })
    : await gcalFetch(token, "/events", { method: "POST", body });
  if (!res.ok) {
    if (res.status === 404 || res.status === 410) {
      const created = await gcalFetch(token, "/events", {
        method: "POST",
        body,
      });
      if (!created.ok) return null;
      return ((await created.json()) as GcalEvent).id;
    }
    return null;
  }
  return ((await res.json()) as GcalEvent).id;
}

export async function deleteEventFromGoogle(
  userId: string,
  gcalEventId: string,
): Promise<boolean> {
  const token = await getGoogleAccessToken(userId);
  if (!token) return false;
  const res = await gcalFetch(token, `/events/${gcalEventId}`, {
    method: "DELETE",
  });
  return res.ok || res.status === 404 || res.status === 410;
}

/* ------------------------------ pull ------------------------------ */

export async function pullFromGoogle(userId: string) {
  const admin = serviceClient();
  const token = await getGoogleAccessToken(userId);
  if (!token) return { ok: false, reason: "no-google-token" };

  const { data: syncRow } = await admin
    .from("gcal_sync")
    .select("sync_token")
    .eq("user_id", userId)
    .single();

  const params = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "250",
  });
  if (syncRow?.sync_token) {
    params.set("syncToken", syncRow.sync_token);
  } else {
    const min = new Date();
    min.setDate(min.getDate() - 90);
    params.set("timeMin", min.toISOString());
  }

  const res = await gcalFetch(token, `/events?${params}`);
  if (res.status === 410) {
    await admin
      .from("gcal_sync")
      .upsert({ user_id: userId, sync_token: null }, { onConflict: "user_id" });
    return pullFromGoogle(userId);
  }
  if (!res.ok) return { ok: false, reason: `gcal-${res.status}` };

  const json = (await res.json()) as {
    items?: GcalEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };

  let upserts = 0;
  let deletes = 0;
  for (const ge of json.items ?? []) {
    if (ge.status === "cancelled") {
      await admin
        .from("events")
        .delete()
        .eq("user_id", userId)
        .eq("gcal_event_id", ge.id);
      deletes++;
    } else {
      const { data: existing } = await admin
        .from("events")
        .select("task_id")
        .eq("gcal_event_id", ge.id)
        .single();
      await admin
        .from("events")
        .upsert(
          { ...fromGcalEvent(ge, userId), task_id: existing?.task_id ?? null },
          { onConflict: "gcal_event_id" },
        );
      upserts++;
    }
  }

  await admin.from("gcal_sync").upsert(
    {
      user_id: userId,
      sync_token: json.nextSyncToken ?? syncRow?.sync_token ?? null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return { ok: true, upserts, deletes };
}

/* ------------------------------ watch channel ------------------------------ */

export async function registerWatch(userId: string) {
  const token = await getGoogleAccessToken(userId);
  if (!token) return { ok: false };
  const res = await gcalFetch(token, "/events/watch", {
    method: "POST",
    body: JSON.stringify({
      id: userId,
      type: "web_hook",
      address: `${Deno.env.get("SUPABASE_URL")}/functions/v1/gcal-webhook`,
      params: { ttl: "604800" },
    }),
  });
  if (!res.ok) return { ok: false };
  const json = (await res.json()) as { resourceId: string; expiration: string };
  await serviceClient().from("gcal_sync").upsert(
    {
      user_id: userId,
      channel_resource_id: json.resourceId,
      channel_expiration: new Date(Number(json.expiration)).toISOString(),
    },
    { onConflict: "user_id" },
  );
  return { ok: true };
}
