import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import OpenAI from 'openai';
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';

const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status']);
const VOICE_TOOLS = [...LIVE_TOOLS, ...BUSINESS_TOOLS].filter((t) => !OWNER_ONLY_TOOLS.has(t.name));
const ENGINE_NAME = 'Mike AI Realtime Voice v2';
const PUBLIC_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
const WS_PATH = '/speech-engine';
const ENGINE_WS_URL = `${PUBLIC_URL.replace(/^http/, 'ws')}${WS_PATH}`;
const MIKE_VOICE_DESCRIPTION = 'A confident, friendly American male in his 40s with a natural Southern country accent. Blue-collar, hardworking, upbeat, warm and conversational. Deep but clear voice, slightly fast pace, excellent enunciation, natural pauses, sounds like a real Southern guy talking one-on-one. Never exaggerated, cartoonish, or announcer-like.';
const MIKE_VOICE_TEXT = 'Listen, we are going to keep this simple. Do the work, stay tough, and keep moving forward. You do not have to have everything figured out today. Just take the next step and let us get it done.';

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
    body: JSON.stringify({ model_id: 'eleven_multilingual_ttv_v2', voice_description: MIKE_VOICE_DESCRIPTION, text: MIKE_VOICE_TEXT, auto_generate_text: false, quality: 0.9, guidance_scale: 5 }),
  });
  const designRaw = await designResponse.text();
  if (!designResponse.ok) throw new Error(`elevenlabs_voice_design_${designResponse.status}: ${designRaw.slice(0, 500)}`);
  const generatedVoiceId = JSON.parse(designRaw)?.previews?.[0]?.generated_voice_id;
  if (!generatedVoiceId) throw new Error('elevenlabs_voice_design_returned_no_preview');

  const createResponse = await fetch('https://api.elevenlabs.io/v1/text-to-voice', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_name: 'Mike AI - Doer Tough', voice_description: MIKE_VOICE_DESCRIPTION, generated_voice_id: generatedVoiceId, labels: { accent: 'American', gender: 'male', use_case: 'conversational', character: 'Mike AI' } }),
  });
  const createRaw = await createResponse.text();
  if (!createResponse.ok) throw new Error(`elevenlabs_voice_create_${createResponse.status}: ${createRaw.slice(0, 500)}`);
  const voiceId = JSON.parse(createRaw)?.voice_id;
  if (!voiceId) throw new Error('elevenlabs_voice_create_returned_no_voice_id');
  console.log(`[speech-engine] created compatible generated Mike voice ${voiceId}`);
  return voiceId;
}

async function chooseGeneratedVoice() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100&category=generated', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!response.ok) throw new Error(`elevenlabs_generated_voice_list_${response.status}`);
  const data = await response.json();
  const voices = (data.voices || []).map((voice) => {
    const labels = voice.labels || {};
    const text = `${voice.name || ''} ${voice.description || ''} ${JSON.stringify(labels)}`.toLowerCase();
    let score = 0;
    if (/mike ai|doer tough/.test(text)) score += 200;
    if (labels.gender === 'male' || /\bmale\b/.test(text)) score += 50;
    if (/southern|country|texas|american/.test(text)) score += 35;
    if (/deep|raspy|gravel|warm|confident|conversational|natural|friendly/.test(text)) score += 15;
    return { voice, score };
  }).sort((a, b) => b.score - a.score);
  if (voices[0]?.voice?.voice_id) return voices[0].voice.voice_id;
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
      cachedCompatibleVoiceId = configured;
      console.log(`[speech-engine] configured voice is compatible: ${configured} (${voice.category || type || 'unknown'})`);
      return cachedCompatibleVoiceId;
    }
    console.warn(`[speech-engine] configured voice ${configured} is not compatible with custom LLM Speech Engine. Switching to a generated voice.`);
  }
  cachedCompatibleVoiceId = await chooseGeneratedVoice();
  console.log(`[speech-engine] selected compatible generated voice ${cachedCompatibleVoiceId}`);
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
  console.log(`[speech-engine] verified compatible TTS voice for ${engineId}: ${actualVoiceId}`);
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
async function respondToTranscript(transcript, signal, session) {
  requireKey(process.env.OPENAI_API_KEY, 'openai');
  if (!openai) throw new Error('openai_client_missing');
  const response = await openai.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', instructions: MIKE_INSTRUCTIONS + '\n\nVOICE CONVERSATION MODE: Keep spoken responses natural, concise, and easy to say aloud. Do not use markdown-heavy formatting. Do not mention that another service is generating your voice.', input: transcriptToInput(transcript), tools: VOICE_TOOLS, stream: true, signal });
  await session.sendResponse(response);
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
