// Shared Realtime tool definitions and safe server-side dispatch.
// Voice uses the same tool handlers as text; never execute business logic in the browser.
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { MONEY_TOOLS, MONEY_TOOL_HANDLERS } from './money.mjs';
import { REMINDER_TOOLS, reminderHandlerFor } from './reminders.mjs';
import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';
import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';
import { DEAL_FINDER_TOOLS, DEAL_FINDER_HANDLERS } from './deal-finder.mjs';
import { OWNER_ONLY_TOOLS } from './tool-access.mjs';
import { isOwner } from './auth.mjs';

export const REALTIME_TOOLS = [
  ...LIVE_TOOLS,
  ...BUSINESS_TOOLS,
  ...FREE_TOOLS,
  ...FIELD_TOOLS,
  ...MONEY_TOOLS,
  ...REMINDER_TOOLS,
  ...DOERTOUGH_INTELLIGENCE_TOOLS,
  ...CODING_TOOLS,
  ...DEAL_FINDER_TOOLS,
].filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));

const HANDLERS = {
  ...LIVE_TOOL_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
  ...MONEY_TOOL_HANDLERS,
  ...CODING_TOOL_HANDLERS,
  ...DOERTOUGH_INTELLIGENCE_HANDLERS,
  ...DEAL_FINDER_HANDLERS,
};

export function getRealtimeToolHandler(name, user) {
  if (OWNER_ONLY_TOOLS.has(name) && !isOwner(user)) return null;
  return reminderHandlerFor(name, user?.id) || HANDLERS[name] || null;
}

export function isRealtimeToolAllowed(name) {
  return REALTIME_TOOLS.some((tool) => tool.name === name);
}
