/**
 * 浏览器侧统一认证入口
 *
 * - 对外只暴露一个模块，避免 auth/auth-client 双入口
 * - 仅保留 auth/storage 能力，不再暴露通用表查询与 RPC
 * - 业务语义（资料、登录保护、错误文案）也统一放在这里
 */

import type { AuthChangeEvent, Session, User as SupabaseUser } from '@supabase/supabase-js';
import {
    type BrowserApiError,
    type BrowserApiPayload,
    normalizeBrowserApiError as normalizeError,
    requestBrowserJson,
} from '@/lib/browser-api';
import {
    updateAvatarUrl as updateAvatarProfile,
    updateNickname as updateNicknameProfile,
} from '@/lib/user/profile';

export type { AuthChangeEvent, Session, User as SupabaseUser } from '@supabase/supabase-js';
export type User = SupabaseUser;

type AuthPayload<T = unknown> = BrowserApiPayload<T>;
type SessionPayload = AuthPayload<{ session: Session | null; user: SupabaseUser | null }>;
type SessionLoadOptions = {
    force?: boolean;
    emitEvent?: boolean;
};

export type AuthResult = {
    success: boolean;
    error?: BrowserApiError;
};

export type LoginAttemptStatus = {
    blocked: boolean;
    remainingAttempts: number;
    error: BrowserApiError | null;
};

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

type OtpType = 'signup' | 'magiclink' | 'recovery' | 'email_change' | 'email';

const authListeners = new Set<AuthListener>();
let cachedSession: Session | null = null;
let cachedUser: SupabaseUser | null = null;
let hasInitializedSession = false;
let sessionBootstrapPromise: Promise<SessionPayload> | null = null;
let lastSessionBootstrapAt = 0;

const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_REVALIDATE_EVENT_COOLDOWN_MS = 5_000;
const LOGIN_GUARD_UNAVAILABLE_CODE = 'login_guard_unavailable';
const LOGIN_GUARD_UNAVAILABLE_MESSAGE = '登录保护服务暂不可用，请稍后重试';

function emitAuthEvent(event: AuthChangeEvent, session: Session | null) {
    for (const listener of authListeners) {
        try {
            listener(event, session);
        } catch (error) {
            console.error('[auth] auth listener error:', error);
        }
    }
}

