/**
 * 请求级鉴权与数据库上下文。
 *
 * B6 之后 `db` 一律是受控的 Kysely 上下文（ScopedDb）；旧 supabase-js 客户端
 * 只保留给尚未迁移的认证/存储表层（P3/P5 删除）。
 */

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { Session, User } from '@supabase/supabase-js';
import { anonDb, userDb, type ScopedDb } from '@/lib/db/context.server';
import { getAuthAdminClient as getPrivilegedAuthClient, getSystemAdminClient as getPrivilegedSystemAdminClient } from '@/lib/supabase-server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase-env';
import {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    isCredentialAuthError,
    normalizeSessionResolutionError,
    resolveSessionFromTokens,
    type SessionResolutionError,
    writeSessionCookies,
} from '@/lib/auth-session';

type WritableCookieStore = {
    set: (name: string, value: string, options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'lax';
        path: string;
        maxAge: number;
    }) => unknown;
    delete: (name: string) => unknown;
};

type GetAuthContextDependencies = {
    authResolverClient?: ReturnType<typeof createAnonClient>;
    cookieStore?: WritableCookieStore | null;
};

export type RequestAuthError = SessionResolutionError;

export type AuthContextResult = {
    db: ScopedDb;
    // 过渡字段：GoTrue 会话 JWT。仅剩认证/存储表层（P3/P5 删除）继续消费。
    accessToken: string | null;
    user: User | null;
    authError: RequestAuthError | null;
};

export async function createRequestSupabaseClient() {
    let cookieValues: Array<{ name: string; value: string }> = [];
    let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
    try {
        cookieStore = await cookies();
        cookieValues = cookieStore.getAll();
    } catch {
        // 在测试环境中可能没有 Next.js request scope，此时降级为无 cookie 客户端
        cookieValues = [];
        cookieStore = null;
    }
    return createServerClient(
        getSupabaseUrl(),
        getSupabaseAnonKey(),
        {
            cookies: {
                getAll() {
                    return cookieValues;
                },
                setAll(cookiesToSet) {
                    if (!cookieStore) return;
                    try {
                        for (const { name, value, options } of cookiesToSet) {
                            cookieStore.set(name, value, options);
                        }
                    } catch {
                        // 在只读 cookies 上下文（如部分 Server Component）中忽略写入
                    }
                },
            },
        }
    );
}

// 统一从请求中解析用户身份，支持 Bearer 与 Cookie 会话
export async function getAuthContext(
    request: NextRequest,
    dependencies: GetAuthContextDependencies = {},
): Promise<AuthContextResult> {
    const bearer = request.headers.get('authorization');
    const accessToken = bearer?.replace(/Bearer\s+/i, '') || request.cookies.get(ACCESS_COOKIE)?.value || null;
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value || null;
    const authResolverClient = dependencies.authResolverClient ?? createAnonClient();
    const { session, refreshed, error: resolverError } = await resolveSessionFromTokens(authResolverClient, {
        accessToken,
        refreshToken,
    });

    if (session?.access_token) {
        if (refreshed) {
            const cookieStore = dependencies.cookieStore ?? await getWritableCookieStore();
            if (cookieStore) {
                writeSessionCookies(cookieStore, session);
            }
        }

        return {
            db: userDb(session.user!.id),
            accessToken: session.access_token,
            user: session.user ?? null,
            authError: null,
        };
    }

    if (resolverError) {
        return {
            db: anonDb(),
            accessToken,
            user: null,
            authError: resolverError,
        };
    }

    const supabase = await createRequestSupabaseClient();
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error && !isCredentialAuthError(error)) {
            return {
                db: anonDb(),
                accessToken,
                user: null,
                authError: normalizeSessionResolutionError(error),
            };
        }
        return {
            db: user ? userDb(user.id) : anonDb(),
            accessToken,
            user: user ?? null,
            authError: null,
        };
    } catch (error) {
        return {
            db: anonDb(),
            accessToken,
            user: null,
            authError: normalizeSessionResolutionError(error),
        };
    }
}

async function getWritableCookieStore(): Promise<WritableCookieStore | null> {
    try {
        return await cookies() as WritableCookieStore;
    } catch {
        return null;
    }
}

export async function requireUserContext(
    request: NextRequest
): Promise<
    | { db: ScopedDb; user: User }
    | { error: { message: string; status: number } }
