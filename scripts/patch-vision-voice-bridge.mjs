import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const marker = "  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000);";
const legacy = "      dc.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));";
const safe = "      dc.send(JSON.stringify({ type: 'response.create', response: {} }));";

// Keep the Vision bridge compatible with the current Realtime event schema.
if (source.includes(legacy)) source = source.replaceAll(legacy, safe);

const bridge = `  useEffect(() => {
    const onVisionResult = (event) => {
      const text = String(event.detail?.text || '').trim();
      if (!text) return;
      const dc = conversationRef.current?.dataChannel;
      if (!dc || dc.readyState !== 'open') {
        setMessages((prev) => [...prev, { role: 'user', text: 'I uploaded a photo for you to look at.' }, { role: 'mike', text }]);
        return;
      }
      try {
        setMessages((prev) => [...prev, { role: 'user', text: 'I uploaded a photo for you to look at.' }]);
        const context = 'The user uploaded a photo and Mike Vision analyzed it. Treat the following as visual context and answer naturally using it. Vision analysis: ' + text;
        dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: context }] } }));
        dc.send(JSON.stringify({ type: 'response.create', response: {} }));
      } catch (err) { console.warn('[vision] voice bridge failed:', err); setMessages((prev) => [...prev, { role: 'mike', text }]); }
    };
    window.addEventListener('mike-vision-result', onVisionResult);
    return () => window.removeEventListener('mike-vision-result', onVisionResult);
  }, []);
`;

if (!source.includes("mike-vision-result")) {
  if (!source.includes(marker)) throw new Error('Vision voice bridge anchor not found');
  source = source.replace(marker, bridge + marker);
}

fs.writeFileSync(target, source);
console.log('[build] Vision-to-voice bridge ready');
