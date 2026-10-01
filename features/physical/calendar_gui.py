import calendar
from datetime import date, timedelta

import customtkinter as ctk
import matplotlib.dates as mdates
from googleapiclient.discovery import build
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from features.physical import diet, storage, weekly_average, weight_tracker

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
LOOKBACK_WEEKS = weekly_average.LOOKBACK_WEEKS

CARD_COLOR = ("#e5e9f0", "#262a33")
MUTED_CARD_COLOR = ("#f0f2f5", "#1d2027")
TODAY_COLOR = ("#3fb97f", "#2f9e6e")
AVG_COLOR = ("#2f9e6e", "#276b4d")
MUTED_TEXT = ("#9aa0ab", "#6b7280")
TEXT_COLOR = ("#1a1d23", "#e7e9ee")

CHART_BG = "#1d2027"
CHART_GRID = "#3a3f4b"
CHART_TEXT = "#c7cbd3"
CHART_DAILY_COLOR = "#3fb97f"
CHART_AVG_COLOR = "#3fb97f"

STATUS_COLORS = {
    "on_track": "#2f9e6e",
    "too_slow": "#d9a441",
    "too_fast": "#d9a441",
    "pending": "#4b5160",
    None: "#4b5160",
}
STATUS_LABELS = {
    "on_track": "On track",
    "too_slow": "Too slow",
    "too_fast": "Too fast",
    "pending": "Targets updated - awaiting new weigh-ins",
    None: "Not enough data yet",
}

CHART_RANGES = {
    "Last 7 Days": timedelta(days=7),
    "Last 2 Weeks": timedelta(weeks=2),
    "Last 4 Weeks": timedelta(weeks=4),
    "Last 2 Months": timedelta(days=60),
    "Last 3 Months": timedelta(days=90),
    "Last 6 Months": timedelta(days=182),
    "Last Year": timedelta(days=365),
    "All Time": None,
}

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("green")