> {
    const { db, user, authError } = await getAuthContext(request);
    if (authError) {
        return { error: { message: authError.message, status: authError.status } };
    }
    if (!user) {
        return { error: { message: '请先登录', status: 401 } };
    }
    return { db, user };
}

/**
 * 检查用户是否为管理员
 */
async function checkIsAdmin(
    db: ScopedDb,
    userId: string
): Promise<
    | { ok: true; isAdmin: boolean }
    | { ok: false; error: { message: string; status: number } }
> {
    try {
        const userData = await db.tx((trx) => trx
            .selectFrom('users')
            .select('is_admin')
            .where('id', '=', userId)
            .executeTakeFirst());
        return { ok: true, isAdmin: userData?.is_admin ?? false };
    } catch (error) {
        console.error('[api-utils] admin check failed:', error);
        return {
            ok: false,
            error: {
                message: '管理员权限校验失败，请稍后重试',
                status: 503,
            },
        };
    }
}

export async function requireAdminUser(
    request: NextRequest,
    dependencies: {
        userContext?: Awaited<ReturnType<typeof requireUserContext>>;
    } = {},
): Promise<{ user: User } | { error: { message: string; status: number } }> {
    const authResult = dependencies.userContext ?? await requireUserContext(request);
    const resolvedAuthResult = dependencies.userContext ?? authResult;
    if ('error' in resolvedAuthResult) return resolvedAuthResult;

    const adminCheck = await checkIsAdmin(resolvedAuthResult.db, resolvedAuthResult.user.id);
    if (!adminCheck.ok) {
        return { error: adminCheck.error };
    }
    if (!adminCheck.isAdmin) {
        return { error: { message: '无权限操作', status: 403 } };
    }

    return { user: resolvedAuthResult.user };
}

export async function requireAdminContext(
    request: NextRequest,
    dependencies: {
        userContext?: Awaited<ReturnType<typeof requireUserContext>>;
    } = {},
): Promise<
    | { db: ScopedDb; user: User }
    | { error: { message: string; status: number } }
> {
    const authResult = dependencies.userContext ?? await requireUserContext(request);
    const resolvedAuthResult = dependencies.userContext ?? authResult;
    if ('error' in resolvedAuthResult) return resolvedAuthResult;

    const adminCheck = await checkIsAdmin(resolvedAuthResult.db, resolvedAuthResult.user.id);
    if (!adminCheck.ok) {
        return { error: adminCheck.error };
    }
    if (!adminCheck.isAdmin) {
        return { error: { message: '无权限操作', status: 403 } };
    }

    return resolvedAuthResult;
}

export function getSystemAdminClient() {
    return getPrivilegedSystemAdminClient();
}

export function getAuthAdminClient() {
    return getPrivilegedAuthClient();
}

export function createAnonClient() {
    return createClient(
        getSupabaseUrl(),
        getSupabaseAnonKey(),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        }
    );
}

/**
 * Auth mutations need an SDK session, not only an Authorization header.
 * Accept only a server-verified session; storage is private to this request.
 */
export function createSessionClient(session: Session) {
    const storageKey = 'request-auth-session';
    const storage = new Map<string, string>([[storageKey, JSON.stringify(session)]]);
    return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: {
            storageKey,
            // Enable the explicit in-memory adapter, never browser or shared storage.
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
            },
        },
    });
}

/**
 * 过渡：文件上传仍走 Storage RLS，按会话 JWT 建立用户态客户端。
 * P3 文件存储替换 ObjectStore 后删除。
 */
export function createUserStorageClient(accessToken: string | null) {
    return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        global: { headers: { Authorization: `Bearer ${accessToken ?? ''}` } },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
}

export function jsonError<TExtra extends Record<string, unknown> = Record<string, never>>(
    message: string,
    status = 400,
    extra?: TExtra
) {
    const body = extra
        ? ({ success: false, error: message, ...extra } as { success: false; error: string } & TExtra)
        : ({ success: false, error: message } as { success: false; error: string } & TExtra);
    return NextResponse.json(body, { status });
}

export function jsonOk<TPayload>(payload: TPayload, status = 200, headers?: Record<string, string>) {
    return NextResponse.json(payload, { status, headers });
}

export const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
} as const;
