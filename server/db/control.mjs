/**
 * The control plane database: the master registry of schools (tenants) and their subscription
 * payments. It is a separate database from any tenant's, pointed at by CONTROL_DATABASE_URL.
 *
 * A deployment with no control database is single-tenant (or static-TENANTS) and never touches any
 * of this — the whole self-service provisioning path is inert unless a control database exists.
 */
import { randomUUID } from 'node:crypto';
import { createDatabaseConnection } from './connection.mjs';

const CONTROL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  subdomain TEXT NOT NULL UNIQUE,
  school_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  db_name TEXT NOT NULL DEFAULT '',
  db_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'past_due', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'enterprise',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  subdomain TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'provision' CHECK (purpose IN ('provision', 'renewal')),
  external_reference TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const createControlConnection = ({ connectionString = process.env.CONTROL_DATABASE_URL, useInMemoryDatabase = false } = {}) => {
  if (!useInMemoryDatabase && !connectionString) return null;
  return createDatabaseConnection({ connectionString, useInMemoryDatabase });
};

/**
 * Lift the tenants who predate plans onto Enterprise, once.
 *
 * `plan` has been on this table since it was written, defaulting to 'standard', and until the
 * licensing work nothing ever read it or deliberately set it. So every row carrying 'standard'
 * carries a value nobody chose — and the moment the licence gate started reading this column, all
 * of them would have been demoted on deploy: no examiner, no finance, no billing runs, no audit, no
 * monitoring, no assistant, no search. Schools would have lost screens they use daily, at a deploy
 * they did not ask for, with nothing on screen to explain it.
 *
 * The whole design says a tier is something somebody sells, never something a migration decides, so
 * the rows are lifted rather than the gate loosened.
 *
 * It runs exactly once, and the old column default is the marker: the first pass rewrites the rows
 * and then moves the default to 'enterprise', after which the condition is false forever. A school
 * genuinely sold Standard afterwards keeps it — which a blunt `UPDATE ... WHERE plan = 'standard'`
 * on every boot would quietly undo, every time the server restarted.
 */
