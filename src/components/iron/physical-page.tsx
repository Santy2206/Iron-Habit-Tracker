"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { DietModule } from "@/components/iron/diet-module";
import {
  computeWeeklyAverages,
  mondayOf,
  parseDay,
  toISODay,
} from "@/lib/diet-engine";
import { createClient } from "@/lib/supabase/client";
import type { WeightEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

const CARD = "#262a33";
const MUTED_CARD = "#1d2027";
const TODAY = "#2f9e6e";
const AVG = "#276b4d";
const GREEN = "#3fb97f";
const ACCENT = "#7fbab0";
/** Short weekday names Mon–Sun in the given locale (Jan 1 2024 was a Monday). */
const dayNames = (locale: string) =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }),
  );

type Mode = "Month" | "Week" | "Chart" | "Diet";
type Series = "Average" | "Daily";

const RANGES: Record<string, number | null> = {
  "Last 7 Days": 7,
  "Last 2 Weeks": 14,
  "Last 4 Weeks": 28,
  "Last 2 Months": 60,
  "Last 3 Months": 90,
  "Last 6 Months": 182,
  "Last Year": 365,
  "All Time": null,
};

const fmtMonth = (d: Date, locale: string) =>
  d.toLocaleDateString(locale, { month: "long", year: "numeric" });
const fmtShort = (d: Date, locale: string) =>
  d.toLocaleDateString(locale, { month: "short", day: "2-digit" });

