import React, { useEffect, useRef, useState } from 'react';
import './vision-capture.css';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onabort = () => reject(new Error('Image selection was cancelled.'));
    reader.readAsDataURL(file);
  });
}

export default function VisionCapture({ onImage, onChange, disabled = false }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deliver = onImage || onChange;

  useEffect(() => () => { if (inputRef.current) inputRef.current.value = ''; }, []);

  const choose = () => {
    if (!disabled && !busy) inputRef.current?.click();
  };

  const handleChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is too large. Please choose one under 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      deliver?.({ dataUrl, mediaType: file.type, name: file.name, size: file.size });
    } catch (err) {
      setError(err?.message || 'Could not read that image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mike-vision-capture">
      <input ref={inputRef} type="file" accept={ACCEPT} capture="environment" onChange={handleChange} hidden />
      <button type="button" onClick={choose} disabled={disabled || busy} aria-label="Add an image for Mike to look at">
        {busy ? 'Reading…' : '📷'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