const liftPrePlanTenants = async (control) => {
  try {
    const { rows } = await control.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'plan' LIMIT 1`,
    );
    const columnDefault = String(rows[0]?.column_default ?? '');
    if (!columnDefault.includes('standard')) return;

    await control.query(`UPDATE tenants SET plan = 'enterprise' WHERE plan = 'standard'`);
    await control.query(`ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'enterprise'`);
  } catch {
    /* An in-memory control database has no information_schema to consult, and a fresh one is
       already on the new default with no rows to lift. Never a reason to fail start-up: the cost of
       skipping is that the CREATE TABLE default above is already correct. */
  }
};

export const initializeControlSchema = async (control) => {
  await control.query(CONTROL_SCHEMA_SQL);
  await liftPrePlanTenants(control);
};

/* -------------------------------------------------------------------------- */
/* Row operations                                                              */
/* -------------------------------------------------------------------------- */

const TENANT_COLUMNS =
  'id, subdomain, school_name, contact_email, db_name, db_url, status, plan, current_period_end, created_at, activated_at';

// What may leave the control plane. db_url is a live connection string carrying the database
// password, and db_name is most of the way to one — neither is any caller's business, including the
// owner console, so they are dropped rather than trusted to be stripped further up.
const PUBLIC_TENANT_COLUMNS =
  'id, subdomain, school_name, contact_email, status, plan, current_period_end, created_at, activated_at';

export const publicTenant = (tenant) => {
  if (!tenant) return null;
  const { db_url: _url, db_name: _name, ...rest } = tenant;
  return rest;
};

export const getTenantBySubdomain = async (control, subdomain) => {
  const { rows } = await control.query(
    `SELECT ${TENANT_COLUMNS} FROM tenants WHERE subdomain = $1 LIMIT 1`,
    [subdomain],
  );
  return rows[0] || null;
};

/** Registry lookup used per-request: only the URL and status are needed to route. */
export const lookupTenantRoute = async (control, subdomain) => {
  const { rows } = await control.query(
    'SELECT db_url AS url, status FROM tenants WHERE subdomain = $1 LIMIT 1',
    [subdomain],
  );
  return rows[0] || null;
};

export const listTenants = async (control) => {
  const { rows } = await control.query(`SELECT ${PUBLIC_TENANT_COLUMNS} FROM tenants ORDER BY created_at ASC`);
  return rows;
};

export const insertPendingTenant = async (control, { subdomain, schoolName, contactEmail, dbName, dbUrl }) => {
  const { rows } = await control.query(
    `
      INSERT INTO tenants (id, subdomain, school_name, contact_email, db_name, db_url, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      ON CONFLICT (subdomain) DO NOTHING
      RETURNING ${TENANT_COLUMNS}
    `,
    [randomUUID(), subdomain, schoolName, contactEmail, dbName, dbUrl],
  );
  return rows[0] || null;
};

export const markTenantActive = async (control, subdomain, periodEnd, dbName, dbUrl) => {
  // Also (re)sets db_name/db_url here: the pending row created at signup carries empty values, so
  // activation is where the real connection details are written.
  const { rows } = await control.query(
    `
      UPDATE tenants
      SET status = 'active',
          db_name = $3,
          db_url = $4,
          activated_at = COALESCE(activated_at, NOW()),
          current_period_end = $2,
          updated_at = NOW()
      WHERE subdomain = $1
      RETURNING ${TENANT_COLUMNS}
    `,
    [subdomain, periodEnd, dbName, dbUrl],
  );
  return rows[0] || null;
};

export const setTenantStatus = async (control, subdomain, status) => {
  const { rows } = await control.query(
    `UPDATE tenants SET status = $2, updated_at = NOW() WHERE subdomain = $1 RETURNING ${TENANT_COLUMNS}`,
    [subdomain, status],
  );
  return rows[0] || null;
};

/**
 * What a school has been sold.
 *
 * Separate from `setTenantStatus` because they answer different questions: status is whether the
 * school is paid up, plan is what it bought. A suspended school on Enterprise and an active one on
 * Essential are both ordinary states, and collapsing them into one column would make neither
 * answerable.
 */
export const setTenantPlan = async (control, subdomain, plan) => {
  const { rows } = await control.query(
    `UPDATE tenants SET plan = $2, updated_at = NOW() WHERE subdomain = $1 RETURNING ${TENANT_COLUMNS}`,
    [subdomain, plan],
  );
  return rows[0] || null;
};

export const recordTenantPayment = async (control, payment) => {
  const { rows } = await control.query(
    `
      INSERT INTO tenant_payments (id, tenant_id, subdomain, provider, purpose, external_reference, amount, currency, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      randomUUID(),
      payment.tenantId || null,
      payment.subdomain,
      payment.provider,
      payment.purpose || 'provision',
      payment.externalReference,
      payment.amount,
      payment.currency || 'UGX',
      payment.status || 'pending',
      JSON.stringify(payment.metadata || {}),
    ],
  );
  return rows[0];
};

export const getPaymentByReference = async (control, externalReference) => {
  const { rows } = await control.query('SELECT * FROM tenant_payments WHERE external_reference = $1 LIMIT 1', [externalReference]);
  return rows[0] || null;
};

export const setPaymentStatus = async (control, externalReference, status) => {
  const { rows } = await control.query(
    'UPDATE tenant_payments SET status = $2, updated_at = NOW() WHERE external_reference = $1 RETURNING *',
    [externalReference, status],
  );
  return rows[0] || null;
};

/** Tenants whose paid period has lapsed, for the subscription sweep. */
export const findLapsedTenants = async (control, nowIso) => {
  const { rows } = await control.query(
    `SELECT ${TENANT_COLUMNS} FROM tenants WHERE current_period_end IS NOT NULL AND current_period_end < $1 AND status IN ('active', 'past_due')`,
    [nowIso],
  );
  return rows;
};
