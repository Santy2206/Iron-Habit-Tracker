"""Escucha cambios de Supabase Realtime en un hilo aparte para que la app de escritorio se
actualice cuando la app movil (o una sincronizacion de Gmail) cambia algo.

Tkinter no es seguro entre hilos: el hilo solo levanta una bandera (`consume_change`) y la
ventana la revisa con `after()` desde el hilo principal.
"""

import asyncio
import os
import threading
import time

from realtime import AsyncRealtimeClient

from features.productive.finance import supabase_client  # noqa: F401  (carga .env)


class ChangeListener:
    def __init__(self, tables):
        self._tables = tables
        self._changed = threading.Event()
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()

    def consume_change(self) -> bool:
        """True si hubo cambios desde la ultima vez que se llamo."""
        if self._changed.is_set():
            self._changed.clear()
            return True
        return False

    def _run(self):
        asyncio.run(self._main())

    async def _main(self):
        url = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        ws_url = url.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1"
        while not self._stop.is_set():
            client = None
            try:
                client = AsyncRealtimeClient(ws_url, key)
                channel = client.channel("iron-desktop")
                for table in self._tables:
                    channel.on_postgres_changes(
                        "*", lambda _payload: self._changed.set(), table=table, schema="public"
                    )
                await channel.subscribe()
                # listen() devuelve enseguida (la conexion sigue viva y se reconecta sola);
                # solo reconstruimos todo si lleva desconectada mas de 15 s.
                await client.listen()
                offline_since = None
                while not self._stop.is_set():
                    await asyncio.sleep(1)
                    if client.is_connected:
                        offline_since = None
                    elif offline_since is None:
                        offline_since = time.monotonic()
                    elif time.monotonic() - offline_since > 15:
                        break
            except Exception:
                pass
            finally:
                if client is not None:
                    try:
                        await client.close()
                    except Exception:
                        pass
            await asyncio.sleep(5)
