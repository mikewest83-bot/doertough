import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let changed = false;

const gamesTarget = path.join(root, 'src', 'mike-games-standalone.jsx');
let games = fs.readFileSync(gamesTarget, 'utf8');
const oldSend = `function sendToMike(prompt) {\n  const input = document.querySelector('#input');\n  const form = input?.closest('form');\n  if (!input || !form) return false;\n  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;\n  setter?.call(input, prompt);\n  input.dispatchEvent(new Event('input', { bubbles: true }));\n  window.requestAnimationFrame(() => form.requestSubmit());\n  return true;\n}`;
const newSend = `function sendToMike(prompt) {\n  window.dispatchEvent(new CustomEvent('mike-game-start', { detail: { prompt } }));\n  return true;\n}`;
if (games.includes(oldSend)) { games = games.replace(oldSend, newSend); changed = true; }
const oldDescription = "description: 'Five quick questions. See if you can take Mike down.',";
const newDescription = "description: 'Endless trivia. Fresh questions, one at a time. Keep playing as long as you want.',";
if (games.includes(oldDescription)) { games = games.replace(oldDescription, newDescription); changed = true; }
const oldStarter = "starter: 'Let’s play Beat Mike. Give me one trivia question at a time, keep score, and don’t go easy on me.',";
const newStarter = "starter: 'Let’s play Beat Mike. This is an endless trivia game: give me one challenging, non-repeating trivia question at a time, wait for my answer before revealing it, keep a running score, tell me my score after each round, vary the categories, and keep going until I say stop. Do not cap the game at five or any other number of questions. Don’t go easy on me.',";
if (games.includes(oldStarter)) { games = games.replace(oldStarter, newStarter); changed = true; }
if (games !== fs.readFileSync(gamesTarget, 'utf8')) fs.writeFileSync(gamesTarget, games);

const mainTarget = path.join(root, 'src', 'main.jsx');
let main = fs.readFileSync(mainTarget, 'utf8');
const marker = "  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000);";
const bridge = `  useEffect(() => {\n    const onGameStart = (event) => {\n      const prompt = String(event.detail?.prompt || '').trim();\n      if (!prompt) return;\n      const dc = conversationRef.current?.dataChannel;\n      if (dc && dc.readyState === 'open') {\n        try {\n          dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }));\n          dc.send(JSON.stringify({ type: 'response.create', response: {} }));\n          setMessages((prev) => [...prev, { role: 'user', text: prompt }]);\n        } catch (err) { console.warn('[games] realtime handoff failed:', err); }\n        return;\n      }\n      ask(prompt);\n    };\n    window.addEventListener('mike-game-start', onGameStart);\n    return () => window.removeEventListener('mike-game-start', onGameStart);\n  }, [conversationRef, ask]);\n`;
if (!main.includes("window.addEventListener('mike-game-start'")) {
  if (!main.includes(marker)) throw new Error('Games voice bridge anchor not found');
  main = main.replace(marker, bridge + marker);
  changed = true;
}
const badModalities = "response: { modalities: ['audio', 'text'] }";
if (main.includes(badModalities)) { main = main.replace(badModalities, 'response: {}'); changed = true; }
if (main !== fs.readFileSync(mainTarget, 'utf8')) fs.writeFileSync(mainTarget, main);

console.log(changed ? '[build] Mike Games voice bridge updated' : '[build] Mike Games voice bridge already clean');
