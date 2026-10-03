"""Formulario '+ Movimiento' (escritorio): registra a mano un movimiento que ninguna captura vio
(efectivo, una notificacion perdida, una cuenta sin captura).

Pasa por las mismas reglas que lo automatico (trigger `apply_rules()`), asi que tambien se
empareja solo con la otra mitad de una transferencia entre cuentas propias. Si se elige un tipo
o categoria, se aplican despues de insertar.
"""

import uuid
from datetime import date, datetime

import customtkinter as ctk

from features.productive.finance import parsing
from features.productive.finance.ui_common import (
    BAD_COLOR, GOOD_COLOR, MUTED_TEXT, TEXT_COLOR, fmt_cop,
)

AUTO = "Automático (reglas)"
NO_CATEGORY = "(sin categoría)"
TYPE_OPTIONS = {
    AUTO: None,
    "Ingreso": "income",
    "Gasto": "expense",
    "Ahorro enviado": "savings",
    "Retiro de ahorro": "savings_withdrawal",
    "Transferencia interna": "internal_transfer",
    "Pago de tarjeta": "card_payment",
    "Patrocinio": "sponsorship",
    "Intereses": "interest",
    "Deuda cobrada": "debt_repayment",
}


def occurred_at_for(day: str) -> str:
    """Hoy -> la hora actual (para que pueda emparejarse con la otra mitad); otro dia -> mediodia."""
    if day == date.today().isoformat():
        return datetime.now().astimezone().isoformat()
    return f"{day}T12:00:00-05:00"


