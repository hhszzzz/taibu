import type { ScopedDb } from '@/lib/db/context.server';

/** Minimal identity shape available after the Better Auth migration. */
export type UserRecordSeedInput = {
  id: string;
  name?: string | null;
  image?: string | null;
};

export function buildUserRecordSeed(user: UserRecordSeedInput) {
  const nickname = typeof user.name === 'string' ? user.name.trim() : '';
  return {
    id: user.id,
    nickname: nickname || '命理爱好者',
    avatar_url: typeof user.image === 'string' && user.image ? user.image : null,
  };
}

export async function ensureUserRecordRow(
  db: ScopedDb,
  user: UserRecordSeedInput,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const seed = buildUserRecordSeed(user);
    await db.tx((trx) => trx
      .insertInto('users')
      .values(seed)
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute());
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
