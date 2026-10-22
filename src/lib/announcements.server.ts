import 'server-only';

import type { AnnouncementRow } from '@/lib/announcement';
import { createSharedCache } from '@/lib/cache/shared.server';
import { systemDb } from '@/lib/db/context.server';

/**
 * Published announcements are read on every page (banner/count) and written
 * rarely. Cache the newest page; beyond the cap the route falls back to SQL.
 */
export const PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT = 101;

const publishedAnnouncements = createSharedCache<AnnouncementRow[]>({
  name: 'announcements:published',
  ttlMs: 30_000,
});

export async function loadPublishedAnnouncementRows(): Promise<AnnouncementRow[]> {
  return publishedAnnouncements.load(async () => {
    const rows = await systemDb().tx((trx) => trx
      .selectFrom('announcements')
      .selectAll()
      .orderBy('published_at', 'desc')
      .limit(PUBLISHED_ANNOUNCEMENT_CACHE_LIMIT)
      .execute());
    return rows as unknown as AnnouncementRow[];
  });
}

export function invalidateAnnouncementCache(): Promise<void> {
  return publishedAnnouncements.invalidate();
}
