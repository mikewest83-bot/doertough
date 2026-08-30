import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const refAnchor = "  const voiceSessionRef = useRef(null);";
const refLine = "  const photoInputRef = useRef(null);";
if (!source.includes(refLine)) {
  if (!source.includes(refAnchor)) throw new Error('Vision UI ref anchor not found');
  source = source.replace(refAnchor, `${refAnchor}\n${refLine}`);
}

const askAnchor = "  const switchAuthMode = (mode) => { setAuthMode(mode); setAuthError(''); setAuthNotice(''); };";
const visionHandler = `  const openPhotoPicker = () => { if (conversationModeRef.current) { setError('End the voice conversation before sending a photo.'); return; } photoInputRef.current?.click(); };\n  const handlePhotoChange = async (event) => {\n    const file = event.target.files?.[0];\n    event.target.value = '';\n    if (!file) return;\n    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }\n    setBusy(true); setError('');\n    try {\n      const dataUrl = await new Promise((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onload = () => resolve(String(reader.result || ''));\n        reader.onerror = () => reject(new Error('Could not read that photo.'));\n        reader.readAsDataURL(file);\n      });\n      const mediaType = file.type.toLowerCase();\n      const data = await fetchJson('/api/vision/analyze', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', ...authHeaders() },\n        body: JSON.stringify({ image: { dataUrl, mediaType }, prompt: 'What do you see in this photo? Describe the important details clearly and naturally.' })\n      }, 60000);\n      const text = String(data.text || '').trim();\n      if (!text) throw new Error('Mike could not get an answer from the photo.');\n      window.dispatchEvent(new CustomEvent('mike-vision-result', { detail: { text } }));\n    } catch (err) {\n      if (err?.status === 401) { setAuthMode('login'); setAuthError('Sign in to use Mike Vision.'); setAuthOpen(true); }\n      else setError(err?.message || 'Mike could not analyze that photo.');\n    } finally { setBusy(false); }\n  };\n`;
if (!source.includes('const openPhotoPicker =')) {
  if (!source.includes(askAnchor)) throw new Error('Vision UI handler anchor not found');
  source = source.replace(askAnchor, visionHandler + askAnchor);
}

const oldPrompt = "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', 'Find me a way to save money.'];";
const newPrompt = "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', '📷 Ask Mike about a photo'];";
if (source.includes(oldPrompt)) source = source.replace(oldPrompt, newPrompt);

const oldMap = "{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => ask(prompt)} disabled={busy || conversationMode}>{prompt}</button>))}";
const newMap = "{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => prompt.startsWith('📷') ? openPhotoPicker() : ask(prompt)} disabled={busy || conversationMode}>{prompt}</button>))}";
if (source.includes(oldMap) && !source.includes(newMap)) source = source.replace(oldMap, newMap);

const formAnchor = "      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>";
const hiddenInput = "      <input ref={photoInputRef} type=\"file\" accept=\"image/jpeg,image/png,image/webp\" onChange={handlePhotoChange} style={{ display: 'none' }} aria-hidden=\"true\" />\n      <button type=\"button\" className=\"vision-photo-button\" onClick={openPhotoPicker} disabled={busy || conversationMode} aria-label=\"Ask Mike about a photo\">📷 Ask Mike about a photo</button>\n";
if (!source.includes('ref={photoInputRef}')) {
  if (!source.includes(formAnchor)) throw new Error('Vision UI form anchor not found');
  source = source.replace(formAnchor, hiddenInput + formAnchor);
}

// Mike Games: the standalone game UI previously looked for a stale #input DOM id,
// so clicking a game never reached the real React Mike controller. Route game
// starts through a stable event and hand them to text or an active Realtime session.
const gamesTarget = path.join(root, 'src', 'mike-games-standalone.jsx');
let games = fs.readFileSync(gamesTarget, 'utf8');
const oldGameSend = `function sendToMike(prompt) {\n  const input = document.querySelector('#input');\n  const form = input?.closest('form');\n  if (!input || !form) return false;\n  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;\n  setter?.call(input, prompt);\n  input.dispatchEvent(new Event('input', { bubbles: true }));\n  window.requestAnimationFrame(() => form.requestSubmit());\n  return true;\n}`;
const newGameSend = `function sendToMike(prompt) {\n  window.dispatchEvent(new CustomEvent('mike-game-start', { detail: { prompt } }));\n  return true;\n}`;
if (games.includes(oldGameSend)) games = games.replace(oldGameSend, newGameSend);
fs.writeFileSync(gamesTarget, games);

const gameMarker = "  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000);";
const gameBridge = `  useEffect(() => {\n    const onGameStart = (event) => {\n      const prompt = String(event.detail?.prompt || '').trim();\n      if (!prompt) return;\n      const dc = conversationRef.current?.dataChannel;\n      if (dc && dc.readyState === 'open') {\n        try {\n          dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }));\n          dc.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));\n          setMessages((prev) => [...prev, { role: 'user', text: prompt }]);\n        } catch (err) { console.warn('[games] realtime handoff failed:', err); }\n        return;\n      }\n      ask(prompt);\n    };\n    window.addEventListener('mike-game-start', onGameStart);\n    return () => window.removeEventListener('mike-game-start', onGameStart);\n  }, [ask]);\n`;
if (!source.includes("window.addEventListener('mike-game-start'")) {
  if (!source.includes(gameMarker)) throw new Error('Games voice bridge anchor not found');
  source = source.replace(gameMarker, gameBridge + gameMarker);
}

fs.writeFileSync(target, source);
console.log('[build] Photo CTA wired to Mike Vision; Mike Games wired to text and active Realtime voice');
