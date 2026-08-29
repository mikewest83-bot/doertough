const GAMES = Object.freeze({
  beat_mike: { name: 'Beat Mike', type: 'trivia', rounds: 5 },
  twenty_questions: { name: '20 Questions', type: 'deduction', rounds: 20 },
  would_you_rather: { name: 'Would You Rather', type: 'choice', rounds: 5 },
  higher_or_lower: { name: 'Higher or Lower', type: 'prediction', rounds: 5 },
  riddle_me_this: { name: 'Riddle Me This', type: 'riddle', rounds: 5 },
  two_truths: { name: 'Two Truths & a Lie', type: 'social', rounds: 5 },
  money_move: { name: 'Money Move', type: 'financial_decision', rounds: 5 },
  deal_or_no_deal: { name: 'Deal or No Deal', type: 'negotiation', rounds: 5 },
});

export function listGames() {
  return Object.entries(GAMES).map(([id, game]) => ({ id, ...game }));
}

export function getGame(id) {
  if (!id || !GAMES[id]) return null;
  return { id, ...GAMES[id] };
}

export function createGameState(id) {
  const game = getGame(id);
  if (!game) throw new Error('unknown_game');
  return Object.freeze({ gameId: id, round: 0, score: 0, status: 'ready' });
}

export function startGame(state) {
  if (!state || !getGame(state.gameId)) throw new Error('invalid_game_state');
  return Object.freeze({ ...state, round: 1, status: 'playing' });
}

export function scoreRound(state, points = 0) {
  if (!state || state.status !== 'playing') throw new Error('game_not_playing');
  const game = getGame(state.gameId);
  const safePoints = Number.isFinite(points) ? Math.max(0, Math.min(100, Math.round(points))) : 0;
  const nextRound = state.round + 1;
  const done = nextRound > game.rounds;
  return Object.freeze({
    ...state,
    round: nextRound,
    score: state.score + safePoints,
    status: done ? 'complete' : 'playing',
  });
}