function Segmented<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: T[];
  labels?: Partial<Record<T, string>>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-[#3a3d44] p-0.5">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition-colors",
            value === o
              ? "font-medium text-white"
              : "text-[#e7e9ee] hover:bg-white/5",
          )}
          style={value === o ? { backgroundColor: ACCENT } : undefined}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function PhysicalPage({ userId }: { userId: string }) {
  const { t, locale } = useT();
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [mode, setMode] = useState<Mode>("Month");
  const [ref, setRef] = useState(() => new Date());
  const [series, setSeries] = useState<Series>("Average");
  const [range, setRange] = useState("All Time");
  const [todayWeight, setTodayWeight] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [today] = useState(() => new Date());
  const todayIso = toISODay(today);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("weight_entries")
      .select("entry_date,weight_lb,source")
      .order("entry_date");
    setEntries((data as WeightEntry[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
    void load();
    const ch = supabase
      .channel("physical-weight")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weight_entries" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, supabase]);

  const daily = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) m[e.entry_date] = e.weight_lb;
    return m;
  }, [entries]);
  const weekly = useMemo(() => computeWeeklyAverages(daily), [daily]);

  function shift(dir: number) {
    setRef((r) => {
      const d = new Date(r);
      if (mode === "Month") d.setMonth(d.getMonth() + dir, 1);
      else d.setDate(d.getDate() + dir * 7);
      return d;
    });
  }

  const title =
    mode === "Month"
      ? fmtMonth(ref, locale)
      : mode === "Week"
        ? `${t("Week of", "Semana del")} ${fmtShort(mondayOf(ref), locale)}`
        : mode === "Chart"
          ? series === "Average"
            ? t("Weekly Average Trend", "Tendencia del promedio semanal")
            : t("Daily Weight Trend", "Tendencia del peso diario")
          : t("Diet", "Dieta");

  async function saveToday() {
    const w = parseFloat(todayWeight);
    if (!w || w <= 0) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("weight_entries").upsert({
      user_id: userId,
      entry_date: todayIso,
      weight_lb: w,
      source: "manual",
    });
    if (error) setMsg(`${t("Couldn't save", "No se pudo guardar")}: ${error.message}`);
    else setTodayWeight("");
    setBusy(false);
  }

  const syncFit = useCallback(
    async (quiet = false) => {
      setBusy(true);
      if (!quiet) setMsg(null);
      const { data, error } = await supabase.functions.invoke("gfit-sync");
      const reason = data?.reason as string | undefined;
      if (error || data?.ok === false)
        setMsg(
          `${t("Couldn't sync", "No se pudo sincronizar")}${reason ? ` (${reason})` : ""} — ${t("check that the Fitness API is enabled in Google Cloud.", "revisa que la Fitness API esté habilitada en Google Cloud.")}`,
        );
      else if (!quiet || (data?.imported ?? 0) > 0)
        setMsg(`${data?.imported ?? 0} ${t("records synced from Google Fit.", "registros de Google Fit.")}`);
      setBusy(false);
    },
    [supabase, t],
  );

  // Auto-sync Google Fit on open so today's weigh-in shows up without a click.
  useEffect(() => {
    const id = setTimeout(() => void syncFit(true), 0);
    return () => clearTimeout(id);
  }, [syncFit]);

  const navBtn =
    "flex h-8 items-center justify-center rounded-md bg-white px-3 text-sm text-[#1a1d23] hover:bg-[#e5e7eb]";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4 md:px-8 md:py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {(mode === "Month" || mode === "Week") && (
          <div className="flex gap-2">
            <button className={cn(navBtn, "w-8 px-0")} onClick={() => shift(-1)}>
              ◄
            </button>
            <button className={navBtn} onClick={() => setRef(new Date())}>
              {t("Today", "Hoy")}
            </button>
            <button className={cn(navBtn, "w-8 px-0")} onClick={() => shift(1)}>
              ►
            </button>
          </div>
        )}
        <h1 className="text-xl font-bold text-[#e7e9ee]">{title}</h1>
        <div className="ml-auto">
          <Segmented<Mode>
            options={["Month", "Week", "Chart", "Diet"]}
            labels={{
              Month: t("Month", "Mes"),
              Week: t("Week", "Semana"),
              Chart: t("Chart", "Gráfica"),
              Diet: t("Diet", "Dieta"),
            } as Record<Mode, string>}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

      {(mode === "Month" || mode === "Week") && (
        <div className="mb-3 flex items-center gap-2">
          <input
            value={todayWeight}
            onChange={(e) => setTodayWeight(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveToday()}
            placeholder={t("Today (lb)", "Hoy (lb)")}
            inputMode="decimal"
            className="h-8 w-24 rounded-md bg-[#262a33] px-2 text-sm text-[#e7e9ee] outline-none placeholder:text-[#6b7280]"
          />
          <button
            onClick={() => void saveToday()}
            disabled={busy}
            className="h-8 rounded-md px-3 text-sm text-white disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {t("Log", "Guardar")}
          </button>
          <button
            onClick={() => void syncFit()}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-md bg-[#3a3d44] px-3 text-sm text-[#e7e9ee] disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            Google Fit
          </button>
          {msg && <span className="text-xs text-[#9aa0ab]">{msg}</span>}
        </div>
      )}

      {mode === "Month" && (
        <MonthView ref0={ref} daily={daily} weekly={weekly} todayIso={todayIso} />
      )}
      {mode === "Week" && (
        <WeekView ref0={ref} daily={daily} weekly={weekly} todayIso={todayIso} />
      )}
      {mode === "Chart" && (
        <ChartView
          daily={daily}
          weekly={weekly}
          series={series}
          onSeries={setSeries}
          range={range}
          onRange={setRange}
          todayIso={todayIso}
        />
      )}
      {mode === "Diet" && <DietModule userId={userId} />}
    </div>
  );
}

// ── Month: rounded tiles, green today + Avg column ────────────────────────────

function MonthView({
  ref0,
  daily,
  weekly,
  todayIso,
}: {
  ref0: Date;
  daily: Record<string, number>;
  weekly: Record<string, number>;
  todayIso: string;
}) {
  const { locale } = useT();
  const weeks = useMemo(() => {
    const first = new Date(ref0.getFullYear(), ref0.getMonth(), 1);
    const last = new Date(ref0.getFullYear(), ref0.getMonth() + 1, 0);
    const rows: Date[][] = [];
    for (
      let m = mondayOf(first);
      m <= mondayOf(last);
      m = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 7)
    ) {
      rows.push(
        Array.from(
          { length: 7 },
          (_, i) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + i),
        ),
      );
    }
    return rows;
  }, [ref0]);

  return (
    <div className="overflow-x-auto">
    <div className="grid min-w-[640px] grid-cols-[repeat(7,1fr)_1.15fr] gap-2">
      {[...dayNames(locale), "Avg"].map((d) => (
        <div
          key={d}
          className="py-2 text-center text-xs font-bold text-[#6b7280]"
        >
          {d}
        </div>
      ))}
      {weeks.map((row) => {
        const monday = toISODay(row[0]);
        const avg = weekly[monday];
        const completed = toISODay(row[6]) <= todayIso;
        const showAvg = avg !== undefined && completed;
        return (
          <Fragment key={monday}>
            {row.map((d) => {
              const iso = toISODay(d);
              const w = daily[iso];
              const other = d.getMonth() !== ref0.getMonth();
              const isToday = iso === todayIso;
              return (
                <div
                  key={iso}
                  className="flex h-[72px] flex-col justify-between rounded-[10px] p-2.5 md:h-[88px]"
                  style={{
                    backgroundColor: isToday ? TODAY : other ? MUTED_CARD : CARD,
                    color: isToday ? "#fff" : other ? "#6b7280" : "#e7e9ee",
                  }}
                >
                  <span className="text-xs font-bold">{d.getDate()}</span>
                  {w !== undefined && (
                    <span className="text-center text-sm tabular-nums">
                      {w.toFixed(1)}
                    </span>
                  )}
                </div>
              );
            })}
            <div
              className="flex h-[72px] items-center justify-center rounded-[10px] text-base font-bold md:h-[88px]"
              style={{
                backgroundColor: showAvg ? AVG : MUTED_CARD,
                color: showAvg ? "#fff" : "#6b7280",
              }}
            >
              {showAvg ? avg.toFixed(1) : "–"}
            </div>
          </Fragment>
        );
      })}
    </div>
    </div>
  );
}

