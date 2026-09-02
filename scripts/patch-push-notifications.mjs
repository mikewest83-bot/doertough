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
