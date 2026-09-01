import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server/index.mjs');
let source = fs.readFileSync(file, 'utf8');

const brainImport = "import { generateBrainResponse, getBrainStatus } from './brain-router.mjs';";

// Normalize any previous brain-router mutations before applying the canonical form.
source = source.replace(/^import \{ generateBrainResponse, getBrainStatus \} from '\.\/brain-router\.mjs';\n/gm, '');
source = source.replace(/\n{2,}/g, '\n\n');

const ownerImport = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
if (!source.includes(ownerImport)) {
  throw new Error('[patch-brain-router] owner-only tools import not found');
}
source = source.replace(ownerImport, `${ownerImport}\n${brainImport}`);

source = source.replace(
  /const OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| '[^']+';/,
  "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';",
);

const healthModel = "    model: OPENAI_MODEL,\n    timestamp: new Date().toISOString(),";
const healthWithBrain = "    model: OPENAI_MODEL,\n    brain: getBrainStatus(),\n    timestamp: new Date().toISOString(),";
if (source.includes(healthWithBrain)) {
  // already canonical
} else if (source.includes(healthModel)) {
  source = source.replace(healthModel, healthWithBrain);
} else {
  throw new Error('[patch-brain-router] health model block not found');
}

const directCall = '      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });';
const routedCall = '      const response = await generateBrainResponse({ client: openai, instructions, input, tools, message });';
if (source.includes(routedCall)) {
  // already canonical
} else if (source.includes(directCall)) {
  source = source.replace(directCall, routedCall);
} else {
  throw new Error('[patch-brain-router] direct OpenAI response call not found');
}

fs.writeFileSync(file, source);
console.log('[patch-brain-router] brain router wired idempotently');
