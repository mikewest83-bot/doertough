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

const routeAnchor = "app.use(express.json({ limit: '15mb' }));";
const route = `${routeAnchor}\napp.post('/api/vision/analyze', authRequired, analyzeVisionImage);`;
if (!source.includes("app.post('/api/vision/analyze'")) {
  if (!source.includes(routeAnchor)) throw new Error('Vision route anchor not found');
  source = source.replace(routeAnchor, route);
}

fs.writeFileSync(target, source);
console.log('[build] server-side Vision route ready');
