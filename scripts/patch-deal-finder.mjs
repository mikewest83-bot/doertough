import fs from 'fs';

const indexPath = 'server/index.mjs';
const personaPath = 'server/persona.mjs';

function patchOnce(path, marker, replacement, label) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) {
    text = text.replace(marker, replacement);
    fs.writeFileSync(path, text);
    console.log(`[deal-finder] patched ${label}`);
  } else {
    console.log(`[deal-finder] ${label} already patched or marker missing`);
  }
}

patchOnce(indexPath, "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';", "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';\nimport { DEAL_FINDER_TOOLS, DEAL_FINDER_HANDLERS } from './deal-finder.mjs';\nimport { DEAL_ALERT_TOOLS, dealAlertHandlerFor } from './deal-alerts.mjs';", 'Deal Finder imports');
patchOnce(indexPath, 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];', 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...DEAL_FINDER_TOOLS, ...DEAL_ALERT_TOOLS];', 'Deal Finder tools');
patchOnce(indexPath, '  ...FIELD_TOOL_HANDLERS,\n};', '  ...FIELD_TOOL_HANDLERS,\n  ...DEAL_FINDER_HANDLERS,\n};', 'Deal Finder handlers');
patchOnce(indexPath, '  handlers: LIVE_TOOL_HANDLERS,', "  handlers: { ...LIVE_TOOL_HANDLERS, find_local_deals: (input) => DEAL_FINDER_HANDLERS.find_local_deals?.(input), set_deal_alert: (input) => dealAlertHandlerFor('set_deal_alert', input?.user?.id)?.(input), list_deal_alerts: (input) => dealAlertHandlerFor('list_deal_alerts', input?.user?.id)?.(), cancel_deal_alert: (input) => dealAlertHandlerFor('cancel_deal_alert', input?.user?.id)?.(input) },", 'Deal Finder gateway handlers');
patchOnce(indexPath, "const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;", "const tools = [...(owner ? LIVE_TOOLS : PUBLIC_TOOLS), { type: 'web_search_preview' }];", 'Responses web search');

const dealFinderInstructions = `\nDEAL FINDER - LIVE LOCAL SEARCH\n- When a user asks Mike to find a good buy, deal, bargain, used item, or listing near them, treat it as a live marketplace-search request.\n- Use the built-in web search tool to search current public web listings. Search multiple relevant marketplaces and local sources when practical.\n- If the user says \"near me\" or \"in my area\", use a known location from the conversation or account memory if one is available. If no usable location is known, ask for the ZIP code or city/state before searching.\n- Respect the user's budget, category, radius, condition, mileage/hours, and other constraints. Do not silently invent constraints.\n- Prefer actual current listings over generic buying guides. Return the strongest candidates with price, basic condition/details, approximate location when publicly shown, and the listing link.\n- Rank deals by value, not simply lowest price. Look for price relative to condition, age, mileage/hours, included equipment, seller description, and obvious red flags.\n- Never invent comparable sales, market values, listing details, seller claims, or a deal score. If evidence is thin, say so.\n- When a promising listing link can be read by the existing listing reader, use it to verify the listing details before calling it a strong buy.\n- Do not tell the user to check Facebook Marketplace, Craigslist, eBay, or another marketplace themselves as a fallback when they asked Mike to find the deal. Mike should search the available public web sources first. If a requested marketplace cannot be searched or verified, say that plainly and provide the best verified alternatives instead of pretending the user must do the work.\n- Do not turn a live deal-search request into generic shopping advice. Lead with actual listings when current evidence exists.\n- ALERTS: When the user asks Mike to keep looking, watch for, alert them about, or notify them when a specific item/deal appears, create a persistent deal alert. Ask only for the missing category or location. Default to hourly checks. Explain that email notification requires the account email delivery service to be configured.\n- Never claim a background alert is active unless the alert tool succeeds.\n- Make the final answer conversational and concise enough to work naturally in voice. Lead with the best buy and explain why.\n`;
let persona = fs.readFileSync(personaPath, 'utf8');
if (!persona.includes('DEAL FINDER - LIVE LOCAL SEARCH')) {
  const marker = "\nTOOLS - USE THEM INSTEAD OF GUESSING\n";
  if (persona.includes(marker)) { persona = persona.replace(marker, dealFinderInstructions + marker); fs.writeFileSync(personaPath, persona); console.log('[deal-finder] patched persona instructions'); }
  else console.log('[deal-finder] persona marker missing');
} else console.log('[deal-finder] persona already patched');
