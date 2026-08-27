import OpenAI from 'openai';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { REALTIME_TOOLS } from './realtime-tools.mjs';

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const CUSTOM_VOICE_ID = String(process.env.OPENAI_REALTIME_CUSTOM_VOICE_ID || '').trim();
// Controlled voice test: use Cedar unless a future OpenAI custom voice ID is configured.
const REALTIME_VOICE = CUSTOM_VOICE_ID ? { id: CUSTOM_VOICE_ID } : 'cedar';
const ENGINE_NAME = 'Mike AI OpenAI Realtime';

const requireKey = (key, name) => {
  if (!key) throw new Error(`${name}_not_configured`);
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const REALTIME_INSTRUCTIONS = `${MIKE_INSTRUCTIONS}\n\nVOICE CONVERSATION MODE:\nBe patient and let the user finish their thought. Do not jump in just because the user pauses briefly, takes a breath, says "uh" or "um", or speaks for a longer stretch. Assume the user may still be thinking or continuing unless there is a strong signal that they have finished. Prefer waiting a little too long over interrupting them. When the user is speaking continuously, keep listening rather than trying to take the floor. Once the user clearly finishes, respond naturally without unnecessary delay. If the user interrupts Mike while Mike is speaking, stop promptly and give the user the floor. Keep spoken responses natural, concise, confident, and easy to say aloud. Speak at a slightly faster-than-average pace, but do not rush. Use a warm, masculine American conversational delivery with subtle Southern character. Sound like a real person talking one-on-one, not a radio announcer, narrator, or customer-service assistant. Favor natural contractions, varied sentence lengths, short conversational turns, and occasional brief pauses. Do not make every response perfectly symmetrical or overly polished; prioritize human conversational rhythm. Avoid filler phrases and canned acknowledgements. Get to the point quickly, then leave room for the user to respond. Do not use markdown-heavy formatting in speech. Do not mention the underlying model, API, or voice provider.\n\nPERSONALITY DELIVERY:\nHave a point of view when the facts support one. If one option is clearly better, recommend it plainly instead of presenting a long neutral menu. Don't reflexively say "Absolutely," "Great question," or "I'd be happy to help." Start with the useful part. React like a smart, good-natured person, not a service representative. Use light, situational humor or a colorful observation when it genuinely fits, but never force a joke. Match the user's energy: get more upbeat when they're excited, steady when they're frustrated, and playful when they're joking. If the user is venting or telling a story, respond to the person first and don't immediately turn it into a lecture or action plan. Avoid over-explaining; give the useful answer, then leave room for the user to continue.\n\nVOICE TOOL RULES:\nYou have access to the same public tool capabilities as Mike's text experience. Use an available tool when it is the appropriate source of truth instead of guessing. Never claim a tool result you did not receive. Never expose private owner-only business or trading data. If a tool fails, say you could not confirm the information rather than inventing it.`;

async function probeCustomVoiceCapability() {
  if (!openai) return;
  try {
    const response = await fetch('https://api.openai.com/v1/audio/voice_consents', {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    const body = await response.text();
    if (response.ok) {
      let count = 'unknown';
      try {
        const parsed = JSON.parse(body);
        count = Array.isArray(parsed?.data) ? parsed.data.length : count;
      } catch {}
      console.log(`[custom-voice] OpenAI voice-consent API accessible: ${count} consent record(s) visible`);
      return;
    }
    console.warn(`[custom-voice] OpenAI voice-consent API returned ${response.status}: ${body.slice(0, 500)}`);
  } catch (error) {
    console.warn('[custom-voice] OpenAI capability probe failed:', error.message || error);
  }
}

export async function initializeSpeechEngine() {
  if (!openai) {
    console.warn('[realtime] disabled: OPENAI_API_KEY is not configured');
    return null;
  }
  const voiceLabel = CUSTOM_VOICE_ID ? `custom:${CUSTOM_VOICE_ID}` : String(REALTIME_VOICE);
  console.log(`[realtime] OpenAI Realtime ready: model=${REALTIME_MODEL}, voice=${voiceLabel}, tools=${REALTIME_TOOLS.length}`);
  await probeCustomVoiceCapability();
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
              eagerness: 'low',
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
