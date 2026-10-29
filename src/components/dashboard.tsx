"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  addDays,
  addMinutes,
  addWeeks,
  format,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { enUS, es } from "date-fns/locale";
import {
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  KanbanSquare,
  PieChart,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CAPITAL_LIST } from "@/lib/capitals";
import type { CalendarEvent, Task, TaskStatus, Todo } from "@/lib/types";
import { WeekCalendar, HOUR_PX } from "@/components/week-calendar";
import { EventDialog, type EventDraft } from "@/components/event-dialog";
import { TaskDialog, type TaskDraft } from "@/components/task-dialog";
import { UnscheduledTasks } from "@/components/unscheduled-tasks";
import { KanbanBoard } from "@/components/kanban-board";
import { TodoList } from "@/components/todo-list";
import { AnalyticsPanel } from "@/components/analytics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

type Tab = "calendar" | "tasks" | "analytics";
type CalView = "week" | "day";

export function Dashboard({ userId }: { userId: string }) {
  const { t, lang } = useT();
  const dfns = lang === "es" ? es : enUS;
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("calendar");
  const [calView, setCalView] = useState<CalView>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week",
  );
  const [anchor, setAnchor] = useState(() => new Date());

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [syncing, setSyncing] = useState(false);

  const [evDialog, setEvDialog] = useState<{
    open: boolean;
    event?: CalendarEvent | null;
    start?: Date | null;
    end?: Date | null;
    task?: Task | null;
  }>({ open: false });

  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    task?: Task | null;
    status?: TaskStatus;
  }>({ open: false });

  /* ------------------------------- data load ------------------------------ */
  const loadAll = useCallback(async () => {
    const [ev, tk, td] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("user_id", userId)
        .eq("deleted", false),
      supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("position"),
      supabase
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .order("position"),
    ]);
    if (ev.data) setEvents(ev.data as CalendarEvent[]);
    if (tk.data) setTasks(tk.data as Task[]);
    if (td.data) setTodos(td.data as Todo[]);
  }, [supabase, userId]);

  const syncFromGoogle = useCallback(async () => {
    setSyncing(true);
    try {
      await supabase.functions.invoke("gcal-sync");
    } finally {
      setSyncing(false);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
    loadAll();
    syncFromGoogle(); // initial pull
    const interval = setInterval(syncFromGoogle, 5 * 60_000);

    const upsert =
      <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        setter((cur) => {
          if (payload.eventType === "DELETE")
            return cur.filter((x) => x.id !== payload.old.id);
          const n = payload.new as T;
          const i = cur.findIndex((x) => x.id === n.id);
          if (i === -1) return [...cur, n];
          const copy = [...cur];
          copy[i] = n;
          return copy;
        });
      };

    const channel = supabase
      .channel("iron")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `user_id=eq.${userId}` },
        upsert(setEvents),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` },
        upsert(setTasks),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${userId}` },
        upsert(setTodos),
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [loadAll, supabase, syncFromGoogle, userId]);

  /* ----------------------------- event actions ---------------------------- */
  const push = useCallback(
    (body: object) => {
      supabase.functions.invoke("gcal-push", { body }).catch(() => {});
    },
    [supabase],
  );

  async function saveEvent(draft: EventDraft) {
    const task = evDialog.task;
    if (evDialog.event) {
      const id = evDialog.event.id;
      const patch = {
        title: draft.title,
        description: draft.description,
        category: draft.category,
        start_at: draft.start.toISOString(),
        end_at: draft.end.toISOString(),
      };
      await supabase.from("events").update(patch).eq("id", id);
      push({ eventId: id });
    } else {
      const { data } = await supabase
        .from("events")
        .insert({
          user_id: userId,
          title: draft.title,
          description: draft.description || null,
          category: draft.category,
          start_at: draft.start.toISOString(),
          end_at: draft.end.toISOString(),
          task_id: task?.id ?? null,
          source: "local",
        })
        .select()
        .single();
      if (data) push({ eventId: data.id });
    }
    setEvDialog({ open: false, task: null });
  }

  async function deleteEvent() {
    const ev = evDialog.event;
    if (!ev) return;
    setEvDialog({ open: false, task: null });
    if (ev.gcal_event_id) push({ gcalEventId: ev.gcal_event_id });
    await supabase.from("events").delete().eq("id", ev.id);
  }

  async function moveEvent(id: string, newStart: Date, newEnd: Date) {
    await supabase
      .from("events")
      .update({
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
      })
      .eq("id", id);
    push({ eventId: id });
  }

  /* ------------------------------ task actions ---------------------------- */
  async function saveTask(draft: TaskDraft) {
    if (taskDialog.task) {
      await supabase
        .from("tasks")
        .update({ ...draft, subtasks: draft.subtasks })
        .eq("id", taskDialog.task.id);
    } else {
      const pos = tasks.filter((t) => t.status === draft.status).length;
      await supabase.from("tasks").insert({
        user_id: userId,
        ...draft,
        description: draft.description || null,
        position: pos,
      });
    }
    setTaskDialog({ open: false });
  }

  async function deleteTask() {
    const t = taskDialog.task;
    if (!t) return;
    setTaskDialog({ open: false });
    await supabase.from("tasks").delete().eq("id", t.id);
  }

  async function moveTask(taskId: string, status: TaskStatus, position: number) {
    const col = tasks
      .filter((t) => t.status === status && t.id !== taskId)
      .sort((a, b) => a.position - b.position);
    col.splice(position, 0, tasks.find((t) => t.id === taskId)!);
    await Promise.all(
      col.map((t, i) => {
        const patch: Record<string, unknown> = { position: i };
        if (t.id === taskId) patch.status = status;
        return supabase.from("tasks").update(patch).eq("id", t.id);
      }),
    );
  }

  /* ------------------------------ todo actions ---------------------------- */
  async function addTodo(title: string) {
    await supabase.from("todos").insert({
      user_id: userId,
      title,
      position: todos.length,
    });
  }

  /* --------------------------- dnd task -> calendar ------------------------ */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onCalendarDrop(e: DragEndEvent) {
    const { active, over, delta, activatorEvent } = e;
    if (!over || !String(over.id).startsWith("day:")) return;
    const task = (active.data.current as { task?: Task })?.task;
    if (!task) return;

    const dateISO = String(over.id).slice(4);
    // pointer Y at drop = activator Y + delta; over.rect is the day column rect
    const activator = activatorEvent as PointerEvent;
    const dropY = (activator?.clientY ?? over.rect.top) + delta.y;
    const pxPerMin = HOUR_PX / 60;
    let minute = Math.round((dropY - over.rect.top) / pxPerMin / 15) * 15;
    minute = Math.min(23 * 60, Math.max(0, minute));

    const start = addMinutes(startOfDay(new Date(dateISO + "T00:00:00")), minute);
    const end = addMinutes(start, 60);
    setEvDialog({
      open: true,
      task,
      start,
      end,
      event: null,
    });
  }

  /* --------------------------------- render ------------------------------- */
  const days = useMemo(() => {
    if (calView === "day") return [startOfDay(anchor)];
    const ws = startOfWeek(anchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [anchor, calView]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "calendar", label: t("Calendar", "Calendario"), icon: <CalendarDays className="size-4" /> },
    { id: "tasks", label: t("Tasks", "Tareas"), icon: <KanbanSquare className="size-4" /> },
    { id: "analytics", label: t("Analytics", "Analítica"), icon: <PieChart className="size-4" /> },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* module header */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2 md:h-13 md:flex-nowrap md:px-4">
        <div className="hidden items-center gap-2 font-semibold md:flex">
          <div className="flex size-7 items-center justify-center rounded-md bg-violet-600">
            <CalendarClock className="size-4 text-white" />
          </div>
          Time Manager
        </div>

        <nav className="flex items-center gap-1 md:mx-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors md:px-3",
                tab === t.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "calendar" && (
          <div className="flex w-full items-center gap-1 md:ml-2 md:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setAnchor((a) => (calView === "week" ? addWeeks(a, -1) : addDays(a, -1)))
              }
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
              {t("Today", "Hoy")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setAnchor((a) => (calView === "week" ? addWeeks(a, 1) : addDays(a, 1)))
              }
            >
              <ChevronRight className="size-4" />
            </Button>
            <span className="ml-1 min-w-0 flex-1 truncate text-sm font-medium md:flex-none">
              {calView === "week"
                ? `${format(days[0], "d MMM", { locale: dfns })} – ${format(days[6], "d MMM", { locale: dfns })}`
                : format(anchor, "EEEE d MMM", { locale: dfns })}
            </span>
            <div className="ml-auto flex overflow-hidden rounded-md border border-border md:ml-2">
              {(["day", "week"] as CalView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setCalView(v)}
                  className={cn(
                    "px-2.5 py-1 text-xs",
                    calView === v ? "bg-accent" : "text-muted-foreground",
                  )}
                >
                  {v === "day" ? t("Day", "Día") : t("Week", "Semana")}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={syncFromGoogle}
            disabled={syncing}
            title={t("Sync with Google Calendar", "Sincronizar con Google Calendar")}
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            <span className="hidden sm:inline">{t("Sync", "Sincronizar")}</span>
          </Button>
        </div>
      </header>

      {/* capital legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5">
        {CAPITAL_LIST.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            {c.short}
          </span>
        ))}
      </div>

      {/* content */}
      <main className="min-h-0 flex-1 p-2 md:p-3">
        {tab === "calendar" && (
          <DndContext sensors={sensors} onDragEnd={onCalendarDrop}>
            <div className="flex h-full gap-3">
              <WeekCalendar
                days={days}
                events={events}
                onCreateBlock={(day, s, e) =>
                  setEvDialog({
                    open: true,
                    start: addMinutes(startOfDay(day), s),
                    end: addMinutes(startOfDay(day), e),
                  })
                }
                onMoveEvent={moveEvent}
                onEventClick={(ev) => setEvDialog({ open: true, event: ev })}
              />
              <div className="hidden md:block">
                <UnscheduledTasks tasks={tasks} />
              </div>
            </div>
          </DndContext>
        )}

        {tab === "tasks" && (
          <div className="flex h-full flex-col gap-3 overflow-y-auto md:flex-row md:overflow-hidden">
            <div className="flex min-h-[420px] flex-1 md:min-h-0">
              <KanbanBoard
                tasks={tasks}
                onMove={moveTask}
                onNewTask={(status) => setTaskDialog({ open: true, status })}
                onEditTask={(t) => setTaskDialog({ open: true, task: t })}
                onSchedule={(t) => {
                  const start = new Date();
                  start.setMinutes(0, 0, 0);
                  start.setHours(start.getHours() + 1);
                  setEvDialog({ open: true, task: t, start, end: addMinutes(start, 60) });
                }}
              />
            </div>
            <div className="min-h-[300px] w-full shrink-0 md:min-h-0 md:w-80">
              <TodoList
                todos={todos}
                onAdd={addTodo}
                onToggle={(id, done) =>
                  supabase.from("todos").update({ done }).eq("id", id)
                }
                onToggleUrgent={(id, urgent) =>
                  supabase.from("todos").update({ urgent }).eq("id", id)
                }
                onDelete={(id) => supabase.from("todos").delete().eq("id", id)}
                onSetDue={(id, due) =>
                  supabase.from("todos").update({ due_date: due }).eq("id", id)
                }
              />
            </div>
          </div>
        )}

        {tab === "analytics" && <AnalyticsPanel events={events} />}
      </main>

      <EventDialog
        open={evDialog.open}
        onOpenChange={(o) => setEvDialog((d) => ({ ...d, open: o }))}
        event={evDialog.event}
        initialStart={evDialog.start}
        initialEnd={evDialog.end}
        initialTitle={evDialog.task?.title}
        initialCategory={evDialog.task?.category}
        onSave={saveEvent}
        onDelete={evDialog.event ? deleteEvent : undefined}
      />

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(o) => setTaskDialog((d) => ({ ...d, open: o }))}
        task={taskDialog.task}
        defaultStatus={taskDialog.status}
        onSave={saveTask}
        onDelete={taskDialog.task ? deleteTask : undefined}
      />
    </div>
  );
}
