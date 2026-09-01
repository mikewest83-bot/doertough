import fs from 'node:fs';

const target = 'server/index.mjs';
const canonical = "import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';";
const support = "import { reminderHandlerFor, startReminderScheduler } from './reminders.mjs';";

let source = fs.readFileSync(target, 'utf8');
const pattern = /^import\s+\{[^}]*\}\s+from\s+'\.\/reminders\.mjs';$/gm;
const matches = [...source.matchAll(pattern)];

// Once both canonical reminder imports exist, leave the file byte-for-byte alone.
// The coding-tools patch runs later in the build and must retain its stable import
// position; repeatedly removing/reinserting reminders was moving that import on
// every build and breaking the idempotence check.
if (source.includes(canonical) && source.includes(support)) {
  console.log('[reminder-import] canonical reminder imports already present; no changes');
  process.exit(0);
}

const anchor = "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';";
if (!source.includes(anchor)) throw new Error('[reminder-import] field-tools anchor not found');

source = source.replace(pattern, '');
source = source.replace(anchor, `${anchor}\n${canonical}\n${support}`);
fs.writeFileSync(target, source);
console.log(`[reminder-import] normalized ${matches.length} reminders import${matches.length === 1 ? '' : 's'} into stable tool/support imports`);
