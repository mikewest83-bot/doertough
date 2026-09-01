// Build-time end-state verification. Runs immediately before vite build.
// Patch scripts are string-replacement based; this makes silent no-ops fail the build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');

const MUST_CONTAIN = [
  ['src/main.jsx', "window.addEventListener('mike-game-start'", 'game cards wired to Mike'],
  ['src/main.jsx', 'const openPhotoPicker =', 'Vision photo picker'],
  ['src/main.jsx', 'writeToken(data.token)', 'session token persistence'],
  ['src/MikeGames.jsx', 'Endless trivia', 'Beat Mike endless-trivia copy'],
  ['server/persona.mjs', 'DEAL FINDER - LIVE LOCAL SEARCH', 'Deal Finder persona'],
  ['server/persona.mjs', 'GAMES - HOSTING RULES', 'game-hosting persona rules'],
  ['server/index.mjs', 'DEAL_FINDER_TOOLS', 'Deal Finder tools registered'],
  ['server/index.mjs', 'web_search_preview', 'web search enabled'],
  ['server/index.mjs', "app.post('/api/vision/analyze'", 'Vision route registered'],
  ['server/index.mjs', "from './brain-router.mjs'", 'Mike brain router imported'],
  ['server/index.mjs', 'generateBrainResponse({ client: openai', 'Mike chat uses brain router'],
  ['server/brain-router.mjs', "gpt-5.6-terra", 'Terra brain configured'],
  ['server/brain-router.mjs', "gpt-5.6-sol", 'Sol brain configured'],
  ['server/brain-router.mjs', "claude-opus-5", 'Opus brain configured'],
];

// These checks intentionally operate on executable source with comments removed.
// The preserved deal-alert module and cleanup-script comments may mention the
// disabled feature, but executable Deal Alert wiring must not survive the build.
const MUST_NOT_CONTAIN = [
  ['src/main.jsx', "modalities: ['audio', 'text']", 'removed Realtime response.modalities field'],
  ['src/main.jsx', 'Watch It for Me', 'Watch It for Me UI disabled'],
  ['src/main.jsx', 'Keep watching for me', 'persistent watch CTA disabled'],
  ['server/index.mjs', 'DEAL_ALERT_TOOLS', 'Deal Alert tools removed from active registry'],
  ['server/index.mjs', 'startDealAlertScheduler', 'Deal Alert scheduler disabled'],
  ['server/persona.mjs', 'set_deal_alert', 'persistent deal-alert instructions disabled'],
  ['server/index.mjs', 'openai.responses.create({ model: OPENAI_MODEL', 'legacy direct model call removed'],
  ['server/index.mjs', "process.env.OPENAI_MODEL || 'gpt-4o-mini'", 'legacy GPT-4o-mini default removed'],
];

const MUST_BE_ORDERED = [
  ['server/index.mjs', 'installGuards(app);', "app.post('/api/vision/analyze'", 'Vision route behind guard stack'],
];

const sourceFor = (file) => stripComments(read(file));
const failures = [];
for (const [file, needle, label] of MUST_CONTAIN) {
  try { if (!sourceFor(file).includes(needle)) failures.push(`${label} — "${needle}" missing from ${file}`); }
  catch (error) { failures.push(`${label} — could not read ${file}: ${error.message}`); }
}
for (const [file, needle, label] of MUST_NOT_CONTAIN) {
  try { if (sourceFor(file).includes(needle)) failures.push(`${label} — "${needle}" still present in executable source of ${file}`); }
  catch (error) { failures.push(`${label} — could not read ${file}: ${error.message}`); }
}
for (const [file, first, second, label] of MUST_BE_ORDERED) {
  try {
    const source = sourceFor(file);
    const a = source.indexOf(first), b = source.indexOf(second);
    if (a === -1) failures.push(`${label} — "${first}" not found in ${file}`);
    else if (b === -1) failures.push(`${label} — "${second}" not found in ${file}`);
    else if (b < a) failures.push(`${label} — "${second}" appears before "${first}" in ${file}`);
  } catch (error) { failures.push(`${label} — could not read ${file}: ${error.message}`); }
}

if (failures.length) {
  console.error(`\n[verify-build] ${failures.length} patch check(s) failed:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error('\nA patch fingerprint drifted. Fix it before deploying.\n');
  process.exit(1);
}
console.log(`[verify-build] all ${MUST_CONTAIN.length + MUST_NOT_CONTAIN.length + MUST_BE_ORDERED.length} patch checks passed`);
