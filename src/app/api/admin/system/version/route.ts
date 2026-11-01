/**
 * Version check API
 *
 * GET: current version and the latest GitHub release (cached ~6h)
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { getVersionInfo } from '@/lib/version.server';

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) {
    return jsonError(auth.error.message, auth.error.status);
  }

  try {
    return jsonOk(await getVersionInfo());
  } catch (error) {
    console.error('[admin][system][version][GET] failed:', error);
    return jsonError('获取版本信息失败', 500);
  }
}
