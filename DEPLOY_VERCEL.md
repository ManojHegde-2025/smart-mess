# Quick Vercel deployment

1. Unzip the supplied archive and put its contents at the root of your GitHub repo.
2. Import that repo into Vercel as a **Next.js** project.
3. Set Node.js to **24.x**, install to `npm ci`, build to `npm run build`.
4. Set `APP_MODE=demo` and deploy. No other variables are needed for the demo.

To use real persistent records, follow **Enable persistent live mode** in
[README.md](README.md). Configure PostgreSQL and separate SESSION_SECRET and
QR_SECRET values, run migrations, create accounts, set APP_MODE=live and APP_URL,
redeploy, and confirm meal policies in the manager settings.

Vercel PostgreSQL integrations commonly expose `POSTGRES_URL`, which the app
accepts directly. If the integration also provides `PRISMA_DATABASE_URL`, this
app does not need it; the app uses Drizzle with the PostgreSQL `pg` driver, not
Prisma. Set `DATABASE_URL` to the pooled PostgreSQL URL if you prefer one
explicit variable. Never paste database URLs into source files or commit them.

For machine learning, deploy `services/ml` on a Python/container host. Set the
same private `ML_API_KEY` on that host and Vercel, and set Vercel's
`ML_SERVICE_URL` to the Python HTTPS base URL. Redeploy the web app. This works
in both demo and live mode; the dashboard displays the active model and scores.
See [ML_SETUP.md](ML_SETUP.md) for detailed steps. Python is a separate service,
not a long-running process inside a Vercel function. Without it the app clearly
labels its rolling-average fallback.

For a Docker-based ML host, deploy this repository using
`services/ml/Dockerfile` as the Dockerfile and `services/ml` as the build context.
Expose port `8000` and configure the platform's health check to request `/health`.
Set `ML_API_KEY` as a secret on the ML host before deployment. On Vercel, add
`ML_SERVICE_URL` (the ML service's HTTPS base URL) and the same `ML_API_KEY`.

Never commit `.env.local` or add secret variables with a `NEXT_PUBLIC_` prefix.
