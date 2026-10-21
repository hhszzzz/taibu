import { type NextRequest } from 'next/server';
import { jsonError, requireUserContext } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { loadAllConversationMessages } from '@/lib/server/conversation-messages';
import { conversationHtml } from '@/lib/chat/conversation-transfer';
import { exportConversationMarkdown } from '@/lib/chat/conversation-export.server';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError('对话 ID 无效', 400);
    const db = auth.scoped;
    const result = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select('title')
        .where('id', '=', id)
        .where('user_id', '=', auth.user.id)
        .executeTakeFirst()).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
    if (result.error) return jsonError('读取对话失败', 500);
    const { data } = result;
    if (!data) return jsonError('对话不存在', 404);
    const { messages, error: messageError } = await loadAllConversationMessages(db, id);
    if (messageError) return jsonError('读取消息失败', 500);
    const format = request.nextUrl.searchParams.get('format') === 'html' ? 'html' : 'md';
    let markdown: string;
    try { markdown = await exportConversationMarkdown(db, auth.user.id, id, data.title || '太卜对话', messages, request.nextUrl.searchParams.get('tools') === '1'); }
    catch (cause) { return jsonError(cause instanceof Error ? cause.message : '导出资料失败', 409); }
    return new Response(format === 'html' ? conversationHtml(data.title || '太卜对话', markdown) : markdown, { headers: {
        'Content-Type': format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8',
        'Content-Disposition': `attachment; filename="taibu-conversation.${format}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
}
