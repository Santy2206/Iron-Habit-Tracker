export type CapitalCategory =
  | "productive"
  | "intellectual"
  | "social"
  | "spiritual"
  | "physical";

export interface CapitalDef {
  id: CapitalCategory;
  label: string;
  short: string;
  emoji: string;
  /** hex used for blocks, chips, chart slices */
  color: string;
  /** Google Calendar colorId mapped to this capital */
  gcalColorId: string;
}

export const CAPITALS: Record<CapitalCategory, CapitalDef> = {
  productive: {
    id: "productive",
    label: "Capital · Productive",
    short: "Productive",
    emoji: "🟣",
    color: "#ae9cce",
    gcalColorId: "3", // grape
  },
  intellectual: {
    id: "intellectual",
    label: "Capital · Intellectual",
    short: "Intellectual",
    emoji: "🔵",
    color: "#828bc2",
    gcalColorId: "9", // blueberry
  },
  social: {
    id: "social",
    label: "Capital · Social",
    short: "Social",
    emoji: "🔴",
    color: "#ca4d31",
    gcalColorId: "11", // tomato
  },
  spiritual: {
    id: "spiritual",
    label: "Capital · Spiritual",
    short: "Spiritual",
    emoji: "💜",
    color: "#a75aba",
    gcalColorId: "1", // lavender
  },
  physical: {
    id: "physical",
    label: "Capital · Physical",
    short: "Physical",
    emoji: "🟢",
    color: "#429a8e",
    gcalColorId: "10", // basil
  },
};

export const CAPITAL_LIST = Object.values(CAPITALS);

export const GCAL_COLOR_TO_CAPITAL: Record<string, CapitalCategory> =
  Object.fromEntries(
    CAPITAL_LIST.map((c) => [c.gcalColorId, c.id]),
  ) as Record<string, CapitalCategory>;
