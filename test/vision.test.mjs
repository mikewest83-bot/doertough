import { strict as assert } from 'node:assert';
import { normalizeVisionImage, visionContent } from '../server/vision.mjs';

describe('Mike Vision input validation', () => {
  it('accepts a valid JPEG data URL', () => {
    const image = normalizeVisionImage({
      mediaType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,SGVsbG8=',
    });
    assert.equal(image.mediaType, 'image/jpeg');
    assert.equal(image.dataUrl, 'data:image/jpeg;base64,SGVsbG8=');
  });

  it('rejects an unsupported media type', () => {
    assert.throws(
      () => normalizeVisionImage({ mediaType: 'application/pdf', dataUrl: 'data:application/pdf;base64,SGVsbG8=' }),
      /vision_image_type_invalid/,
    );
  });

  it('rejects a mismatched data URL prefix', () => {
    assert.throws(
      () => normalizeVisionImage({ mediaType: 'image/jpeg', dataUrl: 'data:image/png;base64,SGVsbG8=' }),
      /vision_image_encoding_invalid/,
    );
  });

  it('keeps image input in the same user turn', () => {
    const content = visionContent('Is this a good deal?', {
      mediaType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,SGVsbG8=',
    });
    assert.deepEqual(content, [
      { type: 'input_text', text: 'Is this a good deal?' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,SGVsbG8=', detail: 'auto' },
    ]);
  });
});
