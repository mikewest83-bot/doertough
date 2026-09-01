import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const visionPath = path.join(root, 'server', 'vision.mjs');
let vision = fs.readFileSync(visionPath, 'utf8');

const normalizeAnchor = `export function normalizeVisionImage(value) {
  if (!value || typeof value !== 'object') return null;
  const dataUrl = String(value.dataUrl || '').trim();
  const mediaType = String(value.mediaType || '').trim().toLowerCase();
  if (!dataUrl || !ALLOWED_TYPES.has(mediaType)) fail('vision_image_type_invalid', 400);
  const prefix = \`data:\${mediaType};base64,\`;
  if (!dataUrl.startsWith(prefix)) fail('vision_image_encoding_invalid', 400);
  if (dataUrl.length > MAX_DATA_URL_CHARS) fail('vision_image_too_large', 413);
  const base64 = dataUrl.slice(prefix.length);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) fail('vision_image_encoding_invalid', 400);
  return { dataUrl, mediaType };
}`;
const normalizeArrayFn = `
const MAX_WALKAROUND_IMAGES = 8;
export function normalizeVisionImages(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  if (!list.length) return [];
  if (list.length > MAX_WALKAROUND_IMAGES) fail('vision_too_many_images', 400);
  return list.map((item) => normalizeVisionImage(item));
}
`;
if (!vision.includes('normalizeVisionImages')) {
  if (!vision.includes(normalizeAnchor)) throw new Error('[patch-vision-video-walkaround] normalizeVisionImage anchor not found');
  vision = vision.replace(normalizeAnchor, normalizeAnchor + normalizeArrayFn);
}

const contentOld = `export function visionContent(message, image) {
  const content = [{ type: 'input_text', text: String(message || '') }];
  if (image) content.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' });
  return content;
}`;
const contentNew = `export function visionContent(message, images, detail = 'auto') {
  const list = Array.isArray(images) ? images : (images ? [images] : []);
  const content = [{ type: 'input_text', text: String(message || '') }];
  for (const img of list) content.push({ type: 'input_image', image_url: img.dataUrl, detail });
  return content;
}`;
if (vision.includes(contentOld)) vision = vision.replace(contentOld, contentNew);
else if (!vision.includes(contentNew)) throw new Error('[patch-vision-video-walkaround] visionContent anchor not found');

const routeDeclOld = `    const image = normalizeVisionImage(req.body?.image);
    const prompt = String(req.body?.prompt || 'What do you see in this photo?').trim().slice(0, 4000);
    if (!image) return res.status(400).json({ error: 'image_required', message: 'Mike needs a photo to look at.' });`;
const routeDeclNew = `    const images = normalizeVisionImages(req.body?.images ?? req.body?.image);
    const userNote = String(req.body?.description || '').trim().slice(0, 500);
    const prompt = String(req.body?.prompt || 'What do you see in this photo?').trim().slice(0, 4000);
    if (!images.length) return res.status(400).json({ error: 'image_required', message: 'Mike needs a photo or video to look at.' });`;
if (vision.includes(routeDeclOld)) vision = vision.replace(routeDeclOld, routeDeclNew);
else if (!vision.includes(routeDeclNew)) throw new Error('[patch-vision-video-walkaround] route declaration anchor not found');

const appraiseCallOld = '      const appraisal = await appraiseImage(image);';
const appraiseCallNew = '      const appraisal = await appraiseImage(images, userNote);';
if (vision.includes(appraiseCallOld)) vision = vision.replace(appraiseCallOld, appraiseCallNew);
else if (!vision.includes(appraiseCallNew)) throw new Error('[patch-vision-video-walkaround] appraise call anchor not found');

const plainCallOld = `    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(prompt, image) }],
      max_output_tokens: 700,
    });`;
const plainCallNew = `    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(prompt, images) }],
      max_output_tokens: 700,
    });`;
if (vision.includes(plainCallOld)) vision = vision.replace(plainCallOld, plainCallNew);
else if (!vision.includes(plainCallNew)) throw new Error('[patch-vision-video-walkaround] plain call anchor not found');

const appraiseFnOld = `export async function appraiseImage(image) {
  if (!openai || !image) return { description: '', identified: null, valuation: null, text: appraisalText(null, null) };

  let raw = '';
  try {
    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(APPRAISE_PROMPT, image) }],
      max_output_tokens: 700,
    });
    raw = String(response.output_text || '').trim();
  } catch (error) {`;
