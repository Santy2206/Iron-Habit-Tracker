// Webhook que recibe notificaciones de Nequi/RappiCard (p.ej. desde una macro
// de MacroDroid) y las guarda en una bandeja durable antes de interpretarlas.
// Las transacciones conservan el vínculo con el evento original.
//
// Auth: no usa el JWT de Supabase (verify_jwt=false) para la captura porque
// la app del celular usa un secreto individual asociado a un usuario.
// El hash del secreto se almacena en notification_capturers, que solo el
// service_role puede consultar. El reprocesamiento exige un JWT de usuario.
// El service_role nunca acepta un user_id enviado por el capturador.
//
// Body esperado (JSON):
//   { "account_name": "Nequi" | "RappiCard",
//     "raw_text": "<texto completo de la notificacion>",
//     "event_id": "<identificador estable generado una sola vez>",
//     "occurred_at": "2026-10-02T14:32:00-05:00" }
//
// Header esperado: x-webhook-secret: <secreto individual del capturador>
//
// Los patrones heredados de Rappi se conservan de forma conservadora;
// los formatos sin ejemplos verificados quedan pendientes de revisión.

import { createClient } from "jsr:@supabase/supabase-js@2.117.3";
import { handleNotification, IdentityConflict, type EventRow, type Store } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const store: Store = {
  async authenticate(hash) {
    const { data, error } = await supabase.from("notification_capturers")
      .select("id,user_id,allowed_sources").eq("secret_hash", hash).eq("enabled", true).maybeSingle();
    if (error) throw error;
    return data;
  },
  async user(token) {
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  async event(id, owner) {
    const { data, error } = await supabase.from("notification_events").select("*").eq("id", id).eq("user_id", owner).maybeSingle();
    if (error) throw error;
    return data as EventRow | null;
  },
  async receive(input) {
    const { data, error } = await supabase.rpc("receive_notification", input);
    if (error?.code === "22000") throw new IdentityConflict();
    if (error || !data) throw error ?? new Error("Receipt failed");
    return data as EventRow;
  },
  async finish(input) {
    const { data, error } = await supabase.rpc("finish_notification", input);
    if (error || !data) throw error ?? new Error("Processing failed");
    return data as EventRow;
  },
};

Deno.serve((req) => handleNotification(req, store));
