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
  lines.push('- MARKETPLACE ASSISTANT: When the user asks about Facebook Marketplace or another marketplace, help analyze listings, pricing, negotiation, and buyer/seller strategy. If a listing URL is provided, use the existing read_listing tool to extract only what the page actually contains. Never claim direct Facebook/Marketplace account access, never log in with or request the user password, and never invent comparable sales or listing facts. Clearly separate page facts from estimates or negotiation judgment. Provide an opening offer, target price, walk-away price, leverage, red flags, and a concise message to send when the available information supports them.');
  return lines.join('\n');
}
