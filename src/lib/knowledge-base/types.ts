import type { MembershipType } from '@/lib/user/membership';
import type { DataSourceType } from '@/lib/data-sources/types';

/** Shared by HTTP and internal retrieval callers before embedding or SQL. */
export const KNOWLEDGE_QUERY_MAX_LENGTH = 4_000;

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
    source?: KnowledgeSourceRef;
}

export interface KnowledgeSourceReplacement {
    kbId: string;
    source: KnowledgeSourceRef;
    chunks: KnowledgeSourceChunk[];
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

/**
 * Structural identity marker accepted by browser-safe search contracts.
 * The server layer resolves it to a ScopedDb before any query runs.
 */
export type KnowledgeSearchDatabase = {
    readonly scope: {
        readonly kind: 'user' | 'anon' | 'system';
        readonly userId?: string;
    };
};

export interface SearchOptions {
    kbIds?: string[];
    limit?: number;
    topK?: number;
    useVector?: boolean;
    db?: KnowledgeSearchDatabase;
    userId?: string;
    membershipType?: MembershipType;
    searchConfig?: Partial<{
        ftsConfig: SearchConfig;
        enableTrigram: boolean;
        trigramThreshold: number;
    }>;
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