function applySession(session: Session | null, event?: AuthChangeEvent) {
    cachedSession = session;
    cachedUser = session?.user ?? null;
    hasInitializedSession = true;
    lastSessionBootstrapAt = Date.now();
    if (event) {
        emitAuthEvent(event, session);
    }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<AuthPayload<T>> {
    return requestBrowserJson<T>(url, init);
}

async function postAuthAction<T>(action: string, payload: Record<string, unknown> = {}): Promise<AuthPayload<T>> {
    return requestJson<T>('/api/auth', {
        method: 'POST',
        body: JSON.stringify({
            action,
            ...payload,
        }),
    });
}

function getCachedSessionPayload(error: BrowserApiError | null = null): SessionPayload {
    return {
        data: {
            session: cachedSession,
            user: cachedUser ?? cachedSession?.user ?? null,
        },
        error,
    };
}

function hasFreshSessionCache() {
    return hasInitializedSession && (Date.now() - lastSessionBootstrapAt) < SESSION_CACHE_TTL_MS;
}

function resolveRefreshedSessionEvent(previousSession: Session | null, nextSession: Session | null): AuthChangeEvent | null {
    if (!previousSession && !nextSession) {
        return null;
    }
    if (!previousSession && nextSession) {
        return 'SIGNED_IN';
    }
    if (previousSession && !nextSession) {
        return 'SIGNED_OUT';
    }
    if (!previousSession || !nextSession) {
        return null;
    }

    const hasChanged = previousSession.access_token !== nextSession.access_token
        || previousSession.refresh_token !== nextSession.refresh_token
        || previousSession.expires_at !== nextSession.expires_at
        || previousSession.user?.id !== nextSession.user?.id;

    return hasChanged ? 'TOKEN_REFRESHED' : null;
}

async function loadSessionFromServer(
    options: SessionLoadOptions = {},
): Promise<SessionPayload> {
    if (!options.force && hasFreshSessionCache()) {
        return getCachedSessionPayload();
    }

    if (sessionBootstrapPromise) {
        return await sessionBootstrapPromise;
    }

    const previousSession = cachedSession;
    sessionBootstrapPromise = requestJson<{ session: Session | null; user: SupabaseUser | null }>('/api/auth', {
        method: 'GET',
    }).then((result) => {
        if (result.error) {
            return getCachedSessionPayload(result.error);
        }

        const nextSession = result.data?.session ?? null;
        cachedSession = nextSession;
        cachedUser = result.data?.user ?? result.data?.session?.user ?? null;
        hasInitializedSession = true;
        lastSessionBootstrapAt = Date.now();

        if (options.emitEvent) {
            const event = resolveRefreshedSessionEvent(previousSession, nextSession);
            if (event) {
                emitAuthEvent(event, nextSession);
            }
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

export const supabase = {
    auth: {
        async signInWithPassword(credentials: { email: string; password: string }) {
            const result = await postAuthAction<{ session: Session | null; user: SupabaseUser | null }>('signInWithPassword', credentials);
            if (!result.error) {
                applySession(result.data?.session ?? null, 'SIGNED_IN');
            }
            return result;
        },

        async signUp(params: {
            email: string;
            password: string;
            options?: Record<string, unknown>;
        }) {
            const result = await postAuthAction<{ session: Session | null; user: SupabaseUser | null }>('signUp', params);
            if (!result.error && result.data?.session) {
                applySession(result.data.session, 'SIGNED_IN');
            }
            return result;
        },

        async signOut() {
            const result = await postAuthAction<{ signedOut: boolean }>('signOut');
            if (!result.error) {
                applySession(null, 'SIGNED_OUT');
            }
            return result;
        },

        async getSession(options?: { force?: boolean }): Promise<{ data: { session: Session | null }; error: BrowserApiError | null }> {
            const result = await loadSessionFromServer(options);
            return {
                data: { session: result.data?.session ?? null },
                error: result.error,
            };
        },

        async revalidateSession(): Promise<{ data: { session: Session | null }; error: BrowserApiError | null }> {
            const result = await revalidateBrowserSession();
            return {
                data: { session: result.data?.session ?? null },
                error: result.error,
            };
        },

        invalidateSessionCache() {
            invalidateBrowserSessionCache();
        },

        async getUser(
            token?: string,
            options?: { force?: boolean },
        ): Promise<{ data: { user: SupabaseUser | null }; error: BrowserApiError | null }> {
            if (token) {
                const result = await postAuthAction<{ user: SupabaseUser | null }>('getUser', { token });
                return { data: { user: result.data?.user ?? null }, error: result.error };
            }
            const sessionResult = await loadSessionFromServer(options);
            return { data: { user: sessionResult.data?.user ?? null }, error: sessionResult.error };
        },

        async updateUser(attributes: Record<string, unknown>) {
            const result = await postAuthAction<{ user: SupabaseUser | null }>('updateUser', { attributes });
            if (!result.error && cachedSession?.user) {
                applySession(
                    {
                        ...cachedSession,
                        user: result.data?.user || cachedSession.user,
                    },
                    'USER_UPDATED'
                );
            }
            return result;
        },

        async resetPasswordForEmail(email: string, options?: Record<string, unknown>) {
            return postAuthAction('resetPasswordForEmail', { email, options });
        },

        async signInWithOtp(params: Record<string, unknown>) {
            return postAuthAction('signInWithOtp', { params });
        },

        async verifyOtp(params: { email: string; token: string; type: OtpType }) {
            const result = await postAuthAction<{ session: Session | null; user: SupabaseUser | null }>('verifyOtp', { params });
            if (!result.error && result.data?.session) {
                applySession(result.data.session, 'SIGNED_IN');
            }
            return result;
        },

        onAuthStateChange(callback: AuthListener) {
            authListeners.add(callback);
            const bootstrap = hasInitializedSession
                ? Promise.resolve(getCachedSessionPayload())
                : (sessionBootstrapPromise ?? loadSessionFromServer());
            void bootstrap.then((res) => {
                callback('INITIAL_SESSION', res.data?.session ?? null);
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
        },
    },

    // Realtime channel 桩（auth-only 模式下不支持，保留接口兼容）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel(name: string): any {
        console.warn(`[auth] channel("${name}") is not supported in auth-only mode`);
        const noop = () => channelObj;
        const channelObj = { on: noop, subscribe: noop, unsubscribe: noop };
        return channelObj;
    },

    removeChannel(channel?: unknown) {
        void channel;
    },

    storage: {
        from(bucket: string) {
            // 伪造的 supabase-storage 门面：只服务头像，bucket/path 由服务端会话决定。
            void bucket;
            return {
                async upload(path: string, file: File | Blob, options?: { upsert?: boolean }) {
                    void path;
                    void options;
                    const formData = new FormData();
                    formData.append('file', file);
                    try {
                        const res = await fetch('/api/files/avatars', {
                            method: 'POST',
                            credentials: 'include',
                            body: formData,
                        });
                        const json = await res.json();
                        return { data: json.data ?? null, error: normalizeError(json.error) };
                    } catch (err) {
                        return { data: null, error: normalizeError(err) || { message: 'Upload failed' } };
                    }
                },
                getPublicUrl(path: string) {
                    return {
                        data: { publicUrl: `/api/files/avatars/${path}` },
                    };
                },
            };
        },
    },
};

export const authClient = supabase;

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        return {
            success: false,
            error: {
                message: getErrorMessage(error.message),
                code: error.code || error.message,
            },
        };
    }

    return { success: true };
}

export async function signUpWithEmail(
    email: string,
    password: string,
    nickname?: string
): Promise<AuthResult> {
    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                nickname: nickname || '命理爱好者',
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
    });

    if (error) {
        return {
            success: false,
            error: {
                message: getErrorMessage(error.message),
                code: error.code || error.message,
            },
        };
    }

    return { success: true };
}

export async function signOut(): Promise<AuthResult> {
    const { error } = await supabase.auth.signOut();

    if (error) {
        return {
            success: false,
            error: {
                message: '登出失败，请重试',
                code: error.code || error.message,
            },
        };
    }

    return { success: true };
}

export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
        throw new Error(error.message || '获取当前用户失败');
    }
    return user;
}

