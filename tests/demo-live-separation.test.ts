import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateSyntheticUsage,
  generateSyntheticExceptions,
  generateSyntheticLeaves,
  generateSyntheticStudents,
  isSyntheticData,
  assertNotSynthetic,
  SYNTHETIC_SEED,
  SYNTHETIC_COMPLETED_DAYS,
} from "../src/lib/synthetic-data";
import { demoHistory } from "../src/lib/demo-history";
import { demandForecasts } from "../src/lib/forecast";
import { MEALS, type Meal, type Usage, type User } from "../src/lib/types";
import { addDays, localTime } from "../src/lib/domain";
import { hashPin } from "../src/lib/auth";
import {
  saveUsage,
  saveSettings,
  adjustLedger,
  orderAddon,
  scanMeal,
} from "../src/lib/service";

test("1. Deterministic generation: same seed and date produce identical records", () => {
  const testDate = "2026-11-06";
  const run1 = generateSyntheticUsage(testDate, 84, SYNTHETIC_SEED);
  const run2 = generateSyntheticUsage(testDate, 84, SYNTHETIC_SEED);

  assert.equal(run1.length, run2.length);
  assert.deepEqual(run1, run2, "Both runs with seed 20261106 must produce identical records");

  // Changing seed produces different records
  const run3 = generateSyntheticUsage(testDate, 84, 99999999);
  assert.notDeepEqual(run1, run3, "Different seed must produce different pseudorandom sequence");
});

test("2. Minimum history: generator produces >= 42 completed observations per meal with no missing dates", () => {
  const testDate = "2026-11-06";
  const history = generateSyntheticUsage(testDate, 84);

  // Total rows: (84 completed days + 1 partial day) * 3 meals = 255 rows
  assert.equal(history.length, (84 + 1) * 3);

  // Verify completed records (excluding today)
  const completed = history.filter((h) => h.date < testDate);
  assert.equal(completed.length, 84 * 3);

  for (const meal of MEALS) {
    const mealRecords = completed.filter((h) => h.meal === meal);
    assert.equal(
      mealRecords.length,
      84,
      `Meal ${meal} must have exactly 84 completed days (>= 42 minimum requirement)`,
    );
    assert.ok(
      mealRecords.length >= 42,
      `Meal ${meal} satisfies ML threshold (84 >= 42)`,
    );

    // Verify contiguous dates with no gaps
    const dates = mealRecords.map((r) => r.date).sort();
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(`${dates[i - 1]}T12:00:00Z`).getTime();
      const curr = new Date(`${dates[i]}T12:00:00Z`).getTime();
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      assert.equal(diffDays, 1, `Dates must be strictly contiguous between ${dates[i - 1]} and ${dates[i]}`);
    }

    // Verify realistic food waste and attendance
    for (const record of mealRecords) {
      assert.ok(record.served > 0, "Served count must be positive");
      assert.ok(record.prepared >= record.served, "Prepared count must be >= served count");
      assert.equal(
        record.foodWaste,
        record.prepared - record.served,
        "Food waste must equal prepared - served",
      );
      assert.ok(record.attendanceRate > 0 && record.attendanceRate <= 100, "Attendance rate must be valid %");
    }
  }
});

test("3. Demo mode: demoHistory returns 84 days and feeds demandForecasts properly", async () => {
  const testDate = "2026-11-06";
  const history = demoHistory(testDate);

  assert.equal(history.length, (SYNTHETIC_COMPLETED_DAYS + 1) * 3);

  // Run demandForecasts on synthetic demo history without ML service configured
  // It falls back honestly to rolling baseline with sampleDays = 84
  const forecasts = await demandForecasts(history, testDate, 0.05);
  assert.equal(forecasts.length, 3);
  for (const f of forecasts) {
    assert.equal(f.sampleDays, 84);
    assert.ok(f.predicted! > 0, "Forecast predicted value must be positive");
    assert.ok(f.prepare! >= f.predicted!, "Preparation must include buffer");
  }
});

test("4. Live mode: honest cold-start reporting when < 42 completed days exist", async () => {
  const savedUrl = process.env.ML_SERVICE_URL;
  const savedKey = process.env.ML_API_KEY;
  try {
    const testDate = "2026-11-06";
    // 5 completed days in live pilot
    const pilotHistory: Usage[] = [];
    for (let i = 5; i >= 1; i--) {
      const date = addDays(testDate, -i);
      for (const meal of MEALS) {
        pilotHistory.push({
          date,
          meal,
          served: 35,
          prepared: 40,
        });
      }
    }

    // Case A: When ML service is unconfigured, reports "not_configured" with rolling baseline
    delete process.env.ML_SERVICE_URL;
    delete process.env.ML_API_KEY;
    const unconfigForecasts = await demandForecasts(pilotHistory, testDate, 0.05);
    for (const f of unconfigForecasts) {
      assert.equal(f.mlStatus, "not_configured");
      assert.equal(f.sampleDays, 5);
      assert.equal(f.method, "7-day rolling baseline");
    }

    // Case B: When ML service is configured but completed history < 7 days (< 42 for XGBoost)
    process.env.ML_SERVICE_URL = "http://127.0.0.1:8000";
    process.env.ML_API_KEY = "test-ml-api-key-at-least-32-chars-long";
    const insufficientForecasts = await demandForecasts(pilotHistory, testDate, 0.05);
    for (const f of insufficientForecasts) {
      assert.equal(f.mlStatus, "insufficient_history");
      assert.equal(f.sampleDays, 5);
      assert.equal(f.method, "7-day rolling baseline");
    }
  } finally {
    if (savedUrl !== undefined) process.env.ML_SERVICE_URL = savedUrl;
    else delete process.env.ML_SERVICE_URL;
    if (savedKey !== undefined) process.env.ML_API_KEY = savedKey;
    else delete process.env.ML_API_KEY;
  }
});

