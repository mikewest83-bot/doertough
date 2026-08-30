// Build-time end-state verification. Runs immediately before vite build.
// Patch scripts are string-replacement based; this makes silent no-ops fail the build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const MUST_CONTAIN = [
  ['src/main.jsx', "window.addEventListener('mike-game-start'", 'game cards wired to Mike'],
  ['src/main.jsx', 'homepage-deal-finder', 'Deal Finder section on homepage'],
  ['src/main.jsx', 'const openPhotoPicker =', 'Vision photo picker'],
  ['src/main.jsx', 'if (data?.token) writeToken(data.token)', 'rolling session token'],
  ['src/MikeGames.jsx', 'Endless trivia', 'Beat Mike endless-trivia copy'],
  ['server/persona.mjs', 'DEAL FINDER - LIVE LOCAL SEARCH', 'Deal Finder persona'],
  ['server/persona.mjs', 'GAMES - HOSTING RULES', 'game-hosting persona rules'],
  ['server/index.mjs', 'DEAL_FINDER_TOOLS', 'Deal Finder tools registered'],
  ['server/index.mjs', 'DEAL_ALERT_TOOLS', 'Deal Alert tools registered'],
  ['server/index.mjs', 'web_search_preview', 'web search enabled'],
  ['server/index.mjs', "app.post('/api/vision/analyze'", 'Vision route registered'],
];

const MUST_NOT_CONTAIN = [
  ['src/main.jsx', "modalities: ['audio', 'text']", 'removed Realtime response.modalities field'],
];

const MUST_BE_ORDERED = [
  ['server/index.mjs', 'installGuards(app);', "app.post('/api/vision/analyze'", 'Vision route behind guard stack'],
];

const failures = [];
for (const [file, needle, label] of MUST_CONTAIN) {
  try { if (!read(file).includes(needle)) failures.push(`${label} — "${needle}" missing from ${file}`); }
  catch (error) { failures.push(`${label} — could not read ${file}: ${error.message}`); }
}
for (const [file, needle, label] of MUST_NOT_CONTAIN) {
  try { if (read(file).includes(needle)) failures.push(`${label} — "${needle}" still present in ${file}`); }
  catch (error) { failures.push(`${label} — could not read ${file}: ${error.message}`); }
}
for (const [file, first, second, label] of MUST_BE_ORDERED) {
  try {
    const source = read(file);
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
