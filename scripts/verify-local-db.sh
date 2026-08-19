#!/usr/bin/env bash
# Connects to the local Postgres using .env, bootstraps the schema, and reports what landed.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

# .env targets the compose service name `db`; from the host it is 127.0.0.1.
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${DEV_DB_PORT}/${POSTGRES_DB}"

echo "== connection =="
psql "$DATABASE_URL" -tAc "SELECT 'connected to '||current_database()||' as '||current_user||' on PG '||current_setting('server_version');"

echo; echo "== bootstrapping schema =="
node -e "
import('./server/db/connection.mjs').then(async ({ createDatabaseConnection }) => {
  const { initializeDatabase } = await import('./server/db/schema.mjs');
  const db = createDatabaseConnection({ connectionString: process.env.DATABASE_URL });
  await initializeDatabase(db);
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM students');
  console.log('  schema applied; students seeded:', rows[0].n);
  await db.close();
});
"

echo; echo "== fee tables =="
psql "$DATABASE_URL" -c "\d+ fee_bursaries" >/dev/null && echo "  fee_bursaries OK"
psql "$DATABASE_URL" -c "\d+ student_fee_standings" >/dev/null && echo "  student_fee_standings OK"
psql "$DATABASE_URL" -tAc "
SELECT '  '||table_name||' ('||count(*)||' cols)'
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('fee_structures','invoices','payments','receipts','fee_bursaries','student_fee_standings')
GROUP BY table_name ORDER BY table_name;"

echo; echo "== new indexes =="
psql "$DATABASE_URL" -tAc "
SELECT '  '||indexname FROM pg_indexes
WHERE schemaname='public'
  AND indexname IN ('idx_invoices_billing_key','idx_student_fee_standings_active','idx_payments_invoice','idx_receipts_payment')
ORDER BY indexname;"
