import fs from 'node:fs';

const path = 'server/vision.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldLine = "const DEAL_VISION_MODEL = process.env.MIKE_VISION_MODEL_DEAL || VISION_MODEL;";
const newLine = "const DEAL_VISION_MODEL = process.env.MIKE_VISION_MODEL_DEAL || 'gpt-5.6-terra';";

if (source.includes(newLine)) {
  console.log('[patch-vision-tier-model-default] already applied');
} else if (source.includes(oldLine)) {
  source = source.replace(oldLine, newLine);
  fs.writeFileSync(path, source);
  console.log('[patch-vision-tier-model-default] Deal Analysis defaults to gpt-5.6-terra');
} else {
  throw new Error('[patch-vision-tier-model-default] DEAL_VISION_MODEL anchor not found');
}
