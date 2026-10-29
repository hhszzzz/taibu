import 'server-only';

/**
 * models.dev 目录的服务端读取：整份 api.json 在内存里缓存一段时间，供管理端模型编辑器
 * 按模型 ID 查询公开的上下文窗口、输出上限与能力。目录不可用不影响手填。
 */
import { CatalogError } from '@/lib/admin/ai-catalog.server';
import {
    flattenModelsDevCatalog,
    matchModelsDevModels,
    type ModelsDevCatalog,
    type ModelsDevSuggestion,
} from '@/lib/admin/models-dev';

const DEFAULT_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

let cache: { expires: number; models: ModelsDevSuggestion[] } | null = null;
let pending: Promise<ModelsDevSuggestion[]> | null = null;

async function download(): Promise<ModelsDevSuggestion[]> {
    const url = process.env.MODELS_DEV_API_URL || DEFAULT_URL;
    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch {
        throw new CatalogError('连不上 models.dev，请检查服务器网络后重试', 502);
    }
    if (!response.ok) throw new CatalogError(`models.dev 返回 ${response.status}，请稍后重试`, 502);
    let catalog: ModelsDevCatalog;
    try {
        catalog = await response.json() as ModelsDevCatalog;
    } catch {
        throw new CatalogError('models.dev 返回的内容无法解析', 502);
    }
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        throw new CatalogError('models.dev 返回的内容无法解析', 502);
    }
    return flattenModelsDevCatalog(catalog);
}

async function catalog(): Promise<ModelsDevSuggestion[]> {
    if (cache && cache.expires > Date.now()) return cache.models;
    // 并发请求共用一次下载；失败不写缓存，下次重试。
    pending ??= download()
        .then(models => {
            cache = { expires: Date.now() + CACHE_TTL_MS, models };
            return models;
        })
        .finally(() => { pending = null; });
    return pending;
}

export async function searchModelsDev(query: string, limit = 20): Promise<ModelsDevSuggestion[]> {
    if (!query.trim()) return [];
    return matchModelsDevModels(await catalog(), query, limit);
}
