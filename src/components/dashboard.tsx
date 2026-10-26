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
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  Clock3,
  Coffee,
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
  Users,
  Utensils,
} from "lucide-react";
import { useApp } from "./provider";
import { Empty, ErrorBox, Loading, Shell } from "./shell";
import { ForecastStatus } from "./forecast-status";
import { formatMoney, reportCsv } from "@/lib/domain";
import {
  MEALS,
  type ManagerOverview,
  type Meal,
  type Settings,
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
  const load = useCallback(async () => {
    try {
      setData(await api<ManagerOverview>("/manager/overview"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load dashboard.");
    }
  }, [api]);
  useEffect(() => {
    if (ready && user?.role === "manager") {
      void load();
      const timer = setInterval(() => void load(), 30000);
      return () => clearInterval(timer);
    }
  }, [ready, user, load]);
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
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save.";
      setError(message);
      throw new Error(message);
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
                    <Sparkles size={22} />
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
                      {mode === "demo"
                        ? "Based on synthetic demo history."
                        : "Based on completed historical service days."}{" "}
                      Estimates improve only when validation supports it.
                    </span>
                  </div>
                  <Link className="ml-details-link" href="/manager/reports">
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
            </>
          )}
          {view === "accounts" && (
            <div className="accounts-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>{data.students.length} student accounts</h2>
                  <div className="search-input">
                    <Search size={16} />
                    <input
                      aria-label="Find student"
                      placeholder="Search name or college ID"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>College ID</th>
                        <th>Balance</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.students
                        .filter((s) =>
                          `${s.name} ${s.collegeId}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((s) => (
                          <tr key={s.id}>
                            <td>
                              <span className="table-person">
                                <span className="avatar small-avatar">
                                  {s.name[0]}
                                </span>
                                <strong>{s.name}</strong>
                              </span>
                            </td>
                            <td>{s.collegeId}</td>
                            <td
                              className={
                                s.balance < 0 ? "negative" : "positive"
                              }
                            >
                              {formatMoney(s.balance)}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setSelected(s.id)}
                              >
                                Adjust <ArrowRight size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data.students.length && (
                    <Empty>
                      Create student accounts with the included account creation
                      script.
                    </Empty>
                  )}
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
                <div>
                  <span className="eyebrow">DEMAND PREDICTION</span>
                  <h2>Learn from completed meal counts</h2>
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
                  {mode === "demo"
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
        </>
      )}
    </Shell>
  );
}
