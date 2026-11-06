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
  type ManagerOverview,
  type Meal,
  type MealEvent,
  type ScanResult,
  type Settings,
  type StudentOverview,
  type Usage,
  type User,
} from "./types";
import {
  addonSchema,
  ledgerSchema,
  settingsSchema,
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
  const leaves = users
    .filter((u) => u.role === "student")
    .slice(2, 6)
    .map((u) => ({
      id: crypto.randomUUID(),
      userId: u.id,
      startsOn: today,
      endsOn: addDays(today, 2),
      status: "approved" as const,
      source: "demo fixture",
    }));
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
function load(): DemoState {
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
  localStorage.setItem(KEY, JSON.stringify(state));
}
export function resetDemo() {
  localStorage.removeItem(KEY);
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
  throw new Error("This action is unavailable.");
}
