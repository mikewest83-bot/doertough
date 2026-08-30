import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverTarget = path.join(root, 'server', 'index.mjs');
const clientTarget = path.join(root, 'src', 'main.jsx');

let server = fs.readFileSync(serverTarget, 'utf8');
let client = fs.readFileSync(clientTarget, 'utf8');

// Browser -> Railway -> OpenAI. Keep the WebRTC SDP exchange same-origin from
// the browser and let Railway supply the required Origin header upstream.
if (!server.includes("app.post('/api/realtime/webrtc-answer'")) {
  const marker = '// ===== Billing =====';
  const index = server.indexOf(marker);
  if (index < 0) throw new Error('Realtime WebRTC proxy billing anchor not found');

  const route = [
    '// ===== Realtime WebRTC answer proxy =====',
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

  server = server.slice(0, index) + route + server.slice(index);
}

// Replace the direct cross-origin OpenAI call with the authenticated same-origin proxy.
const direct = "const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${tokenData.token}` }, body: form });";
const proxied = "const answerResponse = await fetch('/api/realtime/webrtc-answer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), 'X-Mike-Realtime-Token': tokenData.token }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });";
if (client.includes(direct)) client = client.replace(direct, proxied);

fs.writeFileSync(serverTarget, server);
fs.writeFileSync(clientTarget, client);
console.log('[build] Realtime WebRTC origin-safe proxy enabled');
