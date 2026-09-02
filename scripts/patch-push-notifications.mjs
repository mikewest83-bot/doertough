import fs from 'node:fs';

const serverPath = 'server/index.mjs';
let server = fs.readFileSync(serverPath, 'utf8');
const importAnchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';\n";
const pushImport = "import { pushConfigured, pushPublicKey, pushSubscribeHandler, pushUnsubscribeHandler } from './push-notifications.mjs';\n";
if (!server.includes(pushImport)) {
  if (!server.includes(importAnchor)) throw new Error('[patch-push-notifications] server import anchor not found');
  server = server.replace(importAnchor, importAnchor + pushImport);
}
const routeAnchor = "app.post('/api/auth/reset-password', resetPassword);\n";
const routes = `

// ===== Browser push notifications =====
app.get('/api/push/public-key', (_req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'push_not_configured' });
  res.json({ publicKey: pushPublicKey() });
});
app.post('/api/push/subscribe', authRequired, pushSubscribeHandler);
app.post('/api/push/unsubscribe', authRequired, pushUnsubscribeHandler);
`;
if (!server.includes("app.post('/api/push/subscribe'")) {
  if (!server.includes(routeAnchor)) throw new Error('[patch-push-notifications] account route anchor not found');
  server = server.replace(routeAnchor, routeAnchor + routes);
}
fs.writeFileSync(serverPath, server);

const resalePath = 'server/resale-alerts.mjs';
let resale = fs.readFileSync(resalePath, 'utf8');
const resaleImport = "import { sendPushToUser } from './push-notifications.mjs';\n";
if (!resale.includes(resaleImport)) {
  const anchor = "import { sendResaleDealAlert } from './mailer.mjs';\n";
  if (!resale.includes(anchor)) throw new Error('[patch-push-notifications] resale import anchor not found');
  resale = resale.replace(anchor, anchor + resaleImport);
}
const oldBlock = `      const mail = await sendResaleDealAlert({\n        to: watch.email,\n        name: watch.name,\n        location: watch.location,\n        radiusMiles: watch.radius_miles,\n        opportunities: fresh,\n      });\n      if (mail?.sent) emailed += 1;\n      console.log(\`[resale-watch] #\${watch.id} found=\${fresh.length} email_sent=\${mail?.sent ? 'true' : 'false'}\`);`;
const newBlock = `      const push = await sendPushToUser(watch.user_id, {
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
if (resale.includes(oldBlock) && !resale.includes('push_sent')) {
  resale = resale.replace('  let emailed = 0;\n', '  let emailed = 0;\n  let pushSent = 0;\n');
  resale = resale.replace(oldBlock, newBlock);
  resale = resale.replace('return { checked, matched, emailed };', 'return { checked, matched, emailed, pushSent };');
  resale = resale.replace('if (result.checked || result.matched) console.log(`[resale-watch] checked=${result.checked} matched=${result.matched} emails=${result.emailed}`);', 'if (result.checked || result.matched) console.log(`[resale-watch] checked=${result.checked} matched=${result.matched} pushes=${result.pushSent} emails=${result.emailed}`);');
}
fs.writeFileSync(resalePath, resale);

const indexPath = 'index.html';
let index = fs.readFileSync(indexPath, 'utf8');
const pushScript = '<script src="/mike-push-notifications.js?v=20260902-1"></script>';
if (!index.includes(pushScript)) {
  const anchor = '<script src="/resale-deals.js?v=20260901-1"></script>';
  if (!index.includes(anchor)) throw new Error('[patch-push-notifications] index script anchor not found');
  index = index.replace(anchor, anchor + '\n' + pushScript);
  fs.writeFileSync(indexPath, index);
}

console.log('[patch-push-notifications] browser push notifications wired');