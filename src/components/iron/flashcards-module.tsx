"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import type { Flashcard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/lang";

type Grade = "again" | "hard" | "good" | "easy";

/** SM-2 lite: returns updated scheduling fields for a graded card. */
function grade(card: Flashcard, g: Grade) {
  let { interval_days: interval, ease, reps } = card;
  if (g === "again") {
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    reps = 0;
  } else {
    const base = interval <= 0 ? 1 : interval;
    interval =
      g === "hard"
        ? Math.max(1, Math.round(base * 1.2))
        : g === "good"
          ? Math.round(base * ease)
          : Math.round(base * ease * 1.3);
    if (g === "hard") ease = Math.max(1.3, ease - 0.15);
    if (g === "easy") ease = ease + 0.15;
    reps += 1;
  }
  const next = new Date();
  next.setDate(next.getDate() + interval);
  return {
    interval_days: interval,
    ease: Math.round(ease * 100) / 100,
    reps,
    next_review: next.toISOString().slice(0, 10),
  };
}

export function FlashcardsModule({ userId }: { userId: string }) {
  const { t } = useT();
  const supabase = useMemo(() => createClient(), []);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [deck, setDeck] = useState<string>("General");
  const [reviewing, setReviewing] = useState<Flashcard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [newDeck, setNewDeck] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("flashcards")
      .select("*")
      .order("next_review");
    setCards((data as Flashcard[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
    void load();
    const ch = supabase
      .channel("flashcards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "flashcards" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, supabase]);

  const decks = useMemo(() => {
    const m = new Map<string, { total: number; due: number }>();
    const today = new Date().toISOString().slice(0, 10);
    for (const c of cards) {
      const acc = m.get(c.deck) ?? { total: 0, due: 0 };
      acc.total += 1;
      if (c.next_review <= today) acc.due += 1;
      m.set(c.deck, acc);
    }
    return [...m.entries()].sort();
  }, [cards]);

  const current = reviewing[0];

  function startReview(d: string) {
    const today = new Date().toISOString().slice(0, 10);
    setReviewing(
      cards.filter((c) => c.deck === d && c.next_review <= today),
    );
    setRevealed(false);
  }

  async function answer(g: Grade) {
    if (!current) return;
    await supabase
      .from("flashcards")
      .update(grade(current, g))
      .eq("id", current.id);
    setReviewing((q) => q.slice(1));
    setRevealed(false);
  }

  async function addCard() {
    if (!front.trim() || !back.trim()) return;
    await supabase.from("flashcards").insert({
      user_id: userId,
      deck: newDeck.trim() || deck,
      front: front.trim(),
      back: back.trim(),
    });
    setFront("");
    setBack("");
    setNewDeck("");
  }

  // ── Review mode ────────────────────────────────────────────────────
  if (current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-xs text-muted-foreground">
          {current.deck} · {reviewing.length} {t("left", "restantes")}
        </p>
        <button
          onClick={() => setRevealed((r) => !r)}
          className="flex min-h-48 w-full max-w-lg flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-8 text-center transition-colors hover:bg-accent/40"
        >
          <span className="text-lg font-medium">{current.front}</span>
          {revealed ? (
            <>
              <div className="h-px w-16 bg-border" />
              <span className="text-muted-foreground">{current.back}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground/60">
              {t("tap to reveal", "toca para revelar")}
            </span>
          )}
        </button>
        {revealed && (
          <div className="flex gap-2">
            {(
              [
                ["again", "#ca4d31", t("Again", "De nuevo")],
                ["hard", "#e0a458", t("Hard", "Difícil")],
                ["good", "#429a8e", t("Good", "Bien")],
                ["easy", "#828bc2", t("Easy", "Fácil")],
              ] as [Grade, string, string][]
            ).map(([g, color, label]) => (
              <Button
                key={g}
                variant="outline"
                onClick={() => void answer(g)}
                style={{ color, borderColor: color + "55" }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setReviewing([])}>
          {t("Exit review", "Salir del repaso")}
        </Button>
      </div>
    );
  }

  // ── Deck overview + add card ───────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold">Flashcards</h1>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {decks.map(([d, s]) => (
          <button
            key={d}
            onClick={() => {
              setDeck(d);
              if (s.due > 0) startReview(d);
            }}
            className={cn(
              "flex items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent/50",
              deck === d && "border-indigo-400/50",
            )}
          >
            <Brain className="size-5 text-indigo-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d}</p>
              <p className="text-xs text-muted-foreground">{s.total} {t("cards", "tarjetas")}</p>
            </div>
            {s.due > 0 ? (
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-400">
                <RotateCcw className="size-3" /> {s.due}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground/60">{t("up to date", "al día")}</span>
            )}
          </button>
        ))}
        {decks.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            {t("No decks yet — create your first card below.", "Sin mazos aún — crea tu primera tarjeta abajo.")}
          </p>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("New card", "Nueva tarjeta")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            value={newDeck}
            onChange={(e) => setNewDeck(e.target.value)}
            placeholder={t("Deck (empty = current)", "Mazo (vacío = actual)") + ` · ${deck}`}
            className="w-64"
          />
          <Textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder={t("Front — question or prompt", "Frente — pregunta o prompt")}
            rows={2}
          />
          <Textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            placeholder={t("Back — answer", "Reverso — respuesta")}
            rows={3}
          />
          <Button
            onClick={() => void addCard()}
            disabled={!front.trim() || !back.trim()}
            className="self-end"
          >
            <Plus className="size-4" /> {t("Add", "Agregar")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
