import { addDays } from "./domain";
import { MEALS, type Meal, type MealEvent, type Leave, type Usage, type User } from "./types";

export const SYNTHETIC_SEED = 20261106;
export const SYNTHETIC_COMPLETED_DAYS = 84;
export const SYNTHETIC_STUDENT_COUNT = 48;

/**
 * Deterministic 32-bit PRNG (Mulberry32).
 * Given the same seed, always generates the exact same sequence of pseudo-random numbers in [0, 1).
 */
export function createPrng(seed = SYNTHETIC_SEED) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SyntheticUsage = Usage & {
  foodWaste: number;
  isWeekend: boolean;
  attendanceRate: number;
};

/**
 * Generates 84 completed days of contiguous, realistic historical mess data plus today's record.
 * Uses a fixed random seed so all outputs are 100% deterministic and reproducible.
 */
export function generateSyntheticUsage(
  today: string,
  completedDays = SYNTHETIC_COMPLETED_DAYS,
  seed = SYNTHETIC_SEED,
): SyntheticUsage[] {
  const rng = createPrng(seed);
  const rows: SyntheticUsage[] = [];

  // Generate from day -completedDays up to day 0 (today)
  for (let i = completedDays; i >= 0; i--) {
    const date = addDays(today, -i);
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Semester cyclical trend across the 84-day window (-2 to +2 students)
    const semesterProgress = (completedDays - i) / completedDays;
    const semesterTrend = Math.sin(semesterProgress * Math.PI) * 2;

    for (const meal of MEALS) {
      if (i === 0) {
        // Today is partially elapsed: breakfast and lunch are served, dinner is prepared but upcoming
        const servedToday: Record<Meal, number> = {
          breakfast: 33,
          lunch: 42,
          dinner: 0,
        };
        const preparedToday: Record<Meal, number> = {
          breakfast: 37,
          lunch: 46,
          dinner: 40,
        };
        const served = servedToday[meal];
        const prepared = preparedToday[meal];
        const foodWaste = Math.max(0, prepared - served);
        rows.push({
          date,
          meal,
          served,
          prepared,
          foodWaste: meal === "dinner" ? 0 : foodWaste,
          isWeekend,
          attendanceRate: Math.round((served / SYNTHETIC_STUDENT_COUNT) * 100),
        });
        continue;
      }

      // Base attendance by meal type
      let baseAttendance = 34;
      if (meal === "lunch") baseAttendance = 42;
      else if (meal === "dinner") baseAttendance = 38;

      // Day-of-week attendance multipliers
      let weekdayFactor = 1.0;
      if (dayOfWeek === 0) {
        // Sunday: lower breakfast (sleeping in), moderate lunch, higher dinner (returning students)
        weekdayFactor = meal === "breakfast" ? 0.62 : meal === "lunch" ? 0.82 : 0.92;
      } else if (dayOfWeek === 6) {
        // Saturday: lower breakfast, moderate lunch/dinner
        weekdayFactor = meal === "breakfast" ? 0.68 : meal === "lunch" ? 0.84 : 0.82;
      } else if (dayOfWeek === 5) {
        // Friday: normal breakfast & lunch, slightly lower dinner (weekend departures)
        weekdayFactor = meal === "dinner" ? 0.88 : 1.0;
      } else if (dayOfWeek === 1) {
        // Monday: peak attendance
        weekdayFactor = 1.03;
      }

      // Deterministic noise in [-2, +2]
      const noise = Math.floor(rng() * 5) - 2;

      // Final served count clamped to realistic hostel bounds [10, SYNTHETIC_STUDENT_COUNT]
      const rawServed = Math.round(baseAttendance * weekdayFactor + semesterTrend + noise);
      const served = Math.min(SYNTHETIC_STUDENT_COUNT, Math.max(12, rawServed));

      // Preparation buffer: 6% to 12% over served count to reflect real hostel planning
      const bufferPercent = 0.06 + rng() * 0.06;
      const bufferQuantity = Math.max(2, Math.round(served * bufferPercent));
      const prepared = served + bufferQuantity;

      // Food waste is unserved prepared food
      const foodWaste = Math.max(0, prepared - served);

      rows.push({
        date,
        meal,
        served,
        prepared,
        foodWaste,
        isWeekend,
        attendanceRate: Math.round((served / SYNTHETIC_STUDENT_COUNT) * 100),
      });
    }
  }

  return rows;
}

