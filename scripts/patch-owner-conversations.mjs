// Wires the owner-only conversation viewer into server/index.mjs at build
// time, the same way every other route in this app gets added.
//
// Anchoring note: this deliberately inserts AFTER the owner-metrics route
// rather than at the '// ===== Realtime voice =====' marker, because several
// other patches insert at that marker and stacking one more there makes the
// resulting order depend on run sequence. Keying off a route that
// patch-owner-metrics has already written keeps this stable, and means this
// script must run after it in the build chain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

try {
  const importLine = "import { listConversations, getConversation, listVoiceCalls, getVoiceCall, recordVoiceTurn, voiceTranscriptsEnabled } from './owner-conversations.mjs';";
  if (!source.includes('owner-conversations.mjs')) {
    const anchor = "import { getOwnerMetrics } from './owner-metrics.mjs';";
    if (!source.includes(anchor)) throw new Error('owner conversations import anchor not found (run after patch-owner-metrics)');
    source = source.replace(anchor, `${anchor}\n${importLine}`);
  }

  if (!source.includes("app.get('/api/owner/conversations'")) {
    const marker = "app.get('/api/owner/metrics', authRequired, async (req, res) => {";
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('owner conversations route anchor not found (run after patch-owner-metrics)');
    // Walk to the end of the metrics route so the new routes land after it.
    const end = source.indexOf('});', source.indexOf('});', index) + 3);
    if (end < 0) throw new Error('could not find the end of the owner metrics route');
    const at = end + 3;

    const routes = [
      '',
      '',
      '// ===== Owner conversation viewer (read-only, owner-gated) =====',
      '// Text is read straight from conversations/messages, which the app already',
      '// stores. Voice returns empty unless VOICE_TRANSCRIPTS=1.',
      "app.get('/api/owner/conversations', authRequired, async (req, res) => {",
      "  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });",
      '  try {',
      '    const minutes = Number(req.query.minutes) || 1440;',
      '    const limit = Number(req.query.limit) || 40;',
      '    const [text, voice] = await Promise.all([',
      '      listConversations({ minutes, limit }),',
      '      listVoiceCalls({ minutes, limit }),',
      '    ]);',
      '    res.json({ ...text, voice, voiceEnabled: voiceTranscriptsEnabled() });',
      '  } catch (error) {',
      "    console.error('[owner-conversations] list failed:', error.message || error);",
      "    res.status(500).json({ error: 'owner_conversations_unavailable' });",
      '  }',
      '});',
      '',
      "app.get('/api/owner/conversations/:id', authRequired, async (req, res) => {",
      "  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });",
      '  try {',
      '    const found = await getConversation(req.params.id);',
      "    if (!found) return res.status(404).json({ error: 'not_found' });",
      '    res.json(found);',
      '  } catch (error) {',
      "    console.error('[owner-conversations] read failed:', error.message || error);",
      "    res.status(500).json({ error: 'owner_conversations_unavailable' });",
      '  }',
      '});',
      '',
      "app.get('/api/owner/voice/:sessionKey', authRequired, async (req, res) => {",
      "  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });",
      '  try {',
      '    const found = await getVoiceCall(req.params.sessionKey);',
      "    if (!found) return res.status(404).json({ error: 'not_found' });",
      '    res.json(found);',
      '  } catch (error) {',
      "    console.error('[owner-conversations] voice read failed:', error.message || error);",
      "    res.status(500).json({ error: 'owner_conversations_unavailable' });",
      '  }',
      '});',
      '',
      '// The browser posts Realtime transcripts here as they arrive. Any signed-in',
      '// user may post their OWN turns - the userId is taken from the token, never',
      '// from the body - and the whole route is inert unless VOICE_TRANSCRIPTS=1.',
      "app.post('/api/voice/transcript', authRequired, async (req, res) => {",
      '  try {',
      '    const result = await recordVoiceTurn({',
      '      userId: req.user?.id || null,',
      '      sessionKey: req.body?.sessionKey,',
      '      role: req.body?.role,',
      '      content: req.body?.content,',
      '    });',
      '    res.json(result);',
      '  } catch (error) {',
      "    console.error('[owner-conversations] transcript post failed:', error.message || error);",
      "    res.status(500).json({ error: 'transcript_unavailable' });",
      '  }',
      '});',
      '',
    ].join('\n');
    source = source.slice(0, at) + routes + source.slice(at);
  }

  fs.writeFileSync(target, source);
  console.log('[build] Owner conversation viewer wired');
} catch (error) {
  console.warn(`[build] owner conversations patch skipped: ${error.message || error}`);
  process.exitCode = 0;
}