export async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        throw new Error(error.message || '获取会话失败');
    }
    return session;
}

export { getCurrentUserProfileBundle } from '@/lib/user/profile';

export async function ensureUserRecord(user: SupabaseUser) {
    void user;
    const result = await requestJson<{ success: boolean }>('/api/user/profile', {
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
            error: {
                message: '更新失败，请重试',
                code: result.error?.code || result.error?.message,
            },
        };
    }

    const { error: authError } = await supabase.auth.updateUser({
        data: { nickname },
    });

    if (authError) {
        console.warn('[auth] failed to sync auth nickname:', authError.message);
    }

    return { success: true };
}

export async function updateAvatarUrl(avatarUrl: string | null): Promise<AuthResult> {
    const result = await updateAvatarProfile(avatarUrl);

    if (!result.success) {
        return {
            success: false,
            error: {
                message: '更新头像失败，请重试',
                code: result.error?.code || result.error?.message,
            },
        };
    }

    const { error: authError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
    });

    if (authError) {
        console.warn('[auth] failed to sync auth avatar:', authError.message);
    }

    return { success: true };
}


export async function resetPassword(email: string): Promise<AuthResult> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) {
        return {
            success: false,
            error: {
                message: getErrorMessage(error.message),
                code: error.code || error.message,
            },
        };
    }

    return { success: true };
}

