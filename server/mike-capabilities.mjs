/**
 * Capability registry for Mike's orchestration layer.
 * Metadata only: execution remains owned by the existing server tool handlers.
 */
export const MIKE_CAPABILITIES = Object.freeze([
  { name: 'live_tools', description: 'Current authenticated Mike live capabilities', risk: 'controlled' },
  { name: 'business_tools', description: 'Business and commerce capabilities', risk: 'controlled' },
  { name: 'free_tools', description: 'General-purpose free capabilities', risk: 'controlled' },
  { name: 'field_tools', description: 'Field and practical task capabilities', risk: 'controlled' },
  { name: 'memory', description: 'Account-scoped conversational memory', risk: 'private' },
  { name: 'realtime_voice', description: 'Realtime voice transport', risk: 'separate' },
  { name: 'vision', description: 'Image understanding capability', risk: 'separate' },
  { name: 'music', description: 'Browser/device audio playback controls', risk: 'separate' },
]);

export function getMikeCapabilities() {
  return MIKE_CAPABILITIES.map((capability) => ({ ...capability }));
}
