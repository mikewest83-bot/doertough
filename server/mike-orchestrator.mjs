import { createMikeIntelligence } from './mike-intelligence.mjs';

/**
 * Central capability boundary for Mike's non-Realtime intelligence.
 * Realtime voice, Vision, and Music remain separate clients/capabilities.
 */
export function createMikeOrchestrator({ intelligence = createMikeIntelligence(), tools = {} } = {}) {
  return {
    async answer({ message, history = [], context = {} }) {
      const result = await intelligence.answer({
        message,
        history,
        context: {
          ...context,
          availableCapabilities: Object.keys(tools)
        }
      });
      return result;
    },
    capabilities() {
      return Object.keys(tools);
    }
  };
}
