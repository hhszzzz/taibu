import 'server-only';
import { sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/schema';
import { rootDb } from './pool.server';
import { DbError, toDbError } from './errors';
import { executeRpc } from './rpc';
import { systemUserId } from './system-user';
import type { RpcArgs, RpcName, RpcResult } from './generated/rpc';

export type DbScope =
  | { kind: 'user'; userId: string }
  | { kind: 'anon' }
  | { kind: 'system' };

export type TxOptions = { timeoutMs?: number; isolationLevel?: 'read committed' | 'repeatable read' | 'serializable' };

export interface ScopedDb {
  readonly scope: DbScope;
  tx<T>(work: (trx: Transaction<DB>) => Promise<T>, options?: TxOptions): Promise<T>;
  rpc<N extends RpcName>(name: N, args: RpcArgs<N>, options?: TxOptions): Promise<RpcResult<N>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roleAndClaims(scope: DbScope): { role: string; claims: Record<string, string> } {
  if (scope.kind === 'anon') return { role: 'anon', claims: { role: 'anon' } };
  if (scope.kind === 'system') {
    return {
      role: 'authenticated',
      claims: { sub: systemUserId(), role: 'authenticated', aud: 'authenticated' },
    };
  }
  if (!UUID.test(scope.userId)) throw new Error('[db] 用户上下文无效');
  return {
    role: 'authenticated',
    claims: { sub: scope.userId, role: 'authenticated', aud: 'authenticated' },
  };
}

/**
 * One round trip, inside the transaction, sets the two GUCs the existing RLS
 * policies read. `set_config(..., true)` is transaction-local, so a pooled
 * connection can never leak another request's identity.
 *
 * Module-private: the exported constructors below are the only way to pick a
 * scope, which keeps the system identity behind the guarded `systemDb()`.
 */
function createScopedDb(scope: DbScope): ScopedDb {
  const tx = async <T>(work: (trx: Transaction<DB>) => Promise<T>, options: TxOptions = {}): Promise<T> => {
    const { role, claims } = roleAndClaims(scope);
    const timeout = `${options.timeoutMs ?? 15_000}ms`;
    const callback: { error?: unknown; threw: boolean } = { threw: false };
    try {
      return await rootDb().transaction().setIsolationLevel(options.isolationLevel ?? 'read committed').execute(async (trx) => {
        await sql`select set_config('role', ${role}, true),
                         set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
                         set_config('statement_timeout', ${timeout}, true)`.execute(trx);
        try {
          return await work(trx);
        } catch (error) {
          callback.error = error;
          callback.threw = true;
          throw error;
        }
      });
    } catch (error) {
      // The callback's own errors still roll the transaction back but keep
      // their class; database failures are normalised into DbError.
      const own = callback.threw && callback.error === error;
      if (own && !(error instanceof pg.DatabaseError) && !(error instanceof DbError)) throw error;
      throw toDbError(error);
    }
  };

  return {
    scope,
    tx,
    rpc: (name, args, options) => tx((trx) => executeRpc(trx, name, args), options),
  };
}

export function userDb(userId: string): ScopedDb {
  return createScopedDb({ kind: 'user', userId });
}

export function anonDb(): ScopedDb {
  return createScopedDb({ kind: 'anon' });
}

/** Only whitelisted server paths may use the system identity (guarded). */
export function systemDb(): ScopedDb {
  return createScopedDb({ kind: 'system' });
}

/** Readiness probe; bounded so a saturated pool cannot stall the health route. */
export async function pingDatabase(timeoutMs = 2000): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Database ping timeout')), timeoutMs);
      sql`select 1`.execute(rootDb()).then(() => resolve(), reject).finally(() => clearTimeout(timer));
    });
    return true;
  } catch {
    return false;
  }
}
