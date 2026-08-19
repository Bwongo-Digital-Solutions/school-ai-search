/**
 * Payment webhook authentication.
 *
 * Payment callbacks (subscription and student-fee) tell the server "this payment succeeded", so
 * they must be proven to come from the provider — otherwise anyone could POST a fake success and
 * provision a school or clear an invoice for free. We verify an HMAC-SHA256 signature of the raw
 * request body against PAYMENT_WEBHOOK_SECRET.
 *
 * When PAYMENT_WEBHOOK_SECRET is unset (local/dev/mock) verification is disabled, so nothing
 * changes for existing single-tenant/mock deployments.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.PAYMENT_WEBHOOK_SECRET || '';

export const webhookVerificationEnabled = () => Boolean(secret());

/** Constant-time compare of the provider's signature header against HMAC-SHA256 of the raw body. */
export const isWebhookSignatureValid = (rawBody, signatureHeader) => {
  const key = secret();
  if (!key) return true; // verification disabled
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', key).update(String(rawBody ?? ''), 'utf8').digest('hex');
  // Accept either a bare hex digest or a `sha256=<hex>` form (common across providers).
  const provided = String(signatureHeader).trim().replace(/^sha256=/i, '');

  let expectedBuf;
  let providedBuf;
  try {
    expectedBuf = Buffer.from(expected, 'hex');
    providedBuf = Buffer.from(provided, 'hex');
  } catch {
    return false;
  }
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
};

/** Whether this request is a payment/subscription webhook that must be signature-verified. */
export const isPaymentWebhook = (pathname, body) =>
  (pathname === '/api/provision' || pathname === '/api/functions/payments') && body?.action === 'callback';
