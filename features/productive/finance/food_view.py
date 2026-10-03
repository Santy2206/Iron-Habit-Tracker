"""Pestana 'Comida' del escritorio: el mismo registro de compras que la app movil
(features/productive/finance/mobile), sobre las mismas tablas de Supabase."""

import uuid
from datetime import date
from tkinter import messagebox

import customtkinter as ctk

from features.productive.finance import parsing
from features.productive.finance.ui_common import (
    BAD_COLOR, CARD_COLOR, GOOD_COLOR, MUTED_TEXT, TEXT_COLOR, fmt_cop,
)

MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre",
]


def current_month() -> str:
    return date.today().strftime("%Y-%m")


def shift_month(ym: str, delta: int) -> str:
    year, month = map(int, ym.split("-"))
    index = year * 12 + (month - 1) + delta
    return f"{index // 12}-{index % 12 + 1:02d}"


def month_label(ym: str) -> str:
    year, month = ym.split("-")
    return f"{MONTHS[int(month) - 1]} {year}"


class FoodView(ctk.CTkFrame):
    """`state` es un dict {"month": "YYYY-MM", "open": set(grupos abiertos)} que vive en la
    pagina, para que el mes y los desplegables sobrevivan a las actualizaciones en vivo.
    `on_busy(True/False)` avisa a la pagina cuando hay un dialogo abierto (no refrescar)."""

    def __init__(self, master, client, state, accent, accent_hover, on_busy):
        super().__init__(master, fg_color="transparent")
        self.client = client
        self.state = state
        self.accent = accent
        self.accent_hover = accent_hover
        self.on_busy = on_busy
        self.items = []
        self.purchases = []
        self.reload()

    # ------------------------------------------------------------------ datos

    def _fetch(self):
        month = self.state["month"]
        self.items = (
            self.client.table("food_items")
            .select("id,name,group_name,sort_order")
            .eq("active", True)
            .order("group_name")
            .order("sort_order")
            .execute()
            .data
            or []
        )
        self.purchases = (
            self.client.table("food_purchases")
            .select("id,item_id,purchased_at,amount,expression,paid_cash,transaction_id")
            .gte("purchased_at", f"{month}-01")
            .lt("purchased_at", f"{shift_month(month, 1)}-01")
            .order("purchased_at")
            .execute()
            .data
            or []
        )

    def reload(self):
        for widget in self.winfo_children():
            widget.destroy()
        try:
            self._fetch()
        except Exception as e:
            ctk.CTkLabel(self, text=f"Error consultando Supabase:\n{e}", text_color=BAD_COLOR, justify="left").pack(
                padx=12, pady=12
            )
            return
        self._build()

    def _go(self, delta):
        self.state["month"] = shift_month(self.state["month"], delta)
        self.reload()

    # --------------------------------------------------------------------- UI

    def _build(self):
        by_item = {}
        for p in self.purchases:
            by_item[p["item_id"]] = by_item.get(p["item_id"], 0) + float(p["amount"])
        month_total = sum(by_item.values())

        nav = ctk.CTkFrame(self, fg_color="transparent")
        nav.pack(fill="x", pady=(0, 8))
        for text, delta in (("◀", -1), ("▶", 1)):
            ctk.CTkButton(
                nav, text=text, width=36, command=lambda d=delta: self._go(d),
                fg_color="white", hover_color="#e5e7eb", text_color="#1a1d23",
            ).pack(side="left", padx=(0, 6))
        ctk.CTkLabel(
            nav, text=month_label(self.state["month"]), font=ctk.CTkFont(family="Segoe UI", size=16, weight="bold")
        ).pack(side="left", padx=12)
        ctk.CTkButton(
            nav, text="+ Nuevo alimento", width=140, command=self._add_item,
            fg_color=self.accent, hover_color=self.accent_hover,
        ).pack(side="right")

        card = ctk.CTkFrame(self, fg_color=CARD_COLOR, corner_radius=10)
        card.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(card, text="Total del mes en comida", text_color=MUTED_TEXT).pack(anchor="w", padx=16, pady=(10, 0))
        ctk.CTkLabel(
            card, text=fmt_cop(month_total), font=ctk.CTkFont(family="Segoe UI", size=22, weight="bold")
        ).pack(anchor="w", padx=16, pady=(0, 10))

        scroll = ctk.CTkScrollableFrame(self, fg_color="transparent")
        scroll.pack(fill="both", expand=True)

        groups = {}
        for item in self.items:
            groups.setdefault(item["group_name"], []).append(item)
        for name, items in groups.items():
            self._build_group(scroll, name, items, by_item)

    def _build_group(self, parent, name, items, by_item):
        is_open = name in self.state["open"]
        total = sum(by_item.get(i["id"], 0) for i in items)
        bought = sum(1 for i in items if i["id"] in by_item)

        wrapper = ctk.CTkFrame(parent, fg_color="transparent")
        wrapper.pack(fill="x", pady=(0, 6))
        head = ctk.CTkFrame(wrapper, fg_color=CARD_COLOR, corner_radius=10)
        head.pack(fill="x")
        body = ctk.CTkFrame(wrapper, fg_color="transparent")

        def title(opened):
            return f"{'▾' if opened else '▸'}  {name}   {bought}/{len(items)}"

        def toggle():
            if name in self.state["open"]:
                self.state["open"].discard(name)
                body.pack_forget()
                button.configure(text=title(False))
            else:
                self.state["open"].add(name)
                body.pack(fill="x", padx=(18, 0), pady=(4, 0))
                button.configure(text=title(True))

        button = ctk.CTkButton(
            head, text=title(is_open), anchor="w", command=toggle,
            fg_color="transparent", hover_color=("#d5dae3", "#303642"), text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
        )
        button.pack(side="left", fill="x", expand=True, padx=4, pady=4)
        ctk.CTkLabel(head, text=fmt_cop(total), text_color=GOOD_COLOR if total > 0 else MUTED_TEXT).pack(
            side="right", padx=14
        )
        if is_open:
            body.pack(fill="x", padx=(18, 0), pady=(4, 0))

        for item in items:
            row = ctk.CTkFrame(body, fg_color=CARD_COLOR, corner_radius=8)
            row.pack(fill="x", pady=3)
            ctk.CTkButton(
                row, text=item["name"], anchor="w", command=lambda it=item: self._open_dialog(it),
                fg_color="transparent", hover_color=("#d5dae3", "#303642"), text_color=TEXT_COLOR,
            ).pack(side="left", fill="x", expand=True, padx=4, pady=2)
            has = item["id"] in by_item
            ctk.CTkLabel(
                row, text=fmt_cop(by_item[item["id"]]) if has else "—",
                text_color=GOOD_COLOR if has else MUTED_TEXT,
            ).pack(side="right", padx=12)

    # ------------------------------------------------------------- acciones

    def _add_item(self):
        groups = sorted({i["group_name"] for i in self.items})
        name = ctk.CTkInputDialog(text="Nombre del alimento", title="Nuevo alimento").get_input()
        if not name or not name.strip():
            return
        group = ctk.CTkInputDialog(
            text="Grupo (existentes: " + ", ".join(groups) + ")", title="Grupo"
        ).get_input()
        if not group or not group.strip():
            return
        try:
            self.client.table("food_items").insert(
                {"name": name.strip(), "group_name": group.strip(), "sort_order": 99}
            ).execute()
        except Exception as e:
            messagebox.showerror("Error", str(e))
            return
        self.reload()

    def _open_dialog(self, item):
        mine = [p for p in self.purchases if p["item_id"] == item["id"]]
        win = ctk.CTkToplevel(self)
        win.title(item["name"])
        win.geometry("440x640")
        win.after(150, win.lift)
        self.on_busy(True)

        def close():
            win.destroy()
            self.on_busy(False)

        win.protocol("WM_DELETE_WINDOW", close)

        ctk.CTkLabel(win, text=item["name"], font=ctk.CTkFont(family="Segoe UI", size=18, weight="bold")).pack(
            anchor="w", padx=20, pady=(16, 0)
        )
        ctk.CTkLabel(win, text=month_label(self.state["month"]), text_color=MUTED_TEXT).pack(anchor="w", padx=20)

        if mine:
            ctk.CTkLabel(win, text="Registrado este mes", text_color=MUTED_TEXT).pack(anchor="w", padx=20, pady=(12, 2))
            for p in mine:
                row = ctk.CTkFrame(win, fg_color=CARD_COLOR, corner_radius=8)
                row.pack(fill="x", padx=20, pady=2)
                day = p["purchased_at"]
                ctk.CTkLabel(
                    row,
                    text=f"{day[8:10]}/{day[5:7]} · {fmt_cop(p['amount'])}" + (" · efectivo" if p["paid_cash"] else ""),
                ).pack(side="left", padx=12, pady=6)
                ctk.CTkButton(
                    row, text="✕", width=32, fg_color="transparent", hover_color=("#d5dae3", "#303642"),
                    text_color=MUTED_TEXT, command=lambda pur=p: remove(pur),
                ).pack(side="right", padx=6)

        ctk.CTkLabel(win, text="Agregar compra", text_color=MUTED_TEXT).pack(anchor="w", padx=20, pady=(14, 2))
        expr_var = ctk.StringVar()
        ctk.CTkEntry(win, textvariable=expr_var, placeholder_text="ej. 5200+2600+13500").pack(fill="x", padx=20)
        preview = ctk.CTkLabel(win, text="Total: —", text_color=MUTED_TEXT)
        preview.pack(anchor="w", padx=20)

        def update_preview(*_):
            text = expr_var.get().strip()
            total = parsing.parse_price_expression(text) if text else None
            if not text:
                preview.configure(text="Total: —", text_color=MUTED_TEXT)
            elif total is None:
                preview.configure(text="Revisa los números (usa + para sumar)", text_color=BAD_COLOR)
            else:
                preview.configure(text=f"Total: {fmt_cop(total)}", text_color=GOOD_COLOR)

        expr_var.trace_add("write", update_preview)

        ctk.CTkLabel(win, text="Fecha (AAAA-MM-DD)", text_color=MUTED_TEXT).pack(anchor="w", padx=20, pady=(10, 2))
        default_day = date.today().isoformat() if self.state["month"] == current_month() else f"{self.state['month']}-01"
        date_var = ctk.StringVar(value=default_day)
        ctk.CTkEntry(win, textvariable=date_var).pack(fill="x", padx=20)

        cash_var = ctk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            win, text="Pagué en efectivo (suma al presupuesto de Mercado)", variable=cash_var,
            fg_color=self.accent, hover_color=self.accent_hover,
        ).pack(anchor="w", padx=20, pady=(12, 2))
        ctk.CTkLabel(
            win, text="Si pagaste con tarjeta o transferencia, déjalo apagado:\nesa compra ya llega por alerta.",
            text_color=MUTED_TEXT, justify="left",
        ).pack(anchor="w", padx=20)

        error = ctk.CTkLabel(win, text="", text_color=BAD_COLOR, wraplength=380, justify="left")
        error.pack(anchor="w", padx=20, pady=(8, 0))

        def save():
            error.configure(text="")
            total = parsing.parse_price_expression(expr_var.get())
            if total is None:
                error.configure(text="Escribe un precio válido, ej. 5200+2600")
                return
            day = date_var.get().strip()
            try:
                date.fromisoformat(day)
            except ValueError:
                error.configure(text="La fecha debe ser AAAA-MM-DD")
                return
            try:
                transaction_id = None
                if cash_var.get():
                    accounts = self.client.table("accounts").select("id").eq("name", "Efectivo").execute().data
                    if not accounts:
                        raise RuntimeError("No existe la cuenta Efectivo")
                    tx = (
                        self.client.table("transactions")
                        .insert(
                            {
                                "account_id": accounts[0]["id"],
                                "occurred_at": f"{day}T12:00:00-05:00",
                                "direction": "out",
                                "amount": total,
                                "source": "manual",
                                "dedupe_hash": f"food:{uuid.uuid4()}",
                                "counterparty": item["name"],
                                "description": f"Comida: {item['name']}",
                            }
                        )
                        .execute()
                        .data[0]
                    )
                    transaction_id = tx["id"]
                self.client.table("food_purchases").insert(
                    {
                        "item_id": item["id"],
                        "purchased_at": day,
                        "amount": total,
                        "expression": expr_var.get().strip(),
                        "paid_cash": bool(cash_var.get()),
                        "transaction_id": transaction_id,
                    }
                ).execute()
            except Exception as e:
                error.configure(text=f"Error: {e}")
                return
            close()
            self.reload()

        def remove(purchase):
            if not messagebox.askyesno("Borrar", f"¿Borrar {fmt_cop(purchase['amount'])}?", parent=win):
                return
            try:
                if purchase["transaction_id"]:
                    self.client.table("transactions").delete().eq("id", purchase["transaction_id"]).execute()
                self.client.table("food_purchases").delete().eq("id", purchase["id"]).execute()
            except Exception as e:
                error.configure(text=f"Error: {e}")
                return
            close()
            self.reload()

        buttons = ctk.CTkFrame(win, fg_color="transparent")
        buttons.pack(fill="x", padx=20, pady=16)
        ctk.CTkButton(buttons, text="Cerrar", command=close, fg_color=("#cfd5df", "#323844"), text_color=TEXT_COLOR).pack(
            side="left", expand=True, fill="x", padx=(0, 6)
        )
        ctk.CTkButton(buttons, text="Guardar", command=save, fg_color=self.accent, hover_color=self.accent_hover).pack(
            side="left", expand=True, fill="x", padx=(6, 0)
        )
