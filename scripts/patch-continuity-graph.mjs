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
if (text.includes(old) && !text.includes('const graph = await getContinuityGraph(userId);')) text = text.replace(old, replacement);
const oldReturn = "    return [\n      ...memories,\n      {\n        category: 'operating_system',\n        memory: operatingSystemPrompt(snapshot).replace(/^\\n\\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\\n/, ''),\n        importance: 5,\n        source: 'mike-os',\n      },\n    ];";
const newReturn = "    return [\n      ...memories,\n      {\n        category: 'operating_system',\n        memory: operatingSystemPrompt(snapshot).replace(/^\\n\\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\\n/, '') + continuityGraphPrompt(graph),\n        importance: 5,\n        source: 'mike-os',\n      },\n    ];";
if (text.includes(oldReturn) && !text.includes('continuityGraphPrompt(graph)')) text = text.replace(oldReturn, newReturn);
fs.writeFileSync(file, text);
console.log('[patch-continuity-graph] complete');
