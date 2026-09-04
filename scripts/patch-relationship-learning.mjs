// Idempotently wires low-risk relationship learning into /api/ask.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server', 'index.mjs');
let text = fs.readFileSync(file, 'utf8');

const importLine = "import { learnFromInteraction } from './relationship-learning.mjs';";
const importAnchor = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
if (!text.includes(importLine)) {
  if (!text.includes(importAnchor)) throw new Error('relationship learning import anchor missing');
  text = text.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const anchor = "    const message = String(req.body?.message || '').trim();\n    if (!message) return res.status(400).json({ error: 'message_required' });";
const replacement = `${anchor}\n    if (req.user) {\n      void learnFromInteraction(req.user.id, message).catch((err) => console.error('[ask] relationship learning failed:', err.message || err));\n    }`;
if (!text.includes('void learnFromInteraction(req.user.id, message)')) {
  if (!text.includes(anchor)) throw new Error('relationship learning message anchor missing');
  text = text.replace(anchor, replacement);
}

fs.writeFileSync(file, text);
console.log('[patch-relationship-learning] complete');
