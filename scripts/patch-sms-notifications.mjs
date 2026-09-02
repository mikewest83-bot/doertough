import fs from 'node:fs';

// Wires text alerts (server/sms-notifications.mjs) into the app. Must run
// AFTER scripts/patch-push-notifications.mjs in package.json's build chain -
// every anchor below targets the file state that patch leaves behind (its
// import line, its routes, and its already-modified resale-alerts.mjs
// send block), the same way that patch itself chains onto
// patch-owner-conversations.mjs's account routes.

const serverPath = 'server/index.mjs';
let server = fs.readFileSync(serverPath, 'utf8');
const pushImportAnchor = "import { pushConfigured, pushPublicKey, pushSubscribeHandler, pushUnsubscribeHandler } from './push-notifications.mjs';\n";
const smsImport = "import { smsConfigured, startPhoneVerification, confirmPhoneVerification, removePhoneSubscription, getSmsStatus } from './sms-notifications.mjs';\n";
if (!server.includes(smsImport)) {
  if (!server.includes(pushImportAnchor)) throw new Error('[patch-sms-notifications] server import anchor not found - did patch-push-notifications.mjs run first?');
  server = server.replace(pushImportAnchor, pushImportAnchor + smsImport);
}
const routeAnchor = "app.post('/api/push/unsubscribe', authRequired, pushUnsubscribeHandler);\n";
const routes = `
// ===== Text (SMS) deal alerts =====
app.get('/api/sms/status', authRequired, async (req, res) => {
  try { res.json(await getSmsStatus(req.user.id)); }
  catch (error) { console.error('[sms] status failed:', error.message || error); res.status(500).json({ error: 'sms_status_failed' }); }
});
app.post('/api/sms/subscribe', authRequired, async (req, res) => {
  if (!smsConfigured()) return res.status(503).json({ error: 'sms_not_configured' });
  try {
    const { phone } = await startPhoneVerification(req.user.id, req.body?.phone);
    res.json({ ok: true, phone });
  } catch (error) {
    const code = error.message || 'sms_subscribe_failed';
    const status = code === 'sms_phone_invalid' ? 400 : code === 'sms_not_configured' ? 503 : 500;
    res.status(status).json({ error: code });
  }
});
app.post('/api/sms/verify', authRequired, async (req, res) => {
  try {
    const { phone } = await confirmPhoneVerification(req.user.id, req.body?.code);
    res.json({ ok: true, phone });
  } catch (error) {
    const code = error.message || 'sms_verify_failed';
    const status = ['sms_code_required', 'sms_code_mismatch', 'sms_code_expired', 'sms_no_pending_code'].includes(code) ? 400 : 500;
    res.status(status).json({ error: code });
  }
});
app.post('/api/sms/unsubscribe', authRequired, async (req, res) => {
  try { res.json({ ok: true, removed: await removePhoneSubscription(req.user.id) }); }
  catch (error) { console.error('[sms] unsubscribe failed:', error.message || error); res.status(500).json({ error: 'sms_unsubscribe_failed' }); }
});
`;
if (!server.includes("app.post('/api/sms/subscribe'")) {
  if (!server.includes(routeAnchor)) throw new Error('[patch-sms-notifications] push unsubscribe route anchor not found - did patch-push-notifications.mjs run first?');
  server = server.replace(routeAnchor, routeAnchor + routes);
}
fs.writeFileSync(serverPath, server);

const resalePath = 'server/resale-alerts.mjs';
let resale = fs.readFileSync(resalePath, 'utf8');
const resaleImportAnchor = "import { sendPushToUser } from './push-notifications.mjs';\n";
const resaleImport = "import { sendSmsToUser } from './sms-notifications.mjs';\n";
if (!resale.includes(resaleImport)) {
  if (!resale.includes(resaleImportAnchor)) throw new Error('[patch-sms-notifications] resale-alerts push import anchor not found - did patch-push-notifications.mjs run first?');
  resale = resale.replace(resaleImportAnchor, resaleImportAnchor + resaleImport);
}

