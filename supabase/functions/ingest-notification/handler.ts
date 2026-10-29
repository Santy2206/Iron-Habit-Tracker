import { looksSensitive, parseNotification } from "./parser.ts";

export class IdentityConflict extends Error {}

export function validTimestamp(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!m || !Number.isFinite(Date.parse(input))) return false;
  const [, y, month, day, hour, minute, second] = m;
  return Number(y) >= 1970 && Number(y) <= 2200 && Number(month) >= 1 && Number(month) <= 12 &&
    Number(day) >= 1 && Number(day) <= new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate() &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 &&
    (m[7] === "Z" || (Number(m[8]) <= 14 && Number(m[9]) <= 59 && (Number(m[8]) !== 14 || Number(m[9]) === 0)));
}

export interface EventRow {
  id: string;
  user_id: string;
  status: string;
  source: string;
  raw_text: string | null;
  occurred_at: string | null;
  transaction_id: string | null;
}
export interface Store {
  authenticate(secretHash: string): Promise<{ id: string; user_id: string; allowed_sources: string[] } | null>;
  user(token: string): Promise<string | null>;
  event(id: string, owner: string): Promise<EventRow | null>;
  receive(input: Record<string, unknown>): Promise<EventRow>;
  finish(input: Record<string, unknown>): Promise<EventRow>;
}

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-webhook-secret, x-event-id, x-occurred-at",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} });

async function boundedText(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("empty");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new Error("too_large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function processEvent(event: EventRow, store: Store): Promise<EventRow> {
  if (event.transaction_id || event.status === "ignored" || event.status === "processed") return event;
  const result = parseNotification(event.raw_text ?? "", event.source);
  if (result.status !== "recognized") {
    return await store.finish({ p_id: event.id, p_owner: event.user_id, p_status: result.status, p_reason: result.reason });
  }
  if (result.kind === "transfer") {
    return await store.finish({ p_id: event.id, p_owner: event.user_id, p_status: "pending_review", p_reason: "transfer_ownership_unverified", p_product: result.product });
  }
  return await store.finish({ p_id: event.id, p_owner: event.user_id, p_status: "processed", p_reason: null,
    p_product: result.product, p_amount: result.amount, p_direction: result.direction, p_counterparty: result.counterparty });
}

export async function handleNotification(req: Request, store: Store): Promise<Response> {
  if (req.method === "OPTIONS") return json(null);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("action") === "reprocess") {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      const owner = await store.user(token);
      if (!owner) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = JSON.parse(await boundedText(req)); } catch { return json({ error: "invalid_request" }, 400); }
      if (!body || typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id)) return json({ error: "invalid_request" }, 400);
      const event = await store.event(body.id, owner);
      if (!event) return json({ error: "not_found" }, 404);
      const processed = await processEvent(event, store);
      return json({ id: processed.id, status: processed.status, transaction_id: processed.transaction_id });
    }
    const secret = req.headers.get("x-webhook-secret") ?? "";
    if (secret.length < 32 || secret.length > 512) return json({ error: "unauthorized" }, 401);
    const capturer = await store.authenticate(await sha256(secret));
    if (!capturer) return json({ error: "unauthorized" }, 401);
    let body: Record<string, unknown>;
    try {
      const text = await boundedText(req);
      body = (req.headers.get("content-type") ?? "").includes("application/json")
        ? JSON.parse(text) : { raw_text: text, account_name: url.searchParams.get("account") };
    } catch { return json({ error: "invalid_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
    const source = body.source ?? body.account_name;
    const text = body.raw_text;
    const eventId = body.event_id ?? req.headers.get("x-event-id");
    const occurredAt = body.occurred_at ?? req.headers.get("x-occurred-at");
    if (typeof source !== "string" || !capturer.allowed_sources.includes(source) ||
      typeof text !== "string" || !text.trim() || new TextEncoder().encode(text).byteLength > 8192 ||
      typeof eventId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(eventId) ||
      (occurredAt !== null && occurredAt !== undefined && !validTimestamp(occurredAt))) {
      return json({ error: "invalid_event_contract" }, 400);
    }
    const sensitive = looksSensitive(text);
    const occurred = typeof occurredAt === "string" ? new Date(occurredAt).toISOString() : null;
    const hash = await sha256(JSON.stringify([source, occurred, sensitive ? null : text]));
    let event: EventRow;
    try {
      event = await store.receive({ p_capturer: capturer.id, p_event_id: eventId, p_source: source,
        p_occurred_at: occurred, p_text: sensitive ? null : text, p_hash: hash, p_sensitive: sensitive });
    } catch (error) { return json({ error: error instanceof IdentityConflict ? "identity_conflict" : "receipt_failed" }, error instanceof IdentityConflict ? 409 : 503); }
    if (url.searchParams.get("mode") !== "learn") {
      try { event = await processEvent(event, store); } catch {
        event = await store.finish({ p_id: event.id, p_owner: event.user_id, p_status: "error", p_reason: "processing_failed" }).catch(() => event);
      }
    } else if (event.status === "received") {
      event = await store.finish({ p_id: event.id, p_owner: event.user_id, p_status: "pending_review", p_reason: "learning_mode" }).catch(() => event);
    }
    return json({ received: true, id: event.id, status: event.status, transaction_id: event.transaction_id });
  } catch { return json({ error: "service_unavailable" }, 503); }
}
