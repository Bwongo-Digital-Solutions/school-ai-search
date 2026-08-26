/**
 * Cross-origin rules, scoped to the platform's own domains.
 *
 * This used to be `Access-Control-Allow-Origin: *` with `X-Tenant` in the allowed headers, which
 * together meant any page on the internet could name whichever school it liked and read that
 * school's data. Two things change that:
 *
 *   - the origin is echoed back only when it is one of ours, so a third-party page gets no
 *     Allow-Origin header and the browser refuses to hand it the response;
 *   - `Access-Control-Allow-Credentials: true` is required for the session cookie to travel at all,
 *     and a browser rejects it outright alongside `*` — so the wildcard could not have survived the
 *     move to real sessions in any case.
 *
 * Same-origin requests need none of this; every school reaches its own subdomain, so in normal use
 * these headers are simply absent.
 */

// Read at call time, not import time, so runtime config and tests both take effect.
const rootDomain = () => String(process.env.TENANT_ROOT_DOMAIN || 'eschool.ink').trim().toLowerCase();

/** Extra origins allowed verbatim, comma-separated. For a separately hosted front end. */
const extraOrigins = () =>
  String(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const isLoopbackHostname = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

/**
 * Is this origin one of ours?
 *
 * `requestHost` is the Host the server was reached on. Loopback origins are allowed only when the
 * server itself was reached over loopback — that keeps a developer running Vite on another port
 * working, while a deployment on a real domain stays closed to them.
 */
export const isAllowedOrigin = (origin, requestHost = '') => {
  if (!origin) return false;

  const normalized = String(origin).trim().toLowerCase();
  if (extraOrigins().includes(normalized)) return true;

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return false;
  }

  const hostname = url.hostname;
  const root = rootDomain();
  if (url.protocol === 'https:' && root && (hostname === root || hostname.endsWith(`.${root}`))) {
    return true;
  }

  const host = String(requestHost).split(':')[0].trim().toLowerCase();
  return isLoopbackHostname(hostname) && isLoopbackHostname(host);
};

const allowedHeaders = () =>
  // X-Tenant is advertised only where it is actually honoured (see resolveTenantId), so the
  // preflight answer and the server's behaviour cannot disagree.
  process.env.ALLOW_TENANT_HEADER === 'true'
    ? 'Content-Type, Authorization, X-Tenant'
    : 'Content-Type, Authorization';

/**
 * The CORS headers for a response, derived from the request that produced it.
 *
 * `response.req` is the request Node attached to it, so this needs no change at the ~40 call sites
 * that send a response. `Vary: Origin` is always set, allowed or not, so no cache can serve one
 * origin's answer to another.
 */
export const corsHeaders = (response) => {
  const request = response?.req;
  const origin = request?.headers?.origin;

  if (!isAllowedOrigin(origin, request?.headers?.host)) return { Vary: 'Origin' };

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': allowedHeaders(),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
};
