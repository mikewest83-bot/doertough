// Idempotently wires the next Mike intelligence tools into the server registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { NEXT_INTELLIGENCE_TOOLS, NEXT_INTELLIGENCE_HANDLERS } from './mike-next-intelligence.mjs';";
if (!source.includes(importLine)) {
  const anchor = "import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';";
  if (!source.includes(anchor)) throw new Error('Next intelligence import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

if (!source.includes('...NEXT_INTELLIGENCE_TOOLS')) {
  const anchor = '...DOERTOUGH_INTELLIGENCE_TOOLS];';
  if (!source.includes(anchor)) throw new Error('Next intelligence tool registry anchor not found');
  source = source.replace(anchor, '...DOERTOUGH_INTELLIGENCE_TOOLS, ...NEXT_INTELLIGENCE_TOOLS];');
}

if (!source.includes('...NEXT_INTELLIGENCE_HANDLERS')) {
  const anchor = '  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n};';
  if (!source.includes(anchor)) throw new Error('Next intelligence handler registry anchor not found');
  source = source.replace(anchor, '  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n  ...NEXT_INTELLIGENCE_HANDLERS,\n};');
}

fs.writeFileSync(target, source);
console.log('[build] Mike next intelligence tools ready');
