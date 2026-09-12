'use client';

import Link from 'next/link';
import { ArrowUpRight, MapPin, Package } from 'lucide-react';
import { categoryLabels, type Resource } from '@/lib/types';
import { quantityLabel } from '@/lib/format';

export function ResourceCard({
  resource,
  imageUrl,
  area,
  href,
}: {
  resource: Resource;
  imageUrl?: string | null;
  area: string;
  href?: string;
}) {
  return (
    <article className="resource-card">
      <Link
        href={href || `/resources/${resource.id}`}
        aria-label={`${resource.title}, free, ${area}${resource.is_sample ? ', sample listing' : ''}`}
      >
        <div className="card-image">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={resource.image_alt || resource.title}
              width={600}
              height={430}
              loading="lazy"
            />
          ) : (
            <div className="image-fallback">
              <Package size={40} strokeWidth={1.2} />
            </div>
          )}
          <span className="free-badge">Free</span>
          {resource.is_sample && <span className="sample-badge">Sample</span>}
        </div>
        <div className="card-body">
          <p className="card-category">{categoryLabels[resource.category]}</p>
          <div className="card-title-row">
            <h3>{resource.title || 'Untitled resource'}</h3>
            <ArrowUpRight size={14} />
          </div>
          <p className="card-quantity">{quantityLabel(resource)}</p>
          <div className="card-meta">
            <span>
              <MapPin size={11} />
              {area}
            </span>
            <span className={`status ${resource.status}`}>
              {resource.status[0].toUpperCase() + resource.status.slice(1)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
