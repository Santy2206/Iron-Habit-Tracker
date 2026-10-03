"""Lee alertas de Bancolombia y Nequi desde Gmail (solo lectura) y las guarda en `transactions`.

Requisitos:
  1. Gmail API habilitada en el proyecto de Google Cloud de credentials.json.
  2. Alertas por correo activas en Bancolombia / Nequi.
  3. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env (ver supabase_client.py).

La primera corrida abre el navegador para el consentimiento OAuth (scope
gmail.readonly) y guarda el token en token_gmail.json.

Sin --commit solo imprime lo que detectaria (dry-run). Los remitentes se pueden
sobreescribir en .env con BANCOLOMBIA_SENDER / NEQUI_SENDER (varios separados por coma).

Ejemplos:
    python -m features.productive.finance.gmail_sync                  # dry-run, todas las fuentes
    python -m features.productive.finance.gmail_sync --source nequi --commit
    python -m features.productive.finance.gmail_sync --discover --query nequi
"""

import argparse
import base64
import html
import os
import re
import sys
from datetime import datetime, timezone

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from features.physical import storage
from features.productive.finance import parsing
from features.productive.finance.supabase_client import get_client

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
TOKEN_PATH = storage.PROJECT_ROOT / "token_gmail.json"
CREDENTIALS_PATH = storage.PROJECT_ROOT / "credentials.json"

_FLAGS = re.IGNORECASE | re.DOTALL
_DATE_TAIL = r"(?=\s+(?:el|con|en)\s+\d{2}/\d{2}/\d{2,4}|\s+el\s+\d|\.)"

# Cada patron: (nombre, regex con grupos nombrados `amount` y `cp`, direccion).
# Se prueban en orden; gana el primero que matchee. Verificados contra correos
# reales: bancolombia (enviada, recibida, compra) y nequi (pago, recibido).
BANCOLOMBIA_PATTERNS = [
    (
        "transferencia_enviada",
        re.compile(
            r"transferiste\s*\$\s*(?P<amount>[\d.,]+).*?desde tu cuenta\s*\*?\d+\s+a\s+(?P<cp>.+?)" + _DATE_TAIL,
            _FLAGS,
        ),
        "out",
    ),
    (
        "compra",
        re.compile(r"compraste\s*\$\s*(?P<amount>[\d.,]+)\s+en\s+(?P<cp>.+?)\s+(?:con|el)\b", _FLAGS),
        "out",
    ),
    (
        "transferencia_recibida",
        re.compile(
            r"recibiste\s+(?:una\s+transferencia\s+|un\s+pago\s+)?(?:por\s+)?\$\s*(?P<amount>[\d.,]+)"
            r"\s+de\s+(?P<cp>.+?)\s+(?:a\s+tu\s+cuenta|en|el)\b",
            _FLAGS,
        ),
        "in",
    ),
]

# Ojo: el correo de "Recibiste" de Nequi NO trae el signo $.
NEQUI_PATTERNS = [
    (
        "pago",
        re.compile(r"hiciste un pago en\s+(?P<cp>.+?)\s+por\s+\$\s*(?P<amount>[\d.,]+)", _FLAGS),
        "out",
    ),
    (
        "recibido",
        re.compile(r"recibiste\s+\$?\s*(?P<amount>[\d.,]+)\s+de\s+(?P<cp>.+?)\s+el\s+\d{1,2}\s+de\s", _FLAGS),
        "in",
    ),
]

RAPPICARD_PATTERNS = [
    (
        "compra",
        re.compile(
            r"realizaste una compra.*?monto\s+\$\s*(?P<amount>[\d.,]+).*?comercio\s+(?P<cp>.+?)\s+fecha de la transacci",
            _FLAGS,
        ),
        "out",
    ),
]

