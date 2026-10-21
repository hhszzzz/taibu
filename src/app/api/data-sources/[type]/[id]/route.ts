
import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/data-sources';
import type { DataSourceType } from '@/lib/data-sources/types';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { getDataSourceFeatureId } from '@/lib/data-sources/catalog';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ type: string; id: string }> }
) {
    const auth = await requireUserContext(_request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }
    const { user } = auth;
    const { type, id } = await params;
    const featureError = await ensureFeatureRouteEnabled(getDataSourceFeatureId(type as DataSourceType));
    if (featureError) return featureError;

    try {
        const provider = await getProvider(type as DataSourceType);
        const data = await provider.get(id, user.id, { db: auth.scoped });
        if (!data) return jsonError('数据不存在', 404);
        return jsonOk({
            type: provider.type,
            id,
            displayName: provider.displayName,
            summary: provider.summarize(data),
            content: await provider.formatForAI(data),
            raw: data
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return jsonError('获取数据源失败', 400, { message });
    }
}
