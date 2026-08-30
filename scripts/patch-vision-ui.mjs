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
const visionHandler = `  const openPhotoPicker = () => { photoInputRef.current?.click(); };\n  const handlePhotoChange = async (event) => {\n    const file = event.target.files?.[0];\n    event.target.value = '';\n    if (!file) return;\n    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }\n    setBusy(true); setError('');\n    try {\n      const dataUrl = await new Promise((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onload = () => resolve(String(reader.result || ''));\n        reader.onerror = () => reject(new Error('Could not read that photo.'));\n        reader.readAsDataURL(file);\n      });\n      const mediaType = file.type.toLowerCase();\n      const visionPrompt = 'Identify what is in this photo as precisely as you can. Give the item type, brand, model or model number, year if visible, condition, and any readable text, labels, or serial numbers. Note visible damage, wear, or missing parts. Do not estimate price, value, resale range, or what it is worth.';\n      const data = await fetchJson('/api/vision/analyze', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', ...authHeaders() },\n        body: JSON.stringify({ image: { dataUrl, mediaType }, prompt: visionPrompt })\n      }, 60000);\n      const text = String(data.text || '').trim();\n      if (!text) throw new Error('Mike could not get an answer from the photo.');\n      window.dispatchEvent(new CustomEvent('mike-vision-result', { detail: { text } }));\n    } catch (err) {\n      if (err?.status === 401) { setAuthMode('login'); setAuthError('Sign in to use Mike Vision.'); setAuthOpen(true); }\n      else setError(err?.message || 'Mike could not analyze that photo.');\n    } finally { setBusy(false); }\n  };\n`;
if (!source.includes('const openPhotoPicker =')) {
  if (!source.includes(askAnchor)) throw new Error('Vision UI handler anchor not found');
  source = source.replace(askAnchor, visionHandler + askAnchor);
}

// Keep the main Mike starter prompts focused on conversation. Vision gets one dedicated CTA below the composer.
source = source.replace(
  "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', '📷 Ask Mike about a photo'];",
  "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.'];"
);

const oldPrompt = "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', 'Find me a way to save money.'];";
const newPrompt = "const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.'];";
if (source.includes(oldPrompt)) source = source.replace(oldPrompt, newPrompt);

const oldMap = "{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => ask(prompt)} disabled={busy || conversationMode}>{prompt}</button>))}";
const newMap = "{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => ask(prompt)} disabled={busy || conversationMode}>{prompt}</button>))}";
if (source.includes(oldMap) && !source.includes(newMap)) source = source.replace(oldMap, newMap);

const formAnchor = "      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>";
const hiddenInput = "      <input ref={photoInputRef} type=\"file\" accept=\"image/jpeg,image/png,image/webp\" onChange={handlePhotoChange} style={{ display: 'none' }} aria-hidden=\"true\" />\n      <button type=\"button\" className=\"vision-photo-button\" onClick={openPhotoPicker} disabled={busy} aria-label=\"Ask Mike about a photo\">📷 Ask Mike about a photo</button>\n";
if (!source.includes('ref={photoInputRef}')) {
  if (!source.includes(formAnchor)) throw new Error('Vision UI form anchor not found');
  source = source.replace(formAnchor, hiddenInput + formAnchor);
}

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

// Defensive mobile layout fixes for the controls shown in production screenshots.
const styleTarget = path.join(root, 'src', 'style.css');
let styles = fs.readFileSync(styleTarget, 'utf8');
const visionCss = `\n/* Mike Vision CTA + mobile containment */\n.vision-photo-button{width:min(560px,88%);min-height:54px;margin:14px auto 0;padding:12px 18px;border:1px solid #27a9ff66;border-radius:999px;background:#0c151d;color:#dbe7ef;display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:750;letter-spacing:.02em;box-shadow:0 0 0 1px #27a9ff12,0 10px 28px #0008}\n.vision-photo-button:hover{border-color:#27a9ff;background:#0e1b25}\n.vision-photo-button:disabled{opacity:.45}\n@media(max-width:760px){html,body{width:100%;max-width:100%;overflow-x:hidden}main{width:100%;max-width:100%;min-width:0;overflow-x:hidden}.voice-box{width:100%;max-width:100%;min-width:0}.voice-puck{width:calc(100% - 32px);max-width:560px}.vision-photo-button{width:calc(100% - 32px);max-width:560px;font-size:13px}}\n`;
if (!styles.includes('/* Mike Vision CTA + mobile containment */')) {
  styles += visionCss;
  fs.writeFileSync(styleTarget, styles);
}

fs.writeFileSync(target, source);
console.log('[build] Vision has one dedicated CTA; mobile Mike controls are contained; main Mike experience preserved');
