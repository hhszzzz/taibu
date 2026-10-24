import 'server-only';

/**
 * The system principal owns scheduled work and administrative reads.
 * Seeded by database/seed.sql;
 * it has no account row, so it can never sign in.
 */
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';

export function systemUserId(): string {
  return SYSTEM_USER_ID;
}
