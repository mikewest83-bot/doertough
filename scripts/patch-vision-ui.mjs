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
const visionHandler = `  const openPhotoPicker = () => { if (conversationModeRef.current) { setError('End the voice conversation before sending a photo.'); return; } photoInputRef.current?.click(); };
  const handlePhotoChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }
    setBusy(true); setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read that photo.'));
        reader.readAsDataURL(file);
      });
      const mediaType = file.type.toLowerCase();
      const data = await fetchJson('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ image: { dataUrl, mediaType }, prompt: 'What do you see in this photo? Describe the important details clearly and naturally.' })
      }, 60000);
      const text = String(data.text || '').trim();
      if (!text) throw new Error('Mike could not get an answer from the photo.');
      window.dispatchEvent(new CustomEvent('mike-vision-result', { detail: { text } }));
    } catch (err) {
      if (err?.status === 401) { setAuthMode('login'); setAuthError('Sign in to use Mike Vision.'); setAuthOpen(true); }
      else setError(err?.message || 'Mike could not analyze that photo.');
    } finally { setBusy(false); }
  };
`;
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
const hiddenInput = "      <input ref={photoInputRef} type=\"file\" accept=\"image/jpeg,image/png,image/webp\" onChange={handlePhotoChange} style={{ display: 'none' }} aria-hidden=\"true\" />\n";
if (!source.includes('ref={photoInputRef}')) {
  if (!source.includes(formAnchor)) throw new Error('Vision UI form anchor not found');
  source = source.replace(formAnchor, hiddenInput + formAnchor);
}

fs.writeFileSync(target, source);
console.log('[build] Photo CTA wired to Mike Vision');
