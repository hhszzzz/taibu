import { readLocalCache, removeLocalCache, writeLocalCache } from '@/lib/cache/local-storage';

type ClientModelNameMap = Record<string, string>;

const MODEL_NAME_CACHE_KEY = 'taibu.model_name_map';
const LEGACY_MODEL_NAME_CACHE_KEY = 'mingai.model_name_map';

let memoryModelNameMap: ClientModelNameMap | null = null;
/** Icons an ID does not tell (own models are `byok:<id>`); kept for the page's lifetime. */
const memoryModelIcons = new Map<string, string>();

function loadClientModelNameMap(): ClientModelNameMap {
    if (memoryModelNameMap) {
        return memoryModelNameMap;
    }
    removeLocalCache(LEGACY_MODEL_NAME_CACHE_KEY);
    const cached = readLocalCache<ClientModelNameMap>(MODEL_NAME_CACHE_KEY, Number.POSITIVE_INFINITY) || {};
    memoryModelNameMap = cached;
    return cached;
}

export function registerClientModelNames(models: Array<{ id: string; name: string }>) {
    if (models.length === 0) return;

    const current = loadClientModelNameMap();
    const next: ClientModelNameMap = { ...current };
    let changed = false;

    for (const model of models) {
        const id = model.id?.trim();
        const name = model.name?.trim();
        if (!id || !name) continue;
        if (next[id] === name) continue;
        next[id] = name;
        changed = true;
    }

    if (!changed) return;

    memoryModelNameMap = next;
    writeLocalCache(MODEL_NAME_CACHE_KEY, next);
    removeLocalCache(LEGACY_MODEL_NAME_CACHE_KEY);
}

export function resolveClientModelName(modelId: string, fallback?: string): string {
    if (!modelId) {
        return fallback || '';
    }
    const cached = loadClientModelNameMap();
    return cached[modelId] || fallback || modelId;
}

export function registerClientModelIcons(models: Array<{ id: string; icon: string | null }>) {
    for (const model of models) if (model.icon) memoryModelIcons.set(model.id, model.icon);
}

export function registeredClientModelIcon(modelId: string | null | undefined): string | null {
    return modelId ? memoryModelIcons.get(modelId) ?? null : null;
}
