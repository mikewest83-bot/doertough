import { expect } from 'chai';
import { appraisalText, normalizeVisionImage, visionContent } from '../server/vision.mjs';

describe('Vision validation', function () {
  const png = 'data:image/png;base64,AA==';

  it('normalizes supported images', function () {
    expect(normalizeVisionImage({ dataUrl: png, mediaType: 'IMAGE/PNG' })).to.deep.equal({ dataUrl: png, mediaType: 'image/png' });
  });

  it('rejects unsupported media types and mismatched encodings', function () {
    expect(() => normalizeVisionImage({ dataUrl: png, mediaType: 'image/gif' })).to.throw('vision_image_type_invalid');
    expect(() => normalizeVisionImage({ dataUrl: 'data:image/jpeg;base64,AA==', mediaType: 'image/png' })).to.throw('vision_image_encoding_invalid');
  });

  it('rejects malformed base64 and oversized payloads', function () {
    expect(() => normalizeVisionImage({ dataUrl: 'data:image/png;base64,not-valid?', mediaType: 'image/png' })).to.throw('vision_image_encoding_invalid');
    expect(() => normalizeVisionImage({ dataUrl: `data:image/png;base64,${'A'.repeat(7_000_000)}`, mediaType: 'image/png' })).to.throw('vision_image_too_large');
  });

  it('builds text-only and image content safely', function () {
    expect(visionContent('hello')).to.deep.equal([{ type: 'input_text', text: 'hello' }]);
    expect(visionContent('look', { dataUrl: png })).to.deep.equal([
      { type: 'input_text', text: 'look' },
      { type: 'input_image', image_url: png, detail: 'auto' },
    ]);
  });

  it('includes a resale buy target only when comparable evidence exists', function () {
    const identified = { title: 'DeWalt DCD771 drill', category: 'tools', condition: 'good', confidence: 'high', identifiers: 'DCD771' };
    const withResale = appraisalText(identified, {
      fairMarketValue: 250,
      valuationBasis: 'comparables',
      comparablesUsed: 18,
      confidencePercent: 86,
      resale: { available: true, expectedResalePrice: 250, buyTargetPrice: 200, maxBuyPrice: 225 },
    });
    expect(withResale).to.include('buying around $200');
    expect(withResale).to.include('reselling around $250');
    expect(withResale).to.include('max-buy line is about $225');

    const withoutResale = appraisalText(identified, {
      fairMarketValue: 250,
      valuationBasis: 'comparables',
      comparablesUsed: 1,
      confidencePercent: 35,
      resale: { available: false },
    });
    expect(withoutResale).to.include("don't have enough comparable evidence");
  });
});
