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
  ['src/main.jsx', 'const extractVideoFrames', 'Video Walkaround frame extraction'],
  ['src/main.jsx', 'const handleVideoChange', 'Video Walkaround upload handler'],
  ['src/main.jsx', 'Video Walkaround', 'Video Walkaround UI'],
  ['src/main.jsx', 'ref={videoInputRef}', 'Video Walkaround file input'],
  ['src/main.jsx', 'capture="environment"', 'mobile camera video capture'],
  ['server/vision.mjs', 'MAX_WALKAROUND_IMAGES = 8', 'Vision walkaround image bound'],
  ['server/vision.mjs', 'normalizeVisionImages', 'Vision multi-image normalization'],
  ['server/vision.mjs', 'Use all of them together', 'Vision walkaround multi-frame instruction'],
  ['src/MikeGames.jsx', 'Endless trivia', 'Beat Mike endless-trivia copy'],
  ['server/persona.mjs', 'DEAL FINDER - LIVE LOCAL RESALE SEARCH', 'Deal Finder persona'],
  ['server/persona.mjs', 'Persistent Deal Alerts are enabled', 'Deal Alert persona'],
  ['server/persona.mjs', 'GAMES - HOSTING RULES', 'game-hosting persona rules'],
  ['server/index.mjs', 'DEAL_FINDER_TOOLS', 'Deal Finder tools registered'],
  ['server/index.mjs', 'DEAL_ALERT_TOOLS', 'Deal Alert tools registered'],
  ['server/index.mjs', 'startDealAlertScheduler', 'Deal Alert scheduler registered'],
  ['server/index.mjs', 'web_search_preview', 'web search enabled'],
  ['server/index.mjs', "app.post('/api/vision/analyze'", 'Vision route registered'],
  ['server/index.mjs', "from './brain-router.mjs'", 'Mike brain router imported'],
  ['server/index.mjs', 'generateBrainResponse({ client: openai', 'Mike chat uses brain router'],
  ['server/brain-router.mjs', "gpt-5.6-luna", 'Mini brain configured (reasoning-capable starting brain)'],
  ['server/brain-router.mjs', "gpt-5.6-terra", 'Terra brain configured'],
  ['server/brain-router.mjs', "gpt-5.6-sol", 'Sol brain configured'],
  ['server/brain-router.mjs', "claude-opus-5", 'Opus brain configured'],
  ['src/main.jsx', 'className="sample-exchange"', 'sample exchange section'],
  ['src/main.jsx', '.sample-thread{', 'sample exchange styles'],
  ['index.html', 'mike-dock-actions.js', 'floating action chips docked'],
  ['src/mike-games-standalone.jsx', "querySelector('.site-footer')", 'games mount above the footer'],
  ['index.html', 'mike-orb-center.css', 'orb lockup centering stylesheet linked'],
  ['src/main.jsx', 'className="site-footer"', 'site footer with support/legal links'],
  ['src/main.jsx', '.trust-strip{', 'trust strip styles'],
  ['src/main.jsx', 'Powered by OpenAI + Anthropic', 'model provenance copy'],
  ['src/main.jsx', 'Stripe Climate', 'carbon commitment surfaced in-app'],
  ['src/main.jsx', "mikeTelemetry('landing_view')", 'funnel landing telemetry'],
  ['src/main.jsx', "mikeTelemetry('prompt_submitted')", 'funnel prompt telemetry'],
  ['src/main.jsx', "mikeTelemetry('first_response')", 'funnel first-response telemetry'],
  ['src/main.jsx', "mikeTelemetry('second_message')", 'funnel second-message telemetry'],
  ['src/main.jsx', "mikeTelemetry('account_created')", 'funnel account-created telemetry'],
  ['src/main.jsx', "mikeTelemetry('voice_started')", 'funnel voice telemetry'],
  ['src/main.jsx', "mikeTelemetry('abandoned')", 'funnel abandonment telemetry'],
  ['src/main.jsx', 'telemetryRef.current.responses += 1', 'funnel response counter'],
  ['server/index.mjs', 'const SPA_ROUTES = new Set', 'known SPA route allowlist'],
  ['server/index.mjs', 'const isKnownSpaRoute =', 'SPA route validation'],
  ['server/index.mjs', "res.status(404).json({ error: 'not_found' })", 'real 404 fallback'],
];

const MUST_NOT_CONTAIN = [
  ['src/main.jsx', "modalities: ['audio', 'text']", 'removed Realtime response.modalities field'],
  ['src/main.jsx', 'Watch It for Me', 'obsolete Watch It for Me UI copy'],
  ['src/main.jsx', 'Keep watching for me', 'obsolete persistent watch CTA copy'],
  ['server/persona.mjs', 'Watch It for Me / persistent deal alerts are currently disabled', 'obsolete disabled Deal Alert instructions'],
  ['server/index.mjs', 'openai.responses.create({ model: OPENAI_MODEL', 'legacy direct model call removed'],
  ['server/index.mjs', "process.env.OPENAI_MODEL || 'gpt-4o-mini'", 'legacy GPT-4o-mini default removed'],
  ['server/brain-router.mjs', "mini: process.env.MIKE_MINI_MODEL || 'gpt-4o-mini'", 'Mini brain no longer defaults to GPT-4o-mini'],
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
