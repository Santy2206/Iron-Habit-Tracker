// Pull body weight from Google Fit -> weight_entries for the calling user.
// Port of features/physical/weight_tracker.py — same data source and kg->lb
// conversion. POST (JWT) -> { ok, imported, reason? }
// Requires the Google OAuth flow to have granted fitness.body.read scope.

import { corsHeaders, json } from "../_shared/cors.ts";
import { getUser, serviceClient } from "../_shared/auth.ts";
import { getGoogleAccessToken } from "../_shared/google.ts";

const KG_TO_LB = 2.20462;
const DATA_SOURCE =
  "derived:com.google.weight:com.google.android.gms:merge_weight";

interface FitPoint {
  startTimeNanos: string;
  value?: { fpVal?: number; intVal?: number; stringVal?: string }[];
}

function nanosToISODate(nanos: string): string {
  return new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  const user = await getUser(req);
  if (!user) return json({ ok: false, reason: "unauthorized" }, 401);

  const token = await getGoogleAccessToken(user.id);
  if (!token) return json({ ok: false, reason: "no-google-token" });

  // Look back 1 year — same window as the Python sync.
  const endNs = BigInt(Date.now()) * 1_000_000n;
  const startNs = endNs - 365n * 24n * 3600n * 1_000_000_000n;

  const res = await fetch(
    `https://www.googleapis.com/fitness/v1/users/me/dataSources/${DATA_SOURCE}/datasets/${startNs}-${endNs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return json({ ok: false, reason: `gfit-${res.status}` });
  }

  const { point = [] } = (await res.json()) as { point?: FitPoint[] };

  // Average multiple same-day readings, like the Python tracker.
  const byDay = new Map<string, number[]>();
  for (const p of point) {
    const kg = p.value?.[0]?.fpVal ?? p.value?.[0]?.intVal;
    if (!kg) continue;
    const day = nanosToISODate(p.startTimeNanos);
    const list = byDay.get(day) ?? [];
    list.push(kg * KG_TO_LB);
    byDay.set(day, list);
  }

  const admin = serviceClient();
  let imported = 0;
  for (const [day, vals] of byDay) {
    const lb = vals.reduce((a, b) => a + b, 0) / vals.length;
    const { error } = await admin.from("weight_entries").upsert(
      {
        user_id: user.id,
        entry_date: day,
        weight_lb: Math.round(lb * 100) / 100,
        source: "gfit",
      },
      { onConflict: "user_id,entry_date" },
    );
    if (!error) imported++;
  }

  return json({ ok: true, imported });
});
