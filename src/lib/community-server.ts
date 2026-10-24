import type { ScopedDb } from '@/lib/db/context.server';

export type CommunityAuthorProfile = {
    name: string;
    avatarUrl: string | null;
};

import type { CommunityPost } from '@/lib/community';

export type CommunityPostRow = Omit<CommunityPost, 'author_name' | 'author_avatar_url'> & {
    user_id: string;
};

export function toPublicPost(
    post: CommunityPostRow,
    authorProfile: { name: string; avatarUrl: string | null },
): CommunityPost {
    return {
        id: post.id,
        author_name: authorProfile.name,
        author_avatar_url: authorProfile.avatarUrl,
        title: post.title,
        content: post.content,
        category: post.category,
        tags: post.tags,
        view_count: post.view_count,
        upvote_count: post.upvote_count,
        downvote_count: post.downvote_count,
        comment_count: post.comment_count,
        is_pinned: post.is_pinned,
        is_featured: post.is_featured,
        is_deleted: post.is_deleted,
        created_at: post.created_at,
        updated_at: post.updated_at,
    };
}

type UserProfileRow = {
    id: string;
    nickname: string | null;
    avatar_url: string | null;
};

const DEFAULT_COMMUNITY_AUTHOR_NAME = '命理爱好者';

export async function loadCommunityAuthorProfileMap(
    db: ScopedDb,
    userIds: Array<string | null | undefined>,
) {
    const ids = Array.from(new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0)));
    const authorMap = new Map<string, CommunityAuthorProfile>();

    if (ids.length === 0) {
        return authorMap;
    }

    // Author rows belong to other users, which row level security hides; the
    // definer function exposes only the display fields a post shows.
    let rows: Array<{ user_id: string; nickname: string | null; avatar_url: string | null }>;
    try {
        rows = await db.rpc('community_author_profiles', { p_user_ids: ids });
    } catch (error) {
        console.error('[community] failed to load author names:', error);
        return authorMap;
    }

    for (const row of rows) {
        authorMap.set(row.user_id, normalizeCommunityAuthorProfile({ nickname: row.nickname, avatar_url: row.avatar_url }));
    }

    return authorMap;
}

export async function loadSingleCommunityAuthorProfile(
    db: ScopedDb,
    userId: string,
) {
    let profile: { nickname: string | null; avatar_url: string | null } | undefined;
    try {
        profile = (await db.rpc('community_author_profiles', { p_user_ids: [userId] }))[0];
    } catch (error) {
        console.error('[community] failed to load author name:', error);
        return {
            name: DEFAULT_COMMUNITY_AUTHOR_NAME,
            avatarUrl: null,
        };
    }

    return normalizeCommunityAuthorProfile(profile ?? null);
}

export function normalizeCommunityAuthorName(name: string | null | undefined) {
    if (typeof name !== 'string') return DEFAULT_COMMUNITY_AUTHOR_NAME;
    const normalized = name.trim();
    return normalized || DEFAULT_COMMUNITY_AUTHOR_NAME;
}

function normalizeCommunityAuthorProfile(profile: Pick<UserProfileRow, 'nickname' | 'avatar_url'> | null | undefined): CommunityAuthorProfile {
    return {
        name: normalizeCommunityAuthorName(profile?.nickname ?? null),
        avatarUrl: typeof profile?.avatar_url === 'string' && profile.avatar_url.length > 0
            ? profile.avatar_url
            : null,
    };
}
