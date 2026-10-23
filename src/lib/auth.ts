/**
 * 浏览器侧统一认证入口（Better Auth）。
 *
 * 业务语义（资料、错误文案、事件缓存）集中在这里；组件只依赖本模块导出的
 * `authClient` 与同名 helper，不再直接接触底层会话实现。
 */

import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import {
    type BrowserApiError,
    requestBrowserJson,
} from '@/lib/browser-api';
import {
    updateAvatarUrl as updateAvatarProfile,
    updateNickname as updateNicknameProfile,
} from '@/lib/user/profile';

export type AuthUser = {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    image: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};

/** 兼容旧组件的类型别名。 */
export type User = AuthUser;

/** Better Auth 的 session 记录本身不含用户对象；用户与 session 是同级的两份数据。 */
export type AuthSession = {
    id: string;
    userId: string;
    token?: string;
    expiresAt: Date | string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};

export type Session = AuthSession;

export type AuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'TOKEN_REFRESHED';

export type AuthResult = {
    success: boolean;
    error?: BrowserApiError;
};

export type LoginAttemptStatus = {
    blocked: boolean;
    remainingAttempts: number;
    error: BrowserApiError | null;
};

type SessionPayload = {
    data: { session: Session | null; user: AuthUser | null };
    error: BrowserApiError | null;
};

type AuthListener = (event: AuthChangeEvent, state: { session: Session | null; user: AuthUser | null }) => void;

type OtpType = 'signup' | 'magiclink' | 'recovery' | 'email_change' | 'email';

const configuredAuthClient = createAuthClient({
    basePath: '/api/auth',
    plugins: [emailOTPClient()],
});

type AuthClient = typeof configuredAuthClient;

let authClientImplementation: AuthClient = configuredAuthClient;

/** Test seam: swaps the transport and returns the previous one for restoration. */
export function __setAuthClientForTests(next: AuthClient): AuthClient {
    const previous = authClientImplementation;
    authClientImplementation = next;
    return previous;
}

export const authClient: AuthClient = new Proxy({} as AuthClient, {
    get: (_target, property) => Reflect.get(authClientImplementation, property),
});

const authListeners = new Set<AuthListener>();
let cachedSession: Session | null = null;
let cachedUser: AuthUser | null = null;
let hasInitializedSession = false;
let sessionBootstrapPromise: Promise<SessionPayload> | null = null;
let lastSessionBootstrapAt = 0;

const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_REVALIDATE_EVENT_COOLDOWN_MS = 5_000;
const LOGIN_GUARD_UNAVAILABLE_CODE = 'login_guard_unavailable';
const LOGIN_GUARD_UNAVAILABLE_MESSAGE = '登录保护服务暂不可用，请稍后重试';

function emitAuthEvent(event: AuthChangeEvent, state: { session: Session | null; user: AuthUser | null }) {
    for (const listener of authListeners) {
        try {
            listener(event, state);
        } catch (error) {
            console.error('[auth] auth listener error:', error);
        }
    }
}

function applySession(session: Session | null, user: AuthUser | null, event?: AuthChangeEvent) {
    cachedSession = session;
    cachedUser = user;
    hasInitializedSession = true;
    lastSessionBootstrapAt = Date.now();
    if (event) emitAuthEvent(event, { session, user });
}

/** Better Auth errors carry a code; keep the historical message mapping. */
function normalizeAuthError(error: { message?: string; code?: string; status?: number } | null | undefined): BrowserApiError | null {
    if (!error) return null;
    const raw = error.code || error.message || 'UNKNOWN';
    return {
        message: getErrorMessage(raw),
        code: raw,
    };
}

function getCachedSessionPayload(error: BrowserApiError | null = null): SessionPayload {
    return {
        data: {
            session: cachedSession,
            user: cachedUser,
        },
        error,
    };
}

function hasFreshSessionCache() {
    return hasInitializedSession && (Date.now() - lastSessionBootstrapAt) < SESSION_CACHE_TTL_MS;
}

function resolveRefreshedSessionEvent(previousSession: Session | null, nextSession: Session | null): AuthChangeEvent | null {
    if (!previousSession && !nextSession) return null;
    if (!previousSession && nextSession) return 'SIGNED_IN';
    if (previousSession && !nextSession) return 'SIGNED_OUT';
    if (!previousSession || !nextSession) return null;
    const changed = previousSession.id !== nextSession.id
        || previousSession.expiresAt !== nextSession.expiresAt
        || previousSession.userId !== nextSession.userId;
    return changed ? 'TOKEN_REFRESHED' : null;
}

