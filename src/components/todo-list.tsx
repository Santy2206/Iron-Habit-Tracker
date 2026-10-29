"use client";

import { useState } from "react";
import { format, isToday, isBefore, startOfDay } from "date-fns";
import { Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

interface Props {
  todos: Todo[];
  onAdd: (title: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onToggleUrgent: (id: string, urgent: boolean) => void;
  onDelete: (id: string) => void;
  onSetDue: (id: string, due: string | null) => void;
}

export function TodoList({
  todos,
  onAdd,
  onToggle,
  onToggleUrgent,
  onDelete,
  onSetDue,
}: Props) {
  const { t } = useT();
  const [text, setText] = useState("");

  function add() {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  }

  const pending = todos
    .filter((t) => !t.done)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.position - b.position);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{t("Personal To-Do", "Pendientes personales")}</h3>
        <p className="text-[11px] text-muted-foreground">
          {t("Quick personal task checklist", "Checklist rápido de pendientes")}
        </p>
      </div>
      <div className="flex gap-2 border-b border-border p-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={t("New task…  (Enter)", "Nueva tarea…  (Enter)")}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={add}>
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {pending.map((t) => (
          <TodoRow
            key={t.id}
            todo={t}
            onToggle={onToggle}
            onToggleUrgent={onToggleUrgent}
            onDelete={onDelete}
            onSetDue={onSetDue}
          />
        ))}
        {done.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Completed", "Completadas")} ({done.length})
            </div>
            {done.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                onToggle={onToggle}
                onToggleUrgent={onToggleUrgent}
                onDelete={onDelete}
                onSetDue={onSetDue}
              />
            ))}
          </>
        )}
        {todos.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {t("Nothing here yet.", "Nada por aquí aún.")}
          </p>
        )}
      </div>
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onToggleUrgent,
  onDelete,
  onSetDue,
}: {
  todo: Todo;
  onToggle: (id: string, done: boolean) => void;
  onToggleUrgent: (id: string, urgent: boolean) => void;
  onDelete: (id: string) => void;
  onSetDue: (id: string, due: string | null) => void;
}) {
  const { t } = useT();
  const overdue =
    todo.due_date &&
    !todo.done &&
    isBefore(new Date(todo.due_date), startOfDay(new Date()));

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={(e) => onToggle(todo.id, e.target.checked)}
        className="size-4 shrink-0 accent-violet-500"
      />
      <span
        className={cn(
          "flex-1 truncate text-sm",
          todo.done && "text-muted-foreground line-through",
        )}
      >
        {todo.title}
      </span>
      {todo.due_date && (
        <button
          onClick={() => onSetDue(todo.id, null)}
          title={t("Remove date", "Quitar fecha")}
          className={cn(
            "text-[10px]",
            overdue ? "font-semibold text-red-400" : "text-muted-foreground",
            isToday(new Date(todo.due_date + "T12:00:00")) &&
              "text-violet-400",
          )}
        >
          {format(new Date(todo.due_date + "T12:00:00"), "dd MMM")}
        </button>
      )}
      <input
        type="date"
        value={todo.due_date ?? ""}
        onChange={(e) => onSetDue(todo.id, e.target.value || null)}
        className={cn(
          "h-6 w-6 cursor-pointer rounded bg-transparent text-[0px] opacity-0 group-hover:opacity-100",
          "[&::-webkit-calendar-picker-indicator]:opacity-60",
        )}
        title={t("Set due date", "Fijar fecha límite")}
      />
      <button
        onClick={() => onToggleUrgent(todo.id, !todo.urgent)}
        title={t("Urgent", "Urgente")}
        className={cn(
          "rounded p-1",
          todo.urgent
            ? "text-red-400"
            : "text-muted-foreground opacity-0 group-hover:opacity-100",
        )}
      >
        <Flag className="size-3.5" fill={todo.urgent ? "currentColor" : "none"} />
      </button>
      <button
        onClick={() => onDelete(todo.id)}
        className="rounded p-1 text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
