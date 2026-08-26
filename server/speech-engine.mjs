import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import OpenAI from 'openai';
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';

const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status', 'get_btc_rsi']);
const VOICE_TOOLS = [...LIVE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS].filter((t) => !OWNER_ONLY_TOOLS.has(t.name));
const VOICE_TOOL_HANDLERS = { ...LIVE_TOOL_HANDLERS, ...BUSINESS_TOOL_HANDLERS, ...FREE_TOOL_HANDLERS, ...FIELD_TOOL_HANDLERS };
const ENGINE_NAME = 'Mike AI Realtime Voice v2';
const PUBLIC_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
const WS_PATH = '/speech-engine';
const ENGINE_WS_URL = `${PUBLIC_URL.replace(/^http/, 'ws')}${WS_PATH}`;
const MIKE_TTS = { model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5', stability: 0.52, speed: 1.1, similarity_boost: 0.85, optimize_streaming_latency: 3, output_format: 'pcm_24000' };
const MIKE_TURN = { turn_timeout: 5, silence_end_call_timeout: -1, turn_eagerness: 'normal', mode: 'turn' };
const requireKey = (key, name) => { if (!key) throw new Error(`${name}_not_configured`); };
const elevenlabs = process.env.ELEVENLABS_API_KEY ? new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function configuredVoiceId() {
  const id = String(process.env.ELEVENLABS_VOICE_ID || '').trim();
  if (!id) throw new Error('elevenlabs_voice_id_not_configured');
  return id;
}

async function respondToTranscript(transcript, signal, session) {
  requireKey(process.env.OPENAI_API_KEY, 'openai');
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  if (!openai || !elevenlabs) throw new Error('voice_dependencies_missing');
  const instructions = MIKE_INSTRUCTIONS + '\n\nVOICE CONVERSATION MODE: Keep spoken responses natural, concise, upbeat, and easy to say aloud. Do not use markdown-heavy formatting. Do not mention that another service is generating your voice.';
  let input = transcript.map((item) => ({ role: item.role === 'agent' ? 'assistant' : 'user', content: item.content }));
  let text = '';
  for (let round = 0; round < 4; round += 1) {
    const response = await openai.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', instructions, input, tools: VOICE_TOOLS }, { signal });
    const calls = (response.output || []).filter((item) => item.type === 'function_call');
    if (!calls.length) { text = response.output_text?.trim() || ''; break; }
    input = [...input, ...response.output];
    for (const call of calls) {
      let args = {}; try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch {}
      const handler = VOICE_TOOL_HANDLERS[call.name]; let output;
      try { output = handler ? await handler(args) : { error: `Unknown tool \"${call.name}\".` }; } catch (toolErr) { console.error(`[speech-engine] voice tool ${call.name} failed:`, toolErr.message || toolErr); output = { error: toolErr.message || 'tool_unavailable' }; }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  const finalText = text || 'Sorry, I hit a snag pulling that up. Try asking again.';
  // Use ElevenLabs streaming TTS directly so the configured personal/cloned voice is
  // independent of the upstream custom Speech Engine voice restrictions.
  const audio = await elevenlabs.textToSpeech.convert(configuredVoiceId(), { text: finalText, modelId: MIKE_TTS.model_id, outputFormat: 'pcm_24000', voiceSettings: { stability: MIKE_TTS.stability, similarityBoost: MIKE_TTS.similarity_boost, speed: MIKE_TTS.speed } });
  if (typeof session.sendAudio === 'function') {
    for await (const chunk of audio) session.sendAudio(chunk);
  } else if (typeof session.sendResponse === 'function') {
    await session.sendResponse(finalText);
  }
}

export async function initializeSpeechEngine(httpServer) {
  if (!elevenlabs || !process.env.OPENAI_API_KEY) { console.warn('[speech-engine] disabled: missing ELEVENLABS_API_KEY or OPENAI_API_KEY'); return null; }
  // Realtime transport remains responsible for capture/turn-taking; the configured
  // ElevenLabs voice is generated directly through TTS after OpenAI produces each turn.
  console.log(`[speech-engine] custom-voice realtime path ready at ${ENGINE_WS_URL}`);
  return ENGINE_NAME;
}

export async function getSpeechEngineToken() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  return { token: null, agentId: null, mode: 'custom-voice-tts' };
}

export { ENGINE_NAME };