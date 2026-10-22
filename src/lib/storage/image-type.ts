/**
 * 头像按文件头（魔数）识别类型，不信任上传的 MIME 与扩展名。
 * 只接受静态位图；SVG 被拒绝（可携带脚本）。
 */

export type AvatarImageType = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif';
  extension: 'png' | 'jpg' | 'webp' | 'gif' | 'avif';
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWithSignature(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

export function sniffAvatarImage(bytes: Uint8Array): AvatarImageType | null {
  if (startsWithSignature(bytes, PNG_SIGNATURE)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') {
      return { mime: 'image/gif', extension: 'gif' };
    }
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') {
      return { mime: 'image/avif', extension: 'avif' };
    }
  }
  return null;
}

const AVATAR_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

export function avatarContentTypeForKey(key: string): string | null {
  const extension = key.includes('.') ? key.split('.').pop()?.toLowerCase() : undefined;
  return extension ? AVATAR_CONTENT_TYPES[extension] ?? null : null;
}
