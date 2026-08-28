import React, { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { createVisionInput, createCameraConstraints, stopVisionStream } from './mikeVision.js';

export default function MikeVision({ disabled = false, onCapture, busy = false }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);

  const close = () => {
    stopVisionStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false);
    setCapturing(false);
  };

  useEffect(() => () => stopVisionStream(streamRef.current), []);

  const startCamera = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      inputRef.current?.click();
      return;
    }
    setCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(createCameraConstraints());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setOpen(true);
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'Camera access was denied. You can choose an image instead.' : 'Mike could not open the camera. You can choose an image instead.');
      inputRef.current?.click();
    } finally {
      setCapturing(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) return;
    setCapturing(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 1600;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d', { alpha: false })?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!blob) throw new Error('Mike could not capture that image.');
      const file = new File([blob], 'mike-vision.jpg', { type: 'image/jpeg' });
      const dataUrl = await createVisionInput(file);
      close();
      await onCapture(dataUrl);
    } catch (err) {
      setError(err?.message || 'Mike could not capture that image.');
      setCapturing(false);
    }
  };

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCapturing(true);
    setError('');
    try {
      const dataUrl = await createVisionInput(file);
      close();
      await onCapture(dataUrl);
    } catch (err) {
      setError(err?.message || 'Mike could not use that image.');
      setCapturing(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={chooseFile} hidden />
      <button type="button" className="vision-btn" onClick={startCamera} disabled={disabled || busy || capturing} aria-label="Show Mike an image">
        <Camera size={18} /> <span>{capturing ? 'PREPARING' : 'VISION'}</span>
      </button>
      {open && (
        <div className="vision-overlay" role="dialog" aria-modal="true" aria-label="Mike Vision">
          <div className="vision-card">
            <div className="vision-head"><strong>MIKE VISION</strong><button type="button" className="vision-close" onClick={close} aria-label="Close Vision"><X size={18} /></button></div>
            <video ref={videoRef} className="vision-video" playsInline muted />
            {error && <div className="vision-error" role="alert">{error}</div>}
            <div className="vision-actions"><button type="button" className="vision-cancel" onClick={close}>Cancel</button><button type="button" className="vision-capture" onClick={capture} disabled={capturing}>Capture</button></div>
          </div>
        </div>
      )}
    </>
  );
}
