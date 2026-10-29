"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  Circle,
  CircleDot,
  ChevronRight,
  CreditCard,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import type {
  Account,
  BudgetSplit,
  Category,
  Debt,
  FoodItem,
  FoodPurchase,
  MonthlyBudgetRow,
  MonthlyCommitment,
  SavingsAccount,
  SavingsGoal,
  SavingsProgressRow,
  SavingsSource,
  Transaction,
} from "@/lib/types";
import { useT } from "@/lib/lang";
import { cn } from "@/lib/utils";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const fmtMonth = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);

/** Suma de precios a mano: "5200+2600+13500", "11.500", "2,600" → número.
 *  Misma lógica que parsing.parse_price_expression de la app Python. */
function parsePriceExpression(expr: string): number | null {
  let total = 0;
  for (const raw of expr.split("+")) {
    const s = raw.replace(/[\s$]/g, "");
    if (!s) return null;
    let v: number;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s))
      v = parseFloat(s.replace(/\./g, "").replace(",", "."));
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s))
      v = parseFloat(s.replace(/,/g, ""));
    else if (/^\d+([.,]\d{1,2})?$/.test(s))
      v = parseFloat(s.replace(",", "."));
    else return null;
    if (!(v > 0)) return null;
    total += v;
  }
  return total;
}

/** Formatea con puntos de miles mientras se escribe: 350000 → "350.000".
 *  En expresiones con "+" formatea cada operando por separado. */
const fmtAmt = (v: string) =>
  v
    .split("+")
    .map((s) =>
      s.replace(/[^\d]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, "."),
    )
    .join("+");

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Tags internos en la nota de una deuda (| prev:expense, | split:12345) —
// metadata de maquina que nunca se muestra ni se edita como texto.
const MACHINE_TAG_RE = /\s*\|\s*(prev|split):[0-9A-Za-z.]+/g;
const cleanDebtNote = (note: string | null | undefined) =>
  (note ?? "").replace(MACHINE_TAG_RE, "").trim();

interface NewTx {
  account_id: string;
  occurred_at: string;
  direction: "in" | "out";
  amount: number;
  counterparty: string | null;
  type: string;
  category_id: string | null;
  needs_review: boolean;
  /** Si viene, la otra mitad queda como deuda de esta persona. */
  splitWith?: string;
}

