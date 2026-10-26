# Smart Mess

A deployable Next.js MVP for student meal verification and mess management. It
includes a browser-local demo, a persistent PostgreSQL mode, and an integrated
Python machine-learning service with a local-average fallback.

**Deploying the web project to Vercel works in demo mode without any secrets or
external services.** Demo data is synthetic, explicitly labelled, saved only in
the current browser, and reset on the next service date. Live mode requires the
database and configuration described below.

## Included

- Student and manager workspaces with responsive layouts.
- College ID + PIN login in live mode; signed, HTTP-only 8-hour sessions.
- Manager counter display with signed QR tokens, a 90-second expiry and automatic
  refresh every 30 seconds. Students scan with their own camera, upload a QR image,
  or paste the counter token.
- Server-side student/mess/time/duplicate/leave checks. Accepted scans and charges
  are committed together. A unique database index and row locking prevent two
  concurrent requests from charging the same meal twice.
- Green/red scan results, meal history, append-only balance ledger, add-ons, and
  audited office adjustments. Negative balance alone does not block meals.
- Live meal counts, preparation entry, daily CSV exports, review events, policy
  settings, and a manager audit trail.
- Aggregate rolling-demand estimates, historical MAE, and a configurable
  preparation buffer. The connected FastAPI service compares a Random Forest with
  a chronological baseline at the same forecast horizon and uses the model only
  when it improves holdout MAE. Demo and live dashboards show model status and
  evaluation scores. See [ML_SETUP.md](ML_SETUP.md).
- A signed, idempotent Warden webhook adapter. No second Warden application.
- Migrations, account-management commands, automated tests, and GitHub Actions.

## 1. Run locally

Use Node.js **24.x** and npm. From the repository root:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open the local development address printed by Next.js. Choose the student or
manager demo. Try a sample meal scan twice to see the duplicate rejection, then
switch to the manager to see the updated counts. Demo scanning intentionally
bypasses service hours so it can be explored at any time; live mode enforces them.

## 2. Upload to GitHub and deploy to Vercel

1. Unzip this project. Upload the **contents** of the project folder to your GitHub
   repository, including `.github`, `.gitignore`, `.env.example`, and the lockfile.
   Do not upload `node_modules`, `.next`, or your `.env.local`.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Use the repository root as the Root Directory and **Next.js** as the framework.
   Use Node.js **24.x**, Install Command `npm ci`, and Build Command `npm run build`.
4. Set `APP_MODE=demo` explicitly for the first deployment, then deploy.
5. Open the deployed HTTPS address. Both demo workspaces are available immediately.

`vercel.json` contains the matching framework/build settings. No database
migration is run during the Vercel build, and a preview cannot automatically
modify a production database. This repository has not itself been published or
connected to a Vercel account by the author of the files.

## 3. Enable persistent live mode

### Database

Create a PostgreSQL database using Neon, Supabase, or another PostgreSQL provider.
For Vercel, use the provider's **pooled server connection URL**. Use verified TLS
as required by that provider; do not set `rejectUnauthorized: false`.

Put `DATABASE_URL` in your local `.env.local` and run:

```bash
npm run db:migrate
```

The migration runner is transactional, locked against concurrent migration runs,
and checks previously applied migration hashes. Re-running it is safe. Never edit
an applied SQL migration; add a new numbered SQL file instead.

The schema enables row-level security and defines no browser-access policies.
The server must connect as the role that owns these application tables (or an
appropriately provisioned backend role). Supabase anonymous/public client keys
are neither needed nor sufficient. No database credentials go into client code.

### Secrets and configuration

Generate two **different** random values, one each for SESSION_SECRET and
QR_SECRET. For example, run this command separately for each value on your machine:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Add these environment variables to Vercel's Production environment:

| Variable         | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `APP_MODE`       | `live`                                                                    |
| `DATABASE_URL`   | Your private PostgreSQL connection URL                                    |
| `SESSION_SECRET` | Random value, at least 32 characters                                      |
| `QR_SECRET`      | A different random value, at least 32 characters                          |
| `APP_URL`        | The exact HTTPS origin users will use, e.g. `https://your-app.vercel.app` |
| `APP_TIME_ZONE`  | `Asia/Kolkata`, or your institution's IANA time zone                      |

Use separate databases and secrets for staging/preview deployments. If you set
APP_URL, all browser mutations must come from that origin. Update it if you change
your canonical domain. When omitted, requests must match the application request
origin. Redeploy after changing environment variables.

### Create accounts

The application does not ship with a live default administrator or a public
signup endpoint. Create the first manager from your terminal using the same
database configuration. In Bash, read a PIN without echoing or putting it in
shell history:

```bash
read -rs -p 'New 6–12 digit PIN: ' USER_PIN; echo
export USER_PIN
npm run user:create -- --college-id MANAGER001 --name "Mess Manager" --role manager
unset USER_PIN
```

Repeat with `--role student` and the student's ID/name for each student. Share
individual PINs through your institution's approved channel. To reset a PIN:

```bash
read -rs -p 'New PIN: ' USER_PIN; echo
export USER_PIN
npm run user:create -- --college-id STUDENT001 --reset-pin
unset USER_PIN
```

Resetting a PIN revokes all previous sessions for that account. Account creation
does not grant an opening balance. The manager records confirmed payments or
credits through **Student accounts** with a reason.

### Confirm operational settings

Sign in as manager, open **Mess settings**, enter the college's actual meal
windows, prices, add-on prices, leave handling policy, and safety buffer, then
save. Live QR issuance is blocked until this is done. Initial live prices are
zero, not guessed college prices. Meal windows cannot overlap, and their end
times are exclusive. The time zone is established by APP_TIME_ZONE before the
first policy save; changing an existing policy time zone requires a reviewed
database migration.

