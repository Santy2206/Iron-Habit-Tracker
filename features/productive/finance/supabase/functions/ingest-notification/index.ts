// NOTA: datos personales reemplazados por <MARCADORES> en esta copia del repositorio.
// Webhook que recibe notificaciones de Nequi/RappiCard (p.ej. desde una macro
// de MacroDroid) y las inserta en `transactions`. El trigger `apply_rules()`
// las clasifica automaticamente al insertar.
//
// Auth: no usa el JWT de Supabase (verify_jwt=false) porque quien llama es la
// app de notificaciones del celular, no un cliente Supabase. En su lugar
// valida un secreto compartido guardado en `app_secrets`, que solo el
// service_role (disponible automaticamente dentro de la Edge Function) puede
// leer.
//
// Body esperado (JSON):
//   { "account_name": "Nequi" | "RappiCard",
//     "raw_text": "<texto completo de la notificacion>",
//     "occurred_at": "2026-10-02T14:32:00-05:00" }   // opcional, default = ahora
//
// Header esperado: x-webhook-secret: <valor de app_secrets.notification_ingest_secret>
//
// Los patrones de `parseNotification` son genericos (a falta de notificaciones
// reales de Nequi/RappiCard) y deben calibrarse con texto real.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const providedSecret = req.headers.get("x-webhook-secret") ?? "";
  const { data: secretRow, error: secretErr } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "notification_ingest_secret")
    .single();

  if (secretErr || !secretRow || providedSecret !== secretRow.value) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Dos formas de llamar:
  //  - JSON: { account_name, raw_text, occurred_at }
  //  - Texto plano (mas facil en MacroDroid: no hay que escapar comillas): POST ...?account=Daviplata
  //    con el texto de la notificacion como cuerpo.
  let account_name: string | undefined;
  let raw_text: string | undefined;
  let occurred_at: string | undefined;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      ({ account_name, raw_text, occurred_at } = await req.json());
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
  } else {
    raw_text = (await req.text()).trim();
  }
  account_name = account_name ?? new URL(req.url).searchParams.get("account") ?? undefined;
  if (!account_name || !raw_text) {
    return new Response("Missing account_name or raw_text", { status: 400 });
  }

  // Nunca guardar codigos de verificacion / claves de un solo uso que llegan por SMS.
  if (looksSensitive(raw_text)) {
    return new Response(JSON.stringify({ status: "ignored_sensitive" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id")
    .eq("name", account_name)
    .single();
  if (accountErr || !account) {
    return new Response(`Unknown account: ${account_name}`, { status: 400 });
  }

  // Modo aprendizaje (?mode=learn): solo guarda el texto para ver como son las notificaciones
  // reales de una app, sin crear movimientos (evita que promociones se tomen como gastos).
  if (new URL(req.url).searchParams.get("mode") === "learn") {
    await supabase.from("unparsed_notifications").insert({ account_name, raw_text });
    return new Response(JSON.stringify({ status: "learned" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = parseNotification(raw_text, account_name);
  if (!parsed) {
    // Se guarda para poder calibrar el lector con textos reales de la app.
    await supabase.from("unparsed_notifications").insert({ account_name, raw_text });
    return new Response(
      JSON.stringify({ status: "unparsed", detail: "could not find amount/direction in raw_text" }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const occurredAt = occurred_at ?? new Date().toISOString();
  const dedupeHash = await sha256Hex(`${account_name}|${occurredAt}|${raw_text}`);

  const { error: insertErr } = await supabase.from("transactions").insert({
    account_id: account.id,
    occurred_at: occurredAt,
    direction: parsed.direction,
    amount: parsed.amount,
    counterparty: parsed.counterparty,
    description: raw_text,
    source: "notification",
    raw_text,
    dedupe_hash: dedupeHash,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return new Response(JSON.stringify({ status: "duplicate_ignored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(`Insert failed: ${insertErr.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function looksSensitive(text: string): boolean {
  return (
    /(c[oó]digo|clave|otp|token|verificaci[oó]n|contrase[ñn]a|\bpin\b)/i.test(text) &&
    /\b\d{4,8}\b/.test(text)
  );
}

// Cuentas cuya app manda muchas promociones: solo se aceptan formatos exactos ya vistos.
// RappiCuenta: "The $16.448,00 transfer via Bre-B was successful. Check your transaction history..."
const STRICT_PATTERNS: Record<string, { regex: RegExp; direction: "in" | "out" }[]> = {
  RappiCuenta: [
    { regex: /the\s+\$\s?([\d.,]+)\s+transfer via bre-?b was successful/i, direction: "out" },
    { regex: /you received\s+\$\s?([\d.,]+)\s+in your rappicuenta via transfer through bre-?b/i, direction: "in" },
  ],
};

// Formatos exactos con destinatario (grupo 2), probados primero; si no coinciden se usa el lector generico.
// Daviplata: "Transaccion exitosa: Pasaste $16.448 a <TITULAR> usando Llaves. ..."
const SPECIFIC_PATTERNS: Record<string, { regex: RegExp; direction: "in" | "out" }[]> = {
  Daviplata: [{ regex: /pasaste\s+\$\s?([\d.,]+)\s+a\s+(.+?)\s+usando llaves/i, direction: "out" }],
};

function parseNotification(
  text: string,
  accountName: string,
): { amount: number; direction: "in" | "out"; counterparty: string | null } | null {
  for (const { regex, direction } of SPECIFIC_PATTERNS[accountName] ?? []) {
    const m = text.match(regex);
    const amount = m ? parseColombianAmount(m[1]) : null;
    if (m && amount) return { amount, direction, counterparty: m[2]?.trim() ?? null };
  }

  const strict = STRICT_PATTERNS[accountName];
  if (strict) {
    for (const { regex, direction } of strict) {
      const m = text.match(regex);
      if (!m) continue;
      const amount = parseColombianAmount(m[1]);
      if (amount) return { amount, direction, counterparty: null };
    }
    return null;
  }

  const amountMatch = text.match(/\$\s?([\d.,]+)/);
  if (!amountMatch) return null;
  const amount = parseColombianAmount(amountMatch[1]);
  if (!amount || amount <= 0) return null;

  const lower = text.toLowerCase();
  let direction: "in" | "out" | null = null;
  if (/recibiste|te enviaron|abono|cr[eé]dito|pago recibido/.test(lower)) direction = "in";
  if (/enviaste|pagaste|compra por|retiro|transferiste|env[ií]o de plata/.test(lower)) direction = "out";
  if (!direction) return null;

  const counterpartyMatch = text.match(/(?:a|de|en)\s+([A-ZÑÁÉÍÓÚ][\w .&-]{2,40})/);
  return { amount, direction, counterparty: counterpartyMatch ? counterpartyMatch[1].trim() : null };
}

function parseColombianAmount(input: string): number | null {
  // Acepta "123.456,78", "884,087.00", "1,000", "45.000", "123456" (misma logica que parsing.py).
  // Si hay ambos separadores, el ultimo es el decimal; si hay uno solo, es de miles cuando
  // aparece mas de una vez o va seguido de exactamente 3 digitos.
  const raw = input.trim().replace(/[.,]+$/, "");
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let cleaned: string;
  if (hasComma && hasDot) {
    const decimal = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    cleaned = raw.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = raw.split(sep);
    cleaned = parts.length > 2 || parts[1].length === 3 ? parts.join("") : raw.replace(sep, ".");
  } else {
    cleaned = raw;
  }
  const value = parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
