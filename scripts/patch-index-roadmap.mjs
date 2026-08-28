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

const importIntelligence = "import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';";
if (!source.includes(importIntelligence)) {
  const anchor = importMoney;
  if (!source.includes(anchor)) throw new Error('Roadmap patch money-tools import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importIntelligence}`);
}

const importReminder = "import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';";
if (!source.includes(importReminder)) {
  const anchor = "import { installGuards } from './guard.mjs';";
  if (!source.includes(anchor)) throw new Error('Roadmap patch guard import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importReminder}`);
}

const importRbac = "import { ensureRbacSchema, getRbacOverview } from './rbac.mjs';";
if (!source.includes(importRbac)) {
  const oldImport = "import { ensureRbacSchema } from './rbac.mjs';";
  const anchor = "import { installGuards } from './guard.mjs';";
  if (source.includes(oldImport)) {
    source = source.replace(oldImport, importRbac);
  } else {
    if (!source.includes(anchor)) throw new Error('Roadmap patch guard import anchor not found');
    source = source.replace(anchor, `${anchor}\n${importRbac}`);
  }
}

if (!source.includes('...MONEY_TOOLS')) {
  const oldTools = "const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];";
  const newTools = "const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...MONEY_TOOLS, ...REMINDER_TOOLS, ...DOERTOUGH_INTELLIGENCE_TOOLS];";
  if (!source.includes(oldTools)) throw new Error('Roadmap patch LIVE_TOOLS anchor not found');
  source = source.replace(oldTools, newTools);
} else {
  if (!source.includes('...REMINDER_TOOLS')) source = source.replace('...FIELD_TOOLS, ...MONEY_TOOLS];', '...FIELD_TOOLS, ...MONEY_TOOLS, ...REMINDER_TOOLS];');
  if (!source.includes('...DOERTOUGH_INTELLIGENCE_TOOLS')) source = source.replace('...MONEY_TOOLS, ...REMINDER_TOOLS];', '...MONEY_TOOLS, ...REMINDER_TOOLS, ...DOERTOUGH_INTELLIGENCE_TOOLS];');
}

if (!source.includes('...MONEY_TOOL_HANDLERS')) {
  const oldHandlers = "  ...FIELD_TOOL_HANDLERS,\n};";
  const newHandlers = "  ...FIELD_TOOL_HANDLERS,\n  ...MONEY_TOOL_HANDLERS,\n  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n};";
  if (!source.includes(oldHandlers)) throw new Error('Roadmap patch handler anchor not found');
  source = source.replace(oldHandlers, newHandlers);
} else if (!source.includes('...DOERTOUGH_INTELLIGENCE_HANDLERS')) {
  source = source.replace('  ...MONEY_TOOL_HANDLERS,\n};', '  ...MONEY_TOOL_HANDLERS,\n  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n};');
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

// Account-scoped reminder API. The reminder module enforces ownership in SQL,
// so a caller can never read/cancel another user's reminders by changing an id.
if (!source.includes("app.get('/api/reminders'")) {
  const marker = '// ===== Billing =====';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('Roadmap patch reminder route anchor not found');
  const route = [
    '// ===== Persistent reminders / alarms =====',
    "app.get('/api/reminders', authRequired, async (req, res) => {",
    '  try {',
    '    res.json({ reminders: await listRemindersTool(req.user.id, { includePast: req.query?.includePast === \'true\' }) });',
    '  } catch (error) {',
    "    console.error('[reminders] list route failed:', error.message || error);",
    "    res.status(500).json({ error: 'reminders_unavailable' });",
    '  }',
    '});',
    '',
    "app.post('/api/reminders', authRequired, async (req, res) => {",
    '  try {',
    '    const result = await setReminderTool(req.user.id, req.body || {});',
    '    if (result?.error) return res.status(400).json(result);',
    '    res.json(result);',
    '  } catch (error) {',
    "    console.error('[reminders] create route failed:', error.message || error);",
    "    res.status(500).json({ error: 'reminder_create_failed' });",
    '  }',
    '});',
    '',
    "app.delete('/api/reminders/:id', authRequired, async (req, res) => {",
    '  try {',
    '    res.json(await cancelReminderTool(req.user.id, { id: Number(req.params.id) }));',
    '  } catch (error) {',
    "    console.error('[reminders] cancel route failed:', error.message || error);",
    "    res.status(500).json({ error: 'reminder_cancel_failed' });",
    '  }',
    '});',
    '',
    '',
  ].join('\n');
  source = source.slice(0, index) + route + source.slice(index);
}

// Text chat gets account-aware reminder handlers. Anonymous users still have
// the public tools, but reminder creation/listing/canceling requires auth.
if (!source.includes('const REMINDER_TOOL_HANDLERS = req.user')) {
  const anchor = '    let text = "I\'m here. Give me another shot.";';
  if (!source.includes(anchor)) throw new Error('Roadmap reminder handler anchor not found');
  const insert = [
    anchor,
    '    const REMINDER_TOOL_HANDLERS = req.user ? {',
    '      set_reminder: (args) => setReminderTool(req.user.id, args),',
    '      list_reminders: (args) => listRemindersTool(req.user.id, args),',
    '      cancel_reminder: (args) => cancelReminderTool(req.user.id, args),',
    '    } : {};',
  ].join('\n');
  source = source.replace(anchor, insert);
}

if (!source.includes('REMINDER_TOOL_HANDLERS[call.name]')) {
  source = source.replace(
    '        const handler = LIVE_TOOL_HANDLERS[call.name];',
    '        const handler = REMINDER_TOOL_HANDLERS[call.name] || LIVE_TOOL_HANDLERS[call.name];'
  );
}

const oldMigrate = "migrate().catch((error) => console.error('[db] migrate threw:', error.message || error));";
const newMigrate = "migrate().then(async () => { await ensureRbacSchema(); await ensureReminderSchema(); }).catch((error) => console.error('[db] migrate threw:', error.message || error));";
if (source.includes(oldMigrate) && !source.includes('ensureReminderSchema()')) {
  source = source.replace(oldMigrate, newMigrate);
}

// Keep the first customer-facing CTA simple: it launches the same text path as
// any other prompt, while making the new differentiator visible on the home page.
const oldTryChips = "['How much concrete for a 20x24 slab at 4 inches?','Quote a 3-day framing job at $65 an hour.','What am I missing?']";
const newTryChips = "['💰 Save me money','How much concrete for a 20x24 slab at 4 inches?','Quote a 3-day framing job at $65 an hour.','What am I missing?']";
if (source.includes(oldTryChips) && !source.includes(newTryChips)) {
  source = source.replace(oldTryChips, newTryChips);
}

fs.writeFileSync(target, source);
console.log('[build] Mike roadmap tool pack, Doer Tough intelligence, RBAC, reminders, and Save Me Money CTA ready');
