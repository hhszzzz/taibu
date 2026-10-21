import { DATA_SOURCE_TYPES, type DataSourceType } from '@/lib/data-sources/types';
import type { AIMessageMetadata, InjectedSource } from '@/types';

type ChatMentionFeatureState = {
    knowledgeBaseEnabled: boolean;
    enabledDataSourceTypes: readonly DataSourceType[];
};

type VisibleSourcePanelState = {
    visibleSources: InjectedSource[];
    showKnowledgeBaseMiss: boolean;
};

function isEnabledDataSourceType(
    sourceType: string | undefined,
    enabledTypeSet: Set<DataSourceType>,
): sourceType is DataSourceType {
    return !!sourceType
        && DATA_SOURCE_TYPES.includes(sourceType as DataSourceType)
        && enabledTypeSet.has(sourceType as DataSourceType);
}

function sanitizeChatSources(
    sources: InjectedSource[] | undefined,
    featureState: ChatMentionFeatureState,
): InjectedSource[] {
    const enabledTypeSet = new Set(featureState.enabledDataSourceTypes);

    return (sources ?? []).filter((source) => {
        if (source.type === 'knowledge_base') {
            return featureState.knowledgeBaseEnabled;
        }

        if (source.type !== 'mention' && source.type !== 'data_source') {
            return false;
        }

        return isEnabledDataSourceType(source.sourceType, enabledTypeSet);
    });
}

export function getVisibleSourcePanelState(
    metadata: Pick<AIMessageMetadata, 'sources' | 'kbSearchEnabled'> | undefined,
    featureState: ChatMentionFeatureState,
): VisibleSourcePanelState {
    const visibleSources = sanitizeChatSources(metadata?.sources, featureState);

    return {
        visibleSources,
        showKnowledgeBaseMiss: featureState.knowledgeBaseEnabled
            && Boolean(metadata?.kbSearchEnabled)
            && visibleSources.length === 0,
    };
}

export type WebSearchStatus = NonNullable<AIMessageMetadata['webSearch']>['status'];
export type VisibleWebSource = { title: string; url: string; host: string };
export type VisibleWebSearch = { status: WebSearchStatus; sources: VisibleWebSource[] };

const WEB_SEARCH_STATUSES: ReadonlySet<unknown> = new Set<WebSearchStatus>(['ok', 'failed', 'unavailable']);

function httpAddress(value: unknown): URL | null {
    if (typeof value !== 'string') return null;
    try {
        const address = new URL(value);
        return address.protocol === 'http:' || address.protocol === 'https:' ? address : null;
    } catch {
        return null;
    }
}

/**
 * What a plain chat answer shows of its web search: whether the search ran and the pages it returned. The browser
 * saves message metadata, so a page is shown only with an http(s) address, once, and with a bounded title.
 */
export function getVisibleWebSearch(metadata: Pick<AIMessageMetadata, 'webSearch'> | undefined): VisibleWebSearch | null {
    const search: unknown = metadata?.webSearch;
    if (!search || typeof search !== 'object') return null;
    const { status, sources } = search as Record<string, unknown>;
    if (!WEB_SEARCH_STATUSES.has(status)) return null;
    const visible: VisibleWebSource[] = [];
    for (const source of Array.isArray(sources) ? sources : []) {
        const { title, url } = (source ?? {}) as Record<string, unknown>;
        const address = httpAddress(url);
        if (!address || visible.some(item => item.url === address.href)) continue;
        const heading = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : '';
        visible.push({ title: (heading || address.hostname).slice(0, 300), url: address.href, host: address.hostname });
    }
    return { status: status as WebSearchStatus, sources: visible };
}
