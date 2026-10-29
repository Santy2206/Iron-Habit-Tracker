"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Clock3, Droplet, Drumstick, Equal, RotateCcw, TrendingDown, TrendingUp, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkStatus,
  computeWeeklyAverages,
  enforceMacroFloors,
  entryMaintenance,
  fourWeekRate,
  intakeDuringTrend,
  isPendingReevaluation,
  latestBodyweight,
  parseDay,
  ratesSinceChange,
  recommend,
  targetRateLbs,
  toISODay,
  type Recommendation,
} from "@/lib/diet-engine";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_DIET,
  type DietHistoryEntry,
  type DietPhase,
  type DietSettings,
  type WeightEntry,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

interface DietDraft {
  phase: DietPhase;
  calorie_intake: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  protein_per_lb: string;
}

function num(v: string) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// enforce the floor rules on a draft without stomping values the user
// is mid-typing — only fields the constraint actually changed are
// rewritten. baseFat is the preferred fat from Settings (the ceiling).
function normalizeDraft(
  f: DietDraft,
  baseFat: number,
  bodyweight: number | null
): DietDraft {
  const cal = num(f.calorie_intake);
  const pLb = num(f.protein_per_lb);
  if (bodyweight === null || cal <= 0) return f;
  const plan = enforceMacroFloors(cal, pLb, baseFat, bodyweight);
  const out = { ...f };
  if (Math.abs(plan.protein_per_lb - pLb) > 0.001) {
    out.protein_per_lb = String(Math.round(plan.protein_per_lb * 100) / 100);
    out.protein_g = String(Math.round(plan.protein_g));
  }
  if (Math.abs(plan.fat_g - baseFat) > 0.001) {
    out.fat_g = String(Math.round(plan.fat_g * 10) / 10);
  }
  return out;
}

const STATUS_META = {
  on_track: { label: "On track", color: "#429a8e" },
  too_slow: { label: "Too slow", color: "#e0a458" },
  too_fast: { label: "Too fast", color: "#ca4d31" },
} as const;

