import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import {
    buildUserSettingsUpdatePayload,
    getUserSettingsSnapshot,
    hasEffectiveUserSettingsUpdate,
    type UserSettingsUpdateInput,
} from '@/lib/user/settings';
import { validPromptTemplates } from '@/lib/agent/prompt-templates';

async function loadSettings(auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>) {
  return getUserSettingsSnapshot(auth.db, auth.user.id);
}

export async function GET(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const expectedUserId = request.headers.get('X-Expected-User-Id');
  if (expectedUserId !== null && expectedUserId !== auth.user.id) {
    return jsonError('账号已切换，请重新加载设置', 409);
  }

  const { settings, error } = await loadSettings(auth);
  if (error) {
    return jsonError('获取用户设置失败', 500);
  }

  return jsonOk({
    settings,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const expectedUserId = request.headers.get('X-Expected-User-Id');
  if (expectedUserId !== null && expectedUserId !== auth.user.id) {
    return jsonError('账号已切换，请重新加载设置', 409);
  }
  let body: UserSettingsUpdateInput;
  try {
    body = await request.json() as UserSettingsUpdateInput;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('设置无效', 400);
  if (body.chatPreferences?.promptTemplates !== undefined && !validPromptTemplates(body.chatPreferences.promptTemplates)) return jsonError('问法模板无效，最多 20 个，每个正文最多 4000 字符', 400);
  if (body.chatPreferences?.memoryEnabled !== undefined && typeof body.chatPreferences.memoryEnabled !== 'boolean') return jsonError('记忆设置无效', 400);
  if (body.chatPreferences !== undefined) {
    const previous = await loadSettings(auth);
    if (previous.error) return jsonError('读取原设置失败', 500);
    body.chatPreferences = { ...previous.settings.chatPreferences, ...body.chatPreferences };
  }
  const payload = buildUserSettingsUpdatePayload(auth.user.id, body);
  if (!hasEffectiveUserSettingsUpdate(payload)) {
    return jsonError('没有可更新的设置字段', 400);
  }

  try {
    await auth.db.tx((trx) => trx
      .insertInto('user_settings')
      .values(payload as never)
      .onConflict((conflict) => conflict.column('user_id').doUpdateSet(payload as never))
      .execute());
  } catch {
    return jsonError('更新用户设置失败', 500);
  }

  const refreshed = await loadSettings(auth);
  if (refreshed.error) {
    return jsonError('读取更新后的用户设置失败', 500);
  }

  return jsonOk({
    settings: refreshed.settings,
  });
}
