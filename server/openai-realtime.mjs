// OpenAI Realtime voice bridge for Mike AI.
// This is intentionally additive: ElevenLabs remains the production fallback
// until the new path passes end-to-end voice, memory, interruption, and billing tests.
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { getRelevantMemories, memoryPrompt } from './memory.mjs';

const MODEL = process.env.MIKE_REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const VOICE = process.env.MIKE_REALTIME_VOICE || 'marin';

function requireOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('openai_not_configured');
    error.status = 503;
    throw error;
  }
}

export async function createMikeRealtimeClientSecret(userId, currentMessage = '') {
  requireOpenAI();

  const memories = userId
    ? await getRelevantMemories(userId, currentMessage || 'voice conversation', 12)
    : [];

  const instructions = [
    MIKE_INSTRUCTIONS,
    'VOICE MODE: You are speaking out loud in a natural back-and-forth conversation.',
    'Keep answers conversational, concise, upbeat, and easy to say aloud.',
    'Do not use markdown, bullet-heavy formatting, or meta commentary about the voice system.',
    'Listen for interruptions and yield naturally when the user starts speaking.',
    memoryPrompt(memories),
  ].filter(Boolean).join('\n\n');

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: MODEL,
        instructions,
        audio: {
          output: { voice: VOICE },
        },
      },
    }),
  });

  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}

  if (!response.ok || !data?.value) {
    const error = new Error(`realtime_client_secret_${response.status}: ${(data?.error?.message || raw || 'no client secret').slice(0, 400)}`);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }

  return {
    clientSecret: data.value,
    expiresAt: data.expires_at || null,
    model: MODEL,
    voice: VOICE,
  };
}

export { MODEL as MIKE_REALTIME_MODEL, VOICE as MIKE_REALTIME_VOICE };
