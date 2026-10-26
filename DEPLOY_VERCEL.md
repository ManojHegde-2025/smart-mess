# Quick Vercel deployment

1. Unzip the supplied archive and put its contents at the root of your GitHub repo.
2. Import that repo into Vercel as a **Next.js** project.
3. Set Node.js to **24.x**, install to `npm ci`, build to `npm run build`.
4. Set `APP_MODE=demo` and deploy. No other variables are needed for the demo.

To use real persistent records, follow **Enable persistent live mode** in
[README.md](README.md). Configure PostgreSQL and separate SESSION_SECRET and
QR_SECRET values, run migrations, create accounts, set APP_MODE=live and APP_URL,
redeploy, and confirm meal policies in the manager settings.

For machine learning, deploy `services/ml` on a Python/container host. Set the
same private `ML_API_KEY` on that host and Vercel, and set Vercel's
`ML_SERVICE_URL` to the Python HTTPS base URL. Redeploy the web app. This works
in both demo and live mode; the dashboard displays the active model and scores.
See [ML_SETUP.md](ML_SETUP.md) for detailed steps. Python is a separate service,
not a long-running process inside a Vercel function. Without it the app clearly
labels its rolling-average fallback.

Never commit `.env.local` or add secret variables with a `NEXT_PUBLIC_` prefix.
