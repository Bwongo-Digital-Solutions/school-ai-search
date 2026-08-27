/**
 * A school's own AI provider keys, overriding the platform's.
 *
 * Every provider credential used to be a process-global environment variable, which was right when
 * one deployment meant one school. It is not right now: every school spends the operator's budget,
 * and a school with its own Anthropic account or its own Ollama box has no way to use it.
 *
 * So: the platform's environment is the default, and a row in `provider_credentials` overrides it
 * for that school. Nothing changes for a deployment that sets no rows.
 *
 * How an override actually reaches the model layer is credential-store.mjs; this module is the
 * storage, the encryption and the administration around it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { PROVIDER_ENV } from './llm-models.mjs';

export const PROVIDER_IDS = Object.keys(PROVIDER_ENV);

const trimmed = (value) => String(value ?? '').trim();

/* ------------------------------------------------------------------ encryption at rest ------- */

// A 32-byte key derived from SECRETS_KEY. Hashing rather than requiring exactly 32 bytes means any
// sufficiently long passphrase works, which is one less way to configure this wrongly.
const MIN_SECRETS_KEY_LENGTH = 32;

const encryptionKey = () => {
  const configured = String(process.env.SECRETS_KEY || '');
  if (configured.length < MIN_SECRETS_KEY_LENGTH) return null;
  return createHash('sha256').update(configured).digest();
};

export const secretsKeyConfigured = () => encryptionKey() !== null;

/** `v1:<iv>:<authTag>:<ciphertext>`, all base64url. Versioned so the scheme can change later. */
export const encryptSecret = (plaintext) => {
  const key = encryptionKey();
  if (!key) throw new Error('SECRETS_KEY is not configured');
  if (!plaintext) return '';

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
};

/**
 * Returns '' rather than throwing on anything it cannot read.
 *
 * A key encrypted under a SECRETS_KEY that has since been rotated away is unreadable, and the right
 * outcome is that the school quietly falls back to the platform's credentials — not that its chat
 * window starts throwing. The row stays put so an administrator can see it and re-enter the key.
 */
export const decryptSecret = (stored) => {
  const key = encryptionKey();
  if (!key || !stored) return '';

  const [version, iv, authTag, ciphertext] = String(stored).split(':');
  if (version !== 'v1' || !iv || !authTag || !ciphertext) return '';

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
};

/* ----------------------------------------------------------------------- storage --------------- */

const CREDENTIAL_COLUMNS = 'provider, api_key, base_url, updated_by, updated_at';

/**
 * A school's overrides as an environment-variable map, ready for `withCredentials`.
 *
 * Never throws: a school that has configured nothing, a database without the table yet, or a key
 * encrypted under a rotated SECRETS_KEY all end up inheriting the platform's credentials, which is
 * the behaviour every deployment had before this existed.
 */
export const loadCredentialOverrides = async (database) => {
  let rows = [];
  try {
    ({ rows } = await database.query(`SELECT ${CREDENTIAL_COLUMNS} FROM provider_credentials`));
  } catch {
    return {};
  }

  const overrides = {};
  for (const row of rows) {
    const env = PROVIDER_ENV[row.provider];
    if (!env) continue;

    const apiKey = decryptSecret(row.api_key);
    if (env.apiKey && apiKey) overrides[env.apiKey] = apiKey;

    const baseUrl = trimmed(row.base_url);
    if (env.baseUrl && baseUrl) overrides[env.baseUrl] = baseUrl;
  }
  return overrides;
};

/** Enough of a key to recognise it, and not enough to use it. */
const maskKey = (value) => (value ? `${'•'.repeat(8)}${value.slice(-4)}` : '');

/**
 * What the Settings screen shows: every provider, whether this school has overridden it, and
 * whether the platform supplies one. The key itself never leaves the server.
 */
export const listProviderCredentials = async (database) => {
  let rows = [];
  try {
    ({ rows } = await database.query(`SELECT ${CREDENTIAL_COLUMNS} FROM provider_credentials`));
  } catch {
    rows = [];
  }

  const bySchool = new Map(rows.map((row) => [row.provider, row]));

  return {
    secretsConfigured: secretsKeyConfigured(),
    providers: PROVIDER_IDS.map((provider) => {
      const env = PROVIDER_ENV[provider];
      const row = bySchool.get(provider);
      const schoolKey = row ? decryptSecret(row.api_key) : '';

      return {
        provider,
        // Ollama has no key at all — only an address — so the UI can render it differently.
        needsKey: Boolean(env.apiKey),
        source: schoolKey || (row && trimmed(row.base_url)) ? 'school' : 'platform',
        keyPreview: maskKey(schoolKey),
        // Unreadable means the row exists but SECRETS_KEY has changed since it was written.
        keyUnreadable: Boolean(row && row.api_key && !schoolKey),
        baseUrl: row ? trimmed(row.base_url) : '',
        platformHasKey: Boolean(env.apiKey && process.env[env.apiKey]),
        platformBaseUrl: env.baseUrl ? process.env[env.baseUrl] || env.defaultBaseUrl || '' : '',
        updatedBy: row?.updated_by || '',
        updatedAt: row?.updated_at || null,
      };
    }),
  };
};

export const saveProviderCredential = async ({ database, provider, apiKey, baseUrl, actor }) => {
  const id = trimmed(provider);
  if (!PROVIDER_ENV[id]) return { error: `Unknown AI provider: ${id}` };

  const key = trimmed(apiKey);
  const url = trimmed(baseUrl);
  if (!key && !url) return { error: 'Give an API key, a base URL, or both' };

  if (key && !PROVIDER_ENV[id].apiKey) {
    return { error: `${id} does not use an API key — set its address instead` };
  }
  // Refusing beats storing a key in plain text and calling it saved.
  if (key && !secretsKeyConfigured()) {
    return {
      error:
        'SECRETS_KEY is not configured on the server, so provider keys cannot be stored securely. ' +
        'Ask your administrator to set it (openssl rand -hex 32) and try again.',
    };
  }

  await database.query(
    `
      INSERT INTO provider_credentials (provider, api_key, base_url, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (provider) DO UPDATE SET
        api_key = EXCLUDED.api_key,
        base_url = EXCLUDED.base_url,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `,
    [id, key ? encryptSecret(key) : '', url, trimmed(actor?.email) || trimmed(actor?.name)],
  );

  return listProviderCredentials(database);
};

export const deleteProviderCredential = async ({ database, provider }) => {
  const id = trimmed(provider);
  if (!PROVIDER_ENV[id]) return { error: `Unknown AI provider: ${id}` };

  await database.query('DELETE FROM provider_credentials WHERE provider = $1', [id]);
  return listProviderCredentials(database);
};
