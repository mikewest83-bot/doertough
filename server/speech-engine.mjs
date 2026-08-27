import OpenAI from 'openai';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { REALTIME_TOOLS } from './realtime-tools.mjs';

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const CUSTOM_VOICE_ID = String(process.env.OPENAI_REALTIME_CUSTOM_VOICE_ID || '').trim();
const REALTIME_VOICE = CUSTOM_VOICE_ID ? { id: CUSTOM_VOICE_ID } : (process.env.OPENAI_REALTIME_VOICE || 'marin');
const ENGINE_NAME = 'Mike AI OpenAI Realtime';

const requireKey = (key, name) => {
  if (!key) throw new Error(`${name}_not_configured`);
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const REALTIME_INSTRUCTIONS = `${MIKE_INSTRUCTIONS}\n\nVOICE CONVERSATION MODE:\nKeep spoken responses natural, concise, confident, and easy to say aloud. Speak a little faster than average, but stay clear. Use a warm, masculine American conversational delivery with subtle Southern character. Sound like a real person talking one-on-one, not a radio announcer or assistant. Do not use markdown-heavy formatting in speech. Do not mention the underlying model, API, or voice provider.\n\nVOICE TOOL RULES:\nYou have access to the same public tool capabilities as Mike's text experience. Use an available tool when it is the appropriate source of truth instead of guessing. Never claim a tool result you did not receive. Never expose private owner-only business or trading data. If a tool fails, say you could not confirm the information rather than inventing it.`;

export async function initializeSpeechEngine() {
  if (!openai) {
    console.warn('[realtime] disabled: OPENAI_API_KEY is not configured');
    return null;
  }
  const voiceLabel = CUSTOM_VOICE_ID ? `custom:${CUSTOM_VOICE_ID}` : String(REALTIME_VOICE);
  console.log(`[realtime] OpenAI Realtime ready: model=${REALTIME_MODEL}, voice=${voiceLabel}, tools=${REALTIME_TOOLS.length}`);
  return ENGINE_NAME;
}

export async function getSpeechEngineToken() {
  requireKey(process.env.OPENAI_API_KEY, 'openai');
  if (!openai) throw new Error('openai_client_missing');

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: REALTIME_INSTRUCTIONS,
        tools: REALTIME_TOOLS,
        tool_choice: 'auto',
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: REALTIME_VOICE,
            speed: 1.1,
          },
        },
        output_modalities: ['audio'],
        max_output_tokens: 1200,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`openai_realtime_client_secret_${response.status}: ${raw.slice(0, 700)}`);
  }

  const data = JSON.parse(raw);
  if (!data.value) throw new Error('openai_realtime_client_secret_missing');

  const voiceLabel = CUSTOM_VOICE_ID ? `custom:${CUSTOM_VOICE_ID}` : String(REALTIME_VOICE);
  console.log(`[realtime] ephemeral client secret created for ${REALTIME_MODEL}/${voiceLabel} with ${REALTIME_TOOLS.length} public tools`);
  return {
    token: data.value,
    agentId: REALTIME_MODEL,
    transport: 'openai-webrtc',
  };
}

export { ENGINE_NAME, REALTIME_MODEL, REALTIME_VOICE };