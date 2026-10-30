/**
 * 帖子详情页面
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect, useCallback)
 * - 使用 useRouter, useParams 进行客户端导航
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
    adminDeletePost,
    adminFeaturePost,
    adminPinPost,
    CommunityPost,
    CommunityComment,
    createComment,
    deleteComment,
    deletePost,
    getPostDetail,
    vote,
    VoteType,
} from '@/lib/community';
import { useSessionSafe } from '@/lib/hooks/session-context';
import { loadAdminClientAccessState } from '@/lib/admin/client';
import { useToast } from '@/components/ui/Toast';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { PostNavBar, ReportModal, EditPostModal } from '@/components/community/PostActions';
import { PostDetail } from '@/components/community/PostDetail';
import { CommentSection } from '@/components/community/CommentSection';

export default function PostDetailPage() {
    const params = useParams();
    const { user, loading } = useSessionSafe();
    return <PostDetailContent key={`${params.postId}:${loading}:${user?.id ?? ''}`} postId={params.postId as string} />;
}

function PostDetailContent({ postId }: { postId: string }) {
    const router = useRouter();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [post, setPost] = useState<CommunityPost | null>(null);
    const [comments, setComments] = useState<CommunityComment[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isAuthor, setIsAuthor] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [authResolved, setAuthResolved] = useState(false);
    const [userVotes, setUserVotes] = useState<Map<string, VoteType>>(new Map());
    const [postVote, setPostVote] = useState<VoteType | null>(null);
    const [commentContent, setCommentContent] = useState('');
    const [replyTo, setReplyTo] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment'; id: string } | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [confirmDeleteState, setConfirmDeleteState] = useState<{ type: 'comment' | 'post'; id?: string } | null>(null);
    const mounted = useRef(false);
    const pendingLoad = useRef<AbortController | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; pendingLoad.current?.abort(); };
    }, []);

    // 加载用户信息
    useEffect(() => {
        if (sessionLoading) return;
        let current = true;
        const checkAuth = async () => {
            try {
                if (user) {
                    try {
                        const access = await loadAdminClientAccessState();
                        if (!current) return;
                        setIsAdmin(access.isAdmin);
                    } catch (error) {
                        if (!current) return;
                        console.error('获取社区管理员状态失败:', error);
                        setIsAdmin(false);
                        showToast('error', error instanceof Error ? error.message : '管理员权限获取失败');
                    }
                } else {
                    setIsAdmin(false);
                }
            } catch (error) {
                if (!current) return;
                console.error('获取社区登录态失败:', error);
                setIsAdmin(false);
                showToast('error', error instanceof Error ? error.message : '认证状态获取失败');
            } finally {
                if (current) setAuthResolved(true);
            }
        };
        void checkAuth();
        return () => { current = false; };
    }, [showToast, user, sessionLoading]);

    // 加载帖子
    const loadPost = useCallback(async () => {
        pendingLoad.current?.abort();
        const controller = new AbortController();
        pendingLoad.current = controller;
        setLoading(true);
        try {
            const detail = await getPostDetail(postId, { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (!detail) {
                setPost(null);
                setComments([]);
                setIsAuthor(false);
                setPostVote(null);
                setUserVotes(new Map());
                setLoadError(null);
                return;
            }
            setPost(detail.post);
            setComments(detail.comments);
            setIsAuthor(detail.viewer.isAuthor);
            setPostVote(detail.viewerVotes.post);
            setUserVotes(new Map(Object.entries(detail.viewerVotes.comments)));
            setLoadError(null);
        } catch (error) {
            if (controller.signal.aborted) return;
            setPost(null);
            setComments([]);
            setIsAuthor(false);
            setPostVote(null);
            setUserVotes(new Map());
            setLoadError(error instanceof Error ? error.message : '获取帖子失败');
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [postId]);

    useEffect(() => {
        void loadPost();
    }, [loadPost]);

    // 投票
    const handleVote = async (targetType: 'post' | 'comment', targetId: string, voteType: VoteType) => {
        if (!user) {
            showToast('warning', '请先登录');
            return;
        }

        const currentVote = targetType === 'post' ? postVote : userVotes.get(targetId) || null;

        const calculateVoteChange = (current: VoteType | null, newVote: VoteType) => {
            let upChange = 0;
            let downChange = 0;

            if (current === newVote) {
                if (newVote === 'up') upChange = -1;
                else downChange = -1;
                return { upChange, downChange, resultVote: null };
            } else if (current === null) {
                if (newVote === 'up') upChange = 1;
                else downChange = 1;
                return { upChange, downChange, resultVote: newVote };
            } else {
                if (newVote === 'up') {
                    upChange = 1;
                    downChange = -1;
                } else {
                    upChange = -1;
                    downChange = 1;
                }
                return { upChange, downChange, resultVote: newVote };
            }
        };

        const { upChange, downChange, resultVote } = calculateVoteChange(currentVote, voteType);

        // 乐观更新 UI
        if (targetType === 'post' && post) {
            setPostVote(resultVote);
            setPost(prev => prev ? {
                ...prev,
                upvote_count: prev.upvote_count + upChange,
                downvote_count: prev.downvote_count + downChange,
            } : null);
        } else {
            setUserVotes(prev => {
                const newMap = new Map(prev);
                if (resultVote) {
                    newMap.set(targetId, resultVote);
                } else {
                    newMap.delete(targetId);
                }
                return newMap;
            });
            setComments(prev => updateCommentVotes(prev, targetId, upChange, downChange));
        }

        try {
            await vote(targetType, targetId, voteType);
        } catch (error) {
            if (!mounted.current) return;
            // 回滚
            if (targetType === 'post' && post) {
                setPostVote(currentVote);
                setPost(prev => prev ? {
                    ...prev,
                    upvote_count: prev.upvote_count - upChange,
                    downvote_count: prev.downvote_count - downChange,
                } : null);
            } else {
                setUserVotes(prev => {
                    const newMap = new Map(prev);
                    if (currentVote) {
                        newMap.set(targetId, currentVote);
                    } else {
                        newMap.delete(targetId);
                    }
                    return newMap;
                });
                setComments(prev => updateCommentVotes(prev, targetId, -upChange, -downChange));
            }
            showToast('error', error instanceof Error ? error.message : '投票失败');
        }
    };

    const updateCommentVotes = (
        commentList: CommunityComment[],
        targetId: string,
        upChange: number,
        downChange: number
    ): CommunityComment[] => {
        return commentList.map(comment => {
            if (comment.id === targetId) {
                return {
                    ...comment,
                    upvote_count: comment.upvote_count + upChange,
                    downvote_count: comment.downvote_count + downChange,
                };
            }
            if (comment.replies && comment.replies.length > 0) {
                return {
                    ...comment,
                    replies: updateCommentVotes(comment.replies, targetId, upChange, downChange),
                };
            }
            return comment;
        });
    };

    // 发表评论
    const handleComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentContent.trim() || !user) return;

        setSubmitting(true);
        try {
            const newComment = await createComment({
                post_id: postId,
                content: commentContent.trim(),
                parent_id: replyTo || undefined,
            });
            if (!mounted.current) return;
            setCommentContent('');

            if (replyTo) {
                setComments(prev => addReplyToComment(prev, replyTo, { ...newComment, replies: [] }));
            } else {
                setComments(prev => [...prev, { ...newComment, replies: [] }]);
            }
            setPost(prev => prev ? { ...prev, comment_count: prev.comment_count + 1 } : null);
            setReplyTo(null);
        } catch (err) {
            if (!mounted.current) return;
            showToast('error', err instanceof Error ? err.message : '发表评论失败，请重试');
        } finally {
            if (mounted.current) setSubmitting(false);
        }
    };

    const addReplyToComment = (
        commentList: CommunityComment[],
        parentId: string,
        newReply: CommunityComment
    ): CommunityComment[] => {
        return commentList.map(comment => {
            if (comment.id === parentId) {
                return {
                    ...comment,
                    replies: [...(comment.replies || []), { ...newReply, replies: [] }],
                };
            }
            if (comment.replies && comment.replies.length > 0) {
                return {
                    ...comment,
                    replies: addReplyToComment(comment.replies, parentId, newReply),
                };
            }
            return comment;
        });
    };

    const handleDeleteComment = async (commentId: string) => {
        if (!user) {
            showToast('warning', '请先登录');
            return;
        }

        try {
            await deleteComment(commentId);
            if (!mounted.current) return;
            setComments(prev => removeCommentFromList(prev, commentId));
            setPost(prev => prev ? { ...prev, comment_count: Math.max(0, prev.comment_count - 1) } : null);
            setConfirmDeleteState(null);
        } catch (error) {
            if (!mounted.current) return;
            showToast('error', error instanceof Error ? error.message : '删除评论失败');
        }
    };

    const removeCommentFromList = (commentList: CommunityComment[], commentId: string): CommunityComment[] => {
        return commentList.reduce<CommunityComment[]>((acc, comment) => {
            if (comment.id === commentId) {
                return acc;
            }
            const nextReplies = comment.replies?.length
                ? removeCommentFromList(comment.replies, commentId)
                : comment.replies;
            acc.push(nextReplies !== comment.replies ? { ...comment, replies: nextReplies } : comment);
            return acc;
        }, []);
    };

    const handleDeletePost = async () => {
        try {
            await deletePost(postId);
            if (!mounted.current) return;
            setConfirmDeleteState(null);
            router.push('/community');
        } catch (error) {
            if (!mounted.current) return;
            showToast('error', error instanceof Error ? error.message : '删除帖子失败');
        }
    };

    const handleAdminAction = async (action: 'pin' | 'feature' | 'delete', value?: boolean) => {
        try {
            if (action === 'pin') {
                await adminPinPost(postId, value === true);
            } else if (action === 'feature') {
                await adminFeaturePost(postId, value === true);
            } else {
                await adminDeletePost(postId);
                if (!mounted.current) return;
                router.push('/community');
                return;
            }
            if (mounted.current) await loadPost();
        } catch (error) {
            if (!mounted.current) return;
            showToast('error', error instanceof Error ? error.message : '管理员操作失败');
        }
    };

    if (loading || !authResolved) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <SoundWaveLoader variant="block" />
            </div>
        );
    }

    if (!post) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <p className="text-foreground-secondary mb-4">{loadError || '帖子不存在或已被删除'}</p>
                    <Button variant="secondary" onClick={() => { if (loadError) { void loadPost(); } else { router.push('/community'); } }}>
                        {loadError ? '重试' : '返回社区'}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <PostNavBar
                isAuthor={isAuthor}
                isAdmin={isAdmin}
                post={post}
                onBack={() => router.push('/community')}
                onEdit={() => setShowEditModal(true)}
                onDelete={() => setConfirmDeleteState({ type: 'post' })}
                onAdminAction={handleAdminAction}
            />

            <main className="max-w-3xl mx-auto px-4 py-8">
                <PostDetail
                    post={post}
                    postVote={postVote}
                    onVote={(type) => handleVote('post', post.id, type)}
                    onReport={() => setReportTarget({ type: 'post', id: post.id })}
                />

                <CommentSection
                    comments={comments}
                    userId={user?.id || null}
                    isAdmin={isAdmin}
                    userVotes={userVotes}
                    replyTo={replyTo}
                    commentContent={commentContent}
                    submitting={submitting}
                    onCommentContentChange={setCommentContent}
                    onReplyToChange={setReplyTo}
                    onSubmitComment={handleComment}
                    onVote={(id, type) => handleVote('comment', id, type)}
                    onDeleteComment={(id) => setConfirmDeleteState({ type: 'comment', id })}
                    onReportComment={(id) => setReportTarget({ type: 'comment', id })}
                />
            </main>

            {reportTarget && (
                <ReportModal
                    targetType={reportTarget.type}
                    targetId={reportTarget.id}
                    onClose={() => setReportTarget(null)}
                />
            )}
            {showEditModal && post && (
                <EditPostModal
                    post={post}
                    onClose={() => setShowEditModal(false)}
                    onSave={(updatedPost) => setPost(updatedPost)}
                />
            )}
            <ConfirmDialog
                isOpen={!!confirmDeleteState}
                onClose={() => setConfirmDeleteState(null)}
                onConfirm={() => confirmDeleteState?.type === 'comment'
                    ? handleDeleteComment(confirmDeleteState.id!)
                    : handleDeletePost()}
                title="确认删除"
                description={confirmDeleteState?.type === 'comment'
                    ? '确定要删除这条评论吗？此操作无法撤销。'
                    : '确定要删除这个帖子吗？此操作无法撤销。'}
                confirmText="确认删除"
                variant="danger"
            />
        </div>
    );
}
