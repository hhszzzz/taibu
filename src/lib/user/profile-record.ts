import type { User } from '@supabase/supabase-js';
import type { ScopedDb } from '@/lib/db/context.server';

type UserRecordSeedInput = Pick<User, 'id' | 'user_metadata'>;

export function buildUserRecordSeed(user: UserRecordSeedInput) {
  return {
    id: user.id,
    nickname: typeof user.user_metadata?.nickname === 'string' && user.user_metadata.nickname.trim().length > 0
      ? user.user_metadata.nickname.trim()
      : '命理爱好者',
    avatar_url: typeof user.user_metadata?.avatar_url === 'string'
      ? user.user_metadata.avatar_url
      : null,
    membership: 'free' as const,
    ai_chat_count: 1,
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