Open **Counter QR** on a device at the mess. Students sign in separately on their
phones and scan the displayed QR. HTTPS is needed for camera access except on
trusted localhost development addresses. This does not require a shared camera
or a staff scanning device.

## 4. Existing Warden integration

The adapter accepts:

```text
POST /api/warden/leave-status
Content-Type: application/json
X-Warden-Timestamp: <Unix timestamp in seconds>
X-Warden-Signature: sha256=<hex HMAC-SHA256>
```

```json
{
  "eventId": "039fa2a0-ccf6-4aca-b8b3-fd4a015a0308",
  "collegeId": "STUDENT001",
  "leaveId": "warden-record-123",
  "startsOn": "2026-10-20",
  "endsOn": "2026-10-23",
  "status": "approved"
}
```

Configure a separate random `WARDEN_WEBHOOK_SECRET` (32+ characters) on both
systems. Sign the exact string `timestamp + "." + rawJsonBody`. Deliver updates
in order. Timestamps outside a five-minute window are rejected. Retries use the
same eventId and exact JSON body but may use a new timestamp/signature. Reusing an
event ID for different data returns a conflict. `leaveId` identifies the record
to update; a new eventId represents a later approval/rejection event.

This is a working integration contract, **not evidence of connectivity to your
college's Warden system**. Its API access still needs to be arranged. The office
must approve concession rules; concessions are currently recorded as audited
ledger adjustments, not an invented automatic formula.

## 5. Run the machine-learning integration

Install Python **3.12** as well as Node.js 24. From the project root:

```bash
npm run ml:setup
npm run dev:ml
```

In Windows PowerShell use `npm.cmd` instead of `npm`. Setup creates the Python
virtual environment and private local connection settings. `dev:ml` starts both
services. Open the manager dashboard and choose **View model evaluation**.

The shared integration works in both demo and live mode. Demo training uses 84
synthetic completed days; live mode uses aggregate PostgreSQL meal counts. Python
trains a separate Random Forest for each meal, compares it with a rolling average
on chronological holdout targets at the same horizon, and selects the lower-error
method. Tomorrow's forecast now works with data through yesterday. Training needs
42 consecutive days; cold starts, gaps, and service outages are labelled honestly.
Today's partial counts and student profiles are never training inputs.

Read **[ML_SETUP.md](ML_SETUP.md)** for step-by-step Windows setup, the model's
features and validation method, troubleshooting, live data, and deploying Python
alongside Vercel. The model does not yet use holidays, leave-count history, menus,
or ingredients, and synthetic validation does not establish production accuracy.

## 6. Verification

```bash
npm run typecheck
npm test
npm run build
```

Run the end-to-end browser check after building:

```bash
npx playwright install chromium
npm run test:browser
```

It starts and stops its own demo server and checks manager navigation, actual QR
image decoding, duplicate rejection, add-ons, camera cleanup during startup, and
mobile layouts. Camera access uses Chromium's simulated media device; real-phone
camera acceptance testing remains part of the campus pilot. If Chromium is
already installed, set BROWSER_EXECUTABLE to its executable path instead of
downloading a Playwright-managed browser.

For PostgreSQL integration tests, create a **dedicated disposable database** whose
name ends with `_test`, configure TEST_DATABASE_URL, and run:

```bash
npm run test:db
```

These tests clear application tables in that test database. They cover concurrent
duplicate scans, exactly one debit, negative balances, expired/tampered QR tokens,
meal windows, leave policies, idempotent adjustments/add-ons, authorization,
cross-origin request rejection, login throttling, Warden signatures, and dashboard
aggregation. They refuse a database whose name does not end in `_test`.

Python tests:

```bash
pip install -r services/ml/requirements-dev.txt
python -m pytest services/ml -q
```

GitHub Actions runs the web checks with a disposable PostgreSQL service and the
Python tests plus the real Python/Next.js/browser ML integration. Dependency versions are pinned; npm installs use package-lock.json.

## Architecture and limits

```text
src/app/                 Next.js pages and protected API routing
src/components/          Student, manager, QR, login and shared UI
src/lib/                 Validation, auth, database transactions, demo and forecasts
db/                      Versioned PostgreSQL migration
scripts/                 Migrations, account/PIN administration, and ML startup
tests/                   Domain/security, PostgreSQL, browser, and ML integration tests
services/ml/             Integrated FastAPI Random Forest service and tests
.github/workflows/       CI checks
```

This is an online-first pilot MVP, not a claim that every future PRD feature is
finished. The later Handoff PRD's stack is used. The earlier PRD/image makes local
offline service mandatory, while the later handoff puts it in a later phase.

The following are **not implemented**: a local offline server/cloud sync, offline
meal acceptance, biometric/passkey login, student photos, automatic leave refunds,
online payments, North Mess/day-boarder workflows, ingredient quantity planning,
calibrated forecast uncertainty, stored model-version monitoring over time, and
measured food waste in kilograms. Prepared-minus-served is labelled remaining
stock. Forecast results are computed from current history, not stored as an
immutable historical prediction ledger. These should be added as separate,
tested features when their business rules and deployment architecture are known.

The web manifest allows a home-screen shortcut; it is not an offline service
worker. During a network outage, use the institution's agreed manual fallback.
Never serve food based on an unvalidated queued/offline scan. The 60-second green
receipt is a staff aid, not proof against screenshots or device sharing.

Do not publish actual student data, PINs, database URLs, or secret values to GitHub.
The demo is openly accessible by design and must remain clearly identified as
synthetic. Before campus rollout, confirm policies, access, backups, privacy,
monitoring, and institution-specific acceptance testing.
