# Run Smart Mess with machine learning

The manager dashboard now calls the Python prediction service in **both demo and
live mode**. You can run both services from one terminal. No manual training
command or OpenAI/API subscription is needed.

## Windows: first-time setup

1. Install **Node.js 24** from https://nodejs.org/en/download.
2. Install **Python 3.12** from https://www.python.org/downloads/windows/.
   Include the Python launcher and select **Add Python to PATH** in the installer.
3. Close Windows Terminal completely and reopen it after installation.
4. Extract the project ZIP. Open the folder containing `package.json` in File
   Explorer. Type `powershell` in its address bar and press Enter.
5. Check the installations:

   ```powershell
   node --version
   npm.cmd --version
   py -3.12 --version
   ```

6. Run these commands one at a time, waiting for each to finish:

   ```powershell
   npm.cmd ci
   npm.cmd run ml:setup
   npm.cmd run dev:ml
   ```

`ml:setup` creates `services/ml/.venv`, installs the Python packages, and adds the
local service URL and a randomly generated private key to `.env.local`. It keeps
existing configuration and does not print the key. This file is ignored by Git.
No PowerShell execution-policy change or virtual-environment activation is needed.

`dev:ml` starts Python on port 8000, waits for its health check, then starts Next.js.
Open the Next.js address printed in the terminal (usually port 3000). Select
**I manage the mess**, then **Reports & activity** or **View model evaluation**.

You should see **ML model active**, **Random Forest v2**, tomorrow's predicted
meals, preparation quantities, and model-versus-baseline errors for all three
meals. The demo uses 84 completed days of **synthetic** data with a weekly pattern.
Its results demonstrate the integration; they are not evidence of real-campus
accuracy. The new demo version resets the old synthetic browser fixture once.

Keep the terminal open. Press **Ctrl+C** to stop both services. Next time, run only:

```powershell
npm.cmd run dev:ml
```

On macOS/Linux, install Python 3.12 and Node.js 24, then use the same commands with
`npm` instead of `npm.cmd`. Use `npm run ml:start` to run only Python in a separate
terminal. `npm run dev` starts only the website; it connects if Python is already
running or displays a labelled fallback if not.

## What the model does

1. The app groups accepted meals by service date and meal type, scoped to one mess.
2. It excludes today's incomplete counts and any future records.
3. For each meal, Python builds features for weekday, weekend, previous-day count,
   the same day last week, seven-day average, fourteen-day average, and weekly trend.
4. At least **42 consecutive completed days per meal** are needed to evaluate a
   Random Forest. Fewer than seven records stay on the app's local average.
5. Python trains on earlier observations and evaluates on the last 7–14 target
   days. Both the forest and baseline use the same forecast horizon and available
   information. Unobserved intervening days are predicted recursively.
6. The forest is selected only when its held-out mean absolute error (MAE) is
   lower. For example, MAE 3 means an average historical error of three meals.
7. The selected estimate plus the configured preparation buffer appears in the
   manager dashboard. Reports show both model scores and the reason for selection.

Tomorrow is two days after yesterday, the most recent complete service day. The
model now supports that case as well as horizons of one to seven days. Missing
days are not silently interpreted as zero. Gapped histories and longer horizons
use an explicitly labelled baseline. Variation ranges are not confidence intervals.

Training is automatic and on demand. Identical successful requests are cached for
five minutes per web process; changes to completed counts, date, or buffer create
a new request. Outages are cached for fifteen seconds before retry. There is no
saved model file, durable model registry, or immutable forecast archive yet.

## Use real data

Complete the PostgreSQL/live-mode setup in [README.md](README.md). Keep
`ML_SERVICE_URL` and `ML_API_KEY` configured, and use `APP_MODE=live`.

The same integration reads up to 180 days of real aggregate meal history instead
of the demo fixture. Record actual meal scans and preparation counts consistently.
No student names, IDs, PINs, balances, or database credentials are sent to Python.

Current features use meal-count history and the calendar. Holiday/event calendars,
historical approved-leave counts, menu preferences, ingredient recipes, and
per-student predictions are **not** model inputs. Those need reliable additional
datasets; they are not invented from missing records. The existing Warden leave
integration continues to control meal eligibility separately.

## Deploy with Vercel

Vercel hosts Next.js. Host `services/ml` separately on a Python/container host.
Use its existing Dockerfile with `services/ml` as the build context, or install
`requirements.txt` and start `python -m uvicorn app:app --host 0.0.0.0 --port 8000`.
Configure the host to route to that port and health-check `/health`.

1. Generate a private random key of at least 32 characters in your host's secret
   settings. Set it as `ML_API_KEY` on the Python service.
2. In Vercel, set `ML_SERVICE_URL` to the Python service's **HTTPS base URL** and
   set the same `ML_API_KEY`. Neither variable uses `NEXT_PUBLIC_`.
3. Redeploy Next.js. `APP_MODE=demo` demonstrates real Python training on synthetic
   history; `APP_MODE=live` uses your database records.

There is no browser-to-Python call or CORS configuration requirement. Next.js
authenticates to Python server-side. A failed request, timeout, authentication
failure, or malformed response produces a visible fallback instead of blocking
meal operations. A production host must be sized for the model's memory/CPU;
the included on-demand training is intended for a small pilot.

## Troubleshooting

| Display/problem                  | Meaning and action                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm` is not recognized          | Install Node.js 24 and reopen Windows Terminal. Use `npm.cmd` in PowerShell.                       |
| Python 3.12 not found            | Install Python 3.12 with the launcher, reopen Terminal, and rerun `ml:setup`.                      |
| ML not connected                 | Run `ml:setup`; for a hosted service, configure both ML environment variables and restart Next.js. |
| ML unavailable · fallback active | Start Python with `dev:ml`, or check its URL, matching API key, service logs, and reachability.    |
| More history needed              | Gather completed records; Random Forest needs 42 consecutive days per meal.                        |
| Baseline performed better        | Training ran successfully, but the average had equal or lower validation error.                    |
| History has missing days         | Resolve missing service records; do not fabricate zero counts.                                     |
| Port already in use              | Stop the earlier local service before starting `dev:ml`.                                           |

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:ml
```

`test:ml` starts isolated Python and Next.js servers, checks the real model output,
opens Chromium, checks dashboard/report metrics and mobile layout, stops Python,
and verifies fallback behavior. Install Chromium with `npx playwright install
chromium`, or set `BROWSER_EXECUTABLE` to an installed Chromium executable.
Use `ML_TEST_PYTHON` if Python dependencies are installed outside the local venv.
All test servers are stopped when the check finishes.

For the Python tests, install `services/ml/requirements-dev.txt` in your Python
environment and run `python -m pytest services/ml -q` from the project root.
