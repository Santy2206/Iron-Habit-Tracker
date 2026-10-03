"""Cliente Supabase compartido por el Finance Tracker.

Usa la service_role key porque estos scripts corren localmente de forma
confiable (igual que credentials.json/token.json para Google Fit) y las
tablas tienen RLS restringido a `authenticated`, que un script de escritorio
sin login de Supabase no puede satisfacer.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ENV_PATH)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env. "
            "La service_role key esta en el dashboard de Supabase: "
            "Project Settings -> API -> service_role secret."
        )

    _client = create_client(url, key)
    return _client