class ManualEntryDialog(ctk.CTkToplevel):
    def __init__(self, parent, client, accent, accent_hover, on_busy, on_saved):
        super().__init__(parent)
        self.client = client
        self.accent = accent
        self.accent_hover = accent_hover
        self.on_busy = on_busy
        self.on_saved = on_saved
        self.accounts = client.table("accounts").select("id,name").order("name").execute().data or []
        self.categories = client.table("categories").select("id,name").order("name").execute().data or []

        self.title("Nuevo movimiento")
        self.geometry("460x720")
        self.after(150, self.lift)
        self.on_busy(True)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self._build()

    def _label(self, text):
        ctk.CTkLabel(self, text=text, text_color=MUTED_TEXT).pack(anchor="w", padx=20, pady=(10, 2))

    def _build(self):
        ctk.CTkLabel(self, text="Nuevo movimiento", font=ctk.CTkFont(family="Segoe UI", size=18, weight="bold")).pack(
            anchor="w", padx=20, pady=(16, 0)
        )

        self._label("Cuenta")
        names = [a["name"] for a in self.accounts]
        self.account_var = ctk.StringVar(value=names[0] if names else "")
        ctk.CTkOptionMenu(self, values=names, variable=self.account_var).pack(fill="x", padx=20)

        self._label("Sentido")
        self.direction_var = ctk.StringVar(value="Sale")
        self.direction_switch = ctk.CTkSegmentedButton(
            self, values=["Sale", "Entra"], variable=self.direction_var,
            selected_color=self.accent, selected_hover_color=self.accent_hover,
        )
        self.direction_switch.pack(fill="x", padx=20)

        self._label("Valor (puedes sumar con +)")
        self.amount_var = ctk.StringVar()
        ctk.CTkEntry(self, textvariable=self.amount_var, placeholder_text="ej. 12000 o 5200+2600").pack(fill="x", padx=20)
        self.preview = ctk.CTkLabel(self, text="Total: —", text_color=MUTED_TEXT)
        self.preview.pack(anchor="w", padx=20)
        self.amount_var.trace_add("write", self._update_preview)

        self._label("Fecha (AAAA-MM-DD)")
        self.date_var = ctk.StringVar(value=date.today().isoformat())
        ctk.CTkEntry(self, textvariable=self.date_var).pack(fill="x", padx=20)

        self._label("A quién / de quién (opcional)")
        self.counterparty_var = ctk.StringVar()
        ctk.CTkEntry(self, textvariable=self.counterparty_var).pack(fill="x", padx=20)

        self._label("Nota (opcional)")
        self.note_var = ctk.StringVar()
        ctk.CTkEntry(self, textvariable=self.note_var).pack(fill="x", padx=20)

        self._label("Tipo")
        self.type_var = ctk.StringVar(value=AUTO)
        ctk.CTkOptionMenu(self, values=list(TYPE_OPTIONS), variable=self.type_var).pack(fill="x", padx=20)

        self._label("Categoría (solo si eliges un tipo)")
        self.category_var = ctk.StringVar(value=NO_CATEGORY)
        ctk.CTkOptionMenu(
            self, values=[NO_CATEGORY] + [c["name"] for c in self.categories], variable=self.category_var
        ).pack(fill="x", padx=20)

        self.error = ctk.CTkLabel(self, text="", text_color=BAD_COLOR, wraplength=400, justify="left")
        self.error.pack(anchor="w", padx=20, pady=(10, 0))

        buttons = ctk.CTkFrame(self, fg_color="transparent")
        buttons.pack(fill="x", padx=20, pady=16)
        ctk.CTkButton(buttons, text="Cerrar", command=self.close, fg_color=("#cfd5df", "#323844"), text_color=TEXT_COLOR).pack(
            side="left", expand=True, fill="x", padx=(0, 6)
        )
        ctk.CTkButton(buttons, text="Guardar", command=self.submit, fg_color=self.accent, hover_color=self.accent_hover).pack(
            side="left", expand=True, fill="x", padx=(6, 0)
        )

    def _update_preview(self, *_):
        text = self.amount_var.get().strip()
        total = parsing.parse_price_expression(text) if text else None
        if not text:
            self.preview.configure(text="Total: —", text_color=MUTED_TEXT)
        elif total is None:
            self.preview.configure(text="Revisa los números (usa + para sumar)", text_color=BAD_COLOR)
        else:
            self.preview.configure(text=f"Total: {fmt_cop(total)}", text_color=GOOD_COLOR)

    def close(self):
        self.destroy()
        self.on_busy(False)

    def submit(self):
        """Valida, inserta y (si se eligio) fija tipo/categoria. Devuelve True si guardo."""
        self.error.configure(text="")
        amount = parsing.parse_price_expression(self.amount_var.get())
        if amount is None:
            self.error.configure(text="Escribe un valor válido, ej. 12000")
            return False
        day = self.date_var.get().strip()
        try:
            date.fromisoformat(day)
        except ValueError:
            self.error.configure(text="La fecha debe ser AAAA-MM-DD")
            return False
        account = next((a for a in self.accounts if a["name"] == self.account_var.get()), None)
        if account is None:
            self.error.configure(text="Elige una cuenta")
            return False

        counterparty = self.counterparty_var.get().strip() or None
        note = self.note_var.get().strip()
        try:
            row = (
                self.client.table("transactions")
                .insert(
                    {
                        "account_id": account["id"],
                        "occurred_at": occurred_at_for(day),
                        "direction": "in" if self.direction_var.get() == "Entra" else "out",
                        "amount": amount,
                        "source": "manual",
                        "dedupe_hash": f"manual:{uuid.uuid4()}",
                        "counterparty": counterparty,
                        "description": note or counterparty or "Movimiento manual",
                    }
                )
                .execute()
                .data[0]
            )
            chosen_type = TYPE_OPTIONS[self.type_var.get()]
            if chosen_type:
                category = next((c["id"] for c in self.categories if c["name"] == self.category_var.get()), None)
                self.client.table("transactions").update(
                    {"type": chosen_type, "category_id": category, "needs_review": False}
                ).eq("id", row["id"]).execute()
        except Exception as e:
            self.error.configure(text=f"Error: {e}")
            return False

        self.close()
        self.on_saved()
        return True


def open_manual_dialog(parent, client, accent, accent_hover, on_busy, on_saved):
    ManualEntryDialog(parent, client, accent, accent_hover, on_busy, on_saved)
