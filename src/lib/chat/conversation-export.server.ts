import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScopedDb } from '@/lib/db/context.server';
import type { ChatMessage } from '@/types';
import { attachmentBytes, validateAttachmentIds } from '@/lib/agent/attachments.server';
import { conversationMarkdown } from './conversation-transfer';
export async function enrichConversationBasis(db: ScopedDb, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const runIds = [...new Set(messages.flatMap(message => message.agent ? [message.agent.runId] : []))];
    const basis = new Map<string, string>();
    for (let index = 0; index < runIds.length; index += 50) {
        const rows = await db.tx((trx) => trx
            .selectFrom('agent_run_artifacts')
            .select(['run_id', 'call_id', 'result'])
            .where('kind', '=', 'calculation')
            .where('run_id', 'in', runIds.slice(index, index + 50))
            .execute()).catch(() => {
            throw new Error('读取命盘依据失败');
        });
        for (const item of rows) {
            const canonicalText = (item.result as { canonicalText?: string } | null)?.canonicalText;
            if (canonicalText) basis.set(`${item.run_id}:${item.call_id.split(':').at(-1)}`, canonicalText);
        }
    }
    return messages.map(message => message.agent ? { ...message, agent: { ...message.agent, parts: message.agent.parts.map(part => part.type === 'tool' && !part.canonicalText ? { ...part, canonicalText: basis.get(`${message.agent!.runId}:${part.id.split(':').at(-1)}`) } : part) } } : message);
}
export async function exportConversationMarkdown(db: ScopedDb, storageDb: SupabaseClient, userId: string, conversationId: string, title: string, messages: ChatMessage[], tools: boolean): Promise<string> {
    let markdown = conversationMarkdown(title, await enrichConversationBasis(db, messages), tools);
    const ids = [...new Set(messages.flatMap(message => message.attachments?.ids ?? []))];
    if (!ids.length) return markdown;
    const refs = await db.tx((trx) => trx
        .selectFrom('agent_attachment_refs')
        .select('attachment_id')
        .where('conversation_id', '=', conversationId)
        .where('attachment_id', 'in', ids)
        .execute()).catch(() => {
        throw new Error('资料引用已改变，请刷新后导出');
    });
    if (refs.length !== ids.length) throw new Error('资料引用已改变，请刷新后导出');
    const assets = [];
    for (let index = 0; index < ids.length; index += 4) assets.push(...await validateAttachmentIds(storageDb, userId, ids.slice(index, index + 4)));
    if (assets.reduce((sum, asset) => sum + asset.size, 0) > 64 * 1024 * 1024) throw new Error('资料超过单次导出 64MB 限制');
    markdown += '\n\n## 附加资料\n';
    for (const asset of assets) {
        const bytes = await attachmentBytes(storageDb, asset);
        const name = asset.name.replace(/[\r\n\[\]<>]/g, ' ');
        if (asset.kind === 'image') markdown += `\n\n### ${name}\n\n![${name}](data:${asset.mime_type};base64,${Buffer.from(bytes).toString('base64')})\n`;
        else { const text = new TextDecoder().decode(bytes); const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1))); markdown += `\n\n### ${name}\n\n${fence}text\n${text}\n${fence}\n`; }
    }
    return markdown;
}
