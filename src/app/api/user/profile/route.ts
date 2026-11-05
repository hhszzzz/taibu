import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import { getUserSettingsSnapshot } from '@/lib/user/settings';

type UserProfilePatchBody = {
    profile?: {
        nickname?: unknown;
        avatar_url?: unknown;
    };
    nickname?: unknown;
    avatar_url?: unknown;
};

const PROFILE_COLUMNS = ['id', 'nickname', 'avatar_url', 'is_admin'] as const;

async function loadProfileRow(db: ScopedDb, userId: string): Promise<Record<string, unknown> | null> {
    const row = await db.tx((trx) => trx
        .selectFrom('users')
        .select(PROFILE_COLUMNS)
        .where('id', '=', userId)
        .executeTakeFirst());
    return (row ?? null) as Record<string, unknown> | null;
}

async function tryLoadProfileRow(
    db: ScopedDb,
    userId: string,
): Promise<{ row: Record<string, unknown> | null; error: { message: string } | null }> {
    try {
        return { row: await loadProfileRow(db, userId), error: null };
    } catch (error) {
        console.error('加载用户资料失败:', error);
        return { row: null, error: { message: '加载用户资料失败' } };
    }
}

async function loadProfileWithRecovery(
    auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>,
): Promise<{ row: Record<string, unknown> | null; error: { message: string } | null }> {
    const initial = await tryLoadProfileRow(auth.db, auth.user.id);
    if (initial.row || initial.error) {
        return initial;
    }

    const ensured = await ensureUserRecordRow(auth.db, auth.user);
    if (!ensured.ok) {
        console.error('创建用户资料失败:', ensured.error);
        return { row: null, error: { message: '创建用户资料失败' } };
    }

    return await tryLoadProfileRow(auth.db, auth.user.id);
}

function normalizeProfileRow(row: Record<string, unknown> | null) {
    return row ? { ...row, is_admin: row.is_admin === true } : null;
}

async function loadLinuxDoBinding(
    auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>,
): Promise<{ sub: string | null; trustLevel: number | null }> {
    try {
        const row = await auth.db.tx((trx) => trx
            .selectFrom('user_oauth_providers')
            .select(['provider_user_id', 'provider_metadata'])
            .where('user_id', '=', auth.user.id)
            .where('provider', '=', 'linuxdo')
            .executeTakeFirst());
        if (!row) return { sub: null, trustLevel: null };
        const metadata = row.provider_metadata;
        const trustLevel = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            && typeof (metadata as { trust_level?: unknown }).trust_level === 'number'
            ? (metadata as { trust_level: number }).trust_level
            : null;
        return { sub: row.provider_user_id, trustLevel };
    } catch (error) {
        console.error('加载 Linux.do 绑定失败:', error);
        return { sub: null, trustLevel: null };
    }
}

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const profileOnly = new URL(request.url).searchParams.get('scope') === 'profile';

    if (profileOnly) {
        const [profileResult, linuxdo] = await Promise.all([
            loadProfileWithRecovery(auth),
            loadLinuxDoBinding(auth),
        ]);
        if (profileResult.error) {
            return jsonError('获取用户资料失败', 500);
        }

        return jsonOk({
            profile: normalizeProfileRow(profileResult.row),
            settings: null,
            linuxdo,
        });
    }

    const [profileResult, settingsResult, linuxdo] = await Promise.all([
        loadProfileWithRecovery(auth),
        getUserSettingsSnapshot(auth.db, auth.user.id),
        loadLinuxDoBinding(auth),
    ]);
    if (profileResult.error || settingsResult.error) {
        return jsonError('获取用户资料失败', 500);
    }

    return jsonOk({
        profile: normalizeProfileRow(profileResult.row),
        settings: settingsResult.settings,
        linuxdo,
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    let action = 'ensure';
    try {
        const body = await request.json() as { action?: unknown };
        action = typeof body.action === 'string' ? body.action : 'ensure';
    } catch {
        action = 'ensure';
    }

    if (action !== 'ensure') {
        return jsonError(`Unsupported action: ${action}`, 400);
    }

    const ensured = await ensureUserRecordRow(auth.db, auth.user);
    if (!ensured.ok) {
        return jsonError('创建用户资料失败', 500);
    }

    return jsonOk({ success: true }, 201);
}

async function updateProfileRow(
    auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>,
    payload: Record<string, unknown>,
): Promise<{ row: Record<string, unknown> | null; error: { message: string } | null }> {
    try {
        const row = await auth.db.tx((trx) => trx
            .updateTable('users')
            .set(payload as never)
            .where('id', '=', auth.user.id)
            .returning(PROFILE_COLUMNS)
            .executeTakeFirst());
        return { row: (row ?? null) as Record<string, unknown> | null, error: null };
    } catch (error) {
        console.error('更新用户资料失败:', error);
        return { row: null, error: { message: '更新用户资料失败' } };
    }
}

export async function PATCH(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    let body: UserProfilePatchBody;
    try {
        body = await request.json() as UserProfilePatchBody;
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    const profileInput = body.profile ?? {};
    const nicknameInput = profileInput.nickname ?? body.nickname;
    const avatarUrlInput = profileInput.avatar_url ?? body.avatar_url;

    const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    };
    let shouldUpdateUser = false;

    if (typeof nicknameInput === 'string') {
        updatePayload.nickname = nicknameInput.trim();
        shouldUpdateUser = true;
    }
    if (typeof avatarUrlInput === 'string' || avatarUrlInput === null) {
        updatePayload.avatar_url = avatarUrlInput;
        shouldUpdateUser = true;
    }

    if (!shouldUpdateUser) {
        return jsonError('没有可更新的资料字段', 400);
    }

    const [updateResult, settingsResult] = await Promise.all([
        updateProfileRow(auth, updatePayload),
        getUserSettingsSnapshot(auth.db, auth.user.id),
    ]);

    if (updateResult.error || settingsResult.error) {
        return jsonError('更新用户资料失败', 500);
    }

    return jsonOk({
        profile: normalizeProfileRow(updateResult.row),
        settings: settingsResult.settings,
    });
}
