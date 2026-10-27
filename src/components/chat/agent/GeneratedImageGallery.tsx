'use client';

import { generatedImageAspectRatio, generatedImageUrl, type GeneratedImageRef } from '@/lib/images/generated';
import './generated-images.css';

/** A message's or tool card's generated images: click one to open the full image. */
export function GeneratedImageGallery({ images, shareToken, label }: {
  images: readonly GeneratedImageRef[];
  /** Public share page: the route requires the share token of the image's conversation. */
  shareToken?: string | null;
  label?: string;
}) {
  if (!images.length) return null;
  return (
    <ul className="generated-image-gallery" data-count={images.length} aria-label={label ?? '生成的图片'}>
      {images.map((image, index) => {
        const url = generatedImageUrl(image.id, shareToken);
        return <li key={image.id}>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开第 ${index + 1} 张生成的图片`}>
            {/* The route streams private bytes; Next's image optimizer would fetch without the reader's credentials. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`生成的图片 ${index + 1}`} loading="lazy" decoding="async"
              style={{ aspectRatio: generatedImageAspectRatio(image.size) }} />
          </a>
        </li>;
      })}
    </ul>
  );
}
