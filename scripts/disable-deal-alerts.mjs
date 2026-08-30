import fs from 'node:fs';

// Final build-time safety pass: Deal Alerts / "Watch It for Me" are disabled.
// Preserve the underlying modules for a future re-enable, but keep them out of
// the production tool registry, scheduler startup, and homepage UI.
const indexPath = 'server/index.mjs';
let index = fs.readFileSync(indexPath, 'utf8');

// Remove every generated Deal Alert import variant.
index = index.replace(/^import \{[^\n]*DEAL_ALERT_TOOLS[^\n]*\} from '\.\/deal-alerts\.mjs';\r?\n?/gm, '');
index = index.replace(/^import .*dealAlertHandlerFor.*from '\.\/deal-alerts\.mjs';\r?\n?/gm, '');
index = index.replace(/^import .*startDealAlertScheduler.*from '\.\/deal-alerts\.mjs';\r?\n?/gm, '');

// Remove Deal Alert tool spreads from arrays/registries.
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\r?\n/gm, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\r?\n/gm, '');

// Remove account-scoped Deal Alert handler mappings while preserving reminders.
index = index.replace(/\n\s*\.\.\.DEAL_ALERT_TOOLS\.map\(\(tool\) => \[[\s\S]*?\n\s*\]\),/m, '');
index = index.replace(/\nconst DEAL_ALERT_HANDLERS = Object\.fromEntries\([\s\S]*?\n\}\);/m, '\n');

// Remove direct Deal Alert handlers and scheduler calls regardless of indentation
// or whether a previous patch added a trailing await/catch expression.
index = index.replace(/^\s*(?:set_deal_alert|list_deal_alerts|cancel_deal_alert):[^\n]*\r?\n/gm, '');
index = index.replace(/^.*\bstartDealAlertScheduler\s*\([^\n]*\)\s*;?\s*$/gm, '');

fs.writeFileSync(indexPath, index);

const uiPath = 'src/main.jsx';
let ui = fs.readFileSync(uiPath, 'utf8');
ui = ui.replace(/\s*<button[^>]*>Keep watching for me<\/button>/g, '');
ui = ui.replace(/\s*<button[^>]*>Watch It for Me<\/button>/g, '');
ui = ui.replace(/\s*Watch It for Me\s*/g, ' ');
ui = ui.replace(/\s*Keep watching for me\s*/g, ' ');
fs.writeFileSync(uiPath, ui);

console.log('[build] Deal Alerts / Watch It for Me disabled');
