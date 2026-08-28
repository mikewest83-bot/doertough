// Build-time, idempotent wiring for Mike's roadmap foundation.
// Keeps the main server file stable while adding the new server-side tool pack
// and owner/admin authorization boundary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importMoney = "import { MONEY_TOOLS, MONEY_TOOL_HANDLERS } from './money-tools.mjs';";
if (!source.includes(importMoney)) {
  const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
  if (!source.includes(anchor)) throw new Error('Roadmap patch field-tools import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importMoney}`);
}

const importRbac = "import { ensureRbacSchema } from './rbac.mjs';";
if (!source.includes(importRbac)) {
  const anchor = "import { installGuards } from './guard.mjs';";
  if (!source.includes(anchor)) throw new Error('Roadmap patch guard import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importRbac}`);
}

if (!source.includes('...MONEY_TOOLS')) {
  const oldTools = "const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];";
  const newTools = "const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...MONEY_TOOLS];";
  if (!source.includes(oldTools)) throw new Error('Roadmap patch LIVE_TOOLS anchor not found');
  source = source.replace(oldTools, newTools);
}

if (!source.includes('...MONEY_TOOL_HANDLERS')) {
  const oldHandlers = "  ...FIELD_TOOL_HANDLERS,\n};";
  const newHandlers = "  ...FIELD_TOOL_HANDLERS,\n  ...MONEY_TOOL_HANDLERS,\n};";
  if (!source.includes(oldHandlers)) throw new Error('Roadmap patch handler anchor not found');
  source = source.replace(oldHandlers, newHandlers);
}

if (!source.includes('/api/owner/overview')) {
  const marker = '// ===== Realtime voice =====';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('Roadmap patch owner route anchor not found');
  const route = [
    '// ===== Owner-only roadmap controls =====',
    "app.get('/api/owner/overview', authRequired, async (req, res) => {",
    '  if (!isOwner(req.user)) return res.status(403).json({ error: \'forbidden\' });',
    '  try {',
    '    res.json(await getRbacOverview());',
    '  } catch (error) {',
    "    console.error('[owner] overview failed:', error.message || error);",
    "    res.status(500).json({ error: 'owner_overview_unavailable' });",
    '  }',
    '});',
    '',
    '',
  ].join('\n');
  source = source.slice(0, index) + route + source.slice(index);
}

if (!source.includes('getRbacOverview')) {
  const importLine = "import { ensureRbacSchema, getRbacOverview } from './rbac.mjs';";
  source = source.replace(importRbac, importLine);
}

const oldMigrate = "migrate().catch((error) => console.error('[db] migrate threw:', error.message || error));";
const newMigrate = "migrate().then(() => ensureRbacSchema()).catch((error) => console.error('[db] migrate threw:', error.message || error));";
if (source.includes(oldMigrate) && !source.includes('then(() => ensureRbacSchema())')) {
  source = source.replace(oldMigrate, newMigrate);
}

fs.writeFileSync(target, source);
console.log('[build] Mike roadmap tool pack and RBAC wiring ready');
