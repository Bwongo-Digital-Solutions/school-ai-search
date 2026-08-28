/**
 * Server-issued sessions.
 *
 * Until now the browser told the server who it was: the signed-in user was a JSON blob in
 * localStorage and every request carried its own `requesterRole` in the body, so editing one word in
 * devtools made a teacher an administrator. That is survivable for one school on a school network.
 * It is not survivable for a paid product where one deployment holds many schools' records.
 *
 * Two decisions shape everything here.
 *
 * **The token proves identity, not privilege.** It carries a user id, a tenant and an expiry — no
 * role. The role is read from the `users` row on every request, which costs one primary-key lookup
 * beside handlers that already issue dozens of queries, and buys the thing a role-in-the-token
 * design cannot have: a demoted, deleted or un-approved account loses access on its very next
 * request rather than whenever the token happens to expire. It also means no session table, no
 * revocation list, and nothing to keep in sync.
 *
 * **The cookie is host-only.** No Domain attribute, so a cookie set by kampala-high.eschool.ink is
 * never even *sent* to gulu-ss.eschool.ink. A cookie scoped to `.eschool.ink` would travel to every
 * school on the platform and would have to be checked after arrival; this way the browser enforces
 * the boundary before the request is made. The tenant claim inside the token is then a second lock
 * on the same door, for a misconfigured proxy or a hand-crafted request.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'eschool_session';

/** Twelve hours: long enough for a school day, short enough that a stolen token is not forever. */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;

/** The same lifetime in seconds, for a client that was handed the token and must plan to renew. */
export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

// A secret short enough to guess makes every session forgeable, so a short one is refused outright
// rather than quietly used.
const MIN_SECRET_LENGTH = 32;

let ephemeralSecret = null;
let warnedAboutSecret = false;

const secret = () => {
  const configured = String(process.env.SESSION_SECRET || '');

  if (configured.length >= MIN_SECRET_LENGTH) return configured;

  if (!warnedAboutSecret) {
    console.warn(
      configured
        ? `SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters and has been ignored.`
        : 'SESSION_SECRET is not set.',
      'Sessions are signed with a key generated at startup, so everyone is signed out when this',
      'process restarts and sessions do not work across replicas. Set SESSION_SECRET in production:',
      'openssl rand -hex 32',
    );
    warnedAboutSecret = true;
  }

  // Random rather than a fixed fallback: an unconfigured deployment loses its sessions on restart,
  // which is an inconvenience. A hard-coded default would make every such deployment forgeable,
  // which is a breach.
  if (!ephemeralSecret) ephemeralSecret = randomBytes(32).toString('hex');
  return ephemeralSecret;
};

const sign = (value) => createHmac('sha256', secret()).update(value).digest('base64url');

const safeEquals = (a, b) => {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/** Mints a token for one user of one school. */
export const issueSessionToken = ({ userId, tenantId, now = Date.now(), ttlMs = SESSION_TTL_MS }) => {
  const payload = Buffer.from(
    JSON.stringify({ u: String(userId), t: String(tenantId), e: now + ttlMs }),
    'utf8',
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
};

/**
 * Verifies a token and returns what it claims, or null.
 *
 * `tenantId` is the school the request actually reached, taken from its Host. A token minted for
 * another school is refused here even if a browser somehow presented it.
 */
export const verifySessionToken = (token, { tenantId, now = Date.now() } = {}) => {
  const [payloadPart, signaturePart] = String(token || '').split('.');
  if (!payloadPart || !signaturePart) return null;

  if (!safeEquals(signaturePart, sign(payloadPart))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.u || !payload?.e) return null;
  if (now >= Number(payload.e)) return null;
  if (tenantId != null && payload.t !== tenantId) return null;

  return { userId: payload.u, tenantId: payload.t, expiresAt: Number(payload.e) };
};

/** Past the halfway mark a session is re-issued, so an active user is never logged out mid-task. */
export const shouldRefresh = (session, now = Date.now()) =>
  Boolean(session) && now > session.expiresAt - SESSION_TTL_MS / 2;

/** Reads one cookie out of a Cookie header. */
export const readCookie = (headers = {}, name = SESSION_COOKIE) => {
  const header = String(headers.cookie || headers.Cookie || '');
  if (!header) return '';

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
};

/**
 * The Set-Cookie value.
 *
 * SameSite=Lax rather than Strict because report cards, ID cards and exam papers are downloaded by
 * navigating to a URL, and Strict would strip the cookie from exactly those requests. Lax still
 * blocks the cross-site POSTs that CSRF depends on. `secure` comes from whether the user reached us
 * over HTTPS — omitted on localhost, where browsers would otherwise drop the cookie entirely.
 */
export const sessionCookie = (token, { secure = true, maxAgeMs = SESSION_TTL_MS } = {}) =>
  [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');

export const clearedSessionCookie = ({ secure = true } = {}) =>
  [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0', secure ? 'Secure' : null]
    .filter(Boolean)
    .join('; ');
