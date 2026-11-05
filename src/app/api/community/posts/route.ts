/**
 * 社区帖子列表 API 路由
 * GET: 获取帖子列表
 * POST: 创建新帖子
 */

import { NextRequest } from 'next/server';
import { PostCategory, PostFilters, normalizePostInput } from '@/lib/community';
import { loadCommunityAuthorProfileMap, loadSingleCommunityAuthorProfile, resolveCommunityAuthorProfile, toPublicPost, type CommunityPostRow } from '@/lib/community-server';
import { jsonError, jsonOk, readJsonBody, requireUserContext } from '@/lib/api-utils';
import { anonDb } from '@/lib/db/context.server';
import { escapeLike } from '@/lib/db/sql-helpers';
import { withRetry } from '@/lib/retry';
import { parsePagination } from '@/lib/pagination';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

export async function GET(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const { searchParams } = new URL(request.url);

        const { from, to } = parsePagination(searchParams, { defaultPageSize: 20 });
        const category = searchParams.get('category') as PostCategory | null;
        const search = searchParams.get('search');
        const sortBy = searchParams.get('sortBy') as PostFilters['sortBy'] || 'latest';

        // Public list: row level security shows only published posts to anon.
        const db = anonDb();
        const result = await withRetry(() => db.tx(async (trx) => {
            const filtered = () => {
                let query = trx.selectFrom('community_posts').where('is_deleted', '=', false);
                if (category) query = query.where('category', '=', category);
                if (search) {
                    const pattern = `%${escapeLike(search)}%`;
                    query = query.where((eb) => eb.or([eb('title', 'ilike', pattern), eb('content', 'ilike', pattern)]));
                }
                return query;
            };
            const total = await filtered().select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
            let query = filtered().selectAll();
            if (sortBy === 'popular') query = query.orderBy('is_pinned', 'desc').orderBy('upvote_count', 'desc');
            else if (sortBy === 'hot') query = query.orderBy('is_pinned', 'desc').orderBy('comment_count', 'desc');
            else query = query.orderBy('is_pinned', 'desc').orderBy('created_at', 'desc');
            return { rows: await query.offset(from).limit(to - from + 1).execute(), total: Number(total?.count ?? 0) };
        }));

        const authorMap = await loadCommunityAuthorProfileMap(
            db,
            result.rows.map((post) => post.user_id),
        );
        const safePosts = result.rows.map((post) =>
            toPublicPost(post as unknown as CommunityPostRow, resolveCommunityAuthorProfile(authorMap, post.user_id)),
        );

        return jsonOk({
            posts: safePosts,
            total: result.total,
        });
    } catch (error) {
        console.error('获取帖子失败:', error);
        return jsonError('获取帖子失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const parsed = await readJsonBody(request, 64 * 1024);
        if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
        const body = parsed.body;

        const normalized = normalizePostInput(body, 'create');
        if ('error' in normalized) {
            return jsonError(normalized.error, 400);
        }

        const postValues = Object.fromEntries(Object.entries({ user_id: user.id, ...normalized.data }).filter(([, value]) => value !== undefined));

        // 作者资料与插入互不依赖，可并行。
        const insertPromise = auth.db.tx((trx) => trx
            .insertInto('community_posts')
            .values(postValues as never)
            .returningAll()
            .executeTakeFirstOrThrow())
            .catch((postError) => {
                console.error('创建帖子失败:', postError);
                return null;
            });
        const [authorProfile, post] = await Promise.all([
            loadSingleCommunityAuthorProfile(auth.db, user.id),
            insertPromise,
        ]);
        if (!post) {
            return jsonError('创建帖子失败', 500);
        }

        return jsonOk(toPublicPost(post as unknown as CommunityPostRow, authorProfile));
    } catch (error) {
        console.error('创建帖子失败:', error);
        return jsonError('创建帖子失败', 500);
    }
}
