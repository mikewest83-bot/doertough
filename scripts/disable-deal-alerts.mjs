import fs from 'node:fs';

// Final build-time safety pass: Deal Alerts / "Watch It for Me" are disabled.
// Preserve the underlying modules for a future re-enable, but keep them out of
// the production tool registry, scheduler startup, and homepage UI.
const indexPath = 'server/index.mjs';
let index = fs.readFileSync(indexPath, 'utf8');

// Remove every generated import variant from the Realtime/deal-alert patches.
index = index.replace(/^import \{[^\n]*DEAL_ALERT_TOOLS[^\n]*\} from '\.\/deal-alerts\.mjs';\r?\n/gm, '');

// Remove Deal Alert tool spreads from arrays/registries.
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\r?\n/gm, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\r?\n/gm, '');

// Remove the account-scoped Deal Alert handler mapping, while preserving
// reminder handlers in the same registry.
index = index.replace(/\n\s*\.\.\.DEAL_ALERT_TOOLS\.map\(\(tool\) => \[[\s\S]*?\n\s*\]\),/m, '');
index = index.replace(/\nconst DEAL_ALERT_HANDLERS = Object\.fromEntries\([\s\S]*?\n\}\);/m, '\n');

// Remove direct handler properties if another patch inserted them.
index = index.replace(/^\s*set_deal_alert:\s*.*\r?\n/gm, '');
index = index.replace(/^\s*list_deal_alerts:\s*.*\r?\n/gm, '');
index = index.replace(/^\s*cancel_deal_alert:\s*.*\r?\n/gm, '');
index = index.replace(/^\s*startDealAlertScheduler\(\);\r?\n?/gm, '');

fs.writeFileSync(indexPath, index);

const uiPath = 'src/main.jsx';
let ui = fs.readFileSync(uiPath, 'utf8');
ui = ui.replace(/\s*<button[^>]*>Keep watching for me<\/button>/g, '');
ui = ui.replace(/\s*<button[^>]*>Watch It for Me<\/button>/g, '');
ui = ui.replace(/\s*Watch It for Me\s*/g, ' ');
fs.writeFileSync(uiPath, ui);

console.log('[build] Deal Alerts / Watch It for Me disabled');
