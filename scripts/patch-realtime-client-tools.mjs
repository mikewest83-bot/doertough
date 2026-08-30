import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

source = source.replaceAll("fetchJson('/api/speech/session'", "fetchJson('/api/speech/token'");

const tokenLine = "      const tokenData = await fetchJson('/api/speech/token', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}' }, 20000);";
const tokenGuard = "      const realtimeClientSecret = String(tokenData?.token ?? tokenData?.value ?? tokenData?.client_secret?.value ?? '').trim();\n      if (!realtimeClientSecret || realtimeClientSecret === 'undefined' || realtimeClientSecret === 'null') throw new Error('realtime_client_secret_missing');";
if (!source.includes('const realtimeClientSecret =')) {
  if (!source.includes(tokenLine)) throw new Error('[realtime] token route anchor not found');
  source = source.replace(tokenLine, tokenLine + '\n' + tokenGuard);
}

const helperAnchor = "  const logClientError = async (phase, err) => { console.error(`[voice] ${phase}:`, err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.stack || '' }) }); } catch {} };";
if (!source.includes('const dispatchRealtimeToolCall = async')) {
  if (!source.includes(helperAnchor)) throw new Error('[realtime] tool helper anchor not found');
  const helper = `${helperAnchor}\n  const dispatchRealtimeToolCall = async (dataChannel, call) => {\n    const callId = String(call?.call_id || '').trim();\n    const name = String(call?.name || '').trim();\n    if (!callId || !name) return;\n    let args = {};\n    try { args = call?.arguments ? JSON.parse(call.arguments) : {}; } catch { args = null; }\n    let output;\n    if (!args || typeof args !== 'object' || Array.isArray(args)) output = JSON.stringify({ error: 'tool_arguments_invalid' });\n    else {\n      try {\n        const result = await fetchJson('/api/realtime/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, arguments: args }) }, 30000);\n        output = String(result?.output ?? JSON.stringify(result ?? null));\n      } catch (err) {\n        await logClientError('realtime-tool', err);\n        const status = Number(err?.status || 0);\n        output = JSON.stringify({ error: status === 401 || status === 403 ? 'authentication_required' : status === 429 ? 'service_busy' : 'tool_failed' });\n      }\n    }\n    if (dataChannel?.readyState !== 'open') return;\n    dataChannel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } }));\n    dataChannel.send(JSON.stringify({ type: 'response.create' }));\n  };`;
  source = source.replace(helperAnchor, helper);
}

const messageAnchor = "          if (message.type === 'input_audio_buffer.speech_started') setStatus('listening');";
if (!source.includes("message.type === 'response.function_call_arguments.done'")) {
  if (!source.includes(messageAnchor)) throw new Error('[realtime] message handler anchor not found');
  source = source.replace(messageAnchor, "          if (message.type === 'response.function_call_arguments.done') { void dispatchRealtimeToolCall(dataChannel, message); } else if (message.type === 'input_audio_buffer.speech_started') setStatus('listening');");
}

const directUrl = 'https://api.openai.com/v1/realtime/calls';
if (source.includes(directUrl)) {
  const start = source.lastIndexOf('      const answerResponse = await fetch(', source.indexOf(directUrl));
  const end = source.indexOf('      await pc.setRemoteDescription(', start);
  if (start < 0 || end < 0) throw new Error('[realtime] browser-direct WebRTC boundaries not found');
  const replacement = "      const answerResponse = await fetch('/api/realtime/webrtc-answer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), 'X-Mike-Realtime-Token': realtimeClientSecret }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });\n      const answer = await answerResponse.text(); if (!answerResponse.ok) throw new Error(`OpenAI realtime call failed (${answerResponse.status}): ${answer.slice(0, 500)}`);\n";
  source = source.slice(0, start) + replacement + source.slice(end);
}

if (source.includes(directUrl)) throw new Error('[realtime] refusing to build with a browser-direct OpenAI WebRTC call');
if (!source.includes("fetch('/api/realtime/webrtc-answer'")) throw new Error('[realtime] same-origin WebRTC proxy call was not installed');
if (!source.includes('const realtimeClientSecret =')) throw new Error('[realtime] realtime client secret guard was not installed');

fs.writeFileSync(target, source);
console.log('[build] Realtime client tool dispatch ready; guarded ephemeral secret propagation; browser-direct WebRTC disabled');
