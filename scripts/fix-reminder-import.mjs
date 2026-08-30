import fs from 'node:fs';

const target = 'server/index.mjs';
const canonical = "import { REMINDER_TOOLS, reminderHandlerFor, startReminderScheduler, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';";

let source = fs.readFileSync(target, 'utf8');
const pattern = /^import\s+\{[^}]*\}\s+from\s+'\.\/reminders\.mjs';$/gm;
const matches = [...source.matchAll(pattern)];

if (matches.length === 0) {
  const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
  if (!source.includes(anchor)) throw new Error('[reminder-import] anchor not found');
  source = source.replace(anchor, `${anchor}\n${canonical}`);
  fs.writeFileSync(target, source);
  console.log('[reminder-import] added canonical reminders import');
} else {
  const first = matches[0][0];
  source = source.replace(pattern, '');
  const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
  if (!source.includes(anchor)) throw new Error('[reminder-import] field-tools anchor not found');
  source = source.replace(anchor, `${anchor}\n${canonical}`);
  fs.writeFileSync(target, source);
  console.log(`[reminder-import] normalized ${matches.length} reminders import${matches.length === 1 ? '' : 's'} into one`);
}
