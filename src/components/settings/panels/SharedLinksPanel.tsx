/**
 * 分享链接：列出当前账号仍公开的对话链接，可复制、打开或删除。
 *
 * 'use client' 标记说明：
 * - 需要会话状态、列表请求生命周期、剪贴板与删除确认
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { copyShareUrl, deleteConversationShare, fetchConversationShares } from '@/lib/chat/conversation-share-client';
import type { ConversationShareSummary } from '@/lib/chat/conversation-share';

const SHARE_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : SHARE_DATE_FORMAT.format(date);
}

// Results are tagged with their account so a switched session never shows the previous list.
type PanelState = { status: 'loading' } | { status: 'error'; userId: string } | { status: 'ready'; userId: string; shares: ConversationShareSummary[] };

export default function SharedLinksPanel() {
    const { user, loading: sessionLoading } = useSessionSafe();
    const { showToast } = useToast();
    const userId = user?.id ?? null;
    const [state, setState] = useState<PanelState>({ status: 'loading' });
    const [pendingDelete, setPendingDelete] = useState<ConversationShareSummary | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        fetchConversationShares()
            .then(shares => { if (!cancelled) setState({ status: 'ready', userId, shares }); })
            .catch(() => { if (!cancelled) setState({ status: 'error', userId }); });
        return () => { cancelled = true; };
    }, [userId, reload]);

    const retry = useCallback(() => { setState({ status: 'loading' }); setReload(value => value + 1); }, []);

    const copy = useCallback(async (share: ConversationShareSummary) => {
        if (await copyShareUrl(share.path)) showToast('success', '已复制公开链接');
        else showToast('error', '复制失败，请稍后重试');
    }, [showToast]);

    const confirmDelete = async () => {
        if (!pendingDelete || deleting) return;
        setDeleting(true);
        try {
            await deleteConversationShare(pendingDelete.conversationId);
            const removed = pendingDelete.conversationId;
            setState(current => current.status === 'ready' ? { ...current, shares: current.shares.filter(share => share.conversationId !== removed) } : current);
            setPendingDelete(null);
            showToast('success', '公开链接已删除，原链接将无法访问');
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '删除公开链接失败');
        } finally {
            setDeleting(false);
        }
    };

    const current = state.status !== 'loading' && state.userId === userId ? state : null;
    if (sessionLoading || (userId && !current)) {
        return (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-border bg-surface">
                <SoundWaveLoader variant="inline" />
            </div>
        );
    }

    if (!userId) return <SettingsLoginRequired title="请先登录后管理分享链接" />;

    if (current?.status === 'error') {
        return (
            <div role="alert" className="settings-alert">
                <span className="min-w-0 flex-1">读取分享链接失败。</span>
                <button type="button" onClick={retry}>重试</button>
            </div>
        );
    }

    const shares = current?.status === 'ready' ? current.shares : [];
    return (
        <div className="flex flex-col gap-3">
            {shares.length > 0 ? (
                <ul className="settings-list-card" aria-label="公开分享的对话">
                    {shares.map(share => (
                        <li key={share.token} className="settings-list-item items-center">
                            <div className="settings-list-item-text">
                                <strong className="truncate">
                                    <Link href={`/chat?id=${encodeURIComponent(share.conversationId)}`} className="hover:underline underline-offset-2">{share.title || '对话'}</Link>
                                </strong>
                                <p>更新于 {formatDate(share.updatedAt)}{share.includeCharts ? ' · 含命盘与工具结果' : ''}</p>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-1">
                                <button type="button" className="settings-icon-button" aria-label={`复制「${share.title}」的公开链接`} title="复制链接" onClick={() => { void copy(share); }}>
                                    <Copy size={16} aria-hidden="true" />
                                </button>
                                <a href={share.path} target="_blank" rel="noopener noreferrer" className="settings-icon-button" aria-label={`打开「${share.title}」的公开页面`} title="打开">
                                    <ExternalLink size={16} aria-hidden="true" />
                                </a>
                                <button type="button" className="settings-icon-button settings-icon-button-danger" aria-label={`删除「${share.title}」的公开链接`} title="删除链接" disabled={deleting} onClick={() => setPendingDelete(share)}>
                                    <Trash2 size={16} aria-hidden="true" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-hover px-6 py-9 text-center">
                    <p className="text-sm text-foreground-secondary">还没有公开分享的对话</p>
                    <p className="text-xs text-foreground-tertiary">在对话页右上角点「分享」即可创建只读链接。</p>
                </div>
            )}
            <ConfirmDialog
                isOpen={pendingDelete !== null}
                onClose={() => { if (!deleting) setPendingDelete(null); }}
                onConfirm={confirmDelete}
                loading={deleting}
                title="删除公开链接"
                description={`删除后，“${pendingDelete?.title ?? '对话'}”的公开链接立即失效，已分享出去的地址将无法访问。对话本身不受影响。`}
                confirmText="删除链接"
            />
        </div>
    );
}
