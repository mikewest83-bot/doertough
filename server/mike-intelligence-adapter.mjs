import { createMikeOrchestrator } from './mike-orchestrator.mjs';

/**
 * Safe adapter for introducing the new intelligence layer.
 * It is opt-in by environment variable so an unverified model path cannot
 * replace the established /api/ask behavior accidentally.
 */
export function createMikeIntelligenceAdapter({ orchestrator, legacyAnswer }) {
  if (!orchestrator || typeof orchestrator.answer !== 'function') {
    throw new Error('mike_orchestrator_required');
  }
  if (typeof legacyAnswer !== 'function') {
    throw new Error('legacy_answer_required');
  }

  const enabled = process.env.MIKE_INTELLIGENCE_ENABLED === 'true';

  return async function answer(input) {
    if (!enabled) return legacyAnswer(input);
    try {
      const answer = await orchestrator.answer(input);
      if (typeof answer === 'string' && answer.trim()) return answer.trim();
      return legacyAnswer(input);
    } catch (error) {
      console.error('[mike-intelligence] adapter fallback:', error?.message || error);
      return legacyAnswer(input);
    }
  };
}

export { createMikeOrchestrator };