export function DietModule({ userId }: { userId: string }) {
  const { t, locale } = useT();
  const statusLabel = (s: keyof typeof STATUS_META) =>
    s === "on_track" ? t("On track", "En ritmo") : s === "too_slow" ? t("Too slow", "Muy lento") : t("Too fast", "Muy rápido");
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<DietSettings | null>(null);
  const [history, setHistory] = useState<DietHistoryEntry[]>([]);
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  // draft targets are strings so the user can type decimals/empty fields
  // freely — parsed to numbers only when rendering or saving
  const [form, setForm] = useState<DietDraft>(() => ({
    phase: DEFAULT_DIET.phase,
    calorie_intake: String(DEFAULT_DIET.calorie_intake),
    protein_g: String(DEFAULT_DIET.protein_g),
    carbs_g: String(DEFAULT_DIET.carbs_g),
    fat_g: String(DEFAULT_DIET.fat_g),
    protein_per_lb: String(DEFAULT_DIET.protein_per_lb),
  }));
  const [saving, setSaving] = useState(false);
  // targets stay read-only until the user explicitly enters edit mode
  const [editing, setEditing] = useState(false);
  // true while the user has unsaved edits — keeps realtime reloads from
  // clobbering the draft targets
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    const [{ data: ds }, { data: dh }, { data: we }] = await Promise.all([
      supabase.from("diet_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("diet_history")
        .select("*")
        .eq("user_id", userId)
        .order("changed_on"),
      supabase.from("weight_entries").select("entry_date,weight_lb,source"),
    ]);
    const s = (ds as DietSettings | null) ?? null;
    setSettings(s);
    const wEntries = (we as WeightEntry[] | null) ?? [];
    setHistory((dh as DietHistoryEntry[] | null) ?? []);
    setEntries(wEntries);
    if (s && !dirtyRef.current) {
      const dailyMap: Record<string, number> = {};
      for (const e of wEntries) dailyMap[e.entry_date] = e.weight_lb;
      const curBw = latestBodyweight(dailyMap, computeWeeklyAverages(dailyMap));
      setForm(
        normalizeDraft(
          {
            phase: s.phase,
            calorie_intake: String(s.calorie_intake),
            protein_g: String(s.protein_g),
            carbs_g: String(s.carbs_g),
            fat_g: String(s.fat_g),
            protein_per_lb: String(s.protein_per_lb),
          },
          s.fat_g,
          curBw
        )
      );
    }
  }, [supabase, userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
    void load();
    const ch = supabase
      .channel("diet")
      .on("postgres_changes", { event: "*", schema: "public", table: "weight_entries" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "diet_settings" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "diet_history" }, () => void load())
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

  const bw = latestBodyweight(daily, weekly);
  const effective = settings ?? { ...DEFAULT_DIET, user_id: userId };
  const pending = isPendingReevaluation(weekly, history);
  const rates = ratesSinceChange(weekly, history);
  // evaluation rate = median of the 2/3/4-week trends measured only over
  // weeks since the last diet change; falls back to the global 4-week
  // rate when there's no change history. Hidden while pending so status
  // and recommendation wait for ≥2 weeks of post-change data.
  const evalRate = rates.evaluation ?? fourWeekRate(weekly);
  const rate = pending ? null : evalRate;
  const status = checkStatus(effective.phase, bw, rate);
  const [tLo, tHi] =
    bw !== null ? targetRateLbs(effective.phase, bw) : [null, null];

  const trendIntake = intakeDuringTrend(history, weekly, effective.calorie_intake);
  // carbs always compensate so macros add up to the calorie target;
  // fat starts at the Settings value and can auto-drop toward 0.3 g/lb
  // when carbs would otherwise fall below 35% (see enforceMacroFloors)
  const fatVal = num(form.fat_g);
  const carbsAuto = Math.max(
    0,
    (num(form.calorie_intake) -
      num(form.protein_g) * 4 -
      fatVal * 9) /
      4,
  );
  const suggestion: Recommendation | null =
    !pending && bw !== null && rate !== null && status !== null
      ? recommend(effective, bw, rate, trendIntake)
      : null;

  async function save(targets?: Partial<Omit<DietSettings, "user_id">>) {
    const next = {
      phase: form.phase,
      calorie_intake: num(form.calorie_intake),
      protein_g: num(form.protein_g),
      carbs_g: Math.round(carbsAuto),
      fat_g: fatVal,
      protein_per_lb: num(form.protein_per_lb),
      ...targets,
    };
    dirtyRef.current = false;
    setForm({
      phase: next.phase,
      calorie_intake: String(next.calorie_intake),
      protein_g: String(next.protein_g),
      carbs_g: String(next.carbs_g),
      fat_g: String(next.fat_g),
      protein_per_lb: String(next.protein_per_lb),
    });
    setSaving(true);
    await supabase.from("diet_settings").upsert({ ...next, user_id: userId });
    // history logs *changes* — skip when the values are identical to the
    // latest entry or to an entry already logged today
    const todayStr = toISODay(new Date());
    const matches = (h: DietHistoryEntry) =>
      h.phase === next.phase &&
      Math.round(h.calorie_intake) === Math.round(next.calorie_intake) &&
      Math.round(h.protein_g) === Math.round(next.protein_g) &&
      Math.round(h.carbs_g) === Math.round(next.carbs_g) &&
      Math.round(h.fat_g) === Math.round(next.fat_g);
    const latest = history.length
      ? [...history].sort((a, b) =>
          b.changed_on.localeCompare(a.changed_on)
        )[0]
      : null;
    if (
      !(latest && matches(latest)) &&
      !history.some((h) => h.changed_on === todayStr && matches(h))
    ) {
      await supabase.from("diet_history").insert({
        user_id: userId,
        changed_on: todayStr,
        phase: next.phase,
        calorie_intake: next.calorie_intake,
        protein_g: next.protein_g,
        carbs_g: next.carbs_g,
        fat_g: next.fat_g,
      });
    }
    setSaving(false);
    setEditing(false);
  }

  function edit(patch: (f: DietDraft) => DietDraft) {
    dirtyRef.current = true;
    setForm((f) =>
      normalizeDraft(patch(f), settings?.fat_g ?? DEFAULT_DIET.fat_g, bw)
    );
  }

  return (
    <div className="grid auto-rows-min gap-3 lg:grid-cols-2">
      {/* ── Charts (mirrors the desktop Diet tab) ───────────────────── */}
      <Card className="bg-[#1d2027]">
        <CardHeader className="pb-0">
          <CardTitle className="text-center text-[13px] font-normal text-[#c7cbd3]">
            {t("Calories over time (kcal)", "Calorías en el tiempo (kcal)")}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {history.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-[#c7cbd3]">
              {t("No history yet", "Sin historial aún")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 12, left: 0 }}>
                <CartesianGrid stroke="#3a3f4b" strokeOpacity={0.6} />
                <XAxis dataKey="changed_on" tickFormatter={(d) => String(d).slice(5)} tick={{ fill: "#c7cbd3", fontSize: 10 }} stroke="#3a3f4b" />
                <YAxis domain={["dataMin - 100", "dataMax + 100"]} tick={{ fill: "#c7cbd3", fontSize: 10 }} stroke="#3a3f4b" width={44} />
                <Tooltip contentStyle={{ background: "#262a33", border: "1px solid #3fb97f", borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} kcal`, t("Calories", "Calorías")]} />
                <Line type="linear" dataKey="calorie_intake" stroke="#3fb97f" strokeWidth={2} dot={{ r: 3, fill: "#3fb97f" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#1d2027]">
        <CardHeader className="pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle className="text-[13px] font-normal text-[#c7cbd3]">
              {t("Current Macro Split", "Distribución de macros actual")}
            </CardTitle>
            <div className="flex gap-4 text-[12px] text-[#9aa0ab]">
              <span>
                {t("Maintenance", "Mantenimiento")}:{" "}
                <span className="text-[#e7e9ee]">
                  {bw !== null && rate !== null
                    ? `${Math.round(trendIntake - rate * 500)} kcal`
                    : t("not enough data", "faltan datos")}
                </span>
              </span>
              <span>
                {t("Intake", "Consumo")}:{" "}
                <span className="font-bold text-[#e7e9ee]">
                  {Math.round(effective.calorie_intake)} kcal
                </span>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-64 pt-2">
          <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <Pie
                  data={[
                    { name: t("Protein", "Proteína"), g: num(form.protein_g), kcal: num(form.protein_g) * 4, color: "#3fb97f" },
                    { name: t("Carbs", "Carbs"), g: Math.round(carbsAuto), kcal: carbsAuto * 4, color: "#d9a441" },
                    { name: t("Fat", "Grasa"), g: fatVal, kcal: fatVal * 9, color: "#c45cc9" },
                  ]}
                  dataKey="kcal"
                  outerRadius="72%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="#1d2027"
                  strokeWidth={2}
                  label={(e) => `${e.name} ${Math.round(Number((e.payload as { g: number }).g))}g`}
                >
                  {["#3fb97f", "#d9a441", "#c45cc9"].map((c) => (
                    <Cell key={c} fill={c} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#262a33", border: "1px solid #3fb97f", borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => {
                    const kcal = Number(v);
                    const total =
                      num(form.protein_g) * 4 + carbsAuto * 4 + fatVal * 9;
                    const pct = total > 0 ? Math.round((kcal / total) * 100) : 0;
                    return [`${Math.round(kcal)} kcal · ${pct}%`, name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Phase + targets ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Diet targets", "Objetivos de dieta")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/60 bg-emerald-500/10 capitalize"
            >
              {form.phase === "cut" ? (
                <TrendingDown className="size-3.5" />
              ) : (
                <TrendingUp className="size-3.5" />
              )}
              {form.phase}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {t("Change phase in Settings", "Cambia la fase en Settings")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Calories", "Calorías")}>
              <Input
                value={form.calorie_intake}
                onChange={(e) =>
                  edit((f) => ({ ...f, calorie_intake: e.target.value }))
                }
                inputMode="decimal"
                disabled={!editing}
              />
            </Field>
            <Field label={t("Protein (g)", "Proteína (g)")}>
              <Input
                value={form.protein_g}
                disabled={!editing}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((f) => ({
                    ...f,
                    protein_g: v,
                    protein_per_lb: bw
                      ? String(Math.round((num(v) / bw) * 100) / 100)
                      : f.protein_per_lb,
                  }));
                }}
                inputMode="decimal"
              />
            </Field>
            <Field label={t("Carbs (g) — auto", "Carbs (g) — auto")}>
              <Input
                value={Math.round(carbsAuto)}
                readOnly
                className="text-muted-foreground"
                title={t("Compensates to hit your calories (kept ≥ 35%)", "Compensa para llegar a tus calorías (mín. 35%)")}
              />
            </Field>
            <Field label={t("Fat (g) — fixed", "Grasa (g) — fija")}>
              <Input
                value={fatVal}
                readOnly
                className="text-muted-foreground"
                title={t("Set in Settings · auto-drops toward 0.3 g/lb if carbs fall below 35%", "Se fija en Settings · baja hacia 0.3 g/lb si los carbs caen bajo 35%")}
              />
            </Field>
            <Field label={t("Protein / lb", "Proteína / lb")}>
              <div className="flex items-center gap-1.5">
                <Input
                  value={form.protein_per_lb}
                  disabled={!editing}
                  onChange={(e) => {
                    const v = e.target.value;
                    edit((f) => ({
                      ...f,
                      protein_per_lb: v,
                      protein_g: bw
                        ? String(Math.round(num(v) * bw))
                        : f.protein_g,
                    }));
                  }}
                  inputMode="decimal"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={t("Reset to default (1.15)", "Volver al default (1.15)")}
                  disabled={!editing}
                  onClick={() =>
                    edit((f) => ({
                      ...f,
                      protein_per_lb: String(DEFAULT_DIET.protein_per_lb),
                      protein_g: bw
                        ? String(
                            Math.round(DEFAULT_DIET.protein_per_lb * bw),
                          )
                        : f.protein_g,
                    }))
                  }
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    dirtyRef.current = false;
                    setEditing(false);
                    void load();
                  }}
                >
                  {t("Cancel", "Cancelar")}
                </Button>
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? t("Saving…", "Guardando…") : t("Save targets", "Guardar objetivos")}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setEditing(true)}>
                {t("Edit targets", "Editar objetivos")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Status ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Weekly status", "Estado semanal")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label={t("Bodyweight", "Peso")} value={bw ? `${bw.toFixed(1)} lb` : "—"} />
            <Stat
              label={t("Trend rate", "Ritmo de tendencia")}
              value={
                evalRate !== null
                  ? `${evalRate > 0 ? "+" : ""}${evalRate.toFixed(2)} lb/wk`
                  : "—"
              }
            />
            <Stat
              label={t("Trend maintenance", "Mantenimiento de tendencia")}
              value={
                evalRate !== null
                  ? `${Math.round(trendIntake - evalRate * 500)} kcal`
                  : "—"
              }
            />
            <Stat
              label={t("Target rate", "Ritmo objetivo")}
              value={
                tLo !== null
                  ? `${tLo!.toFixed(2)} to ${tHi!.toFixed(2)} lb/wk`
                  : "—"
              }
            />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("Status", "Estado")}
              </p>
              {pending ? (
                <Badge variant="outline" className="mt-1 gap-1">
                  <Clock3 className="size-3" /> {t("Pending reevaluation", "Reevaluación pendiente")}
                </Badge>
              ) : status ? (
                <Badge
                  variant="outline"
                  className="mt-1 gap-1"
                  style={{
                    color: STATUS_META[status].color,
                    borderColor: STATUS_META[status].color + "66",
                  }}
                >
                  <CheckCircle2 className="size-3" />
                  {statusLabel(status)}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
          {(rates.w2 !== null || rates.w3 !== null || rates.w4 !== null) && (
            <p className="text-[11px] text-muted-foreground">
              {t("Since last change", "Desde el último cambio")} —{" "}
              {[
                [2, rates.w2],
                [3, rates.w3],
                [4, rates.w4],
              ]
                .filter(([, r]) => r !== null)
                .map(
                  ([w, r]) =>
                    `${w}w: ${(r as number) > 0 ? "+" : ""}${(r as number).toFixed(2)} lb/wk`
                )
                .join("  ·  ")}
            </p>
          )}
          {pending && (
            <p className="text-xs text-muted-foreground">
              {t("Targets changed — evaluation resumes after at least 2 weeks of post-change data.", "Objetivos cambiados — la evaluación retoma tras 2 semanas de datos nuevos.")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Recommendation ──────────────────────────────────────────── */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Recommendation", "Recomendación")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!suggestion ? (
            <p className="text-sm text-muted-foreground">
              {pending
                ? t("Reevaluation pending — at least 2 weeks of post-change data are needed.", "Reevaluación pendiente — se necesitan al menos 2 semanas de datos nuevos.")
                : t("At least 2 weeks of averages are needed to recommend.", "Se necesitan al menos 2 semanas de promedios para recomendar.")}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-6">
              <Stat
                label={t("Maintenance estimate", "Mantenimiento estimado")}
                value={`${Math.round(suggestion.maintenance_estimate)} kcal`}
              />
              <Stat
                label={t("Suggested calories", "Calorías sugeridas")}
                value={`${Math.round(suggestion.calorie_intake)} kcal`}
                highlight
              />
              <Stat label={t("Protein", "Proteína")} value={`${Math.round(suggestion.protein_g)} g`} />
              <Stat label={t("Carbs", "Carbs")} value={`${Math.round(suggestion.carbs_g)} g`} />
              <Stat label={t("Fat", "Grasa")} value={`${Math.round(suggestion.fat_g)} g`} />
              <Button
                onClick={() =>
                  void save({
                    calorie_intake: Math.round(suggestion.calorie_intake),
                    protein_g: Math.round(suggestion.protein_g),
                    carbs_g: Math.round(suggestion.carbs_g),
                    fat_g: Math.round(suggestion.fat_g),
                    protein_per_lb:
                      Math.round(suggestion.protein_per_lb * 100) / 100,
                  })
                }
                disabled={saving}
              >
                {t("Apply suggestion", "Aplicar sugerencia")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── History ─────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("Diet history", "Historial de dieta")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col text-sm">
              {[...history].reverse().slice(0, 8).map((h, i, arr) => {
                const prev = arr[i + 1];
                const delta = prev
                  ? Math.round(h.calorie_intake - prev.calorie_intake)
                  : 0;
                const maint = entryMaintenance(
                  weekly,
                  history,
                  history.length - 1 - i
                );
                const diffs = prev
                  ? {
                      p: Math.round(h.protein_g - prev.protein_g),
                      c: Math.round(h.carbs_g - prev.carbs_g),
                      f: Math.round(h.fat_g - prev.fat_g),
                    }
                  : null;
                return (
                  <div
                    key={h.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 py-2 last:border-0"
                  >
                    <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                      {parseDay(h.changed_on).toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="w-[4.4rem] shrink-0">
                      <Badge
                        variant="outline"
                        className="w-full justify-center gap-1 capitalize"
                        style={{
                          color: h.phase === "cut" ? "#e0a458" : "#3fb97f",
                          borderColor:
                            (h.phase === "cut" ? "#e0a458" : "#3fb97f") + "66",
                        }}
                      >
                        {h.phase === "cut" ? (
                          <TrendingDown className="size-3" />
                        ) : (
                          <TrendingUp className="size-3" />
                        )}
                        {h.phase}
                      </Badge>
                    </span>
                    <span className="w-[5.2rem] shrink-0 font-semibold tabular-nums">
                      {Math.round(h.calorie_intake)} kcal
                    </span>
                    <span className="w-11 shrink-0 text-xs tabular-nums">
                      {prev &&
                        (delta === 0 ? (
                          <span
                            className="flex items-center gap-0.5 text-muted-foreground"
                            title={t("No change", "Sin cambio")}
                          >
                            <Equal className="size-3" />0
                          </span>
                        ) : (
                          <span
                            style={{ color: delta > 0 ? "#3fb97f" : "#e0a458" }}
                          >
                            {delta > 0 ? "▲" : "▼"}
                            {Math.abs(delta)}
                          </span>
                        ))}
                    </span>
                    <span
                      className="w-[5.5rem] shrink-0 text-xs text-muted-foreground tabular-nums"
                      title={t("Estimated maintenance during this entry", "Mantenimiento estimado en este periodo")}
                    >
                      {t("Maint", "Mant")} {maint !== null ? `~${Math.round(maint)}` : "—"}
                    </span>
                    <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                      <span
                        className="flex w-[5.2rem] items-center gap-1"
                        style={{ color: "#3fb97f" }}
                      >
                        <Drumstick className="size-3.5 shrink-0" />
                        {Math.round(h.protein_g)}g
                        {diffs && <MacroDelta v={diffs.p} />}
                      </span>
                      <span
                        className="flex w-[5.2rem] items-center gap-1"
                        style={{ color: "#d9a441" }}
                      >
                        <Wheat className="size-3.5 shrink-0" />
                        {Math.round(h.carbs_g)}g
                        {diffs && <MacroDelta v={diffs.c} />}
                      </span>
                      <span
                        className="flex w-[5.2rem] items-center gap-1"
                        style={{ color: "#c45cc9" }}
                      >
                        <Droplet className="size-3.5 shrink-0" />
                        {Math.round(h.fat_g)}g
                        {diffs && <MacroDelta v={diffs.f} />}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MacroDelta({ v }: { v: number }) {
  if (v === 0) return <Equal className="size-2.5 opacity-50" />;
  return (
    <span
      className="text-[10px]"
      style={{ color: v > 0 ? "#3fb97f" : "#e0a458" }}
    >
      {v > 0 ? "▲" : "▼"}
      {Math.abs(v)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          highlight && "text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
