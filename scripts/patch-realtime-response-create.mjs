// Build-time compatibility patch for the current OpenAI Realtime event schema.
// response.create no longer accepts response.modalities; output modality is
// configured by the active Realtime session. Keep response.create empty.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const bad = "response: { modalities: ['audio', 'text'] }";
const good = "response: {}";
const before = source;
source = source.split(bad).join(good);
fs.writeFileSync(target, source);
console.log(`[build] Realtime response.create compatibility patch: ${before === source ? 'already clean' : 'fixed response.modalities'}`);
