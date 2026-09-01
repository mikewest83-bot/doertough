import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = path.join(root, 'server/index.mjs');
const routerFile = path.join(root, 'server/brain-router.mjs');
let source = fs.readFileSync(indexFile, 'utf8');
const router = fs.readFileSync(routerFile, 'utf8');

const brainImport = "import { generateBrainResponse, getBrainStatus } from './brain-router.mjs';";
const ownerImport = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
const targetModel = "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';";
const healthModel = "    model: OPENAI_MODEL,\n    timestamp: new Date().toISOString(),";
const healthWithBrain = "    model: OPENAI_MODEL,\n    brain: getBrainStatus(),\n    timestamp: new Date().toISOString(),";
const directCall = '      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });';
const routedCall = '      const response = await generateBrainResponse({ client: openai, instructions, input, tools, message });';

const indexAlreadyCanonical = source.includes(brainImport) && source.includes(targetModel) && source.includes(healthWithBrain) && source.includes(routedCall);
if (!indexAlreadyCanonical) {
  if (!source.includes(ownerImport)) throw new Error('[patch-brain-router] owner-only tools import not found');
  source = source.replace(/^import \{ generateBrainResponse, getBrainStatus \} from '\.\/brain-router\.mjs';\n?/m, '');
  if (!source.includes(brainImport)) source = source.replace(ownerImport, `${ownerImport}\n${brainImport}`);
  source = source.replace(/const OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| '[^']+';/, targetModel);
  if (!source.includes(healthWithBrain)) {
    if (!source.includes(healthModel)) throw new Error('[patch-brain-router] health model block not found');
    source = source.replace(healthModel, healthWithBrain);
  }
  if (!source.includes(routedCall)) {
    if (!source.includes(directCall)) throw new Error('[patch-brain-router] direct OpenAI response call not found');
    source = source.replace(directCall, routedCall);
  }
  fs.writeFileSync(indexFile, source);
  console.log('[patch-brain-router] chat route wired to brain router');
} else {
  console.log('[patch-brain-router] chat route already wired; no index changes');
}

// The router source is canonical now: automatic requests start on Mini and
// Mini owns the escalation decision. Keep this build patch as a guard only.
const required = [
  "const wanted = mode === 'auto' ? 'mini' : mode;",
  "const LEVEL_TO_BRAIN = { deep: 'terra', deepest: 'opus' };",
  "return 'mini';",
];
for (const marker of required) {
  if (!router.includes(marker)) throw new Error(`[patch-brain-router] canonical router marker missing: ${marker}`);
}
console.log('[patch-brain-router] canonical brain-router verified; no router rewrite needed');
