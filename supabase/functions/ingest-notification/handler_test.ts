import { handleNotification, IdentityConflict, type EventRow, type Store, validTimestamp } from "./handler.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const secret = "synthetic-test-secret-not-a-real-credential";
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const eventUuid = "20000000-0000-4000-8000-000000000001";
const text = "You've paid $25.000 in Synthetic Store you can see details";

class MemoryStore implements Store {
  rows = new Map<string, EventRow & { hash: unknown }>();
  transactions = 0;
  receiveFailure = false;
  processFailure = false;
  missingAccount = false;
  async authenticate(): ReturnType<Store["authenticate"]> { return { id: "capture", user_id: owner, allowed_sources: ["RappiCard", "Nequi"] }; }
  async user(token: string) { return token === "owner-token" ? owner : token === "other-token" ? other : null; }
  async event(id: string, uid: string) { return [...this.rows.values()].find((e) => e.id === id && e.user_id === uid) ?? null; }
  async receive(p: Record<string, unknown>) {
    if (this.receiveFailure) throw new Error("synthetic persistence failure");
    const id = String(p.p_event_id);
    const old = this.rows.get(id);
    if (old) {
      if (old.hash !== p.p_hash) throw new IdentityConflict();
      return old;
    }
    const row = { id: this.rows.size === 0 ? eventUuid : `20000000-0000-4000-8000-${String(this.rows.size + 1).padStart(12, "0")}`, user_id: owner, status: p.p_sensitive ? "ignored" : "received", source: String(p.p_source),
      raw_text: p.p_text as string | null, occurred_at: p.p_occurred_at as string | null,
      transaction_id: null, hash: p.p_hash };
    this.rows.set(id, row);
    return row;
  }
  async finish(p: Record<string, unknown>) {
    if (this.processFailure) throw new Error("synthetic processing failure");
    const e = await this.event(String(p.p_id), String(p.p_owner));
    assert(e);
    if (e.transaction_id || e.status === "ignored") return e;
    if (p.p_status === "processed" && !this.missingAccount && e.occurred_at) {
      e.transaction_id = `transaction-${++this.transactions}`;
      e.status = "processed";
    } else e.status = p.p_status === "processed" ? "pending_review" : String(p.p_status);
    return e;
  }
}

function request(eventId = "event-1", overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/ingest-notification", { method: "POST", headers: {
    "content-type": "application/json", "x-webhook-secret": secret,
  }, body: JSON.stringify({ account_name: "RappiCard", event_id: eventId, raw_text: text, occurred_at: "2026-10-20T10:00:00-05:00", ...overrides }) });
}

Deno.test("synthetic: retry produces one transaction; identical distinct events produce two", async () => {
  const store = new MemoryStore();
  assert((await handleNotification(request(), store)).status === 200);
  assert((await handleNotification(request(), store)).status === 200);
  assert(store.transactions === 1);
  assert((await handleNotification(request("event-2"), store)).status === 200);
  assert(Number(store.transactions) === 2);
});

Deno.test("synthetic: save failure is not acknowledged; parser failure after durable save is acknowledged", async () => {
  const store = new MemoryStore();
  store.receiveFailure = true;
  assert((await handleNotification(request(), store)).status === 503);
  assert(store.rows.size === 0);
  store.receiveFailure = false;
  store.processFailure = true;
  const response = await handleNotification(request(), store);
  assert(response.status === 200);
  assert((await response.json()).received === true);
  assert(Number(store.rows.size) === 1);
});

Deno.test("synthetic: missing destination stays pending without fallback", async () => {
  const store = new MemoryStore(); store.missingAccount = true;
  const body = await (await handleNotification(request(), store)).json();
  assert(body.status === "pending_review"); assert(store.transactions === 0);
});

Deno.test("synthetic: stable identity cannot be reused with different payload", async () => {
  const store = new MemoryStore();
  await handleNotification(request(), store);
  assert((await handleNotification(request("event-1", { raw_text: text + " changed" }), store)).status === 409);
});

Deno.test("synthetic: pending event reprocessing is owner scoped and idempotent", async () => {
  const store = new MemoryStore(); store.missingAccount = true;
  await handleNotification(request(), store);
  const reprocess = (token: string) => new Request("http://localhost/ingest-notification?action=reprocess", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: eventUuid }),
  });
  assert((await handleNotification(reprocess("invalid"), store)).status === 401);
  assert((await handleNotification(reprocess("other-token"), store)).status === 404);
  store.missingAccount = false;
  assert((await handleNotification(reprocess("owner-token"), store)).status === 200);
  assert((await handleNotification(reprocess("owner-token"), store)).status === 200);
  assert(store.transactions === 1);
});

Deno.test("synthetic: request validation, sensitive discard and missing event time", async () => {
  const store = new MemoryStore();
  for (const overrides of [{ event_id: null }, { raw_text: [] }, { raw_text: "x".repeat(8193) }, { account_name: "Unknown" }, { occurred_at: "2026-02-30T10:00:00Z" }]) {
    assert((await handleNotification(request("invalid", overrides), store)).status === 400);
  }
  const noAuth = new Request("http://localhost/ingest-notification", { method: "POST" });
  assert((await handleNotification(noAuth, store)).status === 401);
  await handleNotification(request("otp", { raw_text: "Tu clave es ABCDEF" }), store);
  assert(store.rows.get("otp")?.raw_text === null);
  assert(store.rows.get("otp")?.status === "ignored");
  await handleNotification(request("no-time", { occurred_at: null }), store);
  assert(store.rows.get("no-time")?.status === "pending_review");
  assert(store.transactions === 0);
});

Deno.test("synthetic: unauthorized capturer cannot persist; request cannot select another owner", async () => {
  const denied = new MemoryStore();
  denied.authenticate = async () => null;
  assert((await handleNotification(request(), denied)).status === 401);
  assert(denied.rows.size === 0);
  const allowed = new MemoryStore();
  await handleNotification(request("spoofed", { user_id: other }), allowed);
  assert(allowed.rows.get("spoofed")?.user_id === owner);
});

Deno.test("synthetic: calendar and timezone validation", () => {
  assert(validTimestamp("2024-02-29T10:00:00-05:00"));
  for (const value of ["2026-02-29T10:00:00Z", "2026-10-20T24:00:00Z", "2026-10-20T10:00:00+15:00", "2026-10-20", {}, null]) {
    assert(!validTimestamp(value));
  }
});
