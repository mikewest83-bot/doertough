import { strict as assert } from 'node:assert';
import { normalizeVisionImage, visionContent } from '../server/vision.mjs';

describe('Mike Vision input validation', () => {
  it('accepts a valid JPEG data URL', () => {
    const image = normalizeVisionImage({ mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,SGVsbG8=' });
    assert.equal(image.mediaType, 'image/jpeg');
  });

  it('rejects unsupported media types', () => {
    assert.throws(() => normalizeVisionImage({ mediaType: 'application/pdf', dataUrl: 'data:application/pdf;base64,SGVsbG8=' }), /vision_image_type_invalid/);
  });

  it('rejects mismatched data URL prefixes', () => {
    assert.throws(() => normalizeVisionImage({ mediaType: 'image/jpeg', dataUrl: 'data:image/png;base64,SGVsbG8=' }), /vision_image_encoding_invalid/);
  });

  it('keeps text and image in the same user turn', () => {
    assert.deepEqual(visionContent('Is this a good deal?', { mediaType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,SGVsbG8=' }), [
      { type: 'input_text', text: 'Is this a good deal?' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,SGVsbG8=', detail: 'auto' },
    ]);
  });
});
