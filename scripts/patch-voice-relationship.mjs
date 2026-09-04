import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server', 'speech-engine.mjs');
const index = path.join(root, 'server', 'index.mjs');
const main = path.join(root, 'src', 'main.jsx');

function patchSpeechEngine() {
  let source = fs.readFileSync(server, 'utf8');
  const memoryImport = "import { getRelevantMemories, memoryPrompt } from './memory.mjs';";
  const graphImport = "import { getContinuityGraph, continuityGraphPrompt } from './continuity-graph.mjs';";
  if (!source.includes(memoryImport)) {
    const anchor = "import { MIKE_INSTRUCTIONS } from './persona.mjs';";
    if (!source.includes(anchor)) throw new Error('[voice-relationship] speech persona import anchor not found');
    source = source.replace(anchor, `${anchor}\n${memoryImport}\n${graphImport}`);
  }
  if (!source.includes('async function buildVoiceRelationshipContext')) {
    const anchor = "const REALTIME_INSTRUCTIONS = `";
    const pos = source.indexOf(anchor);
    if (pos < 0) throw new Error('[voice-relationship] realtime instructions anchor not found');
    source = source.slice(0, pos) + `async function buildVoiceRelationshipContext(userId) {\n  if (!userId) return '';\n  try {\n    const [memories, graph] = await Promise.all([\n      getRelevantMemories(userId, 'voice conversation current goals preferences projects', 12),\n      getContinuityGraph(userId),\n    ]);\n    return `${'\\n\\n'}${memoryPrompt(memories)}${continuityGraphPrompt(graph)}${'\\n\\n'}VOICE RELATIONSHIP GUIDANCE\\nUse this context to make the conversation feel continuous and personal. Treat stored preferences and learned patterns as hypotheses, not facts. The current user always overrides stored context. Do not mention this internal context unless asked.`;\n  } catch (error) {\n    console.warn('[realtime] relationship context unavailable:', error.message || error);\n    return '';\n  }\n}\n\n` + source.slice(pos);
  }
  source = source.replace('export async function getSpeechEngineToken() {', 'export async function getSpeechEngineToken(userId = null) {');
  source = source.replace("  requireKey(process.env.OPENAI_API_KEY, 'openai');\n  const response", "  requireKey(process.env.OPENAI_API_KEY, 'openai');\n  const voiceRelationshipContext = await buildVoiceRelationshipContext(userId);\n  const response");
  source = source.replace('        instructions: REALTIME_INSTRUCTIONS,', '        instructions: `${REALTIME_INSTRUCTIONS}${voiceRelationshipContext}`,');
  fs.writeFileSync(server, source);
}

function patchIndex() {
  let source = fs.readFileSync(index, 'utf8');
  if (!source.includes("relationship-learning.mjs")) {
    const anchor = "import { MIKE_INSTRUCTIONS } from './persona.mjs';";
    if (!source.includes(anchor)) throw new Error('[voice-relationship] index persona import anchor not found');
    source = source.replace(anchor, `${anchor}\nimport { learnFromInteraction } from './relationship-learning.mjs';`);
  }
  source = source.replace('const result = await getSpeechEngineToken();', 'const result = await getSpeechEngineToken(req.user?.id || null);');
  if (!source.includes("app.post('/api/voice/learn'")) {
    const anchor = "app.post('/api/voice/transcript', authRequired, async (req, res) => {";
    const indexAt = source.indexOf(anchor);
    if (indexAt < 0) throw new Error('[voice-relationship] voice transcript route anchor not found');
    const route = `app.post('/api/voice/learn', authRequired, async (req, res) => {\n  try {\n    const text = String(req.body?.content || '').trim();\n    if (text && req.user?.id) void learnFromInteraction(req.user.id, text).catch((error) => console.error('[voice-learning] failed:', error.message || error));\n    res.json({ ok: true });\n  } catch (error) {\n    console.error('[voice-learning] route failed:', error.message || error);\n    res.status(500).json({ error: 'voice_learning_unavailable' });\n  }\n});\n\n`;
    source = source.slice(0, indexAt) + route + source.slice(indexAt);
  }
  fs.writeFileSync(index, source);
}

function patchMain() {
  let source = fs.readFileSync(main, 'utf8');
  if (!source.includes('voiceRelationshipLearn')) {
    const anchor = "const authHeaders = () => {";
    const pos = source.indexOf(anchor);
    if (pos < 0) throw new Error('[voice-relationship] main authHeaders anchor not found');
    source = source.slice(0, pos) + `const voiceRelationshipLearn = (content) => {\n  const text = String(content || '').trim();\n  if (!text) return;\n  fetch('/api/voice/learn', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content: text }) }).catch(() => {});\n};\n` + source.slice(pos);
  }
  const userAnchor = "else if (message.type === 'conversation.item.input_audio_transcription.completed') { const text = String(message.transcript || '').trim(); if (text) setMessages";
  if (source.includes(userAnchor) && !source.includes("message.type === 'conversation.item.input_audio_transcription.completed' && voiceRelationshipLearn")) {
    source = source.replace(userAnchor, "else if (message.type === 'conversation.item.input_audio_transcription.completed') { const text = String(message.transcript || '').trim(); if (text) { voiceRelationshipLearn(text); } if (text) setMessages");
  }
  fs.writeFileSync(main, source);
}

patchSpeechEngine();
patchIndex();
patchMain();
console.log('[build] Voice relationship memory wired');
