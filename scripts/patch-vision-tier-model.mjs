import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- server/vision.mjs: a second, better model reserved for Deal Analysis ----
// MIKE_VISION_MODEL stays the cheap "More Info" model (gpt-4o-mini).
// MIKE_VISION_MODEL_DEAL is a separate Railway variable for the pricing path only,
// so the extra cost is spent exactly where reading a model number off a nameplate
// actually matters. Falls back to MIKE_VISION_MODEL if unset - safe either way.
const visionPath = path.join(root, 'server', 'vision.mjs');
let vision = fs.readFileSync(visionPath, 'utf8');

const modelAnchor = "const VISION_MODEL = process.env.MIKE_VISION_MODEL || 'gpt-4o-mini';";
const modelLine = "const DEAL_VISION_MODEL = process.env.MIKE_VISION_MODEL_DEAL || VISION_MODEL;";
if (!vision.includes(modelLine)) {
  if (!vision.includes(modelAnchor)) throw new Error('[patch-vision-tier-model] VISION_MODEL anchor not found');
  vision = vision.replace(modelAnchor, `${modelAnchor}\n${modelLine}`);
}

// This targets the appraiseImage() call specifically (identified by the
// APPRAISE_PROMPT + 'high' detail argument added by patch-vision-detail-extraction.mjs,
// which runs before this script). The plain analyzeVisionImage() describe path is
// untouched and keeps using the cheap VISION_MODEL.
const appraiseCallOld = "      model: VISION_MODEL,\n      input: [{ role: 'user', content: visionContent(APPRAISE_PROMPT, image, 'high') }],";
const appraiseCallNew = "      model: DEAL_VISION_MODEL,\n      input: [{ role: 'user', content: visionContent(APPRAISE_PROMPT, image, 'high') }],";
if (vision.includes(appraiseCallOld)) {
  vision = vision.replace(appraiseCallOld, appraiseCallNew);
} else if (!vision.includes(appraiseCallNew)) {
  throw new Error('[patch-vision-tier-model] appraiseImage model call anchor not found - check patch-vision-detail-extraction.mjs output shape');
}

fs.writeFileSync(visionPath, vision);

// ---- src/main.jsx: two clickable tabs - More Info (cheap ID) vs Deal Analysis (priced) ----
const mainPath = path.join(root, 'src', 'main.jsx');
let main = fs.readFileSync(mainPath, 'utf8');

const refAnchor = "  const photoInputRef = useRef(null);";
const refLine = "  const photoModeRef = useRef('appraise');";
if (!main.includes(refLine)) {
  if (!main.includes(refAnchor)) throw new Error('[patch-vision-tier-model] photoInputRef anchor not found');
  main = main.replace(refAnchor, `${refAnchor}\n${refLine}`);
}

const openOld = "  const openPhotoPicker = () => { photoInputRef.current?.click(); };";
const openNew = "  const openPhotoPicker = (mode = 'appraise') => { photoModeRef.current = mode; photoInputRef.current?.click(); };";
if (main.includes(openOld)) main = main.replace(openOld, openNew);
else if (!main.includes(openNew)) throw new Error('[patch-vision-tier-model] openPhotoPicker anchor not found');

const fetchOld = "      const data = await fetchJson('/api/vision/analyze', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', ...authHeaders() },\n        body: JSON.stringify({ image: { dataUrl, mediaType: file.type.toLowerCase() }, mode: 'appraise', prompt: 'What is this? Describe it briefly — brand, model number, type of item, and any visible wear or damage. Two or three sentences.' })\n      }, 60000);";
const fetchNew = "      const useAppraisal = photoModeRef.current !== 'identify';\n      const data = await fetchJson('/api/vision/analyze', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', ...authHeaders() },\n        body: JSON.stringify(useAppraisal\n          ? { image: { dataUrl, mediaType: file.type.toLowerCase() }, mode: 'appraise', prompt: 'What is this? Describe it briefly — brand, model number, type of item, and any visible wear or damage. Two or three sentences.' }\n          : { image: { dataUrl, mediaType: file.type.toLowerCase() }, prompt: 'Identify what is in this photo as precisely as you can. Give the item type, brand, model or model number, condition, and any readable text, labels, or serial numbers. Do not estimate price, value, resale range, or what it is worth. Two or three sentences.' })\n      }, 60000);";
if (main.includes(fetchOld)) main = main.replace(fetchOld, fetchNew);
else if (!main.includes(fetchNew)) throw new Error('[patch-vision-tier-model] photo fetchJson anchor not found');

