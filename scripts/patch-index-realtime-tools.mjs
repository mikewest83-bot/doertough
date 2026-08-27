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

if (!source.includes("app.post('/api/realtime/tool'")) {
  const marker = '// ===== Billing =====';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('Realtime tool patch billing anchor not found');

  const route = [
    '// ===== Realtime public tool dispatch =====',
    '// Voice tool calls are authenticated and executed server-side; the browser never',
    '// receives private handlers or API credentials.',
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
    '    const handler = getRealtimeToolHandler(name);',
    "    if (!handler) return res.status(403).json({ error: 'tool_not_allowed' });",
    '',
    '    const output = await handler(args);',
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

fs.writeFileSync(target, source);
console.log('[build] Realtime public tool dispatch ready');
