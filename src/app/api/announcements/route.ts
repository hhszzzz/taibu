import { NextRequest } from 'next/server';
import { systemDb } from '@/lib/db/context.server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { serializeAnnouncement, type AnnouncementRow } from '@/lib/announcement';
import { loadPublishedAnnouncementRows, PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT } from '@/lib/announcements.server';

export async function GET(request: NextRequest) {
    const countOnly = request.nextUrl.searchParams.get('count') === '1';
    const latestOnly = request.nextUrl.searchParams.get('latest') === '1';
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 20), 1), 100);
    const offset = Math.max(Number(request.nextUrl.searchParams.get('offset') || 0), 0);

    if (countOnly) {
        try {
            const rows = await loadPublishedAnnouncementRows();
            if (rows.length < PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT) {
                return jsonOk({ count: rows.length });
            }
        } catch (error) {
            console.error('[announcements][GET][count] cached read failed:', error);
            return jsonError('获取公告失败', 500);
        }
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

        return jsonOk({ count });
    }

    if (latestOnly) {
        try {
            const [row] = await loadPublishedAnnouncementRows();
            return jsonOk({
                announcement: row ? serializeAnnouncement(row) : null,
            });
        } catch (error) {
            console.error('[announcements][GET][latest] cached read failed:', error);
            return jsonError('获取公告失败', 500);
        }
    }

    try {
        const rows = await loadPublishedAnnouncementRows();
        const complete = rows.length < PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT
            || offset + limit + 1 <= PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT;
        if (complete) {
            const page = rows.slice(offset, offset + limit + 1);
            const hasMore = page.length > limit;
            const announcements = page.slice(0, limit).map((row) => serializeAnnouncement(row));
            return jsonOk({
                announcements,
                pagination: {
                    hasMore,
                    nextOffset: hasMore ? offset + announcements.length : null,
                },
            });
        }
    } catch (error) {
        console.error('[announcements][GET][list] cached read failed:', error);
        return jsonError('获取公告失败', 500);
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
