import type { CapitalCategory } from "./capitals";

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: CapitalCategory;
  start_at: string; // ISO
  end_at: string; // ISO
  all_day: boolean;
  gcal_event_id: string | null;
  source: "local" | "gcal";
  task_id: string | null;
  deleted: boolean;
}

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done";

export const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

export type Priority = "low" | "medium" | "high" | "urgent";

export const PRIORITY_META: Record<Priority, { label: string; color: string }> =
  {
    low: { label: "Low", color: "#64748b" },
    medium: { label: "Medium", color: "#3b82f6" },
    high: { label: "High", color: "#f59e0b" },
    urgent: { label: "Urgent", color: "#ef4444" },
  };

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  category: CapitalCategory | null;
  labels: string[];
  subtasks: Subtask[];
  due_date: string | null;
  position: number;
}

export interface Todo {
  id: string;
  user_id: string;
  title: string;
  done: boolean;
  urgent: boolean;
  due_date: string | null;
  position: number;
}

// ─── Physical capital (migrated from features/physical) ──────────────────────

export interface WeightEntry {
  entry_date: string; // YYYY-MM-DD
  weight_lb: number;
  source: "manual" | "gfit" | "imported";
}

export type DietPhase = "cut" | "bulk";

export interface DietSettings {
  user_id: string;
  phase: DietPhase;
  calorie_intake: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  protein_per_lb: number;
  height_cm?: number | null;
}

export interface DietHistoryEntry {
  id: string;
  user_id: string;
  changed_on: string; // YYYY-MM-DD
  phase: DietPhase;
  calorie_intake: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export const DEFAULT_DIET: Omit<DietSettings, "user_id"> = {
  phase: "cut",
  calorie_intake: 2300,
  protein_g: 215,
  carbs_g: 149,
  fat_g: 94,
  protein_per_lb: 1.15,
};

// ─── Productive capital: Finance (tables owned by the legacy Python schema) ──

export interface Account {
  id: string;
  name: string;
  role: "operating" | "credit" | "savings";
}

export interface Category {
  id: string;
  name: string;
  bucket: "needs" | "wants" | "savings" | "none";
}

export interface Transaction {
  id: string;
  account_id: string;
  occurred_at: string;
  direction: "in" | "out";
  amount: number;
  type: string | null;
  category_id: string | null;
  counterparty: string | null;
  description: string | null;
  source: "email" | "notification" | "statement" | "manual";
  raw_text: string | null;
  needs_review: boolean;
  real_month?: string;
  budget_month?: string;
  label?: string | null;
  original_amount?: number | null;
}

export interface Debt {
  id: string;
  created_at: string;
  counterparty: string;
  direction: "owed_to_me" | "i_owe";
  amount: number;
  tx_id: string | null;
  repaid_tx_id: string | null;
  status: "open" | "settled" | "cancelled";
  settled_at: string | null;
  note: string | null;
  ref: string | null;
  exclude_from_savings: boolean;
}

export interface MonthlyBudgetRow {
  month: string;
  income: number;
  needs_goal: number;
  needs_spent: number;
  needs_available: number;
  wants_goal: number;
  wants_spent: number;
  wants_available: number;
  savings_goal: number;
  savings_actual: number;
  savings_available: number;
  unclassified_expense: number;
  sponsorship_income: number;
  interest_income: number;
  debt_repayment_income: number;
  family_savings_income: number;
}

export interface MonthlyCommitment {
  id: string;
  name: string;
  direction: "in" | "out";
  pattern: string;
  expected_amount: number;
  sort_order: number;
  counts_as_savings: boolean;
}

export interface SavingsProgressRow {
  month: string;
  target: number;
  sent: number;
  cumulative_target: number;
  cumulative_sent: number;
  remaining: number;
}

export interface SavingsGoal {
  name: string;
  target: number;
  /** bolsillo que llena esta meta: ef = ahorro del income (default),
   *  patrocinio = pagos de Accenture, intereses = intereses recibidos */
  source?: "ef" | "patrocinio" | "intereses";
}

export interface SavingsAccount {
  label: string;
  amount: number;
  /** regex contra counterparty/description/label de depositos de ahorro:
   *  los que coincidan se suman a esta cuenta automaticamente */
  pattern?: string;
  /** solo depositos desde esta fecha cuentan (para no duplicar lo ya incluido
   *  en `amount`) — vacio = todos */
  since?: string;
  /** fuente de ahorro vinculada — su patron hace el auto-match y al
   *  pausarla la cuenta deja de absorber depositos */
  source_id?: string;
}

export interface BudgetSplit {
  id: boolean;
  needs_pct: number;
  wants_pct: number;
  savings_pct: number;
  income_cutoff_day: number | null;
  tracking_start: string;
  savings_baseline: number;
  global_savings_target: number;
  savings_goals: SavingsGoal[];
  baseline_accounts: SavingsAccount[];
}

export interface FoodItem {
  id: string;
  name: string;
  group_name: string;
  sort_order: number;
  active: boolean;
}

export interface SavingsSource {
  id: string;
  name: string;
  kind: "loan" | "investment" | "voluntary" | "other";
  direction: "in" | "out";
  principal: number;
  rate_pct: number | null;
  expected_monthly: number;
  pattern: string | null;
  active: boolean;
  note: string | null;
  sort_order: number;
  created_at: string;
}

export interface FoodPurchase {
  id: string;
  item_id: string;
  purchased_at: string;
  amount: number;
  expression: string | null;
  note: string | null;
  paid_cash: boolean;
  transaction_id: string | null;
}

// ─── Intellectual capital ─────────────────────────────────────────────────────

export interface Flashcard {
  id: string;
  user_id: string;
  deck: string;
  front: string;
  back: string;
  next_review: string; // YYYY-MM-DD
  interval_days: number;
  ease: number;
  reps: number;
}
