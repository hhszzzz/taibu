import type { ScopedDb } from '../../lib/db/context.server';

export type ScopedDbMock = {
  /** Runs the callback against a caller-supplied Kysely double. */
  tx?: (work: (trx: never) => unknown) => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
};

const unexpected = async () => {
  throw new Error('unexpected scoped database access in this test');
};

/** Route doubles implement only the scoped methods each test exercises. */
export function createMockScopedDb(mock: ScopedDbMock = {}): ScopedDb {
  return {
    scope: { kind: 'user', userId: 'user-1' },
    tx: mock.tx ?? unexpected,
    rpc: mock.rpc ?? unexpected,
  } as unknown as ScopedDb;
}
