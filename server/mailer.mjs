// server/mailer.mjs
//
// Outbound email for Mike AI. Currently one message: the password reset link.
//
// Env:
//   RESEND_API_KEY  Optional. Without it, nothing is sent - the link is
//                   printed to the deploy log instead so a reset can still be
//                   completed by hand. That keeps the feature usable on day
//                   one rather than blocking it behind a provider signup.
//   MAIL_FROM       Optional. Defaults to the Doer Tough support address.
//                   Must be a domain verified with the provider or the send
//                   is rejected.
//   SUPPORT_EMAIL   Optional. Shown to customers as the reply-to.

const RESEND_KEY = process.env.RESEND_API_KEY || '';
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@doertough.com';
const MAIL_FROM = process.env.MAIL_FROM || `Mike AI <${SUPPORT_EMAIL}>`;

export const mailerConfigured = () => !!RESEND_KEY;

async function send({ to, subject, text, html }) {
  if (!RESEND_KEY) {
    // Deliberately loud. Without a provider the operator is the transport.
    console.warn(
      `[mail] RESEND_API_KEY not set - not sending. Would have emailed ${to}: ${subject}`
    );
    console.warn(`[mail] body:\n${text}`);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html, reply_to: SUPPORT_EMAIL }),
      signal: AbortSignal.timeout(10000),
    });

    const raw = await res.text();
    if (!res.ok) {
      // Logged, never surfaced - the caller must not reveal whether an
      // address exists, and a send failure would leak exactly that.
      console.error(`[mail] send failed ${res.status}: ${raw.slice(0, 300)}`);
      return { sent: false, reason: `http_${res.status}` };
    }

    console.log(`[mail] sent "${subject}"`);
    return { sent: true };
  } catch (err) {
    console.error('[mail] send threw:', err.message || err);
    return { sent: false, reason: 'exception' };
  }
}

export async function sendPasswordReset({ to, name, resetUrl, expiresMinutes }) {
  const greeting = name ? `${name},` : 'Hey,';
  const text = [
    greeting,
    '',
    'Someone asked to reset the password on your Mike AI account.',
    '',
    resetUrl,
    '',
    `That link works once and expires in ${expiresMinutes} minutes.`,
    '',
    "If this wasn't you, ignore this email. Nothing changes until the link is used,",
    'and your current password still works.',
    '',
    '- Doer Tough',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#111">
      <p>${greeting}</p>
      <p>Someone asked to reset the password on your Mike AI account.</p>
      <p style="margin:28px 0">
        <a href="${resetUrl}"
           style="background:#FF7611;color:#fff;padding:12px 22px;border-radius:6px;
                  text-decoration:none;font-weight:600;display:inline-block">
          Reset your password
        </a>
      </p>
      <p style="font-size:14px;color:#555">
        That link works once and expires in ${expiresMinutes} minutes.
      </p>
      <p style="font-size:14px;color:#555">
        If this wasn't you, ignore this email. Nothing changes until the link is
        used, and your current password still works.
      </p>
      <p style="font-size:14px;color:#555">- Doer Tough</p>
    </div>`;

  return send({ to, subject: 'Reset your Mike AI password', text, html });
}
