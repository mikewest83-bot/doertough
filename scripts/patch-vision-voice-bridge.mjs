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
    const visionHandoffMessage = (visionText) => 'I uploaded a photo. Mike Vision looked at it and reported:\\n\\n' + visionText + '\\n\\nTreat that as the description of the item and answer me normally. If this is about what it is worth, whether it is a good deal, or what to offer, run a real DealTough analysis instead of estimating a price yourself. If DealTough cannot establish a value, say that plainly rather than guessing a range.';
    const onVisionResult = (event) => {
      const text = String(event.detail?.text || '').trim();
      if (!text) return;
      const dc = conversationRef.current?.dataChannel;
      if (!dc || dc.readyState !== 'open') {
        setMessages((prev) => [...prev, { role: 'user', text: 'I uploaded a photo for you to look at.' }]);
        fetchJson('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ message: visionHandoffMessage(text), history: [] }) }, 55000)
          .then((data) => { const reply = String(data?.text || '').trim(); setMessages((prev) => [...prev, { role: 'mike', text: reply || text }]); })
          .catch(() => { setMessages((prev) => [...prev, { role: 'mike', text }]); });
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
console.log('[build] Vision-to-voice bridge ready with tool-enabled chat fallback');
