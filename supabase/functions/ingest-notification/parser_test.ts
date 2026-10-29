import { looksSensitive, parseAmount, parseNotification } from "./parser.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("synthetic: strict monetary formats preserve decimal cents", () => {
  for (const [input, expected] of [
    ["25.000", "25000.00"], ["25.000,50", "25000.50"],
    ["25,000.50", "25000.50"], ["25000", "25000.00"], ["0,01", "0.01"],
  ]) equal(parseAmount(input), expected);
  for (const input of ["25.00.0", "25,00,0", "25.000,", "25,000.50x", "1e3", "-1", "0", "NaN", "1.234,567", "99999999999999999"]) {
    equal(parseAmount(input), null);
  }
});

Deno.test("synthetic: credit alone is never income", () => {
  equal(parseNotification("Compra aprobada con tarjeta de crédito por $25.000", "Bancolombia"), {
    status: "pending_review", reason: "unsupported_format",
  });
  const card = parseNotification("You've paid $25.000 in Synthetic crédito Store you can see details", "RappiCard");
  if (card.status !== "recognized" || card.direction !== "out") throw new Error("Credit card purchase must not become income");
});

Deno.test("synthetic: promotions, declined operations and ambiguous amounts", () => {
  equal(parseNotification("Promoción: compra por $25.000", "Nequi"), { status: "ignored", reason: "non_financial" });
  equal(parseNotification("Compra por $25.000 rechazada", "Bancolombia"), { status: "ignored", reason: "declined" });
  equal(parseNotification("Compra por $25.000 saldo $50.000", "Bancolombia"), { status: "pending_review", reason: "ambiguous_amount" });
  equal(parseNotification("Mensaje sin movimiento", "Nequi"), { status: "pending_review", reason: "ambiguous_amount" });
});

Deno.test("synthetic: RappiCard is not RappiCuenta", () => {
  for (const source of ["RappiCard", "RappiCuenta"]) {
    const result = parseNotification("You've paid $74.925 in Test Store you can see details", source);
    if (result.status !== "recognized") throw new Error("Expected recognized purchase");
    equal(result.product, "RappiCard");
    equal(result.amount, "74925.00");
    equal(result.direction, "out");
  }
});

Deno.test("synthetic: card payment and refund require accounting evidence", () => {
  equal(parseNotification("The payment of your RappiCard via PSE of $3,000 has been successful.", "RappiCuenta"), {
    status: "pending_review", reason: "requires_accounting_link",
  });
  equal(parseNotification("Devolución por $25.000", "RappiCard"), { status: "pending_review", reason: "requires_accounting_link" });
  equal(parseNotification("You've paid USD $25.00 in Test", "RappiCard"), { status: "pending_review", reason: "unsupported_currency" });
});

Deno.test("synthetic: credentials are detected without requiring numeric OTP", () => {
  for (const text of ["Tu clave es ABCDEF", "Código de acceso 123456", "OTP abcd", "Token de seguridad"]) {
    equal(looksSensitive(text), true);
    equal(parseNotification(text, "Nequi"), { status: "ignored", reason: "sensitive" });
  }
});
