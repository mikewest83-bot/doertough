import { expect } from 'chai';
import { listGames, getGame, createGameState, startGame, scoreRound } from '../server/game-engine.mjs';

describe('Mike game engine', function () {
  it('exposes the eight starter games', function () {
    expect(listGames()).to.have.length(8);
    expect(getGame('money_move')).to.include({ id: 'money_move', type: 'financial_decision' });
  });

  it('rejects unknown games', function () {
    expect(getGame('does_not_exist')).to.equal(null);
    expect(() => createGameState('does_not_exist')).to.throw('unknown_game');
  });

  it('progresses rounds and completes deterministically', function () {
    let state = startGame(createGameState('beat_mike'));
    expect(state.status).to.equal('playing');
    for (let i = 0; i < 5; i += 1) state = scoreRound(state, 25);
    expect(state.status).to.equal('complete');
    expect(state.score).to.equal(125);
  });

  it('clamps invalid or excessive scoring safely', function () {
    let state = startGame(createGameState('riddle_me_this'));
    state = scoreRound(state, -20);
    expect(state.score).to.equal(0);
    state = scoreRound(state, 999);
    expect(state.score).to.equal(100);
    state = scoreRound(state, Number.NaN);
    expect(state.score).to.equal(100);
  });

  it('does not allow scoring before a game starts or after completion', function () {
    expect(() => scoreRound(createGameState('would_you_rather'), 10)).to.throw('game_not_playing');
    let state = startGame(createGameState('would_you_rather'));
    for (let i = 0; i < 5; i += 1) state = scoreRound(state, 10);
    expect(() => scoreRound(state, 10)).to.throw('game_not_playing');
  });
});
