// Build-time, idempotent bridge for Realtime public tool execution.
// Keeps the legacy server file stable while routing voice tool calls through
// the same authenticated server-side handlers used by text Mike.
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
  const anchor = "import { getRealtimeToolHandler, isRealtimeToolAllowed } from './realtime-tools.mjs';";
  source = source.replace(anchor, `${anchor}\n${ownerImport}`);
}

// Deal alerts are exposed to Realtime voice and text chat. Scheduler startup
// intentionally remains in the canonical production server path so this
// build-time patch cannot create duplicate scheduler workers.
// IMPORTANT: keep startDealAlertScheduler imported because server/index.mjs
// owns the single canonical scheduler startup call.
const dealAlertImport = "import { DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler } from './deal-alerts.mjs';";
const legacyDealAlertImport = "import { DEAL_ALERT_TOOLS, dealAlertHandlerFor } from './deal-alerts.mjs';";
if (!source.includes(dealAlertImport)) {
  if (source.includes(legacyDealAlertImport)) {
    source = source.replace(legacyDealAlertImport, dealAlertImport);
  } else {
    const anchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
    if (!source.includes(anchor)) throw new Error('Deal alert import anchor not found');
    source = source.replace(anchor, `${anchor}\n${dealAlertImport}`);
  }
}

source = source.replace(/const OWNER_ONLY_TOOLS = new Set\(\[[\s\S]*?\]\);\n/, '');

if (!source.includes('const DEAL_ALERT_HANDLERS =') && !source.includes('...ACCOUNT_SCOPED_TOOL_HANDLERS')) {
  const anchor = 'const PUBLIC_TOOLS = LIVE_TOOLS.filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));';
  if (!source.includes(anchor)) throw new Error('Deal alert tools anchor not found');
  const block = [
    'const DEAL_ALERT_HANDLERS = Object.fromEntries(DEAL_ALERT_TOOLS.map((tool) => [',
    '  tool.name,',
    '  (args = {}) => dealAlertHandlerFor(tool.name, args?.user?.id)?.(args),',
    ']));',
    '',
  ].join('\n');
  source = source.replace(anchor, `${block}${anchor}`);
}

if (!source.includes('...DEAL_ALERT_TOOLS')) {
  const anchor = 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];';
  if (!source.includes(anchor)) throw new Error('LIVE_TOOLS anchor not found');
  source = source.replace(anchor, 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...DEAL_ALERT_TOOLS];');
}

if (!source.includes('...DEAL_ALERT_HANDLERS') && source.includes('const DEAL_ALERT_HANDLERS =')) {
  const handlerEndAnchor = '};\nconst PUBLIC_TOOLS = LIVE_TOOLS.filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));';
  if (!source.includes(handlerEndAnchor)) throw new Error('LIVE_TOOL_HANDLERS anchor not found');
  source = source.replace(handlerEndAnchor, '  ...DEAL_ALERT_HANDLERS,\n};\nconst PUBLIC_TOOLS = LIVE_TOOLS.filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));');
}

if (!source.includes("app.post('/api/realtime/tool'")) {
  const marker = '// ===== Billing =====';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('Realtime tool patch billing anchor not found');
  const route = [
    '// ===== Realtime public tool dispatch =====',
    '// Voice tool calls are authenticated and executed server-side; the browser never',
    '// receives private handlers or provider credentials.',
    "app.post('/api/realtime/tool', authRequired, async (req, res) => {",
    '  try {',
    "    const name = String(req.body?.name || '').trim();",
    "    if (!isRealtimeToolAllowed(name)) return res.status(403).json({ error: 'tool_not_allowed' });",
    '',
    '    let args = req.body?.arguments;',
    "    if (typeof args === 'string') {",
    "      try { args = JSON.parse(args); } catch { return res.status(400).json({ error: 'tool_arguments_invalid' }); }",
    '    }',
    "    if (!args || typeof args !== 'object' || Array.isArray(args)) return res.status(400).json({ error: 'tool_arguments_invalid' });",
    '',
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
source = source.replace(/\nmigrate\(\)\.then\(async \(\) => \{ await ensureRbacSchema\(\); await ensureReminderSchema\(\); \}\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\n?/g, '\n');
source = source.replace(/\nmigrate\(\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\n?/g, '\n');

if (!source.includes('// OWNER VOICE QA BYPASS')) {
  const anchor = "    const minuteLimit = paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;";
  if (!source.includes(anchor)) throw new Error('Voice budget patch anchor not found');
  source = source.replace(anchor, `${anchor}\n    // OWNER VOICE QA BYPASS\n    const ownerVoiceQa = isOwner(req.user);`);
  source = source.replace("    if (usedSessions >= sessionLimit) return outOfBudget();", "    if (!ownerVoiceQa && usedSessions >= sessionLimit) return outOfBudget();");
  source = source.replace("    if (secondsUsed >= secondsAllowance) return outOfBudget();", "    if (!ownerVoiceQa && secondsUsed >= secondsAllowance) return outOfBudget();");
  source = source.replace("    if (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    ) {", "    if (!ownerVoiceQa && (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    )) {");
}

// Scheduler startup is intentionally NOT injected here. It belongs to the
// canonical production server startup path and must run exactly once.
fs.writeFileSync(target, source);
console.log('[build] Realtime tools wired; deal-alert scheduler import preserved for canonical server startup; owner voice QA bypass enabled; startup migrations disabled');
