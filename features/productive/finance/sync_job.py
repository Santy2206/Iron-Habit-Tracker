"""Tarea desatendida (Programador de tareas de Windows): lee los correos nuevos de Bancolombia y
RappiCard y los guarda en Supabase. Mismo patron que features/physical/weekly_average_job.py:
nunca abre el navegador; si Gmail necesita autorizacion de nuevo, lo anota en el log y sale.

Solo escribe en el log cuando entra algo nuevo o hay un error (corre cada pocos minutos).
Si hay un error repetido, lo anota una vez por hora para no llenar el archivo.
"""

import time
from datetime import datetime

from features.physical import storage
from features.productive.finance import gmail_sync

LOG_FILE = storage.DATA_DIR / "finance_sync.log"
STATE_FILE = storage.DATA_DIR / "finance_sync_last_error.txt"
MAX_LOG_BYTES = 512 * 1024
REPEAT_ERROR_SECONDS = 3600


def log(message):
    storage.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > MAX_LOG_BYTES:
        lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
        LOG_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    stamp = datetime.now().isoformat(timespec="seconds")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {message}\n")


def _should_log_error(message: str) -> bool:
    try:
        last_message, last_time = STATE_FILE.read_text(encoding="utf-8").split("\n", 1)
        if last_message == message and time.time() - float(last_time) < REPEAT_ERROR_SECONDS:
            return False
    except (OSError, ValueError):
        pass
    storage.DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(f"{message}\n{time.time()}", encoding="utf-8")
    return True


def main():
    try:
        inserted, _duplicates, unmatched = gmail_sync.run(max_results=25, commit=True, interactive=False)
    except Exception as e:  # noqa: BLE001 - un job desatendido solo debe registrar y salir
        message = f"ERROR {type(e).__name__}: {e}"
        if _should_log_error(message):
            log(message)
        return
    STATE_FILE.unlink(missing_ok=True)
    if inserted:
        log(f"{inserted} movimiento(s) nuevo(s) guardado(s)" + (f"; {unmatched} correo(s) sin interpretar" if unmatched else ""))


if __name__ == "__main__":
    main()
