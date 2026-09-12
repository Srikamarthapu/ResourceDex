import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class ImageValidationError extends Error {
  constructor(message = 'Choose a valid JPEG, PNG, or WebP image up to 10 MB.') {
    super(message);
    this.name = 'ImageValidationError';
  }
}

/** Decode actual bytes before trusting an upload. Sharp removes metadata by default. */
export async function normalizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new ImageValidationError();
  try {
    const options = {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'warning' as const,
    };
    const metadata = await sharp(bytes, options).metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format))
      throw new ImageValidationError();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new ImageValidationError(
        'Choose a still image under 40 megapixels. Animated or unusually large images are unsupported.',
      );
    }
    const { data, info } = await sharp(bytes, options)
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      mimeType: 'image/jpeg' as const,
      hash: createHash('sha256').update(data).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError();
  }
}
