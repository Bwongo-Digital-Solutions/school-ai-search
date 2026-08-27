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

Minimum config for a persistent deploy: **`DATABASE_URL`**, plus **`SESSION_SECRET`** — without the
second, the app signs session cookies with a key it generates at startup, so every restart signs
every user out and nothing works across more than one replica. Everything else has defaults. The
full env reference is in [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) → *Environment Variables*.

```bash
openssl rand -hex 32     # SESSION_SECRET
openssl rand -hex 32     # PLATFORM_OWNER_TOKEN, if you are hosting more than one school
```

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

## Option 4 — Docker on your own VPS (the real multi-tenant deployment)

The repo ships `Dockerfile`, `docker-compose.yml`, and `docker-compose.dev.yml`.

```bash
cp .env.production.example .env.production   # set POSTGRES_PASSWORD, SCHOOL_NAME, etc.
docker compose up --build -d                 # app on 127.0.0.1:8787 + postgres with a volume
```

Note the app now publishes on **loopback only** (`APP_BIND`, default `127.0.0.1`) because a reverse
proxy is meant to be the way in. Set `APP_BIND=0.0.0.0` if you are deliberately running without one.

### Running many schools on eschool.ink

Each school gets its own subdomain and its own database. Nothing about DNS changes when a school
signs up, because the whole domain is already pointed here.

**1. DNS — two records, both to this server:**

| Type | Name | Purpose |
| --- | --- | --- |
| `A` | `eschool.ink` | The marketing page, `/signup` and `/owner` |
| `A` | `*.eschool.ink` | Every school |

**2. TLS — a wildcard certificate, which means DNS-01.** A wildcard cannot be issued over the
HTTP-01 challenge; the ACME server has to see a DNS record it asked you to publish. Pick one:

```bash
# nginx: you obtain the certificate, nginx serves it
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d eschool.ink -d '*.eschool.ink'
cp -L /etc/letsencrypt/live/eschool.ink/{fullchain,privkey}.pem deploy/nginx/certs/
docker compose --profile proxy-nginx up -d

# Caddy: Caddy obtains and renews it itself, given a DNS API token
#   set ACME_EMAIL and CLOUDFLARE_API_TOKEN in .env.production
docker compose --profile proxy-caddy up -d
```

Both configurations are in [`deploy/`](deploy/) and both do the one thing that matters: **preserve
the `Host` header**, since that is what selects the school. A proxy that rewrites it sends every
school to the default tenant, which serves the *wrong data* rather than failing.

If you already run nginx on the host rather than in Docker, use
[`deploy/nginx/eschool.ink.conf`](deploy/nginx/eschool.ink.conf) instead — same rules, proxying to
`127.0.0.1:8787`.

**3. The control plane.** One extra database holding the registry of schools, plus a role that may
create databases:

```sql
CREATE DATABASE eschool_control OWNER schoolapp;
CREATE ROLE provisioner LOGIN PASSWORD 'change-me' CREATEDB;
```

Then in `.env.production`:

```ini
SESSION_SECRET=<openssl rand -hex 32>
PLATFORM_OWNER_TOKEN=<openssl rand -hex 32>
TENANT_ROOT_DOMAIN=eschool.ink
CONTROL_DATABASE_URL=postgres://schoolapp:...@db:5432/eschool_control
PROVISION_ADMIN_DATABASE_URL=postgres://provisioner:...@db:5432/postgres
TENANT_DB_URL_TEMPLATE=postgres://schoolapp:...@db:5432/{db}
SUBSCRIPTION_AMOUNT=500000
PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
EMAIL_MODE=http
EMAIL_API_KEY=...
EMAIL_FROM=e-School <no-reply@eschool.ink>
```

**4. Create the first school.** Open `https://eschool.ink/owner`, paste the
`PLATFORM_OWNER_TOKEN`, and add a school. Its subdomain is live immediately; the first account
created there becomes its administrator. Schools can also sign themselves up and pay at
`https://eschool.ink/signup`.

**5. Schedule the subscription sweep** so lapsed schools move to past due and then suspended:

```bash
0 2 * * *  curl -fsS -X POST https://eschool.ink/api/provision \
             -H 'Content-Type: application/json' \
             -H "Authorization: Bearer $PLATFORM_OWNER_TOKEN" \
             -d '{"action":"sweep"}'
```

Full details: [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) and [USER_GUIDE.md](USER_GUIDE.md) → §9.

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
- **Restart the stack and confirm you are still signed in.** If you are not, `SESSION_SECRET` is not
  reaching the container, and every restart is logging your whole school out.
- (Multi-tenant) verify a school provisions via `/signup` and its subdomain serves in isolation, and
  that a search in one school returns nothing from another.
