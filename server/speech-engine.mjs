import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import OpenAI from 'openai';
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';

const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status', 'get_btc_rsi']);
const VOICE_TOOLS = [...LIVE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS].filter(
  (t) => !OWNER_ONLY_TOOLS.has(t.name)
);
// Handlers for everything VOICE_TOOLS actually offers. Owner-only tools are
// filtered out above, so the model never sees their schema and can never
// request them by name here - this map only needs to cover what's offered.
const VOICE_TOOL_HANDLERS = {
  ...LIVE_TOOL_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
};
const ENGINE_NAME = 'Mike AI Realtime Voice v2';
const PUBLIC_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
const WS_PATH = '/speech-engine';
const ENGINE_WS_URL = `${PUBLIC_URL.replace(/^http/, 'ws')}${WS_PATH}`;
const MIKE_VOICE_NAME = 'Mike AI - Doer Tough Southern';
const MIKE_VOICE_DESCRIPTION = 'A confident, friendly American man in his 40s with a thick, authentic Southern American English accent and a natural Southern drawl. Think South Carolina, Georgia, or Tennessee rather than Northern or neutral American. Blue-collar, hardworking, upbeat, warm and conversational. Deep, masculine, resonant but clear voice, slightly fast conversational pace, excellent Southern enunciation, natural pauses, relaxed country character. Sounds like a real Southern guy talking one-on-one, not a radio announcer, actor, caricature, or exaggerated cowboy.';
const MIKE_VOICE_TEXT = 'Alright, let us keep this simple. We are going to do the work, stay tough, and keep moving forward. You do not have to have everything figured out today. Take the next step, handle what is in front of you, and let us get it done.';

const requireKey = (key, name) => { if (!key) throw new Error(`${name}_not_configured`); };
const elevenlabs = process.env.ELEVENLABS_API_KEY ? new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
let cachedEngineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID || null;
let cachedCompatibleVoiceId = null;

async function getVoiceById(voiceId) {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const response = await fetch(`https://api.elevenlabs.io/v2/voices?voice_ids=${encodeURIComponent(voiceId)}&page_size=1`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!response.ok) throw new Error(`elevenlabs_voice_lookup_${response.status}`);
  return (await response.json()).voices?.[0] || null;
}

async function createMikeGeneratedVoice() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const designResponse = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: 'eleven_multilingual_ttv_v2', voice_description: MIKE_VOICE_DESCRIPTION, text: MIKE_VOICE_TEXT, auto_generate_text: false, quality: 0.9, guidance_scale: 8 }),
  });
  const designRaw = await designResponse.text();
  if (!designResponse.ok) throw new Error(`elevenlabs_voice_design_${designResponse.status}: ${designRaw.slice(0, 500)}`);
  const generatedVoiceId = JSON.parse(designRaw)?.previews?.[0]?.generated_voice_id;
  if (!generatedVoiceId) throw new Error('elevenlabs_voice_design_returned_no_preview');

  const createResponse = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_name: MIKE_VOICE_NAME, voice_description: MIKE_VOICE_DESCRIPTION, generated_voice_id: generatedVoiceId, labels: { accent: 'Southern American English', gender: 'male', use_case: 'conversational', character: 'Mike AI', region: 'South Carolina / Georgia / Tennessee' } }),
  });
  const createRaw = await createResponse.text();
  if (!createResponse.ok) throw new Error(`elevenlabs_voice_create_${createResponse.status}: ${createRaw.slice(0, 500)}`);
  const voiceId = JSON.parse(createRaw)?.voice_id;
  if (!voiceId) throw new Error('elevenlabs_voice_create_returned_no_voice_id');
  console.log(`[speech-engine] created Southern Mike voice ${voiceId}`);
  return voiceId;
}

async function chooseGeneratedVoice() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100&category=generated', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!response.ok) throw new Error(`elevenlabs_generated_voice_list_${response.status}`);
  const data = await response.json();
  const voices = data.voices || [];
  const exact = voices.find((voice) => voice.name === MIKE_VOICE_NAME);
  if (exact?.voice_id) return exact.voice_id;
  const southern = voices.filter((voice) => {
    const labels = voice.labels || {};
    const text = `${voice.name || ''} ${voice.description || ''} ${JSON.stringify(labels)}`.toLowerCase();
    return /southern|country|georgia|carolina|tennessee|texas/.test(text) && /male|man/.test(text);
  });
  if (southern[0]?.voice_id) return southern[0].voice_id;
  return createMikeGeneratedVoice();
}

