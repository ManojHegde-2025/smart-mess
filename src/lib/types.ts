export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export type Role = "student" | "manager";
export type User = {
  id: string;
  collegeId: string;
  name: string;
  role: Role;
  messId: string;
  active: boolean;
};
export type Settings = {
  configured: boolean;
  timeZone: string;
  messName: string;
  windows: Record<Meal, { start: string; end: string }>;
  prices: Record<Meal, number>;
  safetyBuffer: number;
  leavePolicy: "flag" | "block";
  addons: { id: string; name: string; price: number }[];
};
export type MealEvent = {
  id: string;
  userId: string;
  studentName?: string;
  meal: Meal;
  serviceDate: string;
  scannedAt: string;
  decision: "accepted" | "rejected";
  reason: string;
};
export type LedgerEntry = {
  id: string;
  userId: string;
  amount: number;
  kind: string;
  note: string;
  createdAt: string;
};
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type Leave = {
  id: string;
  userId: string;
  studentName?: string;
  collegeId?: string;
  startsOn: string;
  endsOn: string;
  status: LeaveStatus;
  source: string;
  reason?: string;
  createdAt?: string;
};
export type Usage = {
  date: string;
  meal: Meal;
  prepared: number;
  served: number;
};
export type ScanResult = {
  accepted: boolean;
  reason: string;
  message: string;
  name: string;
  meal: Meal;
  messName: string;
  scannedAt: string;
  warning?: string;
};
export type Forecast = {
  meal: Meal;
  date: string;
  predicted: number | null;
  lower: number | null;
  upper: number | null;
  prepare: number | null;
  method: string;
  sampleDays: number;
  mae: number | null;
  source?: "python" | "local";
  mlStatus?:
    | "selected"
    | "baseline_preferred"
    | "insufficient_history"
    | "gapped_history"
    | "unsupported_horizon"
    | "not_configured"
    | "unavailable";
  candidateMae?: number | null;
  baselineMae?: number | null;
  evaluationDays?: number;
  horizonDays?: number;
  historyThrough?: string;
  modelVersion?: string;
  note?: string;
  isSynthetic?: boolean;
};
export type PaginatedStudents = {
  students: (User & { balance: number })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};
export type StudentOverview = {
  user: User;
  settings: Settings;
  balance: number;
  events: MealEvent[];
  ledger: LedgerEntry[];
  leaves: Leave[];
  today: string;
};
export type ManagerOverview = {
  settings: Settings;
  today: string;
  activeStudents: number;
  counts: Record<Meal, number>;
  prepared: Record<Meal, number>;
  leaveCount: number;
  pendingLeaves: Leave[];
  exceptions: MealEvent[];
  history: Usage[];
  forecasts: Forecast[];
  students: (User & { balance: number })[];
  audit: {
    id: string;
    action: string;
    actor: string;
    createdAt: string;
    detail: string;
  }[];
};
