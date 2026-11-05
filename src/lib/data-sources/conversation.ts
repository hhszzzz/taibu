/**
 * 面相 / 手相记录都通过 conversation 保存 AI 解读；两者取会话与解读正文的方式一致。
 */
import type { ScopedDb } from '@/lib/db/context.server';

export type ProviderConversation = {
    messages?: unknown;
    source_data?: unknown;
};

/** 会话里第一条有内容的 assistant 回复，即保存下来的解读正文。 */
export function extractConversationAnalysis(conversation?: ProviderConversation | null): string | null {
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const assistant = messages.find((m: { role?: string; content?: string }) => m?.role === 'assistant' && m?.content);
    return assistant?.content || null;
}

/** 读取记录关联的会话；没有会话时返回 null。 */
export async function loadProviderConversation(
    db: ScopedDb,
    conversationId: string | null,
): Promise<ProviderConversation | null> {
    if (!conversationId) return null;
    return await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['messages', 'source_data'])
        .where('id', '=', conversationId)
        .executeTakeFirst()) ?? null;
}
