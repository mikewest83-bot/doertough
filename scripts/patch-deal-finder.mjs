import fs from 'fs';

const indexPath = 'server/index.mjs';
const personaPath = 'server/persona.mjs';

function patchOnce(path, marker, replacement, label) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(replacement)) {
    console.log(`[deal-finder] ${label} already patched`);
    return;
  }
  if (text.includes(marker)) {
    text = text.replace(marker, replacement);
    fs.writeFileSync(path, text);
    console.log(`[deal-finder] patched ${label}`);
  } else {
    console.log(`[deal-finder] ${label} marker missing`);
  }
}

function ensureLine(path, line, marker, label) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(line)) {
    console.log(`[deal-finder] ${label} already patched`);
    return;
  }
  if (text.includes(marker)) {
    text = text.replace(marker, `${marker}\n${line}`);
    fs.writeFileSync(path, text);
    console.log(`[deal-finder] patched ${label}`);
  } else {
    console.log(`[deal-finder] ${label} marker missing`);
  }
}

ensureLine(indexPath, "import { DEAL_FINDER_TOOLS, DEAL_FINDER_HANDLERS } from './deal-finder.mjs';", "import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';", 'Deal Finder tools import');
patchOnce(indexPath, 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];', 'const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...DEAL_FINDER_TOOLS];', 'Deal Finder tools');
patchOnce(indexPath, '  ...FIELD_TOOL_HANDLERS,\n};', '  ...FIELD_TOOL_HANDLERS,\n  ...DEAL_FINDER_HANDLERS,\n};', 'Deal Finder handlers');
patchOnce(indexPath, '  handlers: LIVE_TOOL_HANDLERS,', "  handlers: { ...LIVE_TOOL_HANDLERS, find_local_deals: (input) => DEAL_FINDER_HANDLERS.find_local_deals?.(input) },", 'Deal Finder gateway handlers');
patchOnce(indexPath, "const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;", "const tools = [...(owner ? LIVE_TOOLS : PUBLIC_TOOLS), { type: 'web_search_preview' }];", 'Responses web search');

const dealFinderInstructions = `\nDEAL FINDER - LIVE LOCAL RESALE SEARCH\n- When a user asks Mike to find a good buy, bargain, used item, or listing near them, treat it as a live marketplace-search request.\n- Use the built-in web search tool and the Deal Finder tool to search current public listings. Search multiple relevant marketplaces and local sources when practical.\n- If the user says \"near me\" or \"in my area\", use a known location from the conversation or account context if one is available. If no usable location is known, ask for the ZIP code or city/state before searching.\n- When the user wants to buy something to resell, evaluate the purchase as an investment: asking price, realistic resale range, gross spread, likely fees/repairs/travel, net profit, ROI, a 0-100 deal score, liquidity, risk, and confidence. Do not call something a deal just because it is cheap.\n- Only surface tangible physical goods that can be individually bought and resold. Never surface real estate/land/property, businesses/storefronts for sale, or yard/garage/estate sale event listings, even if items inside them might otherwise be relevant.\n- Prefer the two strongest opportunities and name the winner. Do not dump a long list unless the user asks for more.\n- Prefer actual current listings over generic buying guides. Never invent listings, comps, market values, prices, profits, or seller claims. If evidence is thin, say so.\n- When a promising listing link can be read by the existing listing reader, use it to verify the listing details before calling it a strong buy.\n- Facebook Marketplace does not provide a public listings API. Never pretend Mike has complete Marketplace coverage; report only what the available public search can actually verify.\n- Persistent Deal Alerts are enabled. When the user asks Mike to keep looking, create a scheduled resale scan using set_deal_alert. Never claim a background scan is active unless the tool confirms it.\n- A broad \"resale opportunities\" scan should favor categories with practical resale demand and manageable transport/testing: tools, lawn equipment, small engines, electronics/appliances, bicycles/fitness equipment, fishing/boating gear, automotive parts/accessories, quality furniture/home goods, and collectibles/hobby equipment.\n- Keep the final answer conversational and concise enough to work naturally in voice. Lead with the best opportunity and explain why.\n`;
let persona = fs.readFileSync(personaPath, 'utf8');
if (!persona.includes('DEAL FINDER - LIVE LOCAL RESALE SEARCH')) {
  const marker = "\nTOOLS - USE THEM INSTEAD OF GUESSING\n";
  if (persona.includes(marker)) { persona = persona.replace(marker, dealFinderInstructions + marker); fs.writeFileSync(personaPath, persona); console.log('[deal-finder] patched persona instructions'); }
  else console.log('[deal-finder] persona marker missing');
} else console.log('[deal-finder] persona already patched');
