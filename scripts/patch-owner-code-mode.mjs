import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('server/index.mjs');
const source = fs.readFileSync(file, 'utf8');

const IMPORT_MARKER = "import { CODE_TOOLS, CODE_TOOL_HANDLERS } from './code-tools.mjs';";
const OWNER_MARKER = "const OWNER_CODE_TOOL_NAMES = new Set(CODE_TOOLS.map((tool) => tool.name));";
const TOOLS_MARKER = 'const tools = owner ? [...LIVE_TOOLS, ...CODE_TOOLS] : PUBLIC_TOOLS;';
const HANDLER_LINE = '  ...CODE_TOOL_HANDLERS,';
const AUTH_MARKER = "return owner || !OWNER_ONLY_TOOLS.has(name);";
const AUTH_REPLACEMENT = "if (OWNER_CODE_TOOL_NAMES.has(name)) return owner;\n    return owner || !OWNER_ONLY_TOOLS.has(name);";

let out = source;

if (!out.includes(IMPORT_MARKER)) {
  const anchor = "import { createMikeToolGateway } from './mike-tool-gateway.mjs';";
  if (!out.includes(anchor)) throw new Error('Owner Code Mode patch: import anchor not found.');
  out = out.replace(anchor, `${anchor}\n${IMPORT_MARKER}`);
}

if (!out.includes(OWNER_MARKER)) {
  const anchor = "const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status', 'get_btc_rsi']);";
  if (!out.includes(anchor)) throw new Error('Owner Code Mode patch: owner-tool anchor not found.');
  out = out.replace(anchor, `${anchor}\n${OWNER_MARKER}`);
}

if (!out.includes(HANDLER_LINE)) {
  const handlerStart = 'const LIVE_TOOL_HANDLERS = {';
  const start = out.indexOf(handlerStart);
  if (start < 0) throw new Error('Owner Code Mode patch: LIVE_TOOL_HANDLERS block not found.');
  const end = out.indexOf('\n};', start);
  if (end < 0) throw new Error('Owner Code Mode patch: LIVE_TOOL_HANDLERS end not found.');
  out = out.slice(0, end) + `\n${HANDLER_LINE}` + out.slice(end);
}

if (!out.includes(TOOLS_MARKER)) {
  const old = 'const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;';
  if (!out.includes(old)) throw new Error('Owner Code Mode patch: tools selection anchor not found.');
  out = out.replace(old, TOOLS_MARKER);
}

if (!out.includes(AUTH_REPLACEMENT)) {
  if (!out.includes(AUTH_MARKER)) throw new Error('Owner Code Mode patch: authorization anchor not found.');
  out = out.replace(AUTH_MARKER, AUTH_REPLACEMENT);
}

if (!out.includes(AUTH_REPLACEMENT)) {
  throw new Error('Owner Code Mode patch: authorization guard could not be wired.');
}

if (out !== source) {
  fs.writeFileSync(file, out);
  console.log('[build] Owner Code Mode wired into Mike server');
} else {
  console.log('[build] Owner Code Mode already wired; no changes needed');
}
