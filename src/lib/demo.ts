import { demoHistory } from "./demo-history";
import {
  addDays,
  baselineForecast,
  currentMeal,
  defaultSettings,
  emptyCounts,
  localTime,
} from "./domain";
import {
  MEALS,
  type LedgerEntry,
  type Leave,
  type LeaveStatus,
  type ManagerOverview,
  type Meal,
  type MealEvent,
  type PaginatedStudents,
  type ScanResult,
  type Settings,
  type StudentOverview,
  type Usage,
  type User,
} from "./types";
import {
  addonSchema,
  bulkImportSchema,
  cancelLeaveSchema,
  createStudentSchema,
  ledgerSchema,
  manualLeaveSchema,
  resetPinSchema,
  reviewLeaveSchema,
  settingsSchema,
  studentLeaveRequestSchema,
  updateStatusSchema,
  usageSchema,
} from "./validation";

const KEY = "smart-mess-demo-v2";
type DemoState = {
  date: string;
  user: User | null;
  users: User[];
  settings: Settings;
  events: MealEvent[];
  ledger: LedgerEntry[];
  leaves: Leave[];
  usage: Usage[];
  audit: ManagerOverview["audit"];
  requests: string[];
};
const studentId = "10000000-0000-4000-8000-000000000001";
const managerId = "10000000-0000-4000-8000-000000000002";
export function demoQr(meal: Meal) {
  return `demo.${btoa(JSON.stringify({ meal, date: localTime().date, expires: Date.now() + 90000 }))}`;
}
function seed(): DemoState {
  const today = localTime().date;
  const names = [
    "Aarav Shah",
    "Diya Nair",
    "Kabir Rao",
    "Ananya Das",
    "Ishaan Patel",
    "Meera Menon",
    "Rohan Sen",
    "Tara Iyer",
  ];
  const users: User[] = [
    {
      id: studentId,
      collegeId: "SM2026001",
      name: names[0],
      role: "student",
      messId: "south-mess",
      active: true,
    },
    {
      id: managerId,
      collegeId: "MANAGER",
      name: "Priya Sharma",
      role: "manager",
      messId: "south-mess",
      active: true,
    },
    ...Array.from({ length: 47 }, (_, i) => ({
      id: crypto.randomUUID(),
      collegeId: `SM2026${String(i + 2).padStart(3, "0")}`,
      name: i < 7 ? names[i + 1] : `Demo Student ${i + 2}`,
      role: "student" as const,
      messId: "south-mess",
      active: true,
    })),
  ];
  const settings = defaultSettings();
  settings.configured = true;
  settings.prices = { breakfast: 4500, lunch: 7000, dinner: 6000 };
  settings.addons = [
    { id: "milk", name: "Extra milk", price: 2000 },
    { id: "egg", name: "Boiled egg", price: 1200 },
  ];
  const usage = demoHistory(today);
  const events: MealEvent[] = Array.from({ length: 6 }, (_, i) => ({
    id: crypto.randomUUID(),
    userId: studentId,
    meal: MEALS[i % 3],
    serviceDate: addDays(today, -1 - Math.floor(i / 3)),
    scannedAt: `${addDays(today, -1 - Math.floor(i / 3))}T${["03", "07", "14"][i % 3]}:30:00Z`,
    decision: "accepted",
    reason: "ACCEPTED",
  }));
  const ledger: LedgerEntry[] = users
    .filter((u) => u.role === "student")
    .map((u, i) => ({
      id: crypto.randomUUID(),
      userId: u.id,
      amount: 400000 - i * 4100,
      kind: "credit",
      note: "Sample opening credit",
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    }));
  for (const e of events)
    ledger.push({
      id: crypto.randomUUID(),
      userId: studentId,
      amount: -settings.prices[e.meal],
      kind: "meal",
      note: `${e.meal} · ${e.serviceDate}`,
      createdAt: e.scannedAt,
    });
  const leaves: Leave[] = [
    ...users
      .filter((u) => u.role === "student")
      .slice(2, 5)
      .map((u) => ({
        id: crypto.randomUUID(),
        userId: u.id,
        studentName: u.name,
        collegeId: u.collegeId,
        startsOn: today,
        endsOn: addDays(today, 2),
        status: "approved" as LeaveStatus,
        source: "warden",
        reason: "Official hostel leave",
        createdAt: new Date().toISOString(),
      })),
    {
      id: crypto.randomUUID(),
      userId: users[5].id,
      studentName: users[5].name,
      collegeId: users[5].collegeId,
      startsOn: addDays(today, 1),
      endsOn: addDays(today, 4),
      status: "pending" as LeaveStatus,
      source: "student_request",
      reason: "Family function in hometown",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      userId: users[6].id,
      studentName: users[6].name,
      collegeId: users[6].collegeId,
      startsOn: addDays(today, 2),
      endsOn: addDays(today, 5),
      status: "pending" as LeaveStatus,
      source: "student_request",
      reason: "Attending inter-college symposium",
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    date: today,
    user: null,
    users,
    settings,
    events,
    ledger,
    leaves,
    usage,
    audit: [],
    requests: [],
  };
}
let memoryState: DemoState | null = null;

function load(): DemoState {
  if (typeof localStorage === "undefined") {
    if (!memoryState || memoryState.date !== localTime().date) {
      memoryState = seed();
    }
    return memoryState;
  }
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (value?.date === localTime().date && Array.isArray(value.users))
      return value;
  } catch {
    /* Reset damaged or old demo data only. */
  }
  const state = seed();
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}
function save(state: DemoState) {
  if (typeof localStorage === "undefined") {
    memoryState = state;
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(state));
}
export function resetDemo() {
  memoryState = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(KEY);
  }
}
export async function demoRequest<T>(
  path: string,
  method = "GET",
  body: Record<string, unknown> = {},
): Promise<T> {
  const s = load();
  const balance = (id: string) =>
    s.ledger
      .filter((e) => e.userId === id)
      .reduce((sum, e) => sum + e.amount, 0);
  const audit = (action: string, detail: string) =>
    s.audit.unshift({
      id: crypto.randomUUID(),
      action,
      detail,
      actor: s.user?.name ?? "Demo",
      createdAt: new Date().toISOString(),
    });
  if (path === "/session") return { user: s.user } as T;
  if (path === "/auth/login") {
    s.user = s.users.find(
      (u) => u.id === (body.role === "manager" ? managerId : studentId),
    )!;
    save(s);
    return { user: s.user } as T;
  }
  if (path === "/auth/logout") {
    s.user = null;
    save(s);
    return { ok: true } as T;
  }
  if (!s.user) throw new Error("Please sign in.");
  if (path === "/student/overview") {
    const data: StudentOverview = {
      user: s.user,
      settings: s.settings,
      today: s.date,
      balance: balance(s.user.id),
      events: s.events
        .filter((e) => e.userId === s.user!.id)
        .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt)),
      ledger: s.ledger
        .filter((e) => e.userId === s.user!.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      leaves: s.leaves.filter((l) => l.userId === s.user!.id),
    };
    return data as T;
  }
  if (path === "/meals/scan") {
    let token;
    try {
      const value = String(body.token);
      if (!value.startsWith("demo.")) throw new Error();
      token = JSON.parse(atob(value.slice(5)));
      if (
        token.expires < Date.now() ||
        token.date !== s.date ||
        !MEALS.includes(token.meal)
      )
        throw new Error();
    } catch {
      throw new Error(
        "This demo QR is invalid or expired. Generate a new sample QR.",
      );
    }
    const meal = token.meal as Meal;
    const duplicate = s.events.some(
      (e) =>
        e.userId === s.user!.id &&
        e.serviceDate === s.date &&
        e.meal === meal &&
        e.decision === "accepted",
    );
    const onLeave = s.leaves.some(
      (l) =>
        l.userId === s.user!.id &&
        l.status === "approved" &&
        l.startsOn <= s.date &&
        l.endsOn >= s.date,
    );
    const blocked = onLeave && s.settings.leavePolicy === "block";
    const accepted = !duplicate && !blocked;
    const reason = duplicate
      ? "DUPLICATE"
      : blocked
        ? "APPROVED_LEAVE"
        : onLeave
          ? "LEAVE_FLAG"
          : "ACCEPTED";
    const timestamp = new Date().toISOString();
    s.events.unshift({
      id: crypto.randomUUID(),
      userId: s.user.id,
      studentName: s.user.name,
      meal,
      serviceDate: s.date,
      scannedAt: timestamp,
      decision: accepted ? "accepted" : "rejected",
      reason,
    });
    if (accepted) {
      s.ledger.unshift({
        id: crypto.randomUUID(),
        userId: s.user.id,
        amount: -s.settings.prices[meal],
        kind: "meal",
        note: `${meal} · ${s.date}`,
        createdAt: timestamp,
      });
      s.usage.find((r) => r.date === s.date && r.meal === meal)!.served++;
    }
    save(s);
    return {
      accepted,
      reason,
      name: s.user.name,
      meal,
      messName: s.settings.messName,
      scannedAt: timestamp,
      message: duplicate
        ? "You have already recorded this meal today."
        : blocked
          ? "Approved leave is active. Contact the office."
          : "Sample meal recorded in this browser.",
      warning:
        onLeave && accepted
          ? "Approved leave: flagged for office review."
          : undefined,
    } as ScanResult as T;
  }
  if (path === "/addons") {
    const input = addonSchema.parse(body);
    if (s.requests.includes(input.requestId)) return { ok: true } as T;
    const item = s.settings.addons.find((a) => a.id === input.addonId);
    if (!item) throw new Error("Add-on unavailable.");
    s.ledger.unshift({
      id: crypto.randomUUID(),
      userId: s.user.id,
      amount: -input.quantity * item.price,
      kind: "addon",
      note: `${input.quantity} × ${item.name}`,
      createdAt: new Date().toISOString(),
    });
    s.requests.push(input.requestId);
    save(s);
    return { ok: true } as T;
  }
  if (path === "/student/leaves" && method === "POST") {
    const input = studentLeaveRequestSchema.parse(body);
    const overlap = s.leaves.some(
      (l) =>
        l.userId === s.user!.id &&
        (l.status === "pending" || l.status === "approved") &&
        l.startsOn <= input.endsOn &&
        l.endsOn >= input.startsOn,
    );
    if (overlap) {
      throw new Error(
        "You already have a pending or approved leave covering this period.",
      );
    }
    const id = crypto.randomUUID();
    s.leaves.unshift({
      id,
      userId: s.user!.id,
      studentName: s.user!.name,
      collegeId: s.user!.collegeId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "pending",
      source: "student_request",
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });
    save(s);
    return { ok: true, id } as T;
  }
  if (path === "/student/leaves/cancel" && method === "POST") {
    const input = cancelLeaveSchema.parse(body);
    const leave = s.leaves.find(
      (l) => l.id === input.leaveId && l.userId === s.user!.id,
    );
    if (!leave) throw new Error("Leave request not found.");
    if (leave.status !== "pending") {
      throw new Error("Only pending leave requests can be cancelled.");
    }
    leave.status = "cancelled";
    save(s);
    return { ok: true } as T;
  }
  if (s.user.role !== "manager") throw new Error("Manager access required.");
  if (path === "/manager/overview") {
    const counts = emptyCounts(),
      prepared = emptyCounts();
    s.usage
      .filter((r) => r.date === s.date)
      .forEach((r) => {
        counts[r.meal] = r.served;
        prepared[r.meal] = r.prepared;
      });
    const result: ManagerOverview = {
      settings: s.settings,
      today: s.date,
      activeStudents: s.users.filter((u) => u.role === "student" && u.active)
        .length,
      counts,
      prepared,
      leaveCount: new Set(
        s.leaves
          .filter(
            (l) =>
              l.status === "approved" &&
              l.startsOn <= s.date &&
              l.endsOn >= s.date,
          )
          .map((l) => l.userId),
      ).size,
      pendingLeaves: s.leaves.filter((l) => l.status === "pending"),
      exceptions: s.events.filter(
        (e) => e.serviceDate === s.date && e.reason !== "ACCEPTED",
      ),
      history: s.usage,
      forecasts: MEALS.map((m) =>
        baselineForecast(
          s.usage.filter((r) => r.date < s.date),
          m,
          addDays(s.date, 1),
          s.settings.safetyBuffer,
        ),
      ),
      students: s.users
        .filter((u) => u.role === "student")
        .map((u) => ({ ...u, balance: balance(u.id) })),
      audit: s.audit,
    };
    return result as T;
  }
  if (path.startsWith("/manager/qr")) {
    const meal = (new URLSearchParams(path.split("?")[1]).get("meal") ??
      currentMeal(s.settings)) as Meal;
    if (!MEALS.includes(meal)) throw new Error("Invalid meal");
    return {
      token: demoQr(meal),
      meal,
      date: s.date,
      messName: s.settings.messName,
      expiresAt: new Date(Date.now() + 90000).toISOString(),
    } as T;
  }
  if (path === "/manager/settings" && method === "PATCH") {
    s.settings = {
      ...s.settings,
      ...settingsSchema.parse(body),
      configured: true,
    };
    audit("policy.updated", "Sample operational policy updated.");
    save(s);
    return { ok: true } as T;
  }
  if (path === "/manager/usage") {
    const input = usageSchema.parse(body);
    let row = s.usage.find(
      (r) => r.date === input.date && r.meal === input.meal,
    );
    if (row) row.prepared = input.prepared;
    else s.usage.push({ ...input, served: 0 });
    audit("preparation.updated", `${input.meal}: ${input.prepared} prepared`);
    save(s);
    return { ok: true } as T;
  }
  if (path === "/manager/ledger") {
    const input = ledgerSchema.parse(body);
    if (s.requests.includes(input.requestId)) return { ok: true } as T;
    if (!s.users.some((u) => u.id === input.userId && u.role === "student"))
      throw new Error("Student not found");
    s.ledger.unshift({
      id: crypto.randomUUID(),
      userId: input.userId,
      amount: input.amount,
      kind: "adjustment",
      note: input.note,
      createdAt: new Date().toISOString(),
    });
    s.requests.push(input.requestId);
    audit("ledger.adjusted", input.note);
    save(s);
    return { ok: true } as T;
  }
  if (path.startsWith("/manager/students") && method === "GET") {
    const searchParams = new URLSearchParams(path.split("?")[1] ?? "");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 25)));
    const search = (searchParams.get("search") ?? "").trim().toLowerCase();

    const filtered = s.users
      .filter((u) => u.role === "student")
      .filter((u) =>
        search ? `${u.name} ${u.collegeId}`.toLowerCase().includes(search) : true,
      );

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paged = filtered.slice(offset, offset + limit);

    const paginated: PaginatedStudents = {
      students: paged.map((u) => ({ ...u, balance: balance(u.id) })),
      total,
      page,
      limit,
      totalPages,
    };
    return paginated as T;
  }
  if (path === "/manager/students" && method === "POST") {
    const input = createStudentSchema.parse(body);
    const cid = input.collegeId.trim().toUpperCase();
    if (s.users.some((u) => u.collegeId === cid)) {
      throw new Error("A student with this college ID already exists.");
    }
    const newUser: User = {
      id: crypto.randomUUID(),
      collegeId: cid,
      name: input.name.trim(),
      role: "student",
      messId: input.messId || s.user.messId,
      active: true,
    };
    s.users.push(newUser);
    audit("student.created", JSON.stringify({ studentId: newUser.id, collegeId: cid, name: newUser.name }));
    save(s);
    return { ok: true, user: { ...newUser, balance: 0 } } as T;
  }
  if (path === "/manager/students/reset-pin" && method === "POST") {
    const input = resetPinSchema.parse(body);
    const student = s.users.find((u) => u.id === input.userId && u.role === "student");
    if (!student) throw new Error("Student not found.");
    audit("student.pin-reset", JSON.stringify({ studentId: input.userId, collegeId: student.collegeId }));
    save(s);
    return { ok: true } as T;
  }
  if (path === "/manager/students/status" && method === "PATCH") {
    const input = updateStatusSchema.parse(body);
    const student = s.users.find((u) => u.id === input.userId && u.role === "student");
    if (!student) throw new Error("Student not found.");
    student.active = input.active;
    audit("student.status-updated", JSON.stringify({ studentId: input.userId, collegeId: student.collegeId, active: input.active }));
    save(s);
    return { ok: true, active: input.active } as T;
  }
  if (path === "/manager/students/import" && method === "POST") {
    const input = bulkImportSchema.parse(body);
    const seenIds = new Set<string>();
    const existingIds = new Set(s.users.map((u) => u.collegeId));
    const errors: { row: number; collegeId: string; reason: string }[] = [];
    const credentials: { collegeId: string; name: string; pin: string }[] = [];
    let count = 0;

    for (let i = 0; i < input.students.length; i++) {
      const row = input.students[i];
      const rowNum = i + 1;
      const cid = row.collegeId.trim().toUpperCase();
      const name = row.name.trim();
      const messId = row.messId || s.user.messId;

      if (!cid) {
        errors.push({ row: rowNum, collegeId: cid, reason: "College ID is required" });
        continue;
      }
      if (seenIds.has(cid)) {
        errors.push({ row: rowNum, collegeId: cid, reason: "Duplicate college ID in import batch" });
        continue;
      }
      seenIds.add(cid);

      if (existingIds.has(cid)) {
        errors.push({ row: rowNum, collegeId: cid, reason: "College ID already registered in system" });
        continue;
      }

      const pin = input.defaultPin || String(Math.floor(100000 + Math.random() * 900000));
      s.users.push({
        id: crypto.randomUUID(),
        collegeId: cid,
        name,
        role: "student",
        messId,
        active: true,
      });
      existingIds.add(cid);
      credentials.push({ collegeId: cid, name, pin });
      count++;
    }

    audit("student.bulk-imported", JSON.stringify({ count, errors: errors.length }));
    save(s);
    return { imported: count, errors, credentials } as T;
  }
  if (path === "/manager/leaves/review" && method === "PATCH") {
    const input = reviewLeaveSchema.parse(body);
    const leave = s.leaves.find((l) => l.id === input.leaveId && l.status === "pending");
    if (!leave) throw new Error("Pending leave request not found.");
    leave.status = input.status;
    audit(`leave.${input.status}`, JSON.stringify({ leaveId: input.leaveId, status: input.status, studentId: leave.userId }));
    save(s);
    return { ok: true, status: input.status } as T;
  }
  if (path === "/manager/leaves/manual" && method === "POST") {
    const input = manualLeaveSchema.parse(body);
    const student = s.users.find((u) => u.id === input.userId && u.role === "student");
    if (!student) throw new Error("Student not found.");
    const overlap = s.leaves.some(
      (l) =>
        l.userId === input.userId &&
        l.status === "approved" &&
        l.startsOn <= input.endsOn &&
        l.endsOn >= input.startsOn,
    );
    if (overlap) {
      throw new Error("Student already has an approved leave during this period.");
    }
    const id = crypto.randomUUID();
    s.leaves.unshift({
      id,
      userId: input.userId,
      studentName: student.name,
      collegeId: student.collegeId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "approved",
      source: "manager_manual",
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });
    audit("leave.manual-approved", JSON.stringify({ leaveId: id, studentId: input.userId, collegeId: student.collegeId }));
    save(s);
    return { ok: true, id } as T;
  }
  throw new Error("This action is unavailable.");
}
