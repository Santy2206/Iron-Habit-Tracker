"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { CalendarClock, MoreHorizontal, Plus } from "lucide-react";
import { CapitalChip } from "@/components/capital-chip";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRIORITY_META,
  TASK_COLUMNS,
  type Task,
  type TaskStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

interface Props {
  tasks: Task[];
  onMove: (taskId: string, status: TaskStatus, position: number) => void;
  onNewTask: (status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onSchedule: (task: Task) => void;
}

export function KanbanBoard({
  tasks,
  onMove,
  onNewTask,
  onEditTask,
  onSchedule,
}: Props) {
  const { t } = useT();
  const colLabel = (id: TaskStatus, label: string) =>
    ({
      backlog: t("Backlog", "Backlog"),
      todo: t("To Do", "Por hacer"),
      in_progress: t("In Progress", "En progreso"),
      review: t("Review", "Revisión"),
      done: t("Done", "Hecho"),
    })[id] ?? label;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  function handleStart(e: DragStartEvent) {
    const t = tasks.find((x) => x.id === e.active.id);
    setActiveTask(t ?? null);
  }

  function handleEnd(e: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);

    // dropped on a column or on another card
    const overCol = TASK_COLUMNS.find((c) => `col:${c.id}` === overId)?.id;
    const overTask = tasks.find((t) => t.id === overId);
    const targetStatus: TaskStatus | undefined =
      overCol ?? overTask?.status;
    if (!targetStatus) return;

    const colTasks = tasks
      .filter((t) => t.status === targetStatus && t.id !== taskId)
      .sort((a, b) => a.position - b.position);

    let position = colTasks.length;
    if (overTask) {
      const idx = colTasks.findIndex((t) => t.id === overTask.id);
      position = idx === -1 ? colTasks.length : idx;
    }
    onMove(taskId, targetStatus, position);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
    >
      <div className="grid flex-1 grid-cols-5 gap-3 overflow-x-auto">
        {TASK_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={colLabel(col.id, col.label)}
            tasks={tasks
              .filter((t) => t.status === col.id)
              .sort((a, b) => a.position - b.position)}
            onNewTask={onNewTask}
            onEditTask={onEditTask}
            onSchedule={onSchedule}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCardView task={activeTask} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  id,
  label,
  tasks,
  onNewTask,
  onEditTask,
  onSchedule,
}: {
  id: TaskStatus;
  label: string;
  tasks: Task[];
  onNewTask: (s: TaskStatus) => void;
  onEditTask: (t: Task) => void;
  onSchedule: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}` });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-40 min-w-52 flex-col rounded-lg border border-border bg-card/60 p-2 transition-colors",
        isOver && "ring-1 ring-violet-400",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{label}</span>
          <Badge variant="secondary" className="px-1.5 text-[10px]">
            {tasks.length}
          </Badge>
        </div>
        <button
          onClick={() => onNewTask(id)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-16 flex-1 flex-col gap-2">
          {tasks.map((t) => (
            <SortableTaskCard
              key={t.id}
              task={t}
              onEdit={onEditTask}
              onSchedule={onSchedule}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTaskCard({
  task,
  onEdit,
  onSchedule,
}: {
  task: Task;
  onEdit: (t: Task) => void;
  onSchedule: (t: Task) => void;
}) {
  const { t: tr } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(isDragging && "opacity-40")}
    >
      <TaskCardView
        task={task}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(task)}>
                {tr("Edit", "Editar")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSchedule(task)}>
                <CalendarClock className="mr-2 size-3.5" />
                {tr("Schedule on calendar", "Agendar en el calendario")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  );
}

function TaskCardView({
  task,
  menu,
  dragging,
}: {
  task: Task;
  menu?: React.ReactNode;
  dragging?: boolean;
}) {
  const { t } = useT();
  const prioLabel = (id: Task["priority"], label: string) =>
    ({
      low: t("Low", "Baja"),
      medium: t("Medium", "Media"),
      high: t("High", "Alta"),
      urgent: t("Urgent", "Urgente"),
    })[id] ?? label;
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const p = PRIORITY_META[task.priority];

  return (
    <div
      className={cn(
        "cursor-grab rounded-md border border-border bg-background p-2.5 shadow-sm active:cursor-grabbing",
        dragging && "ring-1 ring-violet-400",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium leading-snug">{task.title}</span>
        {menu}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CapitalChip category={task.category} />
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
          style={{ backgroundColor: p.color + "26", color: p.color }}
        >
          {prioLabel(task.priority, p.label)}
        </span>
        {task.subtasks.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {doneSubs}/{task.subtasks.length} ✓
          </span>
        )}
        {task.due_date && (
          <span className="text-[10px] text-muted-foreground">
            📅 {task.due_date.slice(5)}
          </span>
        )}
      </div>
      {task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span
              key={l}
              className="rounded bg-accent px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
