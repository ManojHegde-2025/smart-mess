// Real Python -> Next.js -> Chromium integration. Requires npm run build first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const mlPort = process.env.ML_TEST_PORT || "8116";
const webPort = process.env.ML_WEB_TEST_PORT || "3116";
const mlUrl = `http://127.0.0.1:${mlPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const key = randomBytes(32).toString("hex");
const localPython = join(
  root,
  "services",
  "ml",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.ML_TEST_PYTHON ||
  (existsSync(localPython) ? localPython : "python");
const env = {
  ...process.env,
  APP_MODE: "demo",
  ML_SERVICE_URL: mlUrl,
  ML_API_KEY: key,
  NEXT_TELEMETRY_DISABLED: "1",
};
const children = [];
let browser;
function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output = (output + data.toString()).slice(-3000);
  });
  child.stderr.on("data", (data) => {
    output = (output + data.toString()).slice(-3000);
  });
  child.on("error", (error) => {
    output += error.message;
  });
  child.output = () => output;
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Service exited: ${child.output()}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Service did not become ready: ${child.output()}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}
try {
  const ml = launch(
    python,
    ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", mlPort],
    join(root, "services", "ml"),
  );
  await ready(`${mlUrl}/health`, ml);
  const web = launch(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    root,
  );
  await ready(`${webUrl}/api/health`, web);
  const response = await fetch(`${webUrl}/api/demo/forecasts`);
  assert.equal(response.status, 200);
  const payload = await response.text();
  assert.ok(
    !payload.includes(key),
    "Service credential must not reach the browser",
  );
  const data = JSON.parse(payload);
  assert.equal(data.forecasts.length, 3);
  for (const f of data.forecasts) {
    assert.equal(f.source, "python");
    assert.equal(f.mlStatus, "selected");
    assert.equal(f.sampleDays, 84);
    assert.equal(f.horizonDays, 2);
    assert.ok(f.candidateMae < f.baselineMae);
    assert.ok(f.prepare >= f.predicted);
  }
  const bad = await fetch(`${webUrl}/api/demo/forecasts?buffer=8`);
  assert.equal(bad.status, 422);
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${webUrl}/login`);
  await page.getByRole("button", { name: "I manage the mess" }).click();
  await page.getByRole("heading", { name: "Your mess, at a glance" }).waitFor();
  assert.equal(
    await page.getByText("ML model active", { exact: true }).count(),
    3,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile ML dashboard overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.env.ML_SCREENSHOT_DIR) {
    mkdirSync(process.env.ML_SCREENSHOT_DIR, { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: join(process.env.ML_SCREENSHOT_DIR, "ml-dashboard.png"),
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "View model evaluation" }).click();
  await page
    .getByRole("heading", { name: "Learn from completed meal counts" })
    .waitFor();
  assert.equal(await page.getByText("Random Forest MAE").count(), 3);
  assert.equal(
    await page.getByText("ML model active", { exact: true }).count(),
    3,
  );
  if (process.env.ML_SCREENSHOT_DIR)
    await page.screenshot({
      path: join(process.env.ML_SCREENSHOT_DIR, "ml-evaluation.png"),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile ML report overflow",
  );
  assert.deepEqual(errors, []);
  await stop(ml);
  const fallback = await (
    await fetch(`${webUrl}/api/demo/forecasts?buffer=0.06`)
  ).json();
  assert.ok(
    fallback.forecasts.every(
      (f) =>
        f.source === "local" &&
        f.mlStatus === "unavailable" &&
        f.predicted >= 0,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Mess settings" }).click();
  await page.getByLabel("Preparation safety buffer (%)").fill("6");
  await page
    .getByRole("button", { name: "Confirm & save operational policy" })
    .click();
  await page.getByRole("status").waitFor();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Your mess, at a glance" }).waitFor();
  assert.equal(
    await page
      .getByText("ML unavailable · fallback active", { exact: true })
      .count(),
    3,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile fallback dashboard overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Python training, 3 ML forecasts through Next.js, two-day horizon, browser model metrics, mobile report, secret isolation, and service-outage fallback.",
  );
  console.log(
    JSON.stringify(
      data.forecasts.map((f) => ({
        meal: f.meal,
        predicted: f.predicted,
        prepare: f.prepare,
        randomForestMae: f.candidateMae,
        baselineMae: f.baselineMae,
        evaluationDays: f.evaluationDays,
      })),
    ),
  );
} finally {
  if (browser) await browser.close();
  await Promise.all(children.map(stop));
}
