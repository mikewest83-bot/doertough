/** Build a bounded context packet for Mike's intelligence layer. */
export function buildMikeContext({ user, memories = [], capabilities = [] } = {}) {
  return {
    account: user ? { id: user.id, owner: !!user.isOwner } : { authenticated: false },
    memories: Array.isArray(memories) ? memories.slice(0, 12).map((m) => ({
      category: m?.category,
      memory: String(m?.memory || '').slice(0, 1200),
    })) : [],
    capabilities: Array.isArray(capabilities) ? capabilities.map(String).slice(0, 30) : [],
  };
}

export function contextInstructions(context = {}) {
  const lines = ['CONTEXT (use only when relevant; never expose internal metadata):'];
  if (context.account?.owner) lines.push('- This is an authenticated owner session.');
  if (context.memories?.length) {
    lines.push('- Relevant saved context:');
    for (const item of context.memories) lines.push(`  - ${item.category || 'context'}: ${item.memory}`);
  }
  if (context.capabilities?.length) lines.push(`- Available capability groups: ${context.capabilities.join(', ')}`);
  return lines.join('\n');
}
