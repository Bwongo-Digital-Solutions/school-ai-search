# School AI Search

SchoolBot AI with:

- a React + Vite frontend
- a Node backend
- PostgreSQL as the real database
- PDF report card generation
- Docker production and Docker live-reload development setups

## Database

The app no longer uses a JSON file as its primary database.

- Database connection module: [server/db/connection.mjs](server/db/connection.mjs)
- Schema/bootstrap logic: [server/db/schema.mjs](server/db/schema.mjs)
- Default runtime connection: `DATABASE_URL`

By default:

- production Docker Compose uses PostgreSQL in the `db` service
- development Docker Compose uses PostgreSQL in the `db` service
- you can point the app at an external managed PostgreSQL instance by overriding `DATABASE_URL`

## Features

- three staff roles: administrators (full edit access), teachers (view-only student records), and non-teaching support staff — security, gatekeepers, cooks, cleaners, drivers — who see school fees payment status and nothing else
- school fees status view listing invoiced, paid, balance, due date, and payment state per student
- admin fee management: fee-structure tiers per grade/term, bulk invoicing for a whole cohort in one run (re-running never double-bills), cash/bank/cheque/mobile-money payment capture with automatic invoice reconciliation, numbered PDF receipts and fee statements, a per-student ledger with running balance, an arrears report aged into 30/60/90-day buckets, and bursaries (percentage or fixed, per student or school-wide)
- payment rating: each student is scored 0–100 and graded A–E from their own payment history — how late settled invoices were paid, how much of the money already due is still owed, and how long the oldest unpaid invoice has been overdue. An admin can override the result with a manual standing plus a required reason and an optional review date; the override takes effect everywhere while the computed rating stays on screen for reference
- student ID card lookup: scan the card QR with the device camera, use a handheld barcode/QR scanner, or type the student number. Support staff get the fees status; teachers and admins jump to the full record
- printable QR student ID cards generated in-app with the open-source `qrcode` library (MIT): one CR80 card per page for card printers, or ten per A4 sheet for cutting
- student registration/admission, attendance, academic history, discipline, class allocation, promotion/graduation, transfer, and withdrawal records
- audit logging
- conversation and message persistence
- local AI-style student search responses
- PDF report card builder from Student Management
- global school branding set by an admin under **Settings** (name, tagline, address, logo, theme colour, contacts) applied to every report card, receipt, statement, ID card and the app header
- student photos stored on the record and printed on ID cards and report cards
- printable, branded PDFs: report cards (with a neat photo/logo header), fee receipts, fee statements, and an admin **financial report** (collections, standings, arrears ageing)
- account approval: non-admin sign-ups wait for admin approval before they can sign in; rejection deletes the account
- Uganda competency-based curriculum (A–E) grading alongside the classic UNEB D1–F9 scale
- multi-tenant ready: host several schools from one deployment with an isolated database per school, selected by subdomain (set `TENANTS`)
- a product footer on every screen showing "Powered by e-School", version and build number, and developer contacts
- Docker production image
- Docker live-reload development stack

## Local Non-Docker Run

You need a PostgreSQL database running first, then set `DATABASE_URL`.

Example:

```bash
export DATABASE_URL=postgres://schoolapp:schoolapp@127.0.0.1:5432/school_ai_search
npm install
npm run dev
```

No PostgreSQL to hand? Run against the in-memory database instead. It uses the same code path,
seeds the demo students on boot, and discards everything when the process exits:

```bash
npm install
npm run dev:memory
```

Useful commands:

```bash
npm run build
npm run start          # needs PostgreSQL at DATABASE_URL
npm run start:memory   # in-memory database, data lost on exit
npm run test:backend
```

## Ollama Setup

SchoolBot can use a local Ollama model for chat searches. The backend must be able to reach Ollama; the browser does not call Ollama directly.

1. Install and start Ollama on the machine that will run the model.

```bash
ollama serve
```

2. Pull the model you want SchoolBot to use.

```bash
ollama pull llama3.2:3b
```

3. Configure the backend environment.

For a non-Docker run:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434
# export OLLAMA_MODEL=llama3.2:3b
export OLLAMA_MODEL=kimi-k3:cloud
export AI_DEFAULT_MODEL_ID=ollama-default
npm run dev
```

For Docker Compose, put these values in your `.env.development` or `.env.production` file:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2:3b
AI_DEFAULT_MODEL_ID=ollama-default
```

The Compose files map `host.docker.internal` to the host gateway, which is needed on Linux. If Ollama is running as another Compose service, use that service name instead, for example `OLLAMA_BASE_URL=http://ollama:11434`.

If Ollama is running on a remote server, point the backend to that server instead:

```bash
OLLAMA_BASE_URL=http://REMOTE_SERVER_IP_OR_DNS:11434
OLLAMA_MODEL=llama3.2:3b
AI_DEFAULT_MODEL_ID=ollama-default
```

On the remote server, Ollama must listen on a network interface that the SchoolBot backend can reach. A common Linux systemd override is:

```bash
sudo systemctl edit ollama
```

Then add:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Restart Ollama after changing it:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Only expose Ollama to trusted networks, a VPN, or a reverse proxy with authentication. Ollama's native HTTP API is not meant to be left open to the public internet.

4. Verify Ollama is reachable before using the model picker.

From the host:

```bash
curl http://127.0.0.1:11434/api/tags
```

From the app container:

```bash
docker compose -f docker-compose.dev.yml exec app-dev wget -qO- http://host.docker.internal:11434/api/tags
```

For a remote server, replace the URL:

```bash
curl http://REMOTE_SERVER_IP_OR_DNS:11434/api/tags
docker compose -f docker-compose.dev.yml exec app-dev wget -qO- http://REMOTE_SERVER_IP_OR_DNS:11434/api/tags
```

If the app says `Could not reach Ollama`, check that `ollama serve` is running, the configured model was pulled, and `OLLAMA_BASE_URL` is reachable from the backend container or process.

## Docker Development

Live-reload development stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Default ports:

- frontend: `http://127.0.0.1:8080`
- backend API: `http://127.0.0.1:8787`
- postgres: `127.0.0.1:5432`

You can customize them with `.env.development` based on [.env.development.example](.env.development.example).

## Docker Production

Production-style stack:

```bash
docker compose up --build -d
```

Default app URL:

- `http://127.0.0.1:8787`

You can customize production values with `.env.production` based on [.env.production.example](.env.production.example).

## Deploy Script

Production deploy helper:

```bash
./scripts/deploy-production.sh
```

It expects:

- `.env.production` to exist
- Docker and Docker Compose to be installed

You can override the env file path:

```bash
ENV_FILE=/path/to/.env.production ./scripts/deploy-production.sh
```

## Report Cards

PDF report cards are built by:

- backend generator: [server/reports/report-card.mjs](server/reports/report-card.mjs)
- API route: `GET /api/report-cards/:studentId.pdf`
- frontend entry point: Student Management table

Each PDF includes:

- school name and term
- student profile details
- attendance and GPA
- subject-by-subject scores and remarks
- teacher comment and notes

## Environment

Important environment variables:

- `DATABASE_URL`
- `DATABASE_SSL`
- `LOCAL_BACKEND_HOST`
- `LOCAL_BACKEND_PORT`
- `LOCAL_STATIC_ROOT`
- `SCHOOL_NAME`
- `SCHOOL_TAGLINE`

## Notes

- The backend auto-creates its schema and seeds sample students when the database is empty.
- Voice transcription is still a placeholder.
- The chat behavior is rule-based and intended for local/product scaffolding, not as a replacement for a real LLM backend.
