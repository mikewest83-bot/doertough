import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

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
const roundLoop = '    for (let round = 0; round < 4; round += 1) {';
const boundedRoundLoop = "    const maxToolRounds = Math.max(1, Math.min(4, Number(process.env.MIKE_MAX_TOOL_ROUNDS || 3)));\n    for (let round = 0; round < maxToolRounds; round += 1) {";
const finalRoundCall = "      const roundTools = round === maxToolRounds - 1 ? [] : tools;\n      const response = await generateBrainResponse({ client: openai, instructions, input, tools: roundTools, message });";

// A build may run more than once against the same working tree. Treat the
// answer-only final-round form as canonical too; otherwise the second build
// would incorrectly look for the pre-patch direct OpenAI call and fail.
const hasBrainWiring = source.includes(brainImport) && source.includes(targetModel) && source.includes(healthWithBrain) && (source.includes(routedCall) || source.includes(finalRoundCall));
if (!hasBrainWiring) {
  if (!source.includes(ownerImport)) throw new Error('[patch-brain-router] owner-only tools import not found');
  source = source.replace(/^import \{ generateBrainResponse, getBrainStatus \} from '\.\/brain-router\.mjs';\n?/m, '');
  if (!source.includes(brainImport)) source = source.replace(ownerImport, `${ownerImport}\n${brainImport}`);
  source = source.replace(/const OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| '[^']+';/, targetModel);
  if (!source.includes(healthWithBrain)) {
    if (!source.includes(healthModel)) throw new Error('[patch-brain-router] health model block not found');
    source = source.replace(healthModel, healthWithBrain);
  }
  if (!source.includes(routedCall) && !source.includes(finalRoundCall)) {
    if (!source.includes(directCall)) throw new Error('[patch-brain-router] direct OpenAI response call not found');
    source = source.replace(directCall, routedCall);
  }
}

// Bound tool/model turns so a simple question cannot burn four sequential
// model calls. The final allowed turn is answer-only: tool results already
// collected are still in the conversation, but another tool loop cannot start.
if (!source.includes(boundedRoundLoop)) {
  if (source.includes(roundLoop)) source = source.replace(roundLoop, boundedRoundLoop);
  else if (!source.includes('const maxToolRounds = Math.max(1, Math.min(4, Number(process.env.MIKE_MAX_TOOL_ROUNDS || 3)));')) {
    throw new Error('[patch-brain-router] tool-round loop anchor not found');
  }
}
if (!source.includes(finalRoundCall)) {
  if (!source.includes(routedCall)) throw new Error('[patch-brain-router] routed brain call not found for final-round guard');
  source = source.replace(routedCall, finalRoundCall);
}
fs.writeFileSync(indexFile, source);

// Mike chat starts on GPT-5.6 Luna. Keep the internal `mini` slot name because
// Vision and Deal Alerts intentionally retain their own mini-model configuration.
const lunaModelLine = "  mini: process.env.MIKE_MINI_MODEL || 'gpt-5.6-luna',";
const legacyModelLine = "  mini: process.env.MIKE_MINI_MODEL || 'gpt-4o-mini',";
if (router.includes(legacyModelLine)) router = router.replace(legacyModelLine, lunaModelLine);
const legacyReasoning = "const REASONING_BRAINS = new Set(['terra', 'sol']);";
const lunaReasoning = "const REASONING_BRAINS = new Set(['mini', 'terra', 'sol']);";
if (router.includes(legacyReasoning)) router = router.replace(legacyReasoning, "// Mini is now GPT-5.6 Luna for Mike chat; Vision and Deal Alerts keep their own mini model paths.\n" + lunaReasoning);
const legacyDefaults = "const TIER_EFFORT_DEFAULT = { terra: 'low', sol: 'medium' };";
const lunaDefaults = "const TIER_EFFORT_DEFAULT = { mini: 'low', terra: 'low', sol: 'medium' };";
if (router.includes(legacyDefaults)) router = router.replace(legacyDefaults, lunaDefaults);
fs.writeFileSync(routerFile, router);
console.log('[patch-brain-router] chat route wired to Luna-backed brain router with bounded tool rounds');

const required = [
  "const wanted = mode === 'auto' ? 'mini' : mode;",
  "const LEVEL_TO_BRAIN = { deep: 'terra', deepest: 'opus' };",
  "return 'mini';",
  "mini: process.env.MIKE_MINI_MODEL || 'gpt-5.6-luna',",
  "const REASONING_BRAINS = new Set(['mini', 'terra', 'sol']);",
];
for (const marker of required) {
  if (!router.includes(marker)) throw new Error(`[patch-brain-router] canonical router marker missing: ${marker}`);
}
console.log('[patch-brain-router] canonical router verified: Luna chat + mini slot preserved for dedicated tools');
