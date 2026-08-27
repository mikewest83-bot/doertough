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

  const route = `// ===== Realtime public tool dispatch =====\n// Voice tool calls are authenticated and executed server-side; the browser never\n// receives private handlers or API credentials.\napp.post('/api/realtime/tool', authRequired, async (req, res) => {\n  try {\n    const name = String(req.body?.name || '').trim();\n    if (!isRealtimeToolAllowed(name)) return res.status(403).json({ error: 'tool_not_allowed' });\n\n    let args = req.body?.arguments;\n    if (typeof args === 'string') {\n      try { args = JSON.parse(args); } catch { return res.status(400).json({ error: 'tool_arguments_invalid' }); }\n    }\n    if (!args || typeof args !== 'object' || Array.isArray(args)) {\n      return res.status(400).json({ error: 'tool_arguments_invalid' });\n    }\n\n    const handler = getRealtimeToolHandler(name);\n    if (!handler) return res.status(403).json({ error: 'tool_not_allowed' });\n\n    const output = await handler(args);\n    const serialized = JSON.stringify(output ?? null);\n    res.json({ output: serialized.length > 12000 ? `${serialized.slice(0, 11950)}\\n[output truncated]` : serialized });\n  } catch (error) {\n    console.error('[realtime-tool] failed:', error.message || error);\n    res.status(500).json({ error: error.message || 'tool_failed' });\n  }\n});\n\n`;
  source = source.slice(0, index) + route + source.slice(index);
}

fs.writeFileSync(target, source);
console.log('[build] Realtime public tool dispatch ready');
