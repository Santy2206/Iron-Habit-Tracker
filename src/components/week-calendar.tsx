"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { addMinutes, format, isSameDay, isToday, startOfDay } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CAPITALS } from "@/lib/capitals";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

export const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const DAY_MINUTES = 24 * 60;
const SNAP = 15;

interface DraftBlock {
  dayIdx: number;
  startMin: number;
  endMin: number;
}

interface LiveDrag {
  id: string;
  dayDelta: number;
  minDelta: number;
  /** when resizing, only end changes */
  resizeEnd: number | null;
}

interface Props {
  days: Date[];
  events: CalendarEvent[];
  onCreateBlock: (day: Date, startMin: number, endMin: number) => void;
  onMoveEvent: (
    id: string,
    newStart: Date,
    newEnd: Date,
  ) => void;
  onEventClick: (ev: CalendarEvent) => void;
}

function minuteOf(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function WeekCalendar({
  days,
  events,
  onCreateBlock,
  onMoveEvent,
  onEventClick,
}: Props) {
  const { lang } = useT();
  const dfns = lang === "es" ? es : enUS;
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftBlock | null>(null);
  const [live, setLive] = useState<LiveDrag | null>(null);

  // scroll to ~7am on mount
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    days.forEach((d, i) => map.set(i, []));
    for (const ev of events) {
      if (ev.all_day || ev.deleted) continue;
      const s = new Date(ev.start_at);
      days.forEach((d, i) => {
        if (isSameDay(s, d)) map.get(i)!.push(ev);
      });
    }
    return map;
  }, [days, events]);

  function dayIndexFromX(clientX: number) {
    const row = rowRef.current;
    if (!row) return 0;
    const rect = row.getBoundingClientRect();
    const w = rect.width / days.length;
    return Math.min(days.length - 1, Math.max(0, Math.floor((clientX - rect.left) / w)));
  }

  function minuteFromY(colEl: HTMLElement, clientY: number) {
    const rect = colEl.getBoundingClientRect();
    const y = clientY - rect.top;
    return Math.min(DAY_MINUTES, Math.max(0, y / PX_PER_MIN));
  }

  function snap(min: number) {
    return Math.round(min / SNAP) * SNAP;
  }

  /* ---------------- create-by-drag ---------------- */
  function onColumnPointerDown(e: React.PointerEvent<HTMLDivElement>, dayIdx: number) {
    if (e.button !== 0) return;
    // ignore when pressing on an event block
    if ((e.target as HTMLElement).closest("[data-event-block]")) return;
    const col = e.currentTarget;
    const min0 = snap(minuteFromY(col, e.clientY));
    setDraft({ dayIdx, startMin: min0, endMin: min0 });

    function move(ev: PointerEvent) {
      const m = snap(minuteFromY(col, ev.clientY));
      setDraft({ dayIdx, startMin: Math.min(min0, m), endMin: Math.max(min0, m) });
    }
    function up(ev: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const m = snap(minuteFromY(col, ev.clientY));
      const lo = Math.min(min0, m);
      const hi = Math.max(min0, m);
      setDraft(null);
      if (hi - lo >= SNAP) {
        onCreateBlock(days[dayIdx], lo, hi);
      } else {
        onCreateBlock(days[dayIdx], lo, Math.min(lo + 60, DAY_MINUTES));
      }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---------------- move / resize ---------------- */
  function onEventPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    ev: CalendarEvent,
    mode: "move" | "resize",
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = new Date(ev.start_at);
    const origEnd = new Date(ev.end_at);
    const origDayIdx = days.findIndex((d) => isSameDay(d, origStart));
    const origEndMin = isSameDay(origEnd, origStart)
      ? minuteOf(origEnd)
      : DAY_MINUTES;
    let moved = false;

    function move(pe: PointerEvent) {
      const dy = pe.clientY - startY;
      const dx = pe.clientX - startX;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      const minDelta = snap(dy / PX_PER_MIN);
      if (mode === "resize") {
        const newEnd = Math.min(
          DAY_MINUTES,
          Math.max(minuteOf(origStart) + SNAP, origEndMin + minDelta),
        );
        setLive({ id: ev.id, dayDelta: 0, minDelta: 0, resizeEnd: newEnd });
      } else {
        const dayDelta =
          dayIndexFromX(pe.clientX) - (origDayIdx === -1 ? 0 : origDayIdx);
        setLive({ id: ev.id, dayDelta, minDelta, resizeEnd: null });
      }
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        setLive(null);
        onEventClick(ev);
        return;
      }
      setLive((cur) => {
        if (!cur) return null;
        if (mode === "resize" && cur.resizeEnd != null) {
          const newStart = origStart;
          const newEnd = addMinutes(startOfDay(origStart), cur.resizeEnd);
          if (newEnd > newStart) onMoveEvent(ev.id, newStart, newEnd);
        } else {
          const newStart = addMinutes(origStart, cur.minDelta);
          newStart.setDate(newStart.getDate() + cur.dayDelta);
          const newEnd = addMinutes(origEnd, cur.minDelta);
          newEnd.setDate(newEnd.getDate() + cur.dayDelta);
          onMoveEvent(ev.id, newStart, newEnd);
        }
        return null;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  // keep day columns readable on narrow screens — scroll horizontally
  const minColPx = days.length > 1 ? 90 : 0;
  const minGridW = 48 + days.length * minColPx;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <div style={{ minWidth: minGridW }}>
          {/* day header — sticky on vertical scroll */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card pl-12">
            <div ref={rowRef} className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
              {days.map((d) => (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "border-l border-border py-2 text-center",
                    isToday(d) && "bg-violet-500/10",
                  )}
                >
                  <div className="text-[11px] uppercase text-muted-foreground">
                    {format(d, "EEE", { locale: dfns })}
                  </div>
                  <div
                    className={cn(
                      "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                      isToday(d) && "bg-violet-600 text-white",
                    )}
                  >
                    {format(d, "d")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* time grid */}
          <div className="flex">
            {/* gutter */}
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-card">
              {hours.map((h) => (
                <div
                  key={h}
                  className="relative h-14 pr-2 text-right text-[10px] text-muted-foreground"
                >
                  <span className="absolute -top-1.5 right-1.5">
                    {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                  </span>
                </div>
              ))}
            </div>

            {/* day columns */}
            <div
              className="grid flex-1"
              style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
            >
              {days.map((day, dayIdx) => (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  events={eventsByDay.get(dayIdx) ?? []}
                  live={live}
                  draft={draft?.dayIdx === dayIdx ? draft : null}
                  onColumnPointerDown={(e) => onColumnPointerDown(e, dayIdx)}
                  onEventPointerDown={onEventPointerDown}
                  isTodayCol={isToday(day)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  live,
  draft,
  onColumnPointerDown,
  onEventPointerDown,
  isTodayCol,
}: {
  day: Date;
  events: CalendarEvent[];
  live: LiveDrag | null;
  draft: DraftBlock | null;
  onColumnPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onEventPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    ev: CalendarEvent,
    mode: "move" | "resize",
  ) => void;
  isTodayCol: boolean;
}) {
  const iso = format(day, "yyyy-MM-dd");
  const { setNodeRef } = useDroppable({ id: `day:${iso}`, data: { date: iso } });

  return (
    <div
      ref={setNodeRef}
      onPointerDown={onColumnPointerDown}
      className={cn(
        "relative border-l border-border select-none",
        isTodayCol && "bg-violet-500/5",
      )}
      style={{ height: DAY_MINUTES * PX_PER_MIN }}
    >
      {/* hour lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: h * HOUR_PX }}
        />
      ))}

      {/* draft block while drag-creating */}
      {draft && (
        <div
          className="absolute inset-x-1 rounded-md bg-violet-500/30 ring-1 ring-violet-400"
          style={{
            top: draft.startMin * PX_PER_MIN,
            height: Math.max(8, (draft.endMin - draft.startMin) * PX_PER_MIN),
          }}
        />
      )}

      {/* events */}
      {events.map((ev) => {
        const s = new Date(ev.start_at);
        const e = new Date(ev.end_at);
        const startMin = minuteOf(s);
        let endMin = isSameDay(e, s) ? minuteOf(e) : DAY_MINUTES;
        if (endMin <= startMin) endMin = startMin + SNAP;

        const lv = live?.id === ev.id ? live : null;
        const topMin = startMin + (lv?.resizeEnd == null ? (lv?.minDelta ?? 0) : 0);
        const dispEnd = lv?.resizeEnd ?? endMin + (lv ? lv.minDelta : 0);
        const color = CAPITALS[ev.category]?.color ?? "#7c3aed";

        return (
          <div
            key={ev.id}
            data-event-block
            onPointerDown={(e) => onEventPointerDown(e, ev, "move")}
            className="absolute inset-x-1 z-10 cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-white shadow-sm active:cursor-grabbing"
            style={{
              top: Math.max(0, topMin) * PX_PER_MIN,
              height: Math.max(16, (dispEnd - startMin) * PX_PER_MIN),
              backgroundColor: color + "cc",
              borderLeft: `3px solid ${color}`,
            }}
            title={ev.title}
          >
            <div className="truncate text-[11px] font-medium leading-tight">
              {ev.title}
            </div>
            {(dispEnd - startMin) >= 30 && (
              <div className="text-[10px] opacity-80">
                {format(
                  addMinutes(startOfDay(day), Math.max(0, topMin)),
                  "HH:mm",
                )}
                {" – "}
                {format(addMinutes(startOfDay(day), dispEnd), "HH:mm")}
              </div>
            )}
            {/* resize handle */}
            <div
              data-resize-handle
              onPointerDown={(e) => onEventPointerDown(e, ev, "resize")}
              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
            />
          </div>
        );
      })}
    </div>
  );
}
