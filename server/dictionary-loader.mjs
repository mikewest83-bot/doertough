// Preload hook: add the lightweight dictionary tool to Mike's existing free-tool registry
// without rewriting the mature tool modules.
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { DICTIONARY_TOOLS, DICTIONARY_TOOL_HANDLERS } from './dictionary-tools.mjs';

for (const tool of DICTIONARY_TOOLS) {
  if (!FREE_TOOLS.some((existing) => existing.name === tool.name)) FREE_TOOLS.push(tool);
}
Object.assign(FREE_TOOL_HANDLERS, DICTIONARY_TOOL_HANDLERS);
console.log('[dictionary] lightweight dictionary tool loaded');
