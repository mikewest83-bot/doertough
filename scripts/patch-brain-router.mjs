import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = path.join(root, 'server/index.mjs');
const routerFile = path.join(root, 'server/brain-router.mjs');
let source = fs.readFileSync(indexFile, 'utf8');
let router = fs.readFileSync(routerFile, 'utf8');

const brainImport = "import { generateBrainResponse, getBrainStatus } from './brain-router.mjs';";
const ownerImport = "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';";
const targetModel = "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';";
const healthModel = "    model: OPENAI_MODEL,\n    timestamp: new Date().toISOString(),";
const healthWithBrain = "    model: OPENAI_MODEL,\n    brain: getBrainStatus(),\n    timestamp: new Date().toISOString(),";
const directCall = '      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });';
const routedCall = '      const response = await generateBrainResponse({ client: openai, instructions, input, tools, message });';

// The index patch is intentionally limited to wiring the chat route to the
// router. Brain selection belongs in brain-router.mjs, not in this patcher.
const indexAlreadyCanonical =
  source.includes(brainImport) &&
  source.includes(targetModel) &&
  source.includes(healthWithBrain) &&
  source.includes(routedCall);

if (!indexAlreadyCanonical) {
  if (!source.includes(ownerImport)) {
    throw new Error('[patch-brain-router] owner-only tools import not found');
  }

  source = source.replace(/^import \{ generateBrainResponse, getBrainStatus \} from '\.\/brain-router\.mjs';\n?/m, '');
  if (!source.includes(brainImport)) source = source.replace(ownerImport, `${ownerImport}\n${brainImport}`);

  source = source.replace(
    /const OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| '[^']+';/,
    targetModel,
  );

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

// Automatic text routing must ALWAYS start with Mini. The floor brain then
// decides whether to call the private escalation tool. This belongs in the
// router itself; never try to patch this logic into server/index.mjs.
const oldAutoSelection = "  const { brain: wanted, score } = mode === 'auto' ? pickBrain(message) : { brain: mode, score: null };";
const newAutoSelection = "  const { brain: wanted, score } = mode === 'auto' ? { brain: 'mini', score: complexityScore(message) } : { brain: mode, score: null };";
if (router.includes(oldAutoSelection)) {
  router = router.replace(oldAutoSelection, newAutoSelection);
  fs.writeFileSync(routerFile, router);
  console.log('[patch-brain-router] auto mode now starts on mini');
} else if (router.includes(newAutoSelection)) {
  console.log('[patch-brain-router] auto mode already starts on mini; no router changes');
} else {
  const oldResolve = "  if (mode !== 'auto') return availableBrain(mode);\n  return availableBrain(pickBrain(message).brain);";
  const newResolve = "  if (mode !== 'auto') return availableBrain(mode);\n  return 'mini';";
  if (router.includes(oldResolve)) {
    router = router.replace(oldResolve, newResolve);
    fs.writeFileSync(routerFile, router);
    console.log('[patch-brain-router] resolveBrain auto mode now starts on mini');
  } else if (router.includes(newResolve)) {
    console.log('[patch-brain-router] resolveBrain already starts on mini; no router changes');
  } else {
    throw new Error('[patch-brain-router] brain-router auto selection block not found');
  }
}

console.log('[patch-brain-router] canonical brain-router patch complete');
