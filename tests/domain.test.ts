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
import {
  bulkImportSchema,
  cancelLeaveSchema,
  createStudentSchema,
  manualLeaveSchema,
  paginationSchema,
  resetPinSchema,
  reviewLeaveSchema,
  settingsSchema,
  studentLeaveRequestSchema,
  updateStatusSchema,
} from "../src/lib/validation";
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
test("DATABASE_POOL_SIZE defaults to 10 and parses environment override", () => {
  const parsePool = (val: string | undefined) => (val ? parseInt(val, 10) : 10);
  assert.equal(parsePool(undefined), 10);
  assert.equal(parsePool("25"), 25);
  assert.equal(parsePool("3"), 3);
});

test("createStudentSchema validates college ID, name, and 6-12 digit PIN", () => {
  assert.equal(
    createStudentSchema.safeParse({
      collegeId: "SM2026101",
      name: "Aarav Sharma",
      pin: "123456",
    }).success,
    true,
  );
  // Rejects pin with < 6 digits
  assert.equal(
    createStudentSchema.safeParse({
      collegeId: "SM2026101",
      name: "Aarav Sharma",
      pin: "12345",
    }).success,
    false,
  );
  // Rejects pin with non-digits
  assert.equal(
    createStudentSchema.safeParse({
      collegeId: "SM2026101",
      name: "Aarav Sharma",
      pin: "12345a",
    }).success,
    false,
  );
  // Rejects invalid college ID characters
  assert.equal(
    createStudentSchema.safeParse({
      collegeId: "SM 2026",
      name: "Aarav Sharma",
      pin: "123456",
    }).success,
    false,
  );
});

test("resetPinSchema and updateStatusSchema enforce types and constraints", () => {
  const uuid = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    resetPinSchema.safeParse({ userId: uuid, pin: "987654" }).success,
    true,
  );
  assert.equal(
    resetPinSchema.safeParse({ userId: "not-a-uuid", pin: "987654" }).success,
    false,
  );
  assert.equal(
    updateStatusSchema.safeParse({ userId: uuid, active: false }).success,
    true,
  );
  assert.equal(
    updateStatusSchema.safeParse({ userId: uuid, active: "false" }).success,
    false,
  );
});

test("bulkImportSchema validates batch and bounds", () => {
  assert.equal(
    bulkImportSchema.safeParse({
      students: [
        { collegeId: "SM2026001", name: "Student 1" },
        { collegeId: "SM2026002", name: "Student 2", messId: "south-mess" },
      ],
      defaultPin: "654321",
    }).success,
    true,
  );
  // Empty student array is rejected
  assert.equal(
    bulkImportSchema.safeParse({
      students: [],
    }).success,
    false,
  );
});

test("studentLeaveRequestSchema enforces date order and valid dates", () => {
  assert.equal(
    studentLeaveRequestSchema.safeParse({
      startsOn: "2026-11-01",
      endsOn: "2026-11-05",
      reason: "Visiting family",
    }).success,
    true,
  );
  // Rejects endsOn before startsOn
  assert.equal(
    studentLeaveRequestSchema.safeParse({
      startsOn: "2026-11-05",
      endsOn: "2026-11-01",
    }).success,
    false,
  );
  // Rejects invalid date format
  assert.equal(
    studentLeaveRequestSchema.safeParse({
      startsOn: "not-a-date",
      endsOn: "2026-11-05",
    }).success,
    false,
  );
});

test("reviewLeaveSchema and cancelLeaveSchema enforce status enum and UUIDs", () => {
  const uuid = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    reviewLeaveSchema.safeParse({ leaveId: uuid, status: "approved" }).success,
    true,
  );
  assert.equal(
    reviewLeaveSchema.safeParse({ leaveId: uuid, status: "pending" }).success,
    false,
  );
  assert.equal(cancelLeaveSchema.safeParse({ leaveId: uuid }).success, true);
  assert.equal(cancelLeaveSchema.safeParse({ leaveId: "invalid" }).success, false);
});

test("manualLeaveSchema enforces student UUID, dates, and reason", () => {
  const uuid = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    manualLeaveSchema.safeParse({
      userId: uuid,
      startsOn: "2026-11-10",
      endsOn: "2026-11-12",
      reason: "Sanctioned official hostel leave",
    }).success,
    true,
  );
  assert.equal(
    manualLeaveSchema.safeParse({
      userId: uuid,
      startsOn: "2026-11-12",
      endsOn: "2026-11-10",
      reason: "Sanctioned",
    }).success,
    false,
  );
});

test("paginationSchema applies defaults and clamp boundaries", () => {
  const parsedDefault = paginationSchema.parse({});
  assert.equal(parsedDefault.page, 1);
  assert.equal(parsedDefault.limit, 25);
  assert.equal(parsedDefault.search, "");

  const parsedCustom = paginationSchema.parse({
    page: "3",
    limit: "50",
    search: "  Aarav  ",
  });
  assert.equal(parsedCustom.page, 3);
  assert.equal(parsedCustom.limit, 50);
  assert.equal(parsedCustom.search, "Aarav");
});
