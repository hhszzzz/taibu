/**
 * 请求级鉴权与数据库上下文。
 *
 * 身份来自 Better Auth 的会话（Cookie），数据访问一律是受控的 ScopedDb。
 * 上下文缺失时回退到 anon；需要登录的入口统一返回 401。
 */

import { NextResponse, type NextRequest } from 'next/server';
import { anonDb, userDb, type ScopedDb } from '@/lib/db/context.server';
import { getAuthState } from '@/lib/identity/auth.server';

export type AppUser = {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    image: string | null;
};

export type RequestAuthError = {
    message: string;
    status: number;
    code?: string;
};

export type AuthContextResult = {
    db: ScopedDb;
    user: AppUser | null;
    authError: RequestAuthError | null;
};

function toAppUser(user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    image?: string | null;
}): AppUser {
    return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image ?? null,
    };
}

/** Optional authentication: anonymous requests get the anon RLS scope. */
export async function getAuthContext(request: NextRequest): Promise<AuthContextResult> {
    try {
        const authState = await getAuthState(request.headers);
        if (!authState?.user) {
            return { db: anonDb(), user: null, authError: null };
        }
        const user = toAppUser(authState.user);
        return { db: userDb(user.id), user, authError: null };
    } catch (error) {
        console.error('[api-utils] session resolution failed:', error);
        return {
            db: anonDb(),
            user: null,
            authError: { message: '登录状态解析失败，请重新登录', status: 401, code: 'SESSION_RESOLUTION_FAILED' },
        };
    }
}

export async function requireUserContext(
    request: NextRequest
): Promise<
    | { db: ScopedDb; user: AppUser }
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
): Promise<{ user: AppUser } | { error: { message: string; status: number } }> {
    const resolvedAuthResult = dependencies.userContext ?? await requireUserContext(request);
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
    | { db: ScopedDb; user: AppUser }
    | { error: { message: string; status: number } }
> {
    const resolvedAuthResult = dependencies.userContext ?? await requireUserContext(request);
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

/** Room for multipart boundaries and part headers around the one uploaded file. */
const UPLOAD_ENVELOPE_BYTES = 2 * 1024 * 1024;

/** Counts actual streamed bytes and cancels the request as soon as the limit is exceeded. */
export async function readRequestBytes(request: Request, maxBytes: number): Promise<{ bytes: Buffer } | { error: { message: string; status: number } }> {
    const reader = request.body?.getReader();
    if (!reader) return { error: { message: '请求体为空', status: 400 } };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.length;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                return { error: { message: '请求体超过大小限制', status: 413 } };
            }
            chunks.push(next.value);
        }
    } catch {
        return { error: { message: '请求体读取失败', status: 400 } };
    } finally {
        reader.releaseLock();
    }
    return { bytes: Buffer.concat(chunks) };
}

/** Reads a multipart file while bounding both the payload and multipart envelope. */
export async function readUploadedFile(
    request: Request,
    maxBytes: number
): Promise<{ file: File } | { error: { message: string; status: number } }> {
    const tooLarge = { error: { message: `文件不能超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`, status: 413 } };
    const invalid = { error: { message: '文件请求无效', status: 400 } };
    if (!request.body) return { error: { message: '请选择文件', status: 400 } };
    const input = await readRequestBytes(request, maxBytes + UPLOAD_ENVELOPE_BYTES);
    if ('error' in input) return input.error.status === 413 ? tooLarge : invalid;
    let form: FormData;
    try {
        form = await new Response(new Uint8Array(input.bytes), {
            headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
        }).formData();
    } catch {
        return invalid;
    }
    const file = form.get('file');
    if (!(file instanceof File)) return { error: { message: '请选择文件', status: 400 } };
    if (!file.size) return { error: { message: '文件为空', status: 400 } };
    if (file.size > maxBytes) return tooLarge;
    return { file };
}
