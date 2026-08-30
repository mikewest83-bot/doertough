import React, { useEffect, useRef, useState } from 'react';

const FRAME_MS = 2500;
const MAX_WIDTH = 1280;

function stopTracks(stream) {
  try { stream?.getTracks().forEach((track) => track.stop()); } catch {}
}

export default function MikeLiveGameView() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [watching, setWatching] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');

  const publishFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageUrl = canvas.toDataURL('image/jpeg', 0.62);
    window.dispatchEvent(new CustomEvent('mike-live-game-frame', { detail: { imageUrl } }));
  };

  const start = async (mode) => {
    if (watching) return;
    setError('');
    try {
      let stream;
      if (mode === 'screen') {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not available in this browser. Use the camera option instead.');
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      setSource(mode);
      setWatching(true);
      publishFrame();
      timerRef.current = window.setInterval(publishFrame, FRAME_MS);
      const [track] = stream.getVideoTracks();
      if (track) track.addEventListener('ended', stop);
    } catch (err) {
      stopTracks(streamRef.current);
      streamRef.current = null;
      setError(err?.message || 'Mike could not start the live game view.');
    }
  };

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWatching(false);
    setSource('');
  };

  useEffect(() => () => stop(), []);

  return (
    <section className="mike-games mike-live-game" aria-label="Mike Live Game View" style={{ marginTop: 18 }}>
      <div className="mike-games-head">
        <div>
          <span className="mike-games-kicker">LIVE GAME VIEW</span>
          <h2>Let Mike watch the game.</h2>
          <p>Mike keeps the latest visual frame in view so you can ask what just happened without repeating yourself.</p>
        </div>
        {watching ? (
          <button type="button" className="mike-games-toggle" onClick={stop}>Stop watching</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="mike-games-toggle" onClick={() => start('camera')}>Use camera</button>
            <button type="button" className="mike-games-toggle" onClick={() => start('screen')}>Share screen</button>
          </div>
        )}
      </div>
      {watching && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 14, background: '#000' }} aria-label="Live game preview" />
          <div className="mike-game-active">● Mike is watching via {source === 'screen' ? 'screen share' : 'camera'} — refreshing the visual context every 2.5 seconds.</div>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      {error && <div role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
