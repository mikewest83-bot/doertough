import OpenAI from 'openai';
import { analyzeDeal } from './free-tools.mjs';

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

    // Appraisal mode answers the person AND identifies the item in a single
    // model call. Callers that do not ask for it fall through to the plain
    // description below, unchanged.
    if (String(req.body?.mode || '').trim().toLowerCase() === 'appraise') {
      const appraisal = await appraiseImage(image);
      if (!appraisal.description && !appraisal.identified) {
        return res.status(502).json({ error: 'vision_empty', message: 'Mike could not get an answer from the image.' });
      }
      return res.json({
        text: appraisal.description ? `${appraisal.description}\n\n${appraisal.text}` : appraisal.text,
        description: appraisal.description,
        identified: appraisal.identified,
        valuation: appraisal.valuation,
      });
    }

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

// ===== Photo-only appraisal =====
// ONE model call does both jobs: the sentence a person reads, and the fields
// the pricing pipeline needs. Asking for the description INSIDE the JSON keeps
// it to a single parse - no delimiter to go missing, and half the vision spend
// and latency of describing and identifying separately.
const DEAL_CATEGORIES = ['vehicle', 'electronics', 'tools', 'furniture', 'outdoor_equipment'];
const DEAL_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor', 'unknown'];

const APPRAISE_PROMPT = [
  'Look at this photo and reply with ONLY a JSON object - no prose outside it, no code fences:',
  '{"description":"two or three plain sentences telling the person what this is and what shape it looks to be in",',
  ' "category":"vehicle|electronics|tools|furniture|outdoor_equipment|null",',
  ' "title":"brand, model number and item type as a person would type it into a search box",',
  ' "condition":"new|like_new|good|fair|poor|unknown",',
  ' "identifiers":"any model or serial numbers, badges or labels you can actually read",',
  ' "confidence":"high|medium|low"}',
  '',
  'Rules that matter:',
  '- title: only what you can genuinely see. A readable model number is worth more than adjectives.',
  '  Write "DeWalt DCD771 20V cordless drill", not "a red cordless power drill".',
  '- category: null if the item does not fit one of the five listed categories.',
  '- condition: judge only visible cosmetic condition. You cannot see mechanical condition,',
  '  battery health or hours, so use "unknown" unless wear or damage is plainly visible.',
  '- confidence: "high" only when brand AND model are legible. "low" when you are guessing',
  '  the model from shape or colour alone. Guessing a specific model you cannot read is the',
  '  one thing never to do - say low and let the person tell us.',
].join('\n');

function parseAppraisal(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const category = String(parsed.category || '').trim().toLowerCase();
  const condition = String(parsed.condition || '').trim().toLowerCase();
  const confidence = String(parsed.confidence || '').trim().toLowerCase();
  return {
    description: String(parsed.description || '').trim().slice(0, 900),
    category: DEAL_CATEGORIES.includes(category) ? category : null,
    title: String(parsed.title || '').trim().slice(0, 160),
    condition: DEAL_CONDITIONS.includes(condition) ? condition : 'unknown',
    identifiers: String(parsed.identifiers || '').trim().slice(0, 200),
    confidence: ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low',
  };
}

const money = (value) => `$${Math.round(Number(value)).toLocaleString('en-US')}`;

// Turns the identification plus whatever DealTough returned into one honest
// paragraph. Every branch that cannot price the item says so plainly and asks
// for the one detail that would fix it, rather than reaching for a number.
export function appraisalText(identified, valuation) {
  if (!identified || !identified.title) {
    return "I can see the photo, but not clearly enough to identify what this is. A straight-on shot with the brand name or model number in frame would let me price it.";
  }
  const item = identified.title;
  if (!identified.category) {
    return `That looks like ${item}. I can only price vehicles, electronics, tools, furniture and outdoor equipment right now, so I can't put a market value on this one.`;
  }
  if (identified.confidence === 'low') {
    return `My best read is ${item}, but I'm not confident enough in that to price it — I'd just be guessing at the model. Tell me the brand and model, or send a photo of the nameplate, and I'll get you a real number.`;
  }
  if (!valuation || valuation.error) {
    return `I make that ${item}. I couldn't reach the pricing data just now, so I'm not going to guess at a value. Try again in a minute.`;
  }
  const fmv = Number(valuation.fairMarketValue);
  if (!Number.isFinite(fmv) || fmv <= 0 || valuation.valuationBasis === 'unknown') {
    return `I make that ${item}, but there aren't enough comparable listings out there to put an honest value on it. If you know the exact model, tell me and I'll try again.`;
  }
  const used = Number(valuation.comparablesUsed) || 0;
  const confidence = Number(valuation.confidencePercent);
  const parts = [`I make that ${item}${identified.identifiers ? ` (${identified.identifiers})` : ''}.`];
  parts.push(`Market value looks like about ${money(fmv)}, from ${used} comparable listing${used === 1 ? '' : 's'}${Number.isFinite(confidence) ? ` — confidence ${Math.round(confidence)}%` : ''}.`);

  const resale = valuation.resale;
  if (resale?.available && Number.isFinite(Number(resale.expectedResalePrice)) && Number.isFinite(Number(resale.buyTargetPrice))) {
    parts.push(`If you're looking to flip it, I'd target buying around ${money(resale.buyTargetPrice)} and reselling around ${money(resale.expectedResalePrice)}. My max-buy line is about ${money(resale.maxBuyPrice)} before any repair, shipping, taxes or selling fees.`);
  } else {
    parts.push("I don't have enough comparable evidence to give you a defensible resale buy target, so I'm not going to make one up.");
  }

  if (identified.condition === 'unknown') {
    parts.push("That's on looks alone — I can't judge mechanical condition from a photo, so treat it as a starting point.");
  }
  parts.push("If I've got the item wrong, tell me what it actually is and I'll re-price it.");
  return parts.join(' ');
}

export async function appraiseImage(image) {
  if (!openai || !image) return { description: '', identified: null, valuation: null, text: appraisalText(null, null) };

  let raw = '';
  try {
    const response = await openai.responses.create({
      model: VISION_MODEL,
      input: [{ role: 'user', content: visionContent(APPRAISE_PROMPT, image) }],
      max_output_tokens: 700,
    });
    raw = String(response.output_text || '').trim();
  } catch (error) {
    console.error('[vision] appraise call failed:', error?.message || error);
    return { description: '', identified: null, valuation: null, text: appraisalText(null, null) };
  }

  const parsed = parseAppraisal(raw);
  // If the model answered in prose instead of JSON, keep what it said for the
  // person and fall through to the honest "could not identify" branch rather
  // than throwing the whole response away.
  if (!parsed) {
    const description = raw.slice(0, 900);
    return { description, identified: null, valuation: null, text: appraisalText(null, null) };
  }

  const { description, ...identified } = parsed;
  let valuation = null;
  if (identified.category && identified.title && identified.confidence !== 'low') {
    try {
      valuation = await analyzeDeal({
        category: identified.category,
        title: identified.title,
        condition: identified.condition,
        description: identified.identifiers || undefined,
      });
    } catch (error) {
      console.error('[vision] appraisal pricing failed:', error?.message || error);
      valuation = { error: 'pricing_unavailable' };
    }
  }
  return { description, identified, valuation, text: appraisalText(identified, valuation) };
}
