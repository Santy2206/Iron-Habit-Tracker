"""Helpers compartidos para convertir texto/filas crudas en filas de `transactions`.

La clasificacion (type/category/needs_review) la hace el trigger `apply_rules()`
en la base de datos — estos helpers solo normalizan y insertan.
"""

import re

AMOUNT_RE = re.compile(r"\$\s?([\d.,]+)")


def parse_colombian_amount(raw: str) -> float | None:
    """Acepta '123.456,78', '884,087.00', '45.000', '45,000', '123456'.

    Si hay ambos separadores, el ultimo es el decimal. Si hay uno solo, es de
    miles cuando aparece mas de una vez o va seguido de exactamente 3 digitos.
    """
    raw = raw.strip().rstrip(".,")
    has_comma, has_dot = "," in raw, "." in raw
    if has_comma and has_dot:
        decimal = "," if raw.rfind(",") > raw.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        cleaned = raw.replace(thousands, "").replace(decimal, ".")
    elif has_comma or has_dot:
        sep = "," if has_comma else "."
        parts = raw.split(sep)
        if len(parts) > 2 or len(parts[1]) == 3:
            cleaned = raw.replace(sep, "")
        else:
            cleaned = raw.replace(sep, ".")
    else:
        cleaned = raw
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return value if value > 0 else None


def parse_price_term(raw: str) -> float | None:
    """Un precio escrito a mano: '5200', '11.500', '2,600', '13.50'."""
    s = re.sub(r"[\s$]", "", raw)
    if not s:
        return None
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d{1,2})?", s):
        return float(s.replace(".", "").replace(",", "."))
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d{1,2})?", s):
        return float(s.replace(",", ""))
    if re.fullmatch(r"\d+([.,]\d{1,2})?", s):
        return float(s.replace(",", "."))
    return None


def parse_price_expression(expr: str) -> float | None:
    """Suma de precios: '5200+2600+13500' -> 21300. Devuelve None si algun termino es invalido.
    Misma logica que la app movil (mobile/index.html)."""
    total = 0.0
    for term in expr.split("+"):
        value = parse_price_term(term)
        if value is None or value <= 0:
            return None
        total += value
    return total


def find_amount(text: str) -> float | None:
    match = AMOUNT_RE.search(text)
    if not match:
        return None
    return parse_colombian_amount(match.group(1))


def insert_transaction(
    client,
    *,
    account_id: str,
    occurred_at: str,
    direction: str,
    amount: float,
    source: str,
    dedupe_hash: str,
    counterparty: str | None = None,
    description: str | None = None,
    raw_text: str | None = None,
) -> bool:
    """Inserta una transaccion. Devuelve False (sin lanzar error) si ya existia
    (dedupe_hash duplicado) para que el llamador pueda seguir con el resto del lote."""
    try:
        client.table("transactions").insert(
            {
                "account_id": account_id,
                "occurred_at": occurred_at,
                "direction": direction,
                "amount": amount,
                "counterparty": counterparty,
                "description": description,
                "source": source,
                "raw_text": raw_text,
                "dedupe_hash": dedupe_hash,
            }
        ).execute()
        return True
    except Exception as exc:  # supabase-py envuelve el error de postgrest
        if "duplicate key value" in str(exc) or "23505" in str(exc):
            return False
        raise


def get_account_id(client, account_name: str) -> str:
    result = client.table("accounts").select("id").eq("name", account_name).single().execute()
    return result.data["id"]
