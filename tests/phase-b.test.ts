import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { demoRequest, resetDemo } from "../src/lib/demo";
import type {
  ManagerOverview,
  PaginatedStudents,
  ScanResult,
  StudentOverview,
  User,
} from "../src/lib/types";
import { localTime } from "../src/lib/domain";

beforeEach(() => {
  resetDemo();
});

test("Phase B Feature 1: Manager can create student accounts, reset PIN, and deactivate accounts", async () => {
  // Login as manager
  await demoRequest("/auth/login", "POST", { role: "manager" });

  // 1. Create a new student account
  const createRes = await demoRequest<{ ok: boolean; user: User }>(
    "/manager/students",
    "POST",
    {
      collegeId: "PHASEB001",
      name: "Phase B Student",
      pin: "987654",
    },
  );
  assert.equal(createRes.ok, true);
  assert.equal(createRes.user.collegeId, "PHASEB001");
  assert.equal(createRes.user.name, "Phase B Student");
  assert.equal(createRes.user.active, true);

  // 2. Reject duplicate college ID
  await assert.rejects(
    async () => {
      await demoRequest("/manager/students", "POST", {
        collegeId: "PHASEB001",
        name: "Duplicate Student",
        pin: "123456",
      });
    },
    { message: /already exists/ },
  );

  // 3. Reset student PIN
  const resetRes = await demoRequest<{ ok: boolean }>(
    "/manager/students/reset-pin",
    "POST",
    {
      userId: createRes.user.id,
      pin: "112233",
    },
  );
  assert.equal(resetRes.ok, true);

  // 4. Deactivate student account
  const deactRes = await demoRequest<{ ok: boolean; active: boolean }>(
    "/manager/students/status",
    "PATCH",
    {
      userId: createRes.user.id,
      active: false,
    },
  );
  assert.equal(deactRes.ok, true);
  assert.equal(deactRes.active, false);

  // 5. Reactivate student account
  const reactRes = await demoRequest<{ ok: boolean; active: boolean }>(
    "/manager/students/status",
    "PATCH",
    {
      userId: createRes.user.id,
      active: true,
    },
  );
  assert.equal(reactRes.ok, true);
  assert.equal(reactRes.active, true);
});

test("Phase B Feature 2: CSV Bulk Import detects errors, imports valid rows, and generates credentials", async () => {
  await demoRequest("/auth/login", "POST", { role: "manager" });

  const batch = [
    { collegeId: "CSV001", name: "Alice Smith" },
    { collegeId: "CSV002", name: "Bob Johnson" },
    { collegeId: "CSV001", name: "Alice Duplicate" }, // duplicate within batch
    { collegeId: "SM2026001", name: "Existing Student" }, // duplicate with existing DB
  ];

  const importRes = await demoRequest<{
    imported: number;
    errors: { row: number; collegeId: string; reason: string }[];
    credentials: { collegeId: string; name: string; pin: string }[];
  }>("/manager/students/import", "POST", {
    students: batch,
  });

  assert.equal(importRes.imported, 2);
  assert.equal(importRes.errors.length, 2);
  assert.equal(importRes.credentials.length, 2);
  assert.equal(importRes.credentials[0].collegeId, "CSV001");
  assert.equal(typeof importRes.credentials[0].pin, "string");
  assert.equal(importRes.credentials[0].pin.length, 6);
});

