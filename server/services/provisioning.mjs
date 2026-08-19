/**
 * Self-service tenant provisioning: a school signs up, pays through the existing gateway, and on a
 * successful payment its isolated database is created and registered so its subdomain goes live
 * immediately (wildcard DNS/TLS mean no per-school DNS work). Renewals extend the subscription; a
 * lapsed subscription moves the tenant to past_due then suspended.
 *
 * The one operation that cannot run on the test database — CREATE DATABASE against a real Postgres
 * cluster — is injected as `createPhysicalDatabase`, so the whole flow is exercised on pg-mem with
 * that step mocked, and runs for real in production.
 */
import { initializeDatabase } from '../db/schema.mjs';
import { createDatabaseConnection } from '../db/connection.mjs';
import {
  findLapsedTenants,
  getPaymentByReference,
  getTenantBySubdomain,
  insertPendingTenant,
  markTenantActive,
  recordTenantPayment,
  setPaymentStatus,
  setTenantStatus,
} from '../db/control.mjs';

// Subdomains that must never become a tenant, because they are the platform's own hostnames.
export const RESERVED_SUBDOMAINS = new Set([
  'default', 'www', 'api', 'app', 'apply', 'admin', 'signup', 'billing', 'status', 'mail', 'static', 'assets', 'cdn',
]);

// Read at call time (not import time) so runtime config and tests both take effect.
const periodDaysEnv = () => Number(process.env.SUBSCRIPTION_PERIOD_DAYS || 120); // one school term
const graceDaysEnv = () => Number(process.env.SUBSCRIPTION_GRACE_DAYS || 14);
const subscriptionAmount = () => Number(process.env.SUBSCRIPTION_AMOUNT || 0);
const subscriptionCurrency = () => process.env.SUBSCRIPTION_CURRENCY || 'UGX';
const tenantDbPrefix = () => process.env.TENANT_DB_PREFIX || 'school_';

export const normalizeSubdomain = (value) => String(value ?? '').trim().toLowerCase();

// DNS-label rules: a–z, 0–9 and hyphens, 3–40 chars, not starting/ending with a hyphen.
export const validateSubdomain = (raw) => {
  const subdomain = normalizeSubdomain(raw);
  if (!subdomain) return { ok: false, reason: 'A subdomain is required' };
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(subdomain)) {
    return { ok: false, reason: 'Use 3–40 letters, numbers or hyphens (not starting or ending with a hyphen)' };
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) return { ok: false, reason: 'That subdomain is reserved' };
  return { ok: true, subdomain };
};

const dbNameFor = (subdomain) => `${tenantDbPrefix()}${subdomain.replace(/-/g, '_')}`;

// Build the app's connection URL for a tenant db. TENANT_DB_URL_TEMPLATE contains a {db} token,
// e.g. postgres://schoolapp:pass@db:5432/{db}. This is the app role, never the admin role.
const tenantUrlFor = (dbName) => {
  const template = process.env.TENANT_DB_URL_TEMPLATE || '';
  if (template.includes('{db}')) return template.replace('{db}', dbName);
  // Fall back to swapping the database name on CONTROL/DATABASE_URL.
  const base = process.env.DATABASE_URL || process.env.CONTROL_DATABASE_URL || '';
  return base.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
};

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

/**
 * The default real CREATE DATABASE. `CREATE DATABASE` cannot run inside a transaction and the
 * target must have no open connections, so it uses a dedicated admin connection (a role with
 * CREATEDB, from PROVISION_ADMIN_DATABASE_URL). Idempotent: skips creation if the db already exists.
 */
export const createPhysicalDatabase = async (dbName) => {
  const adminUrl = process.env.PROVISION_ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error('PROVISION_ADMIN_DATABASE_URL is not configured');
  const admin = createDatabaseConnection({ connectionString: adminUrl });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rows.length === 0) {
      // Identifier is derived from a validated subdomain, so it is a safe [a-z0-9_] string.
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.close();
  }
};

/**
 * Provisions (or re-activates) a tenant: creates its database if needed, builds its schema, and
 * marks it active with a fresh subscription period. Safe to call more than once for the same
 * subdomain — a repeated call just extends the period.
 */
export const provisionTenant = async (
  control,
  { subdomain, schoolName = '', contactEmail = '' },
  {
    createPhysicalDatabase: createDb = createPhysicalDatabase,
    createConnection = createDatabaseConnection,
    init = initializeDatabase,
    now = new Date(),
    periodDays = periodDaysEnv(),
  } = {},
) => {
  const validation = validateSubdomain(subdomain);
  if (!validation.ok) throw new Error(validation.reason);
  const id = validation.subdomain;

  const dbName = dbNameFor(id);
  const dbUrl = tenantUrlFor(dbName);

  await insertPendingTenant(control, { subdomain: id, schoolName, contactEmail, dbName, dbUrl });

  // Create the physical database (idempotent), then build its schema through a normal connection.
  await createDb(dbName);
  const tenantDb = createConnection({ connectionString: dbUrl });
  try {
    await init(tenantDb);
  } finally {
    await tenantDb.close();
  }

  return markTenantActive(control, id, addDays(now, periodDays).toISOString(), dbName, dbUrl);
};

