import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminContext } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { parseAnnouncementInput, serializeAnnouncement, type AnnouncementRow } from '@/lib/announcement';
import { invalidateAnnouncementCache } from '@/lib/announcements.server';

export async function GET(request: NextRequest) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    let data: AnnouncementRow[];
    try {
        data = await systemDb().tx((trx) => trx
            .selectFrom('announcements')
            .selectAll()
            .orderBy('published_at', 'desc')
            .execute()) as unknown as AnnouncementRow[];
    } catch (error) {
        console.error('[announcements][admin][GET] query failed:', error);
        return jsonError('获取公告列表失败', 500);
    }

    return jsonOk({
        announcements: data.map((row) => serializeAnnouncement(row)),
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    const parsed = parseAnnouncementInput(body);
    if (parsed.error || !parsed.value) {
        return jsonError(parsed.error || '公告参数无效', 400);
    }

    const payload = {
        content: parsed.value.content!,
        published_at: new Date().toISOString(),
    };

    let data: AnnouncementRow;
    try {
        data = await systemDb().tx((trx) => trx
            .insertInto('announcements')
            .values(payload)
            .returningAll()
            .executeTakeFirstOrThrow()) as unknown as AnnouncementRow;
    } catch (error) {
        console.error('[announcements][admin][POST] insert failed:', error);
        return jsonError('发布公告失败', 500);
    }

    await invalidateAnnouncementCache();
    return jsonOk({ announcement: serializeAnnouncement(data) });
}
