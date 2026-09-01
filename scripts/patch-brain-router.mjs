import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server/index.mjs');
let source = fs.readFileSync(file, 'utf8');

const brainImport = "import { generateBrainResponse, getBrainStatus } from './brain-router.mjs';";
const ownerImport = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
const targetModel = "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';";
const healthModel = "    model: OPENAI_MODEL,\n    timestamp: new Date().toISOString(),";
const healthWithBrain = "    model: OPENAI_MODEL,\n    brain: getBrainStatus(),\n    timestamp: new Date().toISOString(),";
const directCall = '      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });';
const routedCall = '      const response = await generateBrainResponse({ client: openai, instructions, input, tools, message });';

// Fast path: if the canonical wiring is already present, make no write at all.
// This is what guarantees the production build remains byte-for-byte idempotent.
if (
  source.includes(brainImport) &&
  source.includes(targetModel) &&
  source.includes(healthWithBrain) &&
  source.includes(routedCall)
) {
  console.log('[patch-brain-router] canonical wiring already present; no changes');
  process.exit(0);
}

if (!source.includes(ownerImport)) {
  throw new Error('[patch-brain-router] owner-only tools import not found');
}

// Remove only an existing brain import; do not normalize unrelated whitespace.
source = source.replace(/^import \{ generateBrainResponse, getBrainStatus \} from '\.\/brain-router\.mjs';\n?/m, '');
if (!source.includes(brainImport)) {
  source = source.replace(ownerImport, `${ownerImport}\n${brainImport}`);
}

source = source.replace(
  /const OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| '[^']+';/,
  targetModel,
);

if (!source.includes(healthWithBrain)) {
  if (!source.includes(healthModel)) {
    throw new Error('[patch-brain-router] health model block not found');
  }
  source = source.replace(healthModel, healthWithBrain);
}

if (!source.includes(routedCall)) {
  if (!source.includes(directCall)) {
    throw new Error('[patch-brain-router] direct OpenAI response call not found');
  }
  source = source.replace(directCall, routedCall);
}

fs.writeFileSync(file, source);
console.log('[patch-brain-router] brain router wired idempotently');
