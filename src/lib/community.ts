/**
 * 命理社区服务
 *
 * 浏览器侧统一通过社区 API 访问数据。
 */

import { requestBrowserData } from '@/lib/browser-api';

// =====================================================
// 类型定义
// =====================================================

export type PostCategory = 'general' | 'bazi' | 'ziwei' | 'liuyao' | 'tarot' | 'qimen' | 'other';

export type VoteType = 'up' | 'down';

export type TargetType = 'post' | 'comment';

export type ReportReason = 'spam' | 'abuse' | 'inappropriate' | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface CommunityPost {
    id: string;
    author_name: string;
    author_avatar_url: string | null;
    title: string;
    content: string;
    category: PostCategory;
    tags: string[];
    view_count: number;
    upvote_count: number;
    downvote_count: number;
    comment_count: number;
    is_pinned: boolean;
    is_featured: boolean;
    is_deleted: boolean;
    created_at: string;
    updated_at: string;
}

export interface CommunityComment {
    id: string;
    post_id: string;
    parent_id: string | null;
    content: string;
    upvote_count: number;
    downvote_count: number;
    is_deleted: boolean;
    created_at: string;
    updated_at: string;
    author_name: string;
    author_avatar_url: string | null;
    replies?: CommunityComment[];
}

interface CommunityViewerState {
    isAuthenticated: boolean;
    isAuthor: boolean;
}

interface CommunityPostDetail {
    post: CommunityPost;
    comments: CommunityComment[];
    viewer: CommunityViewerState;
    viewerVotes: {
        post: VoteType | null;
        comments: Record<string, VoteType>;
    };
}

interface CommunityReport {
    id: string;
    reporter_id: string;
    target_type: TargetType;
    target_id: string;
    reason: ReportReason;
    description: string | null;
    status: ReportStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    created_at: string;
}

interface PostInput {
    title: string;
    content: string;
    category?: PostCategory;
    tags?: string[];
}

interface CommentInput {
    post_id: string;
    content: string;
    parent_id?: string;
}

export interface PostFilters {
    category?: PostCategory;
    search?: string;
    sortBy?: 'latest' | 'popular' | 'hot';
}

type PostWriteMode = 'create' | 'update';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPostCategory(value: string): value is PostCategory {
    return POST_CATEGORIES.some((item) => item.value === value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Post and comment limits: the API, the editor counters and the body cap all agree on these. */
export const COMMUNITY_LIMITS = {
    title: 120,
    content: 20_000,
    tags: 8,
    tag: 24,
    comment: 5_000,
    reportDescription: 500,
} as const;

function normalizeTags(value: unknown): string[] | { error: string } {
    if (!Array.isArray(value)) {
        return { error: 'tags 必须是字符串数组' };
    }
    if (value.length > COMMUNITY_LIMITS.tags) {
        return { error: `最多 ${COMMUNITY_LIMITS.tags} 个标签` };
    }

    const tags: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            return { error: 'tags 必须是字符串数组' };
        }
        const trimmed = entry.trim();
        if (trimmed.length > COMMUNITY_LIMITS.tag) {
            return { error: `每个标签不能超过 ${COMMUNITY_LIMITS.tag} 个字符` };
        }
        if (trimmed) {
            tags.push(trimmed);
        }
    }

    return Array.from(new Set(tags));
}

