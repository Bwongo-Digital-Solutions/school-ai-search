# Deploying e-School

e-School is a single Node server that serves the built SPA **and** the `/api` backend, backed by
PostgreSQL. There are two deployment shapes:

| Shape | Data | Multi-tenant | Use it for |
| --- | --- | --- | --- |
| **Persistent server + PostgreSQL** | Durable | ✅ supported | Real use — Render, Railway, Fly.io, or Docker on a VPS. |
| **Vercel + in-memory** | Ephemeral (resets on cold start) | ❌ | A public **demo** of the UI only. |

For most people: pick one persistent host below. `npm run build` produces `dist`; `npm start`
(`node server/local-backend.mjs`) serves `dist` + `/api` on port `8787` (it also honours `PORT`).
The repo already includes a production `Dockerfile`.

Minimum config for a persistent deploy: **`DATABASE_URL`**. Everything else has defaults. The full
env reference is in [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) → *Environment Variables*.

---

## Option 1 — Render (easiest managed, uses `render.yaml`)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, select the repo. Render reads [`render.yaml`](render.yaml) and
   creates a **web service** (from the Dockerfile) + a **managed Postgres**, wiring `DATABASE_URL`
   automatically.
3. Deploy. Your app is at `https://eschool.onrender.com` (or your service name).

Health check is `/api/health`. To add multi-tenancy/provisioning later, set the extra env vars
listed at the bottom of `render.yaml`.

## Option 2 — Fly.io (uses the Dockerfile + `fly.toml`)

```bash
fly launch --no-deploy         # edit the app name in fly.toml first if taken
fly postgres create            # managed Postgres
fly postgres attach <cluster>  # sets DATABASE_URL as a secret
fly deploy
```

[`fly.toml`](fly.toml) runs the Dockerfile on internal port 8787 with an `/api/health` check.
Set other config with `fly secrets set KEY=value`.

## Option 3 — Railway

1. **New Project → Deploy from GitHub repo** (Railway auto-detects the `Dockerfile`).
2. **Add → Database → PostgreSQL**. Railway sets `DATABASE_URL` for the service.
3. Ensure the web service targets port **8787** (Railway reads the Dockerfile's `EXPOSE`).
   Deploy — done.

## Option 4 — Docker on your own VPS (best for full multi-tenant)

The repo ships `Dockerfile`, `docker-compose.yml`, and `docker-compose.dev.yml`.

```bash
cp .env.production.example .env.production   # set POSTGRES_PASSWORD, SCHOOL_NAME, etc.
docker compose up --build -d                 # app on :8787 + postgres with a volume
```

For **multi-tenancy** (a database per school, chosen by subdomain), put a reverse proxy
(Caddy/Nginx/Traefik) in front with **wildcard DNS** (`*.your-domain`) and a **wildcard TLS**
certificate, and set `CONTROL_DATABASE_URL`, `PROVISION_ADMIN_DATABASE_URL` (a CREATEDB role),
`TENANT_DB_URL_TEMPLATE`, `SUBSCRIPTION_*`, live `PAYMENT_*` and `EMAIL_*`. Schedule a daily
`POST /api/provision {"action":"sweep","requesterRole":"admin"}`. Full details:
[TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) and [USER_GUIDE.md](USER_GUIDE.md) → §9.

## Option 5 — Vercel (demo only, in-memory)

[`vercel.json`](vercel.json) builds the SPA to `dist` and routes `/api/*` to one serverless function
([`api/[...path].js`](api/[...path].js)) that runs the backend against the **in-memory** database.

- No database to provision; the app starts from the 15 seeded demo students.
- **Data is not durable** — serverless memory resets on cold starts and differs between instances.
  Anything created (students, fees, sign-ups) is temporary.
- Multi-tenant provisioning does **not** run on serverless.

Deploy: push the repo; in Vercel, remove any custom Build/Output/Dev command overrides (so
`vercel.json` is used) and deploy. Use this only for a shareable UI demo — not real records.

---

## Post-deploy checklist

- Open the site → **Sign Up**; the first account becomes the administrator.
- Set branding under **Settings** (name, logo, theme colour) — it flows into every document.
- (Persistent hosts) confirm data survives a restart/redeploy.
- (Multi-tenant) verify a school provisions via `/signup` and its subdomain serves in isolation.
