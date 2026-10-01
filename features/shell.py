import ctypes
import sys
import tkinter as tk

import customtkinter as ctk
from PIL import Image

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


def _darken(hex_color, factor=0.12):
    """Darkens hex_color toward black by `factor` — used as hover on an already-colored row
    so the accent stays visible instead of flipping to the generic gray NODE_HOVER."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = max(0, round(r * (1 - factor)))
    g = max(0, round(g * (1 - factor)))
    b = max(0, round(b * (1 - factor)))
    return f"#{r:02x}{g:02x}{b:02x}"


def _resolve_leaf_color(tree, page_id, area_color=None, depth=0):
    """Walks the nav tree to find page_id's resolved accent color - the same
    shade its sidebar button shows when active - so a mounted page can match it."""
    for node in tree:
        node_area_color = AREA_COLORS.get(node["label"]) if depth == 0 else area_color
        if node.get("page") == page_id:
            return _shade(node_area_color, 0.3) if node_area_color else None
        children = node.get("children")
        if children:
            found = _resolve_leaf_color(children, page_id, node_area_color, depth + 1)
            if found:
                return found
    return None


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
    "diet": lambda master, data, accent: calendar_gui.DietPage(master, data, accent_color=accent),
}


class AppShell(ctk.CTk):
    SIDEBAR_WIDTH = 230

    def __init__(self, data, weekly_check=False):
        super().__init__()
        self.data = data
        self.current_page = None
        self.current_page_id = None
        self.sidebar_visible = True
        self._app_icon = None

        self.title("IRON Habit Tracker")
        icon_path = storage.PROJECT_ROOT / "assets" / "icon.ico"
        try:
            self.iconbitmap(str(icon_path))
        except Exception:
            pass
        try:
            self._app_icon = ctk.CTkImage(Image.open(icon_path), size=(28, 28))
        except Exception:
            self._app_icon = None
        self.geometry("1150x680")
        self.minsize(950, 600)

        self.sidebar = ctk.CTkFrame(
            self, width=self.SIDEBAR_WIDTH, fg_color=SIDEBAR_BG, corner_radius=0
        )
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        self.content = ctk.CTkFrame(self, fg_color="transparent")
        self.content.pack(side="left", fill="both", expand=True, padx=24, pady=24)

        self._build_sidebar()
        self.show_page("diet")

        self.bind_all("<Control-b>", self._on_toggle_sidebar)
        self.bind_all("<Control-B>", self._on_toggle_sidebar)
        # Ctrl+C copies selected entry text, or the focused label's full text.
        self.bind_all("<Control-c>", self._on_copy)
        self.bind_all("<Control-C>", self._on_copy)

        if weekly_check:
            self.after(200, lambda: self.current_page.show_weekly_check_modal())

    def _build_sidebar(self):
        header = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        header.pack(fill="x", padx=12, pady=(14, 16))

        if self._app_icon is not None:
            ctk.CTkLabel(header, text="", image=self._app_icon).pack(side="left", padx=(4, 8))

        ctk.CTkLabel(
            header, text="IRON Habit Tracker", text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=15, weight="bold"),
            wraplength=140, justify="left", anchor="w",
        ).pack(side="left", fill="x", expand=True)

        # Hamburger (3 bars) — collapse / expand the sidebar
        ctk.CTkButton(
            header, text="☰", width=32, height=28,
            fg_color="transparent", hover_color=NODE_HOVER,
            text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=18),
            command=self.toggle_sidebar,
        ).pack(side="right")

        self.nav = ctk.CTkScrollableFrame(
            self.sidebar, fg_color="transparent", corner_radius=0
        )
        self.nav.pack(side="top", fill="both", expand=True)

        for node in NAV_TREE:
            self._build_nav_node(self.nav, node, depth=0)

        self._build_sidebar_footer()

    def _on_toggle_sidebar(self, _event=None):
        self.toggle_sidebar()
        return "break"

    def toggle_sidebar(self):
        """Show / hide the sidebar (also bound to Ctrl+B)."""
        if self.sidebar_visible:
            self.sidebar.pack_forget()
            self.sidebar_visible = False
            self._ensure_expand_button()
        else:
            if getattr(self, "_expand_btn", None) is not None:
                self._expand_btn.destroy()
                self._expand_btn = None
            self.sidebar.pack(side="left", fill="y", before=self.content)
            self.sidebar_visible = True

    def _ensure_expand_button(self):
        """When the sidebar is hidden, keep a floating ☰ so the user can reopen it."""
        if getattr(self, "_expand_btn", None) is not None:
            return
        self._expand_btn = ctk.CTkButton(
            self, text="☰", width=36, height=32,
            fg_color=SIDEBAR_BG, hover_color=NODE_HOVER,
            text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=18),
            command=self.toggle_sidebar,
        )
        self._expand_btn.place(x=8, y=12)

    def _build_sidebar_footer(self):
        """Profile / Settings stay pinned at the bottom for future pages."""
        footer = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        footer.pack(side="bottom", fill="x", padx=8, pady=(8, 16))

        # Divider line above the utility section
        ctk.CTkFrame(footer, height=1, fg_color=("#c5c9d1", "#3a3f4a")).pack(
            fill="x", padx=8, pady=(0, 10)
        )

        for icon, label, page_id in (
            ("👤", "Profile", "profile"),
            ("⚙", "Settings", "settings"),
        ):
            is_active = page_id == self.current_page_id
            active_color = LEAF_ACTIVE[1] if isinstance(LEAF_ACTIVE, tuple) else LEAF_ACTIVE
            ctk.CTkButton(
                footer, text=f"  {icon}   {label}", anchor="w",
                fg_color=active_color if is_active else "transparent",
                text_color="white" if is_active else TEXT_COLOR,
                hover_color=_darken(active_color) if is_active else NODE_HOVER,
                font=ctk.CTkFont(family="Segoe UI", size=13),
                height=34,
                command=lambda p=page_id: self.show_page(p),
            ).pack(fill="x", padx=8, pady=2)

    def _build_nav_node(self, parent, node, depth, area_color=None):
        indent = 16 + depth * 16
        # Extra gap between top-level life areas so the tree reads cleaner.
        area_pady = (6, 6) if depth == 0 else 1

        if depth == 0:
            area_color = AREA_COLORS.get(node["label"])

        if "page" in node:
            is_active = node["page"] == self.current_page_id
            leaf_color = _shade(area_color, 0.3) if area_color else (
                LEAF_ACTIVE[1] if isinstance(LEAF_ACTIVE, tuple) else LEAF_ACTIVE
            )
            btn = ctk.CTkButton(
                parent, text=node["label"], anchor="w",
                fg_color=leaf_color if is_active else "transparent",
                text_color="white" if is_active else TEXT_COLOR,
                # Keep the accent on hover when selected — don't swap to gray.
                hover_color=_darken(leaf_color) if is_active else NODE_HOVER,
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
            # Expanded/selected rows keep their area color on hover (slightly darker).
            hover_color=_darken(row_color) if highlighted else NODE_HOVER,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
            command=lambda: self._toggle_node(node),
        )
        row.pack(fill="x", padx=(indent, 8), pady=area_pady)

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
            accent = _resolve_leaf_color(NAV_TREE, page_id) or LEAF_ACTIVE[1]
            self.current_page = page_factory(self.content, self.data, accent)
            self.current_page.pack(fill="both", expand=True)
        else:
            self.current_page = None
            ctk.CTkLabel(
                self.content, text="Coming soon", text_color=MUTED_TEXT,
                font=ctk.CTkFont(family="Segoe UI", size=16),
            ).pack(expand=True)

        self._refresh_sidebar()
        # Labels created by the page become copyable (select isn't native on CTkLabel).
        self.after_idle(lambda: self._enable_copyable_labels(self.content))

    def _copy_to_clipboard(self, text):
        text = (text or "").strip()
        if not text:
            return False
        self.clipboard_clear()
        self.clipboard_append(text)
        self.update_idletasks()
        return True

    def _widget_text(self, widget):
        """Best-effort text extraction from CTk/tk widgets under the pointer or focus."""
        if widget is None:
            return ""
        try:
            if isinstance(widget, (ctk.CTkEntry, tk.Entry)):
                try:
                    return widget.selection_get()
                except tk.TclError:
                    return widget.get()
            if isinstance(widget, (ctk.CTkTextbox, tk.Text)):
                try:
                    return widget.get("sel.first", "sel.last")
                except tk.TclError:
                    return widget.get("1.0", "end-1c")
            if isinstance(widget, ctk.CTkLabel):
                return str(widget.cget("text") or "")
            # CTk wraps a tk Label as .label / .master
            for attr in ("label", "_label", "text_label"):
                child = getattr(widget, attr, None)
                if child is not None:
                    try:
                        return str(child.cget("text") or "")
                    except tk.TclError:
                        pass
            try:
                return str(widget.cget("text") or "")
            except tk.TclError:
                return ""
        except Exception:
            return ""

    def _on_copy(self, event=None):
        """Ctrl+C: copy entry/textbox selection, else focused/hovered label text."""
        widget = self.focus_get() or (event.widget if event else None)
        text = self._widget_text(widget)
        if self._copy_to_clipboard(text):
            return "break"
        return None

    def _enable_copyable_labels(self, root):
        """Double-click or right-click any label to copy its text."""
        def walk(w):
            try:
                children = w.winfo_children()
            except tk.TclError:
                return
            for child in children:
                if isinstance(child, ctk.CTkLabel):
                    self._bind_label_copy(child)
                walk(child)

        walk(root)

    def _bind_label_copy(self, label):
        if getattr(label, "_copy_bound", False):
            return
        label._copy_bound = True

        def copy_label(_event=None, lbl=label):
            text = str(lbl.cget("text") or "")
            if self._copy_to_clipboard(text):
                # Brief flash so the user knows it copied
                try:
                    original = lbl.cget("text_color")
                    lbl.configure(text_color=LEAF_ACTIVE)
                    lbl.after(180, lambda: lbl.configure(text_color=original))
                except Exception:
                    pass
            return "break"

        def show_menu(event, lbl=label):
            menu = tk.Menu(self, tearoff=0)
            menu.add_command(label="Copy", command=lambda: copy_label())
            try:
                menu.tk_popup(event.x_root, event.y_root)
            finally:
                menu.grab_release()
            return "break"

        label.bind("<Double-Button-1>", copy_label)
        label.bind("<Button-3>", show_menu)
        # Also bind the inner tk label if CTk exposes it
        for attr in ("label", "_label"):
            inner = getattr(label, attr, None)
            if inner is not None:
                try:
                    inner.bind("<Double-Button-1>", copy_label)
                    inner.bind("<Button-3>", show_menu)
                except tk.TclError:
                    pass


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
