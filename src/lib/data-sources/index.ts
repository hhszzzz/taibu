import { DATA_SOURCE_LOADERS, DATA_SOURCE_TYPES } from '@/lib/data-sources/manifest';
import type { DataSourceSummary, DataSourceType } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

export async function getProvider(type: DataSourceType): Promise<DataSourceProvider> {
    const loader = DATA_SOURCE_LOADERS[type];
    if (!loader) throw new Error(`Unknown data source type: ${type}`);
    return await loader();
}

export type UserDataSourcesResult = {
    items: DataSourceSummary[];
    errors: Array<{ type: DataSourceType; message: string }>;
};

/** Match the provider's displayed summaries before applying the requested result limit. */
async function listMatchingSummaries(
    provider: DataSourceProvider,
    userId: string,
    ctx: DataSourceQueryContext | undefined,
    matches: (item: DataSourceSummary) => boolean,
): Promise<DataSourceSummary[]> {
    const limit = ctx?.limit ?? 50;
    const pageSize = 100;
    const items: DataSourceSummary[] = [];
    let offset = ctx?.offset ?? 0;
    while (items.length < limit) {
        const page = await provider.list(userId, { ...ctx, limit: pageSize, offset });
        for (const item of page) {
            if (matches(item)) items.push(item);
            if (items.length === limit) break;
        }
        if (page.length < pageSize) break;
        offset += page.length;
    }
    return items;
}

export async function getUserDataSourcesWithErrors(
    userId: string,
    ctx?: DataSourceQueryContext,
    types: readonly DataSourceType[] = DATA_SOURCE_TYPES,
    matches?: (item: DataSourceSummary) => boolean,
): Promise<UserDataSourcesResult> {
    const errors: Array<{ type: DataSourceType; message: string }> = [];
    const loaded = await Promise.all(types.map(async (type) => await getProvider(type)));

    const settled = await Promise.allSettled(loaded.map(async (provider) => {
        return matches ? await listMatchingSummaries(provider, userId, ctx, matches) : await provider.list(userId, ctx);
    }));

    const lists: DataSourceSummary[][] = [];
    for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === 'fulfilled') {
            lists.push(result.value);
        } else {
            const message = result.reason instanceof Error ? result.reason.message : 'unknown error';
            errors.push({ type: loaded[i].type, message });
        }
    }

    const results = lists.flat();
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { items: results, errors };
}
