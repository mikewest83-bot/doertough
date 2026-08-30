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

// Give Mike live web search in addition to the existing server-side function tools.
// Web search is especially useful for local marketplace discovery; function-call
// handling below only executes actual function_call items, so built-in search
// results stay inside the Responses API turn.
patchOnce(
  indexPath,
  'const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;',
  "const tools = [...(owner ? LIVE_TOOLS : PUBLIC_TOOLS), { type: 'web_search_preview' }];",
  'Responses web search'
);

const dealFinderInstructions = `\nDEAL FINDER - LIVE LOCAL SEARCH\n- When a user asks Mike to find a good buy, deal, bargain, used item, or listing near them, treat it as a live marketplace-search request.\n- Use the built-in web search tool to search current public web listings. Search multiple relevant marketplaces and local sources when practical.\n- If the user says \"near me\" or \"in my area\", use a known location from the conversation or account memory if one is available. If no usable location is known, ask for the ZIP code or city/state before searching.\n- Respect the user's budget, category, radius, condition, mileage/hours, and other constraints. Do not silently invent constraints.\n- Prefer actual current listings over generic buying guides. Return the strongest candidates with price, basic condition/details, approximate location when publicly shown, and the listing link.\n- Rank deals by value, not simply lowest price. Look for price relative to condition, age, mileage/hours, included equipment, seller description, and obvious red flags.\n- Never invent comparable sales, market values, listing details, seller claims, or a deal score. If evidence is thin, say so.\n- When a promising listing link can be read by the existing listing reader, use it to verify the listing details before calling it a strong buy.\n- Give a practical target offer and walk-away price only when there is enough evidence to support them; label them as estimates.\n- Make the final answer conversational and concise enough to work naturally in voice. Lead with the best buy and explain why.\n`;

let persona = fs.readFileSync(personaPath, 'utf8');
if (!persona.includes('DEAL FINDER - LIVE LOCAL SEARCH')) {
  const marker = "\nTOOLS - USE THEM INSTEAD OF GUESSING\n";
  if (persona.includes(marker)) {
    persona = persona.replace(marker, dealFinderInstructions + marker);
    fs.writeFileSync(personaPath, persona);
    console.log('[deal-finder] patched persona instructions');
  } else {
    console.log('[deal-finder] persona marker missing');
  }
} else {
  console.log('[deal-finder] persona already patched');
}
