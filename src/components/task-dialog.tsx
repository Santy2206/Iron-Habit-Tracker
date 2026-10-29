"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAPITAL_LIST, type CapitalCategory } from "@/lib/capitals";
import {
  PRIORITY_META,
  TASK_COLUMNS,
  type Priority,
  type Subtask,
  type Task,
  type TaskStatus,
} from "@/lib/types";
import { useT } from "@/lib/lang";

export interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  category: CapitalCategory | null;
  due_date: string | null;
  labels: string[];
  subtasks: Subtask[];
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  task?: Task | null;
  /** used when creating a new task from a specific column */
  defaultStatus?: TaskStatus;
  onSave: (draft: TaskDraft) => void;
  onDelete?: () => void;
}

export function TaskDialog(props: Props) {
  const { open, onOpenChange, task } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Remount the form on every open so fields initialize from props */}
      {open && <TaskForm key={task?.id ?? "new"} {...props} />}
    </Dialog>
  );
}

function TaskForm({ onOpenChange, task, defaultStatus, onSave, onDelete }: Props) {
  const { t } = useT();
  const statusLabel = (id: TaskStatus) =>
    ({
      backlog: t("Backlog", "Backlog"),
      todo: t("To Do", "Por hacer"),
      in_progress: t("In Progress", "En progreso"),
      review: t("Review", "Revisión"),
      done: t("Done", "Hecho"),
    })[id];
  const prioLabel = (id: Priority) =>
    ({
      low: t("Low", "Baja"),
      medium: t("Medium", "Media"),
      high: t("High", "Alta"),
      urgent: t("Urgent", "Urgente"),
    })[id];
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status ?? defaultStatus ?? "backlog",
  );
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [category, setCategory] = useState<CapitalCategory | "none">(
    task?.category ?? "none",
  );
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [labels, setLabels] = useState((task?.labels ?? []).join(", "));
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks ?? []);
  const [newSub, setNewSub] = useState("");

  function save() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description,
      status,
      priority,
      category: category === "none" ? null : category,
      due_date: dueDate || null,
      labels: labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      subtasks,
    });
    onOpenChange(false);
  }

  function addSubtask() {
    const t = newSub.trim();
    if (!t) return;
    setSubtasks([...subtasks, { id: crypto.randomUUID(), title: t, done: false }]);
    setNewSub("");
  }

  return (
    <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t("Edit task", "Editar tarea") : t("New task", "Nueva tarea")}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-2 pr-1">
          <div className="grid gap-1.5">
            <Label>{t("Title", "Título")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("Status", "Estado")}</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_COLUMNS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {statusLabel(c.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("Priority", "Prioridad")}</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as Priority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(PRIORITY_META) as [
                      Priority,
                      { label: string; color: string },
                    ][]
                  ).map(([id, m]) => (
                    <SelectItem key={id} value={id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        {prioLabel(id)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("Capital", "Capital")}</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as CapitalCategory | "none")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("No capital", "Sin capital")}</SelectItem>
                  {CAPITAL_LIST.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.emoji} {c.short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("Due date", "Fecha límite")}</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Labels (comma-separated)", "Etiquetas (separadas por coma)")}</Label>
            <Input
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="cliente-x, sprint-3"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Description", "Descripción")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Subtasks", "Subtareas")}</Label>
            {subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.done}
                  onChange={(e) =>
                    setSubtasks(
                      subtasks.map((x) =>
                        x.id === s.id ? { ...x, done: e.target.checked } : x,
                      ),
                    )
                  }
                  className="accent-violet-500"
                />
                <span
                  className={
                    s.done
                      ? "flex-1 text-sm line-through text-muted-foreground"
                      : "flex-1 text-sm"
                  }
                >
                  {s.title}
                </span>
                <button
                  onClick={() =>
                    setSubtasks(subtasks.filter((x) => x.id !== s.id))
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder={t("Add subtask…", "Agregar subtarea…")}
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addSubtask}>
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {task && onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete}>
                {t("Delete", "Eliminar")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancel", "Cancelar")}
            </Button>
            <Button onClick={save}>{t("Save", "Guardar")}</Button>
          </div>
        </DialogFooter>
    </DialogContent>
  );
}
