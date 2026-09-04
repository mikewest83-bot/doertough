// Idempotently wires the continuity graph into server/memory.mjs.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server', 'memory.mjs');
let text = fs.readFileSync(file, 'utf8');
const importLine = "import { getContinuityGraph, continuityGraphPrompt } from './continuity-graph.mjs';";
const targetImport = "import { query, dbEnabled } from './db.mjs';";
if (!text.includes(importLine)) {
  if (!text.includes(targetImport)) throw new Error('continuity graph import anchor missing');
  text = text.replace(targetImport, `${targetImport}\n${importLine}`);
}
const old = "    const snapshot = await getOperatingSnapshot(userId);";
const replacement = "    const snapshot = await getOperatingSnapshot(userId);\n    const graph = await getContinuityGraph(userId);";
if (!text.includes('const graph = await getContinuityGraph(userId);')) {
  if (!text.includes(old)) throw new Error('continuity graph snapshot anchor missing');
  text = text.replace(old, replacement);
}
const oldReturn = "        memory: operatingSystemPrompt(snapshot).replace(/^\\n\\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\\n/, ''),";
const newReturn = "        memory: operatingSystemPrompt(snapshot).replace(/^\\n\\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\\n/, '') + continuityGraphPrompt(graph),";
if (!text.includes('continuityGraphPrompt(graph)')) {
  if (!text.includes(oldReturn)) throw new Error('continuity graph return anchor missing');
  text = text.replace(oldReturn, newReturn);
}
fs.writeFileSync(file, text);
console.log('[patch-continuity-graph] complete');
