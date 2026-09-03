import fs from 'fs';

const indexPath = 'server/index.mjs';
let source = fs.readFileSync(indexPath, 'utf8');

const importLine = "import { registerOwnerDealAlertRoutes } from './owner-deal-alert-api.mjs';";
if (!source.includes(importLine)) {
  const anchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
  if (!source.includes(anchor)) throw new Error('owner deal alert import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const marker = '// ===== Owner iOS Deal Alerts API =====';
if (!source.includes(marker)) {
  const anchor = "app.post('/api/auth/reset-password', resetPassword);";
  if (!source.includes(anchor)) throw new Error('owner deal alert route anchor not found');
  const block = `${anchor}\n\n${marker}\nregisterOwnerDealAlertRoutes(app, { authRequired, isOwner });`;
  source = source.replace(anchor, block);
}

fs.writeFileSync(indexPath, source);
console.log('[patch-owner-deal-alert-api] owner Deal Alerts API wired');
