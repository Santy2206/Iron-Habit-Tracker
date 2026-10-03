"""Colores y helpers de formato compartidos por las vistas del Finance Tracker (escritorio)."""

CARD_COLOR = ("#e5e9f0", "#262a33")
TEXT_COLOR = ("#1a1d23", "#e7e9ee")
MUTED_TEXT = ("#9aa0ab", "#6b7280")
GOOD_COLOR = "#2f9e6e"
WARN_COLOR = "#d9a441"
BAD_COLOR = "#d9534f"


def darken(hex_color, factor=0.18):
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r, g, b = round(r * (1 - factor)), round(g * (1 - factor)), round(b * (1 - factor))
    return f"#{r:02x}{g:02x}{b:02x}"


def fmt_cop(value) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "$0"
    return ("-$" if number < 0 else "$") + f"{abs(number):,.0f}".replace(",", ".")
