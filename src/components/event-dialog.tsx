"use client";

import { useState } from "react";
import { format } from "date-fns";
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
import { CAPITAL_LIST, type CapitalCategory } from "@/lib/capitals";
import type { CalendarEvent } from "@/lib/types";
import { useT } from "@/lib/lang";

export interface EventDraft {
  title: string;
  description: string;
  category: CapitalCategory;
  start: Date;
  end: Date;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** existing event -> edit mode; otherwise create */
  event?: CalendarEvent | null;
  initialStart?: Date | null;
  initialEnd?: Date | null;
  initialTitle?: string;
  initialCategory?: CapitalCategory | null;
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
}

function toLocalInput(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function EventDialog(props: Props) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Remount the form on every open so fields initialize from props */}
      {open && <EventForm key={props.event?.id ?? "new"} {...props} />}
    </Dialog>
  );
}

function EventForm({
  onOpenChange,
  event,
  initialStart,
  initialEnd,
  initialTitle,
  initialCategory,
  onSave,
  onDelete,
}: Props) {
  const { t } = useT();
  const [title, setTitle] = useState(event?.title ?? initialTitle ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [category, setCategory] = useState<CapitalCategory>(
    event?.category ?? initialCategory ?? "productive",
  );
  const [start, setStart] = useState(() => {
    const s = event ? new Date(event.start_at) : (initialStart ?? new Date());
    return toLocalInput(s);
  });
  const [end, setEnd] = useState(() => {
    const s = event ? new Date(event.start_at) : (initialStart ?? new Date());
    const e = event
      ? new Date(event.end_at)
      : (initialEnd ?? new Date(s.getTime() + 60 * 60_000));
    return toLocalInput(e);
  });

  function save() {
    const s = new Date(start);
    const e = new Date(end);
    if (!title.trim() || isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s)
      return;
    onSave({
      title: title.trim(),
      description,
      category,
      start: s,
      end: e,
    });
    onOpenChange(false);
  }

  return (
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? t("Edit block", "Editar bloque") : t("New block", "Nuevo bloque")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-title">{t("Title", "Título")}</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Deep work, Gym, Reading…", "Trabajo profundo, Gym, Lectura…")}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Capital", "Capital")}</Label>
            <div className="flex flex-wrap gap-2">
              {CAPITAL_LIST.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                    category === c.id
                      ? "border-transparent text-white"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  style={
                    category === c.id ? { backgroundColor: c.color } : undefined
                  }
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.short}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-start">{t("Start", "Inicio")}</Label>
              <Input
                id="ev-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-end">{t("End", "Fin")}</Label>
              <Input
                id="ev-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ev-desc">{t("Notes", "Notas")}</Label>
            <Textarea
              id="ev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <div>
            {event && onDelete && (
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