const appraiseFnNew = `export async function appraiseImage(images, userNote = '') {
  const imageList = Array.isArray(images) ? images : (images ? [images] : []);
  if (!openai || !imageList.length) return { description: '', identified: null, valuation: null, text: appraisalText(null, null) };
  const extraLines = [];
  if (imageList.length > 1) extraLines.push(\`\\n\\nThese are \${imageList.length} frames from a walkaround video of ONE item, shown in order. Use all of them together: judge condition, wear, and damage from whichever angle shows it best, and do not repeat the same observation for each frame. If frames disagree (e.g. a defect visible in only one), mention it - that is real information, not noise.\`);
  if (userNote) extraLines.push(\`\\n\\nThe person also told you this about the item - treat it as ground truth for facts stated (exact model, age, known issues, accessories included), but do not let it override something the photo plainly shows is different: "\${userNote}"\`);
  const fullPrompt = APPRAISE_PROMPT + extraLines.join('');

  let raw = '';
  try {
    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(fullPrompt, imageList, 'high') }],
      max_output_tokens: 1600,
    });
    raw = String(response.output_text || '').trim();
  } catch (error) {`;
if (vision.includes(appraiseFnOld)) vision = vision.replace(appraiseFnOld, appraiseFnNew);
else if (!vision.includes('export async function appraiseImage(images, userNote')) throw new Error('[patch-vision-video-walkaround] appraiseImage anchor not found');

const descOld = "        description: identified.identifiers || undefined,";
const descNew = "        description: [userNote, identified.identifiers].filter(Boolean).join('; ') || undefined,";
if (vision.includes(descOld)) vision = vision.replace(descOld, descNew);
else if (!vision.includes(descNew)) throw new Error('[patch-vision-video-walkaround] analyzeDeal description anchor not found');
fs.writeFileSync(visionPath, vision);

const mainPath = path.join(root, 'src', 'main.jsx');
let main = fs.readFileSync(mainPath, 'utf8');
const stateAnchor = "  const [checkoutNotice, setCheckoutNotice] = useState('');";
const stateLine = "  const [photoNote, setPhotoNote] = useState('');";
if (!main.includes(stateLine)) {
  if (!main.includes(stateAnchor)) throw new Error('[patch-vision-video-walkaround] checkoutNotice state anchor not found');
  main = main.replace(stateAnchor, `${stateAnchor}\n${stateLine}`);
}
const refAnchor = "  const photoInputRef = useRef(null);";
const refLine = "  const videoInputRef = useRef(null);";
if (!main.includes(refLine)) {
  if (!main.includes(refAnchor)) throw new Error('[patch-vision-video-walkaround] photoInputRef anchor not found');
  main = main.replace(refAnchor, `${refAnchor}\n${refLine}`);
}

const photoBodyOld = "        body: JSON.stringify({ image: { dataUrl, mediaType: file.type.toLowerCase() }, mode: 'appraise', prompt: 'What is this? Describe it briefly — brand, model number, type of item, and any visible wear or damage. Two or three sentences.' })";
const photoBodyNew = "        body: JSON.stringify({ image: { dataUrl, mediaType: file.type.toLowerCase() }, mode: 'appraise', description: photoNote, prompt: 'What is this? Describe it briefly — brand, model number, type of item, and any visible wear or damage. Two or three sentences.' })";
if (main.includes(photoBodyOld)) main = main.replace(photoBodyOld, photoBodyNew);
else if (!main.includes('description: photoNote, prompt:')) throw new Error('[patch-vision-video-walkaround] photo body anchor not found');

