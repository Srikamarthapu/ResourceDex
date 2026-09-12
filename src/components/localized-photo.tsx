import { useId } from 'react';
import type { Bounds } from '@/lib/ai/detection';
import { cropPixels, validItemBounds } from '@/lib/images/geometry';

/** Preview the same image coordinates used by the saved listing crop. */
export function LocalizedPhoto({
  src,
  alt,
  bounds,
  width,
  height,
}: {
  src: string;
  alt: string;
  bounds: Bounds | null;
  width: number;
  height: number;
}) {
  const clipId = useId();
  const valid = validItemBounds(bounds);
  const crop = valid && width > 0 && height > 0 ? cropPixels(valid, { width, height }) : null;
  if (!crop)
    return (
      <div className="review-image">
        <img src={src} alt={alt} />
      </div>
    );
  return (
    <svg
      role="img"
      aria-label={alt}
      viewBox={`${crop.left} ${crop.top} ${crop.width} ${crop.height}`}
      style={{
        display: 'block',
        width: '100%',
        aspectRatio: '4 / 3',
        maxHeight: 480,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={crop.left} y={crop.top} width={crop.width} height={crop.height} />
        </clipPath>
      </defs>
      <image href={src} x={0} y={0} width={width} height={height} clipPath={`url(#${clipId})`} />
    </svg>
  );
}
