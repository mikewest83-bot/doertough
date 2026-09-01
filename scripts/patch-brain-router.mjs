import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server/index.mjs');
let source = fs.readFileSync(file, 'utf8');

const replacements = [
  {
    from: "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';",
    to: "import { OWNER_ONLY_TOOLS } from './tool-access.mjs';\nimport { generateBrainResponse, getBrainStatus } from './brain-router.mjs';",
  },
  {
    from: "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';",
    to: "const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';",
  },
  {
    from: "    model: OPENAI_MODEL,\n    timestamp: new Date().toISOString(),",
    to: "    model: OPENAI_MODEL,\n    brain: getBrainStatus(),\n    timestamp: new Date().toISOString(),",
  },
  {
    from: "      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });",
    to: "      const response = await generateBrainResponse({ client: openai, instructions, input, tools, message });",
  },
];

for (const { from, to } of replacements) {
  if (source.includes(to)) continue;
  if (!source.includes(from)) {
    throw new Error(`[patch-brain-router] expected source not found: ${from}`);
  }
  source = source.replace(from, to);
}

fs.writeFileSync(file, source);
console.log('[patch-brain-router] brain router wired');
