import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';

/**
 * Who a settings request writes as: the system scope for the platform's items (owner null), the member's own scope
 * for theirs. Connectors, skills and roles share this admission, so the account-switch check cannot drift between them.
 */
export type SettingsOwner = { db: ScopedDb; owner: string | null; userId: string };

export async function administratorOwner(request: NextRequest): Promise<SettingsOwner | Response> {
  const auth = await requireAdminUser(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  return { db: systemDb(), owner: null, userId: auth.user.id };
}

export async function memberOwner(request: NextRequest): Promise<SettingsOwner | Response> {
  const auth = await requireUserContext(request);
  if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
  const expected = request.headers.get('X-Expected-User-Id');
  if (expected !== null && expected !== auth.user.id) return jsonError('账号已切换', 409);
  return { db: auth.db, owner: auth.user.id, userId: auth.user.id };
}

export const readSettingsBody = (request: NextRequest) => request.json().catch(() => null) as Promise<unknown>;
