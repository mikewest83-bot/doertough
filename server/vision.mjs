const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DATA_URL_CHARS = 7_000_000;

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function normalizeVisionImage(value) {
  if (!value || typeof value !== 'object') return null;
  const dataUrl = String(value.dataUrl || '').trim();
  const mediaType = String(value.mediaType || '').trim().toLowerCase();
  if (!dataUrl || !ALLOWED_TYPES.has(mediaType)) fail('vision_image_type_invalid', 400);
  const prefix = `data:${mediaType};base64,`;
  if (!dataUrl.startsWith(prefix)) fail('vision_image_encoding_invalid', 400);
  if (dataUrl.length > MAX_DATA_URL_CHARS) fail('vision_image_too_large', 413);
  const base64 = dataUrl.slice(prefix.length);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) fail('vision_image_encoding_invalid', 400);
  return { dataUrl, mediaType };
}

export function visionContent(message, image) {
  const content = [{ type: 'input_text', text: String(message || '') }];
  if (image) content.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' });
  return content;
}
