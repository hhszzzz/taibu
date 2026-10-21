
import { NextRequest } from 'next/server';
import { getUserDataSourcesWithErrors } from '@/lib/data-sources';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { createMemoryCache } from '@/lib/cache/memory';
import { getFeatureToggles } from '@/lib/app-settings';
import { getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';

const CACHE_TTL_MS = 15_000;
const cache = createMemoryCache<{ status: number; payload: unknown }>(CACHE_TTL_MS);

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }
    const { user } = auth;

    try {
        const url = new URL(request.url);
        const limit = (() => {
            const raw = url.searchParams.get('limit');
            const n = raw ? Number(raw) : 50;
            if (!Number.isFinite(n)) return 50;
            return Math.max(1, Math.min(200, Math.floor(n)));
        })();
        const fresh = url.searchParams.get('fresh') === '1';

        const toggles = await getFeatureToggles();
        const enabledTypes = getEnabledDataSourceTypes((featureId) => toggles[featureId] !== true);
        const cacheKey = `${user.id}:${limit}:${enabledTypes.join(',')}`;
        const cached = cache.get(cacheKey);
        if (!fresh && cached) {
            return jsonOk(cached.payload as Record<string, unknown>, cached.status);
        }

        const result = await getUserDataSourcesWithErrors(user.id, { db: auth.scoped, limit }, enabledTypes);
        const status = result.errors.length ? 206 : 200;
        cache.set(cacheKey, { status, payload: result });
        return jsonOk(result as unknown as Record<string, unknown>, status);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return jsonError('加载数据源失败', 500, { message });
    }
}
