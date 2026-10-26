import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { getPool, query, closePool } from "../../src/lib/db";
import { hashPin, login, secret, signSession } from "../../src/lib/auth";
import { defaultSettings } from "../../src/lib/domain";
import {
  adjustLedger,
  issueQr,
  managerOverview,
  orderAddon,
  saveSettings,
  saveUsage,
  scanMeal,
  studentOverview,
  wardenWebhook,
} from "../../src/lib/service";
import { GET, POST } from "../../src/app/api/[...path]/route";
import type { User } from "../../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable database whose name ends in _test. Integration tests clear only that database.",
  );
process.env.DATABASE_URL = url;
process.env.APP_MODE = "live";
process.env.SESSION_SECRET = randomBytes(40).toString("hex");
process.env.QR_SECRET = randomBytes(40).toString("hex");
process.env.WARDEN_WEBHOOK_SECRET = randomBytes(40).toString("hex");
delete process.env.APP_URL;
const manager: User = {
  id: randomUUID(),
  collegeId: "TEST-MANAGER",
  name: "Test Manager",
  role: "manager",
  messId: "south-mess",
  active: true,
};
const student: User = {
  id: randomUUID(),
  collegeId: "TEST-STUDENT",
  name: "Test Student",
  role: "student",
  messId: "south-mess",
  active: true,
};
before(async () => {
  mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-19T07:30:00Z"),
  });
  await getPool().query(await readFile("db/001_initial.sql", "utf8"));
  await query(
    "TRUNCATE integration_events,login_attempts,audit_logs,meal_usage,leaves,ledger_entries,meal_events,settings,users CASCADE",
  );
  const pin = await hashPin("847291");
  for (const user of [manager, student])
    await query(
      "INSERT INTO users(id,college_id,name,role,mess_id,pin_hash) VALUES($1,$2,$3,$4,$5,$6)",
      [user.id, user.collegeId, user.name, user.role, user.messId, pin],
    );
});
beforeEach(async () => {
  await query(
    "TRUNCATE integration_events,login_attempts,audit_logs,meal_usage,leaves,ledger_entries,meal_events,settings CASCADE",
  );
  const config = defaultSettings();
  config.prices.lunch = 7000;
  config.addons[0].price = 2000;
  await saveSettings(manager, config);
});
after(async () => {
  mock.timers.reset();
  await closePool();
});

