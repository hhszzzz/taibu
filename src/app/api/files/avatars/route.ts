import { type NextRequest } from 'next/server';

import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { User } from '@supabase/supabase-js';
import type { ScopedDb } from '@/lib/db/context.server';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import { getObjectStore } from '@/lib/storage/index.server';
import { sniffAvatarImage } from '@/lib/storage/image-type';

export const runtime = 'nodejs';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** Multipart overhead allowance for the early Content-Length rejection. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const AVATAR_URL_PREFIX = '/api/files/avatars/';

async function saveAvatarUrl(db: ScopedDb, user: Pick<User, 'id' | 'user_metadata'>, publicUrl: string): Promise<boolean> {
  const write = async () => Boolean(await db.tx((trx) => trx
    .updateTable('users')
    .set({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .where('id', '=', user.id)
    .returning('id')
    .executeTakeFirst()));

  try {
    if (await write()) return true;
    const ensured = await ensureUserRecordRow(db, user);
    if (!ensured.ok) {
      console.error('创建用户资料失败:', ensured.error);
      return false;
    }
    return await write();
  } catch (error) {
    console.error('更新头像地址失败:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES * 2 + MULTIPART_OVERHEAD_BYTES) {
    return jsonError('头像文件不能超过 2 MiB', 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('头像请求无效', 400);
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return jsonError('请选择头像文件', 400);
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return jsonError('头像文件不能超过 2 MiB', 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = sniffAvatarImage(bytes);
  if (!imageType) {
    return jsonError('仅支持 PNG、JPEG、WebP、GIF、AVIF 图片', 415);
  }

  const key = `${auth.user.id}-${Date.now()}.${imageType.extension}`;
  const publicUrl = `${AVATAR_URL_PREFIX}${key}`;
  const store = getObjectStore();

  let previousUrl: string | null = null;
  try {
    const row = await auth.db.tx((trx) => trx
      .selectFrom('users')
      .select('avatar_url')
      .where('id', '=', auth.user.id)
      .executeTakeFirst());
    previousUrl = typeof row?.avatar_url === 'string' ? row.avatar_url : null;
  } catch (error) {
    console.warn('读取旧头像地址失败:', error);
  }

  try {
    await store.put('avatars', key, bytes, { contentType: imageType.mime });
  } catch (error) {
    console.error('保存头像文件失败:', error);
    return jsonError('头像上传失败，请稍后重试', 500);
  }

  if (!(await saveAvatarUrl(auth.db, auth.user, publicUrl))) {
    await store.delete('avatars', [key]).catch((error: unknown) => {
      console.warn('清理未保存的头像失败:', error);
    });
    return jsonError('头像保存失败，请稍后重试', 500);
  }

  if (previousUrl?.startsWith(AVATAR_URL_PREFIX)) {
    const previousKey = previousUrl.slice(AVATAR_URL_PREFIX.length);
    if (previousKey && previousKey !== key) {
      await store.delete('avatars', [previousKey]).catch((error: unknown) => {
        console.warn('清理旧头像失败:', error);
      });
    }
  }

  return jsonOk({ data: { publicUrl }, error: null });
}
