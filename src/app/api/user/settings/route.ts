import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext, resolveRequestDbClient } from '@/lib/api-utils';
import {
    buildUserSettingsUpdatePayload,
    hasEffectiveUserSettingsUpdate,
    normalizeUserSettings,
    USER_SETTINGS_SELECT,
    type UserSettingsUpdateInput,
} from '@/lib/user/settings';

async function loadSettings(auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>) {
  const db = resolveRequestDbClient(auth);
  if (!db) {
    return {
      settings: normalizeUserSettings(null),
      error: new Error('missing auth db client'),
    };
  }

  const { data, error } = await db
    .from('user_settings')
    .select(USER_SETTINGS_SELECT)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  return {
    settings: normalizeUserSettings((data ?? null) as Record<string, unknown> | null),
    error,
  };
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
  const db = resolveRequestDbClient(auth);
  if (!db) return jsonError('更新用户设置失败', 500);

  let body: UserSettingsUpdateInput;
  try {
    body = await request.json() as UserSettingsUpdateInput;
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  const payload = buildUserSettingsUpdatePayload(auth.user.id, body);
  if (!hasEffectiveUserSettingsUpdate(payload)) {
    return jsonError('没有可更新的设置字段', 400);
  }

  const { error } = await db
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
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
