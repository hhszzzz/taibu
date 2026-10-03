/**
 * Shared Supabase mock factory for route tests.
 *
 * Reduces per-test mock boilerplate from ~30-50 lines to ~5-10 lines.
 * Supports chainable from().select().eq().single() patterns.
 */

import type { AuthContextResult } from '../../lib/api-utils';

type MockAuthenticatedContext = AuthContextResult & {
    user: NonNullable<AuthContextResult['user']>;
};

export function createMockAuthContext(client?: Record<string, unknown>, userId?: string): MockAuthenticatedContext;
export function createMockAuthContext(client: Record<string, unknown>, userId: null): AuthContextResult & { user: null };
export function createMockAuthContext(
    client: Record<string, unknown> = {},
    userId: string | null = 'user-1',
): AuthContextResult {
    // Route doubles implement only the SDK methods exercised by each test.
    const db = client as unknown as AuthContextResult['db'];
    return {
        db,
        supabase: db,
        accessToken: userId === null ? null : 'test-token',
        authError: null,
        user: userId === null ? null : {
            id: userId,
            aud: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00.000Z',
        },
    };
}

type TableConfig = {
    data?: unknown;
    error?: unknown;
    /** For tables that need insert capture */
    captureInsert?: (payload: unknown) => void;
    /** For tables that need update capture */
    captureUpdate?: (payload: unknown) => void;
};

export type MockSupabaseConfig = {
    tables?: Record<string, TableConfig>;
    auth?: { user?: { id: string }; error?: unknown };
    rpc?: Record<string, { data?: unknown; error?: unknown }>;
};

function createChainableQuery(config: TableConfig) {
    const data = config.data ?? null;
    const error = config.error ?? null;

    const terminal = {
        single: async () => ({ data, error }),
        maybeSingle: async () => ({ data, error }),
    };

    const eqChain: Record<string, unknown> = {
        eq: () => eqChain,
        single: terminal.single,
        maybeSingle: terminal.maybeSingle,
    };

    return {
        select: () => ({
            eq: () => eqChain,
            single: terminal.single,
            maybeSingle: terminal.maybeSingle,
        }),
        insert: (payload: unknown) => {
            config.captureInsert?.(payload);
            return {
                error,
                select: () => ({
                    single: async () => ({ data, error }),
                }),
            };
        },
        update: (payload: unknown) => {
            config.captureUpdate?.(payload);
            return {
                eq: () => ({
                    eq: async () => ({ error }),
                }),
            };
        },
    };
}

export function createMockSupabaseClient(config: MockSupabaseConfig = {}) {
    return {
        from: (table: string) => {
            const tableConfig = config.tables?.[table];
            if (tableConfig) {
                return createChainableQuery(tableConfig);
            }
            // Default: return a no-op chain
            return createChainableQuery({ data: null, error: null });
        },
        rpc: async (fn: string) => {
            const rpcConfig = config.rpc?.[fn];
            return {
                data: rpcConfig?.data ?? null,
                error: rpcConfig?.error ?? null,
            };
        },
        auth: {
            getUser: async () => ({
                data: config.auth?.user ? { user: config.auth.user } : { user: null },
                error: config.auth?.error ?? null,
            }),
        },
    };
}

/** Default user table config for a free user with credits */
export const FREE_USER_TABLE = {
    data: { ai_chat_count: 10, membership: 'free', membership_expires_at: null },
};

/** Default user table config for a pro user with credits */
export const PRO_USER_TABLE = {
    data: { ai_chat_count: 10, membership: 'pro', membership_expires_at: null },
};
