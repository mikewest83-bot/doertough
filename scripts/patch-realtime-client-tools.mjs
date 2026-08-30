// Build-time, idempotent bridge for OpenAI Realtime function calls.
// The Realtime model can request a tool over the WebRTC data channel, but
// business logic must stay server-side. This patch teaches the browser to
// forward authenticated tool calls to /api/realtime/tool and return the result
// to the Realtime conversation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

// The server's canonical Realtime token route is /api/speech/token.
// Keep this correction build-time and idempotent so older client source cannot
// reintroduce the dead /api/speech/session endpoint.
const legacySessionEndpoint = "fetchJson('/api/speech/session'";
const canonicalSessionEndpoint = "fetchJson('/api/speech/token'";
if (source.includes(legacySessionEndpoint)) {
  source = source.replace(legacySessionEndpoint, canonicalSessionEndpoint);
}

// Normalize the ephemeral client secret at the browser/server boundary and
// fail closed if it is missing. Never allow the literal string "undefined"
// to become an Authorization credential sent upstream to OpenAI.
const tokenDataLine = "      const tokenData = await fetchJson('/api/speech/token', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}' }, 20000);";
const tokenGuard = "      const realtimeClientSecret = String(tokenData?.token ?? tokenData?.value ?? tokenData?.client_secret?.value ?? '').trim();\n      if (!realtimeClientSecret || realtimeClientSecret === 'undefined' || realtimeClientSecret === 'null') throw new Error('realtime_client_secret_missing');";
if (!source.includes('const realtimeClientSecret =')) {
  if (!source.includes(tokenDataLine)) throw new Error('[realtime] token route anchor not found');
  source = source.replace(tokenDataLine, `${tokenDataLine}\n${tokenGuard}`);
}

const helperAnchor = "  const logClientError = async (phase, err) => { console.error(`[voice] ${phase}:`, err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.stack || '' }) }); } catch {} };";
const helper = `${helperAnchor}\n  const dispatchRealtimeToolCall = async (dataChannel, call) => {\n    const callId = String(call?.call_id || '').trim();\n    const name = String(call?.name || '').trim();\n    if (!callId || !name) return;\n\n    let args = {};\n    try { args = call?.arguments ? JSON.parse(call.arguments) : {}; } catch {\n      args = null;\n    }\n\n    let output;\n    if (!args || typeof args !== 'object' || Array.isArray(args)) {\n      output = JSON.stringify({ error: 'tool_arguments_invalid' });\n    } else {\n      try {\n        const result = await fetchJson('/api/realtime/tool', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json', ...authHeaders() },\n          body: JSON.stringify({ name, arguments: args }),\n        }, 30000);\n        output = String(result?.output ?? JSON.stringify(result ?? null));\n      } catch (err) {\n        await logClientError('realtime-tool', err);\n        const status = Number(err?.status || err?.statusCode || 0);\n        const message = String(err?.message || '');\n        if (status === 401 || status === 403) {\n          output = JSON.stringify({ error: 'authentication_required' });\n        } else if (status === 429 || /429|rate.?limit|too many requests/i.test(message)) {\n          output = JSON.stringify({ error: 'service_busy' });\n        } else {\n          output = JSON.stringify({ error: 'tool_failed' });\n        }\n      }\n    }\n\n    if (dataChannel?.readyState !== 'open') return;\n    dataChannel.send(JSON.stringify({\n      type: 'conversation.item.create',\n      item: { type: 'function_call_output', call_id: callId, output },\n    }));\n    dataChannel.send(JSON.stringify({ type: 'response.create' }));\n  };`;

if (!source.includes('const dispatchRealtimeToolCall = async')) {
  if (!source.includes(helperAnchor)) throw new Error('Realtime client tool helper anchor not found');
  source = source.replace(helperAnchor, helper);
}

const messageAnchor = "          if (message.type === 'input_audio_buffer.speech_started') setStatus('listening');";
const messagePatch = `          if (message.type === 'response.function_call_arguments.done') {\n            void dispatchRealtimeToolCall(dataChannel, message);\n          } else if (message.type === 'input_audio_buffer.speech_started') setStatus('listening');`;
if (!source.includes("message.type === 'response.function_call_arguments.done'")) {
  if (!source.includes(messageAnchor)) throw new Error('Realtime client message anchor not found');
  source = source.replace(messageAnchor, messagePatch);
}

// FINAL BUILD-TIME GUARD: the browser must never call OpenAI's WebRTC
// endpoint directly. The authenticated same-origin proxy owns the upstream
// Authorization header. This runs after the other realtime client patches so
// a later patch cannot accidentally restore the browser-direct request.
const proxiedAnswerCall = "const answerResponse = await fetch('/api/realtime/webrtc-answer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), 'X-Mike-Realtime-Token': realtimeClientSecret }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });";
const directUrl = 'https://api.openai.com/v1/realtime/calls';

if (source.includes(directUrl)) {
  const directCallPattern = /const\s+form\s*=\s*new\s+FormData\(\);\s*form\.append\(['"]sdp['"],\s*new\s+Blob\(\[pc\.localDescription\.sdp\],\s*\{\s*type:\s*['"]application\/sdp['"]\s*\}\)\);\s*const\s+answerResponse\s*=\s*await\s+fetch\(['"]https:\/\/api\.openai\.com\/v1\/realtime\/calls['"][\s\S]*?\);/;
  if (directCallPattern.test(source)) {
    source = source.replace(directCallPattern, proxiedAnswerCall);
  } else {
    throw new Error('[realtime] browser-direct WebRTC call detected but could not be safely replaced');
  }
}

if (source.includes(directUrl)) {
  throw new Error('[realtime] refusing to build with a browser-direct OpenAI WebRTC call');
}
if (!source.includes("fetch('/api/realtime/webrtc-answer'")) {
  throw new Error('[realtime] same-origin WebRTC proxy call was not installed');
}
if (!source.includes('const realtimeClientSecret =')) {
  throw new Error('[realtime] realtime client secret guard was not installed');
}
if (source.includes('X-Mike-Realtime-Token\': tokenData.token')) {
  throw new Error('[realtime] refusing to build with an unguarded realtime token header');
}

fs.writeFileSync(target, source);
console.log('[build] OpenAI Realtime client tool dispatch ready; canonical speech token endpoint enforced; guarded ephemeral secret propagation; browser-direct WebRTC disabled');
