// Mike Smart Memory — automatic durable-memory extraction.
// This is intentionally conservative: it stores only high-confidence, non-sensitive
// facts that are likely to remain useful across future conversations.
import OpenAI from 'openai';
import { saveMemory } from './memory.mjs';

const MODEL = process.env.MIKE_MEMORY_MODEL || 'gpt-4o-mini';
const MAX_MEMORIES = 3;

function clean(value, max = 900) {
  return String(value || '').trim().slice(0, max);
}

function client() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function normalize(item) {
  if (!item || typeof item !== 'object') return null;
  const category = clean(item.category, 30).toLowerCase();
  const memory = clean(item.memory);
  const confidence = Number(item.confidence);
  const importance = Number(item.importance);
  if (!['preference', 'goal', 'project', 'context', 'learned'].includes(category)) return null;
  if (!memory || !Number.isFinite(confidence) || confidence < 0.82) return null;
  if (/(password|passcode|api key|secret|credit card|bank account|ssn|social security|private key)/i.test(memory)) return null;
  return {
    category,
    memory,
    confidence,
    importance: Math.min(5, Math.max(1, Math.round(Number.isFinite(importance) ? importance : 3))),
  };
}

export async function extractAndSaveMemories(userId, userMessage) {
  if (!userId || !clean(userMessage) || !process.env.OPENAI_API_KEY) return [];
  const ai = client();
  if (!ai) return [];

  const response = await ai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You extract durable personal memory for an AI assistant. Return JSON only: {"memories":[...]}. Extract at most ${MAX_MEMORIES} items. A memory must be a stable user preference, goal, project, useful context, or durable learned fact/decision. Ignore greetings, questions, temporary logistics, one-off requests, generic opinions, assistant instructions, and information about other people. Never store passwords, credentials, financial account details, security answers, or other secrets. Do not infer sensitive traits. Preserve corrections and explicit decisions when clearly stated. Each item must contain category, memory, confidence (0 to 1), and importance (1 to 5). Only include items with confidence at least 0.82. Write memories as concise standalone statements that will still make sense later.`,
      },
      { role: 'user', content: clean(userMessage, 4000) },
    ],
  });

  let parsed;
  try { parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}'); } catch { return []; }
  const items = Array.isArray(parsed?.memories) ? parsed.memories.slice(0, MAX_MEMORIES) : [];
  const saved = [];
  for (const item of items.map(normalize).filter(Boolean)) {
    try {
      const record = await saveMemory(userId, {
        category: item.category,
        memory: item.memory,
        importance: item.importance,
        source: 'auto-extracted',
      });
      if (record) saved.push(record);
    } catch (err) {
      console.error('[memory] auto-save failed:', err.message || err);
    }
  }
  return saved;
}
