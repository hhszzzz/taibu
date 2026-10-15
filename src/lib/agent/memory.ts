export type AgentMemory = { id: string; title: string; content: string; kind: 'preference' | 'context'; updated_at: string };
export const AGENT_MEMORY_SELECT = 'id,title,content,kind,updated_at';
export function validMemory(value: unknown): value is Pick<AgentMemory, 'title' | 'content' | 'kind'> {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<AgentMemory>;
    return typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 80 && typeof item.content === 'string' && item.content.trim().length > 0 && item.content.length <= 2000 && (item.kind === 'preference' || item.kind === 'context');
}
/** Only the fields the account owner manages; ownership and fingerprint columns stay in the database. */
export function publicMemory(value: AgentMemory): AgentMemory {
    return { id: value.id, title: value.title, content: value.content, kind: value.kind, updated_at: value.updated_at };
}
