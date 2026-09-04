import { requireRole, resolveActor } from '../auth/actor.mjs';
import { PRIVILEGED_ROLES } from '../auth/roles.mjs';
import { decryptSecret, encryptSecret, secretsKeyConfigured } from './provider-credentials.mjs';

/**
 * The external systems a school runs alongside this one.
 *
 * Schools rarely arrive with nothing. They have a Moodle their teachers already use, and often an
 * ERP their accountant already reconciles in. This does not try to replace either — it records
 * where they are, keeps the credentials safely, and puts them one click away instead of one
 * bookmark away.
 *
 * Exactly one ERP at a time. A school runs Odoo or ERPNext or Dolibarr; offering all three at once
 * would be offering a choice nobody has to make.
 *
 * Tokens are encrypted at rest under SECRETS_KEY, reusing provider-credentials.mjs rather than
 * repeating the cipher — one implementation to get right, and one to rotate.
 */

export const ELEARNING_PROVIDERS = ['moodle'];
export const ERP_PROVIDERS = ['odoo', 'erpnext', 'dolibarr'];
const PROVIDERS = [...ELEARNING_PROVIDERS, ...ERP_PROVIDERS];

export const PROVIDER_LABELS = {
  moodle: 'Moodle',
  odoo: 'Odoo',
  erpnext: 'ERPNext',
  dolibarr: 'Dolibarr',
};

/** Enough of a token to recognise it, and not enough to use it. */
const maskToken = (stored) => {
  const value = decryptSecret(stored);
  if (!value) return '';
  return `${'•'.repeat(8)}${value.slice(-4)}`;
};

const trimmed = (value) => String(value ?? '').trim();

/**
 * A URL we are willing to send a school's credentials to, and to frame.
 *
 * http is refused outright: the token travels on every request, and an integration configured over
 * plain http would leak it to anyone on the same network as the school. Better to refuse at the
 * point of configuration than to be quietly insecure afterwards.
 */
const normalizeUrl = (value) => {
  const raw = trimmed(value);
  if (!raw) return { url: '' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'That does not read as a web address. It should look like https://moodle.school.ac.ug' };
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return { error: 'Use an https address. A token sent over plain http can be read in transit.' };
  }
  return { url: parsed.origin + parsed.pathname.replace(/\/$/, '') };
};

/**
 * The address *this server* calls, when it is not the address the browser opens.
 *
 * A system bootstrapped from deploy/integrations/ lives on the compose network as `http://moodle:8080`.
 * The browser cannot reach that — a service name resolves inside the bridge network and nowhere
 * else — so base_url stays the public address and this is kept alongside it, used only server-side.
 *
 * That is also why plain http is allowed here and refused there. The objection to http is that the
 * token can be read in transit; a single-label hostname has no route off the bridge network, so
 * there is no transit to read. A name with a dot in it might resolve anywhere, and is held to the
 * same https rule as the public address.
 */
const normalizeInternalUrl = (value) => {
  const raw = trimmed(value);
  if (!raw) return { url: '' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'That does not read as a web address. It should look like http://moodle:8080' };
  }

  const isContainerName = !parsed.hostname.includes('.') && parsed.hostname !== 'localhost';
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isContainerName && !isLoopback) {
    return {
      error:
        'Use an https address, or a Docker service name such as http://moodle:8080. ' +
        'A token sent over plain http to a routable host can be read in transit.',
    };
  }
  return { url: parsed.origin + parsed.pathname.replace(/\/$/, '') };
};

const publicRow = (row) => ({
  provider: row.provider,
  label: PROVIDER_LABELS[row.provider] || row.provider,
  kind: ERP_PROVIDERS.includes(row.provider) ? 'erp' : 'elearning',
  baseUrl: row.base_url,
  // Where the server calls it, when that differs from where the browser opens it. Not a secret —
  // a service name is only meaningful inside the network it names.
  internalUrl: (row.config || {}).internal_url || '',
  username: row.username,
  tokenPreview: maskToken(row.api_token),
  hasToken: Boolean(row.api_token),
  // Written under a SECRETS_KEY that has since changed: the row is there, the value is unreadable.
  // Surfaced separately from "no token", because the fix is different.
  tokenUnreadable: Boolean(row.api_token) && !decryptSecret(row.api_token),
  enabled: row.enabled,
  lastCheckedAt: row.last_checked_at,
  lastError: row.last_error,
  updatedBy: row.updated_by,
});

const listIntegrations = async ({ database }) => {
  const { rows } = await database.query(
    `SELECT provider, base_url, api_token, username, config, enabled, last_checked_at, last_error, updated_by
     FROM school_integrations`,
  );
  const bySlug = new Map(rows.map((row) => [row.provider, row]));

  return {
    secretsConfigured: secretsKeyConfigured(),
    integrations: PROVIDERS.map((provider) =>
      publicRow(
        bySlug.get(provider) || {
          provider,
          base_url: '',
          api_token: '',
          username: '',
          config: {},
          enabled: false,
          last_checked_at: null,
          last_error: '',
          updated_by: '',
        },
      ),
    ),
  };
};

