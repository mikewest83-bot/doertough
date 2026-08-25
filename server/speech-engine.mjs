import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import OpenAI from 'openai';
import { LIVE_TOOLS, LIVE_TOOL_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';

const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status']);
const VOICE_TOOLS = [...LIVE_TOOLS, ...BUSINESS_TOOLS].filter((t) => !OWNER_ONLY_TOOLS.has(t.name));
const VOICE_HANDLERS = { ...LIVE_TOOL_HANDLERS, ...BUSINESS_TOOL_HANDLERS };
const ENGINE_NAME = 'Mike AI Realtime Voice v2';
const PUBLIC_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
const WS_PATH = '/speech-engine';
const ENGINE_WS_URL = `${PUBLIC_URL.replace(/^http/, 'ws')}${WS_PATH}`;

const requireKey = (key, name) => {
  if (!key) throw new Error(`${name}_not_configured`);
};

const elevenlabs = process.env.ELEVENLABS_API_KEY
  ? new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
  : null;
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

let cachedEngineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID || null;

async function resolveVoiceId() {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');
  const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=non-default', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
  if (!response.ok) throw new Error(`elevenlabs_voice_list_${response.status}`);
  const data = await response.json();
  const voices = (data.voices || []).map((voice) => {
    const text = `${voice.name || ''} ${voice.description || ''} ${JSON.stringify(voice.labels || {})}`.toLowerCase();
    let score = 0;
    if (/mike/.test(text)) score += 100;
    if (/diesel|bin/.test(text)) score += 80;
    if (/doer|tough/.test(text)) score += 60;
    if (/southern|country|texas|american/.test(text)) score += 25;
    if (['personal', 'cloned', 'generated'].includes(voice.category) || voice.voice_type === 'personal') score += 20;
    return { voice, score };
  }).sort((a, b) => b.score - a.score);
  if (!voices.length) throw new Error('elevenlabs_no_suitable_voice');
  return voices[0].voice.voice_id;
}

async function syncAndVerifyEngine(engineId) {
  const headers = {
    'xi-api-key': process.env.ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
  };
  const url = `https://api.elevenlabs.io/v1/speech-engine/${encodeURIComponent(engineId)}`;

  const updateResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ speech_engine: { ws_url: ENGINE_WS_URL } }),
  });

  if (!updateResponse.ok) {
    const raw = await updateResponse.text();
    throw new Error(`speech_engine_update_${updateResponse.status}: ${raw.slice(0, 400)}`);
  }

  const updated = await updateResponse.json().catch(() => null);
  const actualUrl = updated?.speech_engine?.ws_url || null;
  if (actualUrl !== ENGINE_WS_URL) {
    throw new Error(`speech_engine_ws_url_mismatch: expected=${ENGINE_WS_URL} actual=${actualUrl || 'missing'}`);
  }

  console.log(`[speech-engine] verified upstream URL for ${engineId}: ${actualUrl}`);
  return engineId;
}

async function ensureEngine() {
  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');

  if (cachedEngineId) {
    return syncAndVerifyEngine(cachedEngineId);
  }

  const headers = {
    'xi-api-key': process.env.ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
  };
  const searchUrl = `https://api.elevenlabs.io/v1/speech-engine?page_size=100&search=${encodeURIComponent(ENGINE_NAME)}`;
  const listResponse = await fetch(searchUrl, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (listResponse.ok) {
    const data = await listResponse.json();
    const existing = (data.speech_engines || []).find((item) => item.name === ENGINE_NAME);
    if (existing?.speech_engine_id) {
      cachedEngineId = existing.speech_engine_id;
      return syncAndVerifyEngine(cachedEngineId);
    }
  }

  const voiceId = await resolveVoiceId();
  const createResponse = await fetch('https://api.elevenlabs.io/v1/speech-engine', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: ENGINE_NAME,
      speech_engine: { ws_url: ENGINE_WS_URL },
      asr: { quality: 'high', provider: 'elevenlabs', user_input_audio_format: 'pcm_16000' },
      tts: {
        model_id: 'eleven_flash_v2',
        voice_id: voiceId,
        agent_output_audio_format: 'pcm_24000',
        optimize_streaming_latency: 3,
        stability: 0.55,
        speed: 1.08,
        similarity_boost: 0.85,
      },
      turn: { turn_timeout: 7, silence_end_call_timeout: -1, turn_eagerness: 'normal', mode: 'turn' },
      vad: { background_voice_detection: false },
      conversation: { max_duration_seconds: 600, client_events: ['audio', 'interruption', 'agent_response', 'user_transcript'] },
      language: 'en',
      tags: ['mike-ai', 'doer-tough', 'production'],
      overrides: { first_message: false },
    }),
  });
  const raw = await createResponse.text();
  if (!createResponse.ok) throw new Error(`speech_engine_create_${createResponse.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  cachedEngineId = data.speech_engine_id;
  console.log(`[speech-engine] created ${cachedEngineId} with upstream ${ENGINE_WS_URL}`);
  return cachedEngineId;
}

function transcriptToInput(transcript) {
  return transcript.map((item) => ({
    role: item.role === 'agent' ? 'assistant' : 'user',
    content: item.content,
  }));
}

async function respondToTranscript(transcript, signal, session) {
  requireKey(process.env.OPENAI_API_KEY, 'openai');
  if (!openai) throw new Error('openai_client_missing');

  const input = transcriptToInput(transcript);
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: MIKE_INSTRUCTIONS + '\n\nVOICE CONVERSATION MODE: Keep spoken responses natural, concise, and easy to say aloud. Do not use markdown-heavy formatting. Do not mention that another service is generating your voice.',
    input,
    tools: VOICE_TOOLS,
    stream: true,
    signal,
  });

  await session.sendResponse(response);
}

export async function initializeSpeechEngine(httpServer) {
  if (!elevenlabs || !process.env.OPENAI_API_KEY) {
    console.warn('[speech-engine] disabled: missing ELEVENLABS_API_KEY or OPENAI_API_KEY');
    return null;
  }

  const engineId = await ensureEngine();
  const engine = await elevenlabs.speechEngine.get(engineId);

  await engine.attach(httpServer, WS_PATH, {
    debug: true,
    onInit: (conversationId) => console.log(`[speech-engine] session ${conversationId}`),
    onTranscript: async (transcript, signal, session) => {
      try {
        await respondToTranscript(transcript, signal, session);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('[speech-engine] response failed:', error?.message || error);
      }
    },
    onClose: (session) => console.log(`[speech-engine] closed ${session?.conversationId || ''}`),
    onDisconnect: (session) => console.warn(`[speech-engine] disconnected ${session?.conversationId || ''}`),
    onError: (error, session) => console.error('[speech-engine] error:', error?.message || error, session?.conversationId || ''),
  });

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
