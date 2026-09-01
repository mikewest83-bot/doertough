// Build-time, idempotent bridge for Realtime public tool execution.
// Deal Alerts are intentionally part of the active text/voice tool surface.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { getRealtimeToolHandler, isRealtimeToolAllowed } from './realtime-tools.mjs';";
if (!source.includes(importLine)) {
  const anchor = "} from './auth.mjs';";
  if (!source.includes(anchor)) throw new Error('Realtime tool patch auth import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const ownerImport = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
if (!source.includes(ownerImport)) {
  const anchor = importLine;
  source = source.replace(anchor, `${anchor}\n${ownerImport}`);
}

// Restore Deal Alert wiring if an older cleanup pass removed it.
const dealAlertImport = "import { DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler } from './deal-alerts.mjs';";
if (!source.includes(dealAlertImport)) {
  const anchor = "import { REMINDER_TOOLS, reminderHandlerFor, startReminderScheduler } from './reminders.mjs';";
  if (!source.includes(anchor)) throw new Error('Deal Alert restore reminder import anchor not found');
  source = source.replace(anchor, `${anchor}\n${dealAlertImport}`);
}
if (!source.includes('  ...DEAL_ALERT_TOOLS,') && source.includes('  ...REMINDER_TOOLS,')) {
  source = source.replace('  ...REMINDER_TOOLS,\n];', '  ...REMINDER_TOOLS,\n  ...DEAL_ALERT_TOOLS,\n];');
}
if (!source.includes('  ...DEAL_ALERT_TOOLS.map((tool) => [') && source.includes('  ...REMINDER_TOOLS.map((tool) => [')) {
  const anchor = "  ...REMINDER_TOOLS.map((tool) => [\n    tool.name,\n    (args = {}) => reminderHandlerFor(tool.name, args?.user?.id)?.(args),\n  ]),";
  const addition = `${anchor}\n  ...DEAL_ALERT_TOOLS.map((tool) => [\n    tool.name,\n    (args = {}) => dealAlertHandlerFor(tool.name, args?.user?.id)?.(args),\n  ]),`;
  if (!source.includes(anchor)) throw new Error('Deal Alert handler anchor not found');
  source = source.replace(anchor, addition);
}

if (!source.includes("app.post('/api/realtime/tool'")) {
  const marker = '// ===== Billing =====';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('Realtime tool patch billing anchor not found');
  const route = [
    '// ===== Realtime public tool dispatch =====',
    "app.post('/api/realtime/tool', authRequired, async (req, res) => {",
    '  try {',
    "    const name = String(req.body?.name || '').trim();",
    "    if (!isRealtimeToolAllowed(name)) return res.status(403).json({ error: 'tool_not_allowed' });",
    '    let args = req.body?.arguments;',
    "    if (typeof args === 'string') {",
    "      try { args = JSON.parse(args); } catch { return res.status(400).json({ error: 'tool_arguments_invalid' }); }",
    '    }',
    "    if (!args || typeof args !== 'object' || Array.isArray(args)) return res.status(400).json({ error: 'tool_arguments_invalid' });",
    '    const handler = getRealtimeToolHandler(name, req.user);',
    "    if (!handler) return res.status(403).json({ error: 'tool_not_allowed' });",
    '    const output = await handler({ ...args, user: req.user });',
    '    const serialized = JSON.stringify(output ?? null);',
    "    const safeOutput = serialized.length > 12000 ? serialized.slice(0, 11950) + '\\n[output truncated]' : serialized;",
    '    res.json({ output: safeOutput });',
    '  } catch (error) {',
    "    console.error('[realtime-tool] failed:', error.message || error);",
    "    res.status(500).json({ error: error.message || 'tool_failed' });",
    '  }',
    '});',
    '',
    '',
  ].join('\n');
  source = source.slice(0, index) + route + source.slice(index);
}

// Database migrations run only in the Railway pre-deploy gate.
source = source.replace("  migrate,\n", '');
source = source.replace(/\nmigrate\(\)\.then\(async \(\) => \{ await ensureRbacSchema\(\); await ensureReminderSchema\(\); \}\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\r?\n?/g, '\n');
source = source.replace(/\nmigrate\(\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\r?\n?/g, '\n');

if (!source.includes('// OWNER VOICE QA BYPASS')) {
  const anchor = "    const minuteLimit = trialAccess ? TRIAL_MINUTE_LIMIT : paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;";
  if (!source.includes(anchor)) throw new Error('Voice budget patch anchor not found');
  source = source.replace(anchor, `${anchor}\n    // OWNER VOICE QA BYPASS\n    const ownerVoiceQa = isOwner(req.user);`);
  source = source.replace("    if (usedSessions >= sessionLimit) return outOfBudget();", "    if (!ownerVoiceQa && usedSessions >= sessionLimit) return outOfBudget();");
  source = source.replace("    if (secondsUsed >= secondsAllowance) return outOfBudget();", "    if (!ownerVoiceQa && secondsUsed >= secondsAllowance) return outOfBudget();");
  source = source.replace("    if (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    ) {", "    if (!ownerVoiceQa && (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    )) {");
}

// Start the persistent scanner once after the database is ready.
if (!source.includes('startDealAlertScheduler();')) {
  const anchor = "    console.log('[mike-ai] reminder scheduler ready');";
  if (!source.includes(anchor)) throw new Error('Deal Alert scheduler startup anchor not found');
  const block = `${anchor}\n    startDealAlertScheduler();\n    console.log('[mike-ai] deal alerts scheduler ready');`;
  source = source.replace(anchor, block);
}

fs.writeFileSync(target, source);
console.log('[build] Realtime tools wired; Deal Alerts enabled; owner voice QA bypass enabled; startup migrations disabled');
