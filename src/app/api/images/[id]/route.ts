import { type NextRequest } from 'next/server';
import { anonDb } from '@/lib/db/context.server';
import { getAuthContext, jsonError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { isShareToken } from '@/lib/chat/conversation-share';
import {
  findGeneratedImageForShare,
  generatedImageBytes,
  type GeneratedImageLocation,
} from '@/lib/ai/image-generation.server';

export const runtime = 'nodejs';

/** 生图结果：仅本人可读；公开分享页凭分享令牌读取该对话的图片。 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return jsonError('图片 ID 无效', 400);

  const auth = await getAuthContext(request);
  if (auth.authError) return jsonError(auth.authError.message, auth.authError.status);

  let location: GeneratedImageLocation | null = null;
  const owner = auth.user;
  if (owner) {
    const row = await auth.db.tx(trx => trx.selectFrom('generated_images')
      .select(['object_path', 'mime_type', 'bytes', 'sha256'])
      .where('id', '=', id).where('user_id', '=', owner.id)
      .executeTakeFirst()).catch(() => null);
    location = (row as GeneratedImageLocation | undefined) ?? null;
  }
  if (!location) {
    const token = request.nextUrl.searchParams.get('share');
    if (token && isShareToken(token)) {
      location = await findGeneratedImageForShare(anonDb(), token, id).catch(() => null);
    }
  }
  if (!location) return jsonError('图片不存在或无权访问', 404);

  try {
    const bytes = await generatedImageBytes(location);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': location.mime_type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return jsonError('读取图片失败', 404);
  }
}