const DEMO_NAMES = [
  "Aarav Shah",
  "Diya Nair",
  "Kabir Rao",
  "Ananya Das",
  "Ishaan Patel",
  "Meera Menon",
  "Rohan Sen",
  "Tara Iyer",
  "Devika Joshi",
  "Aditya Verma",
  "Sneha Kulkarni",
  "Varun Gupta",
];

export function generateSyntheticStudents(): User[] {
  return Array.from({ length: SYNTHETIC_STUDENT_COUNT }, (_, i) => ({
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    collegeId: `SM2026${String(i + 1).padStart(3, "0")}`,
    name: i < DEMO_NAMES.length ? DEMO_NAMES[i] : `Demo Student ${i + 1}`,
    role: "student" as const,
    messId: "south-mess-demo",
    active: true,
  }));
}

/**
 * Generates synthetic operational exceptions for demo display.
 * Includes duplicate scans, approved leave attempts, and flagged attendance.
 */
export function generateSyntheticExceptions(today: string, users: User[]): MealEvent[] {
  const students = users.filter((u) => u.role === "student");
  return [
    {
      id: "demo-exc-001",
      userId: students[2]?.id ?? "student-3",
      studentName: students[2]?.name ?? "Kabir Rao",
      meal: "lunch",
      serviceDate: today,
      scannedAt: `${today}T07:45:12.000Z`,
      decision: "rejected",
      reason: "DUPLICATE",
    },
    {
      id: "demo-exc-002",
      userId: students[5]?.id ?? "student-6",
      studentName: students[5]?.name ?? "Meera Menon",
      meal: "lunch",
      serviceDate: today,
      scannedAt: `${today}T08:02:44.000Z`,
      decision: "rejected",
      reason: "APPROVED_LEAVE",
    },
    {
      id: "demo-exc-003",
      userId: students[8]?.id ?? "student-9",
      studentName: students[8]?.name ?? "Devika Joshi",
      meal: "breakfast",
      serviceDate: today,
      scannedAt: `${today}T03:15:30.000Z`,
      decision: "accepted",
      reason: "LEAVE_FLAG",
    },
  ];
}

/**
 * Generates active student leaves for demo mode.
 */
export function generateSyntheticLeaves(today: string, users: User[]): Leave[] {
  const students = users.filter((u) => u.role === "student");
  return [
    {
      id: "demo-leave-001",
      userId: students[3]?.id ?? "student-4",
      startsOn: addDays(today, -1),
      endsOn: addDays(today, 2),
      status: "approved",
      source: "Academic Sanction",
    },
    {
      id: "demo-leave-002",
      userId: students[5]?.id ?? "student-6",
      startsOn: today,
      endsOn: addDays(today, 3),
      status: "approved",
      source: "Medical Leave",
    },
    {
      id: "demo-leave-003",
      userId: students[10]?.id ?? "student-11",
      startsOn: today,
      endsOn: addDays(today, 1),
      status: "approved",
      source: "Sports Meet",
    },
    {
      id: "demo-leave-004",
      userId: students[12]?.id ?? "student-13",
      startsOn: addDays(today, -2),
      endsOn: today,
      status: "approved",
      source: "Personal",
    },
  ];
}

/**
 * Brand-check helper to verify if data is tagged as synthetic demonstration data.
 */
export function isSyntheticData(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    o.messId === "south-mess-demo" ||
    o._isSynthetic === true ||
    o.source === "synthetic-demo" ||
    o.source === "demo fixture" ||
    (typeof o.id === "string" && o.id.startsWith("demo-")) ||
    (typeof o.userId === "string" && o.userId.startsWith("10000000-0000-4000-8000-")) ||
    (typeof o.collegeId === "string" && o.collegeId.startsWith("SM2026"))
  );
}

/**
 * Defensive runtime check: throws an error if synthetic data is passed to a database write function.
 */
export function assertNotSynthetic(data: unknown, operation = "Database operation"): void {
  if (isSyntheticData(data)) {
    throw new Error(
      `[CRITICAL SECURITY] ${operation} rejected: Synthetic demonstration data cannot be written to production database.`,
    );
  }
}
