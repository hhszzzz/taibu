import 'server-only';
import type { NextRequest } from 'next/server';
import { jsonError, requireAdminUser } from '@/lib/api-utils';
import { CatalogError } from '@/lib/admin/ai-catalog.server';

/** Runs an admin catalog request: admin check, JSON body, and catalog errors shown as written. */
export async function catalogRoute(request: NextRequest, label: string, work: (body: unknown) => Promise<Response>, options: { body?: boolean } = {}) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    let body: unknown;
    if (options.body) {
        try { body = await request.json(); }
        catch { return jsonError('请求格式错误', 400); }
    }
    try {
        return await work(body);
    } catch (error) {
        if (error instanceof CatalogError) return jsonError(error.message, error.status);
        console.error(`[ai-catalog] ${label} failed:`, error instanceof Error ? error.message : error);
        return jsonError(`${label}失败`, 500);
    }
}
