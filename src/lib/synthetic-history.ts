import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { addDays, isDate } from "./domain";
import { MEALS, type Meal, type Usage } from "./types";
import fallbackRecords from "./synthetic-data.json";

export type SyntheticUsage = Usage & {
  isSynthetic: true;
  eventFlag?: string;
  approvedLeaves?: number;
};

export type SyntheticHistoryMetadata = {
  isSynthetic: true;
  totalDays: number;
  totalRecords: number;
  startDate: string;
  endDate: string;
  filePath: string;
};

function resolveCsvPath(): string {
  const candidates = [
    join(process.cwd(), "services", "ml", "data", "synthetic_meal_history.csv"),
    join(__dirname, "..", "..", "services", "ml", "data", "synthetic_meal_history.csv"),
    join(__dirname, "..", "..", "..", "services", "ml", "data", "synthetic_meal_history.csv"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

/**
 * Loads the 120-day synthetic meal attendance dataset from services/ml/data/synthetic_meal_history.csv.
 *
 * @param alignToDate Optional reference date (e.g. today). If provided, shifts the 120-day consecutive
 * window so the most recent completed observation is yesterday (addDays(alignToDate, -1)).
 * This guarantees a valid forecast horizon (1-7 days) regardless of when the demo is run.
 */
export function loadSyntheticHistory(alignToDate?: string): {
  history: SyntheticUsage[];
  metadata: SyntheticHistoryMetadata;
} {
  const csvPath = resolveCsvPath();
  const rawRows: {
    date: string;
    meal: Meal;
    served: number;
    prepared: number;
    approvedLeaves?: number;
    eventFlag?: string;
  }[] = [];

  if (existsSync(csvPath)) {
    const content = readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length >= 2) {
      const header = lines[0].split(",").map((h) => h.trim());
      const dateIdx = header.indexOf("date");
      const mealIdx = header.indexOf("meal");
      const servedIdx = header.indexOf("served");
      const preparedIdx = header.indexOf("prepared");
      const leavesIdx = header.indexOf("approved_leaves");
      const eventIdx = header.indexOf("event_flag");

      if (dateIdx !== -1 && mealIdx !== -1 && servedIdx !== -1 && preparedIdx !== -1) {
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim());
          if (cols.length <= Math.max(dateIdx, mealIdx, servedIdx, preparedIdx)) continue;

          const dateVal = cols[dateIdx];
          const mealVal = cols[mealIdx] as Meal;
          if (!isDate(dateVal) || !MEALS.includes(mealVal)) continue;

          const served = parseInt(cols[servedIdx], 10);
          const prepared = parseInt(cols[preparedIdx], 10);
          const leaves = leavesIdx !== -1 ? parseInt(cols[leavesIdx], 10) : undefined;
          const event = eventIdx !== -1 ? cols[eventIdx] : undefined;

          rawRows.push({
            date: dateVal,
            meal: mealVal,
            served: isNaN(served) ? 0 : Math.max(0, served),
            prepared: isNaN(prepared) ? 0 : Math.max(0, prepared),
            approvedLeaves: isNaN(leaves ?? NaN) ? undefined : leaves,
            eventFlag: event,
          });
        }
      }
    }
  }

  // If CSV was not readable from disk, use the pre-bundled JSON fallback
  if (rawRows.length === 0) {
    for (const r of fallbackRecords as Record<string, unknown>[]) {
      const dateVal = String(r.date);
      const mealVal = String(r.meal) as Meal;
      if (!isDate(dateVal) || !MEALS.includes(mealVal)) continue;
      rawRows.push({
        date: dateVal,
        meal: mealVal,
        served: Number(r.served) || 0,
        prepared: Number(r.prepared) || 0,
        approvedLeaves: r.approved_leaves ? Number(r.approved_leaves) : undefined,
        eventFlag: r.event_flag ? String(r.event_flag) : undefined,
      });
    }
  }

  // Sort raw rows by date ascending, then meal
  rawRows.sort((a, b) => a.date.localeCompare(b.date));

  const uniqueDates = Array.from(new Set(rawRows.map((r) => r.date))).sort();
  const rawStartDate = uniqueDates[0];
  const rawEndDate = uniqueDates[uniqueDates.length - 1];

  let offsetDays = 0;
  if (alignToDate && isDate(alignToDate)) {
    const targetLastDate = addDays(alignToDate, -1);
    const diffMs = Date.parse(targetLastDate) - Date.parse(rawEndDate);
    offsetDays = Math.round(diffMs / 86_400_000);
  }

  const history: SyntheticUsage[] = rawRows.map((r) => {
    const shiftedDate = offsetDays !== 0 ? addDays(r.date, offsetDays) : r.date;
    return {
      date: shiftedDate,
      meal: r.meal,
      served: r.served,
      prepared: r.prepared,
      isSynthetic: true,
      approvedLeaves: r.approvedLeaves,
      eventFlag: r.eventFlag,
    };
  });

  const finalDates = Array.from(new Set(history.map((r) => r.date))).sort();

  return {
    history,
    metadata: {
      isSynthetic: true,
      totalDays: finalDates.length,
      totalRecords: history.length,
      startDate: finalDates[0],
      endDate: finalDates[finalDates.length - 1],
      filePath: csvPath,
    },
  };
}
