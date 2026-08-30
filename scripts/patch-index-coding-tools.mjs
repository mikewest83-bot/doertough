import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const codingImport = "import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';";
if (!source.includes(codingImport)) {
  const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
  if (!source.includes(anchor)) throw new Error('Coding patch field-tools import anchor not found');
  source = source.replace(anchor, `${anchor}\n${codingImport}`);
}

const oldTools = 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...MONEY_TOOLS, ...REMINDER_TOOLS, ...DOERTOUGH_INTELLIGENCE_TOOLS];';
const newTools = 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...MONEY_TOOLS, ...REMINDER_TOOLS, ...DOERTOUGH_INTELLIGENCE_TOOLS, ...CODING_TOOLS];';
if (source.includes(oldTools)) source = source.replace(oldTools, newTools);

const handlerAnchor = '  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n};';
const handlerReplacement = '  ...DOERTOUGH_INTELLIGENCE_HANDLERS,\n  ...CODING_TOOL_HANDLERS,\n};';
if (source.includes(handlerAnchor) && !source.includes('...CODING_TOOL_HANDLERS')) source = source.replace(handlerAnchor, handlerReplacement);

fs.writeFileSync(target, source);
console.log('[build] coding tools wired into text chat');