test("5. Infiltration prevention: assertNotSynthetic blocks synthetic users and payloads from DB write functions", async () => {
  const syntheticUser: User = {
    id: "demo-user-123",
    collegeId: "SM2026001",
    name: "Aarav Shah",
    role: "student",
    messId: "south-mess-demo",
    active: true,
  };

  assert.equal(isSyntheticData(syntheticUser), true);

  // Assert defensive rejection on service operations
  assert.throws(
    () => assertNotSynthetic(syntheticUser, "saveUsage (user)"),
    /\[CRITICAL SECURITY\] saveUsage \(user\) rejected: Synthetic demonstration data cannot be written to production database\./,
  );

  // Test scanMeal rejects synthetic user
  await assert.rejects(
    async () => await scanMeal(syntheticUser, "invalid-token"),
    /Synthetic demonstration data cannot be written to production database/,
  );

  // Test saveSettings rejects synthetic user
  await assert.rejects(
    async () =>
      await saveSettings(syntheticUser, {
        messName: "Hacked Mess",
        leavePolicy: "flag",
        safetyBuffer: 0.05,
        prices: { breakfast: 3000, lunch: 5000, dinner: 4500 },
        windows: {
          breakfast: { start: "07:30", end: "09:30" },
          lunch: { start: "12:30", end: "14:30" },
          dinner: { start: "19:30", end: "21:30" },
        },
        addons: [],
      }),
    /Synthetic demonstration data cannot be written to production database/,
  );

  // Test saveUsage rejects synthetic payload
  const validManager: User = {
    id: "30000000-0000-4000-8000-000000000001",
    collegeId: "MGR001",
    name: "Real Manager",
    role: "manager",
    messId: "prod-mess-id",
    active: true,
  };

  const syntheticPayload = {
    date: "2026-11-06",
    meal: "lunch" as Meal,
    prepared: 45,
    source: "synthetic-demo",
  };

  assert.throws(
    () => assertNotSynthetic(syntheticPayload, "saveUsage (input)"),
    /Synthetic demonstration data cannot be written to production database/,
  );

  // Test adjustLedger rejects synthetic user
  await assert.rejects(
    async () =>
      await adjustLedger(syntheticUser, {
        userId: "target-student",
        amount: 1000,
        note: "Synthetic bonus",
        requestId: "req-1",
      }),
    /Synthetic demonstration data cannot be written to production database/,
  );

  // Test orderAddon rejects synthetic user
  await assert.rejects(
    async () =>
      await orderAddon(syntheticUser, {
        addonId: "egg",
        quantity: 1,
        requestId: "req-2",
      }),
    /Synthetic demonstration data cannot be written to production database/,
  );
});

test("6. Synthetic exceptions, leaves and students generators are structured and deterministic", () => {
  const testDate = "2026-11-06";
  const students = generateSyntheticStudents();
  assert.equal(students.length, 48);
  assert.ok(students.every((s) => s.messId === "south-mess-demo"));
  assert.ok(students.every((s) => s.role === "student"));

  const exceptions = generateSyntheticExceptions(testDate, students);
  assert.equal(exceptions.length, 3);
  assert.equal(exceptions[0].reason, "DUPLICATE");
  assert.equal(exceptions[1].reason, "APPROVED_LEAVE");
  assert.equal(exceptions[2].reason, "LEAVE_FLAG");
  assert.ok(exceptions.every((e) => isSyntheticData(e)));

  const leaves = generateSyntheticLeaves(testDate, students);
  assert.equal(leaves.length, 4);
  assert.ok(leaves.every((l) => l.status === "approved"));
});

test("7. Security preservation: PIN hashing and salting verify correctly", async () => {
  const pin = "1234";
  const hashed = await hashPin(pin);
  assert.ok(hashed.startsWith("scrypt:"));

  // Verify another hash of same PIN uses a fresh random salt
  const hashed2 = await hashPin(pin);
  assert.notEqual(hashed, hashed2, "Each salt must be cryptographically random");
});
