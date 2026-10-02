import { DATA_SOURCE_LOADERS, DATA_SOURCE_TYPES } from '@/lib/data-sources/manifest';
import type { DataSourceSummary, DataSourceType } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

export async function getProvider(type: DataSourceType): Promise<DataSourceProvider> {
    const loader = DATA_SOURCE_LOADERS[type];
    if (!loader) throw new Error(`Unknown data source type: ${type}`);
    return await loader();
}

export async function getUserDataSources(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
    const { items } = await getUserDataSourcesWithErrors(userId, ctx);
    return items;
}

export type UserDataSourcesResult = {
    items: DataSourceSummary[];
    errors: Array<{ type: DataSourceType; message: string }>;
};

export async function getUserDataSourcesWithErrors(
    userId: string,
    ctx?: DataSourceQueryContext,
    types: readonly DataSourceType[] = DATA_SOURCE_TYPES
): Promise<UserDataSourcesResult> {
    const errors: Array<{ type: DataSourceType; message: string }> = [];
    const loaded = await Promise.all(types.map(async (type) => await getProvider(type)));

    const settled = await Promise.allSettled(loaded.map(async (provider) => {
        return await provider.list(userId, ctx);
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

export async function resolveDataSources(
    refs: Array<{ type: DataSourceType; id: string }>,
    userId: string,
    ctx?: DataSourceQueryContext
): Promise<Array<{ type: DataSourceType; id: string; content: string }>> {
    return Promise.all(refs.map(async ({ type, id }) => {
        const provider = await getProvider(type);
        const data = await provider.get(id, userId, ctx);
        return { type, id, content: data ? await provider.formatForAI(data, ctx) : '' };
    }));
}
