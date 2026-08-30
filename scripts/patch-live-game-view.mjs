import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

// Keep the live visual frame in a single replaceable Realtime conversation item.
// Frames are sampled by MikeLiveGameView; the latest frame is what Mike sees when
// the user speaks. This avoids building an ever-growing image history.
const refAnchor = "  const voiceSessionRef = useRef(null);";
const refLine = "  const liveGameFrameRef = useRef(null);";
if (!source.includes(refLine)) {
  if (!source.includes(refAnchor)) throw new Error('Live game ref anchor not found');
  source = source.replace(refAnchor, `${refAnchor}\n${refLine}`);
}

const effectMarker = "  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000);";
const liveBridge = `  useEffect(() => {\n    const onLiveGameFrame = (event) => {\n      const imageUrl = String(event.detail?.imageUrl || '').trim();\n      const dc = conversationRef.current?.dataChannel;\n      if (!imageUrl || !dc || dc.readyState !== 'open') return;\n      try {\n        const previousId = liveGameFrameRef.current;\n        if (previousId) dc.send(JSON.stringify({ type: 'conversation.item.delete', item_id: previousId }));\n        const id = 'live_game_frame_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);\n        dc.send(JSON.stringify({\n          type: 'conversation.item.create',\n          item: {\n            id,\n            type: 'message',\n            role: 'user',\n            content: [\n              { type: 'input_text', text: 'LIVE GAME VIEW: This is the latest visual frame from the live game the user is watching. Treat it as current visual context. Do not ask the user to repeat what game they are watching. When visible, track the score, clock, possession, players, and meaningful changes. Do not claim details that are not visible.' },\n              { type: 'input_image', image_url: imageUrl, detail: 'auto' }\n            ]\n          }\n        }));\n        liveGameFrameRef.current = id;\n      } catch (err) { console.warn('[live-game] frame handoff failed:', err); }\n    };\n    window.addEventListener('mike-live-game-frame', onLiveGameFrame);\n    return () => window.removeEventListener('mike-live-game-frame', onLiveGameFrame);\n  }, []);\n\n  useEffect(() => {\n    const onGameStart = (event) => {\n      const prompt = String(event.detail?.prompt || '').trim();\n      if (!prompt) return;\n      const dc = conversationRef.current?.dataChannel;\n      if (dc && dc.readyState === 'open') {\n        try {\n          dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }));\n          dc.send(JSON.stringify({ type: 'response.create', response: {} }));\n          setMessages((prev) => [...prev, { role: 'user', text: prompt }]);\n        } catch (err) { console.warn('[games] realtime handoff failed:', err); }\n        return;\n      }\n      ask(prompt);\n    };\n    window.addEventListener('mike-game-start', onGameStart);\n    return () => window.removeEventListener('mike-game-start', onGameStart);\n  }, [ask]);\n`;
if (!source.includes("window.addEventListener('mike-live-game-frame'")) {
  if (!source.includes(effectMarker)) throw new Error('Live game effect anchor not found');
  source = source.replace(effectMarker, liveBridge + effectMarker);
}

// Make the standalone game launcher work with the real React controller and an
// already-open Realtime session instead of trying to manipulate a stale DOM id.
fs.writeFileSync(target, source);
console.log('[build] Mike Live Game View connected to Realtime vision and game voice handoff');
