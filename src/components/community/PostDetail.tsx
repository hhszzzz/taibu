/**
 * 帖子详情展示组件
 *
 * 'use client' 标记说明：
 * - 作为客户端页面的子组件使用
 */
'use client';

import { Pin, Star } from 'lucide-react';
import { CommunityPost, VoteType } from '@/lib/community';
import { PostFooterActions } from '@/components/community/PostActions';

export interface PostDetailProps {
    post: CommunityPost;
    postVote: VoteType | null;
    onVote: (type: VoteType) => void;
    onReport: () => void;
}

export function PostDetail({
    post,
    postVote,
    onVote,
    onReport,
}: PostDetailProps) {
    return (
        <article className="mb-12 animate-fade-in-up">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                    {post.is_pinned && (
                        <span className="bg-warning/10 text-warning px-2.5 py-0.5 rounded-full text-xs font-medium border border-warning/20 flex items-center gap-1">
                            <Pin className="w-3 h-3" /> 置顶
                        </span>
                    )}
                    {post.is_featured && (
                        <span className="bg-accent-soft text-accent px-2.5 py-0.5 rounded-full text-xs font-medium border border-accent/20 flex items-center gap-1">
                            <Star className="w-3 h-3" /> 精华
                        </span>
                    )}
                    <span className="text-xs text-foreground-secondary bg-background-secondary px-2 py-0.5 rounded-full">
                        {new Date(post.created_at).toLocaleDateString()}
                    </span>
                </div>

                <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/80 mb-6 leading-tight">
                    {post.title}
                </h1>

                <div className="flex items-center justify-between border-b border-border/50 pb-6">
                    <div className="flex items-center gap-3">
                        {post.author_avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={post.author_avatar_url}
                                alt={post.author_name}
                                className="w-10 h-10 rounded-full object-cover border border-border/50 shadow-md"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-on-accent text-lg font-medium shadow-md">
                                {post.author_name?.charAt(0) || '命'}
                            </div>
                        )}
                        <div>
                            <div className="font-medium text-foreground">{post.author_name}</div>
                            <div className="text-xs text-foreground-secondary">楼主</div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="prose dark:prose-invert max-w-none text-foreground/90 leading-loose text-lg whitespace-pre-wrap">
                {post.content}
            </div>

            <PostFooterActions
                post={post}
                postVote={postVote}
                onVote={onVote}
                onReport={onReport}
            />
        </article>
    );
}