async function resolveCompatibleVoiceId() {
  if (cachedCompatibleVoiceId) return cachedCompatibleVoiceId;
  const configured = process.env.ELEVENLABS_VOICE_ID;
  if (configured) {
    const voice = await getVoiceById(configured);
    const category = String(voice?.category || '').toLowerCase();
    const type = String(voice?.voice_type || '').toLowerCase();
    if (voice && !['cloned', 'personal'].includes(category) && type !== 'personal') {
      const labels = voice.labels || {};
      const description = `${voice.name || ''} ${voice.description || ''} ${JSON.stringify(labels)}`.toLowerCase();
      if (/southern|country|georgia|carolina|tennessee|texas/.test(description)) {
        cachedCompatibleVoiceId = configured;
        console.log(`[speech-engine] configured Southern voice is compatible: ${configured}`);
        return cachedCompatibleVoiceId;
      }
      console.warn(`[speech-engine] configured voice ${configured} is compatible but not explicitly Southern; using Mike Southern voice instead.`);
    } else {
      console.warn(`[speech-engine] configured voice ${configured} is not compatible with custom LLM Speech Engine. Switching to a generated voice.`);
    }
  }
  cachedCompatibleVoiceId = await chooseGeneratedVoice();
  console.log(`[speech-engine] selected Southern-compatible generated voice ${cachedCompatibleVoiceId}`);
  return cachedCompatibleVoiceId;
}

async function syncAndVerifyEngine(engineId) {
  const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' };
  const url = `https://api.elevenlabs.io/v1/speech-engine/${encodeURIComponent(engineId)}`;
  const voiceId = await resolveCompatibleVoiceId();
  const updateResponse = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ speech_engine: { ws_url: ENGINE_WS_URL }, tts: { voice_id: voiceId } }) });
  if (!updateResponse.ok) { const raw = await updateResponse.text(); throw new Error(`speech_engine_update_${updateResponse.status}: ${raw.slice(0, 500)}`); }
  const updated = await updateResponse.json().catch(() => null);
  const actualUrl = updated?.speech_engine?.ws_url || null;
  const actualVoiceId = updated?.tts?.voice_id || null;
  if (actualUrl !== ENGINE_WS_URL) throw new Error(`speech_engine_ws_url_mismatch: expected=${ENGINE_WS_URL} actual=${actualUrl || 'missing'}`);
  if (actualVoiceId !== voiceId) throw new Error(`speech_engine_voice_mismatch: expected=${voiceId} actual=${actualVoiceId || 'missing'}`);
  console.log(`[speech-engine] verified upstream URL for ${engineId}: ${actualUrl}`);
  console.log(`[speech-engine] verified Southern-compatible TTS voice for ${engineId}: ${actualVoiceId}`);
  return engineId;
}

