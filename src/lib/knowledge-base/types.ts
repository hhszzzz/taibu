import type { MembershipType } from '@/lib/user/membership';
import type { DataSourceType } from '@/lib/data-sources/types';

export interface KnowledgeSourceChunk {
    content: string;
    sourceType: 'conversation' | 'record' | 'file' | 'chat_message' | DataSourceType;
    sourceId: string;
    chunkIndex: number;
    metadata: Record<string, unknown>;
}

export interface KnowledgeSourceRef {
    sourceType: KnowledgeSourceChunk['sourceType'];
    sourceId: string;
    archive?: boolean;
}

export interface KnowledgeSourceWriteOptions {
    userId?: string;
    source?: KnowledgeSourceRef;
}

export interface KnowledgeSourceReplacement {
    kbId: string;
    source: KnowledgeSourceRef;
    chunks: KnowledgeSourceChunk[];
    userId?: string;
}

/** Replacement and optional archival are one atomic operation, never two writes. */
export interface KnowledgeSourcePersistence {
    replaceSourceEntries(replacement: KnowledgeSourceReplacement): Promise<number | null>;
}

export interface KnowledgeSearchRow {
    id: string;
    kbId: string;
    content: string;
    metadata: Record<string, unknown>;
    rawScore: number;
}

/** Authorized, narrow reads; SQL and SDK query builders belong in the adapter. */
export interface KnowledgeSearchPersistence {
    searchFts(query: string, kbIds: string[] | undefined, limit: number, config: SearchConfig): Promise<KnowledgeSearchRow[]>;
    searchTrigram(query: string, kbIds: string[] | undefined, limit: number, threshold: number): Promise<KnowledgeSearchRow[]>;
    searchVector(vector: number[], kbIds: string[] | undefined, limit: number, dimension: number): Promise<KnowledgeSearchRow[]>;
    loadWeights(userId: string, kbIds: string[]): Promise<Array<{ id: string; weight: string }>>;
}

export type KnowledgeBaseWeight = 'low' | 'normal' | 'high';

export interface KnowledgeBase {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    weight: KnowledgeBaseWeight;
    created_at: string;
    updated_at: string;
}

export interface KnowledgeBaseInput {
    name: string;
    description?: string | null;
    weight?: KnowledgeBaseWeight;
}

export type SearchConfig = 'simple' | 'english';

export type SearchMethod = 'fts' | 'trigram' | 'vector';

export interface SearchCandidate {
    id: string;
    kbId: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    method: SearchMethod;
}

export interface RankedResult extends SearchCandidate {
    rank: number;
}

export interface SearchOptions {
    kbIds?: string[];
    limit?: number;
    topK?: number;
    useVector?: boolean;
    accessToken?: string;
    userId?: string;
    membershipType?: MembershipType;
    searchConfig?: Partial<{
        ftsConfig: SearchConfig;
        enableTrigram: boolean;
        trigramThreshold: number;
    }>;
}

export interface SearchResult {
    results: RankedResult[] | SearchCandidate[];
}

export interface KnowledgeHit {
    kbId: string;
    kbName: string;
    content: string;
    score: number;
}

export interface IngestResult {
    entriesCreated: number;
    chunks: number;
}
