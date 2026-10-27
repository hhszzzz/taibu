/**
 * 生成图片的共享形状：浏览器展示、消息元数据、分享快照与 Agent 工具结果共用。
 * 只放类型与纯函数，不含服务端依赖；图片字节由 /api/images/[id] 读取。
 */

/** Sizes the composer offers; the gateway and OpenAI-compatible image APIs take `{width}x{height}`. */
export const GENERATED_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'] as const;
export type GeneratedImageSize = (typeof GENERATED_IMAGE_SIZES)[number];

/** 输入框的尺寸选项文案。 */
export const GENERATED_IMAGE_SIZE_LABELS: Readonly<Record<string, string>> = {
  '1024x1024': '方形 1024×1024',
  '1536x1024': '横向 1536×1024',
  '1024x1536': '竖向 1024×1536',
  '1792x1024': '宽幅 1792×1024',
  '1024x1792': '长幅 1024×1792',
};

/** One image generation request never produces more than this many images. */
export const GENERATED_IMAGE_MAX_COUNT = 4;

/** What a message or tool result keeps about one image: no bytes, no prompt, no owner. */
export type GeneratedImageRef = {
  id: string;
  size: string;
  mimeType: string;
};

export type GeneratedImageDto = GeneratedImageRef & { url: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SIZE = /^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/u;
const MIME = /^image\/(?:png|jpeg|webp)$/u;

export function isGeneratedImageSize(value: unknown): value is GeneratedImageSize {
  return typeof value === 'string' && (GENERATED_IMAGE_SIZES as readonly string[]).includes(value);
}

export function isGeneratedImageRef(value: unknown): value is GeneratedImageRef {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && UUID.test(row.id)
    && typeof row.size === 'string' && SIZE.test(row.size)
    && typeof row.mimeType === 'string' && MIME.test(row.mimeType);
}

/** A gallery's images, read defensively from stored JSON. */
export function readGeneratedImageRefs(value: unknown): GeneratedImageRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isGeneratedImageRef).slice(0, GENERATED_IMAGE_MAX_COUNT * 4).map(({ id, size, mimeType }) => ({ id, size, mimeType }));
}

/** The image route; a share page passes its token so the route can match the share's conversation. */
export function generatedImageUrl(id: string, shareToken?: string | null): string {
  return `/api/images/${encodeURIComponent(id)}${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`;
}

/** CSS aspect ratio for a stored size (a malformed size falls back to square). */
export function generatedImageAspectRatio(size: string): string {
  const match = /^([1-9][0-9]{2,3})x([1-9][0-9]{2,3})$/u.exec(size);
  return match ? `${match[1]} / ${match[2]}` : '1 / 1';
}
