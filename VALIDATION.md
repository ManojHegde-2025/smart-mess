# Validation record

The project was validated locally with Node.js 24.19, Python 3.12, PostgreSQL 17.11,
and Chromium. A separate source-only copy was installed with `npm ci` to check
that the project does not depend on the author's workspace or installed helpers.

## Passed

- Clean npm installation, Next.js route type generation, TypeScript checks, and
  an optimized production build.
- **8 domain/security/integration-boundary tests:** time zones and dates, service-window boundaries,
  forecasting without future observations, CSV formula handling, operational
  policy validation, salted PIN verification, authenticated ML requests with
  incomplete/future records excluded, cache reuse/invalidation, and fallback for
  invalid responses, authentication failures, and missing configuration.
- **9 PostgreSQL/API integration tests:** simultaneous scans result in one meal
  and one debit; negative balances alone do not block; invalid/expired/wrong-mess
  tokens and closed windows do not charge; leave policies apply; ledger and
  add-on retries are idempotent; authorization and origin checks work; login
  attempts are throttled; Warden events are authenticated/deduplicated; manager
  counts and balances reflect actual records.
- **9 Python tests:** service authentication, chronological model selection,
  cold-start/gapped-history baselines, invalid observation rejection, one/two/seven
  day model forecasts, two-day evaluation without intervening actuals, and
  baseline selection for constant histories or unsupported horizons.
- End-to-end Chromium check: manager navigation and policy save, generated QR
  image decoding through the actual scanner, duplicate rejection, add-on entry,
  camera shutdown when closed during startup, mobile navigation, and no
  unexpected browser exceptions or horizontal overflow.
- Live production-server HTTP exercise: migration applied and safely re-run,
  manager/student account creation, login, policy configuration, QR issuance,
  concurrent scans, account debit, manager counts, CSV export, and PIN reset
  invalidating an existing session.

The browser check uses a simulated camera. Physical phone cameras, institutional
network conditions, and accessibility with assistive devices still need pilot
acceptance testing. The Python test runner emitted a third-party Starlette/httpx
deprecation warning; all nine tests completed and passed.

## ML integration update

- The updated optimized build and both browser suites passed. A mobile layout
  overflow caused by longer forecast status labels was fixed and rechecked.
- The real Python service trained models on the synthetic 84-day demo history.
  All three Next.js forecasts used Random Forest at the correct two-day horizon.
  The browser displayed active-model badges and model/baseline MAE, including on
  the responsive reports screen. No unexpected browser exceptions occurred.
- Stopping the test Python process produced a visible rolling-average fallback.
  Mobile dashboard layout was checked with both ML-active and fallback labels.
- Service keys stayed out of the forecast response and client UI.
- `npm run ml:setup` was executed twice successfully. `npm run dev:ml` started
  Python and Next.js together; the actual development dashboard showed three
  active ML models with no horizontal overflow on a 390-pixel viewport.
- The Windows command path is supplied but was not executed on a Windows machine.
  Setup and runtime execution were verified on this Linux workspace.

The synthetic weekly pattern is deliberately learnable. Its holdout errors do
not establish accuracy on real campus data. Actual holiday, leave-history, menu,
and recipe data are not available as training inputs in this version.

## Not claimed

No GitHub push, GitHub-hosted CI run, Vercel publication, external Warden
connectivity, production database provisioning, real-student-data testing, or
production forecasting accuracy was performed. The Python Docker image
was supplied but not built or deployed. See README.md for the explicit MVP scope
and deferred features.
