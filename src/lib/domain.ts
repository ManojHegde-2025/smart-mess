import {
  MEALS,
  type Forecast,
  type Meal,
  type Settings,
  type Usage,
} from "./types";

export function localTime(date = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function inMealWindow(
  time: string,
  window: { start: string; end: string },
) {
  return time >= window.start && time < window.end;
}
export function defaultSettings(timeZone = "Asia/Kolkata"): Settings {
  return {
    configured: false,
    timeZone,
    messName: "South Mess",
    windows: {
      breakfast: { start: "07:00", end: "09:30" },
      lunch: { start: "12:00", end: "14:30" },
      dinner: { start: "19:00", end: "21:30" },
    },
    prices: { breakfast: 0, lunch: 0, dinner: 0 },
    safetyBuffer: 0.05,
    leavePolicy: "flag",
    addons: [
      { id: "milk", name: "Extra milk", price: 0 },
      { id: "egg", name: "Boiled egg", price: 0 },
    ],
  };
}
export function baselineForecast(
  history: Usage[],
  meal: Meal,
  target: string,
  buffer: number,
): Forecast {
  const rows = history
    .filter((r) => r.meal === meal && r.date < target)
    .sort((a, b) => a.date.localeCompare(b.date));
  const counts = rows.slice(-7).map((r) => r.served);
  if (!counts.length)
    return {
      meal,
      date: target,
      predicted: null,
      lower: null,
      upper: null,
      prepare: null,
      method: "Awaiting history",
      sampleDays: 0,
      mae: null,
    };
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const spread = Math.sqrt(
    counts.reduce((s, n) => s + (n - mean) ** 2, 0) / counts.length,
  );
  const errors = rows
    .slice(7)
    .map((row, i) =>
      Math.abs(
        row.served - rows.slice(i, i + 7).reduce((s, r) => s + r.served, 0) / 7,
      ),
    );
  return {
    meal,
    date: target,
    predicted: Math.round(mean),
    lower: Math.max(0, Math.floor(mean - spread)),
    upper: Math.ceil(mean + spread),
    prepare: Math.ceil(mean * (1 + buffer)),
    method: "7-day rolling baseline",
    sampleDays: rows.length,
    mae: errors.length
      ? Number((errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1))
      : null,
    note: "Range describes recent variation, not a calibrated confidence interval.",
  };
}
export function emptyCounts(): Record<Meal, number> {
  return { breakfast: 0, lunch: 0, dinner: 0 };
}
export function formatMoney(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function reportCsv(history: Usage[]) {
  return [
    ["Date", "Meal", "Prepared", "Served", "Remaining", "Shortfall"],
    ...history.map((r) => [
      r.date,
      r.meal,
      r.prepared,
      r.served,
      Math.max(0, r.prepared - r.served),
      Math.max(0, r.served - r.prepared),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
export function currentMeal(settings: Settings, now = new Date()): Meal {
  const { time } = localTime(now, settings.timeZone);
  return (
    MEALS.find((m) => inMealWindow(time, settings.windows[m])) ??
    (time < settings.windows.lunch.start
      ? "breakfast"
      : time < settings.windows.dinner.start
        ? "lunch"
        : "dinner")
  );
}
