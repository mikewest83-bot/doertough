const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateVisionFile(file) {
  if (!file) return { ok: false, error: 'No image selected.' };
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, error: 'Please choose a JPG, PNG, or WebP image.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'That image is too large. Please choose an image under 6 MB.' };
  return { ok: true };
}

export function createVisionInput(file) {
  const validation = validateVisionFile(file);
  if (!validation.ok) throw new Error(validation.error);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Mike could not read that image.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      if (!value.startsWith('data:image/')) return reject(new Error('That image could not be prepared for Mike.'));
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

export function createCameraConstraints() {
  return { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
}

export function stopVisionStream(stream) {
  try { stream?.getTracks?.().forEach((track) => track.stop()); } catch {}
}

export { MAX_BYTES, ALLOWED_TYPES };
