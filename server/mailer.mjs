// server/mailer.mjs
//
// Outbound email for Mike AI. Password reset, reminders, and resale-deal alerts.
const RESEND_KEY = process.env.RESEND_API_KEY || '';
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@doertough.com';
const MAIL_FROM = process.env.MAIL_FROM || `Mike AI <${SUPPORT_EMAIL}>`;
export const mailerConfigured = () => !!RESEND_KEY;

async function send({ to, subject, text, html }) {
  if (!RESEND_KEY) {
    console.warn(`[mail] RESEND_API_KEY not set - not sending. Would have emailed ${to}: ${subject}`);
    console.warn(`[mail] body:\n${text}`);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html, reply_to: SUPPORT_EMAIL }),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await res.text();
    if (!res.ok) {
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
  const text = [greeting, '', 'Someone asked to reset the password on your Mike AI account.', '', resetUrl, '', `That link works once and expires in ${expiresMinutes} minutes.`, '', "If this wasn't you, ignore this email. Nothing changes until the link is used,", 'and your current password still works.', '', '- Doer Tough'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#111"><p>${greeting}</p><p>Someone asked to reset the password on your Mike AI account.</p><p style="margin:28px 0"><a href="${resetUrl}" style="background:#FF7611;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Reset your password</a></p><p style="font-size:14px;color:#555">That link works once and expires in ${expiresMinutes} minutes.</p><p style="font-size:14px;color:#555">If this wasn't you, ignore this email. Nothing changes until the link is used, and your current password still works.</p><p style="font-size:14px;color:#555">- Doer Tough</p></div>`;
  return send({ to, subject: 'Reset your Mike AI password', text, html });
}

const escapeHtml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');

export async function sendReminder({ to, name, title, note, remindAt }) {
  const greeting = name ? `${name},` : 'Hey,';
  const when = new Date(remindAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
  const safeTitle = String(title || 'Mike reminder').trim().slice(0, 160);
  const safeNote = String(note || '').trim().slice(0, 1200);
  const text = [greeting, '', `Mike reminder: ${safeTitle}`, `Time: ${when}`, safeNote ? `\n${safeNote}` : '', '', '- Mike AI / Doer Tough'].filter(Boolean).join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#111"><p>${escapeHtml(greeting)}</p><h2 style="margin:12px 0 6px">${escapeHtml(safeTitle)}</h2><p style="font-size:14px;color:#555">${escapeHtml(when)}</p>${safeNote ? `<p>${escapeHtml(safeNote).replace(/\n/g, '<br>')}</p>` : ''}<p style="font-size:14px;color:#555">- Mike AI / Doer Tough</p></div>`;
  return send({ to, subject: `Mike reminder: ${safeTitle}`, text, html });
}

export async function sendResaleDealAlert({ to, name, location, radiusMiles, opportunities = [] }) {
  const greeting = name ? `${name},` : 'Hey,';
  const rows = opportunities.slice(0, 8).map((item, index) => {
    const title = String(item.title || 'Potential deal').slice(0, 180);
    const buy = Number.isFinite(Number(item.askingPrice)) ? `$${Number(item.askingPrice).toLocaleString('en-US')}` : 'unknown';
    const resale = Number.isFinite(Number(item.resaleExpected)) ? `$${Number(item.resaleExpected).toLocaleString('en-US')}` : 'unknown';
    const profit = Number.isFinite(Number(item.estimatedProfit)) ? `$${Number(item.estimatedProfit).toLocaleString('en-US')}` : 'unknown';
    const roi = Number.isFinite(Number(item.roiPercent)) ? `${Math.round(Number(item.roiPercent))}%` : 'unknown';
    return `${index + 1}. ${title}\nBuy: ${buy} | Expected resale: ${resale} | Est. net profit: ${profit} | ROI: ${roi}\nWhy: ${String(item.why || 'No explanation provided.').slice(0, 500)}\nRed flags: ${String(item.redFlags || 'None reported.').slice(0, 400)}\n${item.url || ''}`;
  });
  const text = [greeting, '', `Mike found ${opportunities.length} new resale deal${opportunities.length === 1 ? '' : 's'} near ${location} (about ${radiusMiles} miles).`, '', ...rows, '', 'These are estimates based on current public evidence, not guaranteed profits. Verify the listing, condition, seller, and resale demand before buying.', '', '- Mike AI / Doer Tough'].join('\n');
  const htmlRows = opportunities.slice(0, 8).map((item, index) => `<li style="margin:0 0 18px"><strong>${escapeHtml(item.title || 'Potential deal')}</strong><br>Buy: ${escapeHtml(Number.isFinite(Number(item.askingPrice)) ? `$${Number(item.askingPrice).toLocaleString('en-US')}` : 'unknown')} · Expected resale: ${escapeHtml(Number.isFinite(Number(item.resaleExpected)) ? `$${Number(item.resaleExpected).toLocaleString('en-US')}` : 'unknown')} · Est. net: ${escapeHtml(Number.isFinite(Number(item.estimatedProfit)) ? `$${Number(item.estimatedProfit).toLocaleString('en-US')}` : 'unknown')} · ROI: ${escapeHtml(Number.isFinite(Number(item.roiPercent)) ? `${Math.round(Number(item.roiPercent))}%` : 'unknown')}<br><span style="color:#555">${escapeHtml(item.why || '')}</span>${item.url ? `<br><a href="${escapeHtml(item.url)}">Open listing</a>` : ''}</li>`).join('');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;color:#111"><p>${escapeHtml(greeting)}</p><h2 style="margin:12px 0 6px">New resale opportunities</h2><p>Mike found ${opportunities.length} new match${opportunities.length === 1 ? '' : 'es'} near ${escapeHtml(location)}.</p><ol>${htmlRows}</ol><p style="font-size:13px;color:#666">These are estimates based on current public evidence, not guaranteed profits. Verify the listing, condition, seller, and resale demand before buying.</p><p style="font-size:13px;color:#666">- Mike AI / Doer Tough</p></div>`;
  return send({ to, subject: `Mike found ${opportunities.length} resale deal${opportunities.length === 1 ? '' : 's'} near ${location}`, text, html });
}
