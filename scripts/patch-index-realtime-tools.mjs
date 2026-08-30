// Build-time, idempotent bridge for Realtime public tool execution.
// Deal Alerts / "Watch It for Me" are intentionally disabled and are never
// added to the active Realtime registry by this patch.
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

// Remove any legacy Deal Alert wiring that may have been present before this
// patch ran. The preserved deal-alert module is intentionally not part of the
// active text/voice tool surface.
source = source.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler \} from '\.\/deal-alerts\.mjs';\r?\n/m, '');
source = source.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor \} from '\.\/deal-alerts\.mjs';\r?\n/m, '');
source = source.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\r?\n/gm, '');
source = source.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\r?\n/gm, '');
source = source.replace(/^\s*DEAL_ALERT_HANDLERS,\r?\n/gm, '');
source = source.replace(/^\s*startDealAlertScheduler\(\);\r?\n?/gm, '');
source = source.replace(/\nconst DEAL_ALERT_HANDLERS = Object\.fromEntries\(DEAL_ALERT_TOOLS\.map\(\(tool\) => \[[\s\S]*?\]\)\);\r?\n/g, '\n');

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
  const anchor = "    const minuteLimit = paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;";
  if (!source.includes(anchor)) throw new Error('Voice budget patch anchor not found');
  source = source.replace(anchor, `${anchor}\n    // OWNER VOICE QA BYPASS\n    const ownerVoiceQa = isOwner(req.user);`);
  source = source.replace("    if (usedSessions >= sessionLimit) return outOfBudget();", "    if (!ownerVoiceQa && usedSessions >= sessionLimit) return outOfBudget();");
  source = source.replace("    if (secondsUsed >= secondsAllowance) return outOfBudget();", "    if (!ownerVoiceQa && secondsUsed >= secondsAllowance) return outOfBudget();");
  source = source.replace("    if (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    ) {", "    if (!ownerVoiceQa && (\n      globalUsedSessions >= GLOBAL_SESSION_LIMIT ||\n      globalUsedSeconds >= GLOBAL_MINUTE_LIMIT * 60\n    )) {");
}

fs.writeFileSync(target, source);
console.log('[build] Realtime tools wired; Deal Alerts / Watch It for Me excluded; owner voice QA bypass enabled; startup migrations disabled');