export function FinanceModule({ userId }: { userId: string }) {
  const { t } = useT();
  const supabase = useMemo(() => createClient(), []);
  const [budget, setBudget] = useState<MonthlyBudgetRow[]>([]);
  const [savings, setSavings] = useState<SavingsProgressRow[]>([]);
  const [review, setReview] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [purchases, setPurchases] = useState<FoodPurchase[]>([]);
  const [monthTx, setMonthTx] = useState<Transaction[]>([]);
  const [commitments, setCommitments] = useState<MonthlyCommitment[]>([]);
  const [savingsTx, setSavingsTx] = useState<Transaction[]>([]);
  const [incomeTx, setIncomeTx] = useState<Transaction[]>([]);
  const [sources, setSources] = useState<SavingsSource[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [split, setSplit] = useState<BudgetSplit | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const load = useCallback(async () => {
    const start = monthKey(month);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const endKey = monthKey(end);
    const [mb, sp, rv, cat, acc, fi, fp, tx, cm, st, it, ss, db, bs] =
      await Promise.all([
      supabase.from("monthly_budget").select("*").order("month"),
      supabase.from("savings_progress").select("*").order("month"),
      supabase
        .from("transactions_budgeted")
        .select(
          "id,account_id,occurred_at,direction,amount,type,category_id,counterparty,description,label,original_amount,source,raw_text,needs_review,real_month,budget_month",
        )
        .eq("needs_review", true)
        .order("occurred_at", { ascending: false }),
      supabase.from("categories").select("id,name,bucket").order("name"),
      supabase.from("accounts").select("id,name,role").order("name"),
      supabase
        .from("food_items")
        .select("id,name,group_name,sort_order,active")
        .eq("active", true)
        .order("group_name")
        .order("sort_order"),
      supabase
        .from("food_purchases")
        .select("id,item_id,purchased_at,amount,expression,note,paid_cash,transaction_id")
        .order("purchased_at", { ascending: false }),
      supabase
        .from("transactions_budgeted")
        .select(
          "id,account_id,occurred_at,direction,amount,type,category_id,counterparty,description,label,original_amount,source,raw_text,needs_review,real_month,budget_month",
        )
        .or(
          `and(occurred_at.gte.${start},occurred_at.lt.${endKey}),budget_month.eq.${start}`,
        )
        .order("occurred_at", { ascending: false }),
      supabase
        .from("monthly_commitments")
        .select("id,name,direction,pattern,expected_amount,sort_order,counts_as_savings")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("transactions_budgeted")
        .select(
          "id,account_id,occurred_at,direction,amount,type,category_id,counterparty,description,label,original_amount,source,raw_text,needs_review,real_month,budget_month",
        )
        .in("type", ["savings", "savings_withdrawal"])
        .order("occurred_at", { ascending: false }),
      supabase
        .from("transactions_budgeted")
        .select(
          "id,account_id,occurred_at,direction,amount,type,category_id,counterparty,description,label,original_amount,source,raw_text,needs_review,real_month,budget_month",
        )
        .eq("direction", "in")
        .in("type", ["income", "interest", "sponsorship", "debt_repayment", "family_savings"])
        .order("occurred_at", { ascending: false }),
      supabase
        .from("savings_sources")
        .select(
          "id,name,kind,direction,principal,rate_pct,expected_monthly,pattern,active,note,sort_order,created_at",
        )
        .order("sort_order"),
      supabase
        .from("debts")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("budget_split").select("*").eq("id", true).single(),
    ]);
    setSplit((bs.data as BudgetSplit | null) ?? null);
    setDebts((db.data as Debt[] | null) ?? []);
    setSources((ss.data as SavingsSource[] | null) ?? []);
    setCommitments((cm.data as MonthlyCommitment[] | null) ?? []);
    setSavingsTx((st.data as Transaction[] | null) ?? []);
    setIncomeTx((it.data as Transaction[] | null) ?? []);
    setBudget((mb.data as MonthlyBudgetRow[] | null) ?? []);
    setSavings((sp.data as SavingsProgressRow[] | null) ?? []);
    setReview((rv.data as Transaction[] | null) ?? []);
    setCategories((cat.data as Category[] | null) ?? []);
    setAccounts((acc.data as Account[] | null) ?? []);
    setFoodItems((fi.data as FoodItem[] | null) ?? []);
    setPurchases((fp.data as FoodPurchase[] | null) ?? []);
    setMonthTx((tx.data as Transaction[] | null) ?? []);
  }, [supabase, month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState happens after await
    void load();
    const ch = supabase
      .channel("finance")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "food_purchases" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "food_items" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "savings_sources" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "debts" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_split" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, supabase]);

  const shiftMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const markNotMine = async (id: string) => {
    await supabase
      .from("transactions")
      .update({ type: "pass_through", category_id: null, needs_review: false })
      .eq("id", id);
  };

  const TX_FIELDS =
    "id,account_id,occurred_at,direction,amount,type,category_id,counterparty,description,label,original_amount,source,raw_text,needs_review,real_month,budget_month";

  // Candidatos a contraparte de una transferencia interna: otra cuenta,
  // direccion opuesta, sin pareja, dentro de ±7 dias.
  const findPairCandidates = async (t: Transaction) => {
    const ms = new Date(t.occurred_at).getTime();
    const { data } = await supabase
      .from("transactions")
      .select(TX_FIELDS)
      .neq("account_id", t.account_id)
      .neq("direction", t.direction)
      .is("paired_with", null)
      .gte("occurred_at", new Date(ms - 7 * 86400e3).toISOString())
      .lte("occurred_at", new Date(ms + 7 * 86400e3).toISOString())
      .limit(50);
    return ((data ?? []) as Transaction[]).sort(
      (a, b) =>
        Math.abs(a.amount - t.amount) - Math.abs(b.amount - t.amount) ||
        Math.abs(new Date(a.occurred_at).getTime() - ms) -
          Math.abs(new Date(b.occurred_at).getTime() - ms),
    );
  };

  const markInternal = async (id: string, otherId: string | null) => {
    await supabase
      .from("transactions")
      .update({
        type: "internal_transfer",
        category_id: null,
        needs_review: false,
        paired_with: otherId,
      })
      .eq("id", id);
    if (otherId)
      await supabase
        .from("transactions")
        .update({
          type: "internal_transfer",
          category_id: null,
          needs_review: false,
          paired_with: id,
        })
        .eq("id", otherId);
  };

  // Renombrar un deudor actualiza todas sus deudas -> fusiona grupos
  const renameDebtor = async (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from) return;
    await supabase
      .from("debts")
      .update({ counterparty: name })
      .eq("counterparty", from);
  };

  const saveDebt = async (d: Partial<Debt> & { id?: string }) => {
    const { id, ...fields } = d;
    if (id) await supabase.from("debts").update(fields).eq("id", id);
    else await supabase.from("debts").insert(fields);
  };

  const catName = (id?: string | null) =>
    id ? categories.find((c) => c.id === id)?.name : undefined;

  // La deuda pagada con tarjeta de credito vuelve a pagar la tarjeta,
  // no a la cuenta de ahorros -> no cuenta en el global savings.
  const isCredit = (accountId?: string | null) =>
    !!accountId && accounts.find((a) => a.id === accountId)?.role === "credit";

  // Favor: salio plata mia por alguien -> no es gasto, es plata que me deben
  const markFavor = async (t: Transaction, who: string) => {
    await markNotMine(t.id);
    await supabase.from("debts").insert({
      counterparty: who.trim() || t.counterparty || "Alguien",
      direction: "owed_to_me",
      amount: t.amount,
      tx_id: t.id,
      ref: catName(t.category_id) ?? "Favor",
      exclude_from_savings: isCredit(t.account_id),
    });
  };

  // Categoria "Pet": la mitad del gasto la pone Daniela -> crea deuda
  // automatica. Se evita duplicar si la transaccion ya tiene deuda ligada.
  const maybePetDebt = async (
    tx: { id: string; amount: number; account_id?: string } | undefined,
    categoryId: string | null | undefined,
  ) => {
    const petId = categories.find((c) => c.name === "Pet")?.id;
    if (!petId || !tx || categoryId !== petId) return;
    const { data: existing } = await supabase
      .from("debts")
      .select("id")
      .eq("tx_id", tx.id)
      .limit(1);
    if (existing?.length) return;
    await supabase.from("debts").insert({
      counterparty: "Daniela Bella",
      direction: "owed_to_me",
      amount: Math.round(tx.amount / 2),
      tx_id: tx.id,
      note: "Pet expense share",
      ref: "Pet",
      exclude_from_savings: isCredit(tx.account_id),
    });
  };

  // Split en gasto existente: "theirShare" pasa a deuda. Si cubre el total,
  // la tx sale del bucket como pass_through (compra ajena) y todo es deuda.
  // Reversible: deuda parcial restaura el monto; deuda total restaura el
  // tipo original guardado en la nota. Deudas "Pet" no tocaron el monto.
  const toggleSplit = async (
    t: Transaction,
    who: string,
    theirShare?: number,
    ref?: string,
  ) => {
    const existing = debts.find(
      (d) => d.tx_id === t.id && d.status === "open",
    );
    if (existing) {
      const prev = existing.note?.match(/prev:(\w+)/)?.[1];
      const upd: Record<string, unknown> = { original_amount: null };
      if (prev) {
        upd.type = prev;
      } else {
        // El monto original vive en la tx (original_amount); los tags en la
        // nota quedan como fallback para deudas viejas.
        const orig =
          t.original_amount ??
          (Number(existing.note?.match(/split:(\d+)/)?.[1]) ||
            (/compartido|shared/i.test(existing.note ?? "")
              ? t.amount + existing.amount
              : null));
        if (orig) upd.amount = orig;
      }
      await supabase.from("transactions").update(upd).eq("id", t.id);
      await supabase.from("debts").delete().eq("id", existing.id);
      return;
    }
    const share = theirShare ?? Math.round(t.amount / 2);
    if (share >= t.amount) {
      await supabase
        .from("transactions")
        .update({ type: "pass_through", original_amount: t.amount })
        .eq("id", t.id);
      await supabase.from("debts").insert({
        counterparty: who.trim() || "Daniela Bella",
        direction: "owed_to_me",
        amount: t.amount,
        tx_id: t.id,
        note: `Full debt | prev:${t.type}`,
        ref: ref?.trim() || catName(t.category_id),
        exclude_from_savings: isCredit(t.account_id),
      });
      return;
    }
    await supabase
      .from("transactions")
      .update({ amount: t.amount - share, original_amount: t.amount })
      .eq("id", t.id);
    await supabase.from("debts").insert({
      counterparty: who.trim() || "Daniela Bella",
      direction: "owed_to_me",
      amount: share,
      tx_id: t.id,
      note: `Shared expense share | split:${t.amount}`,
      ref: ref?.trim() || catName(t.category_id),
      exclude_from_savings: isCredit(t.account_id),
    });
  };

  // Alta manual de un movimiento. apply_rules() puede reclasificar en el
  // insert, asi que la eleccion del usuario se re-aplica con un update.
  const addTx = async (f: NewTx) => {
    // split: el gasto registrado es solo mi mitad; la otra mitad es deuda
    const myShare = f.splitWith ? Math.round(f.amount / 2) : f.amount;
    const { data } = await supabase
      .from("transactions")
      .insert({
        account_id: f.account_id,
        occurred_at: f.occurred_at,
        direction: f.direction,
        amount: myShare,
        original_amount: f.splitWith ? f.amount : null,
        counterparty: f.counterparty,
        description: f.counterparty,
        source: "manual",
        dedupe_hash: `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      })
      .select("id")
      .single();
    if (!data) return;
    await supabase
      .from("transactions")
      .update({
        type: f.type,
        category_id: f.category_id,
        needs_review: f.needs_review,
      })
      .eq("id", data.id);
    if (f.splitWith) {
      await supabase.from("debts").insert({
        counterparty: f.splitWith,
        direction: "owed_to_me",
        amount: f.amount - myShare,
        tx_id: data.id,
        note: `Shared expense half | split:${f.amount}`,
        ref: catName(f.category_id),
        exclude_from_savings: isCredit(f.account_id),
      });
    } else {
      await maybePetDebt(
        { id: data.id, amount: myShare, account_id: f.account_id },
        f.category_id,
      );
    }
  };

  // Repago: entro plata que salda una deuda -> pass_through + cierra la deuda
  const markRepayment = async (t: Transaction, debtId: string) => {
    await markNotMine(t.id);
    await supabase
      .from("debts")
      .update({
        status: "settled",
        settled_at: new Date().toISOString(),
        repaid_tx_id: t.id,
      })
      .eq("id", debtId);
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{t("Finance", "Finanzas")}</h1>
        {review.length > 0 && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/50 text-amber-400"
          >
            <AlertTriangle className="size-3" />
            {review.length} {t("to review", "por revisar")}
          </Badge>
        )}
      </div>

      <Tabs defaultValue="resumen" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="resumen">{t("Overview", "Resumen")}</TabsTrigger>
          <TabsTrigger value="revision">{t("Review", "Revisión")}</TabsTrigger>
          <TabsTrigger value="comida">{t("Food", "Comida")}</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="min-h-0 flex-1">
          <Resumen
            budget={budget}
            savings={savings}
            transactions={monthTx}
            commitments={commitments}
            savingsTx={savingsTx}
            incomeTx={incomeTx}
            sources={sources}
            debts={debts}
            split={split}
            onSaveSplit={async (fields) => {
              await supabase
                .from("budget_split")
                .update({ ...fields, updated_at: new Date().toISOString() })
                .eq("id", true);
            }}
            categories={categories}
            accounts={accounts}
            month={month}
            onShift={shiftMonth}
            onNotMine={markNotMine}
            onEditTx={async (id, fields) => {
              await supabase.from("transactions").update(fields).eq("id", id);
              const tx =
                monthTx.find((t) => t.id === id) ??
                review.find((t) => t.id === id) ??
                savingsTx.find((t) => t.id === id) ??
                incomeTx.find((t) => t.id === id);
              await maybePetDebt(tx, fields.category_id);
            }}
            onAddTx={addTx}
            onSplitTx={toggleSplit}
            onSaveSource={async (s) => {
              const { id, ...fields } = s;
              let srcId = id;
              if (srcId)
                await supabase
                  .from("savings_sources")
                  .update(fields)
                  .eq("id", srcId);
              else {
                const { data: ins } = await supabase
                  .from("savings_sources")
                  .insert(fields)
                  .select("id")
                  .single();
                srcId = ins?.id;
              }
              // Auto-vincular al Global savings: si la fuente tiene capital
              // o patron y aun no tiene cuenta, se crea una ligada a ella.
              if (!srcId || !split) return;
              const linked = (split.baseline_accounts ?? []).some(
                (a) => a.source_id === srcId,
              );
              const principal = Number(fields.principal) || 0;
              if (!linked && srcId && (principal > 0 || fields.pattern)) {
                const next = [
                  // antes de la cuenta comodin ".*" para que atrape primero
                  ...(split.baseline_accounts ?? []).filter(
                    (a) => a.pattern !== ".*",
                  ),
                  {
                    label: fields.name ?? t("Account", "Cuenta"),
                    amount: principal,
                    source_id: srcId,
                  },
                  ...(split.baseline_accounts ?? []).filter(
                    (a) => a.pattern === ".*",
                  ),
                ];
                await supabase
                  .from("budget_split")
                  .update({ baseline_accounts: next })
                  .eq("id", true);
              }
            }}
            onDeleteSource={async (id) => {
              await supabase.from("savings_sources").delete().eq("id", id);
              // La cuenta auto-vinculada tambien sale del Global savings —
              // borrar la fuente = que no cuente en ningun lado.
              if (split?.baseline_accounts?.some((a) => a.source_id === id)) {
                await supabase
                  .from("budget_split")
                  .update({
                    baseline_accounts: split.baseline_accounts.filter(
                      (a) => a.source_id !== id,
                    ),
                  })
                  .eq("id", true);
              }
            }}
            onSaveDebt={saveDebt}
            onRenameDebtor={renameDebtor}
            onDeleteDebt={async (id) => {
              const d = debts.find((x) => x.id === id);
              await supabase.from("debts").delete().eq("id", id);
              // Deuda "total" borrada desde la lista: la tx ligada vuelve a
              // ser gasto (su tipo original esta guardado en la nota).
              const prev = d?.note?.match(/prev:(\w+)/)?.[1];
              if (d?.tx_id && prev)
                await supabase
                  .from("transactions")
                  .update({ type: prev, original_amount: null })
                  .eq("id", d.tx_id);
              else if (d?.tx_id) {
                // split parcial borrado: restaurar el monto original
                const src = monthTx.find((t) => t.id === d.tx_id);
                await supabase
                  .from("transactions")
                  .update({
                    amount: src?.original_amount ?? src?.amount,
                    original_amount: null,
                  })
                  .eq("id", d.tx_id);
              }
            }}
          />
        </TabsContent>
        <TabsContent value="revision" className="min-h-0 flex-1">
          <Revision
            rows={review}
            month={month}
            onShift={shiftMonth}
            categories={categories}
            accounts={accounts}
            debts={debts}
            onFavor={markFavor}
            onRepayment={markRepayment}
            onClassify={async (id, categoryId) => {
              // El bucket de la categoria define el tipo: savings_* o expense
              const bucket = categories.find(
                (c) => c.id === categoryId,
              )?.bucket;
              const type =
                bucket === "savings"
                  ? "savings"
                  : bucket === "none"
                    ? "income"
                    : "expense";
              await supabase
                .from("transactions")
                .update({ category_id: categoryId, type, needs_review: false })
                .eq("id", id);
              await maybePetDebt(
                review.find((t) => t.id === id) ?? monthTx.find((t) => t.id === id),
                categoryId,
              );
            }}
            onNotMine={markNotMine}
            onFindPairs={findPairCandidates}
            onMarkInternal={markInternal}
          />
        </TabsContent>
        <TabsContent value="comida" className="min-h-0 flex-1">
          <Comida
            items={foodItems}
            purchases={purchases}
            month={month}
            onShift={shiftMonth}
            onAddPurchase={async (item, expression, day, amount) => {
              // Nota de comida en efectivo → transaccion real en Efectivo
              // (la regla 'comida' la categoriza a Mercado automaticamente).
              let transactionId: string | null = null;
              const cash = accounts.find((a) => a.name === "Efectivo");
              if (cash) {
                const { data } = await supabase
                  .from("transactions")
                  .insert({
                    account_id: cash.id,
                    occurred_at: `${day}T12:00:00-05:00`,
                    direction: "out",
                    amount,
                    counterparty: item.name,
                    description: `Food: ${item.name}`,
                    source: "manual",
                    dedupe_hash: `food:${crypto.randomUUID()}`,
                  })
                  .select("id")
                  .single();
                transactionId = data?.id ?? null;
              }
              await supabase.from("food_purchases").insert({
                item_id: item.id,
                purchased_at: day,
                amount,
                expression,
                paid_cash: true,
                transaction_id: transactionId,
              });
            }}
            onRemovePurchase={async (p) => {
              if (p.transaction_id)
                await supabase
                  .from("transactions")
                  .delete()
                  .eq("id", p.transaction_id);
              await supabase.from("food_purchases").delete().eq("id", p.id);
            }}
            onAddItem={async (name, group) => {
              await supabase
                .from("food_items")
                .insert({ name, group_name: group, sort_order: 99 });
            }}
            onUpdateItem={async (id, name, group) => {
              await supabase
                .from("food_items")
                .update({ name, group_name: group })
                .eq("id", id);
            }}
            onDeleteItem={async (id) => {
              await supabase.from("food_items").delete().eq("id", id);
            }}
          />
        </TabsContent>
      </Tabs>
      <span className="hidden">{userId}</span>
    </div>
  );
}

// ── Resumen: buckets 50/30/20 vs actuals + savings progress ───────────────────

function Resumen({
  budget,
  savings,
  transactions,
  commitments,
  savingsTx,
  incomeTx,
  sources,
  debts,
  split,
  onSaveSplit,
  categories,
  accounts,
  month,
  onShift,
  onNotMine,
  onEditTx,
  onAddTx,
  onRenameDebtor,
  onSplitTx,
  onSaveSource,
  onDeleteSource,
  onSaveDebt,
  onDeleteDebt,
}: {
  budget: MonthlyBudgetRow[];
  savings: SavingsProgressRow[];
  transactions: Transaction[];
  commitments: MonthlyCommitment[];
  savingsTx: Transaction[];
  incomeTx: Transaction[];
  sources: SavingsSource[];
  debts: Debt[];
  split: BudgetSplit | null;
  onSaveSplit: (fields: Partial<BudgetSplit>) => Promise<void>;
  categories: Category[];
  accounts: Account[];
  month: Date;
  onShift: (d: number) => void;
  onNotMine: (id: string) => Promise<void>;
  onEditTx: (
    id: string,
    fields: {
      counterparty?: string | null;
      category_id?: string | null;
      label?: string | null;
      occurred_at?: string;
    },
  ) => Promise<void>;
  onAddTx: (f: NewTx) => Promise<void>;
  onSplitTx: (
    t: Transaction,
    who: string,
    theirShare?: number,
    ref?: string,
  ) => Promise<void>;
  onSaveSource: (s: Partial<SavingsSource> & { id?: string }) => Promise<void>;
  onDeleteSource: (id: string) => Promise<void>;
  onSaveDebt: (d: Partial<Debt> & { id?: string }) => Promise<void>;
  onRenameDebtor: (from: string, to: string) => Promise<void>;
  onDeleteDebt: (id: string) => Promise<void>;
}) {
  const { t, locale } = useT();
  type OpenLog =
    | "needs"
    | "wants"
    | "savings"
    | "income"
    | "interest"
    | "sponsorship"
    | "debt_repayment"
    | "family_savings";
  const [open, setOpen] = useState<Set<OpenLog>>(new Set());
  const [allocOpen, setAllocOpen] = useState(false);
  const [fNeeds, setFNeeds] = useState("");
  const [fWants, setFWants] = useState("");
  const [fSavings, setFSavings] = useState("");
  const key = monthKey(month);
  const row = budget.find((b) => b.month.slice(0, 10) === key);
  const prog = savings.filter((s) => s.month.slice(0, 10) <= key).pop();
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const incomeTypes = [
    "income",
    "interest",
    "sponsorship",
    "debt_repayment",
    "family_savings",
  ];
  const toggle = (b: OpenLog) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });

  // Drag & drop entre buckets: cae en categoria por defecto del bucket destino
  const moveToBucket = (id: string, bucket: "needs" | "wants") => {
    const tx = transactions.find((t) => t.id === id);
    if (!tx || tx.direction !== "out" || tx.type !== "expense") return;
    if (catById.get(tx.category_id ?? "")?.bucket === bucket) return;
    const preferred = bucket === "needs" ? "Groceries" : "Other wants";
    const target =
      categories.find((c) => c.bucket === bucket && c.name === preferred) ??
      categories.find((c) => c.bucket === bucket);
    if (target) void onEditTx(id, { category_id: target.id });
  };

  const logFor = (b: OpenLog) => (
    <BucketLog
      key={b}
      bucket={b}
      transactions={transactions.filter(
        (t) =>
          attrMonth(t) === key &&
          (incomeTypes.includes(b)
            ? t.direction === "in" &&
              (b === "interest"
                ? t.type === "interest" || t.type === "family_savings"
                : t.type === b)
            : b === "savings"
              ? t.type === "savings" ||
                t.type === "savings_withdrawal" ||
                catById.get(t.category_id ?? "")?.bucket === "savings"
              : t.type === "expense" &&
                catById.get(t.category_id ?? "")?.bucket === b),
      )}
      inflow={incomeTypes.includes(b)}
      catById={catById}
      categories={categories}
      accounts={accounts}
      onNotMine={onNotMine}
      onEdit={onEditTx}
      splitDebts={debts}
      onSplit={onSplitTx}
      onRenameDebtor={onRenameDebtor}
    />
  );

  return (
    <Card className="h-full overflow-y-auto">
      <CardHeader className="grid-cols-[auto_1fr_auto] items-center pb-2">
        <Button size="icon" variant="ghost" onClick={() => onShift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <CardTitle className="min-w-0 truncate justify-self-center text-center text-base capitalize">
          {fmtMonth(month, locale)}
        </CardTitle>
        <Button size="icon" variant="ghost" onClick={() => onShift(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!row ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("No activity this month.", "Sin actividad este mes.")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <MoneyStat label={t("Income", "Ingresos")} value={row.income} />
              {row.interest_income + row.family_savings_income > 0 && (
                <StatButton
                  selected={open.has("interest")}
                  onClick={() => toggle("interest")}
                >
                  <MoneyStat
                    label={t("Interest", "Intereses")}
                    value={row.interest_income + row.family_savings_income}
                  />
                </StatButton>
              )}
              {row.sponsorship_income > 0 && (
                <StatButton
                  selected={open.has("sponsorship")}
                  onClick={() => toggle("sponsorship")}
                >
                  <MoneyStat label={t("Sponsorship", "Patrocinio")} value={row.sponsorship_income} />
                </StatButton>
              )}
              {row.debt_repayment_income > 0 && (
                <StatButton
                  selected={open.has("debt_repayment")}
                  onClick={() => toggle("debt_repayment")}
                >
                  <MoneyStat
                    label={t("Debt repaid", "Deuda cobrada")}
                    value={row.debt_repayment_income}
                  />
                </StatButton>
              )}
              {row.unclassified_expense > 0 && (
                <MoneyStat
                  label={t("Unclassified", "Sin clasificar")}
                  value={row.unclassified_expense}
                  warn
                />
              )}
            </div>
            {row.income > 0 &&
              (() => {
                const needs = row.needs_spent;
                const wants = row.wants_spent;
                const saveTarget = row.savings_goal ?? 0;
                const spendable = row.income - saveTarget;
                const spent = needs + wants;
                const base = Math.max(row.income, spent) || 1;
                const over = Math.max(0, spent - spendable);
                const left = spendable - spent;
                return (
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                      <span className="min-w-0 text-muted-foreground">
                        <span className="whitespace-nowrap">
                          {t("Spent", "Gastado")} {COP.format(spent)}{" "}
                          {t("of", "de")} {COP.format(spendable)}{" "}
                          {t("spendable", "disponible")}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "whitespace-nowrap font-semibold tabular-nums",
                            over > 0 ? "text-red-400" : "text-foreground",
                          )}
                        >
                          {spendable > 0
                            ? Math.round((spent / spendable) * 100)
                            : 100}
                          %
                          {over > 0 &&
                            ` · ${t("over by", "excede por")} ${COP.format(over)}`}
                        </span>
                        {split && (
                          <button
                            onClick={() => setAllocOpen(true)}
                            title={t(
                              "Adjust Needs/Wants/Savings split",
                              "Ajustar split Needs/Wants/Savings",
                            )}
                            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                          >
                            <Settings2 className="size-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full bg-sky-500/80"
                        style={{ width: `${(needs / base) * 100}%` }}
                      />
                      <div
                        className="h-full bg-amber-500/80"
                        style={{ width: `${(wants / base) * 100}%` }}
                      />
                      <div
                        className="h-full bg-emerald-500/50"
                        style={{ width: `${(saveTarget / base) * 100}%` }}
                      />
                      {over > 0 && (
                        <div
                          className="h-full bg-red-500/80"
                          style={{ width: `${(over / base) * 100}%` }}
                        />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="size-2 rounded-full bg-sky-500/80" />
                        {t("Needs", "Needs")} {COP.format(needs)}
                      </span>
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="size-2 rounded-full bg-amber-500/80" />
                        {t("Wants", "Wants")} {COP.format(wants)}
                      </span>
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="size-2 rounded-full bg-emerald-500/50" />
                        {t("Savings", "Ahorro")} {COP.format(saveTarget)}
                      </span>
                      <span
                        className={cn(
                          "ml-auto whitespace-nowrap tabular-nums",
                          over > 0 ? "text-red-400" : "text-emerald-400",
                        )}
                      >
                        {over > 0
                          ? `-${COP.format(over)}`
                          : `${COP.format(left)} ${t("left", "disponible")}`}
                      </span>
                    </div>
                  </div>
                );
              })()}
            {incomeTypes
              .filter((b) => b !== "income" && open.has(b as OpenLog))
              .map((b) => logFor(b as OpenLog))}
            <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
              <BucketCard
                name="Income"
                spent={row.income}
                selected={open.has("income")}
                onClick={() => toggle("income")}
              />
              <AddTx
                preset="in"
                card
                accounts={accounts}
                categories={categories}
                month={month}
                onAdd={onAddTx}
              />
            </div>
            {open.has("income") && logFor("income")}
            <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
              <BucketCard
                name="Needs"
                spent={row.needs_spent}
                selected={open.has("needs")}
                onClick={() => toggle("needs")}
                onDropTx={(id) => moveToBucket(id, "needs")}
              />
              <AddTx
                preset="out"
                bucket="needs"
                card
                accounts={accounts}
                categories={categories}
                month={month}
                onAdd={onAddTx}
              />
            </div>
            {open.has("needs") && logFor("needs")}
            <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
              <BucketCard
                name="Wants"
                spent={row.wants_spent}
                selected={open.has("wants")}
                onClick={() => toggle("wants")}
                onDropTx={(id) => moveToBucket(id, "wants")}
              />
              <AddTx
                preset="out"
                bucket="wants"
                card
                accounts={accounts}
                categories={categories}
                month={month}
                onAdd={onAddTx}
              />
            </div>
            {open.has("wants") && logFor("wants")}
          </>
        )}
        <Commitments
          commitments={commitments}
          transactions={transactions}
          row={row}
          monthKey={key}
        />
        {prog && (
          <SavingsProgress
            prog={prog}
            rows={savings.filter((s) => s.month.slice(0, 10) <= key)}
            budget={budget}
            savingsTx={savingsTx}
            incomeTx={incomeTx}
            accounts={accounts}
            sources={sources}
            onNotMine={onNotMine}
          />
        )}
        {split && (
          <GlobalSavings
            split={split}
            debts={debts}
            savingsTx={savingsTx}
            incomeTx={incomeTx}
            budget={budget}
            sources={sources}
            onSave={onSaveSplit}
          />
        )}
        <SavingsSources
          sources={sources}
          incomeTx={incomeTx}
          savingsTx={savingsTx}
          monthKey={key}
          onSave={onSaveSource}
          onDelete={onDeleteSource}
        />
        <DebtsList
          debts={debts}
          accounts={accounts}
          txById={
            new Map(
              [...transactions, ...incomeTx, ...savingsTx].map((t) => [
                t.id,
                t,
              ]),
            )
          }
          onSave={onSaveDebt}
          onDelete={onDeleteDebt}
          onRename={onRenameDebtor}
        />
      </CardContent>

      <Dialog
        open={allocOpen}
        onOpenChange={(o) => {
          setAllocOpen(o);
          if (o && split) {
            setFNeeds(String(split.needs_pct));
            setFWants(String(split.wants_pct));
            setFSavings(String(split.savings_pct));
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Budget split", "División del presupuesto")}</DialogTitle>
            <DialogDescription>
              {t(
                "Percentages of each month's income — must add up to 100.",
                "Porcentajes del income de cada mes — deben sumar 100.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                [`${t("Needs", "Needs")} %`, fNeeds, setFNeeds],
                [`${t("Wants", "Wants")} %`, fWants, setFWants],
                [`${t("Savings", "Ahorro")} %`, fSavings, setFSavings],
              ] as const
            ).map(([lbl, val, set]) => (
              <label key={lbl} className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{lbl}</span>
                <Input
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            ))}
          </div>
          {(() => {
            const n = parseFloat(fNeeds) || 0;
            const w = parseFloat(fWants) || 0;
            const s = parseFloat(fSavings) || 0;
            const sum = n + w + s;
            const ok = Math.abs(sum - 100) < 0.01;
            return (
              <>
                <p
                  className={cn(
                    "text-xs",
                    ok ? "text-emerald-400" : "text-red-400",
                  )}
                >
                  Total: {sum}%
                  {!ok && ` — ${t("must equal 100", "debe ser 100")}`}
                </p>
                <Button
                  size="sm"
                  disabled={!ok}
                  onClick={() => {
                    void onSaveSplit({
                      needs_pct: n,
                      wants_pct: w,
                      savings_pct: s,
                    });
                    setAllocOpen(false);
                  }}
                >
                  {t("Save", "Guardar")}
                </Button>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BucketCard({
  name,
  spent,
  selected,
  onClick,
  onDropTx,
}: {
  name: string;
  spent: number;
  selected: boolean;
  onClick: () => void;
  onDropTx?: (txId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={
        onDropTx
          ? (e) => {
              e.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        onDropTx
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onDropTx(id);
            }
          : undefined
      }
      className={cn(
        "cursor-pointer rounded-md border border-border p-3 text-left transition-colors hover:bg-accent/50",
        selected && "border-foreground/40 bg-accent/40",
        over && "border-emerald-500/60 bg-emerald-500/10",
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {COP.format(spent)}
        </span>
      </div>
    </button>
  );
}

/** month (YYYY-MM-01) a transaction counts toward — mirrors monthly_budget:
 * inflows use the budget month (end-of-month sources shift forward),
 * outflows always count in their real month */
function attrMonth(t: Transaction) {
  const m = t.direction === "in" ? t.budget_month : t.real_month;
  return (m ?? t.occurred_at).slice(0, 10);
}

function SavingsProgress({
  prog,
  rows,
  budget,
  savingsTx,
  incomeTx,
  accounts,
  sources = [],
  onNotMine,
}: {
  prog: SavingsProgressRow;
  rows: SavingsProgressRow[];
  budget: MonthlyBudgetRow[];
  savingsTx: Transaction[];
  incomeTx: Transaction[];
  accounts: Account[];
  sources?: SavingsSource[];
  onNotMine: (id: string) => Promise<void>;
}) {
  const { t: tr, locale } = useT();
  const [open, setOpen] = useState(false);
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const pct =
    prog.cumulative_target > 0
      ? (prog.cumulative_sent / prog.cumulative_target) * 100
      : 0;
  const over = prog.remaining < 0;

  // Cada pago se muestra en su mes real con su monto completo.
  const allocation = useMemo(() => {
    const result = new Map<
      string,
      { tx: Transaction; amount: number }[]
    >(rows.map((r) => [r.month, []]));
    for (const t of [...savingsTx].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    )) {
      const m = `${(t.real_month ?? t.occurred_at).slice(0, 7)}-01`;
      result
        .get(m)
        ?.push({
          tx: t,
          amount: t.type === "savings_withdrawal" ? -t.amount : t.amount,
        });
    }
    return result;
  }, [rows, savingsTx]);

  return (
    <div className="rounded-md border border-border p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full cursor-pointer text-left"
        aria-expanded={open}
      >
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
          <span className="whitespace-nowrap font-medium">{tr("Savings progress", "Progreso de ahorro")}</span>
          <span className="ml-auto whitespace-nowrap tabular-nums text-muted-foreground">
            {COP.format(prog.cumulative_sent)} /{" "}
            {COP.format(prog.cumulative_target)}
          </span>
        </div>
        <ProgressBar pct={Math.min(100, pct)} color="#429a8e" />
        <p
          className={cn(
            "mt-2 text-sm font-medium",
            over ? "text-emerald-400" : "text-amber-400",
          )}
        >
          {over
            ? `${COP.format(-prog.remaining)} ${tr("ahead of target", "sobre el objetivo")}`
            : `${COP.format(prog.remaining)} ${tr("still to save", "falta por ahorrar")}`}
        </p>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 text-xs">
          {rows.map((r) => {
            const sentTx = allocation.get(r.month) ?? [];
            const sentTotal = sentTx.reduce((a, s) => a + s.amount, 0);
            const b = budget.find((x) => x.month.slice(0, 10) === r.month.slice(0, 10));
            const parts = [
              { label: tr("20% of income", "20% del income"), value: b?.savings_goal ?? 0, hint: b ? `income ${COP.format(b.income)}` : "", type: "income" },
              { label: tr("Parent savings", "Ahorro familiar"), value: b?.family_savings_income ?? 0, hint: tr("fixed, from dad's deposit", "fijo, del depósito de papá"), type: "family_savings" },
              { label: "Sponsorship (Accenture)", value: b?.sponsorship_income ?? 0, hint: tr("goes 100% to savings", "va 100% al ahorro"), type: "sponsorship" },
              { label: tr("Interest", "Intereses"), value: b?.interest_income ?? 0, hint: "", type: "interest" },
              { label: tr("Debt repaid", "Deuda cobrada"), value: b?.debt_repayment_income ?? 0, hint: "", type: "debt_repayment" },
            ].filter((p) => p.value > 0);
            // Compromisos mensuales de fuentes "out" activas — cuentan desde
            // el mes en que se creo la fuente (igual que en la vista).
            const commitSrcs = sources.filter(
              (s) =>
                s.active &&
                s.direction === "out" &&
                s.expected_monthly > 0 &&
                (s.created_at ?? "").slice(0, 7) <= r.month.slice(0, 7),
            );
            if (commitSrcs.length) {
              parts.push({
                label: tr("Compromisos", "Compromisos"),
                value: commitSrcs.reduce((a, s) => a + s.expected_monthly, 0),
                hint: commitSrcs
                  .map((s) => `${s.name} ${COP.format(s.expected_monthly)}`)
                  .join(" · "),
                type: "commitment",
              });
            }
            if (!parts.length && sentTotal === 0) return null;
            return (
              <div key={r.month} className="rounded-md border border-border/60">
                <div className="border-b border-border/50 px-3 py-1.5 font-medium capitalize">
                  {fmtMonth(new Date(`${r.month.slice(0, 10)}T12:00:00`), locale)}
                </div>
                {parts.map((p) => {
                  const partTx = incomeTx.filter(
                    (t) => t.type === p.type && attrMonth(t) === r.month.slice(0, 10),
                  );
                  return (
                    <div key={p.label}>
                      <div className="flex items-baseline justify-between gap-2 px-3 py-1">
                        <span className="min-w-0">
                          {p.label}
                          {p.hint && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              {p.hint}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">+ {COP.format(p.value)}</span>
                      </div>
                      {partTx.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 px-3 py-0.5 pl-6 text-muted-foreground"
                        >
                          <span className="w-14 shrink-0 tabular-nums">
                            {new Date(t.occurred_at).toLocaleDateString(locale, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {t.counterparty ?? t.description ?? "—"}
                            <span className="ml-1.5 text-[10px]">
                              {accountName.get(t.account_id) ?? "?"}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {COP.format(t.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <div className="flex justify-between border-t border-border/50 px-3 py-1 font-medium">
                  <span>{tr("Target", "Objetivo")}</span>
                  <span className="tabular-nums">{COP.format(r.target)}</span>
                </div>
                <div className="flex justify-between px-3 py-1 text-emerald-400">
                  <span>{tr("Sent to savings", "Enviado a ahorro")}</span>
                  <span className="tabular-nums">− {COP.format(r.sent ?? sentTotal)}</span>
                </div>
                {sentTx.map(({ tx: t, amount }, i) => (
                  <div
                    key={`${t.id}-${i}`}
                    className="flex items-center gap-3 border-t border-border/30 px-3 py-1 text-muted-foreground"
                  >
                    <span className="w-14 shrink-0 tabular-nums">
                      {new Date(t.occurred_at).toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {t.counterparty ?? t.description ?? "—"}
                      <span className="ml-1.5 text-[10px]">
                        {accountName.get(t.account_id) ?? "?"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        amount < 0 ? "text-red-400" : "text-emerald-400",
                      )}
                    >
                      {amount < 0 ? "-" : "+"}
                      {COP.format(Math.abs(amount))}
                    </span>
                    <button
                      onClick={() => void onNotMine(t.id)}
                      title={tr("Not a savings transfer — mark as pass-through (excluded from all totals)", "No es transferencia a ahorro — marcar como pass-through (excluida de totales)")}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-red-400"
                    >
                      <Ban className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="flex justify-between px-1 font-semibold">
            <span>
              {over ? tr("Ahead of target", "Sobre el objetivo") : tr("Still to save", "Falta por ahorrar")}
            </span>
            <span className="tabular-nums">{COP.format(Math.abs(prog.remaining))}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Global savings: acumulado historico + baseline vs meta total ─────────────

// Fila del desglose de global savings con hover que lista las txs que la
// componen (cuentas con patron, patrocinio, intereses).
function SavingsLine({
  label,
  shown,
  extra,
  txs,
  strike,
  indent,
  foot,
}: {
  label: string;
  shown: number;
  extra?: number;
  txs?: Transaction[];
  strike?: boolean;
  indent?: boolean;
  foot?: string;
}) {
  const { locale } = useT();
  return (
    <div
      className={cn(
        "group relative flex items-baseline justify-between gap-2",
        indent && "pl-3",
      )}
    >
      <span
        className={cn(
          "min-w-0 truncate",
          strike ? "text-muted-foreground/60" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap tabular-nums",
          strike && "text-muted-foreground/60 line-through",
        )}
      >
        {COP.format(shown)}
        {!!extra && (
          <span className="ml-1 text-[10px] text-emerald-400">
            +{COP.format(extra)}
          </span>
        )}
      </span>
      {txs && txs.length > 0 && (
        <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-80 max-w-[calc(100vw-3rem)] rounded-md border border-border bg-popover p-2 shadow-lg group-hover:block">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {txs.map((t) => {
            const amt =
              t.type === "savings_withdrawal" ? -t.amount : t.amount;
            return (
              <div
                key={t.id}
                className="flex items-baseline gap-2 py-0.5 text-[11px]"
              >
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground/60">
                  {new Date(t.occurred_at).toLocaleDateString(locale, {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t.label || t.counterparty || t.description || "—"}
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    amt < 0 ? "text-red-400" : "text-emerald-400",
                  )}
                >
                  {amt < 0 ? "-" : "+"}
                  {COP.format(Math.abs(amt))}
                </span>
              </div>
            );
          })}
          {foot && (
            <p className="mt-1 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
              {foot}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GlobalSavings({
  split,
  debts = [],
  savingsTx = [],
  incomeTx = [],
  budget = [],
  sources = [],
  onSave,
}: {
  split: BudgetSplit;
  debts: Debt[];
  savingsTx: Transaction[];
  incomeTx: Transaction[];
  budget: MonthlyBudgetRow[];
  sources: SavingsSource[];
  onSave: (fields: Partial<BudgetSplit>) => Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [advAcct, setAdvAcct] = useState<number | null>(null);
  const [fAccounts, setFAccounts] = useState<
    {
      label: string;
      amount: string;
      pattern: string;
      since: string;
      source: string;
    }[]
  >([]);
  const [fGoals, setFGoals] = useState<
    { name: string; target: string; source: string }[]
  >([]);

  const signedAmt = (t: Transaction) =>
    t.type === "savings_withdrawal" ? -t.amount : t.amount;
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const acctSource = (a: SavingsAccount) =>
    a.source_id ? sourceById.get(a.source_id) : undefined;
  // Si la cuenta esta vinculada a una fuente, el patron viene de ahi y la
  // cuenta deja de absorber depositos cuando la fuente esta pausada.
  const acctPattern = (a: SavingsAccount) => {
    const src = acctSource(a);
    if (src) return src.active ? src.pattern : undefined;
    return a.pattern;
  };
  const matchesAcct = (a: SavingsAccount, t: Transaction) => {
    const pattern = acctPattern(a);
    if (!pattern) return false;
    if (a.since && t.occurred_at.slice(0, 10) < a.since) return false;
    let re: RegExp;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      return false;
    }
    return re.test(
      `${t.counterparty ?? ""} ${t.description ?? ""} ${t.label ?? ""}`,
    );
  };
  // Solo cuentan depositos desde tracking_start — los anteriores ya van
  // dentro del monto base de cada cuenta.
  const trackedTx = savingsTx.filter(
    (t) => t.occurred_at.slice(0, 10) >= split.tracking_start,
  );
  // Cada deposito cae en la PRIMERA cuenta cuyo patron coincida (orden
  // importa: una cuenta ".*" al final atrapa todo lo demas). Lo que no
  // cae en ninguna queda como "sin cuenta".
  const accts = split.baseline_accounts ?? [];
  const firstMatch = (t: Transaction) =>
    accts.findIndex((a) => matchesAcct(a, t));
  const acctRows = accts.map((a, i) => {
    const txs = trackedTx
      .filter((t) => firstMatch(t) === i)
      .sort((x, y) => y.occurred_at.localeCompare(x.occurred_at));
    const extra = txs.reduce((s, t) => s + signedAmt(t), 0);
    return { ...a, txs, extra, shown: a.amount + extra };
  });
  const acctTotal = acctRows.reduce((s, a) => s + a.shown, 0);
  const tracked = trackedTx
    .filter((t) => firstMatch(t) === -1)
    .reduce((s, t) => s + signedAmt(t), 0);
  const owedToMe = debts
    .filter(
      (d) =>
        d.status === "open" &&
        d.direction === "owed_to_me" &&
        !d.exclude_from_savings,
    )
    .reduce((a, d) => a + d.amount, 0);
  const owedCard = debts
    .filter(
      (d) =>
        d.status === "open" &&
        d.direction === "owed_to_me" &&
        d.exclude_from_savings,
    )
    .reduce((a, d) => a + d.amount, 0);
  // Patrocinio e intereses son plata aparte que suma al global — pero lo
  // que ya se envio a Nu (deposito etiquetado con esa categoria) ya esta
  // dentro del saldo de Nu, asi que se descuenta para no duplicar.
  const inTracking = (t: Transaction) =>
    t.occurred_at.slice(0, 10) >= split.tracking_start;
  // Una transaccion ligada a una fuente pausada no alimenta el bolsillo —
  // apagar "Inversion papa" baja los intereses del sub-goal, por ejemplo.
  const pausedRes = sources
    .filter((s) => !s.active && s.pattern)
    .map((s) => new RegExp(s.pattern ?? "", "i"));
  const hitsPaused = (t: Transaction) =>
    pausedRes.some((re) =>
      re.test(`${t.counterparty ?? ""} ${t.description ?? ""} ${t.label ?? ""}`),
    );
  const sponsorTx = incomeTx
    .filter((t) => t.type === "sponsorship" && inTracking(t) && !hitsPaused(t))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const interestInTx = incomeTx
    .filter((t) => t.type === "interest" && inTracking(t) && !hitsPaused(t))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const sponsorTotal = sponsorTx.reduce((s, t) => s + t.amount, 0);
  const interestTotal = interestInTx.reduce((s, t) => s + t.amount, 0);
  const efTotal = acctTotal + tracked + owedToMe;
  // El balance es la plata que ya tengo en las cuentas + me deben — los
  // bolsillos (patrocinio/intereses) aumentan el OBJETIVO via sub-metas.
  const balance = efTotal;

  // El objetivo del EF crece solo: base fija (hasta el mes de tracking
  // start) + el % de ahorro del income que se acumula cada mes nuevo.
  const efAuto = budget
    .filter((r) => r.month.slice(0, 7) > split.tracking_start.slice(0, 7))
    .reduce((s, r) => s + r.savings_goal, 0);
  // Las metas de bolsillo (patrocinio/intereses) crecen solas cada mes con
  // lo que llega de esa fuente — su target guardado es solo un extra.
  const poolFor = (src?: string) =>
    src === "patrocinio"
      ? sponsorTotal
      : src === "intereses"
        ? interestTotal
        : efTotal;
  // La primera meta de fuente "ef" recibe el boost automatico.
  const firstEf = split.savings_goals.findIndex(
    (g) => (g.source ?? "ef") === "ef",
  );
  const effTargets = split.savings_goals.map((g, i) => {
    const src = g.source ?? "ef";
    if (src !== "ef") return g.target + poolFor(src);
    return i === firstEf ? g.target + efAuto : g.target;
  });

  // Waterfall por bolsillo: cada meta se llena con su fuente (ef por
  // defecto), en el orden en que se listan dentro de cada fuente.
  const goals = split.savings_goals.map((g, i) => {
    const src = g.source ?? "ef";
    const before = split.savings_goals
      .slice(0, i)
      .filter((x) => (x.source ?? "ef") === src)
      .reduce((a, _, j) => a + effTargets[j], 0);
    return {
      ...g,
      effTarget: effTargets[i],
      got: Math.max(0, Math.min(poolFor(src) - before, effTargets[i])),
    };
  });
  // Las investment sources con esperado mensual aparecen solas como
  // sub-metas: su objetivo es esperado x meses activas (desde created_at)
  // y se llenan con lo que realmente generaron/enviaron segun su patron.
  const monthsSeen = [...new Set(budget.map((r) => r.month.slice(0, 7)))];
  const srcGoals = sources
    .filter((s) => s.expected_monthly > 0)
    .map((s) => {
      const activeMonths = Math.max(
        1,
        monthsSeen.filter(
          (m) => m >= (s.created_at ?? "9999").slice(0, 7),
        ).length,
      );
      const re = s.pattern ? new RegExp(s.pattern, "i") : null;
      const pool = s.direction === "out" ? savingsTx : incomeTx;
      // Una fuente "in" cuenta solo lo que genera (intereses, pagos de
      // deuda, patrocinio) — no cualquier income ni la plata familiar del
      // mismo pagador.
      const IN_TYPES = ["interest", "debt_repayment", "sponsorship"];
      const got =
        s.active && re
          ? pool
              .filter(
                (t) =>
                  inTracking(t) &&
                  (s.direction === "out" || IN_TYPES.includes(t.type ?? "")) &&
                  re.test(
                    `${t.counterparty ?? ""} ${t.description ?? ""} ${t.label ?? ""}`,
                  ),
              )
              .reduce(
                (a, t) =>
                  a + (t.type === "savings_withdrawal" ? -t.amount : t.amount),
                0,
              )
          : 0;
      return {
        name: s.name,
        got,
        target: s.expected_monthly * activeMonths,
        paused: !s.active,
      };
    });
  // El objetivo global es la suma de las sub-metas + fuentes activas.
  const target =
    goals.length > 0 || srcGoals.length > 0
      ? goals.reduce((a, g) => a + g.effTarget, 0) +
        srcGoals
          .filter((g) => !g.paused)
          .reduce((a, g) => a + g.target, 0)
      : split.global_savings_target;
  const pct = target > 0 ? (balance / target) * 100 : 0;
  const remaining = target - balance;
  const rest = Math.max(0, balance - target);

  return (
    <div className="rounded-md border border-border p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full cursor-pointer text-left"
        aria-expanded={open}
      >
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
          <span className="flex items-center gap-1.5 whitespace-nowrap font-medium">
            {open ? "▾" : "▸"} {t("Global savings", "Ahorro global")}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {COP.format(balance)} / {target > 0 ? COP.format(target) : "—"}
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setFAccounts(
                  (split.baseline_accounts ?? []).map((a) => ({
                    label: a.label,
                    amount: fmtAmt(String(a.amount)),
                    pattern: a.pattern ?? "",
                    since: a.since ?? "",
                    source: a.source_id ?? "",
                  })),
                );
                setAdvAcct(null);
                setFGoals(
                  split.savings_goals.map((g) => ({
                    name: g.name,
                    target: fmtAmt(String(g.target)),
                    source: g.source ?? "ef",
                  })),
                );
                setEditOpen(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && setEditOpen(true)}
              title={t("Edit saving accounts", "Editar cuentas de ahorro")}
              className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
            >
              <Settings2 className="size-3.5" />
            </span>
          </span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className="h-full"
            style={{
              width: `${Math.min(100, pct)}%`,
              backgroundColor: "#10B981",
            }}
          />
        </div>
        {target > 0 && (
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              remaining <= 0 ? "text-emerald-400" : "text-amber-400",
            )}
          >
            {remaining <= 0
              ? `${COP.format(-remaining)} ${t("above goal", "sobre el objetivo")}`
              : `${COP.format(remaining)} ${t("still to save to reach the goal", "faltan para el objetivo")}`}
          </p>
        )}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border/40 pt-3 text-xs">
          <div className="flex items-baseline justify-between gap-2 font-medium">
            <span>{t("Saving accounts", "Cuentas de ahorro")}</span>
            <span className="tabular-nums">{COP.format(efTotal)}</span>
          </div>
          {acctRows.map((a) => (
            <SavingsLine
              key={a.label}
              label={`${a.label}${acctPattern(a) ? " (auto)" : ""}${acctSource(a) && !acctSource(a)!.active ? ` · ${t("paused", "pausada")}` : ""}`}
              shown={a.shown}
              extra={a.extra}
              txs={a.txs}
              indent
            />
          ))}
          {tracked !== 0 && (
            <SavingsLine
              label={t("Unassigned deposits", "Depósitos sin cuenta")}
              shown={tracked}
              indent
            />
          )}
          {owedToMe > 0 && (
            <SavingsLine label={t("Owed to me", "Me deben")} shown={owedToMe} indent />
          )}
          {owedCard > 0 && (
            <SavingsLine
              label={t("Owed to me · card (excluded)", "Me deben · tarjeta (no cuenta)")}
              shown={owedCard}
              strike
              indent
            />
          )}
        </div>
      )}
      {open && goals.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border/40 pt-3 text-xs">
          {goals.map((g) => (
            <div key={g.name}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{g.name}</span>
                <span className="shrink-0 whitespace-nowrap tabular-nums">
                  {COP.format(g.got)} / {COP.format(g.effTarget)}
                </span>
              </div>
              <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full bg-emerald-500/70"
                  style={{
                    width: `${g.effTarget > 0 ? Math.min(100, (g.got / g.effTarget) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {srcGoals.map((g) => (
            <div key={g.name} className={cn(g.paused && "opacity-50")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">
                  {g.name}
                  {g.paused && (
                    <span className="ml-1 text-[10px]">· {t("paused", "pausada")}</span>
                  )}
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                    {t("source", "fuente")}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap tabular-nums">
                  {COP.format(g.got)} / {COP.format(g.target)}
                </span>
              </div>
              <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className={cn(
                    "h-full",
                    g.paused ? "bg-muted-foreground/40" : "bg-teal-500/70",
                  )}
                  style={{
                    width: `${g.target > 0 ? Math.min(100, (g.got / g.target) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {rest > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {COP.format(rest)} {t("unallocated beyond sub-goals", "sin asignar más allá de las sub-metas")}
            </p>
          )}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Global savings", "Ahorro global")}</DialogTitle>
            <DialogDescription>
              {t(
                "Balance = accounts + tracked deposits + open \"owed to me\". Sub-goals fill in the order listed.",
                "Balance = cuentas + depósitos + \"me deben\" abiertos. Las sub-metas se llenan en orden.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t("Accounts (where the money already sits)", "Cuentas (donde ya está la plata)")}
            </span>
            {fAccounts.map((a, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={a.label}
                    onChange={(e) =>
                      setFAccounts((as) =>
                        as.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder={t("FNA, Nu, loaned to...", "FNA, Nu, prestado a...")}
                    className="flex-1"
                  />
                  <Input
                    value={a.amount}
                    onChange={(e) =>
                      setFAccounts((as) =>
                        as.map((x, j) =>
                          j === i
                            ? { ...x, amount: fmtAmt(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    placeholder="Amount"
                    inputMode="decimal"
                    className="w-28"
                  />
                  <button
                    onClick={() => setAdvAcct((c) => (c === i ? null : i))}
                    title={t("Auto-match and linked source", "Auto-match y fuente vinculada")}
                    className={cn(
                      "rounded p-1",
                      a.pattern || a.source || advAcct === i
                        ? "text-emerald-400/80 hover:text-emerald-300"
                        : "text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      setFAccounts((as) => as.filter((_, j) => j !== i))
                    }
                    className="rounded p-1 text-muted-foreground/60 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {advAcct === i && (
                <div className="flex items-center gap-2 pl-1">
                  <Select
                    value={a.source || "none"}
                    onValueChange={(v) =>
                      setFAccounts((as) =>
                        as.map((x, j) =>
                          j === i
                            ? { ...x, source: v === "none" ? "" : (v ?? "") }
                            : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-7 w-32 text-[11px]"
                      title={t("Linked source (inherits pattern and pause)", "Fuente vinculada (hereda patrón y pausa)")}
                    >
                      <SelectValue placeholder={t("Source", "Fuente")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("No source", "Sin fuente")}</SelectItem>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={a.pattern}
                    onChange={(e) =>
                      setFAccounts((as) =>
                        as.map((x, j) =>
                          j === i ? { ...x, pattern: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="auto-match: fondo nacional|fna"
                    className="h-7 flex-1 text-[11px]"
                    disabled={!!a.source}
                    title={
                      a.source
                        ? t("The pattern comes from the linked source", "El patrón viene de la fuente vinculada")
                        : undefined
                    }
                  />
                  <Input
                    type="date"
                    value={a.since}
                    onChange={(e) =>
                      setFAccounts((as) =>
                        as.map((x, j) =>
                          j === i ? { ...x, since: e.target.value } : x,
                        ),
                      )
                    }
                    title={t("Only deposits from this date", "Solo depósitos desde esta fecha")}
                    className="h-7 w-32 text-[11px]"
                  />
                </div>
                )}
              </div>
            ))}
            <button
              onClick={() =>
                setFAccounts((as) => [
                  ...as,
                  {
                    label: "",
                    amount: "",
                    pattern: "",
                    since: "",
                    source: "",
                  },
                ])
              }
              className="self-start text-xs text-emerald-400 hover:text-emerald-300"
            >
              + {t("Add account", "Agregar cuenta")}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t(
                "Sub-goals (fill in order) — source goals are auto-created",
                "Sub-metas (se llenan en orden) — las de fuentes se crean solas",
              )}
            </span>
            {fGoals.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) =>
                    setFGoals((gs) =>
                      gs.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Emergency fund recovery"
                  className="flex-1"
                />
                <Select
                  value={g.source}
                  onValueChange={(v) =>
                    v &&
                    setFGoals((gs) =>
                      gs.map((x, j) =>
                        j === i ? { ...x, source: v } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    className="h-8 w-24 text-[10px]"
                    title={t("Which pool it fills from", "De qué bolsillo se llena")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ef">{t("Income", "Ingresos")}</SelectItem>
                    <SelectItem value="patrocinio">{t("Sponsorship", "Patrocinio")}</SelectItem>
                    <SelectItem value="intereses">{t("Interest", "Intereses")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={g.target}
                  onChange={(e) =>
                    setFGoals((gs) =>
                      gs.map((x, j) =>
                        j === i ? { ...x, target: fmtAmt(e.target.value) } : x,
                      ),
                    )
                  }
                  placeholder="Target"
                  inputMode="decimal"
                  className="w-28"
                />
                <button
                  onClick={() =>
                    setFGoals((gs) => gs.filter((_, j) => j !== i))
                  }
                  className="rounded p-1 text-muted-foreground/60 hover:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setFGoals((gs) => [
                  ...gs,
                  { name: "", target: "", source: "ef" },
                ])
              }
              className="self-start text-xs text-emerald-400 hover:text-emerald-300"
            >
              + {t("Add sub-goal", "Agregar sub-meta")}
            </button>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void onSave({
                savings_baseline: 0,
                baseline_accounts: fAccounts
                  .filter(
                    (a) =>
                      a.label.trim() &&
                      (parsePriceExpression(a.amount) ?? 0) !== 0,
                  )
                  .map((a) => ({
                    label: a.label.trim(),
                    amount: parsePriceExpression(a.amount) ?? 0,
                    ...(a.pattern.trim()
                      ? { pattern: a.pattern.trim() }
                      : {}),
                    ...(a.since ? { since: a.since } : {}),
                    ...(a.source ? { source_id: a.source } : {}),
                  })),
                savings_goals: fGoals
                  .filter(
                    (g) =>
                      g.name.trim() &&
                      (parsePriceExpression(g.target) ?? 0) > 0,
                  )
                  .map((g) => ({
                    name: g.name.trim(),
                    target: parsePriceExpression(g.target) ?? 0,
                    ...(g.source !== "ef"
                      ? { source: g.source as SavingsGoal["source"] }
                      : {}),
                  })),
              });
              setEditOpen(false);
            }}
          >
            {t("Save", "Guardar")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function matchSum(
  c: MonthlyCommitment,
  transactions: Transaction[],
  key: string,
) {
  let re: RegExp;
  try {
    re = new RegExp(c.pattern, "i");
  } catch {
    return 0;
  }
  return transactions
    .filter(
      (t) =>
        attrMonth(t) === key &&
        t.direction === c.direction &&
        t.type !== "pass_through" &&
        re.test(`${t.counterparty ?? ""} ${t.description ?? ""}`),
    )
    .reduce((a, t) => a + t.amount, 0);
}

function Commitments({
  commitments,
  transactions,
  row,
  monthKey: key,
}: {
  commitments: MonthlyCommitment[];
  transactions: Transaction[];
  row?: MonthlyBudgetRow;
  monthKey: string;
}) {
  const { t } = useT();
  const items = commitments.map((c) => ({
    key: c.id,
    name: c.name,
    expected: c.expected_amount,
    paid: matchSum(c, transactions, key),
    savings: c.counts_as_savings,
  }));
  const target = row
    ? row.savings_goal +
      row.interest_income +
      row.sponsorship_income +
      row.debt_repayment_income +
      row.family_savings_income
    : 0;
  const committedSavings = items
    .filter((i) => i.savings)
    .reduce((a, i) => a + i.expected, 0);
  const committedPaid = items
    .filter((i) => i.savings)
    .reduce((a, i) => a + Math.min(i.paid, i.expected), 0);
  const nuExpected = Math.max(0, target - committedSavings);
  const nuSent = Math.max(0, (row?.savings_actual ?? 0) - committedPaid);
  const all = [
    ...items,
    ...(target > 0
      ? [
          {
            key: "nu",
            name: t("Send savings to Nu", "Enviar ahorro a Nu"),
            expected: nuExpected,
            paid: nuSent,
            savings: false,
          },
        ]
      : []),
  ];
  if (!all.length) return null;
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("Monthly commitments", "Compromisos mensuales")}
      </div>
      {all.map((i) => {
        const done = i.expected > 0 && i.paid >= i.expected;
        const partial = !done && i.paid > 0;
        const Icon = done ? CheckCircle2 : partial ? CircleDot : Circle;
        return (
          <div
            key={i.key}
            className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-0"
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                done
                  ? "text-emerald-400"
                  : partial
                    ? "text-amber-400"
                    : "text-muted-foreground/50",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {COP.format(i.paid)} / {COP.format(i.expected)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/50",
        selected && "bg-accent/40",
      )}
    >
      {children}
    </button>
  );
}

function BucketLog({
  bucket,
  transactions,
  inflow,
  catById,
  categories,
  accounts,
  onNotMine,
  onEdit,
  splitDebts,
  onSplit,
  onRenameDebtor,
}: {
  bucket: string;
  transactions: Transaction[];
  inflow?: boolean;
  catById: Map<string, Category>;
  categories: Category[];
  accounts: Account[];
  onNotMine: (id: string) => Promise<void>;
  onEdit: (
    id: string,
    fields: {
      counterparty?: string | null;
      category_id?: string | null;
      label?: string | null;
      occurred_at?: string;
    },
  ) => Promise<void>;
  splitDebts: Debt[];
  onSplit: (
    t: Transaction,
    who: string,
    theirShare?: number,
    ref?: string,
  ) => Promise<void>;
  onRenameDebtor: (from: string, to: string) => Promise<void>;
}) {
  const { t: tr, locale } = useT();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [fDesc, setFDesc] = useState("");
  const [fCat, setFCat] = useState("");
  const [fDate, setFDate] = useState("");
  const [splitTx, setSplitTx] = useState<Transaction | null>(null);
  const [splitWho, setSplitWho] = useState("");
  const [splitAmt, setSplitAmt] = useState("");
  const [splitPct, setSplitPct] = useState("");
  const [splitRef, setSplitRef] = useState("");
  const [whoOpen, setWhoOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const debtorNames = useMemo(
    () =>
      [...new Set(splitDebts.map((d) => d.counterparty))]
        .filter(Boolean)
        .sort(),
    [splitDebts],
  );
  // Neto pendiente por persona: me debe (+) menos lo que yo le debo (-)
  const debtorTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of splitDebts)
      if (d.status === "open")
        m.set(
          d.counterparty,
          (m.get(d.counterparty) ?? 0) +
            (d.direction === "owed_to_me" ? d.amount : -d.amount),
        );
    return m;
  }, [splitDebts]);
  const confirmSplit = () => {
    if (!splitTx || !splitWho.trim()) return;
    void onSplit(
      splitTx,
      splitWho,
      parsePriceExpression(splitAmt) ?? undefined,
      splitRef,
    );
    setSplitTx(null);
  };
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const catGroups = (dir: "in" | "out") => {
    const buckets = dir === "out" ? ["needs", "wants", "savings"] : ["none"];
    return buckets.map(
      (b) => [b, categories.filter((c) => c.bucket === b)] as const,
    );
  };
  const total =
    transactions.reduce(
      (a, t) => a + (t.direction === "out" ? t.amount : -t.amount),
      0,
    ) * (inflow ? -1 : 1);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-baseline justify-between border-b border-border/50 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {bucket} log · {transactions.length} {tr("transactions", "transacciones")}
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {COP.format(total)}
        </span>
      </div>
      {transactions.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          {tr("No transactions in this bucket this month.", "Sin transacciones en este bucket este mes.")}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {transactions.map((t) => (
            <div
              key={t.id}
              draggable={t.direction === "out" && t.type === "expense"}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", t.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className="flex items-center gap-3 border-b border-border/40 px-3 py-1.5 last:border-0"
            >
              <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                {new Date(t.occurred_at).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">
                  {t.label ??
                    t.counterparty ??
                    t.description ??
                    t.raw_text?.slice(0, 60) ??
                    "—"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {catById.get(t.category_id ?? "")?.name ?? "—"} ·{" "}
                  {accountName.get(t.account_id) ?? "?"}
                </p>
              </div>
              {(() => {
                // tachado aunque la deuda ya este pagada (settled)
                const split = splitDebts.find((d) => d.tx_id === t.id);
                const isOut =
                  t.direction === "out" || t.type === "savings_withdrawal";
                return (
                  <span
                    className={cn(
                      "shrink-0 text-right text-xs font-medium tabular-nums",
                      isOut ? "text-red-400" : "text-emerald-400",
                    )}
                  >
                    {(() => {
                      const orig =
                        t.original_amount ??
                        (Number(
                          split?.note?.match(/split:(\d+)/)?.[1],
                        ) ||
                          (split && /compartido|shared/i.test(split.note ?? "")
                            ? t.amount + split.amount
                            : null));
                      return (
                        Number(orig) > t.amount && (
                          <span className="mr-1.5 text-muted-foreground/60 line-through">
                            {COP.format(Number(orig))}
                          </span>
                        )
                      );
                    })()}
                    {isOut ? "-" : "+"}
                    {COP.format(t.amount)}
                  </span>
                );
              })()}
              {t.direction === "out" &&
                (() => {
                  const split = splitDebts.find(
                    (d) => d.tx_id === t.id && d.status === "open",
                  );
                  return (
                    <button
                      onClick={() =>
                        split
                          ? void onSplit(t, "")
                          : (setSplitTx(t),
                            setSplitWho(
                              catById.get(t.category_id ?? "")?.name === "Pet"
                                ? "Daniela Bella"
                                : "",
                            ),
                            setSplitAmt(
                              fmtAmt(String(Math.round(t.amount / 2))),
                            ),
                            setSplitPct("50"),
                            setSplitRef(
                              catById.get(t.category_id ?? "")?.name ?? "",
                            ))
                      }
                      title={
                        split
                          ? `${tr("Shared with", "Compartido con")} ${split.counterparty} — ${tr("click to undo", "click para deshacer")}`
                          : tr("Split expense — someone owes me half", "Dividir gasto — alguien me debe la mitad")
                      }
                      className={cn(
                        "shrink-0 rounded p-0.5 hover:text-emerald-400",
                        split
                          ? "text-emerald-400"
                          : "text-muted-foreground/50",
                      )}
                    >
                      <UserPlus className="size-3" />
                    </button>
                  );
                })()}
              <button
                onClick={() => {
                  const d = new Date(t.occurred_at);
                  setEditing(t);
                  setFDesc(t.label ?? "");
                  setFCat(t.category_id ?? "");
                  setFDate(
                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                  );
                }}
                title={tr("Edit description / category", "Editar descripción / categoría")}
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
              <button
                onClick={() => void onNotMine(t.id)}
                title={tr("Not your money — mark as pass-through (excluded from all totals)", "No es tu plata — marcar como pass-through (excluida de los totales)")}
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-red-400"
              >
                <Ban className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Edit transaction", "Editar transacción")}</DialogTitle>
            <DialogDescription>
              {editing &&
                `${COP.format(editing.amount)} · ${accountName.get(editing.account_id) ?? "?"} · ${new Date(editing.occurred_at).toLocaleDateString(locale)}`}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={fDesc}
            onChange={(e) => setFDesc(e.target.value)}
            placeholder={tr("Your description…", "Tu descripción…")}
            autoFocus
          />
          <Input
            type="date"
            value={fDate}
            onChange={(e) => setFDate(e.target.value)}
          />
          {editing && (editing.counterparty || editing.description) && (
            <p className="truncate text-[10px] text-muted-foreground">
              {tr("original:", "original:")} {editing.counterparty ?? editing.description}
            </p>
          )}
          {editing && (
            <Select value={fCat} onValueChange={(v) => v && setFCat(v)}>
              <SelectTrigger>
                <SelectValue placeholder={tr("Category…", "Categoría…")} />
              </SelectTrigger>
              <SelectContent>
                {catGroups(editing.direction).map(([b, cats]) => (
                  <div key={b}>
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {b === "none" ? tr("income", "income") : b}
                    </p>
                    {cats.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            onClick={() => {
              if (!editing) return;
              const fields: Record<string, unknown> = {
                label: fDesc.trim() || null,
                category_id: fCat || null,
              };
              const [y, m, dd] = fDate.split("-").map(Number);
              if (y && m && dd) {
                const at = new Date(editing.occurred_at);
                at.setFullYear(y, m - 1, dd);
                fields.occurred_at = at.toISOString();
              }
              void onEdit(editing.id, fields);
              setEditing(null);
            }}
          >
            {tr("Save", "Guardar")}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={splitTx != null} onOpenChange={(o) => !o && setSplitTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Split expense", "Dividir gasto")}</DialogTitle>
            <DialogDescription>
              {splitTx &&
                `${COP.format(splitTx.amount)}${
                  catById.get(splitTx.category_id ?? "")?.name
                    ? ` · ${catById.get(splitTx.category_id ?? "")!.name}`
                    : ""
                } — ${tr("their share becomes a debt; the rest stays as your expense.", "su parte queda como deuda; el resto sigue como tu gasto.")}`}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Input
              value={splitWho}
              onChange={(e) => {
                setSplitWho(e.target.value);
                setWhoOpen(true);
              }}
              onFocus={() => setWhoOpen(true)}
              onBlur={() => setTimeout(() => setWhoOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSplit();
                if (e.key === "Escape") setWhoOpen(false);
              }}
              placeholder={tr("Who owes you?", "¿Quién te debe?")}
              autoFocus
            />
            {(() => {
              const matches = debtorNames.filter((n) =>
                n.toLowerCase().includes(splitWho.toLowerCase()),
              );
              const isNew =
                splitWho.trim() !== "" &&
                !debtorNames.some(
                  (n) => n.toLowerCase() === splitWho.trim().toLowerCase(),
                );
              if (!(whoOpen || renaming != null)) return null;
              if (matches.length === 0 && !isNew) return null;
              return (
                <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
                  {matches.map((n) =>
                    renaming === n ? (
                      <div key={n} className="px-2 py-1">
                        <Input
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renameVal.trim()) {
                              void onRenameDebtor(n, renameVal);
                              setSplitWho(renameVal.trim());
                              setRenaming(null);
                            }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          className="h-7 text-xs"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div
                        key={n}
                        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSplitWho(n);
                          setWhoOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {n}
                          {(debtorTotals.get(n) ?? 0) !== 0 && (
                            <span
                              className={cn(
                                "ml-1.5 text-[10px] uppercase",
                                (debtorTotals.get(n) ?? 0) > 0
                                  ? "text-amber-400/80"
                                  : "text-rose-400/80",
                              )}
                            >
                              {(debtorTotals.get(n) ?? 0) > 0
                                ? tr("owes me", "me debe")
                                : tr("I owe", "le debo")}
                            </span>
                          )}
                        </span>
                        {(debtorTotals.get(n) ?? 0) !== 0 && (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {COP.format(Math.abs(debtorTotals.get(n) ?? 0))}
                          </span>
                        )}
                        <button
                          className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                          title={tr("Rename", "Renombrar")}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming(n);
                            setRenameVal(n);
                          }}
                        >
                          <Pencil className="size-3" />
                        </button>
                      </div>
                    ),
                  )}
                  {isNew && renaming == null && (
                    <div
                      className="flex cursor-pointer items-center gap-2 border-t border-border/50 px-2 py-1.5 text-sm text-emerald-400 hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setWhoOpen(false)}
                    >
                      <Plus className="size-3.5" />
                      <span className="truncate">
                        {tr("Add", "Agregar")} &quot;{splitWho.trim()}&quot;
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">
              {tr("Reference", "Referencia")}
            </span>
            <Input
              value={splitRef}
              onChange={(e) => setSplitRef(e.target.value)}
              className="h-7 flex-1 text-xs"
              placeholder="Groceries, Pet, Favor…"
            />
          </div>
          {(() => {
            const own = splitDebts
              .filter((d) => d.counterparty === splitWho.trim())
              .map((d) => d.ref?.trim())
              .filter(Boolean) as string[];
            const all = splitDebts
              .map((d) => d.ref?.trim())
              .filter(Boolean) as string[];
            const refs = [...new Set([...own, ...all])];
            return (
              refs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {refs.map((r) => (
                    <button
                      key={r}
                      onClick={() => setSplitRef(r)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        splitRef === r
                          ? "border-emerald-500/60 text-emerald-300"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )
            );
          })()}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{tr("Their share", "Su parte")}</span>
            <Input
              value={splitAmt}
              onChange={(e) => {
                const nv = fmtAmt(e.target.value);
                setSplitAmt(nv);
                const v = parsePriceExpression(nv);
                if (splitTx && v != null && splitTx.amount > 0)
                  setSplitPct(
                    String(
                      Math.round((v / splitTx.amount) * 1000) / 10,
                    ),
                  );
              }}
              className="h-7 w-28 text-xs"
              placeholder="20000"
            />
            <Input
              value={splitPct}
              onChange={(e) => {
                setSplitPct(e.target.value);
                const p = parseFloat(e.target.value);
                if (splitTx && p > 0)
                  setSplitAmt(
                    fmtAmt(String(Math.round((splitTx.amount * p) / 100))),
                  );
              }}
              className="h-7 w-16 text-xs"
              placeholder="%"
              inputMode="decimal"
            />
            <span className="text-xs text-muted-foreground">%</span>
            {splitTx &&
              (() => {
                const share = parsePriceExpression(splitAmt) ?? 0;
                return share >= splitTx.amount ? (
                  <span className="text-xs text-amber-500">
                    {tr("full → debt only", "todo → solo deuda")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {tr("yours", "tuyo")} {COP.format(splitTx.amount - share)}
                  </span>
                );
              })()}
          </div>
          <Button
            size="sm"
            disabled={
              !splitWho.trim() || !(parsePriceExpression(splitAmt) ?? 0 > 0)
            }
            onClick={confirmSplit}
          >
            {tr("Split", "Dividir")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function MoneyStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          warn && "text-amber-400",
        )}
      >
        {COP.format(value)}
      </p>
    </div>
  );
}

// ── Revisión: transactions needing a category ─────────────────────────────────

function Revision({
  rows,
  month,
  onShift,
  categories,
  accounts,
  debts,
  onClassify,
  onNotMine,
  onFavor,
  onRepayment,
  onFindPairs,
  onMarkInternal,
}: {
  rows: Transaction[];
  month: Date;
  onShift: (d: number) => void;
  categories: Category[];
  accounts: Account[];
  debts: Debt[];
  onClassify: (id: string, categoryId: string) => Promise<void>;
  onNotMine: (id: string) => Promise<void>;
  onFavor: (t: Transaction, who: string) => Promise<void>;
  onRepayment: (t: Transaction, debtId: string) => Promise<void>;
  onFindPairs: (t: Transaction) => Promise<Transaction[]>;
  onMarkInternal: (id: string, otherId: string | null) => Promise<void>;
}) {
  const { t: tr, locale } = useT();
  const [pairing, setPairing] = useState<Transaction | null>(null);
  const [candidates, setCandidates] = useState<Transaction[] | null>(null);
  const [nmTx, setNmTx] = useState<Transaction | null>(null);
  const [nmName, setNmName] = useState("");
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const grouped = (dir: "in" | "out") => {
    const buckets = dir === "out" ? ["needs", "wants", "savings"] : ["none"];
    return buckets.map(
      (b) => [b, categories.filter((c) => c.bucket === b)] as const,
    );
  };
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
  const monthRows = rows.filter((t) => attrMonth(t) === monthKey);

  return (
    <Card className="h-full overflow-y-auto">
      <CardHeader className="grid-cols-[auto_1fr_auto_auto] items-center pb-2">
        <Button size="icon" variant="ghost" onClick={() => onShift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <CardTitle className="min-w-0 truncate justify-self-center text-center text-base capitalize">
          {fmtMonth(month, locale)}
        </CardTitle>
        <Button size="icon" variant="ghost" onClick={() => onShift(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {monthRows.length} {tr("to review", "por revisar")}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!monthRows.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {tr("All classified — no pending transactions this month.", "Todo clasificado — nada pendiente este mes.")}
          </p>
        )}
        {monthRows.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {t.counterparty ?? t.description ?? t.raw_text?.slice(0, 60) ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(t.occurred_at).toLocaleDateString(locale)} ·{" "}
                {accountName.get(t.account_id) ?? "?"} · {t.source}
              </p>
            </div>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                t.direction === "out" ? "text-red-400" : "text-emerald-400",
              )}
            >
              {t.direction === "out" ? "-" : "+"}
              {COP.format(t.amount)}
            </span>
            <Select
              onValueChange={(v) => v && void onClassify(t.id, v as string)}
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder={tr("Category…", "Categoría…")} />
              </SelectTrigger>
              <SelectContent>
                {grouped(t.direction).map(([bucket, cats]) => (
                  <div key={bucket}>
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {bucket === "none" ? tr("income", "income") : bucket}
                    </p>
                    {cats.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              title={tr("Transfer between my own accounts — pick the other side", "Transferencia entre mis cuentas — elige el otro lado")}
              onClick={() => {
                setPairing(t);
                setCandidates(null);
                void onFindPairs(t).then(setCandidates);
              }}
            >
              {tr("Internal", "Interna")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              title={tr("Money that isn't yours (favors, pass-through) — excluded from all totals", "Plata que no es tuya (favores, pass-through) — excluida de los totales")}
              onClick={() => {
                setNmTx(t);
                setNmName(t.counterparty ?? "");
              }}
            >
              {tr("Not mine", "No es mía")}
            </Button>
          </div>
        ))}
      </CardContent>

      <Dialog
        open={pairing != null}
        onOpenChange={(o) => !o && setPairing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Internal transfer", "Transferencia interna")}</DialogTitle>
            <DialogDescription>
              {pairing &&
                `${COP.format(pairing.amount)} · ${accountName.get(pairing.account_id) ?? "?"} — ${tr("pick the matching movement in another account.", "elige el movimiento que le hace par en otra cuenta.")}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {candidates == null && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {tr("Looking for candidates…", "Buscando candidatos…")}
              </p>
            )}
            {candidates?.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {tr("No matching movement found in the last 7 days.", "Ningún movimiento pareja en los últimos 7 días.")}
              </p>
            )}
            {candidates?.map((c) => (
              <button
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  if (!pairing) return;
                  void onMarkInternal(pairing.id, c.id);
                  setPairing(null);
                }}
              >
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(c.occurred_at).toLocaleDateString(locale)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {c.counterparty ?? c.description ?? c.raw_text?.slice(0, 50) ?? "—"}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {accountName.get(c.account_id) ?? "?"}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold tabular-nums",
                    c.amount === pairing?.amount
                      ? "text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  {c.direction === "out" ? "−" : "+"}
                  {COP.format(c.amount)}
                </span>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            title={tr("No counterpart — e.g. cash withdrawal where only one side was notified", "Sin contraparte — ej. retiro en efectivo donde solo llegó un lado")}
            onClick={() => {
              if (!pairing) return;
              void onMarkInternal(pairing.id, null);
              setPairing(null);
            }}
          >
            {tr("Mark alone (no other side)", "Marcar sola (sin otro lado)")}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={nmTx != null} onOpenChange={(o) => !o && setNmTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Not mine", "No es mía")}</DialogTitle>
            <DialogDescription>
              {nmTx &&
                `${COP.format(nmTx.amount)} — ${tr("excluded from your totals either way. What is it?", "excluida de tus totales de cualquier forma. ¿Qué es?")}`}
            </DialogDescription>
          </DialogHeader>
          {nmTx?.direction === "out" && (
            <>
              <Input
                value={nmName}
                onChange={(e) => setNmName(e.target.value)}
                placeholder={tr("Who is it for?", "¿Para quién es?")}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => {
                  void onFavor(nmTx, nmName);
                  setNmTx(null);
                }}
              >
                {tr("Favor — they owe me", "Favor — me debe")}
              </Button>
            </>
          )}
          {nmTx?.direction === "in" &&
            debts.filter((d) => d.status === "open" && d.direction === "owed_to_me")
              .length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">
                  {tr("Is this paying back an open debt?", "¿Es el pago de una deuda abierta?")}
                </p>
                {debts
                  .filter(
                    (d) => d.status === "open" && d.direction === "owed_to_me",
                  )
                  .map((d) => (
                    <button
                      key={d.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        void onRepayment(nmTx, d.id);
                        setNmTx(null);
                      }}
                    >
                      <span className="truncate">
                        {tr("Repayment", "Pago")} — {d.counterparty}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-semibold tabular-nums",
                          d.amount === nmTx.amount
                            ? "text-emerald-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {COP.format(d.amount)}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          <Button
            variant="outline"
            size="sm"
            title={tr("Just pass-through money — no tracking", "Solo plata de paso — sin tracking")}
            onClick={() => {
              if (!nmTx) return;
              void onNotMine(nmTx.id);
              setNmTx(null);
            }}
          >
            {tr("Just pass-through", "Solo pass-through")}
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Comida: food purchases grouped by category, per month ─────────────────────

function Comida({
  items,
  purchases,
  month,
  onShift,
  onAddPurchase,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onRemovePurchase,
}: {
  items: FoodItem[];
  purchases: FoodPurchase[];
  month: Date;
  onShift: (d: number) => void;
  onAddPurchase: (
    item: FoodItem,
    expression: string,
    day: string,
    amount: number,
  ) => Promise<void>;
  onAddItem: (name: string, group: string) => Promise<void>;
  onUpdateItem: (id: string, name: string, group: string) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onRemovePurchase: (p: FoodPurchase) => Promise<void>;
}) {
  const { t, locale } = useT();
  const [openItem, setOpenItem] = useState<FoodItem | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGroup, setEditGroup] = useState("");
  const [expr, setExpr] = useState("");
  const [day, setDay] = useState("");
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState("");

  const prefix = monthKey(month).slice(0, 7); // YYYY-MM
  const monthPurchases = useMemo(
    () => purchases.filter((p) => p.purchased_at.startsWith(prefix)),
    [purchases, prefix],
  );
  const byItem = useMemo(() => {
    const m = new Map<string, { total: number; n: number }>();
    for (const p of monthPurchases) {
      const acc = m.get(p.item_id) ?? { total: 0, n: 0 };
      acc.total += p.amount;
      acc.n += 1;
      m.set(p.item_id, acc);
    }
    return m;
  }, [monthPurchases]);
  const groups = useMemo(() => {
    const m = new Map<string, FoodItem[]>();
    for (const i of items) {
      const list = m.get(i.group_name) ?? [];
      list.push(i);
      m.set(i.group_name, list);
    }
    return [...m.entries()];
  }, [items]);
  const monthTotal = monthPurchases.reduce((a, p) => a + p.amount, 0);
  const parsed = expr.trim() ? parsePriceExpression(expr) : null;
  const openPurchases = openItem
    ? monthPurchases.filter((p) => p.item_id === openItem.id)
    : [];

  const openDialog = (item: FoodItem) => {
    setOpenItem(item);
    setExpr("");
    setEditing(false);
    setConfirmDelete(false);
    setEditName(item.name);
    setEditGroup(item.group_name);
    setDay(
      prefix === monthKey(new Date()).slice(0, 7)
        ? new Date().toISOString().slice(0, 10)
        : `${prefix}-01`,
    );
  };

  return (
    <Card className="h-full overflow-y-auto">
      <CardHeader className="grid-cols-[auto_1fr_auto_auto] items-center pb-2">
        <Button size="icon" variant="ghost" onClick={() => onShift(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <CardTitle className="min-w-0 truncate justify-self-center text-center text-base capitalize">
          {fmtMonth(month, locale)}
        </CardTitle>
        <Button size="icon" variant="ghost" onClick={() => onShift(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => setNewItemOpen(true)}
        >
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">{t("New food", "Nuevo alimento")}</span>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* big month total */}
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            {t("Food total this month", "Total del mes en comida")}
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {COP.format(monthTotal)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t("cash only · click an item to log a purchase", "solo efectivo · click en un item para registrar")}
          </p>
        </div>

        {/* collapsible groups */}
        {groups.map(([group, list]) => {
          const isOpen = openGroups.has(group);
          const bought = list.filter((i) => byItem.has(i.id)).length;
          const groupTotal = list.reduce(
            (a, i) => a + (byItem.get(i.id)?.total ?? 0),
            0,
          );
          return (
            <div key={group}>
              <button
                onClick={() =>
                  setOpenGroups((s) => {
                    const n = new Set(s);
                    if (n.has(group)) n.delete(group);
                    else n.add(group);
                    return n;
                  })
                }
                className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <span className="text-sm font-medium">
                  {isOpen ? "▾" : "▸"} {group}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {bought}/{list.length}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    groupTotal > 0 ? "text-emerald-400" : "text-muted-foreground",
                  )}
                >
                  {COP.format(groupTotal)}
                </span>
              </button>
              {isOpen && (
                <div className="mt-1 grid gap-1 pl-4 md:grid-cols-2">
                  {list.map((item) => {
                    const agg = byItem.get(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => openDialog(item)}
                        className="flex cursor-pointer items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
                      >
                        <span className={cn(!agg && "text-muted-foreground/70")}>
                          {item.name}
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            agg ? "text-emerald-400" : "text-muted-foreground",
                          )}
                        >
                          {agg
                            ? `${agg.n}× · ${COP.format(agg.total)}`
                            : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* item dialog: expression input, date, purchase log */}
        <Dialog
          open={!!openItem}
          onOpenChange={(o) => {
            if (!o) setOpenItem(null);
          }}
        >
          <DialogContent>
            {openItem && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {openItem.name}
                    <button
                      onClick={() => setEditing((e) => !e)}
                      title={t("Edit item", "Editar item")}
                      className="rounded p-1 text-muted-foreground/60 hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </DialogTitle>
                  <DialogDescription className="capitalize">
                    {fmtMonth(month, locale)} · {t("cash", "efectivo")} · {openItem.group_name}
                  </DialogDescription>
                </DialogHeader>

                {editing && (
                  <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder={t("Name", "Nombre")}
                      className="h-8"
                    />
                    <GroupPicker
                      groups={groups.map(([g]) => g)}
                      value={editGroup}
                      onChange={setEditGroup}
                    />
                    <div className="flex justify-between gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          if (!confirmDelete) {
                            setConfirmDelete(true);
                            return;
                          }
                          await onDeleteItem(openItem.id);
                          setOpenItem(null);
                        }}
                      >
                        {confirmDelete ? t("Confirm delete?", "¿Confirm delete?") : t("Delete item", "Eliminar item")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editName.trim() || !editGroup.trim()}
                        onClick={async () => {
                          await onUpdateItem(
                            openItem.id,
                            editName.trim(),
                            editGroup.trim(),
                          );
                          setEditing(false);
                        }}
                      >
                        {t("Save", "Guardar")}
                      </Button>
                    </div>
                  </div>
                )}

                {openPurchases.length > 0 && (
                  <div className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60 text-xs">
                    {openPurchases.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-1.5"
                      >
                        <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                          {p.purchased_at.slice(8, 10)}/
                          {p.purchased_at.slice(5, 7)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {p.expression ?? ""}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {COP.format(p.amount)}
                        </span>
                        <button
                          onClick={() => void onRemovePurchase(p)}
                          title={t("Delete purchase", "Eliminar compra")}
                          className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-red-400"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Input
                    value={expr}
                    onChange={(e) => setExpr(e.target.value)}
                    placeholder={t("e.g. 5200+2600+13500", "ej. 5200+2600+13500")}
                    inputMode="decimal"
                    autoFocus
                  />
                  <p
                    className={cn(
                      "text-xs",
                      !expr.trim()
                        ? "text-muted-foreground"
                        : parsed === null
                          ? "text-red-400"
                          : "text-emerald-400",
                    )}
                  >
                    {!expr.trim()
                      ? "Total: —"
                      : parsed === null
                        ? t("Check the numbers (use + to add)", "Revisa los números (usa + para sumar)")
                        : `Total: ${COP.format(parsed)}`}
                  </p>
                </div>

                <Input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={parsed === null || !day}
                    onClick={async () => {
                      if (parsed === null) return;
                      await onAddPurchase(openItem, expr.trim(), day, parsed);
                      setExpr("");
                    }}
                  >
                    {t("Save", "Guardar")}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* new food item */}
        <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("New food", "Nuevo alimento")}</DialogTitle>
              <DialogDescription>
                {t("Existing groups", "Grupos existentes")}: {groups.map(([g]) => g).join(", ")}
              </DialogDescription>
            </DialogHeader>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("Food name", "Nombre del alimento")}
              autoFocus
            />
            <GroupPicker
              groups={groups.map(([g]) => g)}
              value={newGroup}
              onChange={setNewGroup}
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                disabled={!newName.trim() || !newGroup.trim()}
                onClick={async () => {
                  await onAddItem(newName.trim(), newGroup.trim());
                  setNewName("");
                  setNewGroup("");
                  setNewItemOpen(false);
                }}
              >
                {t("Save", "Guardar")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Group selector: dropdown of existing groups + "new group" free-text. */
function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useT();
  const [custom, setCustom] = useState(false);
  if (custom)
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("New group", "Nuevo grupo")}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setCustom(false);
        }}
      />
    );
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => {
        if (v === "__new") {
          onChange("");
          setCustom(true);
        } else if (v) {
          onChange(v);
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("Group", "Grupo")} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectItem key={g} value={g}>
            {g}
          </SelectItem>
        ))}
        <SelectItem value="__new">+ {t("New group…", "Nuevo grupo…")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Investment sources: prestamos, inversiones y ahorros voluntarios ─────────────

const SOURCE_KINDS: SavingsSource["kind"][] = ["loan", "investment", "other"];

function SavingsSources({
  sources,
  incomeTx,
  savingsTx,
  monthKey,
  onSave,
  onDelete,
}: {
  sources: SavingsSource[];
  incomeTx: Transaction[];
  savingsTx: Transaction[];
  monthKey: string;
  onSave: (s: Partial<SavingsSource> & { id?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useT();
  const kindLabel = (k: SavingsSource["kind"]) =>
    k === "loan" ? t("Loan", "Prestamo") : k === "investment" ? t("Investment", "Inversion") : t("Other", "Otro");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<SavingsSource | null>(null);
  const [f, setF] = useState({
    name: "",
    kind: "loan" as SavingsSource["kind"],
    direction: "in" as "in" | "out",
    principal: "",
    rate: "",
    expected: "",
    pattern: "",
  });
  const [confirmDel, setConfirmDel] = useState(false);
  // El esperado se calcula solo como capital x tasa% — si lo editas a
  // mano queda fijo hasta que vuelvas a abrir el dialogo.
  const [expectedManual, setExpectedManual] = useState(false);
  const autoExpected = (principal: string, rate: string) => {
    const p = parsePriceExpression(principal) ?? 0;
    const r = parseFloat(rate);
    return p > 0 && !isNaN(r) && r > 0
      ? fmtAmt(String(Math.round((p * r) / 100)))
      : "";
  };

  const openEdit = (s: SavingsSource | null) => {
    setExpectedManual(false);
    setEdit(s);
    setF({
      name: s?.name ?? "",
      kind: s?.kind ?? "loan",
      direction: s?.direction ?? "in",
      principal: s?.principal ? fmtAmt(String(s.principal)) : "",
      rate: s?.rate_pct != null ? String(s.rate_pct) : "",
      expected: s?.expected_monthly ? fmtAmt(String(s.expected_monthly)) : "",
      pattern: s?.pattern ?? "",
    });
    setConfirmDel(false);
    setOpen(true);
  };

  const [expanded, setExpanded] = useState(false);

  const received = (s: SavingsSource) => {
    const pool = s.direction === "in" ? incomeTx : savingsTx;
    const re = s.pattern ? new RegExp(s.pattern, "i") : null;
    // tipos `in` que aportan ahorro sin ser income
    const SAVINGS_IN = ["interest", "debt_repayment", "sponsorship"];
    return pool
      .filter((t) => {
        if (attrMonth(t) !== monthKey) return false;
        if (re)
          return (
            (s.direction !== "in" || SAVINGS_IN.includes(t.type ?? "")) &&
            re.test(`${t.counterparty ?? ""} ${t.description ?? ""}`)
          );
        return (
          s.direction === "in" &&
          (t.type === "interest" || t.type === "debt_repayment")
        );
      })
      .reduce((a, t) => a + t.amount, 0);
  };

  const met = sources.filter(
    (s) =>
      s.active &&
      (s.expected_monthly > 0
        ? received(s) >= s.expected_monthly
        : received(s) > 0),
  ).length;

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="cursor-pointer text-left text-sm font-medium"
        >
          {expanded ? "▾" : "▸"} {t("Investment sources", "Fuentes de inversión")}
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            {sources.filter((s) => s.active).length
              ? `${met}/${sources.filter((s) => s.active).length} ${t("on track", "al día")}`
              : t("none", "ninguna")}
          </span>
        </button>
        <Button size="sm" variant="outline" onClick={() => openEdit(null)}>
          <Plus className="size-3.5" /> {t("Add", "Agregar")}
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
        {sources.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("No sources — add loans, investments or sponsorships.", "No hay fuentes — agrega prestamos, inversiones o patrocinios.")}
          </p>
        )}
        {sources.map((s) => {
          const got = s.active ? received(s) : 0;
          const done =
            s.expected_monthly > 0 ? got >= s.expected_monthly : got > 0;
          const partial = got > 0 && !done;
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 px-3 py-2 text-sm",
                !s.active && "opacity-50",
              )}
            >
              {done ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
              ) : partial ? (
                <CircleDot className="size-3.5 shrink-0 text-amber-400" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate font-medium">
                  {s.name}
                  <span className="ml-1.5 text-[10px] font-normal uppercase text-muted-foreground">
                    {kindLabel(s.kind)}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {s.principal > 0 && `${t("capital", "capital")} ${COP.format(s.principal)}`}
                  {s.rate_pct != null && ` · ${s.rate_pct}%/${t("mo", "mes")}`}
                  {s.expected_monthly > 0 &&
                    ` · ${t("expects", "espera")} ${COP.format(s.expected_monthly)}/${t("mo", "mes")}`}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {s.direction === "in" ? "+" : "−"} {COP.format(got)}
                  {s.expected_monthly > 0 &&
                    ` / ${COP.format(s.expected_monthly)}`}
                </span>
                <button
                  onClick={() => void onSave({ id: s.id, active: !s.active })}
                  title={s.active ? t("Deactivate", "Desactivar") : t("Activate", "Activar")}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] uppercase",
                    s.active
                      ? "text-emerald-400/80 hover:text-emerald-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.active ? "on" : "off"}
                </button>
                <button
                  onClick={() => openEdit(s)}
                  title={t("Edit investment source", "Editar fuente")}
                  className="rounded p-1 text-muted-foreground/60 hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? t("Edit investment source", "Editar fuente") : t("New investment source", "Nueva fuente")}</DialogTitle>
            <DialogDescription>
              {t("Loans, investments or sponsorships that feed the savings progress.", "Prestamos, inversiones o patrocinios que aportan al savings progress.")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder={t("Name (e.g. Loan uncle)", "Nombre (ej. Prestamo tio)")}
            autoFocus
          />
          <div className="flex gap-2">
            <Select
              value={f.kind}
              onValueChange={(v) =>
                v && setF({ ...f, kind: v as SavingsSource["kind"] })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("Type", "Tipo")} />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {kindLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={f.direction}
              onValueChange={(v) =>
                v && setF({ ...f, direction: v as "in" | "out" })
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">{t("I receive money", "Recibo plata")}</SelectItem>
                <SelectItem value="out">{t("I send money", "Envio plata")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Input
              value={f.principal}
              onChange={(e) => {
                const principal = fmtAmt(e.target.value);
                setF({
                  ...f,
                  principal,
                  ...(expectedManual
                    ? {}
                    : { expected: autoExpected(principal, f.rate) }),
                });
              }}
              placeholder={t("Capital (e.g. 500000)", "Capital (ej. 500000)")}
              inputMode="numeric"
            />
            <Input
              value={f.rate}
              onChange={(e) => {
                const rate = e.target.value;
                setF({
                  ...f,
                  rate,
                  ...(expectedManual
                    ? {}
                    : { expected: autoExpected(f.principal, rate) }),
                });
              }}
              placeholder={t("% monthly", "% mensual")}
              inputMode="decimal"
              className="w-32"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={f.expected}
              onChange={(e) => {
                setExpectedManual(true);
                setF({ ...f, expected: fmtAmt(e.target.value) });
              }}
              placeholder={t("Expected per month (auto: capital x %)", "Esperado por mes (auto: capital x %)")}
              inputMode="numeric"
            />
            <Input
              value={f.pattern}
              onChange={(e) => setF({ ...f, pattern: e.target.value })}
              placeholder={t("Regex (optional)", "Regex (opcional)")}
            />
          </div>
          <div className="flex justify-between gap-2">
            {edit ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (!confirmDel) {
                    setConfirmDel(true);
                    return;
                  }
                  await onDelete(edit.id);
                  setOpen(false);
                }}
              >
                {confirmDel ? t("Confirm delete?", "¿Confirm delete?") : t("Delete", "Eliminar")}
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              disabled={!f.name.trim()}
              onClick={async () => {
                await onSave({
                  id: edit?.id,
                  name: f.name.trim(),
                  kind: f.kind,
                  direction: f.direction,
                  principal: parsePriceExpression(f.principal) ?? 0,
                  rate_pct: f.rate.trim() ? parseFloat(f.rate) : null,
                  expected_monthly: parsePriceExpression(f.expected) ?? 0,
                  pattern: f.pattern.trim() || null,
                });
                setOpen(false);
              }}
            >
              {t("Save", "Guardar")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Deudas: favores y prestamos puntuales que me deben (o que debo) ───────────

function DebtsList({
  debts,
  accounts,
  txById,
  onSave,
  onDelete,
  onRename,
}: {
  debts: Debt[];
  accounts: Account[];
  txById: Map<string, Transaction>;
  onSave: (d: Partial<Debt> & { id?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (from: string, to: string) => Promise<void>;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [f, setF] = useState({ name: "", direction: "owed_to_me" as Debt["direction"], amount: "", note: "", ref: "", card: false });
  const pending = debts.filter((d) => d.status === "open");
  const done = debts.filter((d) => d.status !== "open");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [closedRefs, setClosedRefs] = useState<Set<string>>(new Set());
  const [renamingG, setRenamingG] = useState<string | null>(null);
  const [renameGVal, setRenameGVal] = useState("");
  const [whoOpen, setWhoOpen] = useState(false);
  const [whoIdx, setWhoIdx] = useState(0);
  const [refOpen, setRefOpen] = useState(false);
  const [refIdx, setRefIdx] = useState(0);
  const [dRenaming, setDRenaming] = useState<string | null>(null);
  const [dRenameVal, setDRenameVal] = useState("");
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const whoOptions = () => {
    const q = f.name.trim().toLowerCase();
    return [...new Set(debts.map((d) => d.counterparty))]
      .filter(Boolean)
      .filter((n) => !q || n.toLowerCase().includes(q))
      .sort();
  };
  // Referencias existentes: primero las que ya usa esta persona, luego el resto
  const refOptions = () => {
    const q = f.ref.trim().toLowerCase();
    const own = new Set(
      debts
        .filter((d) => d.counterparty === f.name.trim())
        .map((d) => d.ref?.trim())
        .filter(Boolean) as string[],
    );
    return [
      ...new Set(
        debts.map((d) => d.ref?.trim()).filter(Boolean) as string[],
      ),
    ]
      .filter((r) => !q || r.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(own.has(b)) - Number(own.has(a)) || a.localeCompare(b),
      );
  };
  // Dos niveles: persona -> referencia (Pet, Groceries, Favor...) -> deudas
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, Debt[]>>();
    for (const d of pending) {
      const k = `${d.direction}|${d.counterparty}`;
      const ref = d.ref?.trim() || "General";
      if (!m.has(k)) m.set(k, new Map());
      const sub = m.get(k)!;
      sub.set(ref, [...(sub.get(ref) ?? []), d]);
    }
    return [...m.entries()].map(
      ([k, subs]) =>
        [
          k,
          [...subs.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        ] as const,
    );
  }, [pending]);
  const owedToMe = pending
    .filter((d) => d.direction === "owed_to_me")
    .reduce((a, d) => a + d.amount, 0);
  const iOwe = pending
    .filter((d) => d.direction === "i_owe")
    .reduce((a, d) => a + d.amount, 0);
  const summary = [
    owedToMe > 0 && `${COP.format(owedToMe)} ${t("owed to me", "me deben")}`,
    iOwe > 0 && `${t("I owe", "debo")} ${COP.format(iOwe)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="cursor-pointer text-left text-sm font-medium"
        >
          {expanded ? "▾" : "▸"} {t("Owed to me / I owe", "Me deben / Debo")}
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            {summary || t("nothing pending", "nada pendiente")}
          </span>
        </button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditId(null);
            setF({ name: "", direction: "owed_to_me", amount: "", note: "", ref: "", card: false });
            setOpen(true);
          }}
        >
          <Plus className="size-3.5" /> {t("Add", "Agregar")}
        </Button>
      </div>
      {expanded && (
      <div className="mt-2 flex flex-col gap-1.5">
        {pending.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("Nothing pending — mark an expense as \"Not mine → Favor\" in Review to track it here.", "Nada pendiente — marca un gasto como \"No es mía → Favor\" en Revisión para que aparezca aqui.")}
          </p>
        )}
        {groups.map(([k, subs]) => {
          const [dirKey, name] = k.split("|");
          const all = subs.flatMap(([, rows]) => rows);
          const groupTotal = all.reduce((a, d) => a + d.amount, 0);
          const gOpen = openGroups.has(k);
          return (
            <div key={k} className="rounded-md border border-border/60">
              <div className="flex items-center">
                <button
                  onClick={() =>
                    setOpenGroups((o) => {
                      const n = new Set(o);
                      if (n.has(k)) n.delete(k);
                      else n.add(k);
                      return n;
                    })
                  }
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm"
                >
                  <span className="text-muted-foreground">
                    {gOpen ? "▾" : "▸"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {name}
                    <span className="ml-1.5 text-[10px] font-normal uppercase text-muted-foreground">
                      {dirKey === "owed_to_me" ? t("owes me", "me debe") : t("I owe", "le debo")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {all.length}×
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {COP.format(groupTotal)}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setRenamingG(renamingG === k ? null : k);
                    setRenameGVal(name);
                  }}
                  title={t("Rename person (merge groups)", "Renombrar persona (une los grupos)")}
                  className="mr-2 shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
              </div>
              {renamingG === k && (
                <div className="flex items-center gap-2 border-t border-border/40 pl-6 pr-3 py-1.5">
                  <Input
                    value={renameGVal}
                    onChange={(e) => setRenameGVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameGVal.trim()) {
                        void onRename(name, renameGVal.trim());
                        setRenamingG(null);
                      }
                      if (e.key === "Escape") setRenamingG(null);
                    }}
                    className="h-7 flex-1 text-xs"
                    placeholder={t("Merge into / rename to…", "Unir en / renombrar a…")}
                    autoFocus
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {t("Enter = rename all", "Enter = renombra todo")}
                  </span>
                </div>
              )}
              {gOpen &&
                subs.map(([ref, rows]) => {
                  const rKey = `${k}::${ref}`;
                  const singleGeneral =
                    subs.length === 1 && ref === "General";
                  const rOpen = singleGeneral || !closedRefs.has(rKey);
                  const subTotal = rows.reduce((a, d) => a + d.amount, 0);
                  return (
                    <div key={rKey}>
                      {!singleGeneral && (
                        <button
                          onClick={() =>
                            setClosedRefs((o) => {
                              const n = new Set(o);
                              if (n.has(rKey)) n.delete(rKey);
                              else n.add(rKey);
                              return n;
                            })
                          }
                          className="flex w-full cursor-pointer items-center gap-2 border-t border-border/40 pl-6 pr-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                        >
                          <span>{rOpen ? "▾" : "▸"}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {ref}
                          </span>
                          <span>{rows.length}×</span>
                          <span className="tabular-nums">
                            {COP.format(subTotal)}
                          </span>
                        </button>
                      )}
                      {rOpen &&
                        rows.map((d) => {
                          const lt = d.tx_id
                            ? txById.get(d.tx_id)
                            : undefined;
                          const txLabel =
                            lt?.label || lt?.counterparty || lt?.description;
                          return (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 border-t border-border/30 pl-9 pr-3 py-1.5 text-sm"
                  >
                    <CircleDot className="size-3 shrink-0 text-amber-400" />
                    <span className="w-14 shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
                      {new Date(d.created_at).toLocaleDateString(locale, {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {txLabel && (
                        <span className="text-foreground/80">{txLabel}</span>
                      )}
                      {cleanDebtNote(d.note) &&
                        `${txLabel ? " · " : ""}${cleanDebtNote(d.note)}`}
                    </span>
                    <span className="w-20 shrink-0 truncate text-right text-[10px] text-muted-foreground/60">
                      {lt ? (accountName.get(lt.account_id) ?? "?") : ""}
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums">
                      {COP.format(d.amount)}
                    </span>
                    {/prev:\w+/.test(d.note ?? "") ? (
                      <button
                        onClick={() => void onDelete(d.id)}
                        title={t("Move back to expenses", "Devolver a gastos")}
                        className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    ) : (
                      <span className="w-[22px] shrink-0" />
                    )}
                    <button
                      onClick={() =>
                        void onSave({
                          id: d.id,
                          exclude_from_savings: !d.exclude_from_savings,
                        })
                      }
                      title={
                        d.exclude_from_savings
                          ? t("Card: it pays the card back (doesn't count as savings) — click to count it", "Tarjeta: vuelve a pagar la tarjeta (no cuenta como ahorro) — click para contarla")
                          : t("Mark as card payment — doesn't count as savings", "Marcar como pago con tarjeta — no cuenta como ahorro")
                      }
                      className={cn(
                        "shrink-0 rounded p-1 transition-colors",
                        d.exclude_from_savings
                          ? "bg-sky-500/15 text-sky-400 hover:text-sky-300"
                          : "text-muted-foreground/40 hover:text-foreground",
                      )}
                    >
                      <CreditCard className="size-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setEditId(d.id);
                        setF({
                          name: d.counterparty,
                          direction: d.direction,
                          amount: fmtAmt(String(d.amount)),
                          note: cleanDebtNote(d.note),
                          ref: d.ref ?? "",
                          card: d.exclude_from_savings,
                        });
                        setOpen(true);
                      }}
                      title={t("Edit", "Editar")}
                      className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        void onSave({
                          id: d.id,
                          status: "settled",
                          settled_at: new Date().toISOString(),
                        })
                      }
                      title={t("Mark as paid", "Marcar pagada")}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase text-emerald-400/80 hover:text-emerald-300"
                    >
                      {t("paid", "pagada")}
                    </button>
                    <button
                      onClick={() => void onDelete(d.id)}
                      title={t("Delete", "Eliminar")}
                      className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  );
                        })}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {done.length > 0 && (
          <button
            className="mt-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDone((s) => !s)}
          >
            {showDone ? "▾" : "▸"} {done.length} {t("settled/cancelled", "pagadas/canceladas")}
          </button>
        )}
        {showDone &&
          done.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-3 py-1 text-xs text-muted-foreground"
            >
              <CheckCircle2 className="size-3 shrink-0 text-emerald-400/60" />
              <span className="min-w-0 flex-1 truncate">{d.counterparty}</span>
              <span className="tabular-nums">{COP.format(d.amount)}</span>
            </div>
          ))}
      </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? t("Edit debt", "Editar deuda") : t("New debt", "Nueva deuda")}</DialogTitle>
            <DialogDescription>
              {t("A favor or one-off loan you want to track.", "Favor o prestamo puntual que quieres rastrear.")}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Input
              value={f.name}
              onChange={(e) => {
                setF({ ...f, name: e.target.value });
                setWhoOpen(true);
                setWhoIdx(0);
              }}
              onFocus={() => {
                setWhoOpen(true);
                setWhoIdx(0);
              }}
              onBlur={() => {
                if (dRenaming == null)
                  setTimeout(() => setWhoOpen(false), 150);
              }}
              onKeyDown={(e) => {
                const opts = whoOptions();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setWhoOpen(true);
                  setWhoIdx((i) => Math.min(i + 1, opts.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setWhoIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && f.name.trim()) {
                  e.preventDefault();
                  const pick = opts[Math.min(whoIdx, opts.length - 1)];
                  if (pick) setF({ ...f, name: pick });
                  setWhoOpen(false);
                } else if (e.key === "Escape") setWhoOpen(false);
              }}
              placeholder={t("Who?", "Quien?")}
              autoFocus
            />
            {(whoOpen || dRenaming != null) &&
              (() => {
                const people = whoOptions();
                const q = f.name.trim().toLowerCase();
                const totals = new Map<string, number>();
                for (const d of pending)
                  totals.set(
                    d.counterparty,
                    (totals.get(d.counterparty) ?? 0) +
                      (d.direction === "owed_to_me" ? d.amount : -d.amount),
                  );
                const exact = people.some((n) => n.toLowerCase() === q);
                return (
                  <div className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                    {people.map((n, i) =>
                      dRenaming === n ? (
                        <div key={n} className="flex items-center gap-1 px-2 py-1">
                          <Input
                            value={dRenameVal}
                            onChange={(e) => setDRenameVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && dRenameVal.trim()) {
                                void onRename(n, dRenameVal.trim());
                                setF((p) => ({ ...p, name: dRenameVal.trim() }));
                                setDRenaming(null);
                              }
                              if (e.key === "Escape") setDRenaming(null);
                            }}
                            autoFocus
                            className="h-6 text-xs"
                          />
                        </div>
                      ) : (
                        <div
                          key={n}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent",
                            i === whoIdx && "bg-accent",
                          )}
                          onMouseEnter={() => setWhoIdx(i)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setF({ ...f, name: n });
                            setWhoOpen(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{n}</span>
                          {totals.get(n) != null && totals.get(n) !== 0 && (
                            <span
                              className={cn(
                                "shrink-0 tabular-nums text-[10px]",
                                (totals.get(n) ?? 0) > 0
                                  ? "text-emerald-400"
                                  : "text-red-400",
                              )}
                            >
                              {COP.format(Math.abs(totals.get(n) ?? 0))}
                            </span>
                          )}
                          <button
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDRenaming(n);
                              setDRenameVal(n);
                            }}
                            title={t("Rename everywhere", "Renombrar en todos lados")}
                            className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                        </div>
                      ),
                    )}
                    {q && !exact && (
                      <div
                        className="flex cursor-pointer items-center gap-2 border-t border-border/40 px-2 py-1.5 text-xs text-emerald-400 hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setWhoOpen(false);
                        }}
                      >
                        + {t("Add", "Agregar")} &quot;{f.name.trim()}&quot;
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
          <Select
            value={f.direction}
            onValueChange={(v) =>
              v && setF({ ...f, direction: v as Debt["direction"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owed_to_me">{t("Owes me", "Me debe")}</SelectItem>
              <SelectItem value="i_owe">{t("I owe them", "Le debo")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: fmtAmt(e.target.value) })}
            placeholder={t("Amount", "Monto")}
            inputMode="decimal"
          />
          <div className="relative">
            <Input
              value={f.ref}
              onChange={(e) => {
                setF({ ...f, ref: e.target.value });
                setRefOpen(true);
                setRefIdx(0);
              }}
              onFocus={() => {
                setRefOpen(true);
                setRefIdx(0);
              }}
              onBlur={() => setTimeout(() => setRefOpen(false), 150)}
              onKeyDown={(e) => {
                const opts = refOptions();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setRefOpen(true);
                  setRefIdx((i) => Math.min(i + 1, opts.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setRefIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = opts[Math.min(refIdx, opts.length - 1)];
                  if (pick) setF({ ...f, ref: pick });
                  setRefOpen(false);
                } else if (e.key === "Escape") setRefOpen(false);
              }}
              placeholder="Reference (e.g. Groceries, Pet, Favor)"
            />
            {refOpen &&
              (() => {
                const refs = refOptions();
                const q = f.ref.trim().toLowerCase();
                const exact = refs.some((r) => r.toLowerCase() === q);
                if (!refs.length && !q) return null;
                return (
                  <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                    {refs.map((r, i) => (
                      <div
                        key={r}
                        className={cn(
                          "cursor-pointer px-2 py-1.5 text-xs hover:bg-accent",
                          i === refIdx && "bg-accent",
                        )}
                        onMouseEnter={() => setRefIdx(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setF({ ...f, ref: r });
                          setRefOpen(false);
                        }}
                      >
                        {r}
                      </div>
                    ))}
                    {q && !exact && (
                      <div
                        className="cursor-pointer border-t border-border/40 px-2 py-1.5 text-xs text-emerald-400 hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setRefOpen(false);
                        }}
                      >
                        + {t("Add", "Agregar")} &quot;{f.ref.trim()}&quot;
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
          <Input
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            placeholder="Note — what is this for? (optional)"
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={f.card}
              onChange={(e) => setF({ ...f, card: e.target.checked })}
              className="accent-emerald-500"
            />
            {t("Paid by card — that money pays the card back (doesn't count as savings)", "Se pagó con tarjeta — esa plata vuelve a la tarjeta (no cuenta como ahorro)")}
          </label>
          <Button
            size="sm"
            disabled={!f.name.trim() || !((parsePriceExpression(f.amount) ?? 0) > 0)}
            onClick={() => {
              const srcNote = editId
                ? (debts.find((x) => x.id === editId)?.note ?? "")
                : "";
              const tags = [
                ...(srcNote.match(/prev:\w+/) ?? []),
                ...(srcNote.match(/split:[\d.]+/) ?? []),
              ];
              void onSave({
                id: editId ?? undefined,
                counterparty: f.name.trim(),
                direction: f.direction,
                amount: parsePriceExpression(f.amount) ?? 0,
                note: tags.length
                  ? `${f.note.trim() || t("Debt", "Deuda")} | ${tags.join(" | ")}`
                  : f.note.trim() || null,
                ref: f.ref.trim() || null,
                exclude_from_savings: f.card,
              });
              setOpen(false);
              setEditId(null);
              setF({ name: "", direction: "owed_to_me", amount: "", note: "", ref: "", card: false });
            }}
          >
            {t("Save", "Guardar")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add: alta manual de un gasto o ingreso ───────────────────────────────────

const IN_KINDS = [
  "income",
  "interest",
  "debt_repayment",
  "sponsorship",
  "family_savings",
] as const;

function AddTx({
  preset,
  bucket,
  card,
  accounts,
  categories,
  month,
  onAdd,
}: {
  preset: "out" | "in";
  bucket?: "needs" | "wants" | "savings";
  card?: boolean;
  accounts: Account[];
  categories: Category[];
  month: Date;
  onAdd: (f: NewTx) => Promise<void>;
}) {
  const { t } = useT();
  const inKindLabel = (v: string) =>
    ({
      income: t("Income", "Ingreso"),
      interest: t("Interest", "Intereses"),
      debt_repayment: t("Debt repayment", "Pago de deuda"),
      sponsorship: t("Sponsorship", "Patrocinio"),
      family_savings: t("Family savings", "Ahorro familiar"),
    })[v] ?? v;
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"out" | "in">(preset);
  const [expr, setExpr] = useState("");
  const [desc, setDesc] = useState("");
  const [acc, setAcc] = useState("");
  const [cat, setCat] = useState("");
  const [kind, setKind] = useState("income");
  const [date, setDate] = useState("");
  const [split, setSplit] = useState(false);
  const [splitName, setSplitName] = useState("Daniela Bella");

  const total = parsePriceExpression(expr);
  const outBuckets = bucket ? [bucket] : ["needs", "wants", "savings"];
  const label =
    preset === "in"
      ? t("income", "ingreso")
      : bucket
        ? bucket.slice(0, -1)
        : t("expense", "gasto");

  const openDialog = () => {
    const now = new Date();
    const first = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
    setDir(preset);
    setExpr("");
    setDesc("");
    setAcc(accounts.find((a) => a.name === "Efectivo")?.id ?? accounts[0]?.id ?? "");
    setCat("");
    setKind("income");
    setSplit(false);
    setSplitName("");
    setDate(
      now.getFullYear() === month.getFullYear() &&
        now.getMonth() === month.getMonth()
        ? now.toISOString().slice(0, 10)
        : first,
    );
    setOpen(true);
  };

  return (
    <>
      {card ? (
        <button
          onClick={openDialog}
          title={`${t("Add", "Agregar")} ${label}`}
          className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-3 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      ) : (
        <button
          onClick={openDialog}
          title={`${t("Add", "Agregar")} ${label}`}
          className="cursor-pointer self-center text-xl leading-none text-muted-foreground transition-colors hover:text-foreground"
        >
          +
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dir === "in" ? t("Add income", "Agregar ingreso") : `${t("Add expense", "Agregar gasto")}${bucket ? ` — ${bucket}` : ""}`}</DialogTitle>
            <DialogDescription>
              {dir === "in"
                ? t("Income without notification — cash freelance, deposit, etc.", "Ingreso sin notificacion — freelance en efectivo, consignacion, etc.")
                : t("Manual expense — cash or payments without notification.", "Gasto manual — efectivo o pagos sin notificacion.")}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Input
              value={expr}
              onChange={(e) => setExpr(fmtAmt(e.target.value))}
              placeholder="5200+2600+13500"
              inputMode="decimal"
              autoFocus
            />
            {expr && (
              <p className="mt-1 text-xs text-emerald-400">
                ={" "}
                {total != null
                  ? split && dir === "out"
                    ? `${t("you", "tu")}: ${COP.format(Math.round(total / 2))} · ${splitName || "?"}: ${COP.format(total - Math.round(total / 2))}`
                    : COP.format(total)
                  : t("invalid expression", "expresion invalida")}
              </p>
            )}
          </div>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={dir === "out" ? t("For what / to whom", "En que / a quien") : t("From whom / concept", "De quien / concepto")}
          />
          <div className="flex gap-2">
            <Select value={acc} onValueChange={(v) => v && setAcc(v)}>
              <SelectTrigger className="flex-1">
                <SelectValue>
                  {() => accounts.find((a) => a.id === acc)?.name ?? t("Account…", "Cuenta…")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
            />
          </div>
          {dir === "out" ? (
            <Select value={cat} onValueChange={(v) => v && setCat(v)}>
              <SelectTrigger>
                <SelectValue>
                  {() =>
                    categories.find((c) => c.id === cat)?.name ??
                    t("Category (none → Review)", "Categoría (sin categoría → Revisión)")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {outBuckets.map((b) => (
                  <div key={b}>
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {b}
                    </p>
                    {categories
                      .filter((c) => c.bucket === b)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={kind} onValueChange={(v) => v && setKind(v)}>
              <SelectTrigger>
                <SelectValue>
                  {() => inKindLabel(kind)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {IN_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {inKindLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {dir === "out" && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={split}
                onCheckedChange={(c) => {
                  setSplit(c === true);
                  if (
                    c === true &&
                    categories.find((x) => x.id === cat)?.name === "Pet"
                  )
                    setSplitName("Daniela Bella");
                }}
              />
              <span className="text-xs text-muted-foreground">
                {t("Split — the other half is owed to me by", "Dividir — la otra mitad me la debe")}
              </span>
              <Input
                value={splitName}
                onChange={(e) => setSplitName(e.target.value)}
                className="h-7 w-28 text-xs"
                placeholder={t("Who?", "¿Quién?")}
              />
            </div>
          )}
          <Button
            size="sm"
            disabled={total == null || !acc || !date}
            onClick={() => {
              if (total == null) return;
              const catObj = categories.find((c) => c.id === cat);
              const type =
                dir === "in"
                  ? kind
                  : catObj?.bucket === "savings"
                    ? "savings"
                    : "expense";
              void onAdd({
                account_id: acc,
                occurred_at: `${date}T12:00:00`,
                direction: dir,
                amount: total,
                counterparty: desc.trim() || null,
                type,
                category_id:
                  dir === "in"
                    ? (categories.find(
                        (c) => c.bucket === "none" && c.name === "Other",
                      )?.id ?? null)
                    : cat || null,
                needs_review: dir === "out" && !cat,
                splitWith:
                  dir === "out" && split && splitName.trim()
                    ? splitName.trim()
                    : undefined,
              });
              setOpen(false);
            }}
          >
            {t("Save", "Guardar")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