// This is exactly the block patch-push-notifications.mjs's own "newBlock"
// leaves behind - reconstructed here as the anchor for chaining an SMS send
// in between the push send and the email send.
const oldBlock = `      const push = await sendPushToUser(watch.user_id, {
        title: fresh.length === 1 ? "Mike found a deal" : "Mike found " + fresh.length + " deals",
        body: fresh.slice(0, 3).map((item) => String(item.title || "Resale opportunity") + " - $" + Number(item.estimatedProfit || 0).toLocaleString() + " est. profit").join(" | "),
        url: fresh[0]?.url || "/",
        tag: "mike-resale-" + watch.id,
      });
      if (push?.sent) pushSent += push.sent;
      const mail = await sendResaleDealAlert({
        to: watch.email,
        name: watch.name,
        location: watch.location,
        radiusMiles: watch.radius_miles,
        opportunities: fresh,
      });
      if (mail?.sent) emailed += 1;
      console.log("[resale-watch] #" + watch.id + " found=" + fresh.length + " push_sent=" + (push?.sent || 0) + " email_sent=" + (mail?.sent ? "true" : "false"));`;
const newBlock = `      const push = await sendPushToUser(watch.user_id, {
        title: fresh.length === 1 ? "Mike found a deal" : "Mike found " + fresh.length + " deals",
        body: fresh.slice(0, 3).map((item) => String(item.title || "Resale opportunity") + " - $" + Number(item.estimatedProfit || 0).toLocaleString() + " est. profit").join(" | "),
        url: fresh[0]?.url || "/",
        tag: "mike-resale-" + watch.id,
      });
      if (push?.sent) pushSent += push.sent;
      const sms = await sendSmsToUser(watch.user_id, "Mike found " + fresh.length + " resale deal" + (fresh.length === 1 ? "" : "s") + " near " + watch.location + ". Top: " + String(fresh[0]?.title || "New listing").slice(0, 80) + (fresh[0]?.url ? " " + fresh[0].url : ""));
      if (sms?.sent) smsSent += 1;
      const mail = await sendResaleDealAlert({
        to: watch.email,
        name: watch.name,
        location: watch.location,
        radiusMiles: watch.radius_miles,
        opportunities: fresh,
      });
      if (mail?.sent) emailed += 1;
      console.log("[resale-watch] #" + watch.id + " found=" + fresh.length + " push_sent=" + (push?.sent || 0) + " sms_sent=" + (sms?.sent ? "true" : "false") + " email_sent=" + (mail?.sent ? "true" : "false"));`;

if (resale.includes(oldBlock) && !resale.includes('smsSent')) {
  resale = resale.replace('  let pushSent = 0;\n', '  let pushSent = 0;\n  let smsSent = 0;\n');
  resale = resale.replace(oldBlock, newBlock);
  resale = resale.replace('return { checked, matched, emailed, pushSent };', 'return { checked, matched, emailed, pushSent, smsSent };');
  const oldSummary = 'if (result.checked || result.matched) console.log(`[resale-watch] checked=${result.checked} matched=${result.matched} pushes=${result.pushSent} emails=${result.emailed}`);';
  const newSummary = 'if (result.checked || result.matched) console.log(`[resale-watch] checked=${result.checked} matched=${result.matched} pushes=${result.pushSent} texts=${result.smsSent} emails=${result.emailed}`);';
  if (!resale.includes(oldSummary)) throw new Error('[patch-sms-notifications] resale-alerts summary log anchor not found - did patch-push-notifications.mjs run first?');
  resale = resale.replace(oldSummary, newSummary);
}
fs.writeFileSync(resalePath, resale);

const indexPath = 'index.html';
let index = fs.readFileSync(indexPath, 'utf8');
const smsScript = '<script src="/mike-sms-notifications.js?v=20260902-1"></script>';
if (!index.includes(smsScript)) {
  const anchor = '<script src="/mike-push-notifications.js?v=20260902-2"></script>';
  if (!index.includes(anchor)) throw new Error('[patch-sms-notifications] index script anchor not found - did patch-push-notifications.mjs run first?');
  index = index.replace(anchor, anchor + '\n' + smsScript);
  fs.writeFileSync(indexPath, index);
}

console.log('[patch-sms-notifications] text deal alerts wired');
