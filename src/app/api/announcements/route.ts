import { NextRequest } from 'next/server';
import { systemDb } from '@/lib/db/context.server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { serializeAnnouncement, type AnnouncementRow } from '@/lib/announcement';

export async function GET(request: NextRequest) {
    const countOnly = request.nextUrl.searchParams.get('count') === '1';
    const latestOnly = request.nextUrl.searchParams.get('latest') === '1';
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 20), 1), 100);
    const offset = Math.max(Number(request.nextUrl.searchParams.get('offset') || 0), 0);

    if (countOnly) {
        const count = await systemDb().tx(async (trx) => {
            const row = await trx
                .selectFrom('announcements')
                .select((eb) => eb.fn.countAll<number>().as('count'))
                .executeTakeFirstOrThrow();
            return row.count;
        }).catch((error) => {
            console.error('[announcements][GET][count] query failed:', error);
            return null;
        });
        if (count === null) return jsonError('获取公告失败', 500);

        return jsonOk({ count: count ?? 0 });
    }

    if (latestOnly) {
        const row = await systemDb().tx((trx) => trx
            .selectFrom('announcements')
            .selectAll()
            .orderBy('published_at', 'desc')
            .limit(1)
            .executeTakeFirst()).catch((error) => {
            console.error('[announcements][GET][latest] query failed:', error);
            return null;
        });
        if (row === null) return jsonError('获取公告失败', 500);

        return jsonOk({
            announcement: row ? serializeAnnouncement(row as AnnouncementRow) : null,
        });
    }

    const rows = await systemDb().tx((trx) => trx
        .selectFrom('announcements')
        .selectAll()
        .orderBy('published_at', 'desc')
        .offset(offset)
        .limit(limit + 1)
        .execute()).catch((error) => {
        console.error('[announcements][GET][list] query failed:', error);
        return null;
    });
    if (rows === null) return jsonError('获取公告失败', 500);

    const announcements = rows.slice(0, limit).map((row) => serializeAnnouncement(row as AnnouncementRow));
    const hasMore = rows.length > limit;

    return jsonOk({
        announcements,
        pagination: {
            hasMore,
            nextOffset: hasMore ? offset + announcements.length : null,
        },
    });
}
