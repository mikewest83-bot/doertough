import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

try {
  const importLine = "import { getOwnerMetrics } from './owner-metrics.mjs';";
  if (!source.includes(importLine)) {
    const anchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
    if (!source.includes(anchor)) throw new Error('owner metrics import anchor not found');
    source = source.replace(anchor, `${anchor}\n${importLine}`);
  }

  if (!source.includes("app.get('/api/owner/metrics'")) {
    const marker = '// ===== Realtime voice =====';
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('owner metrics route anchor not found');
    const route = [
      '// ===== Owner production metrics (read-only) =====',
      "app.get('/api/owner/metrics', authRequired, async (req, res) => {",
      "  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });",
      '  try {',
      '    res.json(await getOwnerMetrics());',
      '  } catch (error) {',
      "    console.error('[owner-metrics] route failed:', error.message || error);",
      "    res.status(500).json({ error: 'owner_metrics_unavailable' });",
      '  }',
      '});', '', '',
    ].join('\n');
    source = source.slice(0, index) + route + source.slice(index);
  }

  fs.writeFileSync(target, source);
  console.log('[build] Owner production metrics route wired');
} catch (error) {
  console.warn(`[build] owner metrics patch skipped: ${error.message || error}`);
  process.exitCode = 0;
}
