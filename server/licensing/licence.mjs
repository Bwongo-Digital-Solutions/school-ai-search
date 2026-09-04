/**
 * Finding out what a school has paid for.
 *
 * Three places, in order, because the three kinds of deployment keep it in three different places:
 *
 *   1. `LICENCE_PLAN` / `LICENCE_DEPLOYMENT` in the environment. An operator running a single
 *      instance for one school sets it here and never touches a database. It wins outright — an
 *      operator who has typed the plan into the process should not be overruled by a stale row.
 *   2. The control plane's `tenants.plan`, for a cloud tenant. This is the billing system's own
 *      answer, so on a hosted deployment it is the truth.
 *   3. `school_settings`, for a one-off install with no control plane, which is where a perpetual
 *      licence lives because there is nothing else to hold it.
 *
 * Falling off the end means `enterprise`, which is deliberate and explained in plans.mjs: this
 * system ran for years with no plans at all, and a default that switched features off would take
 * them away from schools already using them.
 *
 * ## Caching
 *
 * A licence is consulted on nearly every request, and the control plane is a second database. It is
 * held for a minute — long enough that a busy screen does not open a connection per click, short
 * enough that an upgrade takes effect while the person who paid for it is still on the phone.
 */
import { normaliseLicence } from './plans.mjs';

const CACHE_MS = 60_000;

/** tenantId → { licence, at }. Small, bounded by the number of tenants a process serves. */
const cache = new Map();

export const clearLicenceCache = (tenantId = null) => {
  if (tenantId === null) cache.clear();
  else cache.delete(String(tenantId || 'default'));
};

const fromEnvironment = () => {
  const plan = String(process.env.LICENCE_PLAN || '').trim().toLowerCase();
  const deployment = String(process.env.LICENCE_DEPLOYMENT || '').trim().toLowerCase();
  if (!plan && !deployment) return null;
  return { plan, deployment, source: 'environment' };
};

/**
 * Whether this school has a model of its own configured.
 *
 * Only ever asked on-premise, and only to decide whether the AI features can be offered there. A
 * base URL is what makes a model somebody else's or your own: an Ollama box or an OpenAI-compatible
 * endpoint the school runs, rather than the hosted provider this deployment meters.
 */
const hasOwnModel = async (database) => {
  if (String(process.env.OLLAMA_BASE_URL || '').trim()) return true;
  try {
    const { rows } = await database.query(
      "SELECT provider FROM provider_credentials WHERE base_url <> '' LIMIT 1",
    );
    return rows.length > 0;
  } catch {
    // No such table yet, or a database that cannot answer. Not a reason to fail a request.
    return false;
  }
};

const fromControlPlane = async (control, tenantId) => {
  if (!control || !tenantId) return null;
  try {
    const { rows } = await control.query('SELECT plan, status FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    if (rows.length === 0) return null;
    // A cloud tenant is by definition hosted, whatever anything else says.
    return { plan: String(rows[0].plan || '').toLowerCase(), deployment: 'cloud', source: 'control-plane' };
  } catch {
    return null;
  }
};

const fromSettings = async (database) => {
  try {
    const { rows } = await database.query(
      "SELECT plan, deployment FROM school_settings WHERE id = 'default' LIMIT 1",
    );
    if (rows.length === 0) return null;
    return {
      plan: String(rows[0].plan || '').toLowerCase(),
      deployment: String(rows[0].deployment || '').toLowerCase(),
      source: 'settings',
    };
  } catch {
    return null;
  }
};

/**
 * The licence in force for one school.
 *
 * Never throws. A licensing lookup that fails must not be able to take a request down with it — the
 * failure mode of this whole file is "the school keeps what it had", not "the school cannot log in".
 */
export const licenceFor = async (database, { tenantId = null, control = null, fresh = false } = {}) => {
  const key = String(tenantId || 'default');
  const cached = cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.licence;

  let found = fromEnvironment();
  if (!found) found = await fromControlPlane(control, tenantId);
  if (!found) found = await fromSettings(database);

  const settled = normaliseLicence(found || {});

  /* Only asked when it can change an answer. On cloud the hosted models are the point of the
     subscription, so there is nothing to check and no reason to spend a query on it. */
  const licence = settled.deployment === 'onsite'
    ? { ...settled, ownModel: await hasOwnModel(database) }
    : settled;

  cache.set(key, { licence, at: Date.now() });
  return licence;
};
