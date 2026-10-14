/**
 * 知识库归档条目的 id 约定
 *
 * 对话回复与上传文件只写入 knowledge_entries，没有 archived_sources 行。归档列表把它们
 * 合成为 `${sourceType}:${kbId}:${sourceId}` 形式的虚拟 id，删除接口据此还原来源。
 * 文件名可能含冒号，解析时只按前两个冒号切分；archived_sources 的 id 是 uuid，不含冒号。
 */

export const VIRTUAL_ARCHIVE_SOURCE_TYPES = ['chat_message', 'file'] as const;

export type VirtualArchiveSourceType = (typeof VIRTUAL_ARCHIVE_SOURCE_TYPES)[number];

export type ArchiveIdTarget =
    | { kind: 'stored'; id: string }
    | { kind: 'virtual'; sourceType: VirtualArchiveSourceType; kbId: string; sourceId: string }
    | { kind: 'malformed' };

export function isVirtualArchiveSourceType(value: string): value is VirtualArchiveSourceType {
    return (VIRTUAL_ARCHIVE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function buildVirtualArchiveId(sourceType: VirtualArchiveSourceType, kbId: string, sourceId: string): string {
    return `${sourceType}:${kbId}:${sourceId}`;
}

export function parseArchiveId(id: string): ArchiveIdTarget {
    const typeEnd = id.indexOf(':');
    if (typeEnd < 0) return id ? { kind: 'stored', id } : { kind: 'malformed' };

    const sourceType = id.slice(0, typeEnd);
    const kbEnd = id.indexOf(':', typeEnd + 1);
    if (!isVirtualArchiveSourceType(sourceType) || kbEnd < 0) return { kind: 'malformed' };

    const kbId = id.slice(typeEnd + 1, kbEnd);
    const sourceId = id.slice(kbEnd + 1);
    return kbId && sourceId ? { kind: 'virtual', sourceType, kbId, sourceId } : { kind: 'malformed' };
}
