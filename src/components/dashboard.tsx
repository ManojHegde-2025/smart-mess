"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Coffee,
  KeyRound,
  Leaf,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Sunset,
  TrendingUp,
  UploadCloud,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Utensils,
  X,
} from "lucide-react";
import { useApp } from "./provider";
import { Empty, ErrorBox, Loading, Shell } from "./shell";
import { ForecastStatus } from "./forecast-status";
import { formatMoney, reportCsv } from "@/lib/domain";
import {
  MEALS,
  type Leave,
  type ManagerOverview,
  type Meal,
  type PaginatedStudents,
  type Settings,
  type User,
} from "@/lib/types";
const mealIcons = { breakfast: Coffee, lunch: Sun, dinner: Sunset };
type View = "overview" | "accounts" | "reports" | "settings";
function download(data: ManagerOverview) {
  const url = URL.createObjectURL(
    new Blob([reportCsv(data.history)], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `smart-mess-${data.today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSampleCsv() {
  const sample = "college_id,name,mess_id\nSM2026101,Aarav Patel,south-mess\nSM2026102,Diya Sharma,south-mess\nSM2026103,Kabir Rao,south-mess\n";
  const url = URL.createObjectURL(new Blob([sample], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "students_sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCredentialsCsv(credentials: { collegeId: string; name: string; pin: string }[]) {
  const lines = [
    "college_id,name,initial_pin",
    ...credentials.map((c) => `"${c.collegeId}","${c.name.replace(/"/g, '""')}","${c.pin}"`),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `student_credentials_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseStudentCsv(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return {
      valid: [],
      invalid: [{ row: 1, raw: "", reason: "CSV must contain a header and at least one student row." }],
    };
  }
  const header = lines[0].toLowerCase().split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const colIndex = {
    collegeId: header.findIndex((h) => h === "college_id" || h === "collegeid" || h === "id"),
    name: header.findIndex((h) => h === "name" || h === "student_name" || h === "studentname"),
    messId: header.findIndex((h) => h === "mess_id" || h === "messid" || h === "mess"),
  };
  if (colIndex.collegeId === -1 || colIndex.name === -1) {
    return {
      valid: [],
      invalid: [{ row: 1, raw: lines[0], reason: "CSV header must contain 'college_id' and 'name' columns." }],
    };
  }
  const valid: { collegeId: string; name: string; messId?: string }[] = [];
  const invalid: { row: number; raw: string; reason: string }[] = [];
  const seenIds = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cols = raw.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const collegeId = cols[colIndex.collegeId] || "";
    const name = cols[colIndex.name] || "";
    const messId = colIndex.messId !== -1 ? cols[colIndex.messId] : undefined;

    if (!collegeId) {
      invalid.push({ row: i + 1, raw, reason: "Missing college ID" });
    } else if (!/^[a-zA-Z0-9_-]{2,40}$/.test(collegeId)) {
      invalid.push({ row: i + 1, raw, reason: "College ID must be 2-40 alphanumeric characters" });
    } else if (seenIds.has(collegeId.toUpperCase())) {
      invalid.push({ row: i + 1, raw, reason: "Duplicate college ID in this file" });
    } else if (!name || name.length < 2) {
      invalid.push({ row: i + 1, raw, reason: "Student name must be at least 2 characters" });
    } else {
      seenIds.add(collegeId.toUpperCase());
      valid.push({ collegeId: collegeId.toUpperCase(), name, messId: messId || undefined });
    }
  }
  return { valid, invalid };
}

