import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const codingImport = "import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';";
const fieldImport = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
if (!source.includes(codingImport)) {
  if (!source.includes(fieldImport)) throw new Error('Coding patch field-tools import anchor not found');
  source = source.replace(fieldImport, `${fieldImport}\n${codingImport}`);
}

const toolsLine = 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];';
const toolsLineWithCoding = 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...CODING_TOOLS];';
if (source.includes(toolsLine) && !source.includes('...CODING_TOOLS')) {
  source = source.replace(toolsLine, toolsLineWithCoding);
}

const handlerAnchor = '  ...FIELD_TOOL_HANDLERS,\n};';
const handlerReplacement = '  ...FIELD_TOOL_HANDLERS,\n  ...CODING_TOOL_HANDLERS,\n};';
if (source.includes(handlerAnchor) && !source.includes('...CODING_TOOL_HANDLERS')) {
  source = source.replace(handlerAnchor, handlerReplacement);
}

if (!source.includes('...CODING_TOOLS')) throw new Error('Coding tools were not wired into LIVE_TOOLS');
if (!source.includes('...CODING_TOOL_HANDLERS')) throw new Error('Coding tool handlers were not wired');

fs.writeFileSync(target, source);
console.log('[build] coding tools wired into text chat');
