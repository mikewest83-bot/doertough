import { createMikeIntelligence } from './mike-intelligence.mjs';
import { contextInstructions } from './mike-context.mjs';
import { getMikeCapabilities } from './mike-capabilities.mjs';

/**
 * Central capability boundary for Mike's non-Realtime intelligence.
 * Realtime voice, Vision, and Music remain separate clients/capabilities.
 */
export function createMikeOrchestrator({ intelligence = createMikeIntelligence(), tools = {} } = {}) {
  const registry = getMikeCapabilities();
  const available = Object.keys(tools);

  return {
    async answer({ message, history = [], context = {} }) {
      const boundedContext = {
        ...context,
        capabilities: available,
        capabilityRegistry: registry,
      };
      return intelligence.answer({
        message,
        history,
        context: boundedContext,
        instructions: contextInstructions(boundedContext),
      });
    },
    capabilities() { return [...available]; },
    registry() { return registry.map((item) => ({ ...item })); },
  };
}