test("two simultaneous scans record one meal and one debit", async () => {
  const { token } = await issueQr(manager, "lunch");
  const results = await Promise.all([
    scanMeal(student, token),
    scanMeal(student, token),
  ]);
  assert.equal(results.filter((r) => r.accepted).length, 1);
  assert.equal(results.find((r) => !r.accepted)?.reason, "DUPLICATE");
  const overview = await studentOverview(student);
  assert.equal(overview.balance, -7000);
  assert.equal(
    overview.events.filter((e) => e.decision === "accepted").length,
    1,
  );
  assert.equal(overview.ledger.length, 1);
});
test("negative balance never independently blocks a valid meal", async () => {
  await adjustLedger(manager, {
    userId: student.id,
    amount: -100000,
    note: "Test prior amount due",
    requestId: randomUUID(),
  });
  assert.equal(
    (await scanMeal(student, (await issueQr(manager, "lunch")).token)).accepted,
    true,
  );
  assert.equal((await studentOverview(student)).balance, -107000);
});
test("expired, tampered, wrong-mess and out-of-window QR attempts do not charge", async () => {
  const { token } = await issueQr(manager, "lunch");
  await assert.rejects(
    () => scanMeal(student, token + "bad"),
    /invalid or expired/,
  );
  const expired = await new SignJWT({
    messId: "south-mess",
    meal: "lunch",
    date: "2026-10-19",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("smart-mess")
    .setAudience("meal-qr")
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .sign(secret("QR_SECRET"));
  await assert.rejects(() => scanMeal(student, expired), /invalid or expired/);
  const wrong = await new SignJWT({
    messId: "north-mess",
    meal: "lunch",
    date: "2026-10-19",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("smart-mess")
    .setAudience("meal-qr")
    .setExpirationTime("90s")
    .sign(secret("QR_SECRET"));
  assert.equal((await scanMeal(student, wrong)).reason, "WRONG_MESS");
  assert.equal(
    (await scanMeal(student, (await issueQr(manager, "dinner")).token)).reason,
    "OUTSIDE_WINDOW",
  );
  assert.equal((await studentOverview(student)).balance, 0);
});
test("approved leave follows configured block or flag policy", async () => {
  await query(
    "INSERT INTO leaves(id,external_id,user_id,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-10-19','2026-10-20','approved')",
    [randomUUID(), "test-leave", student.id],
  );
  const config = defaultSettings();
  config.leavePolicy = "block";
  config.prices.lunch = 7000;
  await saveSettings(manager, config);
  const { token } = await issueQr(manager, "lunch");
  assert.equal((await scanMeal(student, token)).reason, "APPROVED_LEAVE");
  assert.equal((await studentOverview(student)).balance, 0);
  config.leavePolicy = "flag";
  await saveSettings(manager, config);
  const result = await scanMeal(student, token);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "LEAVE_FLAG");
  assert.ok(result.warning);
});
test("ledger and add-on retries are idempotent, while changed payloads conflict", async () => {
  const adjustment = {
    userId: student.id,
    amount: 10000,
    note: "Test deposit",
    requestId: randomUUID(),
  };
  await Promise.all([
    adjustLedger(manager, adjustment),
    adjustLedger(manager, adjustment),
  ]);
  await assert.rejects(
    () => adjustLedger(manager, { ...adjustment, amount: 20000 }),
    /different data/,
  );
  const addon = { addonId: "milk", quantity: 2, requestId: randomUUID() };
  await Promise.all([orderAddon(student, addon), orderAddon(student, addon)]);
  assert.equal((await studentOverview(student)).balance, 6000);
});
test("API denies anonymous and cross-role access and rejects cross-origin mutations", async () => {
  assert.equal(
    (await GET(new NextRequest("http://localhost/api/manager/overview")))
      .status,
    401,
  );
  const token = await signSession(student, 1);
  const headers = { cookie: `smart_mess_session=${token}` };
  assert.equal(
    (
      await GET(
        new NextRequest("http://localhost/api/manager/overview", { headers }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new NextRequest("http://localhost/api/meals/scan", {
          method: "POST",
          headers: {
            ...headers,
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: "invalid" }),
        }),
      )
    ).status,
    403,
  );
});
test("correct PIN signs in; persistent throttling limits guesses", async () => {
  assert.equal((await login(student.collegeId, "847291")).user.id, student.id);
  for (let i = 0; i < 10; i++)
    await assert.rejects(() => login(student.collegeId, "111111"), /incorrect/);
  await assert.rejects(
    () => login(student.collegeId, "847291"),
    /Too many attempts/,
  );
});
test("Warden webhook validates signatures and deduplicates delivery", async () => {
  const raw = JSON.stringify({
    eventId: randomUUID(),
    collegeId: student.collegeId,
    startsOn: "2026-10-19",
    endsOn: "2026-10-20",
    status: "approved",
    leaveId: "warden-test-1",
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "sha256=" +
    createHmac("sha256", secret("WARDEN_WEBHOOK_SECRET"))
      .update(`${timestamp}.${raw}`)
      .digest("hex");
  await assert.rejects(
    () => wardenWebhook(raw, timestamp, "sha256=" + "0".repeat(64)),
    /authentication/,
  );
  assert.equal(
    (await wardenWebhook(raw, timestamp, signature)).duplicate,
    false,
  );
  assert.equal(
    (await wardenWebhook(raw, timestamp, signature)).duplicate,
    true,
  );
  assert.equal(
    (await query("SELECT * FROM leaves WHERE user_id=$1", [student.id])).length,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT * FROM audit_logs WHERE action='warden.leave-updated'",
      )
    ).length,
    1,
  );
});
test("manager dashboard uses actual records and excludes incomplete-day forecasting data", async () => {
  await saveUsage(manager, { date: "2026-10-19", meal: "lunch", prepared: 3 });
  await scanMeal(student, (await issueQr(manager, "lunch")).token);
  const overview = await managerOverview(manager);
  assert.equal(overview.counts.lunch, 1);
  assert.equal(overview.prepared.lunch, 3);
  assert.equal(overview.activeStudents, 1);
  assert.equal(overview.history.find((r) => r.meal === "lunch")?.served, 1);
  assert.equal(
    overview.forecasts.find((r) => r.meal === "lunch")?.predicted,
    null,
  );
  assert.equal(overview.students[0].balance, -7000);
});
