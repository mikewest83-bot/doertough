/**
 * Build explicit multi-person conversation context for Mike.
 * This does not perform speaker identification; callers must provide labels.
 */
export function buildMikeGroupContext({ participants = [], activeSpeaker = '', turns = [] } = {}) {
  const safeParticipants = Array.isArray(participants)
    ? participants.slice(0, 6).map((p, index) => ({
        id: String(p?.id || `speaker-${index + 1}`).slice(0, 80),
        name: String(p?.name || `Person ${index + 1}`).slice(0, 120),
      }))
    : [];
  const allowed = new Set(safeParticipants.map((p) => p.id));
  const safeTurns = Array.isArray(turns)
    ? turns.slice(-20).map((turn) => ({
        speakerId: allowed.has(String(turn?.speakerId || '')) ? String(turn.speakerId) : 'unknown',
        text: String(turn?.text || '').slice(0, 4000),
      })).filter((turn) => turn.text)
    : [];
  const active = allowed.has(String(activeSpeaker)) ? String(activeSpeaker) : '';
  return { mode: safeParticipants.length > 1 ? 'group' : 'single', participants: safeParticipants, activeSpeaker: active, turns: safeTurns };
}

export function groupContextInstructions(group = {}) {
  if (group.mode !== 'group') return '';
  const people = group.participants.map((p) => `${p.name} (${p.id})`).join(', ');
  const active = group.participants.find((p) => p.id === group.activeSpeaker)?.name;
  const lines = [
    'GROUP CONVERSATION:',
    `- Participants: ${people}`,
    active ? `- Current speaker label: ${active}` : '- Current speaker is unknown; never guess who said something.',
    '- Treat each labeled turn as belonging only to that participant.',
    '- In group discussion, address the person you can identify; if unclear, speak to the group.',
    '- Never invent speaker identities or claim to recognize a voice unless the system provides a verified speaker label.',
  ];
  if (group.turns.length) {
    lines.push('- Recent labeled turns:');
    for (const turn of group.turns) {
      const person = group.participants.find((p) => p.id === turn.speakerId);
      lines.push(`  - ${person?.name || 'Unknown speaker'}: ${turn.text}`);
    }
  }
  return lines.join('\n');
}