test("Phase B Feature 3: Student leave requests, cancellations, manager approval, and meal scan interaction", async () => {
  const today = localTime().date;

  // 1. Student requests leave
  await demoRequest("/auth/login", "POST", { role: "student" });
  const reqRes = await demoRequest<{ ok: boolean; id: string }>(
    "/student/leaves",
    "POST",
    {
      startsOn: today,
      endsOn: today,
      reason: "Visiting hometown for festival",
    },
  );
  assert.equal(reqRes.ok, true);
  assert.ok(reqRes.id);

  // 2. Reject overlapping leave request
  await assert.rejects(
    async () => {
      await demoRequest("/student/leaves", "POST", {
        startsOn: today,
        endsOn: today,
        reason: "Overlapping request",
      });
    },
    { message: /already have a pending or approved leave/ },
  );

  // 3. View leave in student overview
  const studentData = await demoRequest<StudentOverview>("/student/overview");
  const pendingLeave = studentData.leaves.find((l) => l.id === reqRes.id);
  assert.ok(pendingLeave);
  assert.equal(pendingLeave.status, "pending");
  assert.equal(pendingLeave.reason, "Visiting hometown for festival");

  // 4. Manager reviews and approves the leave
  await demoRequest("/auth/login", "POST", { role: "manager" });
  const reviewRes = await demoRequest<{ ok: boolean; status: string }>(
    "/manager/leaves/review",
    "PATCH",
    {
      leaveId: reqRes.id,
      status: "approved",
    },
  );
  assert.equal(reviewRes.ok, true);
  assert.equal(reviewRes.status, "approved");

  // 5. Manager records a manual approved leave for another student
  const manualRes = await demoRequest<{ ok: boolean; id: string }>(
    "/manager/leaves/manual",
    "POST",
    {
      userId: "10000000-0000-4000-8000-000000000001",
      startsOn: "2026-11-20",
      endsOn: "2026-11-22",
      reason: "Hostel committee duty",
    },
  );
  assert.equal(manualRes.ok, true);

  // 6. Test meal scanning when approved leave is active under default 'flag' policy
  // Issue QR token as manager
  const tokenFlag = (
    await demoRequest<{ token: string }>("/manager/qr?meal=lunch")
  ).token;

  await demoRequest("/auth/login", "POST", { role: "student" });
  const scanFlag = await demoRequest<ScanResult>("/meals/scan", "POST", {
    token: tokenFlag,
  });
  // Under 'flag' policy, meal is accepted with a warning flag for office review
  assert.equal(scanFlag.accepted, true);
  assert.equal(scanFlag.reason, "LEAVE_FLAG");
  assert.ok(scanFlag.warning?.includes("flagged for office review"));

  // 7. Test meal scanning under 'block' leave policy
  await demoRequest("/auth/login", "POST", { role: "manager" });
  await demoRequest("/manager/settings", "PATCH", {
    messName: "South Mess",
    windows: {
      breakfast: { start: "07:00", end: "09:30" },
      lunch: { start: "12:00", end: "14:30" },
      dinner: { start: "19:30", end: "22:00" },
    },
    prices: { breakfast: 4500, lunch: 7000, dinner: 6000 },
    safetyBuffer: 0.05,
    leavePolicy: "block",
    addons: [],
  });
  const tokenBlock = (
    await demoRequest<{ token: string }>("/manager/qr?meal=dinner")
  ).token;

  await demoRequest("/auth/login", "POST", { role: "student" });
  const scanBlock = await demoRequest<ScanResult>("/meals/scan", "POST", {
    token: tokenBlock,
  });
  assert.equal(scanBlock.accepted, false);
  assert.equal(scanBlock.reason, "APPROVED_LEAVE");
});

test("Phase B Feature 3 (Cancellation): Student can cancel a pending leave request", async () => {
  await demoRequest("/auth/login", "POST", { role: "student" });
  const req = await demoRequest<{ ok: boolean; id: string }>(
    "/student/leaves",
    "POST",
    {
      startsOn: "2026-12-01",
      endsOn: "2026-12-03",
      reason: "Initial plan",
    },
  );

  const cancelRes = await demoRequest<{ ok: boolean }>(
    "/student/leaves/cancel",
    "POST",
    {
      leaveId: req.id,
    },
  );
  assert.equal(cancelRes.ok, true);

  const data = await demoRequest<StudentOverview>("/student/overview");
  const leave = data.leaves.find((l) => l.id === req.id);
  assert.ok(leave);
  assert.equal(leave.status, "cancelled");
});

test("Phase B Feature 4: Server-side pagination & bounded parameters", async () => {
  await demoRequest("/auth/login", "POST", { role: "manager" });

  // 1. Page 1 with limit 10
  const page1 = await demoRequest<PaginatedStudents>(
    "/manager/students?page=1&limit=10",
  );
  assert.equal(page1.page, 1);
  assert.equal(page1.limit, 10);
  assert.equal(page1.students.length, 10);
  assert.ok(page1.total >= 40);
  assert.equal(page1.totalPages, Math.ceil(page1.total / 10));

  // 2. Page 2 with limit 10
  const page2 = await demoRequest<PaginatedStudents>(
    "/manager/students?page=2&limit=10",
  );
  assert.equal(page2.page, 2);
  assert.equal(page2.students.length, 10);
  assert.notEqual(page1.students[0].id, page2.students[0].id);

  // 3. Search filtering
  const searched = await demoRequest<PaginatedStudents>(
    "/manager/students?search=Aarav",
  );
  assert.ok(searched.students.length >= 1);
  assert.ok(
    searched.students.every(
      (s) =>
        s.name.includes("Aarav") || s.collegeId.toLowerCase().includes("aarav"),
    ),
  );
});
