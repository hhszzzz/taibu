/**
 * 评论区域组件：评论列表、评论输入、评论项
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 有交互回调（onClick、onSubmit）
 */
'use client';

import { useState } from 'react';
import {
    MessageCircle,
    MessageSquare,
    Flag,
    Trash2,
    Send,
    MoreVertical,
} from 'lucide-react';
import { CommunityComment, VoteType } from '@/lib/community';
import { VoteButtons } from '@/components/community/PostActions';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { IconButton } from '@/components/ui/IconButton';

// =====================================================
// 评论项组件
// =====================================================
function CommentItem({
    comment,
    userId,
    isAdmin,
    userVotes,
    onVote,
    onReply,
    onDelete,
    onReport
}: {
    comment: CommunityComment & { isAuthor?: boolean; isPostAuthor?: boolean };
    userId: string | null;
    isAdmin: boolean;
    userVotes: Map<string, VoteType>;
    onVote: (commentId: string, voteType: VoteType) => void;
    onReply: (parentId: string) => void;
    onDelete: (commentId: string) => void;
    onReport: (commentId: string) => void;
}) {
    const isAuthor = comment.isAuthor === true;
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div className="group/comment relative">
            <div className="flex gap-3">
                <div className="flex flex-col items-center">
                    {comment.author_avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={comment.author_avatar_url}
                            alt={comment.author_name}
                            className="w-8 h-8 rounded-full object-cover border border-border/50 shadow-sm z-10"
                        />
                    ) : (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shadow-sm z-10 ${isAuthor ? 'bg-accent-soft text-accent' : 'bg-background-tertiary text-foreground-secondary'}`}>
                            {comment.author_name?.charAt(0) || '命'}
                        </div>
                    )}
                    {comment.replies && comment.replies.length > 0 && (
                        <div className="w-px h-full bg-border/50 my-1" />
                    )}
                </div>

                <div className="flex-1 min-w-0 pb-6">
                    <div className="bg-background-secondary/30 rounded-xl p-4 border border-border/50 hover:border-border transition-colors">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${comment.isPostAuthor ? 'text-accent' : 'text-foreground'}`}>
                                    {comment.author_name}
                                </span>
                                {comment.isPostAuthor && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-accent-soft text-accent rounded-full">
                                        楼主
                                    </span>
                                )}
                                <span className="text-xs text-foreground-secondary/70">
                                    {new Date(comment.created_at).toLocaleString()}
                                </span>
                            </div>
                            <div className="relative">
                                <IconButton
                                    label="评论操作"
                                    size="xs"
                                    className="opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100"
                                    onClick={() => setShowMenu(!showMenu)}
                                >
                                    <MoreVertical aria-hidden="true" />
                                </IconButton>
                                {showMenu && (
                                    <div className="absolute right-0 top-full mt-1 bg-background rounded-xl shadow-lg border border-border py-1 z-20 min-w-[120px] animate-in fade-in zoom-in-95 duration-200">
                                        {userId && (
                                            <Button unstyled
                                                onClick={() => { onReport(comment.id); setShowMenu(false); }}
                                                className="w-full px-4 py-2 text-left text-sm text-foreground-secondary hover:bg-background-secondary hover:text-foreground flex items-center gap-2 transition-colors"
                                            >
                                                <Flag className="w-4 h-4" /> 举报
                                            </Button>
                                        )}
                                        {(isAuthor || isAdmin) && (
                                            <Button unstyled
                                                onClick={() => { onDelete(comment.id); setShowMenu(false); }}
                                                className="w-full px-4 py-2 text-left text-sm text-danger hover:bg-danger/10 flex items-center gap-2 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" /> 删除
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-wrap mb-3">
                            {comment.content}
                        </p>

                        <div className="flex items-center gap-4">
                            <VoteButtons
                                upvotes={comment.upvote_count}
                                downvotes={comment.downvote_count}
                                userVote={userVotes.get(comment.id) || null}
                                onVote={(type) => onVote(comment.id, type)}
                            />
                            {userId && (
                                <Button variant="ghost" size="xs" onClick={() => onReply(comment.id)}>
                                    <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                    回复
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* 子回复 */}
                    {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-4 pl-2">
                            {comment.replies.map(reply => (
                                <CommentItem
                                    key={reply.id}
                                    comment={reply}
                                    userId={userId}
                                    isAdmin={isAdmin}
                                    userVotes={userVotes}
                                    onVote={onVote}
                                    onReply={onReply}
                                    onDelete={onDelete}
                                    onReport={onReport}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// =====================================================
// 评论区域
// =====================================================
export interface CommentSectionProps {
    comments: CommunityComment[];
    userId: string | null;
    isAdmin: boolean;
    userVotes: Map<string, VoteType>;
    replyTo: string | null;
    commentContent: string;
    submitting: boolean;
    onCommentContentChange: (content: string) => void;
    onReplyToChange: (parentId: string | null) => void;
    onSubmitComment: (e: React.FormEvent) => void;
    onVote: (commentId: string, voteType: VoteType) => void;
    onDeleteComment: (commentId: string) => void;
    onReportComment: (commentId: string) => void;
}

export function CommentSection({
    comments,
    userId,
    isAdmin,
    userVotes,
    replyTo,
    commentContent,
    submitting,
    onCommentContentChange,
    onReplyToChange,
    onSubmitComment,
    onVote,
    onDeleteComment,
    onReportComment,
}: CommentSectionProps) {
    return (
        <section>
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-accent" />
                全部评论 ({comments.length})
            </h3>

            {/* 评论输入框 */}
            <div className="bg-background-secondary/30 rounded-2xl p-4 mb-8 border border-border/50">
                {userId ? (
                    <form onSubmit={onSubmitComment}>
                        {replyTo && (
                            <div className="flex items-center justify-between bg-accent-soft px-3 py-2 rounded-lg mb-3 border border-accent/20">
                                <span className="text-sm text-accent font-medium">
                                    正在回复...
                                </span>
                                <IconButton label="取消回复" size="xs" onClick={() => onReplyToChange(null)}>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </IconButton>
                            </div>
                        )}
                        <div className="relative">
                            <Textarea
                                value={commentContent}
                                onChange={(e) => onCommentContentChange(e.target.value)}
                                rows={3}
                                className="resize-none rounded-xl border-border/50 bg-background p-4 shadow-sm"
                                placeholder={replyTo ? "写下你的回复..." : "分享你的看法..."}
                            />
                            <Button
                                type="submit"
                                size="sm"
                                aria-label="发表评论"
                                className="absolute right-3 bottom-3"
                                loading={submitting}
                                disabled={submitting || !commentContent.trim()}
                            >
                                {submitting ? null : <Send className="w-4 h-4" aria-hidden="true" />}
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="text-center py-6 text-foreground-secondary bg-background/50 rounded-xl border border-dashed border-border">
                        <p>登录后参与讨论</p>
                    </div>
                )}
            </div>

            {/* 评论列表 */}
            <div className="space-y-6">
                {comments.length === 0 ? (
                    <div className="text-center py-12 text-foreground-secondary/60">
                        <p>暂无评论，来坐沙发吧~</p>
                    </div>
                ) : (
                    comments.map(comment => (
                        <CommentItem
                            key={comment.id}
                            comment={comment}
                            userId={userId}
                            isAdmin={isAdmin}
                            userVotes={userVotes}
                            onVote={onVote}
                            onReply={(id) => onReplyToChange(id)}
                            onDelete={onDeleteComment}
                            onReport={onReportComment}
                        />
                    ))
                )}
            </div>
        </section>
    );
}