def _darken(hex_color, factor):
    """Darkens hex_color toward black by `factor` (0 = unchanged, 1 = black) -
    used for a button's hover shade when it's using a custom accent color."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r, g, b = round(r * (1 - factor)), round(g * (1 - factor)), round(b * (1 - factor))
    return f"#{r:02x}{g:02x}{b:02x}"


def sync_with_google_fit():
    """Fetches recent readings from Google Fit, merges them into local storage,
    and fills in any missing weekly averages. Falls back to local data on failure.

    Auth is handled by weight_tracker.get_credentials(): a bad/revoked token is
    deleted and the browser OAuth flow opens automatically for a fresh one.
    If the API still rejects the access token mid-call, we clear the token once
    and retry the whole auth+fetch cycle before giving up.
    """
    data = storage.load()
    try:
        fetched = _fetch_google_fit_weights(retry_auth=True)
        storage.upsert_daily_weights(fetched, data)
    except Exception as e:
        print(f"Could not sync with Google Fit, showing local data instead: {e}")

    updated_averages = weekly_average.sync_weekly_averages(
        data["daily_weights"], data["weekly_averages"], lookback_weeks=LOOKBACK_WEEKS
    )
    data["weekly_averages"] = updated_averages
    storage.save(data)
    return data


def _fetch_google_fit_weights(retry_auth=True):
    """Auth + Fit fetch. On 401/invalid_grant-style failures, wipe the token and
    re-auth once so a silently-dead access token still recovers automatically."""
    creds = weight_tracker.get_credentials()
    fitness_service = build("fitness", "v1", credentials=creds)
    time_range = weight_tracker.get_time_range_for_weeks(LOOKBACK_WEEKS)
    try:
        return weight_tracker.get_weight_history(fitness_service, time_range)
    except Exception as e:
        msg = str(e).lower()
        auth_related = any(
            s in msg
            for s in (
                "invalid_grant",
                "invalid_client",
                "unauthorized",
                "401",
                "token has been expired",
                "token has been revoked",
                "access_denied",
            )
        )
        if retry_auth and auth_related:
            print(f"Google Fit rejected credentials ({e}); re-authenticating…")
            weight_tracker._delete_token()
            return _fetch_google_fit_weights(retry_auth=False)
        raise


class DietPage(ctk.CTkFrame):
    """The Month/Week/Chart/Diet weight+nutrition tracker, mounted as a page
    inside the app shell's content area (features/shell.py) rather than being
    its own top-level window."""

    def __init__(self, master, data, accent_color=CHART_AVG_COLOR):
        super().__init__(master, fg_color="transparent")
        self.data = data
        self.daily_weights = data["daily_weights"]
        self.weekly_averages = data["weekly_averages"]
        self.diet = data["diet"]
        self.diet_history = data["diet_history"]
        self.mode = "month"
        self.ref_date = date.today()
        self.chart_series = "average"
        self.chart_range = "All Time"
        self.diet_recommendation = None
        self.diet_fields_locked = True
        self.accent_color = accent_color
        self.accent_hover = _darken(accent_color, 0.18)

        self._build_nav()
        self.body = ctk.CTkFrame(self, fg_color="transparent")
        self.body.pack(fill="both", expand=True, padx=24, pady=(0, 24))

        self.render()

    def _build_nav(self):
        nav = ctk.CTkFrame(self, fg_color="transparent")
        nav.pack(fill="x", padx=24, pady=24)

        nav_buttons = ctk.CTkFrame(nav, fg_color="transparent")
        nav_buttons.pack(side="left")
        self.prev_button = ctk.CTkButton(
            nav_buttons, text="◀", width=36, command=self.go_previous,
            fg_color="white", hover_color="#e5e7eb",
            text_color="#1a1d23",
        )
        self.prev_button.pack(side="left", padx=(0, 6))
        ctk.CTkButton(
            nav_buttons, text="Today", width=70, command=self.go_today,
            fg_color="white", hover_color="#e5e7eb",
            text_color="#1a1d23",
        ).pack(side="left", padx=6)
        self.next_button = ctk.CTkButton(
            nav_buttons, text="▶", width=36, command=self.go_next,
            fg_color="white", hover_color="#e5e7eb",
            text_color="#1a1d23",
        )
        self.next_button.pack(side="left", padx=(6, 0))

        self.title_label = ctk.CTkLabel(
            nav, text="", font=ctk.CTkFont(family="Segoe UI", size=20, weight="bold")
        )
        self.title_label.pack(side="left", padx=24)

        self.view_switch = ctk.CTkSegmentedButton(
            nav, values=["Month", "Week", "Chart", "Diet"], command=self.on_mode_change,
            selected_color=self.accent_color, selected_hover_color=self.accent_hover,
        )
        self.view_switch.set("Month")
        self.view_switch.pack(side="right")

    def on_mode_change(self, value):
        self.mode = value.lower()
        self.render()

    def go_today(self):
        self.ref_date = date.today()
        self.render()

    def go_previous(self):
        self.ref_date = self._shift(-1)
        self.render()

    def go_next(self):
        self.ref_date = self._shift(1)
        self.render()

    def _shift(self, direction):
        if self.mode == "week":
            return self.ref_date + timedelta(weeks=direction)
        month_index = self.ref_date.month - 1 + direction
        year = self.ref_date.year + month_index // 12
        month = month_index % 12 + 1
        day = min(self.ref_date.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    def render(self):
        for widget in self.body.winfo_children():
            widget.destroy()

        nav_state = "disabled" if self.mode in ("chart", "diet") else "normal"
        self.prev_button.configure(state=nav_state)
        self.next_button.configure(state=nav_state)

        if self.mode == "month":
            self.title_label.configure(text=self.ref_date.strftime("%B %Y"))
            self.render_month()
        elif self.mode == "week":
            monday = weekly_average.monday_of(self.ref_date)
            sunday = monday + timedelta(days=6)
            self.title_label.configure(
                text=f"{monday.strftime('%b %d')} – {sunday.strftime('%b %d, %Y')}"
            )
            self.render_week()
        elif self.mode == "chart":
            series_title = "Weekly Average Trend" if self.chart_series == "average" else "Daily Weight Trend"
            self.title_label.configure(text=series_title)
            self.render_chart()
        else:
            self.title_label.configure(text="Diet & Macros")
            self.render_diet()

    def render_month(self):
        grid = ctk.CTkFrame(self.body, fg_color="transparent")
        grid.pack(fill="both", expand=True)
        for col in range(8):
            grid.grid_columnconfigure(col, weight=1, uniform="col")

        for col, name in enumerate(DAY_NAMES + ["Avg"]):
            ctk.CTkLabel(
                grid,
                text=name,
                text_color=MUTED_TEXT,
                font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            ).grid(row=0, column=col, sticky="ew", pady=(0, 8))

        cal = calendar.Calendar(firstweekday=0)
        weeks = cal.monthdatescalendar(self.ref_date.year, self.ref_date.month)
        for row_index, week in enumerate(weeks, start=1):
            grid.grid_rowconfigure(row_index, weight=1)
            for col, day in enumerate(week):
                self._day_card(grid, day).grid(
                    row=row_index, column=col, sticky="nsew", padx=4, pady=4
                )
            monday = week[0]
            avg = self.weekly_averages.get(monday.isoformat())
            self._avg_card(grid, avg).grid(
                row=row_index, column=7, sticky="nsew", padx=4, pady=4
            )

    def _day_card(self, parent, day):
        is_other_month = day.month != self.ref_date.month
        is_today = day == date.today()
        weight = self.daily_weights.get(day.isoformat())

        fg_color = TODAY_COLOR if is_today else (MUTED_CARD_COLOR if is_other_month else CARD_COLOR)
        text_color = "white" if is_today else (MUTED_TEXT if is_other_month else TEXT_COLOR)

        card = ctk.CTkFrame(parent, corner_radius=10, fg_color=fg_color, height=70)
        card.grid_propagate(False)
        ctk.CTkLabel(
            card,
            text=str(day.day),
            text_color=text_color,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
        ).pack(anchor="nw", padx=8, pady=(6, 0))
        if weight is not None:
            ctk.CTkLabel(
                card,
                text=f"{weight:.1f}",
                text_color=text_color,
                font=ctk.CTkFont(family="Segoe UI", size=14),
            ).pack(anchor="s", expand=True, padx=8, pady=(0, 6))
        return card

    def _avg_card(self, parent, avg):
        card = ctk.CTkFrame(parent, corner_radius=10, fg_color=AVG_COLOR if avg is not None else MUTED_CARD_COLOR, height=70)
        card.grid_propagate(False)
        text = f"{avg:.1f}" if avg is not None else "–"
        text_color = "white" if avg is not None else MUTED_TEXT
        ctk.CTkLabel(
            card,
            text=text,
            text_color=text_color,
            font=ctk.CTkFont(family="Segoe UI", size=15, weight="bold"),
        ).pack(expand=True)
        return card

    def render_week(self):
        monday = weekly_average.monday_of(self.ref_date)
        avg = self.weekly_averages.get(monday.isoformat())
        avg_text = f"Weekly average: {avg:.1f} lb" if avg is not None else "Weekly average: not available yet"

        summary = ctk.CTkFrame(self.body, corner_radius=12, fg_color=AVG_COLOR if avg is not None else MUTED_CARD_COLOR)
        summary.pack(fill="x", pady=(0, 16))
        ctk.CTkLabel(
            summary,
            text=avg_text,
            text_color="white" if avg is not None else MUTED_TEXT,
            font=ctk.CTkFont(family="Segoe UI", size=16, weight="bold"),
        ).pack(padx=16, pady=14)

        for i in range(7):
            day = monday + timedelta(days=i)
            weight = self.daily_weights.get(day.isoformat())
            weight_text = f"{weight:.1f} lb" if weight is not None else "no data"
            is_today = day == date.today()

            row = ctk.CTkFrame(
                self.body, corner_radius=10, fg_color=TODAY_COLOR if is_today else CARD_COLOR
            )
            row.pack(fill="x", pady=4)
            text_color = "white" if is_today else TEXT_COLOR
            label = f"{DAY_NAMES[i]}  {day.strftime('%b %d')}" + ("  • today" if is_today else "")
            ctk.CTkLabel(
                row, text=label, text_color=text_color,
                font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
            ).pack(side="left", padx=16, pady=14)
            ctk.CTkLabel(
                row, text=weight_text, text_color=text_color,
                font=ctk.CTkFont(family="Segoe UI", size=14),
            ).pack(side="right", padx=16, pady=14)

    def on_chart_series_change(self, value):
        self.chart_series = value.lower()
        self.render()

    def on_chart_range_change(self, value):
        self.chart_range = value
        self.render()

    def render_chart(self):
        if self.chart_series == "average":
            # Plot each weekly average on its Sunday (the week's last day), not the
            # Monday it's stored under, since that's the date people think of as
            # "when that week's number landed".
            all_items = [
                (date.fromisoformat(monday) + timedelta(days=6), value)
                for monday, value in sorted(self.weekly_averages.items())
            ]
            color = CHART_AVG_COLOR
            series_label = "Weekly average"
        else:
            all_items = [
                (date.fromisoformat(d), value) for d, value in sorted(self.daily_weights.items())
            ]
            color = CHART_DAILY_COLOR
            series_label = "Daily weight"

        range_delta = CHART_RANGES[self.chart_range]
        if range_delta is None:
            items = all_items
        else:
            cutoff = date.today() - range_delta
            items = [(d, v) for d, v in all_items if d >= cutoff]

        toggle_row = ctk.CTkFrame(self.body, fg_color="transparent")
        toggle_row.pack(fill="x", pady=(0, 12))
        chart_switch = ctk.CTkSegmentedButton(
            toggle_row, values=["Average", "Daily"], command=self.on_chart_series_change,
            selected_color=self.accent_color, selected_hover_color=self.accent_hover,
        )
        chart_switch.set(self.chart_series.capitalize())
        chart_switch.pack(side="left")

        range_menu = ctk.CTkOptionMenu(
            toggle_row, values=list(CHART_RANGES.keys()), width=150,
            command=self.on_chart_range_change,
            fg_color=self.accent_color, button_color=self.accent_color,
            button_hover_color=self.accent_hover,
        )
        range_menu.set(self.chart_range)
        range_menu.pack(side="right")

        if len(items) >= 2:
            change = items[-1][1] - items[0][1]
            sign = "+" if change > 0 else ""
            change_text = f"Weight change ({self.chart_range}): {sign}{change:.1f} lbs"
        else:
            change_text = f"Weight change ({self.chart_range}): not enough data"
        ctk.CTkLabel(
            self.body, text=change_text, text_color=color,
            font=ctk.CTkFont(family="Segoe UI", size=15, weight="bold"),
        ).pack(anchor="w", pady=(0, 16))

        chart_area = ctk.CTkFrame(self.body, fg_color="transparent")
        chart_area.pack(fill="both", expand=True)

        fig = Figure(figsize=(7, 4.5), dpi=100)
        fig.patch.set_facecolor(CHART_BG)
        ax = fig.add_subplot(111)
        ax.set_facecolor(CHART_BG)

        hover_points = []
        if not items:
            message = "No data in this range" if all_items else "No data yet"
            ax.text(
                0.5, 0.5, message, ha="center", va="center",
                color=CHART_TEXT, transform=ax.transAxes, fontsize=13,
            )
        else:
            dates = [d for d, _ in items]
            values = [v for _, v in items]
            ax.plot(
                dates, values, color=color, marker="o", markersize=5,
                linewidth=2.5, label=series_label, zorder=3,
            )
            hover_points = [
                (mdates.date2num(d), v, series_label, d) for d, v in zip(dates, values)
            ]
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
            fig.autofmt_xdate()
            legend = ax.legend(facecolor=CHART_BG, labelcolor=CHART_TEXT, edgecolor=CHART_GRID)
            legend.get_frame().set_alpha(0.9)

        ax.set_ylabel("Weight (lb)", color=CHART_TEXT)
        ax.tick_params(colors=CHART_TEXT)
        ax.grid(True, color=CHART_GRID, linewidth=0.5, alpha=0.6)
        for spine in ax.spines.values():
            spine.set_color(CHART_GRID)
        fig.tight_layout()

        canvas = FigureCanvasTkAgg(fig, master=chart_area)
        canvas.draw()
        canvas.get_tk_widget().pack(fill="both", expand=True)

        if hover_points:
            self._wire_chart_hover(ax, canvas, hover_points, color)

    @staticmethod
    def _flip_annotation_toward_center(ax, annot, px, py):
        """Keeps a hover tooltip from getting clipped off the edge of the chart by
        flipping which side of the point it's drawn on, based on where the point
        sits within the axes."""
        bbox = ax.get_window_extent()
        dx = 15 if px < bbox.x0 + bbox.width * 0.7 else -15
        dy = 15 if py < bbox.y0 + bbox.height * 0.7 else -15
        annot.set_position((dx, dy))
        annot.set_ha("left" if dx > 0 else "right")
        annot.set_va("bottom" if dy > 0 else "top")

    def _wire_chart_hover(self, ax, canvas, hover_points, accent_color, unit="lbs"):
        annot = ax.annotate(
            "", xy=(0, 0), xytext=(15, 15), textcoords="offset points",
            bbox=dict(boxstyle="round,pad=0.5", fc="#262a33", ec=accent_color, lw=1.2),
            color="white", fontsize=9.5, ha="left", visible=False, zorder=10,
        )

        def on_hover(event):
            if event.inaxes != ax:
                if annot.get_visible():
                    annot.set_visible(False)
                    canvas.draw_idle()
                return

            best_point = None
            best_dist = 400  # ~20px radius, in squared pixel distance
            for x, y, label, d in hover_points:
                px, py = ax.transData.transform((x, y))
                dist = (px - event.x) ** 2 + (py - event.y) ** 2
                if dist < best_dist:
                    best_dist = dist
                    best_point = (x, y, label, d)

            if best_point is None:
                if annot.get_visible():
                    annot.set_visible(False)
                    canvas.draw_idle()
                return

            x, y, label, d = best_point
            px, py = ax.transData.transform((x, y))
            annot.xy = (x, y)
            annot.set_text(f"{d.strftime('%b %d, %Y')}\n{y:.1f} {unit} • {label}")
            self._flip_annotation_toward_center(ax, annot, px, py)
            annot.set_visible(True)
            canvas.draw_idle()

        canvas.mpl_connect("motion_notify_event", on_hover)

    def _persist_diet(self, updates):
        self.diet.update(updates)
        entry = dict(self.diet)
        entry["date"] = date.today().isoformat()
        self.diet_history.append(entry)
        storage.save(self.data)

    def _change_diet_phase(self, value):
        self._persist_diet({"phase": value.lower()})
        self.render()

    def _unlock_diet_fields(self):
        self.diet_fields_locked = False
        self.render()

    def _on_protein_g_changed(self, event=None):
        bodyweight = getattr(self, "_diet_bodyweight", None)
        if not bodyweight:
            return
        try:
            protein_g = float(self.diet_protein_entry.get())
        except ValueError:
            return
        self.diet_protein_per_lb_entry.delete(0, "end")
        self.diet_protein_per_lb_entry.insert(0, f"{protein_g / bodyweight:.2f}")

    def _on_protein_per_lb_changed(self, event=None):
        bodyweight = getattr(self, "_diet_bodyweight", None)
        if not bodyweight:
            return
        try:
            per_lb = float(self.diet_protein_per_lb_entry.get())
        except ValueError:
            return
        self.diet_protein_entry.delete(0, "end")
        self.diet_protein_entry.insert(0, f"{bodyweight * per_lb:.0f}")

    def _save_diet_fields(self):
        try:
            updates = {
                "calorie_intake": float(self.diet_calorie_entry.get()),
                "protein_g": float(self.diet_protein_entry.get()),
                "carbs_g": float(self.diet_carbs_entry.get()),
                "fat_g": float(self.diet_fat_entry.get()),
                "protein_per_lb": float(self.diet_protein_per_lb_entry.get()),
            }
        except ValueError:
            self.diet_error_label.configure(text="Enter valid numbers for all fields")
            return
        self._persist_diet(updates)
        self.diet_fields_locked = True
        self.render()

    def _apply_diet_suggestion(self):
        if self.diet_recommendation is None:
            return
        self._persist_diet({
            "calorie_intake": round(self.diet_recommendation["calorie_intake"]),
            "protein_g": round(self.diet_recommendation["protein_g"]),
            "carbs_g": round(self.diet_recommendation["carbs_g"]),
            "fat_g": round(self.diet_recommendation["fat_g"]),
        })
        self.render()

    def render_diet(self):
        bodyweight = diet.latest_bodyweight(self.daily_weights, self.weekly_averages)
        self._diet_bodyweight = bodyweight
        actual_rate = diet.four_week_rate(self.weekly_averages)
        phase = self.diet.get("phase", "cut")
        status = diet.check_status(phase, bodyweight, actual_rate) if bodyweight is not None else None
        pending = status in ("too_slow", "too_fast") and diet.is_pending_reevaluation(
            self.weekly_averages, self.diet_history
        )
        display_status = "pending" if pending else status

        protein_per_lb = self.diet.get("protein_per_lb", 1.15)
        self.diet_recommendation = None
        if status in ("too_slow", "too_fast") and not pending:
            trend_intake = diet.intake_during_trend(
                self.diet_history, self.weekly_averages, self.diet["calorie_intake"]
            )
            self.diet_recommendation = diet.recommend(
                phase, bodyweight, actual_rate, trend_intake,
                protein_per_lb=protein_per_lb,
            )

        phase_row = ctk.CTkFrame(self.body, fg_color="transparent")
        phase_row.pack(fill="x", pady=(0, 16))
        ctk.CTkLabel(
            phase_row, text="Phase:", font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold")
        ).pack(side="left", padx=(0, 10))
        phase_switch = ctk.CTkSegmentedButton(
            phase_row, values=["Cut", "Bulk"], command=self._change_diet_phase,
            selected_color=self.accent_color, selected_hover_color=self.accent_hover,
        )
        phase_switch.set(phase.capitalize())
        phase_switch.pack(side="left")

        status_card = ctk.CTkFrame(self.body, corner_radius=12, fg_color=STATUS_COLORS[display_status])
        status_card.pack(fill="x", pady=(0, 16))
        if bodyweight is None or actual_rate is None:
            status_text = "Not enough weight history yet to judge your trend (need at least 2 weekly averages)."
            caption = None
        elif pending:
            status_text = "Targets updated — waiting for next week's weigh-ins before checking again."
            caption = None
        else:
            low, high = diet.target_rate_lbs(phase, bodyweight)
            target_text = f"{low:.2f} lb/week" if phase == "cut" else f"{low:.2f} to {high:.2f} lb/week"
            status_text = (
                f"4-week rate: {actual_rate:+.2f} lb/week  (target: {target_text})   —   "
                f"{STATUS_LABELS[status]}"
            )
            caption = (
                "Reflects your actual logged weigh-ins, not your saved targets — it updates "
                "as new weeks of data come in, not immediately after you change or apply targets."
            )
        ctk.CTkLabel(
            status_card, text=status_text, text_color="white",
            font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
        ).pack(padx=16, pady=(14, 0) if caption else 14, anchor="w")
        if caption:
            ctk.CTkLabel(
                status_card, text=caption, text_color="white",
                font=ctk.CTkFont(family="Segoe UI", size=11),
            ).pack(padx=16, pady=(2, 14), anchor="w")

        if self.diet_recommendation:
            rec = self.diet_recommendation
            rec_card = ctk.CTkFrame(self.body, corner_radius=12, fg_color=MUTED_CARD_COLOR)
            rec_card.pack(fill="x", pady=(0, 16))
            rec_text = (
                f"Estimated maintenance: {rec['maintenance_estimate']:.0f} kcal\n"
                f"Suggested: {rec['calorie_intake']:.0f} kcal  •  "
                f"{rec['protein_g']:.0f}g protein  •  {rec['carbs_g']:.0f}g carbs  •  "
                f"{rec['fat_g']:.0f}g fat"
            )
            ctk.CTkLabel(
                rec_card, text=rec_text, text_color=TEXT_COLOR, justify="left",
                font=ctk.CTkFont(family="Segoe UI", size=13),
            ).pack(side="left", padx=16, pady=14)
            ctk.CTkButton(
                rec_card, text="Apply suggestion", command=self._apply_diet_suggestion,
                fg_color=self.accent_color, hover_color=self.accent_hover,
            ).pack(side="right", padx=16, pady=14)

        fields_row = ctk.CTkFrame(self.body, fg_color="transparent")
        fields_row.pack(fill="x", pady=(0, 4))

        # "readonly" (not "disabled") so values stay selectable/copyable while locked.
        field_state = "normal" if not self.diet_fields_locked else "readonly"

        def labeled_entry(parent, label, value):
            col = ctk.CTkFrame(parent, fg_color="transparent")
            col.pack(side="left", padx=(0, 16))
            ctk.CTkLabel(
                col, text=label, text_color=MUTED_TEXT, font=ctk.CTkFont(family="Segoe UI", size=11)
            ).pack(anchor="w")
            entry = ctk.CTkEntry(col, width=100)
            entry.insert(0, f"{value:g}")
            entry.configure(state=field_state)
            entry.pack(anchor="w")
            return entry

        self.diet_calorie_entry = labeled_entry(fields_row, "Calories (kcal)", self.diet["calorie_intake"])
        self.diet_protein_entry = labeled_entry(fields_row, "Protein (g)", self.diet["protein_g"])
        self.diet_carbs_entry = labeled_entry(fields_row, "Carbs (g)", self.diet["carbs_g"])
        self.diet_fat_entry = labeled_entry(fields_row, "Fat (g)", self.diet["fat_g"])
        self.diet_protein_per_lb_entry = labeled_entry(
            fields_row, "Protein target (g/lb)", protein_per_lb
        )

        if not self.diet_fields_locked:
            self.diet_protein_entry.bind("<KeyRelease>", self._on_protein_g_changed)
            self.diet_protein_per_lb_entry.bind("<KeyRelease>", self._on_protein_per_lb_changed)

        if self.diet_fields_locked:
            ctk.CTkButton(
                fields_row, text="Edit", command=self._unlock_diet_fields,
                fg_color=self.accent_color, hover_color=self.accent_hover,
            ).pack(side="left", padx=(0, 16), pady=(16, 0))
        else:
            ctk.CTkButton(
                fields_row, text="Save", command=self._save_diet_fields,
                fg_color=self.accent_color, hover_color=self.accent_hover,
            ).pack(side="left", padx=(0, 16), pady=(16, 0))

        self.diet_error_label = ctk.CTkLabel(self.body, text="", text_color="#e05a5a")
        self.diet_error_label.pack(anchor="w", pady=(0, 12))

        chart_area = ctk.CTkFrame(self.body, fg_color="transparent")
        chart_area.pack(fill="both", expand=True)
        self._render_diet_chart(chart_area)

    def _render_diet_chart(self, parent):
        history = sorted(self.diet_history, key=lambda e: e["date"])

        charts_row = ctk.CTkFrame(parent, fg_color="transparent")
        charts_row.pack(fill="both", expand=True)
        cal_frame = ctk.CTkFrame(charts_row, fg_color="transparent")
        cal_frame.pack(side="left", fill="both", expand=True, padx=(0, 8))
        pie_frame = ctk.CTkFrame(charts_row, fg_color="transparent")
        pie_frame.pack(side="left", fill="both", expand=True, padx=(8, 0))

        self._render_calorie_history_chart(cal_frame, history)
        self._render_macro_pie_chart(pie_frame)

    def _render_calorie_history_chart(self, parent, history):
        fig = Figure(figsize=(4.4, 3.4), dpi=100)
        fig.patch.set_facecolor(CHART_BG)
        ax = fig.add_subplot(111)
        ax.set_facecolor(CHART_BG)
        ax.set_title("Calories over time (kcal)", color=CHART_TEXT, fontsize=11)
        ax.tick_params(colors=CHART_TEXT, labelsize=8)
        ax.grid(True, color=CHART_GRID, linewidth=0.5, alpha=0.6)
        for spine in ax.spines.values():
            spine.set_color(CHART_GRID)

        hover_points = []
        if not history:
            ax.text(
                0.5, 0.5, "No history yet", ha="center", va="center",
                color=CHART_TEXT, transform=ax.transAxes, fontsize=10,
            )
        else:
            dates = [date.fromisoformat(e["date"]) for e in history]
            values = [e["calorie_intake"] for e in history]
            ax.plot(dates, values, color=CHART_AVG_COLOR, marker="o", markersize=4, linewidth=2)
            hover_points = [
                (mdates.date2num(d), v, "Calories", d) for d, v in zip(dates, values)
            ]
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
            fig.autofmt_xdate()

        fig.tight_layout()
        canvas = FigureCanvasTkAgg(fig, master=parent)
        canvas.draw()
        canvas.get_tk_widget().pack(fill="both", expand=True)

        if hover_points:
            self._wire_chart_hover(ax, canvas, hover_points, CHART_AVG_COLOR, unit="kcal")

    def _render_macro_pie_chart(self, parent):
        protein_g = self.diet.get("protein_g", 0) or 0
        carbs_g = self.diet.get("carbs_g", 0) or 0
        fat_g = self.diet.get("fat_g", 0) or 0
        labels = ["Protein", "Carbs", "Fat"]
        grams = [protein_g, carbs_g, fat_g]
        macro_kcal = [protein_g * 4, carbs_g * 4, fat_g * 9]
        colors = [CHART_DAILY_COLOR, "#d9a441", "#c45cc9"]

        fig = Figure(figsize=(4.4, 3.4), dpi=100)
        fig.patch.set_facecolor(CHART_BG)
        ax = fig.add_subplot(111)
        ax.set_title("Current Macro Split", color=CHART_TEXT, fontsize=11)

        wedges = []
        if sum(macro_kcal) <= 0:
            ax.set_facecolor(CHART_BG)
            ax.text(
                0.5, 0.5, "No macros set", ha="center", va="center",
                color=CHART_TEXT, transform=ax.transAxes, fontsize=10,
            )
        else:
            wedge_labels = [f"{l}\n{g:.0f}g" for l, g in zip(labels, grams)]
            wedges, _, autotexts = ax.pie(
                macro_kcal, labels=wedge_labels, colors=colors, autopct="%1.0f%%", startangle=90,
                textprops={"color": CHART_TEXT, "fontsize": 9},
                wedgeprops={"edgecolor": CHART_BG, "linewidth": 2},
            )
            for autotext in autotexts:
                autotext.set_color("white")
                autotext.set_fontweight("bold")

        fig.tight_layout()
        canvas = FigureCanvasTkAgg(fig, master=parent)
        canvas.draw()
        canvas.get_tk_widget().pack(fill="both", expand=True)

        if wedges:
            self._wire_pie_hover(ax, canvas, wedges, labels, grams, macro_kcal)

        bodyweight = diet.latest_bodyweight(self.daily_weights, self.weekly_averages)
        actual_rate = diet.four_week_rate(self.weekly_averages)
        current_intake = self.diet.get("calorie_intake", 0) or 0
        if bodyweight is not None and actual_rate is not None:
            trend_intake = diet.intake_during_trend(
                self.diet_history, self.weekly_averages, current_intake
            )
            maintenance = diet.estimate_maintenance(actual_rate, trend_intake)
            maintenance_text = f"Estimated maintenance: {maintenance:.0f} kcal"
        else:
            maintenance_text = "Estimated maintenance: not enough data yet"

        stats = ctk.CTkFrame(parent, fg_color="transparent")
        stats.pack(fill="x", pady=(4, 0))
        ctk.CTkLabel(
            stats, text=maintenance_text, text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=13),
        ).pack(anchor="center")
        ctk.CTkLabel(
            stats, text=f"Current intake: {current_intake:.0f} kcal", text_color=TEXT_COLOR,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
        ).pack(anchor="center")

    def _wire_pie_hover(self, ax, canvas, wedges, labels, grams, macro_kcal):
        total_kcal = sum(macro_kcal)
        annot = ax.annotate(
            "", xy=(0, 0), xytext=(15, 15), textcoords="offset points",
            bbox=dict(boxstyle="round,pad=0.5", fc="#262a33", ec=CHART_DAILY_COLOR, lw=1.2),
            color="white", fontsize=9.5, ha="left", visible=False, zorder=10,
        )

        def on_hover(event):
            if event.inaxes != ax:
                if annot.get_visible():
                    annot.set_visible(False)
                    canvas.draw_idle()
                return

            for wedge, label, g, kcal in zip(wedges, labels, grams, macro_kcal):
                contained, _ = wedge.contains(event)
                if contained:
                    pct = kcal / total_kcal * 100 if total_kcal else 0
                    annot.xy = (event.xdata, event.ydata)
                    annot.set_text(f"{label}\n{g:.0f}g • {kcal:.0f} kcal • {pct:.0f}%")
                    self._flip_annotation_toward_center(ax, annot, event.x, event.y)
                    annot.set_visible(True)
                    canvas.draw_idle()
                    return

            if annot.get_visible():
                annot.set_visible(False)
                canvas.draw_idle()

        canvas.mpl_connect("motion_notify_event", on_hover)

    def show_weekly_check_modal(self):
        bodyweight = diet.latest_bodyweight(self.daily_weights, self.weekly_averages)
        actual_rate = diet.four_week_rate(self.weekly_averages)
        phase = self.diet.get("phase", "cut")
        status = diet.check_status(phase, bodyweight, actual_rate) if bodyweight is not None else None
        pending = status in ("too_slow", "too_fast") and diet.is_pending_reevaluation(
            self.weekly_averages, self.diet_history
        )

        modal = ctk.CTkToplevel(self)
        modal.title("Weekly Check-in")
        modal.geometry("440x280")
        modal.transient(self)
        modal.grab_set()
        try:
            modal.iconbitmap(str(storage.PROJECT_ROOT / "assets" / "icon.ico"))
        except Exception:
            pass

        ctk.CTkLabel(
            modal, text="Weekly Check-in", font=ctk.CTkFont(family="Segoe UI", size=18, weight="bold")
        ).pack(pady=(20, 10))

        if status is None:
            body_text = "Not enough weight history yet to judge your trend."
        elif status == "on_track":
            body_text = f"You're on track for your {phase} ({actual_rate:+.2f} lb/week). Keep it up!"
        elif pending:
            body_text = "You recently updated your targets — waiting for next week's weigh-ins before checking again."
        else:
            trend_intake = diet.intake_during_trend(
                self.diet_history, self.weekly_averages, self.diet["calorie_intake"]
            )
            rec = diet.recommend(
                phase, bodyweight, actual_rate, trend_intake,
                protein_per_lb=self.diet.get("protein_per_lb", 1.15),
            )
            verb = "slower" if status == "too_slow" else "faster"
            body_text = (
                f"Your {phase} is {verb} than target ({actual_rate:+.2f} lb/week).\n\n"
                f"Suggested: {rec['calorie_intake']:.0f} kcal  •  {rec['protein_g']:.0f}g protein  •  "
                f"{rec['carbs_g']:.0f}g carbs  •  {rec['fat_g']:.0f}g fat\n\n"
                "Open the Diet tab to apply it."
            )

        ctk.CTkLabel(modal, text=body_text, wraplength=380, justify="left").pack(padx=24, pady=10)
        ctk.CTkButton(
            modal, text="Got it", command=modal.destroy,
            fg_color=self.accent_color, hover_color=self.accent_hover,
        ).pack(pady=20)
