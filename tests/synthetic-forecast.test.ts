import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSyntheticHistory } from "../src/lib/synthetic-history";
import { demandForecasts } from "../src/lib/forecast";
import { MEALS } from "../src/lib/types";

test("Synthetic History: dataset has 120 consecutive days, 360 records, and valid schema", () => {
  const { history, metadata } = loadSyntheticHistory();

  assert.equal(metadata.totalDays, 120);
  assert.equal(metadata.totalRecords, 360);
  assert.equal(history.length, 360);

  // Check unique meal records per day
  const mealsByDate = new Map<string, Set<string>>();
  for (const record of history) {
    assert.equal(record.isSynthetic, true);
    assert.ok(record.served >= 0);
    assert.ok(record.prepared >= record.served);
    if (!mealsByDate.has(record.date)) {
      mealsByDate.set(record.date, new Set());
    }
    const meals = mealsByDate.get(record.date)!;
    assert.ok(!meals.has(record.meal), `Duplicate meal record on ${record.date}: ${record.meal}`);
    meals.add(record.meal);
  }

  assert.equal(mealsByDate.size, 120);
  for (const [d, meals] of mealsByDate.entries()) {
    assert.equal(meals.size, 3, `Date ${d} should have all 3 meals`);
  }
});

test("Synthetic History: date alignment shifts dates consecutively relative to target date", () => {
  const targetDate = "2026-11-15";
  const { history, metadata } = loadSyntheticHistory(targetDate);

  // The last completed observation should be targetDate - 1 day (2026-11-14)
  assert.equal(metadata.endDate, "2026-11-14");
  assert.equal(metadata.totalDays, 120);

  // Check that the last records in history have date 2026-11-14
  const lastDateRecords = history.filter((r) => r.date === "2026-11-14");
  assert.equal(lastDateRecords.length, 3);
});

test("Forecast Integration: demandForecasts flags synthetic predictions and respects buffer", async () => {
  const today = "2026-10-29";
  const { history } = loadSyntheticHistory(today);

  // When ML service is not running or not configured, it gracefully falls back to local baseline
  const forecasts = await demandForecasts(history, today, 0.08, { isSynthetic: true });

  assert.equal(forecasts.length, 3);
  for (const f of forecasts) {
    assert.ok(MEALS.includes(f.meal));
    assert.equal(f.isSynthetic, true);
    assert.ok(f.predicted !== null && f.predicted > 0);
    assert.ok(f.prepare !== null && f.prepare >= f.predicted);
  }
});

test("Data Isolation: live database queries are untouched when synthetic mode is not requested", async () => {
  const originalEnv = process.env.FORECAST_DEMO_DATA;
  const originalUrl = process.env.DATABASE_URL;
  delete process.env.FORECAST_DEMO_DATA;
  process.env.DATABASE_URL = "postgres://mock:mock@127.0.0.1:5432/mock";

  try {
    const { managerOverview } = await import("../src/lib/service");
    const { getPool, closePool } = await import("../src/lib/db");
    const pool = getPool();
    const executedQueries: string[] = [];
    const origQuery = pool.query.bind(pool);

    pool.query = (async (text: string, values?: unknown[]) => {
      executedQueries.push(text);
      if (text.includes("settings")) {
        return {
          rows: [
            {
              value: {
                messName: "South Mess",
                windows: {},
                prices: {},
                safetyBuffer: 0.05,
                timeZone: "Asia/Kolkata",
                configured: true,
                leavePolicy: "flag",
                addons: [],
              },
            },
          ],
        };
      }
      if (text.includes("FROM leaves") && text.includes("count(")) return { rows: [{ count: 0 }] };
      if (text.includes("balance")) return { rows: [{ balance: "0" }] };
      return { rows: [] };
    }) as typeof pool.query;

    const mockManager = {
      id: "10000000-0000-4000-8000-000000000001",
      collegeId: "MGR001",
      name: "Test Manager",
      role: "manager" as const,
      messId: "south-mess",
      active: true,
    };

    // Standard call without synthetic flag
    const result = await managerOverview(mockManager);
    assert.equal(result.history.length, 0); // Reads from mock DB (0 rows)
    assert.ok(!result.forecasts.some((f) => f.isSynthetic), "Live forecasts must not be marked synthetic");

    // Call with explicit forecastSource="synthetic"
    const syntheticResult = await managerOverview(mockManager, "synthetic");
    assert.equal(syntheticResult.history.length, 360);
    assert.ok(syntheticResult.forecasts.every((f) => f.isSynthetic), "Synthetic forecasts must be marked synthetic");

    // Call with environment variable override FORECAST_DEMO_DATA="true"
    process.env.FORECAST_DEMO_DATA = "true";
    const envResult = await managerOverview(mockManager);
    assert.equal(envResult.history.length, 360);
    assert.ok(envResult.forecasts.every((f) => f.isSynthetic), "Env override must mark forecasts synthetic");

    pool.query = origQuery;
    await closePool();
  } finally {
    if (originalEnv !== undefined) process.env.FORECAST_DEMO_DATA = originalEnv;
    else delete process.env.FORECAST_DEMO_DATA;
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
    else delete process.env.DATABASE_URL;
  }
});
