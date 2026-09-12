import type { Bounds } from '../ai/detection';

type Size = { width: number; height: number };
export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Map normalized bounds onto the actual image content, including contain letterboxing or cover cropping. */
export function projectBounds(
  bounds: Bounds,
  image: Size,
  viewport: Size,
  fit: 'contain' | 'cover' = 'contain',
): PixelBox {
  if (
    [image.width, image.height, viewport.width, viewport.height].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  ) {
    throw new Error('Image and viewport dimensions must be positive.');
  }
  const scale = Math[fit === 'contain' ? 'min' : 'max'](
    viewport.width / image.width,
    viewport.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: (viewport.width - width) / 2 + (bounds.x_min * width) / 1000,
    top: (viewport.height - height) / 2 + (bounds.y_min * height) / 1000,
    width: ((bounds.x_max - bounds.x_min) * width) / 1000,
    height: ((bounds.y_max - bounds.y_min) * height) / 1000,
  };
}

export function cropPixels(bounds: Bounds, image: Size): PixelBox {
  const left = Math.floor((bounds.x_min * image.width) / 1000);
  const top = Math.floor((bounds.y_min * image.height) / 1000);
  return {
    left,
    top,
    width: Math.max(
      1,
      Math.min(image.width, Math.ceil((bounds.x_max * image.width) / 1000)) - left,
    ),
    height: Math.max(
      1,
      Math.min(image.height, Math.ceil((bounds.y_max * image.height) / 1000)) - top,
    ),
  };
}