export const checkAvailability = async (control, subdomain) => {
  const validation = validateSubdomain(subdomain);
  if (!validation.ok) return { available: false, reason: validation.reason };
  const existing = await getTenantBySubdomain(control, validation.subdomain);
  if (existing) return { available: false, reason: 'That subdomain is already taken' };
  return { available: true, subdomain: validation.subdomain };
};

/**
 * Starts a subscription payment for a new or renewing school through the shared gateway. Records a
 * pending tenant + payment; the actual provisioning happens when the payment callback confirms.
 */
export const startSubscription = async (
  control,
  { subdomain, schoolName = '', contactEmail = '', provider, phoneNumber, bankCode },
  { initiateCharge, httpClient } = {},
) => {
  const validation = validateSubdomain(subdomain);
  if (!validation.ok) return { error: validation.reason };

  if (!(subscriptionAmount() > 0)) {
    return { error: 'Subscription pricing is not configured (set SUBSCRIPTION_AMOUNT)' };
  }
  if (!['mtn_momo', 'airtel_money', 'bank'].includes(provider)) {
    return { error: 'Choose a payment method: mtn_momo, airtel_money or bank' };
  }

  // An existing active school is renewing; a suspended one is reactivating; otherwise a new signup.
  const existing = await getTenantBySubdomain(control, validation.subdomain);
  const purpose = existing && existing.status === 'active' ? 'renewal' : 'provision';
  if (!existing) {
    await insertPendingTenant(control, {
      subdomain: validation.subdomain,
      schoolName,
      contactEmail,
      dbName: '',
      dbUrl: '',
    });
  }

  // Collect the platform subscription through the shared gateway (mock by default). The charge is
  // recorded in the control database — it is a platform charge, not a student's fee.
  const charge = await initiateCharge({
    provider,
    amount: subscriptionAmount(),
    currency: subscriptionCurrency(),
    phoneNumber,
    bankCode,
    description: `eSchool subscription — ${validation.subdomain}`,
    accountReference: validation.subdomain,
    httpClient,
  });

  await recordTenantPayment(control, {
    tenantId: existing?.id || null,
    subdomain: validation.subdomain,
    provider,
    purpose,
    externalReference: charge.external_reference,
    amount: subscriptionAmount(),
    currency: subscriptionCurrency(),
    status: 'pending',
    metadata: { schoolName, contactEmail },
  });

  return {
    subdomain: validation.subdomain,
    purpose,
    reference: charge.external_reference,
    status: charge.status,
    instructions: charge.customerMessage,
  };
};

/**
 * Confirms a subscription payment (called from the gateway callback). On success it provisions a
 * pending school or extends an active one, and returns the tenant. Idempotent by reference.
 */
export const confirmSubscriptionPayment = async (
  control,
  { externalReference, status },
  provisionOptions = {},
) => {
  const payment = await getPaymentByReference(control, externalReference);
  if (!payment) return { error: 'Unknown subscription payment' };
  if (payment.status === 'paid') {
    return { alreadyProcessed: true, subdomain: payment.subdomain };
  }

  const normalized = String(status || '').toLowerCase();
  const succeeded = ['successful', 'success', 'completed', 'paid'].includes(normalized);
  await setPaymentStatus(control, externalReference, succeeded ? 'paid' : 'failed');
  if (!succeeded) return { subdomain: payment.subdomain, provisioned: false };

  const meta = payment.metadata || {};
  const tenant = await provisionTenant(
    control,
    { subdomain: payment.subdomain, schoolName: meta.schoolName, contactEmail: meta.contactEmail },
    provisionOptions,
  );
  return { subdomain: payment.subdomain, provisioned: true, tenant };
};

/**
 * Subscription sweep: schools whose paid period has ended move active → past_due, and past_due →
 * suspended once the grace window has also elapsed. Run on a schedule (cron) or via the endpoint.
 */
export const sweepSubscriptions = async (control, { now = new Date(), graceDays = graceDaysEnv() } = {}) => {
  const lapsed = await findLapsedTenants(control, now.toISOString());
  let pastDue = 0;
  let suspended = 0;
  for (const tenant of lapsed) {
    const periodEnd = new Date(tenant.current_period_end);
    if (tenant.status === 'active') {
      await setTenantStatus(control, tenant.subdomain, 'past_due');
      pastDue += 1;
    } else if (tenant.status === 'past_due' && now > addDays(periodEnd, graceDays)) {
      await setTenantStatus(control, tenant.subdomain, 'suspended');
      suspended += 1;
    }
  }
  return { checked: lapsed.length, pastDue, suspended };
};
