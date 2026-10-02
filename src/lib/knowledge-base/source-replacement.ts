import type {
    IngestResult,
    KnowledgeSourceChunk,
    KnowledgeSourcePersistence,
    KnowledgeSourceWriteOptions,
} from '@/lib/knowledge-base/types';

/** Validate a single ordered source before delegating its atomic replacement/archive. */
export async function replaceKnowledgeSourceEntries(
    persistence: KnowledgeSourcePersistence,
    kbId: string,
    chunks: KnowledgeSourceChunk[],
    options?: KnowledgeSourceWriteOptions,
): Promise<IngestResult> {
    const source = options?.source || (chunks[0]
        ? {
            sourceType: chunks[0].sourceType,
            sourceId: chunks[0].sourceId,
            archive: false,
        }
        : null);

    if (!source) {
        throw new Error('缺少知识库来源信息');
    }

    const sameSource = chunks.every(c => c.sourceType === source.sourceType && c.sourceId === source.sourceId);
    const contiguous = chunks.every((c, i) => c.chunkIndex === i);
    if (!sameSource || !contiguous) {
        throw new Error('知识库条目必须按单一来源顺序写入');
    }

    const count = await persistence.replaceSourceEntries({ kbId, source, chunks, userId: options?.userId });
    return {
        entriesCreated: typeof count === 'number' ? count : chunks.length,
        chunks: chunks.length,
    };
}
