/**
 * Multi-tenant routing: one isolated database per school, chosen by subdomain.
 *
 * Non-breaking by design. With no TENANTS env the registry is empty and every request uses the
 * single default database — exactly the single-tenant behaviour, and what the tests rely on.
 * With TENANTS set (a JSON array of {id, url}), the subdomain of the request's Host header selects
 * the tenant, and each tenant's connection pool is created lazily and cached on first use.
 */
import { createDatabaseConnection } from './connection.mjs';
import { initializeDatabase } from './schema.mjs';

export const DEFAULT_TENANT = 'default';

const normalizeTenantId = (value) => String(value ?? '').trim().toLowerCase();

/** Parse the TENANTS env (JSON `[{id,url,ssl?}]` or `{tenants:[...]}`) into a Map(id → {url,ssl}). */
export const parseTenantRegistry = (raw = process.env.TENANTS) => {
  const map = new Map();
  if (!raw) return map;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('Invalid TENANTS JSON; multi-tenant routing is disabled.');
    return map;
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.tenants;
  if (!Array.isArray(list)) return map;

  for (const entry of list) {
    const id = normalizeTenantId(entry?.id);
    if (id && entry?.url) map.set(id, { url: String(entry.url), ssl: entry.ssl });
  }
  return map;
};

/**
 * Derive the tenant id from the Host header, with an X-Tenant header override for local testing.
 * Pure and side-effect free. Apex domains, www, localhost and bare IPs map to the default tenant.
 */
export const resolveTenantId = (host, headerTenant) => {
  const override = normalizeTenantId(headerTenant);
  if (override) return override;

  const hostname = String(host ?? '').split(':')[0].trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return DEFAULT_TENANT;
  }

  const parts = hostname.split('.');
  // A subdomain needs at least sub.domain.tld; an apex like `eschool.app` has no tenant subdomain.
  if (parts.length < 3) return DEFAULT_TENANT;

  const sub = parts[0];
  return !sub || sub === 'www' ? DEFAULT_TENANT : sub;
};

/**
 * A registry that resolves a request to its tenant database, creating and caching each tenant's
 * connection on first use. `createConnection` and `init` are injectable for tests.
 */
export const createTenantRegistry = ({
  registry = parseTenantRegistry(),
  lookup = null,
  createConnection = createDatabaseConnection,
  init = initializeDatabase,
} = {}) => {
  const cache = new Map();
  // Enabled by a static TENANTS list, or by a control-database lookup (self-service provisioning).
  const enabled = registry.size > 0 || typeof lookup === 'function';

  // Find a tenant's route: static env entries are always active; otherwise ask the control DB,
  // which also carries the subscription status.
  const findEntry = async (tenantId) => {
    if (registry.has(tenantId)) return { ...registry.get(tenantId), status: 'active' };
    if (lookup) return (await lookup(tenantId)) || null;
    return null;
  };

  const getConnection = (tenantId, url, ssl) => {
    if (cache.has(tenantId)) return cache.get(tenantId);
    // Cache the in-flight promise so concurrent first requests share one pool + one schema build.
    const pending = (async () => {
      const database = createConnection({ connectionString: url, ssl });
      await init(database);
      return database;
    })();
    cache.set(tenantId, pending);
    return pending;
  };

  return {
    enabled,
    /**
     * Returns { tenantId, database, status }. Single-tenant mode and the default tenant get the
     * shared defaultDatabase. An unknown subdomain yields a null database (caller 404s); a suspended
     * tenant yields a null database with status 'suspended' (caller returns a renewal notice).
     */
    async resolve(host, headerTenant, defaultDatabase) {
      const tenantId = resolveTenantId(host, headerTenant);
      if (!enabled) return { tenantId: DEFAULT_TENANT, database: defaultDatabase, status: 'active' };
      if (tenantId === DEFAULT_TENANT && !registry.has(DEFAULT_TENANT)) {
        return { tenantId, database: defaultDatabase, status: 'active' };
      }

      const entry = await findEntry(tenantId);
      if (!entry) return { tenantId, database: null, status: 'unknown' };
      if (entry.status === 'suspended' || entry.status === 'pending') {
        return { tenantId, database: null, status: entry.status };
      }

      const database = await getConnection(tenantId, entry.url, entry.ssl);
      return { tenantId, database, status: entry.status };
    },
    // Drop a cached pool after a status change or (re)provision so the next request re-resolves.
    invalidate(tenantId) {
      cache.delete(normalizeTenantId(tenantId));
    },
    async close() {
      for (const pending of cache.values()) {
        try {
          const database = await pending;
          await database.close();
        } catch {
          // Best effort on shutdown.
        }
      }
      cache.clear();
    },
  };
};