function PolicyForm({
  settings,
  onSave,
  busy,
}: {
  settings: Settings;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [policy, setPolicy] = useState(settings);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await onSave(policy);
      setMessage("Operational policy saved. Future meals use these settings.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save.");
    }
  }
  return (
    <form className="panel settings-form" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <h2>Operational policy</h2>
          <p>
            Confirm the college’s actual rules before enabling live service.
          </p>
        </div>
        <span className={`badge ${settings.configured ? "green" : "amber"}`}>
          {settings.configured ? "Configured" : "Setup required"}
        </span>
      </div>
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      <label>
        Mess name
        <input
          required
          value={policy.messName}
          maxLength={80}
          onChange={(e) => setPolicy({ ...policy, messName: e.target.value })}
        />
      </label>
      <p className="small muted">
        All service windows use {settings.timeZone}. End times are exclusive.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Meal</th>
              <th>Opens</th>
              <th>Closes</th>
              <th>Price (₹)</th>
            </tr>
          </thead>
          <tbody>
            {MEALS.map((meal) => (
              <tr key={meal}>
                <td className="capitalize">
                  <strong>{meal}</strong>
                </td>
                <td>
                  <input
                    aria-label={`${meal} opens`}
                    required
                    type="time"
                    value={policy.windows[meal].start}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        windows: {
                          ...policy.windows,
                          [meal]: {
                            ...policy.windows[meal],
                            start: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`${meal} closes`}
                    required
                    type="time"
                    value={policy.windows[meal].end}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        windows: {
                          ...policy.windows,
                          [meal]: {
                            ...policy.windows[meal],
                            end: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`${meal} price`}
                    required
                    type="number"
                    min="0"
                    max="1000"
                    step="0.01"
                    value={policy.prices[meal] / 100}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        prices: {
                          ...policy.prices,
                          [meal]: Math.round(Number(e.target.value) * 100),
                        },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <label>
          Preparation safety buffer (%)
          <input
            required
            type="number"
            min="0"
            max="50"
            step="1"
            value={Math.round(policy.safetyBuffer * 100)}
            onChange={(e) =>
              setPolicy({
                ...policy,
                safetyBuffer: Number(e.target.value) / 100,
              })
            }
          />
        </label>
        <label>
          Meal during approved leave
          <select
            value={policy.leavePolicy}
            onChange={(e) =>
              setPolicy({
                ...policy,
                leavePolicy: e.target.value as Settings["leavePolicy"],
              })
            }
          >
            <option value="flag">Allow and flag for office review</option>
            <option value="block">Block and refer to office</option>
          </select>
        </label>
      </div>
      <h3>Add-on prices</h3>
      <div className="form-grid">
        {policy.addons.map((a, index) => (
          <label key={a.id}>
            {a.name} (₹)
            <input
              required
              type="number"
              min="0"
              max="1000"
              step="0.01"
              value={a.price / 100}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  addons: policy.addons.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          price: Math.round(Number(e.target.value) * 100),
                        }
                      : item,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="info-note">
        <ShieldAlert size={20} />
        <p>
          Leave concessions require the office’s approved billing rules. Use
          audited ledger corrections; this app does not invent a concession
          formula. Negative balances alone never block meals.
        </p>
      </div>
      <button className="button primary" disabled={busy}>
        <ClipboardCheck size={18} />
        {busy ? "Saving…" : "Confirm & save operational policy"}
      </button>
    </form>
  );
}
export function Dashboard({ view = "overview" }: { view?: View }) {
  const { api, user, ready, mode } = useApp();
  const [data, setData] = useState<ManagerOverview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [meal, setMeal] = useState<Meal>("lunch");
  const [modal, setModal] = useState<
    "add" | "import" | "reset-pin" | "deactivate" | "manual-leave" | null
  >(null);
  const [targetStudent, setTargetStudent] = useState<
    (User & { balance: number }) | null
  >(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [paginatedStudents, setPaginatedStudents] =
    useState<PaginatedStudents | null>(null);

  // New Student form state
  const [newStudent, setNewStudent] = useState({
    name: "",
    collegeId: "",
    pin: "",
    messId: "",
  });

  // Reset PIN form state
  const [newPinValue, setNewPinValue] = useState("");

  // CSV Import state
  const [csvPreview, setCsvPreview] = useState<{
    valid: { collegeId: string; name: string; messId?: string }[];
    invalid: { row: number; raw: string; reason: string }[];
  } | null>(null);
  const [csvDefaultPin, setCsvDefaultPin] = useState("");
  const [csvCredentials, setCsvCredentials] = useState<
    { collegeId: string; name: string; pin: string }[] | null
  >(null);
  const [csvSummary, setCsvSummary] = useState<{
    imported: number;
    errors: any[];
  } | null>(null);

  // Manual Leave form state
  const [manualLeaveData, setManualLeaveData] = useState({
    userId: "",
    startsOn: "",
    endsOn: "",
    reason: "",
  });

  const loadAccounts = useCallback(
    async (p = page, limit = pageSize, s = search) => {
      try {
        const res = await api<PaginatedStudents>(
          `/manager/students?page=${p}&limit=${limit}&search=${encodeURIComponent(s)}`,
        );
        setPaginatedStudents(res);
      } catch {
        // Fallback to data.students if error
      }
    },
    [api, page, pageSize, search],
  );

  const [forecastSource, setForecastSource] = useState<"live" | "synthetic">("live");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("forecastSource");
      const stored = sessionStorage.getItem("smart_mess_forecast_source");
      if (param === "synthetic" || stored === "synthetic") {
        setForecastSource("synthetic");
      }
    }
  }, []);

  const load = useCallback(
    async (source = forecastSource) => {
      try {
        const endpoint =
          source === "synthetic"
            ? "/manager/overview?forecastSource=synthetic"
            : "/manager/overview";
        setData(await api<ManagerOverview>(endpoint));
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load dashboard.");
      }
    },
    [api, forecastSource],
  );

  function toggleForecastSource() {
    const next = forecastSource === "synthetic" ? "live" : "synthetic";
    setForecastSource(next);
    if (typeof window !== "undefined") {
      if (next === "synthetic") {
        sessionStorage.setItem("smart_mess_forecast_source", "synthetic");
      } else {
        sessionStorage.removeItem("smart_mess_forecast_source");
      }
    }
    void load(next);
  }

  useEffect(() => {
    if (ready && user?.role === "manager") {
      void load();
      if (view === "accounts") void loadAccounts();
      const timer = setInterval(() => void load(), 30000);
      return () => clearInterval(timer);
    }
  }, [ready, user, load, view, loadAccounts]);

  async function mutate(
    path: string,
    body: Record<string, unknown>,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, method, body);
      await load();
      if (view === "accounts") await loadAccounts(page, pageSize, search);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save.";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    void loadAccounts(1, pageSize, val);
  }

  async function handleCreateStudent(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/manager/students", "POST", {
        name: newStudent.name.trim(),
        collegeId: newStudent.collegeId.trim(),
        pin: newStudent.pin,
        messId: newStudent.messId || user?.messId || "south-mess",
      });
      setNotice(`Student ${newStudent.name} created successfully.`);
      setNewStudent({ name: "", collegeId: "", pin: "", messId: "" });
      setModal(null);
      await Promise.all([load(), loadAccounts(page, pageSize, search)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create student.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPin(e: FormEvent) {
    e.preventDefault();
    if (!targetStudent) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/manager/students/reset-pin", "POST", {
        userId: targetStudent.id,
        pin: newPinValue,
      });
      setNotice(
        `PIN for ${targetStudent.name} updated. Active sessions have been revoked.`,
      );
      setNewPinValue("");
      setModal(null);
      setTargetStudent(null);
      await loadAccounts(page, pageSize, search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus() {
    if (!targetStudent) return;
    setBusy(true);
    setError("");
    setNotice("");
    const nextStatus = !targetStudent.active;
    try {
      await api("/manager/students/status", "PATCH", {
        userId: targetStudent.id,
        active: nextStatus,
      });
      setNotice(
        nextStatus
          ? `Account for ${targetStudent.name} is now active.`
          : `Account for ${targetStudent.name} deactivated and active sessions revoked.`,
      );
      setModal(null);
      setTargetStudent(null);
      await Promise.all([load(), loadAccounts(page, pageSize, search)]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update account status.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      const result = parseStudentCsv(text);
      setCsvPreview(result);
      setCsvSummary(null);
      setCsvCredentials(null);
    };
    reader.readAsText(file);
  }

  async function handleImportCsv() {
    if (!csvPreview || !csvPreview.valid.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{
        imported: number;
        errors: any[];
        credentials: { collegeId: string; name: string; pin: string }[];
      }>("/manager/students/import", "POST", {
        students: csvPreview.valid,
        defaultPin: csvDefaultPin || undefined,
      });
      setCsvSummary({ imported: res.imported, errors: res.errors });
      setCsvCredentials(res.credentials);
      setNotice(`Successfully imported ${res.imported} students.`);
      await Promise.all([load(), loadAccounts(1, pageSize, "")]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualLeave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/manager/leaves/manual", "POST", manualLeaveData);
      setNotice("Official leave approved and recorded.");
      setModal(null);
      setManualLeaveData({ userId: "", startsOn: "", endsOn: "", reason: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record leave.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewLeaveRequest(
    leaveId: string,
    status: "approved" | "rejected",
  ) {
    setBusy(true);
    setError("");
    try {
      await api("/manager/leaves/review", "PATCH", { leaveId, status });
      setNotice(`Leave request ${status}.`);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${status} leave.`,
      );
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    overview: ["A clearer picture. A better meal.", "Your mess, at a glance"],
    accounts: ["Every balance tells a story.", "Student accounts"],
    reports: ["Small improvements. Lasting impact.", "Reports & activity"],
    settings: ["The right rules, for your campus.", "Mess settings"],
  };
  return (
    <Shell>
      {error && <ErrorBox message={error} retry={() => void load()} />}{" "}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {data.settings.messName.toUpperCase()} · MANAGER WORKSPACE
              </span>
              <h1>{titles[view][1]}</h1>
              <p>{titles[view][0]}</p>
            </div>
            <div className="heading-actions">
              <span className="date-chip">
                <CalendarDays size={16} />
                {data.today}
              </span>
              <button
                className="button secondary"
                onClick={() => download(data)}
              >
                <ArrowDownToLine size={16} />
                Export report
              </button>
            </div>
          </div>
          {!data.settings.configured && (
            <div className="alert warning">
              <span>
                Complete your meal timings and prices to enable live QR service.
              </span>
              <Link href="/manager/settings">
                Configure policy <ArrowRight size={15} />
              </Link>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="welcome-strip">
                <div className="welcome-icon">
                  <Leaf size={25} />
                </div>
                <div>
                  <strong>Better planning starts with knowing.</strong>
                  <p>
                    Track what’s served, prepare with care, and make every meal
                    count.
                  </p>
                </div>
                <Link href="/display" className="button primary">
                  <QrCode size={17} />
                  Open counter QR
                </Link>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "Meals served today",
                    value: MEALS.reduce((n, m) => n + data.counts[m], 0),
                    detail: "Across breakfast, lunch & dinner",
                    icon: Utensils,
                    color: "green",
                  },
                  {
                    label: "Active students",
                    value: data.activeStudents,
                    detail: `${data.leaveCount} on approved leave today`,
                    icon: Users,
                    color: "blue",
                  },
                  {
                    label: "Prepared today",
                    value: MEALS.reduce((n, m) => n + data.prepared[m], 0),
                    detail: "Recorded by the mess team",
                    icon: ChefHat,
                    color: "amber",
                  },
                  {
                    label: "Review items",
                    value: data.exceptions.length,
                    detail: "Recent duplicate, leave or rule events",
                    icon: ShieldAlert,
                    color: "purple",
                  },
                ].map((stat) => (
                  <section className="stat-card" key={stat.label}>
                    <div>
                      <span>{stat.label}</span>
                      <span className={`stat-icon ${stat.color}`}>
                        <stat.icon size={19} />
                      </span>
                    </div>
                    <strong>{stat.value.toLocaleString("en-IN")}</strong>
                    <small>{stat.detail}</small>
                  </section>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel live-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Today’s meal service</h2>
                      <p>Current counts, refreshed every 30 seconds.</p>
                    </div>
                    <span className="badge green">
                      <span className="status-dot" />
                      {mode === "demo" ? "Sample counts" : "Live counts"}
                    </span>
                  </div>
                  <div className="service-cards">
                    {MEALS.map((m) => {
                      const Icon = mealIcons[m];
                      const expected = Math.max(
                        0,
                        data.activeStudents - data.leaveCount,
                      );
                      return (
                        <div className={`service-card ${m}`} key={m}>
                          <div className="service-top">
                            <span className={`meal-icon ${m}`}>
                              <Icon size={22} />
                            </span>
                            <strong className="capitalize">{m}</strong>
                            <span className="small muted">
                              {data.settings.windows[m].start}–
                              {data.settings.windows[m].end}
                            </span>
                          </div>
                          <div className="service-number">
                            {data.counts[m]}
                            <span>served</span>
                            <small>/ {expected} eligible*</small>
                          </div>
                          <div className="progress-track">
                            <div
                              style={{
                                width: `${Math.min(100, (data.counts[m] / Math.max(1, expected)) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="service-footer">
                            <span>
                              Prepared <b>{data.prepared[m]}</b>
                            </span>
                            <span>
                              Remaining{" "}
                              <b>
                                {Math.max(0, data.prepared[m] - data.counts[m])}
                              </b>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="footnote">
                    *Active students minus approved leave is a planning
                    reference, not a measured attendance forecast.
                  </p>
                </section>
                <section className="forecast-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">
                        PLAN WITH CONFIDENCE IN YOUR DATA
                      </span>
                      <h2>Tomorrow’s outlook</h2>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {mode !== "demo" && (
                        <button
                          type="button"
                          className={`badge ${forecastSource === "synthetic" ? "amber" : "neutral"}`}
                          style={{
                            cursor: "pointer",
                            fontSize: "11px",
                            padding: "3px 8px",
                            border: "1px solid currentColor",
                          }}
                          onClick={toggleForecastSource}
                          title="Toggle between live database attendance and the 120-day synthetic demonstration dataset"
                        >
                          {forecastSource === "synthetic"
                            ? "Synthetic Demo (120d)"
                            : "Test Synthetic Data"}
                        </button>
                      )}
                      <Sparkles size={22} />
                    </div>
                  </div>
                  <p>
                    Aggregate meal estimates, with a{" "}
                    {Math.round(data.settings.safetyBuffer * 100)}% preparation
                    buffer.
                  </p>
                  {data.forecasts.map((f) => (
                    <div className="forecast-row" key={f.meal}>
                      <div className="capitalize forecast-label">
                        {f.meal}
                        <small>{f.method}</small>
                        <ForecastStatus forecast={f} />
                      </div>
                      <div>
                        <strong>{f.predicted ?? "—"}</strong>
                        <small>Prepare {f.prepare ?? "—"}</small>
                      </div>
                    </div>
                  ))}
                  <div className="forecast-note">
                    <TrendingUp size={16} />
                    <span>
                      {data.forecasts.some((f) => f.isSynthetic)
                        ? "DEMO DATA — SYNTHETIC FORECAST: Based on 120-day synthetic historical records."
                        : mode === "demo"
                          ? "Based on synthetic demo history."
                          : "Based on completed historical service days."}{" "}
                      Estimates improve only when validation supports it.
                    </span>
                  </div>
                  <Link
                    className="ml-details-link"
                    href={
                      forecastSource === "synthetic"
                        ? "/manager/reports?forecastSource=synthetic"
                        : "/manager/reports"
                    }
                  >
                    View model evaluation <ArrowRight size={15} />
                  </Link>
                </section>
              </div>
              <div className="dashboard-grid lower">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Prepared with care</h2>
                      <p>Last 7 recorded days · all meal periods.</p>
                    </div>
                    <div className="chart-legend">
                      <span>
                        <i className="prepared" />
                        Prepared
                      </span>
                      <span>
                        <i />
                        Served
                      </span>
                    </div>
                  </div>
                  {data.history.length ? (
                    <div className="trend-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={Array.from(
                            new Set(data.history.map((r) => r.date)),
                          )
                            .sort()
                            .slice(-7)
                            .map((date) => ({
                              date: date.slice(5),
                              prepared: data.history
                                .filter((r) => r.date === date)
                                .reduce((s, r) => s + r.prepared, 0),
                              served: data.history
                                .filter((r) => r.date === date)
                                .reduce((s, r) => s + r.served, 0),
                            }))}
                          margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="servedFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#e8601c"
                                stopOpacity={0.25}
                              />
                              <stop
                                offset="100%"
                                stopColor="#e8601c"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="4 4"
                            vertical={false}
                            stroke="#2a2a2e"
                          />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#6a6864", fontSize: 11 }}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#6a6864", fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: 12,
                              border: "1px solid #2a2a2e",
                              background: "#1c1c20",
                              color: "#e8e6e3",
                              fontSize: 12,
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="prepared"
                            stroke="#4a4a4e"
                            fill="transparent"
                            strokeDasharray="5 4"
                            strokeWidth={2}
                          />
                          <Area
                            type="monotone"
                            dataKey="served"
                            stroke="#e8601c"
                            fill="url(#servedFill)"
                            strokeWidth={2.5}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty>
                      Record meals and preparation counts to see trends.
                    </Empty>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Record preparation</h2>
                      <p>How many portions did your team prepare?</p>
                    </div>
                    <ChefHat size={21} />
                  </div>
                  <form
                    className="form-stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await mutate("/manager/usage", {
                          date: data.today,
                          meal,
                          prepared: Number(f.get("prepared")),
                        });
                        setNotice("Preparation count saved.");
                      } catch {}
                    }}
                  >
                    <label>
                      Meal period
                      <select
                        value={meal}
                        onChange={(e) => setMeal(e.target.value as Meal)}
                      >
                        {MEALS.map((m) => (
                          <option key={m} value={m}>
                            {m[0].toUpperCase() + m.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Portions prepared
                      <input
                        name="prepared"
                        type="number"
                        min="0"
                        max="100000"
                        required
                        key={`${meal}-${data.prepared[meal]}`}
                        defaultValue={data.prepared[meal]}
                      />
                    </label>
                    <button className="button primary full" disabled={busy}>
                      <Plus size={17} />
                      Save prepared count
                    </button>
                  </form>
                  <p className="footnote">
                    Prepared minus served is remaining stock, not automatically
                    measured food waste.
                  </p>
                </section>
              </div>
              <section className="panel" style={{ marginTop: "24px" }}>
                <div className="panel-heading">
                  <div>
                    <h2>
                      Student leave requests ({data.pendingLeaves?.length ?? 0}{" "}
                      pending)
                    </h2>
                    <p>
                      Review leave applications submitted by students or record
                      approved leaves directly.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setModal("manual-leave")}
                  >
                    <Plus size={15} /> Record manual leave
                  </button>
                </div>
                {data.pendingLeaves && data.pendingLeaves.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>College ID</th>
                          <th>Leave Period</th>
                          <th>Reason</th>
                          <th>Submitted</th>
                          <th>Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pendingLeaves.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <strong>{l.studentName || "Student"}</strong>
                            </td>
                            <td>
                              <code>{l.collegeId || "—"}</code>
                            </td>
                            <td>
                              <strong>{l.startsOn}</strong> →{" "}
                              <strong>{l.endsOn}</strong>
                            </td>
                            <td>
                              {l.reason || (
                                <span className="muted">None provided</span>
                              )}
                            </td>
                            <td className="small muted">
                              {l.createdAt
                                ? new Date(l.createdAt).toLocaleDateString()
                                : "—"}
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  className="button primary small"
                                  disabled={busy}
                                  onClick={() =>
                                    reviewLeaveRequest(l.id, "approved")
                                  }
                                >
                                  <Check size={13} /> Approve
                                </button>
                                <button
                                  className="button secondary small"
                                  disabled={busy}
                                  onClick={() =>
                                    reviewLeaveRequest(l.id, "rejected")
                                  }
                                >
                                  <X size={13} /> Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    No pending leave requests. Students can submit leave requests
                    from their portal.
                  </Empty>
                )}
              </section>
            </>
          )}
          {view === "accounts" && (
            <div className="accounts-grid">
              <section className="panel">
                <div
                  className="panel-heading"
                  style={{ flexWrap: "wrap", gap: "12px" }}
                >
                  <div>
                    <h2>
                      {paginatedStudents
                        ? paginatedStudents.total
                        : data.students.length}{" "}
                      student accounts
                    </h2>
                    <p className="small muted">
                      Search, register, import, and manage student credentials and
                      access.
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      className="button primary small"
                      onClick={() => setModal("add")}
                    >
                      <UserPlus size={15} /> Add student
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setCsvSummary(null);
                        setCsvCredentials(null);
                        setCsvPreview(null);
                        setModal("import");
                      }}
                    >
                      <UploadCloud size={15} /> Import CSV
                    </button>
                    <div className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Find student"
                        placeholder="Search name or college ID"
                        value={search}
                        onChange={(e) => handleSearchChange(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>College ID</th>
                        <th>Status</th>
                        <th>Balance</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        paginatedStudents
                          ? paginatedStudents.students
                          : data.students.filter((s) =>
                              `${s.name} ${s.collegeId}`
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                            )
                      ).map((s) => (
                        <tr
                          key={s.id}
                          style={{ opacity: s.active ? 1 : 0.65 }}
                        >
                          <td>
                            <span className="table-person">
                              <span className="avatar small-avatar">
                                {s.name[0]}
                              </span>
                              <div>
                                <strong>{s.name}</strong>
                                {!s.active && (
                                  <div className="small muted">
                                    Account deactivated
                                  </div>
                                )}
                              </div>
                            </span>
                          </td>
                          <td>
                            <code>{s.collegeId}</code>
                          </td>
                          <td>
                            <span
                              className={`badge ${s.active ? "green" : "neutral"}`}
                            >
                              {s.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td
                            className={
                              s.balance < 0 ? "negative" : "positive"
                            }
                          >
                            {formatMoney(s.balance)}
                          </td>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                className="text-button"
                                onClick={() => setSelected(s.id)}
                              >
                                Adjust
                              </button>
                              <button
                                className="text-button"
                                title="Reset student PIN"
                                onClick={() => {
                                  setTargetStudent(s);
                                  setNewPinValue("");
                                  setModal("reset-pin");
                                }}
                              >
                                <KeyRound size={13} /> Reset PIN
                              </button>
                              <button
                                className="text-button"
                                style={{
                                  color: s.active ? "#e86550" : "#5cb87a",
                                }}
                                onClick={() => {
                                  setTargetStudent(s);
                                  setModal("deactivate");
                                }}
                              >
                                {s.active ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!(
                    paginatedStudents
                      ? paginatedStudents.students.length
                      : data.students.length
                  ) && (
                    <Empty>
                      {search
                        ? "No students matching your search."
                        : "No student accounts found. Click 'Add student' or 'Import CSV' above."}
                    </Empty>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "16px",
                    padding: "8px 4px",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div className="small muted">
                    Showing{" "}
                    {(() => {
                      const total = paginatedStudents
                        ? paginatedStudents.total
                        : data.students.length;
                      if (total === 0) return 0;
                      return (page - 1) * pageSize + 1;
                    })()}{" "}
                    to{" "}
                    {(() => {
                      const total = paginatedStudents
                        ? paginatedStudents.total
                        : data.students.length;
                      return Math.min(page * pageSize, total);
                    })()}{" "}
                    of{" "}
                    {paginatedStudents
                      ? paginatedStudents.total
                      : data.students.length}{" "}
                    students
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <label
                      className="small muted"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      Rows:
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          const newLimit = Number(e.target.value);
                          setPageSize(newLimit);
                          setPage(1);
                          void loadAccounts(1, newLimit, search);
                        }}
                        style={{ padding: "3px 6px", fontSize: "12px" }}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                      }}
                    >
                      <button
                        className="button secondary small"
                        disabled={page <= 1 || busy}
                        onClick={() => {
                          const prev = Math.max(1, page - 1);
                          setPage(prev);
                          void loadAccounts(prev, pageSize, search);
                        }}
                      >
                        <ChevronLeft size={14} /> Prev
                      </button>
                      <span className="small">
                        Page {page} of{" "}
                        {paginatedStudents
                          ? paginatedStudents.totalPages
                          : Math.ceil(data.students.length / pageSize) || 1}
                      </span>
                      <button
                        className="button secondary small"
                        disabled={
                          page >=
                            (paginatedStudents
                              ? paginatedStudents.totalPages
                              : Math.ceil(data.students.length / pageSize) || 1) ||
                          busy
                        }
                        onClick={() => {
                          const next = page + 1;
                          setPage(next);
                          void loadAccounts(next, pageSize, search);
                        }}
                      >
                        Next <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Record a credit or correction</h2>
                    <p>Original ledger entries are never overwritten.</p>
                  </div>
                </div>
                <form
                  className="form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    try {
                      await mutate("/manager/ledger", {
                        userId: selected,
                        amount: Math.round(Number(f.get("amount")) * 100),
                        note: f.get("note"),
                        requestId: crypto.randomUUID(),
                      });
                      setNotice(
                        "Ledger adjustment saved with an audit record.",
                      );
                      form.reset();
                    } catch {}
                  }}
                >
                  <label>
                    Student
                    <select
                      value={selected}
                      required
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="">Choose a student</option>
                      {data.students.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name} · {s.collegeId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Amount (₹)
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      min="-1000000"
                      max="1000000"
                      required
                      placeholder="Positive credit, negative debit"
                    />
                  </label>
                  <label>
                    Reason
                    <textarea
                      name="note"
                      required
                      minLength={3}
                      maxLength={300}
                      rows={3}
                      placeholder="Payment received, approved concession, or correction reason"
                    />
                  </label>
                  <button
                    className="button primary full"
                    disabled={busy || !selected}
                  >
                    Save audited adjustment
                  </button>
                </form>
                <div className="info-note">
                  <ShieldAlert size={18} />
                  <p>
                    No payment is collected here. Record payments only after the
                    office confirms receipt.
                  </p>
                </div>
              </section>
            </div>
          )}
          {view === "reports" && (
            <>
              <div className="panel ml-explainer">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <span className="eyebrow">DEMAND PREDICTION</span>
                    <h2>Learn from completed meal counts</h2>
                  </div>
                  {mode !== "demo" && (
                    <button
                      type="button"
                      className={`badge ${forecastSource === "synthetic" ? "amber" : "neutral"}`}
                      style={{
                        cursor: "pointer",
                        fontSize: "11px",
                        padding: "3px 8px",
                        border: "1px solid currentColor",
                      }}
                      onClick={toggleForecastSource}
                      title="Toggle between live database attendance and the 120-day synthetic demonstration dataset"
                    >
                      {forecastSource === "synthetic"
                        ? "Synthetic Demo (120d)"
                        : "Test Synthetic Data"}
                    </button>
                  )}
                </div>
                <p>
                  The model learns weekly patterns, recent attendance, and
                  trends separately for each meal. It is used only when its
                  historical error is lower than the rolling average at the same
                  forecast horizon.
                </p>
                <p className="small muted">
                  MAE is the average error in meals; lower is better. Today’s
                  incomplete counts are excluded.{" "}
                  {data.forecasts.some((f) => f.isSynthetic)
                    ? "DEMO DATA — SYNTHETIC FORECAST: These results use a 120-day synthetic dataset with modeled weekend and holiday patterns, not measured campus attendance."
                    : mode === "demo"
                      ? "These results use synthetic demonstration data, not measured campus accuracy."
                      : "New completed records trigger a fresh evaluation. Historical performance does not guarantee future results."}
                </p>
              </div>
              <div className="report-forecast-grid">
                {data.forecasts.map((f) => (
                  <section className="panel" key={f.meal}>
                    <div className="panel-heading">
                      <h2 className="capitalize">{f.meal} forecast</h2>
                      <TrendingUp size={19} />
                    </div>
                    <strong className="forecast-big">
                      {f.predicted ?? "—"}
                      <small> meals</small>
                    </strong>
                    <p>
                      {f.method} · {f.sampleDays} completed days
                    </p>
                    <div className="report-metrics">
                      <span>
                        Historical variation{" "}
                        <b>
                          {f.lower ?? "—"}–{f.upper ?? "—"}
                        </b>
                      </span>
                      <span>
                        Backtest MAE <b>{f.mae ?? "Not enough data"}</b>
                      </span>
                    </div>
                    <ForecastStatus forecast={f} details />
                    <p className="footnote">
                      The range describes recent variation, not a calibrated
                      confidence interval.
                    </p>
                  </section>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Preparation & service</h2>
                    <p>
                      Recent records. Zero prepared can mean preparation has not
                      been entered.
                    </p>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() => download(data)}
                  >
                    <ArrowDownToLine size={15} />
                    Download CSV
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Meal</th>
                        <th>Prepared</th>
                        <th>Served</th>
                        <th>Remaining</th>
                        <th>Shortfall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history
                        .slice()
                        .reverse()
                        .slice(0, 30)
                        .map((r) => (
                          <tr key={`${r.date}-${r.meal}`}>
                            <td>{r.date}</td>
                            <td className="capitalize">{r.meal}</td>
                            <td>{r.prepared}</td>
                            <td>{r.served}</td>
                            <td>{Math.max(0, r.prepared - r.served)}</td>
                            <td>{Math.max(0, r.served - r.prepared)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data.history.length && (
                    <Empty>No service records yet.</Empty>
                  )}
                </div>
              </section>
              <div className="dashboard-grid equal">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Today’s review items</h2>
                    <span className="badge amber">
                      {data.exceptions.length}
                    </span>
                  </div>
                  {data.exceptions.length ? (
                    <div className="activity-list">
                      {data.exceptions.map((e) => (
                        <div className="activity-row" key={e.id}>
                          <span className="activity-icon amber">
                            <ShieldAlert size={16} />
                          </span>
                          <div>
                            <strong>{e.studentName ?? "Student"}</strong>
                            <small>
                              {e.meal} · {e.reason.replaceAll("_", " ")}
                            </small>
                          </div>
                          <span className="small muted">
                            {new Date(e.scannedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>No review items recorded today.</Empty>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Audit trail</h2>
                    <ClipboardCheck size={19} />
                  </div>
                  {data.audit.length ? (
                    <div className="activity-list">
                      {data.audit.map((a) => (
                        <div className="activity-row" key={a.id}>
                          <span className="activity-icon">
                            <CheckCircle2 size={16} />
                          </span>
                          <div>
                            <strong>{a.action.replaceAll(".", " ")}</strong>
                            <small>
                              {a.actor} ·{" "}
                              {new Date(a.createdAt).toLocaleString()}
                            </small>
                            <details>
                              <summary className="small">Details</summary>
                              <pre className="audit-detail">{a.detail}</pre>
                            </details>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>Policy and account changes will appear here.</Empty>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "settings" && (
            <PolicyForm
              settings={data.settings}
              busy={busy}
              onSave={(body) => mutate("/manager/settings", body, "PATCH")}
            />
          )}

          {modal === "add" && (
            <div className="modal-backdrop" onClick={() => setModal(null)}>
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  <UserPlus size={24} />
                </div>
                <h2>Add student account</h2>
                <p>
                  Create an individual student record with an initial access
                  PIN.
                </p>
                <form onSubmit={handleCreateStudent} className="form-stack">
                  <label>
                    Full Name
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      placeholder="e.g. Rahul Sharma"
                      value={newStudent.name}
                      onChange={(e) =>
                        setNewStudent({ ...newStudent, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    College ID
                    <input
                      required
                      minLength={2}
                      maxLength={40}
                      placeholder="e.g. SM2026101"
                      value={newStudent.collegeId}
                      onChange={(e) =>
                        setNewStudent({
                          ...newStudent,
                          collegeId: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Initial PIN (6–12 digits)
                    <input
                      required
                      type="password"
                      inputMode="numeric"
                      pattern="\d{6,12}"
                      placeholder="6–12 numeric digits"
                      value={newStudent.pin}
                      onChange={(e) =>
                        setNewStudent({ ...newStudent, pin: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Mess assignment
                    <input
                      required
                      disabled
                      value={newStudent.messId || user?.messId || "south-mess"}
                    />
                  </label>
                  <button className="button primary full" disabled={busy}>
                    {busy ? "Creating account…" : "Create student account"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {modal === "reset-pin" && targetStudent && (
            <div className="modal-backdrop" onClick={() => setModal(null)}>
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  <KeyRound size={24} />
                </div>
                <h2>Reset student PIN</h2>
                <p>
                  Set a new PIN for <strong>{targetStudent.name}</strong> (
                  <code>{targetStudent.collegeId}</code>).
                </p>
                <div
                  className="alert"
                  style={{ marginBottom: "16px", fontSize: "12px" }}
                >
                  Setting a new PIN will immediately invalidate all active
                  login sessions for this student.
                </div>
                <form onSubmit={handleResetPin} className="form-stack">
                  <label>
                    New 6–12 digit PIN
                    <input
                      required
                      type="password"
                      inputMode="numeric"
                      pattern="\d{6,12}"
                      placeholder="Enter new 6–12 digit PIN"
                      value={newPinValue}
                      onChange={(e) => setNewPinValue(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary full"
                    disabled={busy || !newPinValue}
                  >
                    {busy ? "Updating PIN…" : "Update PIN & revoke sessions"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {modal === "deactivate" && targetStudent && (
            <div className="modal-backdrop" onClick={() => setModal(null)}>
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  {targetStudent.active ? (
                    <UserX size={24} />
                  ) : (
                    <UserCheck size={24} />
                  )}
                </div>
                <h2>
                  {targetStudent.active
                    ? "Deactivate student account?"
                    : "Activate student account?"}
                </h2>
                <p>
                  {targetStudent.active ? (
                    <>
                      Are you sure you want to deactivate{" "}
                      <strong>{targetStudent.name}</strong> (
                      <code>{targetStudent.collegeId}</code>)?
                      <br />
                      <br />
                      The student will immediately be signed out from all
                      sessions and blocked from recording meals until
                      reactivated.
                    </>
                  ) : (
                    <>
                      Reactivate account for{" "}
                      <strong>{targetStudent.name}</strong> (
                      <code>{targetStudent.collegeId}</code>)?
                      <br />
                      <br />
                      The student will be able to sign in and record meals again.
                    </>
                  )}
                </p>
                <div
                  style={{ display: "flex", gap: "10px", marginTop: "16px" }}
                >
                  <button
                    type="button"
                    className="button secondary full"
                    onClick={() => setModal(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button primary full"
                    style={
                      targetStudent.active
                        ? { background: "#e86550", borderColor: "#e86550" }
                        : { background: "#5cb87a", borderColor: "#5cb87a" }
                    }
                    onClick={handleToggleStatus}
                    disabled={busy}
                  >
                    {busy
                      ? "Updating…"
                      : targetStudent.active
                        ? "Yes, deactivate account"
                        : "Yes, activate account"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {modal === "import" && (
            <div className="modal-backdrop" onClick={() => setModal(null)}>
              <div
                className="modal"
                style={{ width: "620px", maxWidth: "95vw" }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  <UploadCloud size={24} />
                </div>
                <h2>Bulk student import</h2>
                <p>
                  Upload a CSV file containing student names and unique college
                  IDs.
                </p>

                {!csvSummary ? (
                  <div className="form-stack">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="small muted">
                        Columns: <code>college_id</code>, <code>name</code>,{" "}
                        <code>mess_id</code> (optional)
                      </span>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={downloadSampleCsv}
                      >
                        <ArrowDownToLine size={13} /> Sample CSV
                      </button>
                    </div>

                    <label>
                      Select CSV file
                      <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleCsvFile(file);
                        }}
                      />
                    </label>

                    <label>
                      Default PIN for imported students (optional)
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="\d{6,12}"
                        placeholder="Leave blank to generate random 6-digit PINs"
                        value={csvDefaultPin}
                        onChange={(e) => setCsvDefaultPin(e.target.value)}
                      />
                      <small className="muted">
                        If left blank, secure individual 6-digit PINs are
                        generated and provided in a downloadable credentials
                        report.
                      </small>
                    </label>

                    {csvPreview && (
                      <div style={{ marginTop: "12px" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginBottom: "8px",
                          }}
                        >
                          <span className="badge green">
                            {csvPreview.valid.length} valid rows
                          </span>
                          {csvPreview.invalid.length > 0 && (
                            <span className="badge red">
                              {csvPreview.invalid.length} invalid rows
                            </span>
                          )}
                        </div>

                        {csvPreview.invalid.length > 0 && (
                          <div
                            className="alert"
                            style={{
                              maxHeight: "120px",
                              overflow: "auto",
                              fontSize: "11px",
                              marginBottom: "10px",
                            }}
                          >
                            <strong>Rows with validation errors:</strong>
                            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                              {csvPreview.invalid.map((inv, idx) => (
                                <li key={idx}>
                                  Row {inv.row}: {inv.reason} ({inv.raw})
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {csvPreview.valid.length > 0 && (
                          <div
                            className="table-wrap"
                            style={{ maxHeight: "160px", overflow: "auto" }}
                          >
                            <table>
                              <thead>
                                <tr>
                                  <th>College ID</th>
                                  <th>Name</th>
                                  <th>Mess</th>
                                </tr>
                              </thead>
                              <tbody>
                                {csvPreview.valid.slice(0, 8).map((v, i) => (
                                  <tr key={i}>
                                    <td>
                                      <code>{v.collegeId}</code>
                                    </td>
                                    <td>{v.name}</td>
                                    <td>
                                      {v.messId ||
                                        user?.messId ||
                                        "south-mess"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        marginTop: "16px",
                      }}
                    >
                      <button
                        type="button"
                        className="button secondary full"
                        onClick={() => {
                          setModal(null);
                          setCsvPreview(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="button primary full"
                        disabled={
                          busy || !csvPreview || csvPreview.valid.length === 0
                        }
                        onClick={handleImportCsv}
                      >
                        {busy
                          ? "Importing…"
                          : `Import ${csvPreview?.valid.length ?? 0} students`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <div
                      style={{
                        margin: "0 auto 12px",
                        width: "48px",
                        height: "48px",
                        borderRadius: "50%",
                        background: "#1a2e1e",
                        color: "#5cb87a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Check size={28} />
                    </div>
                    <h3>Import Complete</h3>
                    <p style={{ margin: "8px 0 16px" }}>
                      Successfully created{" "}
                      <strong>{csvSummary.imported}</strong> student accounts.
                      {csvSummary.errors.length > 0 &&
                        ` (${csvSummary.errors.length} rows rejected)`}
                    </p>

                    {csvCredentials && csvCredentials.length > 0 && (
                      <div style={{ margin: "16px 0" }}>
                        <div
                          className="alert"
                          style={{
                            marginBottom: "12px",
                            fontSize: "12px",
                            textAlign: "left",
                          }}
                        >
                          <strong>Important:</strong> Initial student
                          credentials were generated. Download this credentials
                          file to distribute PINs safely. Plaintext PINs are
                          never stored or accessible again.
                        </div>
                        <button
                          type="button"
                          className="button primary full"
                          onClick={() =>
                            downloadCredentialsCsv(csvCredentials)
                          }
                        >
                          <ArrowDownToLine size={16} /> Download credentials CSV
                          ({csvCredentials.length})
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      className="button secondary full"
                      style={{ marginTop: "12px" }}
                      onClick={() => {
                        setModal(null);
                        setCsvPreview(null);
                        setCsvSummary(null);
                        setCsvCredentials(null);
                      }}
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {modal === "manual-leave" && (
            <div className="modal-backdrop" onClick={() => setModal(null)}>
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <button
                  className="modal-close"
                  onClick={() => setModal(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
                <div className="section-icon">
                  <CalendarDays size={24} />
                </div>
                <h2>Record approved student leave</h2>
                <p>
                  Directly record an authorized leave on behalf of a student.
                </p>
                <form onSubmit={handleManualLeave} className="form-stack">
                  <label>
                    Student
                    <select
                      required
                      value={manualLeaveData.userId}
                      onChange={(e) =>
                        setManualLeaveData({
                          ...manualLeaveData,
                          userId: e.target.value,
                        })
                      }
                    >
                      <option value="">Select student</option>
                      {data.students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.collegeId})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Starts on (YYYY-MM-DD)
                    <input
                      required
                      type="date"
                      value={manualLeaveData.startsOn}
                      onChange={(e) =>
                        setManualLeaveData({
                          ...manualLeaveData,
                          startsOn: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Ends on (YYYY-MM-DD)
                    <input
                      required
                      type="date"
                      min={manualLeaveData.startsOn || undefined}
                      value={manualLeaveData.endsOn}
                      onChange={(e) =>
                        setManualLeaveData({
                          ...manualLeaveData,
                          endsOn: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Official reason or authorization reference
                    <textarea
                      required
                      rows={2}
                      minLength={2}
                      maxLength={300}
                      placeholder="e.g. Sanctioned leave ref #104"
                      value={manualLeaveData.reason}
                      onChange={(e) =>
                        setManualLeaveData({
                          ...manualLeaveData,
                          reason: e.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="button primary full"
                    disabled={busy || !manualLeaveData.userId}
                  >
                    {busy ? "Saving leave…" : "Record & approve leave"}
                  </button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
