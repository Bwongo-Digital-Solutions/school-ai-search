/**
 * Transactional email, used to tell a school "your space is ready" once its subscription payment
 * confirms and it is provisioned.
 *
 * No new dependency and no network by default: EMAIL_MODE defaults to 'mock', so dev and tests
 * never send. Set EMAIL_MODE=http with EMAIL_API_KEY/EMAIL_API_URL (Resend-compatible JSON API) to
 * send for real. The httpClient is injectable so the sender can be tested without the network.
 */
const emailMode = () => process.env.EMAIL_MODE || 'mock';

export const emailEnabled = () => emailMode() !== 'mock';

/**
 * Sends one email. Returns { sent, mode } rather than throwing on a provider error, so a failed
 * notification never fails the operation that triggered it (provisioning must still succeed).
 */
/**
 * Sends one email, optionally with attachments.
 *
 * `attachments` is [{ filename, content }] where content is a Buffer or base64 string — the shape
 * the Resend-compatible API expects. Used to send a generated report rather than only a link, so a
 * recipient outside the school does not need an account to read it.
 */
export const sendEmail = async ({ to, subject, html, text, attachments = [] }, { httpClient = fetch } = {}) => {
  const mode = emailMode();
  if (mode === 'mock') {
    // Report what would have been sent, so a caller can tell the user "email is not configured"
    // rather than claiming a delivery that never happened.
    return { sent: false, mode: 'mock', to, subject, attachments: attachments.length };
  }

  const url = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM || 'e-School <no-reply@eschool.ink>';
  if (!apiKey) {
    return { sent: false, mode, error: 'EMAIL_API_KEY is not configured' };
  }
  if (!to) {
    return { sent: false, mode, error: 'No recipient' };
  }

  try {
    const response = await httpClient(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text,
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                content: Buffer.isBuffer(attachment.content)
                  ? attachment.content.toString('base64')
                  : String(attachment.content),
              })),
            }
          : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { sent: false, mode, error: `Email provider ${response.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true, mode };
  } catch (error) {
    return { sent: false, mode, error: error instanceof Error ? error.message : 'Email send failed' };
  }
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Builds the "your school is ready" message for a freshly provisioned tenant. */
export const renderActivationEmail = ({ schoolName, subdomain, rootDomain = process.env.TENANT_ROOT_DOMAIN || 'eschool.ink' }) => {
  const name = schoolName || 'Your school';
  const url = `https://${subdomain}.${rootDomain}`;
  const subject = `${name} is ready on e-School`;

  const text = [
    `${name} is ready.`,
    '',
    `Open your school and create the first (administrator) account:`,
    url,
    '',
    'The first account you create becomes the administrator. Everyone who signs up after that waits',
    'for the administrator to approve them before they can sign in.',
    '',
    'Powered by e-School',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1f2430;">
      <div style="height: 6px; background: linear-gradient(90deg,#4f46e5,#7c3aed); border-radius: 6px 6px 0 0;"></div>
      <div style="border: 1px solid #eceef2; border-top: none; border-radius: 0 0 12px 12px; padding: 28px;">
        <h1 style="font-size: 20px; margin: 0 0 6px;">${escapeHtml(name)} is ready 🎉</h1>
        <p style="color:#5a6172; font-size: 14px; margin: 0 0 20px;">Your school's private space is live.</p>
        <a href="${url}" style="display:inline-block; background:linear-gradient(90deg,#4f46e5,#7c3aed); color:#fff; text-decoration:none; font-weight:600; font-size:14px; padding:11px 18px; border-radius:8px;">Open ${escapeHtml(subdomain)}.${escapeHtml(rootDomain)}</a>
        <p style="color:#5a6172; font-size: 13px; margin: 20px 0 0;">The first account you create becomes the administrator. Everyone who signs up after that waits for your approval before they can sign in.</p>
        <p style="color:#9aa0ac; font-size: 12px; margin: 24px 0 0;">Powered by e-School</p>
      </div>
    </div>`;

  return { subject, text, html, url };
};