const handlerAnchor = "  const openPhotoPicker = () => { photoInputRef.current?.click(); };";
const videoHandlers = `
  const extractVideoFrames = (file, frameCount = 5) => new Promise((resolve, reject) => {
    const videoEl = document.createElement('video'); videoEl.preload = 'auto'; videoEl.muted = true; videoEl.playsInline = true;
    const url = URL.createObjectURL(file); videoEl.src = url;
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('That video took too long to read.')); }, 20000);
    videoEl.onloadedmetadata = async () => {
      try {
        const duration = videoEl.duration; if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read that video.');
        const maxDim = 1024; const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth || maxDim, videoEl.videoHeight || maxDim));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round((videoEl.videoWidth || maxDim) * scale)); canvas.height = Math.max(1, Math.round((videoEl.videoHeight || maxDim) * scale));
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not prepare that video.');
        const seekTo = (t) => new Promise((res) => { videoEl.onseeked = () => res(); videoEl.currentTime = t; });
        const points = Array.from({ length: frameCount }, (_, i) => (duration * (i + 0.5)) / frameCount); const frames = [];
        for (const t of points) { await seekTo(Math.min(t, Math.max(duration - 0.05, 0))); ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height); frames.push(canvas.toDataURL('image/jpeg', 0.7)); }
        clearTimeout(timeout); cleanup(); resolve(frames);
      } catch (err) { clearTimeout(timeout); cleanup(); reject(err); }
    };
    videoEl.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('Could not read that video.')); };
  });
  const handleVideoChange = async (event) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (!file.type.startsWith('video/')) { setError('Please choose a video file.'); return; }
    if (file.size > 60 * 1024 * 1024) { setError('That video is too large - keep walkaround videos under 60 MB.'); return; }
    setBusy(true); setError('');
    try {
      const frameUrls = await extractVideoFrames(file, 5); const images = frameUrls.map((dataUrl) => ({ dataUrl, mediaType: 'image/jpeg' }));
      const data = await fetchJson('/api/vision/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ images, mode: 'appraise', description: photoNote, prompt: 'These are frames from a walkaround video of one item. Describe it, judge condition from all angles shown, and note any damage or wear visible in any frame.' }) }, 90000);
      const text = String(data.text || '').trim(); if (!text) throw new Error('Mike could not get an answer from the video.');
      setPhotoNote(''); setMessages((prev) => [...prev, { role: 'user', text: '🎥 Sent Mike a walkaround video for a deal analysis' }, { role: 'mike', text }]);
    } catch (err) {
      if (err?.status === 401) { setAuthMode('login'); setAuthError('Sign in to use Mike Vision.'); setAuthOpen(true); } else setError(err?.message || 'Mike could not analyze that video.');
    } finally { setBusy(false); }
  };
`;
if (!main.includes('extractVideoFrames')) {
  if (!main.includes(handlerAnchor)) throw new Error('[patch-vision-video-walkaround] openPhotoPicker anchor not found');
  main = main.replace(handlerAnchor, handlerAnchor + videoHandlers);
}

const tabRowOld = `      <div className="vision-tab-row">
        <button type="button" className="vision-tab-btn" onClick={() => openPhotoPicker('identify')} disabled={busy} aria-label="Get more info from a photo">📷 More Info</button>
        <button type="button" className="vision-tab-btn vision-tab-primary" onClick={() => openPhotoPicker('appraise')} disabled={busy} aria-label="Get a deal analysis from a photo">💰 Deal Analysis</button>
      </div>`;
const tabRowNew = `      <input type="text" className="vision-note-input" value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} placeholder="Add details Mike should know (optional) — model number, known issues, age" maxLength={300} disabled={busy} />
      <input ref={videoInputRef} type="file" accept="video/*" capture="environment" onChange={handleVideoChange} style={{ display: 'none' }} aria-hidden="true" />
      <div className="vision-tab-row">
        <button type="button" className="vision-tab-btn" onClick={() => openPhotoPicker('identify')} disabled={busy} aria-label="Get more info from a photo">📷 More Info</button>
        <button type="button" className="vision-tab-btn vision-tab-primary" onClick={() => openPhotoPicker('appraise')} disabled={busy} aria-label="Get a deal analysis from a photo">💰 Deal Analysis</button>
        <button type="button" className="vision-tab-btn vision-tab-primary" onClick={() => videoInputRef.current?.click()} disabled={busy} aria-label="Get a deal analysis from a walkaround video">🎥 Video Walkaround</button>
      </div>`;
if (main.includes(tabRowOld)) main = main.replace(tabRowOld, tabRowNew);
else if (!main.includes('Video Walkaround')) throw new Error('[patch-vision-video-walkaround] tab row anchor not found');
fs.writeFileSync(mainPath, main);

const stylePath = path.join(root, 'src', 'style.css'); let styles = fs.readFileSync(stylePath, 'utf8');
if (!styles.includes('/* Mike Vision: optional note input')) styles += `
/* Mike Vision: optional note input above the photo/video tabs */
.vision-note-input{width:min(560px,88%);margin:14px auto 0;padding:12px 16px;border:1px solid #2c3941;border-radius:999px;background:#0d0d0d;color:#fff;font-size:13.5px}
.vision-note-input:focus{border-color:#27a9ff88;box-shadow:0 0 0 3px #27a9ff18;outline:0}
@media(max-width:760px){.vision-note-input{width:calc(100% - 32px);max-width:560px}}
`;
fs.writeFileSync(stylePath, styles);
console.log('[patch-vision-video-walkaround] video walkaround + optional note wired');
