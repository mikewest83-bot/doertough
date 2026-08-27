// Lightweight, keyless dictionary lookup for definitions and pronunciation.
// Provider: Free Dictionary API (dictionaryapi.dev), which returns phonetics,
// audio pronunciation, meanings, examples, synonyms and antonyms.
// See: https://dictionaryapi.dev/

import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';

const TIMEOUT_MS = 7000;
const cache = new Map();
const MAX_CACHE = 500;

function cleanWord(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-zA-Z' -]/g, '').replace(/\s+/g, ' ');
}

export async function lookUpWord({ word } = {}) {
  const query = cleanWord(word);
  if (!query) return { error: 'word_required' };
  if (query.length > 80) return { error: 'word_too_long' };
  const cached = cache.get(query);
  if (cached) return cached;
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'MikeAI/1.0 (https://doertoughmikeai.com)' }, signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) return { error: `I couldn't find a dictionary entry for "${query}".` };
    const entries = await response.json();
    const entry = Array.isArray(entries) ? entries[0] : null;
    if (!entry) return { error: `I couldn't find a dictionary entry for "${query}".` };
    const phonetics = (entry.phonetics || []).filter((p) => p?.text || p?.audio).slice(0, 4).map((p) => ({ text: p.text || null, audio: p.audio || null }));
    const meanings = (entry.meanings || []).slice(0, 8).map((meaning) => ({
      partOfSpeech: meaning.partOfSpeech || null,
      definitions: (meaning.definitions || []).slice(0, 4).map((d) => ({ definition: d.definition, example: d.example || null })),
      synonyms: (meaning.synonyms || []).slice(0, 8), antonyms: (meaning.antonyms || []).slice(0, 8),
    }));
    const result = { word: entry.word || query, phonetic: entry.phonetic || phonetics.find((p) => p.text)?.text || null, phonetics, origin: entry.origin || null, meanings, source: 'Free Dictionary API / Wiktionary data' };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(query, result);
    return result;
  } catch (error) {
    console.error('[dictionary] lookup failed:', error.message || error);
    return { error: `The dictionary lookup is unavailable right now for "${query}".` };
  }
}

export const DICTIONARY_TOOLS = [
  {
    type: 'function', name: 'look_up_word',
    description: 'Look up an English word when the user asks what it means, how it is pronounced, what part of speech it is, or asks for an example. Use this to verify definitions and pronunciation instead of guessing. Keep the final answer natural and concise.',
    parameters: { type: 'object', properties: { word: { type: 'string', description: 'The English word to look up.' } }, required: ['word'], additionalProperties: false },
  },
  ...DOERTOUGH_INTELLIGENCE_TOOLS,
];

export const DICTIONARY_TOOL_HANDLERS = {
  look_up_word: lookUpWord,
  ...DOERTOUGH_INTELLIGENCE_HANDLERS,
};
