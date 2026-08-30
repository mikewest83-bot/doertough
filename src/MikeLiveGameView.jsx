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

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWatching(false);
  };

  const startCamera = async () => {
    if (watching) return;
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      setWatching(true);
      publishFrame();
      timerRef.current = window.setInterval(publishFrame, FRAME_MS);
      const [track] = stream.getVideoTracks();
      if (track) track.addEventListener('ended', stop);
    } catch (err) {
      stopTracks(streamRef.current);
      streamRef.current = null;
      setError(err?.message || 'Mike could not start the camera.');
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <section className="mike-games mike-live-game" aria-label="Mike Live" style={{ marginTop: 18 }}>
      <div className="mike-games-head">
        <div>
          <span className="mike-games-kicker">MIKE LIVE</span>
          <h2>Show Mike what's happening.</h2>
          <p>Turn on your camera and talk to Mike about what you're seeing.</p>
        </div>
        {!watching && (
          <button type="button" className="mike-games-toggle" onClick={startCamera}>Use camera</button>
        )}
      </div>
      {watching && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 14, background: '#000' }} aria-label="Mike Live camera preview" />
          <div className="mike-game-active">● Mike is watching — visual context refreshes every 2.5 seconds.</div>
          <button type="button" className="mike-games-toggle" onClick={stop}>End Mike Live</button>
        </div>
      )}
      {!watching && <video ref={videoRef} playsInline muted style={{ display: 'none' }} aria-hidden="true" />}
      <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      {error && <div role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
