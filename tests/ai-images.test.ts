import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { cropPixels, validItemBounds } from '../src/lib/images/geometry';
import {
  ImageValidationError,
  MAX_UPLOAD_BYTES,
  normalizeImage,
} from '../src/lib/images/normalize';

describe('private image normalization', () => {
  it('normalizes EXIF orientation and strips metadata without enlarging', async () => {
    const input = await sharp({
      create: { width: 40, height: 80, channels: 3, background: '#ac9272' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await normalizeImage(input);
    const output = await sharp(result.bytes).metadata();
    expect(result).toMatchObject({
      width: 80,
      height: 40,
      mimeType: 'image/jpeg',
    });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(output.exif).toBeUndefined();
    expect(output.orientation).toBeUndefined();
  });
  it('shrinks a large image to a longest edge of 2048', async () => {
    const input = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#dddddd' },
    })
      .webp()
      .toBuffer();
    expect(await normalizeImage(input)).toMatchObject({
      width: 2048,
      height: 1024,
    });
  });
  it('accepts PNG bytes without trusting the filename', async () => {
    const input = await sharp({
      create: { width: 25, height: 15, channels: 4, background: '#00000000' },
    })
      .png()
      .toBuffer();
    expect(await normalizeImage(input)).toMatchObject({
      width: 25,
      height: 15,
      mimeType: 'image/jpeg',
    });
  });
  it('rejects invalid bytes, disguised SVG, oversized payloads, and decompression bombs', async () => {
    await expect(normalizeImage(Buffer.from('not a JPEG'))).rejects.toBeInstanceOf(
      ImageValidationError,
    );
    await expect(
      normalizeImage(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        ),
      ),
    ).rejects.toBeInstanceOf(ImageValidationError);
    await expect(normalizeImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(
      ImageValidationError,
    );
    const huge = await sharp({
      create: { width: 6400, height: 6400, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(normalizeImage(huge)).rejects.toBeInstanceOf(ImageValidationError);
  });
});

describe('detected item photos', () => {
  it('extracts the detected item without retaining the rest of the source photo', async () => {
    const source = await sharp({
      create: { width: 100, height: 60, channels: 3, background: '#ff0000' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 50, height: 60, channels: 3, background: '#0000ff' },
          })
            .png()
            .toBuffer(),
          left: 50,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const bounds = validItemBounds({ x_min: 500, y_min: 0, x_max: 1000, y_max: 1000 });
    expect(bounds).not.toBeNull();
    const { data, info } = await sharp(source)
      .extract(cropPixels(bounds!, { width: 100, height: 60 }))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 50, height: 60 });
    expect([...data.subarray(0, 3)]).toEqual([0, 0, 255]);
    expect([...data.subarray(-3)]).toEqual([0, 0, 255]);
  });

  it.each([
    null,
    undefined,
    { x_min: 0, y_min: 0, x_max: 0, y_max: 100 },
    { x_min: 900, y_min: 0, x_max: 100, y_max: 100 },
    { x_min: -1, y_min: 0, x_max: 100, y_max: 100 },
    { x_min: 0, y_min: 0, x_max: 1001, y_max: 100 },
    { x_min: 0, y_min: 0, x_max: NaN, y_max: 100 },
    { x_min: 0, y_min: 0, x_max: 1.5, y_max: 100 },
  ])('uses the full-photo fallback for invalid bounds %j', (bounds) => {
    expect(validItemBounds(bounds)).toBeNull();
  });
});
