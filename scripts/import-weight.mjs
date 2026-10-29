// One-time import: ../data/weight_data.json -> Supabase weight/diet tables.
// Usage: node scripts/import-weight.mjs [user_id]
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the repo-root .env.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let userId = process.argv[2];
if (!userId) {
  const { data } = await supabase.auth.admin.listUsers();
  if (data.users.length !== 1) {
    console.error(
      `Found ${data.users.length} users — pass the id explicitly:\n` +
        data.users.map((u) => `  ${u.id}  ${u.email}`).join("\n"),
    );
    process.exit(1);
  }
  userId = data.users[0].id;
}
console.log(`Importing for user ${userId}`);

const raw = JSON.parse(
  readFileSync(path.join(repoRoot, "data", "weight_data.json"), "utf8"),
);

// daily_weights -> weight_entries (weekly_averages are recomputed by the app)
const daily = raw.daily_weights ?? {};
const rows = Object.entries(daily).map(([entry_date, weight_lb]) => ({
  user_id: userId,
  entry_date,
  weight_lb,
  source: "imported",
}));
const { error: weErr } = await supabase
  .from("weight_entries")
  .upsert(rows, { onConflict: "user_id,entry_date" });
if (weErr) throw weErr;
console.log(`weight_entries: ${rows.length} rows`);

// diet -> diet_settings
if (raw.diet) {
  const d = raw.diet;
  const { error } = await supabase.from("diet_settings").upsert({
    user_id: userId,
    phase: d.phase ?? "cut",
    calorie_intake: d.calorie_intake ?? 2300,
    protein_g: d.protein_g ?? 215,
    carbs_g: d.carbs_g ?? 149,
    fat_g: d.fat_g ?? 94,
    protein_per_lb: d.protein_per_lb ?? 1.15,
  });
  if (error) throw error;
  console.log(`diet_settings: phase=${d.phase}`);
}

// diet_history -> diet_history
const hist = (raw.diet_history ?? []).map((h) => ({
  user_id: userId,
  changed_on: h.date ?? h.changed_on,
  phase: h.phase ?? "cut",
  calorie_intake: h.calorie_intake,
  protein_g: h.protein_g,
  carbs_g: h.carbs_g,
  fat_g: h.fat_g,
}));
if (hist.length) {
  const { error } = await supabase.from("diet_history").insert(hist);
  if (error) throw error;
  console.log(`diet_history: ${hist.length} rows`);
}

console.log("Done.");
