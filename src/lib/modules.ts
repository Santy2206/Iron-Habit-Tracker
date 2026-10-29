import type { LucideIcon } from "lucide-react";
import {
  Apple,
  CalendarClock,
  Coins,
} from "lucide-react";
import type { CapitalCategory } from "./capitals";

export interface ModuleDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * App modules grouped by capital — mirrors the IRON sidebar structure.
 * Each capital expands to its sub-modules; Time Manager lives under
 * Productive. Capitals with no implemented module render as empty lists
 * and are hidden from the sidebar.
 */
export const CAPITAL_MODULES: Record<CapitalCategory, ModuleDef[]> = {
  physical: [{ id: "diet", label: "Diet", icon: Apple }],
  productive: [
    { id: "time-manager", label: "Time Manager", icon: CalendarClock },
    { id: "finance", label: "Finance", icon: Coins },
  ],
  intellectual: [],
  social: [],
  spiritual: [],
};

export type ModuleId = `${CapitalCategory}.${string}`;

export function moduleKey(capital: CapitalCategory, moduleId: string): ModuleId {
  return `${capital}.${moduleId}`;
}
