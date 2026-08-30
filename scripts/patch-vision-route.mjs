// Build-time, idempotent bridge for server-side Vision analysis.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importAnchor = "import { initializeSpeechEngine, getSpeechEngineToken } from './speech-engine.mjs';";
const importLine = "import { analyzeVisionImage } from './vision.mjs';";
if (!source.includes(importLine)) {
  if (!source.includes(importAnchor)) throw new Error('Vision route import anchor not found');
  source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const routeLine = "app.post('/api/vision/analyze', authRequired, analyzeVisionImage);";
if (!source.includes(routeLine)) {
  const guardAnchor = 'installGuards(app);';
  if (!source.includes(guardAnchor)) throw new Error('Vision route guard anchor not found');
  source = source.replace(guardAnchor, `${guardAnchor}\n\n// Vision analysis is authenticated and must remain behind the shared guard stack.\n${routeLine}`);
}

fs.writeFileSync(target, source);
console.log('[build] server-side Vision route ready behind shared guards');