async function loadSessionFromServer(options: { force?: boolean; emitEvent?: boolean } = {}): Promise<SessionPayload> {
    if (!options.force && hasFreshSessionCache()) return getCachedSessionPayload();
    if (sessionBootstrapPromise) return await sessionBootstrapPromise;

    const previousSession = cachedSession;
    sessionBootstrapPromise = authClient.getSession().then((result) => {
        if (result.error) {
            return getCachedSessionPayload(normalizeAuthError(result.error));
        }
        // Better Auth 返回 { session, user } 平级结构，这里保持原样缓存，不做嵌套归一。
        const session = (result.data?.session ?? null) as Session | null;
        const user = (result.data?.user ?? null) as AuthUser | null;
        cachedSession = session;
        cachedUser = user;
        hasInitializedSession = true;
        lastSessionBootstrapAt = Date.now();
        if (options.emitEvent) {
            const event = resolveRefreshedSessionEvent(previousSession, session);
            if (event) emitAuthEvent(event, { session, user });
        }
        return getCachedSessionPayload();
    }).finally(() => {
        sessionBootstrapPromise = null;
    });
    return await sessionBootstrapPromise;
}

export function invalidateBrowserSessionCache() {
    hasInitializedSession = false;
}

export async function revalidateBrowserSession(): Promise<SessionPayload> {
    invalidateBrowserSessionCache();
    return await loadSessionFromServer({ force: true, emitEvent: true });
}

export function onAuthStateChange(callback: AuthListener) {
    authListeners.add(callback);
    const bootstrap = hasInitializedSession
        ? Promise.resolve(getCachedSessionPayload())
        : (sessionBootstrapPromise ?? loadSessionFromServer());
    void bootstrap.then((result) => {
        callback('INITIAL_SESSION', { session: result.data?.session ?? null, user: result.data?.user ?? null });
    });
    return {
        data: {
            subscription: {
                unsubscribe() {
                    authListeners.delete(callback);
                },
            },
        },
    };
}

/** Snapshot for legacy call sites that read `{ data: { session } }`. */
export async function getSessionSnapshot(): Promise<SessionPayload> {
    return await loadSessionFromServer();
}

export async function getUserSnapshot(): Promise<{ data: { user: AuthUser | null }; error: BrowserApiError | null }> {
    const result = await loadSessionFromServer();
    return { data: { user: result.data.user }, error: result.error };
}

export async function getSession(): Promise<Session | null> {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || '获取会话失败');
    return (result.data?.session ?? null) as Session | null;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || '获取会话失败');
    return (result.data?.user ?? null) as AuthUser | null;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
        return { success: false, error: normalizeAuthError(error) ?? undefined };
    }
    invalidateBrowserSessionCache();
    await loadSessionFromServer({ force: true, emitEvent: true });
    return { success: true };
}

/** 失败次数已由服务端 Redis 锁定；保留入口以兼容旧调用方。 */
export async function signInWithEmailProtected(email: string, password: string): Promise<AuthResult> {
    return signInWithEmail(email, password);
}

export async function signUpWithEmail(email: string, password: string, nickname?: string): Promise<AuthResult> {
    const { error } = await authClient.signUp.email({
        email,
        password,
        name: nickname?.trim() || '命理爱好者',
    });
    if (error) {
        return { success: false, error: normalizeAuthError(error) ?? undefined };
    }
    invalidateBrowserSessionCache();
    return { success: true };
}

export async function signOut(): Promise<AuthResult> {
    const { error } = await authClient.signOut();
    if (error) {
        return { success: false, error: { message: '登出失败，请重试', code: error.code || error.message } };
    }
    applySession(null, null, 'SIGNED_OUT');
    return { success: true };
}

export async function ensureUserRecord(user: AuthUser) {
    void user;
    const result = await requestBrowserJson<{ success: boolean }>('/api/user/profile', {
        method: 'POST',
        body: JSON.stringify({ action: 'ensure' }),
    });
    if (result.error) {
        console.error('[auth] failed to ensure user profile:', result.error.message);
    }
}

export async function updateNickname(_userId: string, nickname: string): Promise<AuthResult> {
    const result = await updateNicknameProfile(nickname);
    if (!result.success) {
        return {
            success: false,
            error: { message: '更新失败，请重试', code: result.error?.code || result.error?.message },
        };
    }
    if (cachedUser) {
        cachedUser = { ...cachedUser, name: nickname };
        emitAuthEvent('USER_UPDATED', { session: cachedSession, user: cachedUser });
    }
    return { success: true };
}

