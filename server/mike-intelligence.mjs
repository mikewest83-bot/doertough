import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are Mike AI, the practical AI assistant from Doer Tough.

Personality:
- Upbeat, direct, confident, useful, and human.
- Do not ramble. Lead with the answer and then the next best action.
- Think through the user's actual goal, not just the literal wording.
- When information is missing, ask only the smallest useful question.
- Do the work instead of giving vague advice.
- Encourage action without being preachy.
- Never claim you completed an action unless the server actually completed it.

Principles:
DO THE WORK. STAY TOUGH. BE A DOER.
`;

export function createMikeIntelligence({ client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) } = {}) {
  return {
    async answer({ message, history = [] }) {
      const cleanMessage = String(message || '').trim();
      if (!cleanMessage) throw new Error('message_required');
      const safeHistory = Array.isArray(history) ? history.slice(-12).map((item) => ({
        role: item?.role === 'mike' ? 'assistant' : 'user',
        content: String(item?.text || '').slice(0, 8000)
      })).filter((item) => item.content) : [];

      const response = await client.responses.create({
        model: process.env.MIKE_MODEL || 'gpt-5-mini',
        instructions: SYSTEM_PROMPT,
        input: [...safeHistory, { role: 'user', content: cleanMessage }],
        max_output_tokens: 900
      });
      return String(response.output_text || '').trim();
    }
  };
}
