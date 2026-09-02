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
  // Resale deal watches send recurring email/push/text alerts and hit paid
  // web-search/Twilio/Resend usage on every scan. Keep this owner-only so a
  // tester account can't spin up watches that run indefinitely on Mike's bill.
  'set_resale_watch',
  'list_resale_watches',
  'cancel_resale_watch',
]);

export const isOwnerOnlyTool = (name) => OWNER_ONLY_TOOLS.has(name);