SOURCES = {
    "bancolombia": {
        "account": "Bancolombia",
        "env": "BANCOLOMBIA_SENDER",
        "senders": (
            "alertasynotificaciones@an.notificacionesbancolombia.com,"
            "alertasynotificaciones@notificacionesbancolombia.com"
        ),
        "patterns": BANCOLOMBIA_PATTERNS,
        "summary": re.compile(r"Bancolombia:\s*(.*?\d{1,2}:\d{2})", re.DOTALL),
        "skip_subject": None,
    },
    "nequi": {
        # Nequi solo manda correo de algunos movimientos; el resto llega por notificacion del
        # celular (webhook). Fuera de "all" para no duplicar: usar --source nequi si se quiere.
        "in_all": False,
        "account": "Nequi",
        "env": "NEQUI_SENDER",
        "senders": "somos@nequi.com.co,notificaciones@nequi.com.co",
        "patterns": NEQUI_PATTERNS,
        "summary": re.compile(
            # "Recibiste <monto>" (no "¡Recibiste plata...!"): el saludo trae el nombre completo
            # del titular y activaria la regla de transferencias propias.
            r"((?:Hiciste un pago|Recibiste\s+\$?\s*\d)\s*.*?(?:Hora:\s*\S+\s*\S+|desde el banco \S+))", re.DOTALL
        ),
        "skip_subject": re.compile(r"acceso", re.IGNORECASE),
    },
    "rappicard": {
        "account": "RappiCard",
        "env": "RAPPICARD_SENDER",
        "senders": "noreply@rappicard.co",
        "patterns": RAPPICARD_PATTERNS,
        # Solo monto/comercio/fecha: la frase "con tu RappiCard" haria que la regla
        # de prioridad 5 (pago de tarjeta) clasifique las compras como card_payment.
        "summary": re.compile(r"(Monto\s+\$.*?Fecha de la transacci[oó]n\s+\S+\s+\S+)", re.DOTALL),
        "skip_subject": re.compile(r"fecha de pago", re.IGNORECASE),
    },
}


def _load_token():
    if not TOKEN_PATH.exists():
        return None
    try:
        return Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    except Exception as e:
        print(f"token_gmail.json corrupto ({e}); se eliminara.")
        TOKEN_PATH.unlink(missing_ok=True)
        return None


def _save_token(creds):
    TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")


def _run_oauth_flow():
    if not CREDENTIALS_PATH.exists():
        raise FileNotFoundError(f"Falta {CREDENTIALS_PATH.name} en la raiz del proyecto.")
    print("Abriendo el navegador para autorizar el acceso de solo lectura a Gmail...")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
    return flow.run_local_server(port=0)


class NeedsAuthError(RuntimeError):
    """El token de Gmail no sirve y no se puede renovar solo (hay que autorizar en el navegador)."""


def get_credentials(interactive: bool = True):
    """Con interactive=False (tarea programada) nunca abre el navegador: si hace falta autorizar
    de nuevo lanza NeedsAuthError y la proxima vez que se pulse Sincronizar en la app se reautoriza."""
    creds = _load_token()
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_token(creds)
            return creds
        except RefreshError:
            TOKEN_PATH.unlink(missing_ok=True)
            creds = None
    if not interactive:
        raise NeedsAuthError(
            "Token de Gmail vencido o revocado: abre la app y pulsa Sincronizar para autorizar de nuevo."
        )
    creds = _run_oauth_flow()
    _save_token(creds)
    return creds


def _decode_body(payload) -> str:
    """Concatena todas las partes text/* del mensaje (recorre partes anidadas)."""
    parts_to_check = [payload] + payload.get("parts", [])
    chunks = []
    for part in parts_to_check:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if data and mime.startswith("text/"):
            try:
                chunks.append(base64.urlsafe_b64decode(data).decode("utf-8", errors="replace"))
            except Exception:
                continue
        for sub in part.get("parts", []):
            parts_to_check.append(sub)
    return "\n".join(chunks)


