import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react';

/**
 * Mike Music is intentionally independent from Mike Realtime voice.
 * It controls user-supplied/browser media only; it does not create, modify,
 * or share the Realtime peer connection, microphone stream, or data channel.
 */
export default function MikeMusic({ compact = false }) {
  const audioRef = useRef(null);
  const [src, setSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.volume = volume;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [volume]);

  const playPause = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    setError('');
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      setError('Playback was blocked. Tap play again.');
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setPlaying(false);
  };

  const seek = (delta) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + delta));
  };

  if (compact) {
    return (
      <div className="mike-music mike-music-compact" aria-label="Mike Music">
        <audio ref={audioRef} src={src || undefined} preload="metadata" />
        <button type="button" onClick={() => audioRef.current?.paused ? playPause() : playPause()} disabled={!src} aria-label={playing ? 'Pause music' : 'Play music'}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" onClick={() => seek(-10)} disabled={!src} aria-label="Back ten seconds"><SkipBack size={17} /></button>
        <button type="button" onClick={() => seek(10)} disabled={!src} aria-label="Forward ten seconds"><SkipForward size={17} /></button>
        <input aria-label="Music volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </div>
    );
  }

  return (
    <section className="mike-music" aria-label="Mike Music">
      <audio ref={audioRef} src={src || undefined} preload="metadata" />
      <div className="mike-music-heading">
        <div><strong>MUSIC MODE</strong><small>Works with your device audio and Bluetooth routing</small></div>
      </div>
      <label className="mike-music-source">Audio URL
        <input value={src} onChange={(e) => { setSrc(e.target.value.trim()); setPlaying(false); setError(''); }} placeholder="Paste a playable audio URL" inputMode="url" />
      </label>
      <div className="mike-music-controls">
        <button type="button" onClick={() => seek(-10)} disabled={!src} aria-label="Back ten seconds"><SkipBack size={19} /></button>
        <button type="button" className="mike-music-play" onClick={playPause} disabled={!src} aria-label={playing ? 'Pause music' : 'Play music'}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
        <button type="button" onClick={() => seek(10)} disabled={!src} aria-label="Forward ten seconds"><SkipForward size={19} /></button>
        <button type="button" onClick={stop} disabled={!src} aria-label="Stop music"><Square size={17} /></button>
        <Volume2 size={18} aria-hidden="true" />
        <input aria-label="Music volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </div>
      {error && <div className="mike-music-error" role="status">{error}</div>}
    </section>
  );
}
