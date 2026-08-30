import fs from 'node:fs';

// Final build-time safety pass: Deal Alerts / "Watch It for Me" are disabled.
// Preserve the underlying modules for a future re-enable, but keep them out of
// the production tool registry, scheduler startup, and homepage UI.
const indexPath = 'server/index.mjs';
let index = fs.readFileSync(indexPath, 'utf8');

index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler \} from '\.\/deal-alerts\.mjs';\n/m, '');
index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor \} from '\.\/deal-alerts\.mjs';\n/m, '');
index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler \} from '\.\/deal-alerts\.mjs';\r?\n/m, '');
index = index.replace(/^import \{ DEAL_ALERT_TOOLS, dealAlertHandlerFor \} from '\.\/deal-alerts\.mjs';\r?\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_TOOLS,\r?\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\r?\n/m, '');
index = index.replace(/^\s*\.{3}DEAL_ALERT_TOOLS,\r?\n/m, '');
index = index.replace(/^\s*\.\.\.DEAL_ALERT_HANDLERS,\r?\n/m, '');
index = index.replace(/^\s*DEAL_ALERT_HANDLERS,\r?\n/m, '');
index = index.replace(/^\s*startDealAlertScheduler\(\);\r?\n?/gm, '');
index = index.replace(/^\s*startDealAlertScheduler\(\);\r?\n?/gm, '');
index = index.replace(/\nconst DEAL_ALERT_HANDLERS = Object\.fromEntries\(DEAL_ALERT_TOOLS\.map\(\(tool\) => \[[\s\S]*?\]\)\);\n/g, '\n');
index = index.replace(/\nconst DEAL_ALERT_HANDLERS = Object\.fromEntries\(DEAL_ALERT_TOOLS\.map\(\(tool\) => \[[\s\S]*?\]\)\);\r?\n/g, '\n');
index = index.replace(/,\s*set_deal_alert:\s*\(input\) => dealAlertHandlerFor\('set_deal_alert', input\?\.user\?\.id\)\?\.\(input\)/g, '');
index = index.replace(/,\s*list_deal_alerts:\s*\(input\) => dealAlertHandlerFor\('list_deal_alerts', input\?\.user\?\.id\)\?\.\(\)/g, '');
index = index.replace(/,\s*cancel_deal_alert:\s*\(input\) => dealAlertHandlerFor\('cancel_deal_alert', input\?\.user\?\.id\)\?\.\(input\)/g, '');
fs.writeFileSync(indexPath, index);

const uiPath = 'src/main.jsx';
let ui = fs.readFileSync(uiPath, 'utf8');
ui = ui.replace(/\s*<button type="button" className="secondary" onClick=\{\(\) => ask\('Set up a deal alert for something I am looking for\.'\)\} disabled=\{busy \|\| conversationMode\}>Keep watching for me<\/button>/g, '');
ui = ui.replace(/\s*<button[^>]*>Keep watching for me<\/button>/g, '');
ui = ui.replace(/\s*<button[^>]*>Watch It for Me<\/button>/g, '');
fs.writeFileSync(uiPath, ui);

console.log('[build] Deal Alerts / Watch It for Me disabled');
