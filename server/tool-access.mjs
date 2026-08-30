// Centralized authorization policy for Mike's tool surface.
// Keep privileged tool names in one place so text and Realtime cannot drift.
export const OWNER_ONLY_TOOLS = new Set([
  'get_store_sales',
  'get_bot_status',
  'get_btc_rsi',
  'code_repo_status',
  'code_read_file',
  'code_search',
  'code_create_branch',
  'code_write_file',
]);

export const isOwnerOnlyTool = (name) => OWNER_ONLY_TOOLS.has(name);