const saveIntegration = async ({ database, body, actor }) => {
  const provider = trimmed(body.provider);
  if (!PROVIDERS.includes(provider)) return { error: `Unknown system: ${provider}` };

  const { url, error: urlError } = normalizeUrl(body.baseUrl);
  if (urlError) return { error: urlError };

  const { url: internalUrl, error: internalError } = normalizeInternalUrl(body.internalUrl);
  if (internalError) return { error: internalError };

  // An omitted token means "leave the stored one alone"; an explicit empty string clears it. Without
  // this distinction, saving the address would blank a token nobody meant to touch.
  const tokenSupplied = Object.prototype.hasOwnProperty.call(body, 'apiToken');
  const token = trimmed(body.apiToken);
  if (tokenSupplied && token && !secretsKeyConfigured()) {
    return {
      error:
        'SECRETS_KEY is not configured on the server, so a token cannot be stored safely. ' +
        'Set it to a long random string (openssl rand -hex 32) and try again.',
    };
  }

  const { rows: existing } = await database.query(
    'SELECT api_token FROM school_integrations WHERE provider = $1',
    [provider],
  );
  const storedToken = tokenSupplied
    ? token
      ? encryptSecret(token)
      : ''
    : existing[0]?.api_token || '';

  await database.query(
    `INSERT INTO school_integrations (provider, base_url, api_token, username, config, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $7, $5, $6, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       api_token = EXCLUDED.api_token,
       username = EXCLUDED.username,
       config = EXCLUDED.config,
       enabled = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      provider,
      url,
      storedToken,
      trimmed(body.username),
      body.enabled !== false,
      actor?.email || '',
      JSON.stringify({ internal_url: internalUrl }),
    ],
  );

  // Only one ERP at a time: enabling one stands the others down rather than leaving two menu
  // entries and no way to tell which the school actually uses.
  if (ERP_PROVIDERS.includes(provider) && body.enabled !== false) {
    const others = ERP_PROVIDERS.filter((name) => name !== provider);
    // Spelled out as placeholders rather than `= ANY($1)`, which the in-memory database used by the
    // test suite does not implement — it accepts the query and matches nothing, so the exclusivity
    // would look right and silently not hold.
    await database.query(
      `UPDATE school_integrations SET enabled = FALSE
       WHERE provider IN (${others.map((_, index) => `$${index + 1}`).join(', ')})`,
      others,
    );
  }

  return listIntegrations({ database });
};

const disableIntegration = async ({ database, body }) => {
  const provider = trimmed(body.provider);
  if (!PROVIDERS.includes(provider)) return { error: `Unknown system: ${provider}` };
  await database.query(
    'UPDATE school_integrations SET enabled = FALSE, updated_at = NOW() WHERE provider = $1',
    [provider],
  );
  return listIntegrations({ database });
};

/**
 * Ask the system whether it is really there.
 *
 * Returns `connected: false` with the reason rather than a top-level `error`, because an error
 * becomes a 400 with a null body — and the reason the admin opened this screen is to read exactly
 * that reason. A failed connection test is a successful request.
 */
const testIntegration = async ({ database, body, httpClient }) => {
  const provider = trimmed(body.provider);
  if (!PROVIDERS.includes(provider)) return { error: `Unknown system: ${provider}` };

  const { rows } = await database.query(
    'SELECT base_url, config FROM school_integrations WHERE provider = $1',
    [provider],
  );
  // The internal address when there is one: testing a bundled system by its public address would
  // check the reverse proxy in front of it rather than the system itself, and would fail outright
  // before that proxy is configured.
  const internalUrl = (rows[0]?.config || {}).internal_url || '';
  const baseUrl = internalUrl || rows[0]?.base_url || '';
  if (!baseUrl) return { connected: false, connectionError: 'No address is set for this system yet.' };

  let connected = false;
  let connectionError = '';
  try {
    const response = await (httpClient || fetch)(baseUrl, { method: 'GET', redirect: 'follow' });
    connected = response.ok;
    if (!connected) connectionError = `The server answered ${response.status}.`;
  } catch (error) {
    connectionError = error instanceof Error ? error.message : 'The address could not be reached.';
  }

  await database.query(
    'UPDATE school_integrations SET last_checked_at = NOW(), last_error = $2 WHERE provider = $1',
    [provider, connectionError],
  );

  return { connected, connectionError, ...(await listIntegrations({ database })) };
};

const ACTIONS = {
  list: listIntegrations,
  save: saveIntegration,
  disable: disableIntegration,
  test: testIntegration,
};

export const INTEGRATION_ACTIONS = Object.keys(ACTIONS);

export const handleIntegrationsFunction = async (
  database,
  body = {},
  httpClient,
  { actor: authenticated, tenantId } = {},
) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, PRIVILEGED_ROLES);
  if (refusal) return refusal;

  const action = String(body.action || 'list').trim();
  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported integrations action: ${action}` };

  return handler({ database, body, actor, tenantId, httpClient });
};
