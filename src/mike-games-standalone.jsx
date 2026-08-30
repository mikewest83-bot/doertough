import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GAMES } from './MikeGames.jsx';
import MikeLiveGameView from './MikeLiveGameView.jsx';
import './mike-games.css';

function sendToMike(prompt) {
  window.dispatchEvent(new CustomEvent('mike-game-start', { detail: { prompt } }));
  return true;
}

function MikeGamesStandalone() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    document.body.dataset.mikeGames = 'ready';
    return () => { delete document.body.dataset.mikeGames; };
  }, []);

  const play = (game) => {
    setSelected(game.id);
    setOpen(false);
    sendToMike(game.starter);
  };

  return (
    <>
      <section className="mike-games mike-games-shell" aria-label="Play games with Mike">
        <div className="mike-games-head">
          <div>
            <span className="mike-games-kicker">MIKE GAMES</span>
            <h2>Play a game with Mike.</h2>
            <p>Quick games built for text or voice. Pick one and Mike takes it from there.</p>
          </div>
          <button type="button" className="mike-games-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Hide games' : 'Play a game'}
          </button>
        </div>
        {open && (
          <div className="mike-games-grid">
            {GAMES.map((game) => (
              <button key={game.id} type="button" className={'mike-game-card' + (selected === game.id ? ' selected' : '')} onClick={() => play(game)}>
                <span className="mike-game-tag">{game.tag}</span>
                <strong>{game.title}</strong>
                <span>{game.description}</span>
                <b>PLAY →</b>
              </button>
            ))}
          </div>
        )}
        {selected && !open && <div className="mike-game-active">Game ready — Mike is waiting for your move.</div>}
      </section>
      <MikeLiveGameView />
    </>
  );
}

function mount() {
  if (document.querySelector('[data-mike-games-root]')) return;
  const app = document.getElementById('root');
  if (!app?.querySelector('main')) {
    window.requestAnimationFrame(mount);
    return;
  }
  const host = document.createElement('div');
  host.dataset.mikeGamesRoot = 'true';
  app.after(host);
  createRoot(host).render(<MikeGamesStandalone />);
}

mount();
