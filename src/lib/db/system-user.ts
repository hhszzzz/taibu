import 'server-only';
import { DbError } from './errors';

/**
 * P1–P4: the local stack seeds its administrator through GoTrue, so the id is
 * supplied by the stack. P5 replaces this with the fixed system-user constant.
 */
export function systemUserId(): string {
  const value = process.env.SYSTEM_USER_ID;
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DbError({ code: 'SYSTEM_USER_MISSING', message: '系统用户未配置' });
  }
  return value;
}
