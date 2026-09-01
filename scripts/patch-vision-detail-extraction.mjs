import fs from 'node:fs';

const path = 'server/vision.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldPromptStart = "const APPRAISE_PROMPT = [";
const oldPromptEnd = "].join('\\n');";
const start = source.indexOf(oldPromptStart);
const end = source.indexOf(oldPromptEnd, start);
if (start < 0 || end < 0) throw new Error('[patch-vision-detail-extraction] appraisal prompt block not found');

const newPrompt = `const APPRAISE_PROMPT = [
  'Inspect this photo carefully and reply with ONLY one valid JSON object - no prose outside it, no code fences.',
  '{"description":"four to six concise sentences describing exactly what is visible, including the item, brand, model, notable features, visible condition, wear or damage, and anything included in the photo",',
  ' "category":"vehicle|electronics|tools|furniture|outdoor_equipment|null",',
  ' "title":"the strongest searchable product title you can support from the photo; include brand, exact model, variant and size/capacity when actually visible",',
  ' "condition":"new|like_new|good|fair|poor|unknown",',
  ' "identifiers":"all model numbers, part numbers, serial numbers, SKU-like codes, badges, labels or other readable text that could help identify the exact item",',
  ' "details":"a compact semicolon-separated list of visible specifications, variant clues, color/material, size/capacity, included accessories, features, markings, and visible defects or missing pieces",',
  ' "confidence":"high|medium|low"}',
  '',
  'Extraction rules:',
  '- Read every visible label, badge, plate, tag, screen, sticker and marking before deciding what the item is.',
  '- title: maximize searchable specificity without guessing. Include exact model/variant/size only when supported by visible evidence.',
  '- identifiers: preserve readable model and part numbers exactly when possible. Do not invent characters you cannot read.',
  '- details: capture facts that can improve a resale search: generation/series, voltage, capacity, dimensions, material, color, accessories, attachments, ports, controls, markings, and visible defects.',
  '- condition: judge only what the photo proves. Do not infer mechanical operation, battery health, hours, hidden damage or functionality.',
  '- confidence: high only when the key identification is clearly supported; medium when the item is clear but an exact model/variant is uncertain; low when the identification is mostly a guess.',
  '- If text is blurry, say so rather than hallucinating it.',
].join('\\n');`;

source = source.slice(0, start) + newPrompt + source.slice(end + oldPromptEnd.length);

const oldReturn = "    identifiers: String(parsed.identifiers || '').trim().slice(0, 200),\n    confidence: ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low',";
const newReturn = "    identifiers: String(parsed.identifiers || '').trim().slice(0, 300),\n    details: String(parsed.details || '').trim().slice(0, 700),\n    confidence: ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low',";
if (!source.includes(oldReturn) && !source.includes(newReturn)) throw new Error('[patch-vision-detail-extraction] parse fields block not found');
source = source.replace(oldReturn, newReturn);

const oldDescriptionLine = "  const parts = [`I make that ${item}${identified.identifiers ? ` (${identified.identifiers})` : ''}.`];";
const newDescriptionLine = "  const parts = [`I make that ${item}${identified.identifiers ? ` (${identified.identifiers})` : ''}.`];\n  if (identified.details) parts.push(`What I can see: ${identified.details}.`);";
if (!source.includes(newDescriptionLine)) {
  if (!source.includes(oldDescriptionLine)) throw new Error('[patch-vision-detail-extraction] appraisal output anchor not found');
  source = source.replace(oldDescriptionLine, newDescriptionLine);
}

const oldPricing = "        description: identified.identifiers || undefined,";
const newPricing = "        description: [identified.identifiers, identified.details].filter(Boolean).join('; ') || undefined,";
if (source.includes(oldPricing)) source = source.replace(oldPricing, newPricing);

const oldVisionContent = "export function visionContent(message, image) {\n  const content = [{ type: 'input_text', text: String(message || '') }];\n  if (image) content.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' });\n  return content;\n}";
const newVisionContent = "export function visionContent(message, image, detail = 'auto') {\n  const content = [{ type: 'input_text', text: String(message || '') }];\n  if (image) content.push({ type: 'input_image', image_url: image.dataUrl, detail });\n  return content;\n}";
if (source.includes(oldVisionContent)) source = source.replace(oldVisionContent, newVisionContent);

const oldAppraiseInput = "content: visionContent(APPRAISE_PROMPT, image)";
const newAppraiseInput = "content: visionContent(APPRAISE_PROMPT, image, 'high')";
if (source.includes(oldAppraiseInput)) source = source.replace(oldAppraiseInput, newAppraiseInput);

const oldTokens = "      max_output_tokens: 700,\n    });\n    raw = String(response.output_text || '').trim();";
const newTokens = "      max_output_tokens: 1600,\n    });\n    raw = String(response.output_text || '').trim();";
if (source.includes(oldTokens)) source = source.replace(oldTokens, newTokens);

fs.writeFileSync(path, source);
console.log('[patch-vision-detail-extraction] applied');
