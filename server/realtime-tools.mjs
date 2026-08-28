// Shared Realtime tool definitions and safe server-side dispatch.
// Voice uses the same tool handlers as text; never execute business logic in the browser.
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { MONEY_TOOLS, MONEY_TOOL_HANDLERS } from './money-tools.mjs';
import { REMINDER_TOOLS, reminderHandlerFor } from './reminders.mjs';
import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';

const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status', 'get_btc_rsi']);

export const REALTIME_TOOLS = [
  ...LIVE_TOOLS,
  ...BUSINESS_TOOLS,
  ...FREE_TOOLS,
  ...FIELD_TOOLS,
  ...MONEY_TOOLS,
  ...REMINDER_TOOLS,
  ...DOERTOUGH_INTELLIGENCE_TOOLS,
].filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));

const HANDLERS = {
  ...LIVE_TOOL_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
  ...MONEY_TOOL_HANDLERS,
  ...DOERTOUGH_INTELLIGENCE_HANDLERS,
};

export function getRealtimeToolHandler(name, userId) {
  if (OWNER_ONLY_TOOLS.has(name)) return null;
  return reminderHandlerFor(name, userId) || HANDLERS[name] || null;
}

export function isRealtimeToolAllowed(name) {
  return REALTIME_TOOLS.some((tool) => tool.name === name);
}
