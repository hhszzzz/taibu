/**
 * 发布新帖子页面
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect)
 * - 使用 useRouter 进行客户端导航
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { PostCategory, POST_CATEGORIES, createPost } from '@/lib/community';

export default function NewPostPage() {
    const router = useRouter();
    const { user, loading: sessionLoading } = useSessionSafe();
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [category, setCategory] = useState<PostCategory>('general');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!sessionLoading && !user) {
            router.push('/community');
        }
    }, [router, sessionLoading, user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !content.trim()) {
            setError('标题和内容不能为空');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const post = await createPost({
                title,
                content,
                category,
            });
            router.push(`/community/${post.id}`);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : '发帖失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    if (sessionLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <SoundWaveLoader variant="block" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center px-4">
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-5 py-4 text-sm text-warning">
                    {error || '认证失败，请返回社区后重试。'}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
            <div className="max-w-3xl mx-auto px-4 py-8 relative z-10">
                {/* Header */}
                <div className="mb-8">
                    <Button variant="ghost" className="mb-6 -ml-2" onClick={() => router.back()}>
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                        返回社区
                    </Button>

                    <h1 className="text-3xl font-semibold text-foreground mb-2">
                        发起新的讨论
                    </h1>
                    <p className="text-foreground-secondary/80 text-lg">
                        分享你的命理见解，或提出困扰你的问题
                    </p>
                </div>

                {/* Main Form Card */}
                <div className="border border-border bg-surface rounded-2xl shadow-sm overflow-hidden">

                    <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8">
                        {error && (
                            <div className="bg-danger/10 border border-danger/20 text-danger p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                                <span className="text-lg">⚠️</span>
                                <p>{error}</p>
                            </div>
                        )}

                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-foreground-secondary ml-1">
                                    话题分类
                                </label>
                                <Select
                                    value={category}
                                    onChange={setCategory}
                                    ariaLabel="话题分类"
                                    options={POST_CATEGORIES.map(cat => ({ value: cat.value, label: cat.label }))}
                                    className="w-full"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-foreground-secondary ml-1">
                                    发布身份
                                </label>
                                <div className="w-full bg-background/50 border border-border/50 rounded-xl px-4 py-3 text-foreground-secondary">
                                    社区将显示你的公开昵称
                                </div>
                                <p className="text-xs text-foreground-secondary/60 ml-1">
                                    如需修改显示名称，请前往账户页调整昵称
                                </p>
                            </div>
                        </div>

                        {/* Title */}
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-foreground-secondary ml-1">
                                标题 <span className="text-danger">*</span>
                            </label>
                            <Input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="h-auto border-border/50 bg-background/50 px-4 py-3 text-lg font-medium hover:border-accent/30"
                                placeholder="请用一两句话概括你的主题"
                                maxLength={100}
                            />
                        </div>

                        {/* Content */}
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-foreground-secondary ml-1">
                                内容详情 <span className="text-danger">*</span>
                            </label>
                            <div className="relative">
                                <Textarea
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={12}
                                    className="resize-none rounded-xl border-border/50 bg-background/50 p-4 leading-relaxed hover:border-accent/30"
                                    placeholder="请详细描述你的问题或观点，支持 Markdown 格式..."
                                />
                                <div className="absolute bottom-3 right-3 text-xs text-foreground-secondary/50 font-mono pointer-events-none">
                                    {content.length} 字
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-4 pt-4 border-t border-border/30">
                            <Button variant="secondary" size="lg" onClick={() => router.back()}>
                                取消
                            </Button>
                            <Button
                                type="submit"
                                size="lg"
                                className="flex-1"
                                loading={loading}
                                loadingText="发布中…"
                                disabled={loading || !title.trim() || !content.trim()}
                            >
                                发布帖子
                            </Button>
                        </div>
                    </form>
                </div>

                {/* Guidelines Tip */}
                <div className="mt-8 text-center text-sm text-foreground-secondary/60">
                    <p>发布即代表同意社区友好准则，请理性讨论</p>
                </div>
            </div>
        </div>
    );
}
