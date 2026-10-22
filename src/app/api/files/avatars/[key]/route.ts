import { type NextRequest } from 'next/server';

import { getObjectStore } from '@/lib/storage/index.server';
import { assertObjectKey } from '@/lib/storage/local-fs.server';
import { avatarContentTypeForKey } from '@/lib/storage/image-type';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  // 头像 key 是单段对象名；含斜杠的值不属于本路由。
  if (!key || key.includes('/')) {
    return new Response('Not found', { status: 404 });
  }
  try {
    assertObjectKey(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  let stored;
  try {
    stored = await getObjectStore().get('avatars', key);
  } catch (error) {
    console.error('读取头像失败:', error);
    return new Response('Storage unavailable', { status: 503 });
  }
  if (!stored) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(stored.stream, {
    headers: {
      'Content-Type': avatarContentTypeForKey(key) ?? 'application/octet-stream',
      'Content-Length': String(stored.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
