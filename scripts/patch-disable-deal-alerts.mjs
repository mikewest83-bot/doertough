import fs from 'node:fs';

const indexPath = 'server/index.mjs';
const personaPath = 'server/persona.mjs';

let index = fs.readFileSync(indexPath, 'utf8');
index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler \} from '\.\/deal-alerts\.mjs';\n/m, '');
index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor \} from '\.\/deal-alerts\.mjs';\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS\.map\(\(tool\) => \[\n[\s\S]*?\n\s*\]\),\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\n/m, '');
index = index.replace(/^\s*startDealAlertScheduler\(\);\n/m, '');
index = index.replace(/^\s*startDealAlertScheduler\(\)\.catch\([^\n]*\);\n/m, '');
fs.writeFileSync(indexPath, index);

let persona = fs.readFileSync(personaPath, 'utf8');
persona = persona.replace(/\n- ALERTS: When the user asks Mike to keep looking, watch for, alert them about, or notify them when a specific item\/deal appears, create a persistent deal alert\.[^\n]*/g, '');
persona = persona.replace(/\n- Watch It for Me \/ persistent deal alerts are currently disabled\.[^\n]*/g, '');
persona = persona.replace(/\n- Explain that email notification requires the account email delivery service to be configured\./g, '');
persona = persona.replace(/\n- Never claim a background alert is active\./g, '');
persona = persona.replace(/\n- Never claim a background alert is active unless the alert tool succeeds\./g, '');
fs.writeFileSync(personaPath, persona);

console.log('[build] Deal alerts and Watch It for Me disabled from production surface');