export async function updateAvatarUrl(avatarUrl: string | null): Promise<AuthResult> {
    const result = await updateAvatarProfile(avatarUrl);
    if (!result.success) {
        return {
            success: false,
            error: { message: '更新头像失败，请重试', code: result.error?.code || result.error?.message },
        };
    }
    if (cachedUser) {
        cachedUser = { ...cachedUser, image: avatarUrl };
        emitAuthEvent('USER_UPDATED', { session: cachedSession, user: cachedUser });
    }
    return { success: true };
}

export async function resetPassword(email: string): Promise<AuthResult> {
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'forget-password' });
    if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
    return { success: true };
}

export async function sendOTP(
    email: string,
    type: 'signup' | 'magiclink' | 'recovery' | 'email_change' = 'signup',
    newEmail?: string
): Promise<AuthResult> {
    try {
        if (type === 'signup') {
            const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
            if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        } else if (type === 'magiclink') {
            const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
            if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        } else if (type === 'recovery') {
            return await resetPassword(email);
        } else if (type === 'email_change') {
            if (!newEmail) {
                return { success: false, error: { message: '请提供新邮箱地址', code: 'MISSING_NEW_EMAIL' } };
            }
            const { error } = await authClient.emailOtp.requestEmailChange({ newEmail });
            if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        }
        return { success: true };
    } catch (err) {
        console.error('[auth] sendOTP failed:', err);
        return { success: false, error: { message: '发送失败，请重试', code: 'SEND_FAILED' } };
    }
}

export async function verifyOTP(
    email: string,
    token: string,
    type: OtpType = 'email'
): Promise<AuthResult> {
    if (type === 'magiclink' || type === 'email') {
        const { error } = await authClient.signIn.emailOtp({ email, otp: token });
        if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        invalidateBrowserSessionCache();
        await loadSessionFromServer({ force: true, emitEvent: true });
        return { success: true };
    }
    if (type === 'signup') {
        const { error } = await authClient.emailOtp.verifyEmail({ email, otp: token });
        if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        return { success: true };
    }
    if (type === 'recovery') {
        const { error } = await authClient.emailOtp.checkVerificationOtp({
            email,
            otp: token,
            type: 'forget-password',
        });
        if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
        return { success: true };
    }
    // email_change codes are consumed by the change-email endpoint.
    return { success: true };
}

export async function resetPasswordWithOTP(
    email: string,
    token: string,
    newPassword: string
): Promise<AuthResult> {
    const { error } = await authClient.emailOtp.resetPassword({ email, otp: token, password: newPassword });
    if (error) return { success: false, error: normalizeAuthError(error) ?? undefined };
    return { success: true };
}

export async function checkLoginAttempts(_email: string): Promise<LoginAttemptStatus> {
    return { blocked: false, remainingAttempts: 5, error: null };
}

export async function recordLoginAttempt(_email: string, _success: boolean): Promise<void> {
    // Server-side lock (src/lib/identity/login-guard.server.ts) owns the counter.
}

export const authSessionCacheConstants = {
    SESSION_CACHE_TTL_MS,
    SESSION_REVALIDATE_EVENT_COOLDOWN_MS,
    LOGIN_GUARD_UNAVAILABLE_CODE,
    LOGIN_GUARD_UNAVAILABLE_MESSAGE,
};

function getErrorMessage(code: string): string {
    const errorMessages: Record<string, string> = {
        INVALID_EMAIL_OR_PASSWORD: '邮箱或密码错误',
        EMAIL_NOT_VERIFIED: '请先验证邮箱',
        USER_ALREADY_EXISTS: '该邮箱已注册',
        INVALID_EMAIL: '邮箱格式不正确',
        PASSWORD_TOO_SHORT: '密码至少8个字符',
        PASSWORD_TOO_LONG: '密码过长',
        INVALID_OTP: '验证码已过期或无效',
        OTP_EXPIRED: '验证码已过期或无效',
        TOO_MANY_ATTEMPTS: '请求过于频繁，请稍后再试',
        TOO_MANY_REQUESTS: '请求过于频繁，请稍后再试',
        SIGNUP_DISABLED: '该邮箱尚未注册，请先注册',
        'Invalid login credentials': '邮箱或密码错误',
        'Email not confirmed': '请先验证邮箱',
        'User already registered': '该邮箱已注册',
        'Invalid email or password': '邮箱或密码错误',
    };
    return errorMessages[code] || code;
}
