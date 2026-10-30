/**
 * 帖子操作组件：投票按钮、举报模态框、编辑帖子模态框
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 有表单交互
 */
'use client';

import { useId, useState } from 'react';
import {
    ThumbsUp,
    ThumbsDown,
    Flag,
    Edit2,
    Trash2,
    Pin,
    Star,
} from 'lucide-react';
import { CommunityPost, VoteType, REPORT_REASONS, createReport, updatePost } from '@/lib/community';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { IconButton } from '@/components/ui/IconButton';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/components/ui/Dialog';

// =====================================================
// 投票按钮组件
// =====================================================
export function VoteButtons({
    upvotes,
    downvotes,
    userVote,
    onVote
}: {
    upvotes: number;
    downvotes: number;
    userVote: VoteType | null;
    onVote: (type: VoteType) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Button unstyled
                onClick={() => onVote('up')}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${userVote === 'up'
                    ? 'bg-success/10 text-success'
                    : 'text-foreground-secondary hover:text-success'
                    }`}
            >
                <ThumbsUp className="w-4 h-4" />
                <span className="text-sm">{upvotes}</span>
            </Button>
            <Button unstyled
                onClick={() => onVote('down')}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${userVote === 'down'
                    ? 'bg-danger/10 text-danger'
                    : 'text-foreground-secondary hover:text-danger'
                    }`}
            >
                <ThumbsDown className="w-4 h-4" />
                <span className="text-sm">{downvotes}</span>
            </Button>
        </div>
    );
}

// =====================================================
// 举报模态框
// =====================================================
export function ReportModal({
    targetType,
    targetId,
    onClose
}: {
    targetType: 'post' | 'comment';
    targetId: string;
    onClose: () => void;
}) {
    const { showToast } = useToast();
    const [reason, setReason] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const titleId = useId();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!reason) return;

        setLoading(true);
        try {
            await createReport(targetType, targetId, reason as typeof REPORT_REASONS[number]['value'], description);
            setSuccess(true);
            setTimeout(onClose, 1500);
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '提交举报失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog bare open onClose={onClose} busy={loading} labelledBy={titleId}
            className="dialog-plain dialog-md">
            <div className="w-full rounded-xl border border-border bg-background">
                <div className="border-b border-border p-4">
                    <h2 id={titleId} className="text-lg font-medium text-foreground">举报{targetType === 'post' ? '帖子' : '评论'}</h2>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {success ? (
                        <div className="text-success text-center py-4">
                            举报已提交，感谢您的反馈
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm text-foreground-secondary mb-2">举报原因 *</label>
                                <RadioGroup
                                    aria-label="举报原因"
                                    value={reason}
                                    onChange={setReason}
                                    options={REPORT_REASONS.map(item => ({ value: item.value, label: item.label }))}
                                    className="space-y-2"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-foreground-secondary mb-1">补充说明</label>
                                <Textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={3}
                                    className="resize-none rounded-lg bg-background-secondary px-3 py-2"
                                    placeholder="可选"
                                />
                            </div>

                            <div className="flex gap-2 pt-2">
                                <Button variant="ghost" className="flex-1" onClick={onClose}>
                                    取消
                                </Button>
                                <Button type="submit" variant="danger" className="flex-1" loading={loading} loadingText="提交中…" disabled={loading || !reason}>
                                    提交举报
                                </Button>
                            </div>
                        </>
                    )}
                </form>
            </div>
        </Dialog>
    );
}