export function normalizePostInput(
    input: unknown,
    mode: PostWriteMode,
): { data: Partial<PostInput> } | { error: string } {
    if (!isPlainObject(input)) {
        return { error: '请求体不是合法对象' };
    }

    const data: Partial<PostInput> = {};

    if (mode === 'create' || hasOwn(input, 'title')) {
        if (typeof input.title !== 'string' || !input.title.trim()) {
            return { error: '标题和内容不能为空' };
        }
        const title = input.title.trim();
        if (title.length > COMMUNITY_LIMITS.title) {
            return { error: `标题不能超过 ${COMMUNITY_LIMITS.title} 个字符` };
        }
        data.title = title;
    }

    if (mode === 'create' || hasOwn(input, 'content')) {
        if (typeof input.content !== 'string' || !input.content.trim()) {
            return { error: '标题和内容不能为空' };
        }
        const content = input.content.trim();
        if (content.length > COMMUNITY_LIMITS.content) {
            return { error: `正文不能超过 ${COMMUNITY_LIMITS.content} 个字符` };
        }
        data.content = content;
    }

    if (mode === 'create' || hasOwn(input, 'category')) {
        if (input.category == null || input.category === '') {
            data.category = 'general';
        } else if (typeof input.category === 'string' && isPostCategory(input.category)) {
            data.category = input.category;
        } else {
            return { error: '帖子分类无效' };
        }
    }

    if (mode === 'create' || hasOwn(input, 'tags')) {
        if (input.tags == null) {
            data.tags = [];
        } else {
            const tags = normalizeTags(input.tags);
            if (typeof tags === 'object' && !Array.isArray(tags)) {
                return tags;
            }
            data.tags = tags;
        }
    }

    if (mode === 'update' && Object.keys(data).length === 0) {
        return { error: '没有可更新的帖子字段' };
    }

    return { data };
}

// =====================================================
// 帖子分类配置
// =====================================================

export const POST_CATEGORIES: { value: PostCategory; label: string; icon: string }[] = [
    { value: 'general', label: '综合讨论', icon: '💬' },
    { value: 'bazi', label: '八字命理', icon: '🔮' },
    { value: 'ziwei', label: '紫微斗数', icon: '⭐' },
    { value: 'liuyao', label: '六爻占卜', icon: '☯️' },
    { value: 'qimen', label: '奇门遁甲', icon: '🧭' },
    { value: 'tarot', label: '塔罗占卜', icon: '🃏' },
    { value: 'other', label: '其他', icon: '📌' },
];

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
    { value: 'spam', label: '垃圾广告' },
    { value: 'abuse', label: '辱骂/攻击' },
    { value: 'inappropriate', label: '不当内容' },
    { value: 'other', label: '其他原因' },
];

export function isReportReason(value: unknown): value is ReportReason {
    return typeof value === 'string' && REPORT_REASONS.some((reason) => reason.value === value);
}

// =====================================================
// 帖子 CRUD 操作
// =====================================================

/**
 * 获取帖子列表
 */
export async function getPosts(
    filters?: PostFilters,
    page: number = 1,
    pageSize: number = 20,
    options: { signal?: AbortSignal } = {},
): Promise<{ posts: CommunityPost[]; total: number }> {
    const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy: filters?.sortBy || 'latest',
    });
    if (filters?.category) query.set('category', filters.category);
    if (filters?.search) query.set('search', filters.search);

    const payload = await requestBrowserData<{ posts?: CommunityPost[]; total?: number }>(
        `/api/community/posts?${query.toString()}`,
        { method: 'GET', signal: options.signal },
        { fallbackMessage: '获取帖子失败' },
    );
    return {
        posts: payload.posts || [],
        total: payload.total || 0,
    };
}

export async function getPostDetail(postId: string, options: { signal?: AbortSignal } = {}): Promise<CommunityPostDetail | null> {
    const payload = await requestBrowserData<{
        post?: CommunityPost | null;
        comments?: CommunityComment[];
        viewer?: CommunityViewerState | null;
        viewerVotes?: {
            post?: VoteType | null;
            comments?: Record<string, VoteType> | null;
        } | null;
    }>(
        `/api/community/posts/${postId}`,
        { method: 'GET', signal: options.signal },
        { fallbackMessage: '获取帖子失败', allowNotFound: true },
    );

    if (!payload?.post) {
        return null;
    }

    return {
        post: payload.post,
        comments: payload.comments ?? [],
        viewer: payload.viewer ?? {
            isAuthenticated: false,
            isAuthor: false,
        },
        viewerVotes: {
            post: payload.viewerVotes?.post ?? null,
            comments: payload.viewerVotes?.comments ?? {},
        },
    };
}

