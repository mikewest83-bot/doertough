import fs from 'node:fs';

const target = 'server/index.mjs';
const canonical = "import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';";
const support = "import { reminderHandlerFor, startReminderScheduler } from './reminders.mjs';";

let source = fs.readFileSync(target, 'utf8');
const pattern = /^import\s+\{[^}]*\}\s+from\s+'\.\/reminders\.mjs';$/gm;
const matches = [...source.matchAll(pattern)];

const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
if (!source.includes(anchor)) throw new Error('[reminder-import] field-tools anchor not found');

source = source.replace(pattern, '');
source = source.replace(anchor, `${anchor}\n${canonical}\n${support}`);
fs.writeFileSync(target, source);
console.log(`[reminder-import] normalized ${matches.length} reminders import${matches.length === 1 ? '' : 's'} into stable tool/support imports`);
