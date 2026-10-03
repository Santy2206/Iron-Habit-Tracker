"""Pagina del Finance Tracker, montada dentro del shell de Iron (features/shell.py)
bajo el area 'Productive', siguiendo el mismo patron que DietPage
(features/physical/calendar_gui.py): un CTkFrame con una barra de navegacion
arriba y un body que se re-renderiza.
"""

import threading
from datetime import date
from tkinter import messagebox

import customtkinter as ctk

from features.productive.finance import food_view
from features.productive.finance.supabase_client import get_client
from features.productive.finance.ui_common import (
    BAD_COLOR, CARD_COLOR, GOOD_COLOR, MUTED_TEXT, TEXT_COLOR, WARN_COLOR,
    darken as _darken, fmt_cop as _fmt_cop,
)

BUCKET_LABELS = {"needs": "Necesidades", "wants": "Gustos", "savings": "Ahorro", "none": "Sin bolsa"}
MODES = {"Resumen": "resumen", "Revisión": "revision", "Comida": "comida"}
LIVE_TABLES = ["transactions", "food_purchases", "food_items"]


class FinancePage(ctk.CTkFrame):
    def __init__(self, master, data, accent_color=GOOD_COLOR):
        super().__init__(master, fg_color="transparent")
        # El acento del sidebar es muy claro para texto blanco; lo oscurecemos para botones.
        self.accent_color = _darken(accent_color, 0.35)
        self.accent_hover = _darken(accent_color, 0.45)
        self._sync_result = None
        self.mode = "resumen"
        self.client = None
        self.client_error = None
        self._accounts_by_id = {}
        self._categories = []
        self.food_state = {"month": food_view.current_month(), "open": set()}
        self._open_dialogs = 0
        self._dirty = False
        self._review_sig = None
        self._listener = None

        try:
            self.client = get_client()
        except Exception as e:
            self.client_error = str(e)

        self._build_nav()
        self.body = ctk.CTkFrame(self, fg_color="transparent")
        self.body.pack(fill="both", expand=True, padx=24, pady=(0, 24))
        self.render()
        self._start_live()

    # ------------------------------------------------------- cambios en vivo

    def _start_live(self):
        """Escucha Supabase Realtime: lo que cambie la app movil (o una sincronizacion)
        se refleja aqui sin pulsar Actualizar."""
        if not self.client:
            return
        try:
            from features.productive.finance.realtime_listener import ChangeListener

            self._listener = ChangeListener(LIVE_TABLES)
            self._listener.start()
        except Exception:
            self._listener = None
            return
        self.bind("<Destroy>", lambda e: self._listener and e.widget is self and self._listener.stop())
        self.after(700, self._poll_live)

    def _poll_live(self):
        if not self.winfo_exists():
            return
        try:
            if self._listener and self._listener.consume_change():
                self._on_remote_change()
        finally:
            self.after(700, self._poll_live)

    def _on_remote_change(self):
        if self._open_dialogs > 0:
            self._dirty = True
            return
        if self.mode == "revision":
            # No rehacer la lista si solo cambio algo ajeno: se perderian las listas desplegables sin guardar.
            if self._review_signature(self._fetch_review_rows()) == self._review_sig:
                return
        self.render()

    def _set_busy(self, busy):
        self._open_dialogs = max(0, self._open_dialogs + (1 if busy else -1))
        if self._open_dialogs == 0 and self._dirty:
            self._dirty = False
            self.render()

    def _build_nav(self):
        nav = ctk.CTkFrame(self, fg_color="transparent")
        nav.pack(fill="x", padx=24, pady=24)

        ctk.CTkLabel(
            nav, text="Finance Tracker", font=ctk.CTkFont(family="Segoe UI", size=20, weight="bold")
        ).pack(side="left")

        ctk.CTkButton(
            nav, text="↻ Actualizar", width=110, command=self.render,
            fg_color="white", hover_color="#e5e7eb", text_color="#1a1d23",
        ).pack(side="right", padx=(12, 0))

        self.sync_button = ctk.CTkButton(
            nav, text="✉ Sincronizar", width=120, command=self._start_sync,
            fg_color="white", hover_color="#e5e7eb", text_color="#1a1d23",
        )
        self.sync_button.pack(side="right", padx=(12, 0))

        ctk.CTkButton(
            nav, text="+ Movimiento", width=120, command=self._open_manual,
            fg_color=self.accent_color, hover_color=self.accent_hover,
        ).pack(side="right", padx=(12, 0))

        self.status_label = ctk.CTkLabel(
            nav, text="", text_color=MUTED_TEXT, font=ctk.CTkFont(family="Segoe UI", size=12)
        )
        self.status_label.pack(side="right", padx=(12, 0))

        self.view_switch = ctk.CTkSegmentedButton(
            nav, values=list(MODES), command=self.on_mode_change,
            selected_color=self.accent_color, selected_hover_color=self.accent_hover,
        )
        self.view_switch.set("Resumen")
        self.view_switch.pack(side="right")

    def _open_manual(self):
        if not self.client:
            messagebox.showwarning("Sin conexión", self.client_error or "No hay conexión a Supabase.")
            return
        from features.productive.finance import manual_entry

        try:
            manual_entry.open_manual_dialog(
                self, self.client, self.accent_color, self.accent_hover, self._set_busy, self.render
            )
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _start_sync(self):
        """Lee los correos nuevos de Bancolombia en un hilo aparte (puede tardar
        o abrir el navegador si el token de Gmail caduco) y redibuja al terminar."""
        self.sync_button.configure(state="disabled", text="Sincronizando…")
        self.status_label.configure(text="", text_color=MUTED_TEXT)
        self._sync_result = None
        threading.Thread(target=self._sync_worker, daemon=True).start()
        self.after(300, self._poll_sync)

    def _sync_worker(self):
        try:
            from features.productive.finance import gmail_sync

            self._sync_result = ("ok", gmail_sync.run(max_results=50, commit=True))
        except Exception as e:
            self._sync_result = ("error", str(e))

    def _poll_sync(self):
        if self._sync_result is None:
            self.after(300, self._poll_sync)
            return
        kind, payload = self._sync_result
        self.sync_button.configure(state="normal", text="✉ Sincronizar")
        if kind == "ok":
            inserted, _duplicates, unmatched = payload
            text = f"{inserted} nuevo(s)" + (f", {unmatched} sin interpretar" if unmatched else "")
            self.status_label.configure(text=text, text_color=GOOD_COLOR)
        else:
            self.status_label.configure(text=f"Error: {payload[:60]}", text_color=BAD_COLOR)
        self.render()

    def on_mode_change(self, value):
        self.mode = MODES[value]
        self.render()

    def render(self):
        for widget in self.body.winfo_children():
            widget.destroy()

        if self.client_error:
            ctk.CTkLabel(
                self.body,
                text=(
                    "No se pudo conectar a Supabase.\n\n"
                    f"{self.client_error}"
                ),
                text_color=MUTED_TEXT, justify="left",
                font=ctk.CTkFont(family="Segoe UI", size=13),
            ).pack(expand=True, padx=12, pady=12)
            return

        try:
            if self.mode == "resumen":
                self._render_resumen()
            elif self.mode == "comida":
                food_view.FoodView(
                    self.body, self.client, self.food_state, self.accent_color, self.accent_hover, self._set_busy
                ).pack(fill="both", expand=True)
            else:
                self._render_revision()
        except Exception as e:
            ctk.CTkLabel(
                self.body, text=f"Error consultando Supabase:\n{e}",
                text_color=BAD_COLOR, justify="left",
            ).pack(expand=True, padx=12, pady=12)

    # ------------------------------------------------------------------ Resumen

    def _render_resumen(self):
        today_month = date.today().replace(day=1).isoformat()
        result = (
            self.client.table("monthly_budget")
            .select("*")
            .lte("month", today_month)
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []

        if not rows:
            ctk.CTkLabel(
                self.body, text="Todavía no hay movimientos de ingreso este mes.",
                text_color=MUTED_TEXT, font=ctk.CTkFont(family="Segoe UI", size=14),
            ).pack(expand=True, padx=12, pady=12)
            return

        row = rows[0]
        cards_row = ctk.CTkFrame(self.body, fg_color="transparent")
        cards_row.pack(fill="x", pady=(0, 16))

        ctk.CTkLabel(
            self.body, text=f"{row['month'][:7]} · Ingreso del mes: {_fmt_cop(row['income'])}",
            font=ctk.CTkFont(family="Segoe UI", size=15, weight="bold"),
        ).pack(anchor="w", pady=(0, 4))

        extras = []
        if (row.get("sponsorship_income") or 0) > 0:
            extras.append(f"Patrocinio: {_fmt_cop(row['sponsorship_income'])}")
        if (row.get("interest_income") or 0) > 0:
            extras.append(f"Intereses: {_fmt_cop(row['interest_income'])}")
        if (row.get("debt_repayment_income") or 0) > 0:
            extras.append(f"Deudas cobradas: {_fmt_cop(row['debt_repayment_income'])}")
        if extras:
            ctk.CTkLabel(
                self.body, text="Fuera de la base 50/30/20 (van a ahorros) — " + "  ·  ".join(extras),
                text_color=MUTED_TEXT, font=ctk.CTkFont(family="Segoe UI", size=12),
            ).pack(anchor="w", pady=(0, 8))

        for bucket, goal_key, spent_key, avail_key in (
            ("needs", "needs_goal", "needs_spent", "needs_available"),
            ("wants", "wants_goal", "wants_spent", "wants_available"),
            ("savings", "savings_goal", "savings_actual", "savings_available"),
        ):
            self._build_bucket_card(cards_row, bucket, row[goal_key], row[spent_key], row[avail_key])

        progress = (
            self.client.table("savings_progress")
            .select("*")
            .lte("month", today_month)
            .order("month", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if progress:
            p = progress[0]
            remaining = float(p["remaining"])
            ctk.CTkLabel(
                self.body,
                text=(
                    f"Ahorro acumulado — debes enviar {_fmt_cop(p['cumulative_target'])} · "
                    f"enviado {_fmt_cop(p['cumulative_sent'])} · "
                    + (f"falta {_fmt_cop(remaining)}" if remaining > 0 else f"adelantado {_fmt_cop(-remaining)}")
                ),
                text_color=WARN_COLOR if remaining > 0 else GOOD_COLOR,
                font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
            ).pack(anchor="w", pady=(4, 0))

        unclassified = row.get("unclassified_expense", 0) or 0
        if unclassified > 0:
            ctk.CTkLabel(
                self.body,
                text=f"⚠ {_fmt_cop(unclassified)} en movimientos sin clasificar — revisa la pestaña Revisión.",
                text_color=WARN_COLOR, font=ctk.CTkFont(family="Segoe UI", size=13),
            ).pack(anchor="w", pady=(4, 0))

    def _build_bucket_card(self, parent, bucket, goal, spent_or_actual, available):
        card = ctk.CTkFrame(parent, fg_color=CARD_COLOR, corner_radius=10)
        card.pack(side="left", fill="both", expand=True, padx=(0, 12))

        ctk.CTkLabel(
            card, text=BUCKET_LABELS[bucket], text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
        ).pack(anchor="w", padx=16, pady=(14, 4))

        label = "ahorrado" if bucket == "savings" else "gastado"
        ctk.CTkLabel(
            card, text=f"Meta: {_fmt_cop(goal)}", text_color=MUTED_TEXT,
            font=ctk.CTkFont(family="Segoe UI", size=12),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            card, text=f"{label.capitalize()}: {_fmt_cop(spent_or_actual)}", text_color=MUTED_TEXT,
            font=ctk.CTkFont(family="Segoe UI", size=12),
        ).pack(anchor="w", padx=16)

        available_color = GOOD_COLOR if float(available) >= 0 else BAD_COLOR
        available_label = "Disponible" if bucket != "savings" else "Diferencia vs. meta"
        ctk.CTkLabel(
            card, text=f"{available_label}: {_fmt_cop(available)}", text_color=available_color,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
        ).pack(anchor="w", padx=16, pady=(4, 14))

    # ----------------------------------------------------------------- Revisión

    def _load_accounts_and_categories(self):
        if not self._accounts_by_id:
            accounts = self.client.table("accounts").select("id, name").execute().data or []
            self._accounts_by_id = {a["id"]: a["name"] for a in accounts}
        if not self._categories:
            self._categories = self.client.table("categories").select("id, name").order("name").execute().data or []

    def _fetch_review_rows(self):
        return (
            self.client.table("transactions")
            .select("id, account_id, occurred_at, direction, amount, description, raw_text, type, category_id, paired_with")
            .eq("needs_review", True)
            .order("occurred_at", desc=True)
            .limit(50)
            .execute()
            .data
            or []
        )

    @staticmethod
    def _review_signature(rows):
        return tuple((r["id"], r.get("type"), r.get("category_id")) for r in rows)

    def _render_revision(self):
        self._load_accounts_and_categories()
        rows = self._fetch_review_rows()
        self._review_sig = self._review_signature(rows)

        if not rows:
            ctk.CTkLabel(
                self.body, text="No hay movimientos pendientes de revisión. 🎉",
                text_color=MUTED_TEXT, font=ctk.CTkFont(family="Segoe UI", size=14),
            ).pack(expand=True, padx=12, pady=12)
            return

        scroll = ctk.CTkScrollableFrame(self.body, fg_color="transparent")
        scroll.pack(fill="both", expand=True)

        for row in rows:
            self._build_review_row(scroll, row)

    def _build_review_row(self, parent, row):
        card = ctk.CTkFrame(parent, fg_color=CARD_COLOR, corner_radius=10)
        card.pack(fill="x", pady=6)

        account_name = self._accounts_by_id.get(row["account_id"], "?")
        sign = "+" if row["direction"] == "in" else "-"
        text = row.get("description") or row.get("raw_text") or "(sin descripción)"

        info = ctk.CTkFrame(card, fg_color="transparent")
        info.pack(side="left", fill="both", expand=True, padx=12, pady=10)
        ctk.CTkLabel(
            info, text=f"{row['occurred_at'][:10]}  ·  {account_name}  ·  {sign}{_fmt_cop(row['amount'])}",
            text_color=TEXT_COLOR, font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"), anchor="w",
        ).pack(anchor="w")
        ctk.CTkLabel(
            info, text=text[:140], text_color=MUTED_TEXT, anchor="w", justify="left",
            font=ctk.CTkFont(family="Segoe UI", size=12), wraplength=420,
        ).pack(anchor="w")
        if row.get("paired_with"):
            ctk.CTkLabel(
                info, text="↔ Emparejado con otro movimiento: parece una transferencia entre tus cuentas",
                text_color=GOOD_COLOR, anchor="w", font=ctk.CTkFont(family="Segoe UI", size=12),
            ).pack(anchor="w")

        controls = ctk.CTkFrame(card, fg_color="transparent")
        controls.pack(side="right", padx=12, pady=10)

        type_values = [
            "income", "expense", "savings", "savings_withdrawal", "internal_transfer",
            "card_payment", "sponsorship", "interest", "debt_repayment",
        ]
        type_var = ctk.StringVar(
            value=row.get("type") or ("expense" if row["direction"] == "out" else "income")
        )
        type_menu = ctk.CTkOptionMenu(controls, values=type_values, variable=type_var, width=150)
        type_menu.pack(side="left", padx=(0, 8))

        category_names = ["(sin categoría)"] + [c["name"] for c in self._categories]
        current_category = next(
            (c["name"] for c in self._categories if c["id"] == row.get("category_id")), "(sin categoría)"
        )
        category_var = ctk.StringVar(value=current_category)
        category_menu = ctk.CTkOptionMenu(controls, values=category_names, variable=category_var, width=170)
        category_menu.pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            controls, text="Guardar", width=80,
            fg_color=self.accent_color, hover_color=self.accent_hover,
            command=lambda: self._save_review(row["id"], type_var.get(), category_var.get()),
        ).pack(side="left")

    def _save_review(self, transaction_id, type_value, category_name):
        category_id = None
        if category_name != "(sin categoría)":
            category_id = next((c["id"] for c in self._categories if c["name"] == category_name), None)

        self.client.table("transactions").update(
            {"type": type_value, "category_id": category_id, "needs_review": False}
        ).eq("id", transaction_id).execute()
        self.render()
