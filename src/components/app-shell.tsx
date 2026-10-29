"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  LogOut,
  Menu,
  Settings,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { CAPITALS, CAPITAL_LIST, type CapitalCategory } from "@/lib/capitals";
import { CAPITAL_MODULES, moduleKey, type ModuleId } from "@/lib/modules";
import { useT } from "@/lib/lang";
import { createClient } from "@/lib/supabase/client";
import { Dashboard } from "@/components/dashboard";
import { PhysicalPage } from "@/components/iron/physical-page";
import { FinanceModule } from "@/components/iron/finance-module";
import { SettingsDialog } from "@/components/settings-dialog";
import { cn } from "@/lib/utils";

const NAV_ORDER: CapitalCategory[] = [
  "physical",
  "productive",
  "social",
  "intellectual",
  "spiritual",
];

/** lighter shade of the capital color, for the active leaf pill */
function tint(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.25);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

export function AppShell({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const { t } = useT();
  const [active, setActive] = useState<ModuleId>("physical.diet");
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(["physical"]),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Module order per capital — persisted in localStorage
  const [order, setOrder] = useState<Record<CapitalCategory, string[]>>(() => {
    const o = {} as Record<CapitalCategory, string[]>;
    for (const capId of NAV_ORDER) {
      o[capId] = CAPITAL_MODULES[capId].map((m) => m.id);
    }
    return o;
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem("iron.sidebar.order");
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<CapitalCategory, string[]>>;
      queueMicrotask(() =>
        setOrder((prev) => {
          const next = { ...prev };
          for (const capId of NAV_ORDER) {
            const valid = prev[capId];
            const ids = Array.isArray(saved?.[capId]) ? saved[capId]! : [];
            next[capId] = [
              ...ids.filter((id) => valid.includes(id)),
              ...valid.filter((id) => !ids.includes(id)),
            ];
          }
          return next;
        }),
      );
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("iron.sidebar.order", JSON.stringify(order));
    } catch {}
  }, [order]);

  // Pointer-based drag reorder (mouse + touch)
  const dragRef = useRef<{ capital: CapitalCategory; id: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (!dragId) return;
    function move(e: globalThis.PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-mod]") as HTMLElement | null;
      const overId = el?.dataset.mod;
      if (!el || el.dataset.capital !== drag.capital || !overId || overId === drag.id)
        return;
      setOrder((prev) => {
        const list = [...prev[drag.capital]];
        const from = list.indexOf(drag.id);
        const to = list.indexOf(overId);
        if (from === -1 || to === -1) return prev;
        list.splice(to, 0, list.splice(from, 1)[0]);
        return { ...prev, [drag.capital]: list };
      });
    }
    function up() {
      dragRef.current = null;
      setDragId(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragId]);

  function startDrag(
    e: PointerEvent<HTMLSpanElement>,
    capital: CapitalCategory,
    id: string,
  ) {
    e.preventDefault();
    dragRef.current = { capital, id };
    setDragId(id);
  }

  // Ctrl/Cmd+B toggles the sidebar (desktop) or drawer (mobile)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) {
          setSidebarOpen((o) => !o);
        } else {
          setDrawerOpen((o) => !o);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleGroup(id: string) {
    setOpenGroups((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function selectModule(key: ModuleId) {
    setActive(key);
    setDrawerOpen(false);
  }

  const nav = (
    <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-2">
      {NAV_ORDER.map((capId) => {
        const cap = CAPITALS[capId];
        const modules = CAPITAL_MODULES[capId];
        const open = openGroups.has(cap.id);
        return (
          <div key={cap.id} className="mb-2">
            <button
              onClick={() => toggleGroup(cap.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-bold transition-colors",
                open ? "text-white" : "text-[#e7e9ee] hover:bg-[#242933]",
              )}
              style={open ? { backgroundColor: cap.color } : undefined}
            >
              <span className="text-[9px]">{open ? "▾" : "▸"}</span>
              {cap.short}
            </button>
            {open && (
              <div className="mt-1.5 flex flex-col gap-1 pl-3">
                {order[cap.id].map((modId) => {
                  const m = modules.find((mod) => mod.id === modId);
                  if (!m) return null;
                  const key = moduleKey(cap.id, m.id);
                  const isActive = active === key;
                  return (
                    <div
                      key={m.id}
                      data-mod={m.id}
                      data-capital={cap.id}
                      className={cn(
                        "flex items-center",
                        dragId === m.id && "opacity-40",
                      )}
                    >
                      <span
                        role="button"
                        aria-label={`Reorder ${m.label}`}
                        title={t("Drag to reorder", "Arrastra para reordenar")}
                        onPointerDown={(e) => startDrag(e, cap.id, m.id)}
                        className="cursor-grab touch-none rounded p-0.5 text-[#e7e9ee]/30 hover:text-[#e7e9ee]/70 active:cursor-grabbing"
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                      <button
                        onClick={() => selectModule(key)}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors",
                          isActive
                            ? "font-medium text-white"
                            : "text-[#e7e9ee] hover:bg-[#242933]",
                        )}
                        style={
                          isActive
                            ? { backgroundColor: tint(cap.color) }
                            : undefined
                        }
                      >
                        {t(
                          m.label,
                          m.id === "diet"
                            ? "Dieta"
                            : m.id === "time-manager"
                              ? "Gestor de tiempo"
                              : m.id === "finance"
                                ? "Finanzas"
                                : undefined,
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="p-3 pb-4 text-[13px] text-[#e7e9ee]">
      <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#242933]">
        <User className="size-4" />
        <span className="min-w-0 flex-1 truncate text-left">{email}</span>
      </button>
      <button
        onClick={() => setSettingsOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#242933]"
      >
        <Settings className="size-4" />
        {t("Settings", "Ajustes")}
      </button>
      <button
        onClick={() => void signOut()}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#242933]"
      >
        <LogOut className="size-4" />
        {t("Sign out", "Cerrar sesión")}
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-[#242424] md:flex-row">
      {/* ── Mobile top bar ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 bg-[#181b21] px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-1.5 text-[#e7e9ee] hover:bg-[#242933]"
          aria-label={t("Open menu", "Abrir menú")}
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-[#e7e9ee]">
          <TrendingUp className="size-4 text-[#3fb97f]" />
          IRON
        </div>
      </div>

      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      {sidebarOpen && (
        <aside className="hidden w-56 shrink-0 flex-col bg-[#181b21] md:flex">
          <div className="flex items-center gap-2 px-4 py-4 text-[15px] font-bold tracking-tight text-[#e7e9ee]">
            <TrendingUp className="size-5 text-[#3fb97f]" />
            <span className="min-w-0 flex-1">IRON Habit Tracker</span>
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Hide sidebar"
              title={t("Hide sidebar (Ctrl+B)", "Ocultar barra lateral (Ctrl+B)")}
              className="rounded-md p-1 text-[#e7e9ee]/70 hover:bg-[#242933] hover:text-[#e7e9ee]"
            >
              <ChevronsLeft className="size-4" />
            </button>
          </div>
          {nav}
          {footer}
        </aside>
      )}
      {!sidebarOpen && (
        <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 bg-[#181b21] py-3 md:flex">
          <TrendingUp className="size-5 text-[#3fb97f]" />
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Show sidebar"
            title={t("Show sidebar (Ctrl+B)", "Mostrar barra lateral (Ctrl+B)")}
            className="rounded-md p-1.5 text-[#e7e9ee] hover:bg-[#242933]"
          >
            <Menu className="size-5" />
          </button>
        </aside>
      )}

      {/* ── Mobile drawer ───────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[#181b21] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2 text-[15px] font-bold text-[#e7e9ee]">
                <TrendingUp className="size-5 text-[#3fb97f]" />
                IRON
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-1.5 text-[#e7e9ee] hover:bg-[#242933]"
                aria-label={t("Close menu", "Cerrar menú")}
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active === "productive.time-manager" ? (
          <Dashboard userId={userId} />
        ) : active === "physical.diet" ? (
          <PhysicalPage userId={userId} />
        ) : active === "productive.finance" ? (
          <FinanceModule userId={userId} />
        ) : (
          <ModulePlaceholder moduleId={active} />
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        userId={userId}
      />
    </div>
  );
}

function ModulePlaceholder({ moduleId }: { moduleId: ModuleId }) {
  const [capitalId, modId] = moduleId.split(".") as [
    keyof typeof CAPITAL_MODULES,
    string,
  ];
  const { t } = useT();
  const mod = CAPITAL_MODULES[capitalId]?.find((m) => m.id === modId);
  const cap = CAPITAL_LIST.find((c) => c.id === capitalId);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div
        className="flex size-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: (cap?.color ?? "#666") + "22" }}
      >
        {mod && <mod.icon className="size-7" style={{ color: cap?.color }} />}
      </div>
      <h2 className="text-lg font-semibold">{mod?.label}</h2>
      <p className="max-w-xs text-sm text-muted-foreground">
        {cap?.short} {t("module — coming soon.", "módulo — próximamente.")}
      </p>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
        <ChevronsRight className="size-3.5" />
        {t("capital", "capital")}: {capitalId}
      </span>
    </div>
  );
}
