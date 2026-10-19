import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext, resolveRequestDbClient } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { loadAllConversationMessages } from '@/lib/server/conversation-messages';
import { enrichConversationBasis } from '@/lib/chat/conversation-export.server';
import {
    buildShareSnapshot,
    createShareToken,
    normalizeShareTitle,
    shareStateFromRow,
    ShareSnapshotTooLargeError,
    type ConversationShareRow,
} from '@/lib/chat/conversation-share';

type RouteContext = { params: Promise<{ id: string }> };

const SHARE_COLUMNS = 'token,conversation_id,title,include_charts,created_at,updated_at';

/** Shared prologue: caller, valid id, request database and an owned conversation. */
async function ownedConversation(request: NextRequest, context: RouteContext) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return { ok: false as const, response: jsonError(auth.error.message, auth.error.status) };
    const { id } = await context.params;
    if (!isValidUUID(id)) return { ok: false as const, response: jsonError('对话 ID 无效', 400) };
    const db = resolveRequestDbClient(auth);
    if (!db) return { ok: false as const, response: jsonError('读取对话失败', 500) };
    const { data, error } = await db.from('conversations').select('id,title,updated_at').eq('id', id).eq('user_id', auth.user.id).maybeSingle();
    if (error) return { ok: false as const, response: jsonError('读取对话失败', 500) };
    if (!data) return { ok: false as const, response: jsonError('对话不存在', 404) };
    return { ok: true as const, auth, db, id, conversation: data as { id: string; title: string | null; updated_at: string } };
}

function shareRpcError(error: { code?: string } | null) {
    if (error?.code === '42501') return jsonError('对话不存在', 404);
    if (error?.code === '55006') return jsonError('任务进行中，完成后再分享', 409);
    if (error?.code === '40001') return jsonError('对话刚刚更新，请重试', 409);
    if (error?.code === '22023') return jsonError('分享内容超过 1MB 上限', 413);
    return jsonError('更新公开链接失败', 500);
}

async function activeShare(db: NonNullable<ReturnType<typeof resolveRequestDbClient>>, userId: string, id: string) {
    return db.from('conversation_shares').select(SHARE_COLUMNS)
        .eq('conversation_id', id).eq('user_id', userId).is('revoked_at', null).maybeSingle();
}

/** Current public link of the conversation, or null. */
export async function GET(request: NextRequest, context: RouteContext) {
    const owned = await ownedConversation(request, context);
    if (!owned.ok) return owned.response;
    const { data, error } = await activeShare(owned.db, owned.auth.user.id, owned.id);
    if (error) return jsonError('读取公开链接失败', 500);
    return jsonOk({ share: data ? shareStateFromRow(data as ConversationShareRow) : null });
}

/** Create the public link or refresh its snapshot; an existing link keeps its token. */
export async function POST(request: NextRequest, context: RouteContext) {
    const owned = await ownedConversation(request, context);
    if (!owned.ok) return owned.response;
    let body: { includeCharts?: unknown };
    try { body = await request.json(); } catch { return jsonError('请求体无效', 400); }
    if (!body || typeof body !== 'object') return jsonError('请求体无效', 400);
    if (body.includeCharts !== undefined && typeof body.includeCharts !== 'boolean') return jsonError('参数无效', 400);
    const includeCharts = body.includeCharts === true;
    const { messages, error: messageError } = await loadAllConversationMessages(owned.db, owned.id);
    if (messageError) return jsonError('读取消息失败', 500);
    let snapshot;
    try {
        // Chart basis lives in run artifacts; only read them when the owner opted in.
        snapshot = buildShareSnapshot(includeCharts ? await enrichConversationBasis(owned.db, messages) : messages, { includeCharts });
    } catch (error) {
        if (error instanceof ShareSnapshotTooLargeError) return jsonError(error.message, 413);
        return jsonError('读取命盘依据失败', 500);
    }
    if (!snapshot.length) return jsonError('对话还没有可分享的内容', 400);
    const result = await owned.db.rpc('upsert_conversation_share', {
        p_conversation: owned.id,
        p_token: createShareToken(),
        p_title: normalizeShareTitle(owned.conversation.title),
        p_snapshot: snapshot,
        p_include_charts: includeCharts,
        p_source_updated_at: owned.conversation.updated_at,
    });
    if (result.error || !result.data) return shareRpcError(result.error);
    return jsonOk({ share: shareStateFromRow(result.data as ConversationShareRow) });
}

/** Revoke the public link; the stored snapshot is purged in the same statement. */
export async function DELETE(request: NextRequest, context: RouteContext) {
    const owned = await ownedConversation(request, context);
    if (!owned.ok) return owned.response;
    const result = await owned.db.rpc('revoke_conversation_share', { p_conversation: owned.id });
    if (result.error) return shareRpcError(result.error);
    return jsonOk({ revoked: result.data === true });
}
