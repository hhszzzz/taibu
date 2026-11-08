import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { getFeatureToggles } from '@/lib/app-settings';
import { getEnabledDataSourceTypes, DATA_SOURCE_SHORT_LABELS } from '@/lib/data-sources/catalog';
import { getUserDataSourcesWithErrors } from '@/lib/data-sources';
import { createMemoryCache } from '@/lib/cache/memory';
import type { DataSourceType } from '@/lib/data-sources/types';

/** Saved readings of every art: history search by keyword and/or saved date. */
const SEARCHABLE_TYPES: ReadonlySet<DataSourceType> = new Set([
    'bazi_chart', 'ziwei_chart', 'tarot_reading', 'liuyao_divination', 'mbti_reading', 'hepan_chart',
    'face_reading', 'palm_reading', 'qimen_chart', 'daliuren_divination', 'meihua_divination', 'xiaoliuren_divination',
]);
const CACHE_TTL_MS = 10_000;
const cache = createMemoryCache<Awaited<ReturnType<typeof getUserDataSourcesWithErrors>>>(CACHE_TTL_MS);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function dateParam(value: string | null): string | null | undefined {
    if (!value) return undefined;
    if (!DATE.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const params = request.nextUrl.searchParams;
    const query = params.get('q')?.trim() ?? '';
    const since = dateParam(params.get('since'));
    const until = dateParam(params.get('until'));
    if (query.length > 200) return jsonError('搜索词须为 1–200 个字符', 400);
    if (since === null || until === null) return jsonError('日期须为 YYYY-MM-DD', 400);
    if (since && until && since > until) return jsonError('开始日期不能晚于结束日期', 400);
    // An empty box shows recent readings as recommendations; a typed query searches the summaries below.
    const toggles = await getFeatureToggles();
    const types = getEnabledDataSourceTypes((featureId) => toggles[featureId] !== true)
        .filter((type) => SEARCHABLE_TYPES.has(type));
    const cacheKey = `${auth.user.id}:${query}:${since ?? ''}:${until ?? ''}:${types.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return jsonOk(cached);
    try {
        // Search the summaries the lists show (hexagram, spread, question, type…), not just one text column:
        // recent rows per art are cheap and make every displayed name searchable, including records without text.
        const result = await getUserDataSourcesWithErrors(auth.user.id, {
            db: auth.db, limit: query ? 100 : 8, since: since ?? undefined, until: until ?? undefined,
        }, types);
        const needle = query.toLowerCase();
        const items = needle
            ? result.items.filter((item) => `${DATA_SOURCE_SHORT_LABELS[item.type]} ${item.name} ${item.preview}`.toLowerCase().includes(needle))
            : result.items;
        const payload = { items: items.slice(0, query ? 60 : 12), errors: result.errors };
        cache.set(cacheKey, payload);
        return jsonOk(payload);
    } catch (error) {
        return jsonError('搜索记录失败', 500, { message: error instanceof Error ? error.message : 'unknown error' });
    }
}
