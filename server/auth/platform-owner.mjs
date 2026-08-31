/**
 * Who is allowed to act on the platform itself, as opposed to inside one school.
 *
 * Listing every school, provisioning one by hand, changing a subscription status — these are the
 * operator's actions, not a school administrator's. They were gated on `body.requesterRole ===
 * 'admin'`, which is a string the browser supplies: any school's administrator could enumerate
 * every other school on the platform.
 *
 * So platform actions authenticate with their own credential, carried in the Authorization header
 * and never stored in any tenant database. It is deliberately not a session: there is no platform
 * user, no sign-in page and no cookie to steal, and the token can be rotated by restarting with a
 * new value. The same fail-closed shape as the MCP server (server/mcp/server.mjs).
 */
import { timingSafeEqual } from 'node:crypto';

// A token short enough to guess is worse than useless, because it looks like protection. Anything
// under this is refused outright and logged, rather than quietly accepted.
const MIN_TOKEN_LENGTH = 24;

let warned = false;

const ownerToken = () => {
  const token = String(process.env.PLATFORM_OWNER_TOKEN || '');
  if (!token) return '';

  if (token.length < MIN_TOKEN_LENGTH) {
    if (!warned) {
      console.warn(
        `PLATFORM_OWNER_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters and has been ignored. ` +
          'Generate one with: openssl rand -hex 32',
      );
      warned = true;
    }
    return '';
  }

  return token;
};

/** False when no usable token is configured, in which case every platform action is refused. */
export const isPlatformOwnerEnabled = () => ownerToken().length > 0;

const safeEquals = (a, b) => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/** Does this request carry the platform owner's token? */
export const isPlatformOwner = (headers = {}) => {
  const configured = ownerToken();
  if (!configured) return false;

  const supplied = String(headers.authorization || headers.Authorization || '');
  if (!supplied.startsWith('Bearer ')) return false;

  return safeEquals(supplied.slice(7), configured);
};

/** The refusal, worded so an operator can tell "wrong token" from "not switched on". */
export const platformOwnerRefusal = () =>
  isPlatformOwnerEnabled()
    ? { error: 'Unauthorized' }
    : { error: 'Platform administration is not enabled on this deployment. Set PLATFORM_OWNER_TOKEN.' };
