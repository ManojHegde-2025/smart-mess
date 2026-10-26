import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const service = join(root, "services", "ml");
const windows = process.platform === "win32";
const python = join(
  service,
  ".venv",
  windows ? "Scripts" : "bin",
  windows ? "python.exe" : "python",
);
const envFile = join(root, ".env.local");
const files = [".env", ".env.local"].reduce((env, name) => {
  const file = join(root, name);
  return {
    ...env,
    ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}),
  };
}, {});
const env = { ...files, ...process.env };
const children = new Set();
let stopping = false;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(`Command failed: ${command}. Check the output above.`);
}
function saveVariable(name, value) {
  let contents = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
    : "APP_MODE=demo\n";
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, "m");
  contents = pattern.test(contents)
    ? contents.replace(pattern, `${name}=${value}`)
    : `${contents.trimEnd()}\n${name}=${value}\n`;
  writeFileSync(envFile, contents, { mode: 0o600 });
  env[name] = value;
}
function localAddress() {
  const url = new URL(env.ML_SERVICE_URL || "http://127.0.0.1:8000");
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.username ||
    url.password
  )
    throw new Error(
      "For local startup set ML_SERVICE_URL=http://127.0.0.1:8000 in .env.local. For a hosted ML service, use npm run dev instead.",
    );
  return url;
}
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 2000).unref();
}
function launch(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  children.add(child);
  child.on("error", () => {
    console.error("A service could not start. Run npm run ml:setup first.");
    stop(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

try {
  const action = process.argv[2];
  if (action === "setup") {
    localAddress();
    const candidates = windows
      ? [["py", "-3.12"], ["python"]]
      : [["python3.12"], ["python3"], ["python"]];
    const executable = candidates.find(([command, ...args]) => {
      const check = spawnSync(
        command,
        [
          ...args,
          "-c",
          "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)",
        ],
        { stdio: "ignore" },
      );
      return !check.error && check.status === 0;
    });
    if (!executable)
      throw new Error(
        "Install Python 3.12 from python.org, include the Windows Python launcher, then reopen your terminal and retry npm run ml:setup.",
      );
    if (!existsSync(python))
      run(executable[0], [
        ...executable.slice(1),
        "-m",
        "venv",
        join(service, ".venv"),
      ]);
    run(python, [
      "-m",
      "pip",
      "install",
      "-r",
      join(service, "requirements.txt"),
    ]);
    if (!env.ML_SERVICE_URL)
      saveVariable("ML_SERVICE_URL", "http://127.0.0.1:8000");
    if (!env.ML_API_KEY)
      saveVariable("ML_API_KEY", randomBytes(32).toString("hex"));
    if (env.ML_API_KEY.length < 32)
      throw new Error(
        "Existing ML_API_KEY is too short. Configure a random value of at least 32 characters in .env.local.",
      );
    console.log(
      "ML dependencies are installed. Local connection settings are ready; secrets were not printed. Run npm run dev:ml.",
    );
  } else if (action === "start" || action === "dev") {
    if (!existsSync(python) || !env.ML_API_KEY || env.ML_API_KEY.length < 32)
      throw new Error("Run npm run ml:setup first.");
    const address = localAddress();
    launch(
      python,
      [
        "-m",
        "uvicorn",
        "app:app",
        "--host",
        address.hostname,
        "--port",
        address.port || "80",
      ],
      service,
    );
    if (action === "dev") {
      let ready = false;
      for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
        try {
          const response = await fetch(new URL("/health", address), {
            signal: AbortSignal.timeout(500),
          });
          const health = await response.json();
          if (
            response.ok &&
            health.service === "aggregate-demand" &&
            health.version === "2.0.0"
          ) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for Python imports and startup. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!ready || stopping)
        throw new Error(
          "ML service did not start. Check the Python output and whether its port is already in use.",
        );
      launch(
        process.execPath,
        [join(root, "node_modules", "next", "dist", "bin", "next"), "dev"],
        root,
      );
      console.log(
        "ML is ready. Open the Next.js address below, choose manager, then Reports & activity. Ctrl+C stops both services.",
      );
    }
  } else
    throw new Error(
      "Use npm run ml:setup, npm run ml:start, or npm run dev:ml.",
    );
} catch (error) {
  console.error(error.message);
  stop(1);
}
