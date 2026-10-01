import ctypes
import sys

import customtkinter as ctk

from features.physical import calendar_gui, storage

SIDEBAR_BG = ("#eef0f3", "#181b21")
NODE_HOVER = ("#dde1e8", "#242933")
LEAF_ACTIVE = ("#3a7ebf", "#3a7ebf")
TEXT_COLOR = ("#1a1d23", "#e7e9ee")
MUTED_TEXT = ("#9aa0ab", "#6b7280")

# Each top-level area gets its own accent, shown as the row's background while
# that area is expanded/selected.
AREA_COLORS = {
    "Physical": "#429a8e",
    "Productive": "#ae9cce",
    "Social": "#ca4d31",
    "Spiritual": "#a75aba",
    "Intellectual": "#828bc2",
}

def _shade(hex_color, factor):
    """Lightens hex_color toward white by `factor` (0 = unchanged, 1 = white), so
    nested items under an area read as the same color family at a softer tint."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = round(r + (255 - r) * factor)
    g = round(g + (255 - g) * factor)
    b = round(b + (255 - b) * factor)
    return f"#{r:02x}{g:02x}{b:02x}"


# A node is a category (has "children") or a leaf (has "page", a key into PAGES).
# Adding a future app is just adding another leaf here - the sidebar renders
# whatever this describes, no new widget code needed.
NAV_TREE = [
    {
        "label": "Physical",
        "_expanded": True,
        "children": [
            {
                "label": "Gym",
                "_expanded": True,
                "children": [
                    {"label": "Diet", "page": "diet"},
                ],
            },
        ],
    },
    {"label": "Productive", "children": []},
    {"label": "Social", "children": []},
    {"label": "Intellectual", "children": []},
    {"label": "Spiritual", "children": []},
]

PAGES = {
    "diet": lambda master, data: calendar_gui.DietPage(master, data),
}


class AppShell(ctk.CTk):
    def __init__(self, data, weekly_check=False):
        super().__init__()
        self.data = data
        self.current_page = None
        self.current_page_id = None

        self.title("IRON Habit Tracker")
        try:
            self.iconbitmap(str(storage.PROJECT_ROOT / "assets" / "icon.ico"))
        except Exception:
            pass
        self.geometry("1150x680")
        self.minsize(950, 600)

        self.sidebar = ctk.CTkScrollableFrame(
            self, width=230, fg_color=SIDEBAR_BG, corner_radius=0
        )
        self.sidebar.pack(side="left", fill="y")

        self.content = ctk.CTkFrame(self, fg_color="transparent")
        self.content.pack(side="left", fill="both", expand=True, padx=24, pady=24)

        self._build_sidebar()
        self.show_page("diet")

        if weekly_check:
            self.after(200, lambda: self.current_page.show_weekly_check_modal())

    def _build_sidebar(self):
        ctk.CTkLabel(
            self.sidebar, text="IRON Habit Tracker", text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=16, weight="bold"),
            wraplength=190, justify="left",
        ).pack(anchor="w", padx=16, pady=(16, 20))

        for node in NAV_TREE:
            self._build_nav_node(self.sidebar, node, depth=0)

    def _build_nav_node(self, parent, node, depth, area_color=None):
        indent = 16 + depth * 16

        if depth == 0:
            area_color = AREA_COLORS.get(node["label"])

        if "page" in node:
            is_active = node["page"] == self.current_page_id
            leaf_color = _shade(area_color, 0.3) if area_color else LEAF_ACTIVE
            btn = ctk.CTkButton(
                parent, text=node["label"], anchor="w",
                fg_color=leaf_color if is_active else "transparent",
                text_color="white" if is_active else TEXT_COLOR,
                hover_color=NODE_HOVER,
                font=ctk.CTkFont(family="Segoe UI", size=13),
                command=lambda: self.show_page(node["page"]),
            )
            btn.pack(fill="x", padx=(indent, 8), pady=1)
            return

        expanded = node.get("_expanded", False)
        node["_expanded"] = expanded
        children = node.get("children", [])
        arrow = "▾" if expanded else "▸"

        row_color = _shade(area_color, 0.18 * depth) if area_color else None
        highlighted = expanded and row_color is not None

        row = ctk.CTkButton(
            parent, text=f"{arrow}  {node['label']}", anchor="w",
            fg_color=row_color if highlighted else "transparent",
            text_color="white" if highlighted else TEXT_COLOR,
            hover_color=NODE_HOVER,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
            command=lambda: self._toggle_node(node),
        )
        row.pack(fill="x", padx=(indent, 8), pady=1)

        if expanded:
            if children:
                for child in children:
                    self._build_nav_node(parent, child, depth + 1, area_color=area_color)
            else:
                ctk.CTkLabel(
                    parent, text="Coming soon", text_color=MUTED_TEXT,
                    font=ctk.CTkFont(family="Segoe UI", size=11, slant="italic"),
                ).pack(anchor="w", padx=(indent + 16, 8), pady=(0, 4))

    def _toggle_node(self, node):
        node["_expanded"] = not node.get("_expanded", False)
        self._refresh_sidebar()

    def _refresh_sidebar(self):
        for widget in self.sidebar.winfo_children():
            widget.destroy()
        self._build_sidebar()

    def show_page(self, page_id):
        for widget in self.content.winfo_children():
            widget.destroy()

        self.current_page_id = page_id
        page_factory = PAGES.get(page_id)
        if page_factory:
            self.current_page = page_factory(self.content, self.data)
            self.current_page.pack(fill="both", expand=True)
        else:
            self.current_page = None
            ctk.CTkLabel(
                self.content, text="Coming soon", text_color=MUTED_TEXT,
                font=ctk.CTkFont(family="Segoe UI", size=16),
            ).pack(expand=True)

        self._refresh_sidebar()


def _set_windows_app_id():
    """Gives this process its own taskbar identity instead of being grouped under
    Python's generic icon, and lets 'pin to taskbar' resolve back to a real shortcut."""
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Iron.HabitTracker")
    except Exception:
        pass


def run(weekly_check=False):
    _set_windows_app_id()
    data = calendar_gui.sync_with_google_fit()
    app = AppShell(data, weekly_check=weekly_check)
    app.mainloop()


if __name__ == "__main__":
    run()