def _html_to_text(body: str) -> str:
    text = re.sub(r"<(script|style).*?</\1>", " ", body, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\[https?://[^\]]*\]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _summary(text: str, cfg: dict) -> str:
    """Solo la frase del movimiento (sin consejos de seguridad ni pie legal), para
    que las reglas de clasificacion no matcheen texto de relleno."""
    match = cfg["summary"].search(text)
    return (match.group(1) if match else text)[:300]


def extract_transaction(text: str, patterns):
    """Devuelve (tipo_patron, monto, direccion, contraparte) o None si nada matchea."""
    for name, pattern, direction in patterns:
        match = pattern.search(text)
        if not match:
            continue
        amount = parsing.parse_colombian_amount(match.group("amount"))
        if amount is None:
            continue
        return name, amount, direction, match.group("cp").strip()
    return None


def fetch_messages(gmail, senders: str, max_results: int):
    sender_list = [s.strip() for s in senders.split(",") if s.strip()]
    query = "from:(" + " OR ".join(sender_list) + ")"
    response = gmail.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    return response.get("messages", [])


def discover(max_results: int, query: str):
    """Lista remitente/asunto de correos que coinciden con `query`, para descubrir
    la direccion real que envia las alertas."""
    gmail = build("gmail", "v1", credentials=get_credentials())
    messages = gmail.users().messages().list(userId="me", q=query, maxResults=max_results).execute().get("messages", [])
    print(f"{len(messages)} correo(s) para la busqueda {query!r}.\n")
    for meta in messages:
        msg = (
            gmail.users()
            .messages()
            .get(userId="me", id=meta["id"], format="metadata", metadataHeaders=["From", "Subject"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        print(f"From: {headers.get('From')} | Subject: {headers.get('Subject')}")


def _process_source(gmail, key: str, max_results: int, commit: bool, client):
    cfg = SOURCES[key]
    senders = os.environ.get(cfg["env"], cfg["senders"])
    messages = fetch_messages(gmail, senders, max_results)
    print(f"\n== {key}: {len(messages)} correo(s) de {senders}")

    account_id = parsing.get_account_id(client, cfg["account"]) if commit else None
    inserted = duplicates = unmatched = 0

    for meta in messages:
        msg = gmail.users().messages().get(userId="me", id=meta["id"], format="full").execute()
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        if cfg["skip_subject"] and cfg["skip_subject"].search(headers.get("Subject", "")):
            continue

        body_text = _html_to_text(_decode_body(msg["payload"]))
        occurred_at = datetime.fromtimestamp(int(msg["internalDate"]) / 1000, tz=timezone.utc).isoformat()
        result = extract_transaction(body_text, cfg["patterns"])
        preview = _summary(body_text, cfg)

        if result is None:
            unmatched += 1
            print(f"[SIN MATCH] id={meta['id']} | {preview}")
            continue

        pattern_name, amount, direction, counterparty = result
        print(f"[{pattern_name.upper()}] id={meta['id']} direccion={direction} monto={amount} contraparte={counterparty!r}")

        if commit:
            ok = parsing.insert_transaction(
                client,
                account_id=account_id,
                occurred_at=occurred_at,
                direction=direction,
                amount=amount,
                source="email",
                dedupe_hash=f"gmail:{meta['id']}",
                counterparty=counterparty,
                description=preview,
                raw_text=body_text,
            )
            if ok:
                inserted += 1
            else:
                duplicates += 1

    return inserted, duplicates, unmatched


def run(max_results: int, commit: bool, source: str = "all", interactive: bool = True):
    gmail = build("gmail", "v1", credentials=get_credentials(interactive))
    client = get_client() if commit else None
    keys = [k for k, cfg in SOURCES.items() if cfg.get("in_all", True)] if source == "all" else [source]

    inserted = duplicates = unmatched = 0
    for key in keys:
        i, d, u = _process_source(gmail, key, max_results, commit, client)
        inserted, duplicates, unmatched = inserted + i, duplicates + d, unmatched + u

    print(
        f"\nTotal sin match: {unmatched}"
        + (f" | insertados: {inserted} | duplicados: {duplicates}" if commit else " | (dry-run, nada se inserto)")
    )
    return inserted, duplicates, unmatched


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--max", type=int, default=20, help="Maximo de correos a revisar por fuente")
    parser.add_argument("--source", choices=["all", *SOURCES], default="all")
    parser.add_argument("--commit", action="store_true", help="Inserta en Supabase; sin esto, dry-run.")
    parser.add_argument("--discover", action="store_true", help="Solo lista remitente/asunto de una busqueda.")
    parser.add_argument("--query", default="bancolombia", help="Busqueda de Gmail para --discover")
    args = parser.parse_args()
    if args.discover:
        discover(args.max, args.query)
    else:
        run(max_results=args.max, commit=args.commit, source=args.source)


if __name__ == "__main__":
    main()
