import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { RESALE_ALERT_TOOLS, resaleAlertHandlerFor, startResaleWatchScheduler } from './resale-alerts.mjs';";
if (!source.includes(importLine)) {
  const anchors = [
    "import { reminderHandlerFor, startReminderScheduler } from './reminders.mjs';",
    "import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';",
    "import { REMINDER_TOOLS, reminderHandlerFor, startReminderScheduler } from './reminders.mjs';",
  ];
  const anchor = anchors.find((candidate) => source.includes(candidate));
  if (!anchor) throw new Error('[patch-resale-alerts] reminder import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const toolsAnchor = '  ...REMINDER_TOOLS,\n';
if (!source.includes('  ...RESALE_ALERT_TOOLS,\n')) {
  if (!source.includes(toolsAnchor)) throw new Error('[patch-resale-alerts] live tools anchor not found');
  source = source.replace(toolsAnchor, `${toolsAnchor}  ...RESALE_ALERT_TOOLS,\n`);
}

const handlerAnchor = `  ...REMINDER_TOOLS.map((tool) => [\n    tool.name,\n    (args = {}) => reminderHandlerFor(tool.name, args?.user?.id)?.(args),\n  ]),`;
const resaleHandlerBlock = `${handlerAnchor}\n  ...RESALE_ALERT_TOOLS.map((tool) => [\n    tool.name,\n    (args = {}) => resaleAlertHandlerFor(tool.name, args?.user?.id)?.(args),\n  ]),`;
if (!source.includes('resaleAlertHandlerFor(tool.name')) {
  if (!source.includes(handlerAnchor)) throw new Error('[patch-resale-alerts] account-scoped handler anchor not found');
  source = source.replace(handlerAnchor, resaleHandlerBlock);
}

const schedulerBlock = `  try {\n    startReminderScheduler();\n    console.log('[mike-ai] reminder scheduler ready');\n  } catch (error) {\n    console.error('[mike-ai] reminder scheduler initialization failed:', error.message || error);\n  }`;
if (!source.includes('[mike-ai] resale deal scanner ready')) {
  const schedulerRe = /  try \{\n    startReminderScheduler\(\);\n    console\.log\('\[mike-ai\] reminder scheduler ready'\);\n  \} catch \(error\) \{\n    console\.error\('\[mike-ai\] reminder scheduler initialization failed:', error\.message \|\| error\);\n  \}/;
  if (!schedulerRe.test(source)) throw new Error('[patch-resale-alerts] scheduler block not found');
  source = source.replace(schedulerRe, `${schedulerBlock}\n  try {\n    startResaleWatchScheduler();\n    console.log('[mike-ai] resale deal scanner ready');\n  } catch (error) {\n    console.error('[mike-ai] resale deal scanner initialization failed:', error.message || error);\n  }`);
}

fs.writeFileSync(target, source);
console.log('[build] resale deal scanner wired');
