/**
 * Who a handler is acting for, and whether they are allowed to.
 *
 * The role gate used to be the same five lines copy-pasted into eight services, each reading
 * `body.requesterRole` — a value the browser chose. This is the one place that decides now, so
 * there is a single thing to get right and a single thing to audit.
 */
import { readCookie, verifySessionToken } from './session.mjs';

const trimmed = (value) => String(value ?? '').trim();

/**
 * Turns a request's session cookie into the user it belongs to, or null.
 *
 * The role comes from the database, never from the token, so an account that has been demoted,
 * un-approved or deleted stops having its old powers on the very next request.
 */
export const authenticateRequest = async ({ database, headers = {}, tenantId }) => {
  const token = readCookie(headers);
  if (!token) return null;

  const session = verifySessionToken(token, { tenantId });
  if (!session) return null;

  const { rows } = await database.query(
    'SELECT id, auth_email, display_name, role, approval_status, designation FROM users WHERE id = $1 LIMIT 1',
    [session.userId],
  );

  const user = rows[0];
  if (!user || user.approval_status !== 'approved') return null;

  return {
    id: user.id,
    email: user.auth_email,
    name: user.display_name,
    role: user.role,
    designation: user.designation || null,
    expiresAt: session.expiresAt,
  };
};

/**
 * The identity a handler should act on, given what the transport supplied.
 *
 * Three states, deliberately distinguished rather than collapsed into a mode flag:
 *
 *   - `undefined` — nobody authenticated the caller, because there was no request to authenticate:
 *     a test driving `dispatch` directly, or the server calling one of its own handlers. The body's
 *     `requesterRole` is honoured, exactly as it always was.
 *   - `null` — a real HTTP request arrived and carried no valid session. Nobody. The body is
 *     ignored, so claiming a role in it achieves nothing.
 *   - an object — an authenticated user. The body is ignored for the same reason.
 */
export const resolveActor = (authenticated, body = {}) => {
  if (authenticated !== undefined) return authenticated;

  const role = trimmed(body.requesterRole);
  if (!role) return null;

  return {
    id: trimmed(body.actorId) || null,
    email: trimmed(body.actorEmail),
    name: trimmed(body.actorName),
    role,
    designation: trimmed(body.actorDesignation) || null,
  };
};

/** Does this actor hold one of these roles? */
export const hasRole = (actor, roles) => Boolean(actor) && roles.includes(actor.role);

/**
 * The gate every service action passes through.
 *
 * Returns null when the actor may proceed, and the refusal to return otherwise — so a caller reads
 * `const refusal = requireRole(...); if (refusal) return refusal;` and cannot accidentally continue
 * past a failed check the way an `if` around a boolean allows.
 */
export const requireRole = (actor, roles) => (hasRole(actor, roles) ? null : { error: 'Unauthorized' });
