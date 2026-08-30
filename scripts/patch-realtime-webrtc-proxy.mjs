import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverTarget = path.join(root, 'server', 'index.mjs');
const clientTarget = path.join(root, 'src', 'main.jsx');

let server = fs.readFileSync(serverTarget, 'utf8');
let client = fs.readFileSync(clientTarget, 'utf8');

// Browser -> Railway -> OpenAI. Insert the proxy only after Express JSON parsing
// and auth middleware are installed, at a known top-level anchor.
const routeMarker = '// ===== Realtime WebRTC answer proxy =====';
const route = [
  routeMarker,
  "app.post('/api/realtime/webrtc-answer', authRequired, async (req, res) => {",
  '  try {',
  "    const sdp = String(req.body?.sdp || '');",
  "    const clientSecret = String(req.get('x-mike-realtime-token') || '').trim();",
  "    if (!sdp || sdp.length > 200000) return res.status(400).json({ error: 'sdp_invalid' });",
  "    if (!clientSecret) return res.status(401).json({ error: 'realtime_token_required' });",
  '',
  '    const form = new FormData();',
  "    form.append('sdp', new Blob([sdp], { type: 'application/sdp' }));",
  "    const origin = String(process.env.PUBLIC_APP_ORIGIN || 'https://doertoughmikeai.com').replace(/\\/$/, '');",
  "    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {",
  "      method: 'POST',",
  '      headers: {',
  "        Authorization: 'Bearer ' + clientSecret,",
  '        Origin: origin,',
  '      },',
  '      body: form,',
  '    });',
  '',
  '    const answer = await upstream.text();',
  '    if (!upstream.ok) {',
  "      console.error('[realtime] WebRTC answer failed:', upstream.status, answer.slice(0, 800));",
  "      return res.status(upstream.status).json({ error: 'realtime_webrtc_failed', detail: answer.slice(0, 800) });",
  '    }',
  "    res.type('application/sdp').send(answer);",
  '  } catch (error) {',
  "    console.error('[realtime] WebRTC proxy error:', error.message || error);",
  "    res.status(error.status || 502).json({ error: error.message || 'realtime_webrtc_proxy_failed' });",
  '  }',
  '});',
  '',
].join('\n');

if (!server.includes(routeMarker)) {
  const anchor = 'installGuards(app);';
  const index = server.indexOf(anchor);
  if (index < 0) throw new Error('Realtime WebRTC proxy middleware anchor not found');
  const insertAt = index + anchor.length;
  server = server.slice(0, insertAt) + '\n\n' + route + server.slice(insertAt);
}

// Force the browser to use the authenticated same-origin proxy. Do not rely on
// exact source formatting because earlier build patches can rewrite the SDP line.
const proxied = "const answerResponse = await fetch('/api/realtime/webrtc-answer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), 'X-Mike-Realtime-Token': tokenData.token }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });";
const directCallStart = "const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls'";
let clientPatched = false;

if (client.includes(directCallStart)) {
  const start = client.indexOf(directCallStart);
  const end = client.indexOf(';', start);
  if (end < 0) throw new Error('[realtime] direct WebRTC call terminator not found');
  client = client.slice(0, start) + proxied + client.slice(end + 1);
  clientPatched = true;
}

if (client.includes('https://api.openai.com/v1/realtime/calls')) {
  throw new Error('[realtime] refusing to build with a browser-direct OpenAI WebRTC call');
}
if (!server.includes("app.post('/api/realtime/webrtc-answer', authRequired")) {
  throw new Error('[realtime] server WebRTC proxy route was not installed');
}

fs.writeFileSync(serverTarget, server);
fs.writeFileSync(clientTarget, client);
console.log(`[build] Realtime WebRTC origin-safe proxy enabled${clientPatched ? '; browser route patched' : '; browser route already proxied'}`);
