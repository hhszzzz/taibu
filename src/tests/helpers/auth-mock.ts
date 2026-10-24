/** Shared authenticated/anonymous request context for route tests. */
import type { AuthContextResult } from '../../lib/api-utils';
import type { ScopedDb } from '../../lib/db/context.server';
import { createMockScopedDb } from './db-mock';

type MockAuthenticatedContext = AuthContextResult & {
    user: NonNullable<AuthContextResult['user']>;
};

export function createMockAuthContext(userId?: string, db?: ScopedDb): MockAuthenticatedContext;
export function createMockAuthContext(userId: null, db?: ScopedDb): AuthContextResult & { user: null };
export function createMockAuthContext(
    userId: string | null = 'user-1',
    db: ScopedDb = createMockScopedDb({ scope: userId === null ? { kind: 'anon' } : { kind: 'user', userId } }),
): AuthContextResult {
    return {
        db,
        authError: null,
        user: userId === null ? null : {
            id: userId,
            email: `${userId}@example.test`,
            emailVerified: true,
            name: '测试用户',
            image: null,
        },
    };
}
