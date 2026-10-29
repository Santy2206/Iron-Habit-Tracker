"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, TrendingDown, TrendingUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toISODay } from "@/lib/diet-engine";
import { DEFAULT_DIET, type DietPhase, type DietSettings } from "@/lib/types";
import { setLang, useT, type Lang } from "@/lib/lang";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

export function SettingsDialog({ open, onOpenChange, userId }: Props) {
  const supabase = createClient();
  const { lang, t } = useT();
  const [settings, setSettings] = useState<DietSettings | null>(null);
  const [phase, setPhase] = useState<DietPhase>("cut");
  const [heightCm, setHeightCm] = useState("");
  const [fatG, setFatG] = useState("");
  const fatTouched = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("diet_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const s = (data as DietSettings | null) ?? null;
    setSettings(s);
    setPhase(s?.phase ?? "cut");
    setHeightCm(s?.height_cm != null ? String(s.height_cm) : "");
    setFatG(s != null ? String(s.fat_g) : "");
    fatTouched.current = false;
  }, [supabase, userId]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
      void load();
      setSaved(false);
    }
  }, [open, load]);

  function onHeightChange(v: string) {
    setHeightCm(v);
    const h = parseFloat(v);
    if (!fatTouched.current && Number.isFinite(h) && h > 0) {
      setFatG(String(Math.round(h / 2.2)));
    }
  }

  async function save() {
    setSaving(true);
    const base = settings ?? { ...DEFAULT_DIET, user_id: userId };
    const h = parseFloat(heightCm);
    const f = parseFloat(fatG);
    await supabase.from("diet_settings").upsert({
      ...base,
      phase,
      height_cm: Number.isFinite(h) && h > 0 ? h : null,
      fat_g: Number.isFinite(f) ? f : base.fat_g,
      user_id: userId,
    });
    const newFat = Number.isFinite(f) ? f : base.fat_g;
    const { data: last } = await supabase
      .from("diet_history")
      .select("phase,calorie_intake,protein_g,carbs_g,fat_g")
      .eq("user_id", userId)
      .order("changed_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    const unchanged =
      last &&
      last.phase === phase &&
      Math.round(last.calorie_intake) === Math.round(base.calorie_intake) &&
      Math.round(last.protein_g) === Math.round(base.protein_g) &&
      Math.round(last.carbs_g) === Math.round(base.carbs_g) &&
      Math.round(last.fat_g) === Math.round(newFat);
    if (!unchanged) {
      await supabase.from("diet_history").insert({
        user_id: userId,
        changed_on: toISODay(new Date()),
        phase,
        calorie_intake: base.calorie_intake,
        protein_g: base.protein_g,
        carbs_g: base.carbs_g,
        fat_g: newFat,
      });
    }
    setSaving(false);
    setSaved(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Settings", "Ajustes")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>{t("Language", "Idioma")}</Label>
            <div className="mt-1 flex gap-2">
              {(
                [
                  ["en", "English"],
                  ["es", "Español"],
                ] as [Lang, string][]
              ).map(([l, name]) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
                    lang === l
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Languages className="size-4" />
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("Diet phase", "Fase de dieta")}</Label>
            <div className="mt-1 flex gap-2">
              {(["cut", "bulk"] as DietPhase[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm capitalize",
                    phase === p
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {p === "cut" ? (
                    <TrendingDown className="size-4" />
                  ) : (
                    <TrendingUp className="size-4" />
                  )}
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="set-height">{t("Height (cm)", "Altura (cm)")}</Label>
              <Input
                id="set-height"
                value={heightCm}
                onChange={(e) => onHeightChange(e.target.value)}
                inputMode="decimal"
                placeholder="175"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="set-fat">{t("Fat (g)", "Grasa (g)")}</Label>
              <Input
                id="set-fat"
                value={fatG}
                onChange={(e) => {
                  fatTouched.current = true;
                  setFatG(e.target.value);
                }}
                inputMode="decimal"
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(
              "Fat auto-estimates from height (cm ÷ 2.2) until you edit it manually. It stays fixed in Diet targets — carbs compensate to hit your calories.",
              "La grasa se estima desde la altura (cm ÷ 2.2) hasta que la edites. Queda fija en Diet targets — los carbs compensan para llegar a tus calorías.",
            )}
          </p>
        </div>
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-xs text-emerald-400">
              {t("Saved", "Guardado")}
            </span>
          )}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("Saving…", "Guardando…") : t("Save", "Guardar")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