const pushOld = "      setMessages((prev) => [...prev, { role: 'user', text: '📷 Asked Mike what a photo is worth' }, { role: 'mike', text }]);";
const pushNew = "      setMessages((prev) => [...prev, { role: 'user', text: useAppraisal ? '📷 Asked Mike what a photo is worth' : '📷 Asked Mike for more info on a photo' }, { role: 'mike', text }]);";
if (main.includes(pushOld)) main = main.replace(pushOld, pushNew);
else if (!main.includes(pushNew)) throw new Error('[patch-vision-tier-model] photo message push anchor not found');

// The old single bottom button was removed by patch-remove-duplicate-photo-button.mjs
// earlier in the build chain (confirmed live 2026-09-01 - the production build currently
// has NO visible photo trigger at all, chip and button both gone). This restores an
// entry point as two buttons instead of one.
const inputAnchor = "      <input ref={photoInputRef} type=\"file\" accept=\"image/jpeg,image/png,image/webp\" onChange={handlePhotoChange} style={{ display: 'none' }} aria-hidden=\"true\" />";
const tabRow = "\n      <div className=\"vision-tab-row\">\n        <button type=\"button\" className=\"vision-tab-btn\" onClick={() => openPhotoPicker('identify')} disabled={busy} aria-label=\"Get more info from a photo\">📷 More Info</button>\n        <button type=\"button\" className=\"vision-tab-btn vision-tab-primary\" onClick={() => openPhotoPicker('appraise')} disabled={busy} aria-label=\"Get a deal analysis from a photo\">💰 Deal Analysis</button>\n      </div>";
if (!main.includes('vision-tab-row')) {
  if (!main.includes(inputAnchor)) throw new Error('[patch-vision-tier-model] photo input anchor not found');
  main = main.replace(inputAnchor, inputAnchor + tabRow);
}

fs.writeFileSync(mainPath, main);

// ---- src/style.css: tab button styling ----
const stylePath = path.join(root, 'src', 'style.css');
let styles = fs.readFileSync(stylePath, 'utf8');
const tabCss = `
/* Mike Vision tier buttons: More Info (cheap ID) vs Deal Analysis (priced) */
.vision-tab-row{display:flex;gap:10px;width:min(560px,88%);margin:14px auto 0}
.vision-tab-btn{flex:1;min-height:54px;padding:12px 16px;border:1px solid #27a9ff66;border-radius:999px;background:#0c151d;color:#dbe7ef;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13.5px;font-weight:750;letter-spacing:.02em}
.vision-tab-btn:hover{border-color:#27a9ff;background:#0e1b25}
.vision-tab-btn:disabled{opacity:.45}
.vision-tab-primary{border-color:#f26b21aa;background:#1a1109}
.vision-tab-primary:hover{border-color:#f26b21}
@media(max-width:760px){.vision-tab-row{width:calc(100% - 32px);max-width:560px;flex-direction:column}.vision-tab-btn{font-size:13px}}
`;
if (!styles.includes('/* Mike Vision tier buttons')) {
  styles += tabCss;
  fs.writeFileSync(stylePath, styles);
}

console.log('[patch-vision-tier-model] Deal Analysis uses MIKE_VISION_MODEL_DEAL (falls back to MIKE_VISION_MODEL); More Info + Deal Analysis tabs wired');
