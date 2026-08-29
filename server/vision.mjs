import OpenAI from 'openai';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DATA_URL_CHARS = 7_000_000;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const VISION_MODEL = process.env.MIKE_VISION_MODEL || 'gpt-4o-mini';

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

export async function analyzeVisionImage(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: 'sign_in_required', message: 'Sign in to use Mike Vision.' });
    if (!openai) return res.status(503).json({ error: 'openai_not_configured', message: 'Mike Vision is temporarily unavailable.' });
    const image = normalizeVisionImage(req.body?.image);
    const prompt = String(req.body?.prompt || 'What do you see in this photo?').trim().slice(0, 4000);
    if (!image) return res.status(400).json({ error: 'image_required', message: 'Mike needs a photo to look at.' });
    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(prompt, image) }],
      max_output_tokens: 700,
    });
    const text = String(response.output_text || '').trim();
    if (!text) return res.status(502).json({ error: 'vision_empty', message: 'Mike could not get an answer from the image.' });
    return res.json({ text });
  } catch (error) {
    console.error('[vision] analyze failed:', error?.message || error);
    return res.status(error?.status || 502).json({ error: 'vision_failed', message: error?.message || 'Mike could not analyze that photo.' });
  }
}
