export type ParseResult =
  | { status: "recognized"; amount: string; direction: "in" | "out"; product: string; kind: "purchase" | "transfer"; counterparty: string | null }
  | { status: "ignored" | "pending_review"; reason: string };

export function parseAmount(input: string): string | null {
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input)) {
    normalized = input.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(input)) {
    normalized = input.replace(/,/g, "");
  } else if (/^\d+([.,]\d{1,2})?$/.test(input)) {
    normalized = input.replace(",", ".");
  } else return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n || cents > 99999999999999n) return null;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function looksSensitive(text: string): boolean {
  return /\b(otp|token|pin)\b|clave|contrase[ñn]a|c[oó]digo|verificaci[oó]n/i.test(text);
}

const currencyCodes = new Set(Intl.supportedValuesOf("currency"));

export function parseNotification(text: string, source: string): ParseResult {
  if (looksSensitive(text)) return { status: "ignored", reason: "sensitive" };
  if (/rechazad[ao]|declined|denegad[ao]|no (?:fue |ha sido )?aprobad[ao]/i.test(text)) {
    return { status: "ignored", reason: "declined" };
  }
  if (/promoci[oó]n|descuento|cashback|recordatorio|reminder|hasta un|up to/i.test(text)) {
    return { status: "ignored", reason: "non_financial" };
  }
  const foreignCode = [...text.matchAll(/\b[A-Z]{3}\b/gi)].some(([code]) => code.toUpperCase() !== "COP" && currencyCodes.has(code.toUpperCase()));
  if (foreignCode || /US\$|[€£¥]|d[oó]lares|dollars|euros/i.test(text)) {
    return { status: "pending_review", reason: "unsupported_currency" };
  }
  if (/revers[ao]|devoluci[oó]n|refund|payment of your rappicard|pago de (?:tu |su |la )?tarjeta/i.test(text)) {
    return { status: "pending_review", reason: "requires_accounting_link" };
  }
  const amounts = [...text.matchAll(/\$\s*([\d.,]+)(?!\d)/g)];
  if (amounts.length !== 1) return { status: "pending_review", reason: "ambiguous_amount" };
  const amount = parseAmount(amounts[0][1]);
  if (!amount) return { status: "pending_review", reason: "invalid_amount" };
  const card = text.match(/^you'?ve paid\s+\$\s*[\d.,]+\s+in\s+(.+?)(?:\s+you can see|$)/i);
  if (card && ["RappiCuenta", "RappiCard"].includes(source)) {
    return { status: "recognized", amount, direction: "out", product: "RappiCard", kind: "purchase", counterparty: card[1].trim() };
  }
  if (source === "RappiCuenta" && /the\s+\$\s*[\d.,]+\s+transfer via bre-?b was successful/i.test(text)) {
    return { status: "recognized", amount, direction: "out", product: "RappiCuenta", kind: "transfer", counterparty: null };
  }
  if (source === "RappiCuenta" && /you received\s+\$\s*[\d.,]+\s+in your rappicuenta via transfer through bre-?b/i.test(text)) {
    return { status: "recognized", amount, direction: "in", product: "RappiCuenta", kind: "transfer", counterparty: null };
  }
  return { status: "pending_review", reason: "unsupported_format" };
}
