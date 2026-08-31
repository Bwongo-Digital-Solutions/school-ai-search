/**
 * The school's global branding — name, tagline, address, logo, theme colour and contacts.
 *
 * One row (id = 'default') per database, edited by an admin through POST /api/functions/settings
 * and read by every document generator and the app header. loadSchoolSettings() is the single
 * source those callers use, so branding is defined once rather than in three different places.
 */
import { randomUUID } from 'node:crypto';

import { SCHOOL_LEVEL_VALUES } from '../reports/grading-config.mjs';
import { requireRole, resolveActor } from '../auth/actor.mjs';
import {
  deleteProviderCredential,
  listProviderCredentials,
  saveProviderCredential,
} from './provider-credentials.mjs';

const DEFAULT_THEME = '#2952a3';

const SETTINGS_COLUMNS = [
  'id',
  'school_name',
  'tagline',
  'address',
  'logo',
  'theme_color',
  'contact_phone',
  'contact_email',
  'school_level',
  'grading_country',
  'updated_at',
  'updated_by',
];

const DEFAULT_SCHOOL_LEVEL = 'secondary';
const DEFAULT_GRADING_COUNTRY = 'uganda';

// Falls back rather than rejecting: a level this build does not know is a misconfiguration, and the
// school should still get report cards on a sane scale while it is corrected.
const normalizeSchoolLevel = (value) => {
  const level = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SCHOOL_LEVEL_VALUES.includes(level) ? level : DEFAULT_SCHOOL_LEVEL;
};

const normalizeGradingCountry = (value) => {
  const country = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  return country || DEFAULT_GRADING_COUNTRY;
};

const trimmed = (value) => String(value ?? '').trim();

// Accepts '#RGB' or '#RRGGBB'; anything else falls back to the house colour rather than storing a
// value the PDF colour parser would reject.
const normalizeThemeColor = (value) => {
  const hex = trimmed(value).replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toLowerCase()}` : DEFAULT_THEME;
};

const selectSettings = async (database) => {
  const { rows } = await database.query(
    `SELECT ${SETTINGS_COLUMNS.join(', ')} FROM school_settings WHERE id = 'default' LIMIT 1`,
  );
  return rows[0] || null;
};

/**
 * Returns the branding row merged over env fallbacks. Used by every document route, so it never
 * throws or returns null — a fresh database with no row yet still yields usable defaults.
 */
export const loadSchoolSettings = async (database) => {
  let row = null;
  try {
    row = await selectSettings(database);
  } catch {
    // The table may not exist yet on a very old database; fall through to env defaults.
  }

  return {
    school_name: trimmed(row?.school_name) || process.env.SCHOOL_NAME || 'eSchool',
    tagline: trimmed(row?.tagline) || process.env.SCHOOL_TAGLINE || '',
    address: trimmed(row?.address) || process.env.SCHOOL_ADDRESS || '',
    logo: row?.logo || '',
    theme_color: normalizeThemeColor(row?.theme_color || DEFAULT_THEME),
    contact_phone: trimmed(row?.contact_phone),
    contact_email: trimmed(row?.contact_email),
    school_level: normalizeSchoolLevel(row?.school_level || process.env.SCHOOL_LEVEL),
    grading_country: normalizeGradingCountry(row?.grading_country || process.env.SCHOOL_GRADING_COUNTRY),
  };
};

const getSettings = async ({ database }) => {
  const row = await selectSettings(database);
  // Fall back to the merged defaults when the row is somehow missing, so the client always has
  // something to render.
  return { settings: row || (await loadSchoolSettings(database)) };
};

const updateSettings = async ({ database, body, actor }) => {
  // Who is recorded as having changed the school's details comes from their session, not from two
  // fields the same request could have written itself.
  const author = { email: trimmed(actor?.email), name: trimmed(actor?.name), role: actor?.role || 'admin' };

  const values = [
    trimmed(body.schoolName),
    trimmed(body.tagline),
    trimmed(body.address),
    body.logo ? String(body.logo) : '',
    normalizeThemeColor(body.themeColor),
    trimmed(body.contactPhone),
    trimmed(body.contactEmail),
    normalizeSchoolLevel(body.schoolLevel),
    normalizeGradingCountry(body.gradingCountry),
    author.name || author.email,
  ];

  // Upsert: the seed guarantees the row exists, but ON CONFLICT keeps this correct even on a
  // database that never seeded one.
  const { rows } = await database.query(
    `
      INSERT INTO school_settings (
        id, school_name, tagline, address, logo, theme_color, contact_phone, contact_email,
        school_level, grading_country, updated_at, updated_by
      ) VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
      ON CONFLICT (id) DO UPDATE SET
        school_name = EXCLUDED.school_name,
        tagline = EXCLUDED.tagline,
        address = EXCLUDED.address,
        logo = EXCLUDED.logo,
        theme_color = EXCLUDED.theme_color,
        contact_phone = EXCLUDED.contact_phone,
        contact_email = EXCLUDED.contact_email,
        school_level = EXCLUDED.school_level,
        grading_country = EXCLUDED.grading_country,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING ${SETTINGS_COLUMNS.join(', ')}
    `,
    values,
  );

  await database.query(
    `
      INSERT INTO audit_logs (
        id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
      ) VALUES ($1, $2, $3, $6, 'settings_updated', 'settings', 'default', $4, $5)
    `,
    [
      randomUUID(),
      author.email,
      author.name,
      rows[0]?.school_name || 'School settings',
      JSON.stringify({
        school_name: rows[0]?.school_name,
        theme_color: rows[0]?.theme_color,
        school_level: rows[0]?.school_level,
        grading_country: rows[0]?.grading_country,
      }),
      author.role,
    ],
  );

  return { settings: rows[0] };
};

/* ------------------------------------------------------- the school's own AI keys ------------- */

const listProviderKeys = async ({ database }) => listProviderCredentials(database);

const saveProviderKey = async ({ database, body, actor }) =>
  saveProviderCredential({
    database,
    provider: body.provider,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
    actor,
  });

const deleteProviderKey = async ({ database, body }) =>
  deleteProviderCredential({ database, provider: body.provider });

const ACTIONS = {
  get: getSettings,
  update: updateSettings,
  list_provider_keys: listProviderKeys,
  save_provider_key: saveProviderKey,
  delete_provider_key: deleteProviderKey,
};

// Reading the school's name and logo is open to every role, because the app cannot render without
// it. Everything else here — changing the school, and its AI provider keys — is an administrator's.
const ADMIN_ACTIONS = ['update', 'list_provider_keys', 'save_provider_key', 'delete_provider_key'];

/**
 * Reads are open to any signed-in role (the header and documents need branding); writes are
 * admin-only, matching the trust-the-client model used by the auth endpoint's update_role.
 */
export const handleSettingsFunction = async (database, body = {}, { actor: authenticated, tenantId } = {}) => {
  const action = body?.action || 'get';
  const actor = resolveActor(authenticated, body);

  // Unlike the other services the gate is per action, because every role needs to read the school's
  // name and logo to render the app at all — only changing them is an administrator's business.
  if (ADMIN_ACTIONS.includes(action)) {
    const refusal = requireRole(actor, ['admin']);
    if (refusal) return refusal;
  }

  const handler = ACTIONS[action];
  if (!handler) return { error: `Unsupported settings action: ${action}` };
  return handler({ database, body, actor, tenantId });
};
