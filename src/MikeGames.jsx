import React, { useMemo, useState } from 'react';

const GAMES = [
  {
    id: 'beat-mike',
    title: 'Beat Mike',
    tag: 'TRIVIA',
    description: 'Five quick questions. See if you can take Mike down.',
    starter: 'Let’s play Beat Mike. Give me one trivia question at a time, keep score, and don’t go easy on me.',
  },
  {
    id: 'twenty-questions',
    title: '20 Questions',
    tag: 'GUESSING',
    description: 'Think of something. Mike gets 20 yes-or-no questions.',
    starter: 'Let’s play 20 Questions. I’ll think of something and you get up to 20 yes-or-no questions to guess it.',
  },
  {
    id: 'would-you-rather',
    title: 'Would You Rather',
    tag: 'QUICK HIT',
    description: 'Hard choices, ridiculous choices, and a few that reveal too much.',
    starter: 'Let’s play Would You Rather. Give me one tough or funny choice at a time and react to my answers.',
  },
  {
    id: 'higher-lower',
    title: 'Higher or Lower',
    tag: 'GUESSING',
    description: 'Guess whether the next number is higher or lower. Keep score.',
    starter: 'Let’s play Higher or Lower. Pick a category, give me a starting number, then make me guess higher or lower and keep score.',
  },
  {
    id: 'riddle-me',
    title: 'Riddle Me This',
    tag: 'BRAIN',
    description: 'Mike brings the riddles. You bring the brain.',
    starter: 'Let’s play Riddle Me This. Give me one riddle at a time, wait for my answer, and keep score.',
  },
  {
    id: 'two-truths',
    title: 'Two Truths',
    tag: 'SOCIAL',
    description: 'Two truths and a lie. Figure out which one Mike is hiding.',
    starter: 'Let’s play Two Truths and a Lie. Give me three statements, tell me to guess the lie, then reveal it and keep score.',
  },
  {
    id: 'money-move',
    title: 'Money Move',
    tag: 'DOER TOUGH',
    description: 'You get a real-world money scenario. Make the move Mike would make.',
    starter: 'Let’s play Money Move. Give me realistic money and negotiation scenarios one at a time, let me choose what I would do, then score my move and explain the better play.',
  },
  {
    id: 'deal-or-no-deal',
    title: 'Deal or No Deal',
    tag: 'NEGOTIATION',
    description: 'Mike puts an offer on the table. You decide whether to take it.',
    starter: 'Let’s play Deal or No Deal. Give me a realistic negotiation with an offer, hidden upside, and downside. I decide deal or no deal, then you reveal what I could have won or lost.',
  },
];

export default function MikeGames({ onStart }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const game = useMemo(() => GAMES.find((item) => item.id === selected) || null, [selected]);

  const start = (item) => {
    setSelected(item.id);
    if (onStart) onStart(item.starter, item);
  };

  return (
    <section className="mike-games" aria-label="Play games with Mike">
      <div className="mike-games-head">
        <div>
          <span className="mike-games-kicker">MIKE GAMES</span>
          <h2>Play a game with Mike.</h2>
          <p>Quick games built for text or voice. Pick one and Mike takes it from there.</p>
        </div>
        <button type="button" className="mike-games-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Hide games' : 'Show games'}
        </button>
      </div>

      {open && (
        <>
          <div className="mike-games-grid">
            {GAMES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={'mike-game-card' + (selected === item.id ? ' selected' : '')}
                onClick={() => start(item)}
              >
                <span className="mike-game-tag">{item.tag}</span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <b>PLAY →</b>
              </button>
            ))}
          </div>
          {game && <div className="mike-game-active">Playing <strong>{game.title}</strong> — Mike is ready.</div>}
        </>
      )}
    </section>
  );
}

export { GAMES };
