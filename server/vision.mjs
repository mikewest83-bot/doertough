const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_DATA_URL_CHARS = 7_000_000;

export function normalizeVisionImage(value) {
  if (!value || typeof value !== 'object') return null;

  const dataUrl = String(value.dataUrl || '').trim();
  const mediaType = String(value.mediaType || '').trim().toLowerCase();

  if (!dataUrl || !ALLOWED_TYPES.has(mediaType)) {
    const error = new Error('vision_image_type_invalid');
    error.status = 400;
    throw error;
  }

  const expectedPrefix = `data:${mediaType};base64,`;
  if (!dataUrl.startsWith(expectedPrefix)) {
    const error = new Error('vision_image_encoding_invalid');
    error.status = 400;
    throw error;
  }

  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    const error = new Error('vision_image_too_large');
    error.status = 413;
    throw error;
  }

  const base64 = dataUrl.slice(expectedPrefix.length);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    const error = new Error('vision_image_encoding_invalid');
    error.status = 400;
    throw error;
  }

  return { dataUrl, mediaType };
}

export function visionContent(message, image) {
  const content = [{ type: 'input_text', text: message }];
  if (image) content.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' });
  return content;
}
