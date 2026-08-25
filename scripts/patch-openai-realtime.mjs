// Build-time bridge: keeps the OpenAI Realtime route isolated from the large
// legacy server file while we transition away from ElevenLabs. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { createMikeRealtimeClientSecret, MIKE_REALTIME_MODEL, MIKE_REALTIME_VOICE } from './openai-realtime.mjs';";
if (!source.includes(importLine)) {
  const anchor = "import { getRelevantMemories, listMemories, saveMemory, deleteMemory, memoryPrompt, CATEGORIES } from './memory.mjs';";
  if (!source.includes(anchor)) throw new Error('OpenAI realtime patch anchor import not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

if (!source.includes("app.post('/api/realtime/session'")) {
  const marker = '// Settle a finished voice session.';
  const index = source.indexOf(marker);
  if (index < 0) throw new Error('OpenAI realtime patch anchor route not found');

  const route = `// ===== OpenAI Realtime voice (additive migration path) =====\n// Uses a short-lived client secret so OPENAI_API_KEY never reaches the browser.\n// Memory + Mike's operating-system context are resolved server-side.\napp.post('/api/realtime/session', authRequired, async (req, res) => {\n  try {\n    const currentMessage = String(req.body?.message || 'voice conversation').slice(0, 1200);\n    const result = await createMikeRealtimeClientSecret(req.user.id, currentMessage);\n    res.json(result);\n  } catch (err) {\n    console.error('[openai-realtime] session failed:', err.message || err);\n    res.status(err.status || 502).json({ error: err.message || 'realtime_unavailable' });\n  }\n});\n\n`;
  source = source.slice(0, index) + route + source.slice(index);
}

fs.writeFileSync(target, source);
console.log(`[build] OpenAI Realtime ${MIKE_REALTIME_MODEL} route ready (voice=${MIKE_REALTIME_VOICE})`);
