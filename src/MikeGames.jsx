import React, { useMemo, useState } from 'react';

const GAMES = [
  {
    id: 'beat-mike',
    title: 'Beat Mike',
    tag: 'TRIVIA',
    description: 'Endless trivia. Fresh questions, one at a time. Keep playing as long as you want.',
    starter: 'Let’s play Beat Mike. This is an endless trivia game: give me one challenging, non-repeating trivia question at a time, wait for my answer before revealing it, keep a running score, tell me my score after each round, vary the categories, and keep going until I say stop. Do not cap the game at five or any other number of questions. Do not repeat a question or substantially rephrase a previous question during this session. Don’t go easy on me.',
  },
  {
    id: 'twenty-questions',
    title: '20 Questions',
    tag: 'GUESSING',
    description: 'Think of something. Mike gets 20 yes-or-no questions.',
    starter: 'Let’s play 20 Questions. I’ll think of something and you get up to 20 yes-or-no questions to guess it. Ask one question at a time, number each question, use my previous answers to narrow it down smartly rather than guessing randomly, and make a guess when you are confident. After question 20, make your final guess and end the game unless I ask to play again.',
  },
  {
    id: 'would-you-rather',
    title: 'Would You Rather',
    tag: 'QUICK HIT',
    description: 'Hard choices, ridiculous choices, and a few that reveal too much.',
    starter: 'Let’s play Would You Rather. Give me one tough or funny choice at a time, wait for my pick, react to it, then hit me with the next one. Don’t repeat a choice this session. Keep going until I say stop.',
  },
  {
    id: 'higher-lower',
    title: 'Higher or Lower',
    tag: 'GUESSING',
    description: 'Guess whether the next number is higher or lower. Keep score.',
    starter: 'Let’s play Higher or Lower. Pick a category, give me a starting number, then make me guess higher or lower one round at a time, reveal the answer after each guess, keep a running score, and vary the categories so it doesn’t get repetitive.',
  },
  {
    id: 'riddle-me',
    title: 'Riddle Me This',
    tag: 'BRAIN',
    description: 'Mike brings the riddles. You bring the brain.',
    starter: 'Let’s play Riddle Me This. Give me one riddle at a time, wait for my answer before revealing anything, offer a hint if I ask, keep score, and don’t repeat a riddle this session. Keep going until I say stop.',
  },
  {
    id: 'two-truths',
    title: 'Two Truths',
    tag: 'SOCIAL',
    description: 'Two truths and a lie. Figure out which one Mike is hiding.',
    starter: 'Let’s play Two Truths and a Lie. Give me three numbered statements, tell me to guess the lie, wait for my guess, then reveal which one was false and keep score. Don’t reuse a set of statements this session.',
  },
  {
    id: 'money-move',
    title: 'Money Move',
    tag: 'DOER TOUGH',
    description: 'You get a real-world money scenario. Make the move Mike would make.',
    starter: 'Let’s play Money Move. Give me realistic money and negotiation scenarios one at a time, let me choose what I would do, then score my move and explain the better play. Keep a running score and don’t repeat a scenario this session.',
  },
  {
    id: 'deal-or-no-deal',
    title: 'Deal or No Deal',
    tag: 'NEGOTIATION',
    description: 'Mike puts an offer on the table. You decide whether to take it.',
    starter: 'Let’s play Deal or No Deal. Give me a realistic negotiation with an offer, hidden upside, and downside. I decide deal or no deal, then you reveal what I could have won or lost and keep a running tally. Don’t repeat a scenario this session.',
  },
  {
    id: 'price-check',
    title: 'Price Check',
    tag: 'PRICING',
    description: 'Mike describes a real secondhand item. Guess what it is actually worth.',
    starter: 'Let’s play Price Check. Describe a real, specific used item one at a time — brand, model, condition, and any relevant details — and ask me to guess what it is actually worth or would realistically sell for. After my guess, tell me the realistic price range and how close I got, keep a running score based on accuracy, vary the categories (tools, electronics, furniture, vehicles, collectibles), and don’t repeat an item this session. Keep going until I say stop.',
  },
  {
    id: 'flip-or-skip',
    title: 'Flip or Skip',
    tag: 'RESALE',
    description: 'A real-style listing shows up. Decide if it is a flip or a pass.',
    starter: 'Let’s play Flip or Skip. Describe a real-style secondhand listing one at a time — item, asking price, condition, and any red flags — and ask me whether I would flip it or skip it. After my call, reveal whether it was actually a good flip, roughly what the profit or loss would have been, and keep a running score. Don’t repeat a listing this session. Keep going until I say stop.',
  },
  {
    id: 'speed-round',
    title: 'Speed Round',
    tag: 'SPEED',
    description: 'Fast trivia, no waiting around. Quick guesses only.',
    starter: 'Let’s play Speed Round. Fire off quick trivia questions one at a time, keep them short, don’t wait for a long answer — just a fast guess — reveal the answer immediately after each guess, keep a running score, and keep the pace fast and energetic. Don’t repeat a question this session. Keep going until I say stop.',
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
