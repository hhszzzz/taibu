'use client';
import Image from 'next/image';

/** Shared artwork; orientation comes from the existing reading. Reversed cards render rotated 180°. */
export function TarotCardFace({ image, name, reversed = false }: { image: string; name: string; reversed?: boolean }) {
  return <Image src={image} alt={`${name}${reversed ? '（逆位）' : ''}`} fill sizes="(max-width: 640px) 120px, 180px" className={`object-cover ${reversed ? 'rotate-180' : ''}`} />;
}
