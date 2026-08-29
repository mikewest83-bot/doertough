import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const marker = "  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000);";
const bridge = `  useEffect(() => {\n    const onVisionResult = (event) => {\n      const text = String(event.detail?.text || '').trim();\n      if (!text) return;\n      setMessages((prev) => [...prev, { role: 'user', text: 'I uploaded a photo for you to look at.' }, { role: 'mike', text }]);\n      const dc = conversationRef.current?.dataChannel;\n      if (!dc || dc.readyState !== 'open') return;\n      try {\n        dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `The user uploaded a photo and Mike Vision analyzed it. Treat the following as your visual context and answer naturally using it. Vision analysis: ${text}` }] } }));\n        dc.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));\n      } catch (err) { console.warn('[vision] voice bridge failed:', err); }\n    };\n    window.addEventListener('mike-vision-result', onVisionResult);\n    return () => window.removeEventListener('mike-vision-result', onVisionResult);\n  }, []);\n`;

if (!source.includes("mike-vision-result")) {
  if (!source.includes(marker)) throw new Error('Vision voice bridge anchor not found');
  source = source.replace(marker, bridge + marker);
}

fs.writeFileSync(target, source);
console.log('[build] Vision-to-voice bridge ready');