// ── Week: summary card + 7 rows ───────────────────────────────────────────────

function WeekView({
  ref0,
  daily,
  weekly,
  todayIso,
}: {
  ref0: Date;
  daily: Record<string, number>;
  weekly: Record<string, number>;
  todayIso: string;
}) {
  const { t, locale } = useT();
  const monday = mondayOf(ref0);
  const avg = weekly[toISODay(monday)];
  return (
    <div className="flex flex-col gap-2">
      <div
        className="mb-2 rounded-xl px-4 py-3.5 text-center text-base font-bold"
        style={{
          backgroundColor: avg !== undefined ? AVG : MUTED_CARD,
          color: avg !== undefined ? "#fff" : "#6b7280",
        }}
      >
        {avg !== undefined
          ? `${t("Weekly average", "Promedio semanal")}: ${avg.toFixed(1)} lb`
          : `${t("Weekly average", "Promedio semanal")}: ${t("not available yet", "aún no disponible")}`}
      </div>
      {Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const iso = toISODay(d);
        const w = daily[iso];
        const isToday = iso === todayIso;
        return (
          <div
            key={iso}
            className="flex items-center justify-between rounded-[10px] px-4 py-3.5 text-sm"
            style={{
              backgroundColor: isToday ? TODAY : CARD,
              color: isToday ? "#fff" : "#e7e9ee",
            }}
          >
            <span className="font-bold">
              {dayNames(locale)[i]} {fmtShort(d, locale)}
              {isToday && `  • ${t("today", "hoy")}`}
            </span>
            <span>{w !== undefined ? `${w.toFixed(1)} lb` : t("no data", "sin datos")}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Chart: Average/Daily + range dropdown + change summary ────────────────────

function ChartView({
  daily,
  weekly,
  series,
  onSeries,
  range,
  onRange,
  todayIso,
}: {
  daily: Record<string, number>;
  weekly: Record<string, number>;
  series: Series;
  onSeries: (s: Series) => void;
  range: string;
  onRange: (r: string) => void;
  todayIso: string;
}) {
  const { t, locale } = useT();
  const rangeLabel = (r: string) =>
    ({
      "Last 7 Days": t("Last 7 Days", "Últimos 7 días"),
      "Last 2 Weeks": t("Last 2 Weeks", "Últimas 2 semanas"),
      "Last 4 Weeks": t("Last 4 Weeks", "Últimas 4 semanas"),
      "Last 2 Months": t("Last 2 Months", "Últimos 2 meses"),
      "Last 3 Months": t("Last 3 Months", "Últimos 3 meses"),
      "Last 6 Months": t("Last 6 Months", "Últimos 6 meses"),
      "Last Year": t("Last Year", "Último año"),
      "All Time": t("All Time", "Todo"),
    })[r] ?? r;
  const points = useMemo(() => {
    const all =
      series === "Average"
        ? Object.entries(weekly)
            .sort()
            .map(([monday, v]) => {
              const sun = parseDay(monday);
              sun.setDate(sun.getDate() + 6);
              return { iso: toISODay(sun), v };
            })
        : Object.entries(daily)
            .sort()
            .map(([iso, v]) => ({ iso, v }));
    const days = RANGES[range];
    if (days === null || days === undefined) return all;
    const cutoff = parseDay(todayIso);
    cutoff.setDate(cutoff.getDate() - days);
    const c = toISODay(cutoff);
    return all.filter((p) => p.iso >= c);
  }, [daily, weekly, series, range, todayIso]);

  const change =
    points.length >= 2 ? points[points.length - 1].v - points[0].v : null;
  const label = (iso: string) => fmtShort(parseDay(iso), locale);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Segmented<Series>
          options={["Average", "Daily"]}
          labels={{
            Average: t("Average", "Promedio"),
            Daily: t("Daily", "Diario"),
          } as Record<Series, string>}
          value={series}
          onChange={onSeries}
        />
        <select
          value={range}
          onChange={(e) => onRange(e.target.value)}
          className="h-8 rounded-lg px-3 text-sm text-white outline-none"
          style={{ backgroundColor: ACCENT }}
        >
          {Object.keys(RANGES).map((r) => (
            <option key={r} value={r} className="bg-[#3a3a3a] text-[#e7e9ee]">
              {rangeLabel(r)}
            </option>
          ))}
        </select>
      </div>
      {change !== null && (
        <p className="text-sm font-bold" style={{ color: GREEN }}>
          {t("Weight change", "Cambio de peso")} ({rangeLabel(range)}): {change > 0 ? "+" : ""}
          {change.toFixed(1)} lbs
        </p>
      )}
      <div
        className="h-[300px] rounded-md p-3 md:h-[420px]"
        style={{ backgroundColor: MUTED_CARD }}
      >
        {points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#c7cbd3]">
            {t("Not enough data yet", "Aún no hay suficientes datos")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
            >
              <CartesianGrid stroke="#3a3f4b" strokeOpacity={0.6} />
              <XAxis
                dataKey="iso"
                tickFormatter={label}
                tick={{ fill: "#c7cbd3", fontSize: 11 }}
                stroke="#3a3f4b"
              />
              <YAxis
                domain={["dataMin - 0.5", "dataMax + 0.5"]}
                tick={{ fill: "#c7cbd3", fontSize: 11 }}
                stroke="#3a3f4b"
                tickFormatter={(v) => Number(v).toFixed(1)}
                label={{
                  value: t("Weight (lb)", "Peso (lb)"),
                  angle: -90,
                  position: "insideLeft",
                  fill: "#c7cbd3",
                  fontSize: 11,
                }}
              />
              <Tooltip
                labelFormatter={(l) => label(String(l))}
                formatter={(v) => [
                  `${Number(v).toFixed(1)} lb`,
                  series === "Average" ? t("Weekly average", "Promedio semanal") : t("Daily", "Diario"),
                ]}
                contentStyle={{
                  background: CARD,
                  border: `1px solid ${GREEN}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="linear"
                dataKey="v"
                stroke={GREEN}
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: GREEN, stroke: GREEN }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
