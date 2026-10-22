import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { buildMembershipInfo, type MembershipType } from '@/lib/user/membership';
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

const PROFILE_COLUMNS = ['id', 'nickname', 'avatar_url', 'is_admin', 'membership', 'membership_expires_at', 'ai_chat_count'] as const;

async function loadProfileRow(db: ScopedDb, userId: string): Promise<Record<string, unknown> | null> {
    const row = await db.tx((trx) => trx
        .selectFrom('users')
        .select(PROFILE_COLUMNS)
        .where('id', '=', userId)
        .executeTakeFirst());
    return (row ?? null) as Record<string, unknown> | null;
}

async function loadProfileWithRecovery(
    auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>,
): Promise<{ row: Record<string, unknown> | null; error: { message: string } | null }> {
    let row: Record<string, unknown> | null;
    try {
        row = await loadProfileRow(auth.db, auth.user.id);
    } catch (error) {
        console.error('加载用户资料失败:', error);
        return { row: null, error: { message: '加载用户资料失败' } };
    }
    if (row) {
        return { row, error: null };
    }

    const ensured = await ensureUserRecordRow(auth.db, auth.user);
    if (!ensured.ok) {
        console.error('创建用户资料失败:', ensured.error);
        return { row: null, error: { message: '创建用户资料失败' } };
    }

    try {
        return { row: await loadProfileRow(auth.db, auth.user.id), error: null };
    } catch (error) {
        console.error('加载用户资料失败:', error);
        return { row: null, error: { message: '加载用户资料失败' } };
    }
}

function normalizeProfileRow(row: Record<string, unknown> | null) {
    if (!row) {
        return null;
    }

    const membershipType: MembershipType | null = row.membership === 'free'
        || row.membership === 'plus'
        || row.membership === 'pro'
        ? row.membership
        : null;

    const membership = buildMembershipInfo({
        membership: membershipType,
        membership_expires_at: typeof row.membership_expires_at === 'string' ? row.membership_expires_at : null,
        ai_chat_count: typeof row.ai_chat_count === 'number' ? row.ai_chat_count : null,
    });

    return {
        ...row,
        membership: membership.type,
        membership_expires_at: membership.expiresAt ? membership.expiresAt.toISOString() : null,
        ai_chat_count: membership.aiChatCount,
    };
}

async function loadSettings(auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>) {
    return getUserSettingsSnapshot(auth.db, auth.user.id);
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
        const profileResult = await loadProfileWithRecovery(auth);
        if (profileResult.error) {
            return jsonError('获取用户资料失败', 500);
        }

        return jsonOk({
            profile: normalizeProfileRow(profileResult.row),
            settings: null,
            linuxdo: await loadLinuxDoBinding(auth),
        });
    }

    const [profileResult, settingsResult, linuxdo] = await Promise.all([
        loadProfileWithRecovery(auth),
        loadSettings(auth),
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
        (async () => {
            try {
                const row = await auth.db.tx((trx) => trx
                    .updateTable('users')
                    .set(updatePayload as never)
                    .where('id', '=', auth.user.id)
                    .returning(PROFILE_COLUMNS)
                    .executeTakeFirst());
                return { row: (row ?? null) as Record<string, unknown> | null, error: null };
            } catch (error) {
                console.error('更新用户资料失败:', error);
                return { row: null, error: { message: '更新用户资料失败' } };
            }
        })(),
        loadSettings(auth),
    ]);

    if (updateResult.error || settingsResult.error) {
        return jsonError('更新用户资料失败', 500);
    }

    return jsonOk({
        profile: normalizeProfileRow(updateResult.row),
        settings: settingsResult.settings,
    });
}