// =====================================================
// 编辑帖子弹窗
// =====================================================
export function EditPostModal({
    post,
    onClose,
    onSave
}: {
    post: CommunityPost;
    onClose: () => void;
    onSave: (updatedPost: CommunityPost) => void;
}) {
    const [title, setTitle] = useState(post.title);
    const [content, setContent] = useState(post.content);
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const titleId = useId();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !content.trim()) return;

        setLoading(true);
        try {
            const updatedPost = await updatePost(post.id, { title, content });
            onSave({ ...post, ...updatedPost, title, content });
            onClose();
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '更新失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog bare open onClose={onClose} busy={loading} labelledBy={titleId}
            className="dialog-plain dialog-lg">
            <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-background">
                <div className="flex flex-shrink-0 items-center gap-3 border-b border-border/50 bg-accent-light p-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent shadow-inner">
                        <Edit2 className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 id={titleId} className="text-lg font-bold text-foreground">编辑讨论</h2>
                        <p className="text-xs text-foreground-secondary">完善你的观点，让讨论更精彩</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
                    <div>
                        <label className="block text-sm font-medium text-foreground-secondary mb-1.5 ml-1">标题</label>
                        <Input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="h-auto bg-background-secondary/50 border-border/50 px-4 py-3 font-medium hover:border-accent/40"
                            placeholder="请输入精炼的标题"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground-secondary mb-1.5 ml-1">内容</label>
                        <Textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={10}
                            className="resize-none rounded-xl bg-background-secondary/50 px-4 py-3 leading-relaxed"
                            placeholder="请输入详细内容"
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
                            取消
                        </Button>
                        <Button type="submit" size="lg" className="flex-1" loading={loading} loadingText="保存中…" disabled={!title.trim() || !content.trim()}>
                            保存修改
                        </Button>
                    </div>
                </form>
            </div>
        </Dialog>
    );
}

// =====================================================
// 帖子顶部导航栏（含编辑/删除/管理员操作）
// =====================================================
export interface PostNavBarProps {
    isAuthor: boolean;
    isAdmin: boolean;
    post: CommunityPost;
    onBack: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onAdminAction: (action: 'pin' | 'feature' | 'delete', value?: boolean) => void;
}

export function PostNavBar({
    isAuthor,
    isAdmin,
    post,
    onBack,
    onEdit,
    onDelete,
    onAdminAction,
}: PostNavBarProps) {
    return (
        <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50">
            <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
                <Button variant="ghost" className="-ml-2" onClick={onBack}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    <span className="font-medium">返回</span>
                </Button>

                {(isAuthor || isAdmin) && (
                    <div className="flex items-center gap-1">
                        <IconButton label="编辑" title="编辑" onClick={onEdit}>
                            <Edit2 aria-hidden="true" />
                        </IconButton>
                        <IconButton label="删除" title="删除" tone="danger" onClick={onDelete}>
                            <Trash2 aria-hidden="true" />
                        </IconButton>
                    </div>
                )}
                {isAdmin && (
                    <div className="flex items-center gap-1 ml-1 border-l border-border pl-1">
                        <IconButton label={post.is_pinned ? '取消置顶' : '置顶'} title={post.is_pinned ? '取消置顶' : '置顶'}
                            className={post.is_pinned ? 'text-warning bg-warning/10 hover:bg-warning/10 hover:text-warning' : 'hover:text-warning hover:bg-warning/10'}
                            onClick={() => onAdminAction('pin', !post.is_pinned)}>
                            <Pin aria-hidden="true" />
                        </IconButton>
                        <IconButton label={post.is_featured ? '取消精华' : '设为精华'} title={post.is_featured ? '取消精华' : '设为精华'}
                            className={post.is_featured ? 'text-accent bg-accent-soft hover:bg-accent-soft hover:text-accent' : 'hover:text-accent hover:bg-accent-soft'}
                            onClick={() => onAdminAction('feature', !post.is_featured)}>
                            <Star aria-hidden="true" />
                        </IconButton>
                    </div>
                )}
            </div>
        </div>
    );
}

// =====================================================
// 帖子底部操作栏（投票 + 举报）
// =====================================================
export interface PostFooterActionsProps {
    post: CommunityPost;
    postVote: VoteType | null;
    onVote: (type: VoteType) => void;
    onReport: () => void;
}

export function PostFooterActions({
    post,
    postVote,
    onVote,
    onReport,
}: PostFooterActionsProps) {
    return (
        <div className="flex items-center gap-6 mt-12 pt-6 border-t border-border/50">
            <VoteButtons
                upvotes={post.upvote_count}
                downvotes={post.downvote_count}
                userVote={postVote}
                onVote={onVote}
            />
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onReport}>
                <Flag size={16} aria-hidden="true" />举报
            </Button>
        </div>
    );
}