export async function sendOTP(
    email: string,
    type: 'signup' | 'magiclink' | 'recovery' | 'email_change' = 'signup',
    newEmail?: string
): Promise<AuthResult> {
    try {
        if (type === 'signup') {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: true,
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
            });

            if (error) {
                return {
                    success: false,
                    error: {
                        message: getErrorMessage(error.message),
                        code: error.code || error.message,
                    },
                };
            }
        } else if (type === 'magiclink') {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: false,
                },
            });

            if (error) {
                return {
                    success: false,
                    error: {
                        message: getErrorMessage(error.message),
                        code: error.code || error.message,
                    },
                };
            }
        } else if (type === 'recovery') {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/reset-password`,
            });

            if (error) {
                return {
                    success: false,
                    error: {
                        message: getErrorMessage(error.message),
                        code: error.code || error.message,
                    },
                };
            }
        } else if (type === 'email_change') {
            if (!newEmail) {
                return {
                    success: false,
                    error: {
                        message: '请提供新邮箱地址',
                        code: 'MISSING_NEW_EMAIL',
                    },
                };
            }

            const { error } = await supabase.auth.updateUser({
                email: newEmail,
            });

            if (error) {
                return {
                    success: false,
                    error: {
                        message: getErrorMessage(error.message),
                        code: error.code || error.message,
                    },
                };
            }
        }

        return { success: true };
    } catch (err) {
        console.error('[auth] sendOTP failed:', err);
        return {
            success: false,
            error: {
                message: '发送失败，请重试',
                code: 'SEND_FAILED',
            },
        };
    }
}

export async function verifyOTP(
    email: string,
    token: string,
    type: OtpType = 'email'
): Promise<AuthResult> {
    const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type,
    });

    if (error) {
        return {
            success: false,
            error: {
                message: getErrorMessage(error.message),
                code: error.code || error.message,
            },
        };
    }

    return { success: true };
}

export async function resetPasswordWithOTP(
    email: string,
    token: string,
    newPassword: string
): Promise<AuthResult> {
    const result = await postAuthAction<{ success: boolean }>('resetPasswordWithOtp', {
        email,
        token,
        newPassword,
    });

    if (result.error) {
        return {
            success: false,
            error: {
                message: getErrorMessage(result.error.message),
                code: result.error.code || result.error.message,
            },
        };
    }

    return { success: true };
}

export async function checkLoginAttempts(email: string): Promise<LoginAttemptStatus> {
    const maxAttempts = 5;
    const result = await postAuthAction<{ blocked: boolean; remainingAttempts: number }>('checkLoginAttempts', { email });

    if (result.error || !result.data) {
        console.error('[auth] failed to check login attempts:', result.error?.message);
        return {
            blocked: false,
            remainingAttempts: maxAttempts,
            error: {
                message: LOGIN_GUARD_UNAVAILABLE_MESSAGE,
                code: result.error?.code || LOGIN_GUARD_UNAVAILABLE_CODE,
            },
        };
    }

    return {
        ...result.data,
        error: null,
    };
}

export async function recordLoginAttempt(email: string, success: boolean): Promise<void> {
    const result = await postAuthAction<{ success: boolean }>('recordLoginAttempt', { email, success });

    if (result.error) {
        console.error('[auth] failed to record login attempt:', result.error.message);
    }
}

export async function signInWithEmailProtected(email: string, password: string): Promise<AuthResult> {
    const { blocked, remainingAttempts, error } = await checkLoginAttempts(email);

    if (error) {
        return {
            success: false,
            error,
        };
    }

    if (blocked) {
        return {
            success: false,
            error: {
                message: '登录失败次数过多，请15分钟后再试',
                code: 'too_many_attempts',
            },
        };
    }

    const result = await signInWithEmail(email, password);
    await recordLoginAttempt(email, result.success);

    if (!result.success && remainingAttempts <= 1) {
        return {
            success: false,
            error: {
                message: `邮箱或密码错误，剩余尝试次数：${remainingAttempts - 1}`,
                code: result.error?.code,
            },
        };
    }

    return result;
}

export const authSessionCacheConstants = {
    SESSION_CACHE_TTL_MS,
    SESSION_REVALIDATE_EVENT_COOLDOWN_MS,
    LOGIN_GUARD_UNAVAILABLE_CODE,
    LOGIN_GUARD_UNAVAILABLE_MESSAGE,
};

function getErrorMessage(code: string): string {
    const errorMessages: Record<string, string> = {
        'Invalid login credentials': '邮箱或密码错误',
        'Email not confirmed': '请先验证邮箱',
        'User already registered': '该邮箱已注册',
        'Password should be at least 6 characters': '密码至少6个字符',
        'Unable to validate email address: invalid format': '邮箱格式不正确',
        'Email rate limit exceeded': '请求过于频繁，请稍后再试',
        'Token has expired or is invalid': '验证码已过期或无效',
        'Signups not allowed for otp': '该邮箱尚未注册，请先注册',
    };

    return errorMessages[code] || code;
}
