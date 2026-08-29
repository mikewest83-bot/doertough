// Build-time, idempotent bridge for OpenAI Realtime function calls.
// The Realtime model can request a tool over the WebRTC data channel, but
// business logic must stay server-side. This patch teaches the browser to
// forward authenticated tool calls to /api/realtime/tool and return the
// result to the Realtime conversation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const helperAnchor = "  const logClientError = async (phase, err) => { console.error(`[voice] ${phase}:`, err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.stack || '' }) }); } catch {} };";
const helper = `${helperAnchor}\n  const dispatchRealtimeToolCall = async (dataChannel, call) => {\n    const callId = String(call?.call_id || '').trim();\n    const name = String(call?.name || '').trim();\n    if (!callId || !name) return;\n\n    let args = {};\n    try { args = call?.arguments ? JSON.parse(call.arguments) : {}; } catch {\n      args = null;\n    }\n\n    let output;\n    if (!args || typeof args !== 'object' || Array.isArray(args)) {\n      output = JSON.stringify({ error: 'tool_arguments_invalid' });\n    } else {\n      try {\n        const result = await fetchJson('/api/realtime/tool', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json', ...authHeaders() },\n          body: JSON.stringify({ name, arguments: args }),\n        }, 30000);\n        output = String(result?.output ?? JSON.stringify(result ?? null));\n      } catch (err) {\n        await logClientError('realtime-tool', err);\n        output = JSON.stringify({ error: err?.message || 'tool_failed' });\n      }\n    }\n\n    if (dataChannel?.readyState !== 'open') return;\n    dataChannel.send(JSON.stringify({\n      type: 'conversation.item.create',\n      item: { type: 'function_call_output', call_id: callId, output },\n    }));\n    dataChannel.send(JSON.stringify({ type: 'response.create' }));\n  };`;

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

fs.writeFileSync(target, source);
console.log('[build] OpenAI Realtime client tool dispatch ready');
