import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  baselineForecast,
  csvCell,
  defaultSettings,
  inMealWindow,
  isDate,
  localTime,
} from "../src/lib/domain";
import { settingsSchema } from "../src/lib/validation";
import { hashPin, verifyPin } from "../src/lib/auth";

test("service dates use the configured time zone and handle day rollover", () => {
  assert.deepEqual(
    localTime(new Date("2026-10-19T19:00:00Z"), "Asia/Kolkata"),
    { date: "2026-10-20", time: "00:30" },
  );
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate("2028-02-29"), true);
});
test("meal windows include opening and exclude closing time", () => {
  const window = { start: "12:00", end: "14:30" };
  assert.equal(inMealWindow("11:59", window), false);
  assert.equal(inMealWindow("12:00", window), true);
  assert.equal(inMealWindow("14:29", window), true);
  assert.equal(inMealWindow("14:30", window), false);
});
test("forecast cannot read future observations and reports cold start honestly", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    date: addDays("2026-01-01", i),
    meal: "lunch" as const,
    served: 100 + i * 10,
    prepared: 180,
  }));
  const result = baselineForecast(
    [
      ...rows,
      { date: "2026-01-20", meal: "lunch", served: 99999, prepared: 99999 },
    ],
    "lunch",
    "2026-01-09",
    0.1,
  );
  assert.equal(result.predicted, 140);
  assert.equal(result.prepare, 154);
  assert.equal(result.mae, 40);
  assert.equal(result.sampleDays, 8);
  assert.equal(
    baselineForecast([], "lunch", "2026-01-09", 0.05).predicted,
    null,
  );
});
test("CSV exports quote data and neutralize spreadsheet formulas", () => {
  assert.equal(
    csvCell('=HYPERLINK("https://example.com")'),
    '"\'=HYPERLINK(""https://example.com"")"',
  );
  assert.equal(csvCell("normal, value"), '"normal, value"');
  assert.equal(csvCell("  +1"), '"\'  +1"');
});
test("policy rejects overlapping windows and duplicate add-on IDs", () => {
  const policy = defaultSettings();
  assert.equal(settingsSchema.safeParse(policy).success, true);
  assert.equal(
    settingsSchema.safeParse({
      ...policy,
      windows: { ...policy.windows, lunch: { start: "08:00", end: "14:00" } },
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...policy,
      addons: [policy.addons[0], policy.addons[0]],
    }).success,
    false,
  );
});
test("PINs are salted and only the correct PIN verifies", async () => {
  const a = await hashPin("847291"),
    b = await hashPin("847291");
  assert.notEqual(a, b);
  assert.equal(await verifyPin("847291", a), true);
  assert.equal(await verifyPin("847292", a), false);
  assert.equal(await verifyPin("847291", "not-a-hash"), false);
});
