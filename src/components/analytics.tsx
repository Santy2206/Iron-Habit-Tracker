"use client";

import { useMemo, useState } from "react";
import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAPITAL_LIST } from "@/lib/capitals";
import type { CalendarEvent } from "@/lib/types";
import { useT } from "@/lib/lang";

type Range = "week" | "month";

export function AnalyticsPanel({ events }: { events: CalendarEvent[] }) {
  const { t } = useT();
  const [range, setRange] = useState<Range>("week");

  const { slices, totalMin } = useMemo(() => {
    const now = new Date();
    const from =
      range === "week"
        ? startOfWeek(now, { weekStartsOn: 1 })
        : startOfMonth(now);
    const to =
      range === "week"
        ? endOfWeek(now, { weekStartsOn: 1 })
        : endOfMonth(now);

    const mins = new Map<string, number>();
    for (const ev of events) {
      if (ev.deleted) continue;
      const s = new Date(ev.start_at);
      const e = new Date(ev.end_at);
      if (s < from || s > to) continue;
      const m = Math.max(0, (e.getTime() - s.getTime()) / 60000);
      mins.set(ev.category, (mins.get(ev.category) ?? 0) + m);
    }
    const slices = CAPITAL_LIST.map((c) => ({
      name: c.short,
      id: c.id,
      minutes: Math.round(mins.get(c.id) ?? 0),
      color: c.color,
      emoji: c.emoji,
    })).filter((s) => s.minutes > 0);
    const totalMin = slices.reduce((a, s) => a + s.minutes, 0);
    return { slices, totalMin };
  }, [events, range]);

  const hours = totalMin / 60;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-1">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("Capital Analytics", "Analítica de capitales")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Distribution of your invested time by capital", "Distribución de tu tiempo invertido por capital")}
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">{t("This week", "Esta semana")}</SelectItem>
            <SelectItem value="month">{t("This month", "Este mes")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="bg-card">
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{hours.toFixed(1)}h</div>
            <div className="text-[10px] text-muted-foreground">{t("tracked", "registradas")}</div>
          </CardContent>
        </Card>
        {CAPITAL_LIST.map((c) => {
          const s = slices.find((x) => x.id === c.id);
          const m = s?.minutes ?? 0;
          const pct = totalMin ? Math.round((m / totalMin) * 100) : 0;
          return (
            <Card key={c.id} className="bg-card">
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.short}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">
                  {(m / 60).toFixed(1)}h
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {pct}% {t("of time", "del tiempo")}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: c.color }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="min-h-80 flex-1 bg-card">
        <CardHeader>
          <CardTitle className="text-sm">{t("Capital distribution", "Distribución por capital")}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {slices.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("No scheduled blocks in this period.", "No hay bloques agendados en este periodo.")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="minutes"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={3}
                  strokeWidth={0}
                  label={({ name, percent }) =>
                    `${name} ${Math.round((percent ?? 0) * 100)}%`
                  }
                  labelLine={false}
                >
                  {slices.map((s) => (
                    <Cell key={s.id} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => `${(Number(v) / 60).toFixed(1)} h`}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