async function ensureEngine() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  if (cachedEngineId) return syncAndVerifyEngine(cachedEngineId);
  const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' };
  const searchUrl = `https://api.elevenlabs.io/v1/speech-engine?page_size=100&search=${encodeURIComponent(ENGINE_NAME)}`;
  const listResponse = await fetch(searchUrl, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (listResponse.ok) {
    const data = await listResponse.json();
    const existing = (data.speech_engines || []).find((item) => item.name === ENGINE_NAME);
    if (existing?.speech_engine_id) { cachedEngineId = existing.speech_engine_id; return syncAndVerifyEngine(cachedEngineId); }
  }
  const voiceId = await resolveCompatibleVoiceId();
  const createResponse = await fetch('https://api.elevenlabs.io/v1/speech-engine', { method: 'POST', headers, body: JSON.stringify({ name: ENGINE_NAME, speech_engine: { ws_url: ENGINE_WS_URL }, asr: { quality: 'high', provider: 'elevenlabs', user_input_audio_format: 'pcm_16000' }, tts: { model_id: 'eleven_flash_v2', voice_id: voiceId, agent_output_audio_format: 'pcm_24000', optimize_streaming_latency: 3, stability: 0.55, speed: 1.08, similarity_boost: 0.85 }, turn: { turn_timeout: 7, silence_end_call_timeout: -1, turn_eagerness: 'normal', mode: 'turn' }, vad: { background_voice_detection: false }, conversation: { max_duration_seconds: 600, client_events: ['audio', 'interruption', 'agent_response', 'user_transcript'] }, language: 'en', tags: ['mike-ai', 'doer-tough', 'production'], overrides: { first_message: false } }) });
  const raw = await createResponse.text();
  if (!createResponse.ok) throw new Error(`speech_engine_create_${createResponse.status}: ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw); cachedEngineId = data.speech_engine_id;
  console.log(`[speech-engine] created ${cachedEngineId} with upstream ${ENGINE_WS_URL}`);
  return cachedEngineId;
}

function transcriptToInput(transcript) { return transcript.map((item) => ({ role: item.role === 'agent' ? 'assistant' : 'user', content: item.content })); }

// Real voice tool-calling. This was previously missing entirely: the model
// was handed the full VOICE_TOOLS list and would sometimes answer with a
// tool call instead of text. sendResponse's stream reader only extracts
// text deltas (confirmed against the SDK source - it has no concept of a
// function_call event), so a tool-call-only turn produced zero speakable
// chunks and the conversation went silent while still listening. Adding
// FREE_TOOLS/FIELD_TOOLS earlier made this far more likely to trigger, since
// the model now has many more reasons to reach for a tool mid-conversation.
//
// Same round-capped tool loop already proven in the /api/ask route in
// index.mjs, adapted to end in a spoken response instead of a JSON one.
async function respondToTranscript(transcript, signal, session) {
  requireKey(process.env.OPENAI_API_KEY, 'openai');
  if (!openai) throw new Error('openai_client_missing');

  const instructions =
    MIKE_INSTRUCTIONS +
    '\n\nVOICE CONVERSATION MODE: Keep spoken responses natural, concise, and easy to say aloud. Do not use markdown-heavy formatting. Do not mention that another service is generating your voice.';

  let input = transcriptToInput(transcript);
  let text = '';

  for (let round = 0; round < 4; round += 1) {
    const response = await openai.responses.create(
      { model: process.env.OPENAI_MODEL || 'gpt-4o-mini', instructions, input, tools: VOICE_TOOLS },
      { signal }
    );

    const calls = (response.output || []).filter((item) => item.type === 'function_call');

    if (!calls.length) {
      text = response.output_text?.trim() || '';
      break;
    }

    console.log(`[speech-engine] voice tool round ${round + 1}: ${calls.map((c) => c.name).join(', ')}`);

    // Carry the model's own tool-call turn forward so it has that context
    // when it sees the results next round.
    input = [...input, ...response.output];

    for (const call of calls) {
      let args = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        // leave args empty; the handler errors on missing required fields
      }

      const handler = VOICE_TOOL_HANDLERS[call.name];
      let output;
      try {
        output = handler ? await handler(args) : { error: `Unknown tool "${call.name}".` };
      } catch (toolErr) {
        console.error(`[speech-engine] voice tool ${call.name} failed:`, toolErr.message || toolErr);
        output = { error: toolErr.message || 'tool_unavailable' };
      }

      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }

  // Every round produced a tool call with nothing left to say, or the model
  // otherwise came back empty - speak SOMETHING rather than leaving the
  // caller in silence again.
  await session.sendResponse(text || "Sorry, I hit a snag pulling that up. Try asking again.");
}

export async function initializeSpeechEngine(httpServer) {
  if (!elevenlabs || !process.env.OPENAI_API_KEY) { console.warn('[speech-engine] disabled: missing ELEVENLABS_API_KEY or OPENAI_API_KEY'); return null; }
  const engineId = await ensureEngine();
  const engine = await elevenlabs.speechEngine.get(engineId);
  await engine.attach(httpServer, WS_PATH, { debug: true, onInit: (conversationId) => console.log(`[speech-engine] session ${conversationId}`), onTranscript: async (transcript, signal, session) => { try { await respondToTranscript(transcript, signal, session); } catch (error) { if (error?.name !== 'AbortError') console.error('[speech-engine] response failed:', error?.message || error); } }, onClose: (session) => console.log(`[speech-engine] closed ${session?.conversationId || ''}`), onDisconnect: (session) => console.warn(`[speech-engine] disconnected ${session?.conversationId || ''}`), onError: (error, session) => console.error('[speech-engine] error:', error?.message || error, session?.conversationId || '') });
  console.log(`[speech-engine] attached at ${ENGINE_WS_URL}`);
  return engineId;
}

export async function getSpeechEngineToken() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const engineId = await ensureEngine();
  const result = await elevenlabs.conversationalAi.conversations.getWebrtcToken({ agentId: engineId });
  return { token: result.token, agentId: engineId };
}

export { ENGINE_NAME };
