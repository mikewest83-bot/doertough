import { createMikeIntelligence } from './mike-intelligence.mjs';
import { contextInstructions } from './mike-context.mjs';
import { buildMikeGroupContext, groupContextInstructions } from './mike-group-context.mjs';
import { getMikeCapabilities } from './mike-capabilities.mjs';

/**
 * Central capability boundary for Mike's non-Realtime intelligence.
 * Realtime voice, Vision, and Music remain separate clients/capabilities.
 */
export function createMikeOrchestrator({ intelligence = createMikeIntelligence(), tools = {} } = {}) {
  const registry = getMikeCapabilities();
  const available = Object.keys(tools);

  return {
    async answer({ message, history = [], context = {}, group = null }) {
      const groupContext = group ? buildMikeGroupContext(group) : null;
      const boundedContext = {
        ...context,
        capabilities: available,
        capabilityRegistry: registry,
        ...(groupContext?.mode === 'group' ? { groupConversation: groupContext } : {}),
      };
      const groupInstructions = groupContext?.mode === 'group' ? groupContextInstructions(groupContext) : '';
      return intelligence.answer({
        message,
        history,
        context: boundedContext,
        instructions: [contextInstructions(boundedContext), groupInstructions].filter(Boolean).join('\n\n'),
      });
    },
    capabilities() { return [...available]; },
    registry() { return registry.map((item) => ({ ...item })); },
  };
}
