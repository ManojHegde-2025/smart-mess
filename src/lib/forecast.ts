// Server-only integration: never import this file into client components.
import { createHash } from "node:crypto";
import { z } from "zod";
import { addDays, baselineForecast, isDate } from "./domain";
import { MEALS, type Forecast, type Usage } from "./types";

const count = z.number().int().min(0).max(150_000);
const errorMetric = z.number().finite().min(0).nullable();
const responseSchema = z
  .object({
    predicted: count,
    prepare: count,
    lower: count,
    upper: count,
    method: z.string().min(1).max(120),
    mae: errorMetric,
    baseline_mae: errorMetric,
    candidate_mae: errorMetric,
    evaluation_rows: z.number().int().min(0).max(730),
    sample_days: z.number().int().min(7).max(730),
    horizon_days: z.number().int().positive(),
    history_through: z.string().refine(isDate),
    model_version: z.string().min(1).max(80),
    status: z.enum([
      "selected",
      "baseline_preferred",
      "insufficient_history",
      "gapped_history",
      "unsupported_horizon",
    ]),
    reason: z.string().min(1).max(500),
  })
  .refine(
    (r) =>
      r.prepare >= r.predicted &&
      r.lower <= r.predicted &&
      r.predicted <= r.upper,
    "Inconsistent forecast quantities",
  );

const cache = new Map<string, { expires: number; value: Forecast }>();
const pending = new Map<string, Promise<Forecast>>();

export async function demandForecasts(
  history: Usage[],
  today: string,
  safetyBuffer: number,
): Promise<Forecast[]> {
  // Today may still be in progress; future observations are never training data.
  const completed = history.filter((row) => row.date < today);
  return Promise.all(
    MEALS.map(async (meal) => {
      const baseline: Forecast = {
        ...baselineForecast(completed, meal, addDays(today, 1), safetyBuffer),
        source: "local",
      };
      const url = process.env.ML_SERVICE_URL;
      const key = process.env.ML_API_KEY;
      if (!url || !key || key.length < 32)
        return {
          ...baseline,
          mlStatus: "not_configured",
          note: "ML service is not configured. Showing the local average; connect the Python service to enable model evaluation.",
        };
      const rows = completed
        .filter((row) => row.meal === meal)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-730)
        .map((row) => ({ date: row.date, count: row.served }));
      if (rows.length < 7)
        return {
          ...baseline,
          mlStatus: "insufficient_history",
          note: "Collect at least seven completed days to call the prediction service; Random Forest requires 42 consecutive days.",
        };
      const body = JSON.stringify({
        history: rows,
        target_date: baseline.date,
        safety_buffer: safetyBuffer,
      });
      const id = createHash("sha256")
        .update(JSON.stringify([url, key, meal, body]))
        .digest("hex");
      const saved = cache.get(id);
      if (saved && saved.expires > Date.now()) return saved.value;
      if (pending.has(id)) return pending.get(id)!;
      const request = (async (): Promise<Forecast> => {
        let value: Forecast;
        let lifetime = 300_000;
        try {
          const response = await fetch(`${url.replace(/\/$/, "")}/predict`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key },
            body,
            signal: AbortSignal.timeout(12_000),
            cache: "no-store",
            redirect: "error",
          });
          if (!response.ok) throw new Error("ML service request failed");
          const r = responseSchema.parse(await response.json());
          const horizon = Math.round(
            (Date.parse(baseline.date) - Date.parse(rows.at(-1)!.date)) /
              86_400_000,
          );
          if (
            r.sample_days !== rows.length ||
            r.history_through !== rows.at(-1)!.date ||
            r.horizon_days !== horizon
          )
            throw new Error("Forecast history mismatch");
          value = {
            ...baseline,
            predicted: r.predicted,
            prepare: r.prepare,
            lower: r.lower,
            upper: r.upper,
            method: r.method,
            mae: r.mae,
            source: "python",
            mlStatus: r.status,
            candidateMae: r.candidate_mae,
            baselineMae: r.baseline_mae,
            evaluationDays: r.evaluation_rows,
            horizonDays: r.horizon_days,
            historyThrough: r.history_through,
            modelVersion: r.model_version,
            sampleDays: r.sample_days,
            note: r.reason,
          };
        } catch {
          lifetime = 15_000;
          value = {
            ...baseline,
            mlStatus: "unavailable",
            note: "ML service could not be reached, authenticated, or validated. The local average keeps planning available; retry after checking the service.",
          };
        }
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(id, { expires: Date.now() + lifetime, value });
        return value;
      })();
      pending.set(id, request);
      try {
        return await request;
      } finally {
        pending.delete(id);
      }
    }),
  );
}
