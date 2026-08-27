/**
 * The response headers a browser needs in order to defend the app, none of which existed before.
 *
 * Kept beside the CORS rules because both are "headers on every response", and both depend on
 * knowing whether the request reached us over TLS — which, behind a reverse proxy, only the proxy
 * knows.
 */

/**
 * Did this request reach the user over HTTPS?
 *
 * Behind Caddy the connection to the app is plain HTTP, so the only evidence is X-Forwarded-Proto.
 * That header is trusted here without a proxy allow-list, and deliberately so: forging it can only
 * make the answer *stricter* — a Secure cookie and an HSTS header — never laxer. It is never used
 * to skip a check or to authorise anything.
 */
export const requestIsSecure = (request) => {
  if (request?.socket?.encrypted) return true;

  const forwarded = String(request?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwarded === 'https';
};

/** The client's address, preferring what the proxy saw over the proxy's own socket. */
export const clientAddress = (request) => {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request?.socket?.remoteAddress || '';
};

const HSTS_MAX_AGE = Number(process.env.HSTS_MAX_AGE || 15552000); // 180 days

export const securityHeaders = (response) => {
  const request = response?.req;

  const headers = {
    // The static server guesses a content type from the file extension and falls back to
    // octet-stream; nosniff stops a browser from second-guessing it and running something as script.
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  // Only meaningful over TLS, and a browser ignores it elsewhere — but sending it only when it
  // applies keeps a local HTTP deployment from looking as though it promised something it cannot.
  if (requestIsSecure(request)) {
    headers['Strict-Transport-Security'] = `max-age=${HSTS_MAX_AGE}; includeSubDomains`;
  }

  return headers;
};
