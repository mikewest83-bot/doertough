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

// Deal alerts are already exposed to Realtime voice through realtime-tools.mjs.
// This also wires the same authenticated alert tools into text chat and starts
// the persistent background checker in the production server.
const dealAlertImport = "import { DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler } from './deal-alerts.mjs';";
if (!source.includes(dealAlertImport)) {
  const anchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
  if (!source.includes(anchor)) throw new Error('Deal alert import anchor not found');
  source = source.replace(anchor, `${anchor}\n${dealAlertImport}`);
}

source = source.replace(
  /const OWNER_ONLY_TOOLS = new Set\(\[[\s\S]*?\]\);\n/,
  ''
);

if (!source.includes('const DEAL_ALERT_HANDLERS =')) {
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
  source = source.replace(
    anchor,
    'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...DEAL_ALERT_TOOLS];'
  );
}

if (!source.includes('...DEAL_ALERT_HANDLERS')) {
  const anchor = '  ...FIELD_TOOL_HANDLERS,\n};';
  if (!source.includes(anchor)) throw new Error('LIVE_TOOL_HANDLERS anchor not found');
  source = source.replace(anchor, '  ...FIELD_TOOL_HANDLERS,\n  ...DEAL_ALERT_HANDLERS,\n};');
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
    '',
    '    // Preserve authenticated identity for every voice handler, matching the text gateway.',
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

// Database migrations run only in the Railway pre-deploy gate. Remove both
// known startup forms so this patch is safe against the legacy and current
// server bootstrap variants.
source = source.replace(
  "  migrate,\n",
  ''
);
source = source.replace(
  /\nmigrate\(\)\.then\(async \(\) => \{ await ensureRbacSchema\(\); await ensureReminderSchema\(\); \}\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\n?/g,
  '\n'
);
source = source.replace(
  /\nmigrate\(\)\.catch\(\(error\) => console\.error\('\[db\] migrate threw:', error\.message \|\| error\)\);\n?/g,
  '\n'
);

// The owner/test account must never be blocked by the production customer
// voice allowance. This prevents our own repeated QA sessions from consuming
// the launch tester's quota while preserving the paid/free limits for every
// other account. isOwner() is already server-side and authenticated.
if (!source.includes('// OWNER VOICE QA BYPASS')) {
  const anchor = "    const minuteLimit = paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;";
  if (!source.includes(anchor)) throw new Error('Voice budget patch anchor not found');
  source = source.replace(
    anchor,
    `${anchor}\n    // OWNER VOICE QA BYPASS\n    const ownerVoiceQa = isOwner(req.user);`
  );

  source = source.replace(
    "    if (usedSessions >= sessionLimit) return outOfBudget();",
    "    if (!ownerVoiceQa && usedSessions >= sessionLimit) return outOfBudget();"
  );
  source = source.replace(
    "    if (secondsUsed >= secondsAllowance) return outOfBudget();",
    "    if (!ownerVoiceQa && secondsUsed >= secondsAllowance) return outOfBudget();"
  );
  source = source.replace(
    "    if (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    ) {",
    "    if (!ownerVoiceQa && (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    )) {"
  );
}

// Start the persistent deal-alert worker once per production process. The
// worker is idempotent and maintains its own database schema if necessary.
if (!source.includes('// DEAL ALERT SCHEDULER')) {
  const anchor = "    console.log(`[mike-ai] realtime voice ready: ${engineId || 'disabled'}`);";
  if (!source.includes(anchor)) throw new Error('Deal alert scheduler voice anchor not found');
  source = source.replace(
    anchor,
    `${anchor}\n    // DEAL ALERT SCHEDULER\n    startDealAlertScheduler();\n    console.log('[mike-ai] deal alerts scheduler ready');`
  );
}

fs.writeFileSync(target, source);
console.log('[build] Realtime public tool dispatch ready; deal alerts attached to text + voice; persistent alert scheduler enabled; centralized owner tool policy; owner voice QA bypass enabled; startup migrations disabled');