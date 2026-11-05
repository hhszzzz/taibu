import { NextRequest, type NextResponse } from 'next/server';
import { jsonError, jsonOk, requireAdminContext } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { parseAnnouncementInput, serializeAnnouncement, type AnnouncementRow } from '@/lib/announcement';
import { invalidateAnnouncementCache } from '@/lib/announcements.server';

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function getAnnouncementRow(id: string) {
    try {
        const data = await systemDb().tx((trx) => trx
            .selectFrom('announcements')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst());
        return { row: (data ?? null) as unknown as AnnouncementRow | null, error: null };
    } catch (error) {
        return { row: null, error };
    }
}

/** Loads a row or the response to return for a missing row / failed read. */
async function loadAnnouncement(id: string, label: 'GET' | 'PATCH' | 'DELETE'): Promise<{ row: AnnouncementRow } | { response: NextResponse }> {
    const { row, error } = await getAnnouncementRow(id);
    if (error) {
        console.error(`[announcements][admin][${label}] load failed:`, error);
        return { response: jsonError('获取公告失败', 500) };
    }
    if (!row) {
        return { response: jsonError('公告不存在', 404) };
    }
    return { row };
}

export async function GET(request: NextRequest, context: RouteContext) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const { id } = await context.params;
    const loaded = await loadAnnouncement(id, 'GET');
    if ('response' in loaded) {
        return loaded.response;
    }

    return jsonOk({ announcement: serializeAnnouncement(loaded.row) });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const { id } = await context.params;
    const loaded = await loadAnnouncement(id, 'PATCH');
    if ('response' in loaded) {
        return loaded.response;
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    const parsed = parseAnnouncementInput(body, { partial: true });
    if (parsed.error || !parsed.value) {
        return jsonError(parsed.error || '公告参数无效', 400);
    }

    if (!parsed.value.content) {
        return jsonError('公告内容不能为空', 400);
    }
    const content = parsed.value.content;

    let data: AnnouncementRow | undefined;
    try {
        data = await systemDb().tx((trx) => trx
            .updateTable('announcements')
            .set({ content })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst()) as unknown as AnnouncementRow | undefined;
    } catch (error) {
        console.error('[announcements][admin][PATCH] update failed:', error);
        return jsonError('更新公告失败', 500);
    }

    if (!data) {
        return jsonError('更新公告失败', 500);
    }

    await invalidateAnnouncementCache();
    return jsonOk({ announcement: serializeAnnouncement(data) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const { id } = await context.params;
    const loaded = await loadAnnouncement(id, 'DELETE');
    if ('response' in loaded) {
        return loaded.response;
    }
    try {
        await systemDb().tx((trx) => trx
            .deleteFrom('announcements')
            .where('id', '=', id)
            .execute());
    } catch (error) {
        console.error('[announcements][admin][DELETE] delete failed:', error);
        return jsonError('删除公告失败', 500);
    }

    await invalidateAnnouncementCache();
    return jsonOk({ success: true });
}
