// Starts its own demo server, exercises product flows, and always cleans up.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const port = process.env.BROWSER_TEST_PORT ?? "3105";
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, APP_MODE: "demo", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  },
);
let browser;
let exited = false;
server.once("exit", () => {
  exited = true;
});
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (exited)
      throw new Error(
        "Test server exited; check the build and whether the test port is free.",
      );
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Demo server did not become ready");
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    permissions: ["camera"],
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    window.testStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args);
      window.testStreams.push(stream);
      // Reproduce closing the modal while permission/startup is still pending.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return stream;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "I manage the mess" }).click();
  await page.getByRole("heading", { name: "Your mess, at a glance" }).waitFor();
  await page.getByRole("link", { name: "Student accounts" }).click();
  await page.getByRole("heading", { name: "48 student accounts" }).waitFor();
  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByRole("heading", { name: "Add student account" }).waitFor();
  await page.getByPlaceholder("e.g. Rahul Sharma").fill("Test Browser Student");
  await page.getByPlaceholder("e.g. SM2026101").fill("SM2026999");
  await page.getByPlaceholder("6–12 numeric digits").fill("123456");
  await page.getByRole("button", { name: "Create student account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("link", { name: "Reports & activity" }).click();
  await page.getByRole("heading", { name: "Preparation & service" }).waitFor();
  await page.getByRole("link", { name: "Mess settings" }).click();
  await page
    .getByRole("button", { name: "Confirm & save operational policy" })
    .click();
  await page.getByRole("status").waitFor();
  await page.getByRole("link", { name: "Counter QR" }).click();
  const qr = page.getByRole("img", { name: "Current lunch QR token" });
  await qr.waitFor();
  const encoded = await qr.getAttribute("src");
  const qrImage = Buffer.from(encoded.split(",")[1], "base64");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "I’m a student" }).click();
  await page.getByRole("button", { name: "Scan meal QR" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "counter-qr.png",
      mimeType: "image/png",
      buffer: qrImage,
    });
  await page.getByRole("heading", { name: "Enjoy your meal!" }).waitFor();
  await page.getByRole("button", { name: "Back to my meals" }).click();
  await page.getByRole("button", { name: "Scan meal QR" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "counter-qr.png",
      mimeType: "image/png",
      buffer: qrImage,
    });
  await page.getByRole("heading", { name: "Meal not allowed" }).waitFor();
  await page.getByRole("button", { name: "Back to my meals" }).click();
  await page
    .getByRole("button", { name: "Add Extra milk", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Leave status" }).click();
  await page.getByRole("button", { name: "Request leave" }).click();
  await page.getByRole("heading", { name: "Request mess leave" }).waitFor();
  await page
    .getByPlaceholder("e.g. Visiting hometown, attending seminar")
    .fill("Visiting hometown");
  await page.getByRole("button", { name: "Submit leave request" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Scan meal QR" }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await page.waitForFunction(() => window.testStreams.length > 0);
  await page.getByRole("button", { name: "Close scanner" }).click();
  await page.waitForFunction(
    () =>
      window.testStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    {},
    { timeout: 5000 },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const sidebar = await page.locator(".sidebar").boundingBox();
  assert.ok(
    !sidebar || sidebar.x + sidebar.width < 1,
    "Mobile sidebar should be hidden",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Student layout overflow",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "I manage the mess" }).click();
  await page.getByRole("heading", { name: "Your mess, at a glance" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Manager layout overflow",
  );
  assert.deepEqual(errors, [], "Unexpected browser errors");
  console.log(
    "PASS: manager navigation, policy save, QR image decoding, duplicate rejection, add-on, camera startup cancellation, and mobile layouts.",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (!exited) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
}
