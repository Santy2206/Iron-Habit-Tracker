"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { CapitalChip } from "@/components/capital-chip";
import { PRIORITY_META, type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

/**
 * Sidebar list of open tasks — drag one onto the calendar to time-block it.
 * Rendered inside the same DndContext as the WeekCalendar.
 */
export function UnscheduledTasks({ tasks }: { tasks: Task[] }) {
  const { t } = useT();
  const open = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const po = { urgent: 0, high: 1, medium: 2, low: 3 };
      return po[a.priority] - po[b.priority];
    });

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Unscheduled tasks", "Tareas sin agendar")}
        </h3>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {t("Drag a task onto the calendar", "Arrastra una tarea al calendario")}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {open.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            {t("No pending tasks.", "No hay tareas pendientes.")}
          </p>
        )}
        {open.map((t) => (
          <DraggableTask key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

function DraggableTask({ task }: { task: Task }) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `task:${task.id}`, data: { task } });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cn(
        "mb-2 cursor-grab rounded-md border border-border bg-background p-2 active:cursor-grabbing",
        isDragging && "z-50 opacity-80 ring-1 ring-violet-400",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <CapitalChip category={task.category} />
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: PRIORITY_META[task.priority].color }}
              title={
                {
                  low: t("Low", "Baja"),
                  medium: t("Medium", "Media"),
                  high: t("High", "Alta"),
                  urgent: t("Urgent", "Urgente"),
                }[task.priority]
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
