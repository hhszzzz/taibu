import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
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

type RequestDbClient =
    | Awaited<ReturnType<typeof createRequestSupabaseClient>>
    | ReturnType<typeof createAuthedClient>;

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
    authedClientFactory?: typeof createAuthedClient;
    cookieStore?: WritableCookieStore | null;
};

export type RequestAuthError = SessionResolutionError;

export type AuthContextResult = {
    db: RequestDbClient;
    // `db` 是包装鉴权上下文的规范字段；`supabase` 仅保留给旧调用点过渡使用。
    supabase: RequestDbClient;
    accessToken: string | null;
    user: User | null;
    authError: RequestAuthError | null;
};

export function resolveRequestDbClient(
    auth: Partial<Pick<AuthContextResult, 'db' | 'supabase'>> | null | undefined,
): RequestDbClient | null {
    if (auth?.db && (typeof auth.db.from === 'function' || typeof auth.db.rpc === 'function')) {
        return auth.db;
    }
    if (auth?.supabase && (typeof auth.supabase.from === 'function' || typeof auth.supabase.rpc === 'function')) {
        return auth.supabase;
    }
    return null;
}

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
    const authedClientFactory = dependencies.authedClientFactory ?? createAuthedClient;
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
            db: authedClientFactory(session.access_token),
            supabase: authedClientFactory(session.access_token),
            accessToken: session.access_token,
            user: session.user ?? null,
            authError: null,
        };
    }

    const supabase = await createRequestSupabaseClient();
    if (resolverError) {
        return {
            db: supabase,
            supabase,
            accessToken,
            user: null,
            authError: resolverError,
        };
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error && !isCredentialAuthError(error)) {
            return {
                db: supabase,
                supabase,
                accessToken,
                user: null,
                authError: normalizeSessionResolutionError(error),
            };
        }
        return {
            db: supabase,
            supabase,
            accessToken,
            user: user ?? null,
            authError: null,
        };
    } catch (error) {
        return {
            db: supabase,
            supabase,
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

// 仅用于必须使用 Bearer Token 的接口
export async function requireBearerUser(
    request: NextRequest,
    dependencies: Pick<GetAuthContextDependencies, 'authResolverClient' | 'authedClientFactory'> = {},
): Promise<
    | { db: RequestDbClient; supabase: RequestDbClient; accessToken: string; user: User }
    | { error: { message: string; status: number } }
> {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) {
        return { error: { message: '请先登录', status: 401 } };
    }

    const authResolverClient = dependencies.authResolverClient ?? createAnonClient();

    const { session, error } = await resolveSessionFromTokens(authResolverClient, {
        accessToken: token,
        refreshToken: null,
    });

    if (!session?.user) {
        if (error) {
            return { error: { message: error.message, status: error.status } };
        }
        return { error: { message: '认证失败', status: 401 } };
    }

    const db = (dependencies.authedClientFactory ?? createAuthedClient)(session.access_token);
    return { db, supabase: db, accessToken: session.access_token, user: session.user };
}

export async function requireUserContext(
    request: NextRequest
): Promise<
    | { db: RequestDbClient; supabase: RequestDbClient; accessToken: string | null; user: User }
    | { error: { message: string; status: number } }
> {
    const { db, supabase, accessToken, user, authError } = await getAuthContext(request);
    if (authError) {
        return { error: { message: authError.message, status: authError.status } };
    }
    if (!user) {
        return { error: { message: '请先登录', status: 401 } };
    }
    return { db, supabase, accessToken, user };
}

/**
 * 检查用户是否为管理员
 */
async function checkIsAdmin(
    supabase: RequestDbClient,
    userId: string
): Promise<
    | { ok: true; isAdmin: boolean }
    | { ok: false; error: { message: string; status: number } }
> {
    const { data: userData, error } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('[api-utils] admin check failed:', error);
        return {
            ok: false,
            error: {
                message: '管理员权限校验失败，请稍后重试',
                status: 503,
            },
        };
    }

    return {
        ok: true,
        isAdmin: userData?.is_admin ?? false,
    };
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
    | { db: RequestDbClient; supabase: RequestDbClient; accessToken: string | null; user: User }
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
 * 创建带有用户 access token 的 Supabase 客户端
 * 用于需要 RLS 策略识别用户身份的场景
 */
export function createAuthedClient(accessToken: string) {
    return createClient(
        getSupabaseUrl(),
        getSupabaseAnonKey(),
        {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            }
        }
    );
}

/**
 * 从请求中获取 access token（优先 Bearer，其次 session）
 */
export async function getAccessToken(request: NextRequest): Promise<string | null> {
    const { accessToken } = await getAuthContext(request);
    return accessToken;
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
