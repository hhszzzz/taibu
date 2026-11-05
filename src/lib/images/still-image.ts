/**
 * An image from outside the platform (the member's own image model) read from its header, without decoding it: one
 * still PNG, JPEG or WebP and the size it declares. Animated PNG and WebP are refused, and so is a size the stored size
 * cannot hold (each side 100–9999 pixels). Plain code, so the Agent worker bundle needs no native image library.
 */

import { GENERATED_IMAGE_MAX_BYTES, STORED_IMAGE_SIZE } from './generated';

export type StillImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; size: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const uint32 = (bytes: Uint8Array, at: number) => bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
const uint16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) + bytes[at + 1];
const uint24le = (bytes: Uint8Array, at: number) => bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16);

/** IHDR gives the size; an acTL chunk before the image data makes it an animation. */
function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  for (let at = 8; at + 8 <= bytes.length; at += 12 + uint32(bytes, at)) {
    const type = ascii(bytes, at + 4, 4);
    if (type === 'acTL') return null;
    if (type === 'IDAT') return [uint32(bytes, 16), uint32(bytes, 20)];
  }
  return null;
}

/** The first start-of-frame segment gives the size; scan data or the end before it means there is none. */
function jpegSize(bytes: Uint8Array): [number, number] | null {
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = uint16(bytes, at + 2);
    if (length < 2) return null;
    // SOF0–SOF15, which share the C0–CF range with DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return at + 9 <= bytes.length ? [uint16(bytes, at + 7), uint16(bytes, at + 5)] : null;
    at += 2 + length;
  }
  return null;
}

/** A lossy, lossless or extended header gives the size; the extended header flags an animation. */
function webpSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return [(bytes[26] | (bytes[27] << 8)) & 0x3fff, (bytes[28] | (bytes[29] << 8)) & 0x3fff];
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return bytes[20] & 0x02 ? null : [uint24le(bytes, 24) + 1, uint24le(bytes, 27) + 1];
  return null;
}

export function readStillImage(bytes: Uint8Array): StillImage | null {
  if (bytes.length > GENERATED_IMAGE_MAX_BYTES) return null;
  const [mediaType, dimensions] = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ? ['image/png' as const, pngSize(bytes)]
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? ['image/jpeg' as const, jpegSize(bytes)]
      : bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' ? ['image/webp' as const, webpSize(bytes)]
        : [null, null];
  if (!mediaType || !dimensions) return null;
  const size = `${dimensions[0]}x${dimensions[1]}`;
  return STORED_IMAGE_SIZE.test(size) ? { mediaType, size } : null;
}
