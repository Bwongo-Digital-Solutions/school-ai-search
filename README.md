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

- student management with admin edit/delete and teacher view-only access
- audit logging
- conversation and message persistence
- local AI-style student search responses
- PDF report card builder from Student Management
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

Useful commands:

```bash
npm run build
npm run start
npm run test:backend
```

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