/**
 * 创建帖子
 */
export async function createPost(input: PostInput): Promise<CommunityPost> {
    const payload = await requestBrowserData<CommunityPost>(
        '/api/community/posts',
        {
            method: 'POST',
            body: JSON.stringify({
                title: input.title,
                content: input.content,
                category: input.category || 'general',
                tags: input.tags || [],
            }),
        },
        { fallbackMessage: '创建帖子失败' },
    );
    return payload;
}

/**
 * 更新帖子
 */
export async function updatePost(postId: string, input: Partial<PostInput>): Promise<CommunityPost> {
    const payload = await requestBrowserData<CommunityPost>(
        `/api/community/posts/${postId}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
        { fallbackMessage: '更新帖子失败' },
    );
    return payload;
}

/**
 * 删除帖子（软删除）
 */
export async function deletePost(postId: string): Promise<void> {
    await requestBrowserData(
        `/api/community/posts/${postId}`,
        { method: 'DELETE' },
        { fallbackMessage: '删除帖子失败' },
    );
}

// =====================================================
// 评论 CRUD 操作
// =====================================================

/**
 * 创建评论
 */
export async function createComment(input: CommentInput): Promise<CommunityComment> {
    const payload = await requestBrowserData<CommunityComment>(
        '/api/community/comments',
        {
            method: 'POST',
            body: JSON.stringify({
                post_id: input.post_id,
                content: input.content,
                parent_id: input.parent_id || null,
            }),
        },
        { fallbackMessage: '创建评论失败' },
    );
    return payload;
}

/**
 * 删除评论（软删除）
 */
export async function deleteComment(commentId: string): Promise<void> {
    await requestBrowserData(
        `/api/community/comments/${commentId}`,
        { method: 'DELETE' },
        { fallbackMessage: '删除评论失败' },
    );
}

// =====================================================
// 投票功能
// =====================================================

/**
 * 投票（切换）
 */
export async function vote(
    targetType: TargetType,
    targetId: string,
    voteType: VoteType
): Promise<VoteType | null> {
    const payload = await requestBrowserData<{ vote: VoteType | null }>(
        '/api/community/votes',
        {
            method: 'POST',
            body: JSON.stringify({ targetType, targetId, voteType }),
        },
        { fallbackMessage: '投票失败' },
    );
    return payload.vote || null;
}

// =====================================================
// 举报功能
// =====================================================

/**
 * 提交举报
 */
export async function createReport(
    targetType: TargetType,
    targetId: string,
    reason: ReportReason,
    description?: string
): Promise<CommunityReport> {
    return await requestBrowserData<CommunityReport>(
        '/api/community/reports',
        {
            method: 'POST',
            body: JSON.stringify({ targetType, targetId, reason, description }),
        },
        { fallbackMessage: '提交举报失败' },
    );
}

// =====================================================
// 管理员功能
// =====================================================

/**
 * 管理员置顶帖子
 */
export async function adminPinPost(postId: string, isPinned: boolean): Promise<void> {
    await requestBrowserData(
        `/api/community/posts/${postId}/admin`,
        {
            method: 'PUT',
            body: JSON.stringify({ action: 'pin', value: isPinned }),
        },
        { fallbackMessage: '置顶帖子失败' },
    );
}

/**
 * 管理员设置精华帖子
 */
export async function adminFeaturePost(postId: string, isFeatured: boolean): Promise<void> {
    await requestBrowserData(
        `/api/community/posts/${postId}/admin`,
        {
            method: 'PUT',
            body: JSON.stringify({ action: 'feature', value: isFeatured }),
        },
        { fallbackMessage: '设置精华失败' },
    );
}

/**
 * 管理员删除帖子
 */
export async function adminDeletePost(postId: string): Promise<void> {
    await requestBrowserData(
        `/api/community/posts/${postId}/admin`,
        {
            method: 'PUT',
            body: JSON.stringify({ action: 'delete' }),
        },
        { fallbackMessage: '删除帖子失败' },
    );
}
