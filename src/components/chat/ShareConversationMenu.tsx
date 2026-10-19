/**
 * 会话头部「分享」浮层内容：公开只读链接（创建 / 复制 / 更新 / 删除）与导出。
 *
 * 'use client' 标记说明：
 * - 打开时读取链接状态，按钮操作需要本地状态、剪贴板与 Toast
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { copyShareUrl, deleteConversationShare, fetchConversationShare, saveConversationShare } from '@/lib/chat/conversation-share-client';
import type { ConversationShareState } from '@/lib/chat/conversation-share';
import type { ConversationExportFormat } from '@/lib/chat/conversation-export';

type ShareMenuStatus = 'loading' | 'ready' | 'error';

interface ShareConversationMenuProps {
    conversationId: string | null;
    /** A queued or running task freezes the transcript; sharing waits for it. */
    taskActive: boolean;
    exportBusy: ConversationExportFormat | null;
    onExport: (format: ConversationExportFormat) => void;
    onClose: () => void;
}

export function ShareConversationMenu({ conversationId, taskActive, exportBusy, onExport, onClose }: ShareConversationMenuProps) {
    const { showToast } = useToast();
    const [status, setStatus] = useState<ShareMenuStatus>('loading');
    const [share, setShare] = useState<ConversationShareState | null>(null);
    const [includeCharts, setIncludeCharts] = useState(false);
    const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const load = useCallback(async (id: string, signal: { cancelled: boolean }) => {
        setStatus('loading');
        try {
            const current = await fetchConversationShare(id);
            if (signal.cancelled) return;
            setShare(current);
            setIncludeCharts(current?.includeCharts ?? false);
            setStatus('ready');
        } catch {
            if (!signal.cancelled) setStatus('error');
        }
    }, []);

    useEffect(() => {
        if (!conversationId) return;
        const signal = { cancelled: false };
        void load(conversationId, signal);
        return () => { signal.cancelled = true; };
    }, [conversationId, load]);

    const save = async () => {
        if (!conversationId || busy) return;
        setBusy('save');
        try {
            const next = await saveConversationShare(conversationId, includeCharts);
            const created = !share;
            setShare(next);
            if (created) {
                const copied = await copyShareUrl(next.path);
                showToast('success', copied ? '已创建公开链接并复制' : '已创建公开链接');
            } else {
                showToast('success', '公开链接已更新为当前对话');
            }
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '更新公开链接失败');
        } finally {
            setBusy(null);
        }
    };

    const copy = async () => {
        if (!share) return;
        if (await copyShareUrl(share.path)) { showToast('success', '已复制公开链接'); onClose(); }
        else showToast('error', '复制失败，请稍后重试');
    };

    const remove = async () => {
        if (!conversationId || busy) return;
        if (!confirmDelete) { setConfirmDelete(true); return; }
        setBusy('delete');
        try {
            await deleteConversationShare(conversationId);
            setShare(null);
            setConfirmDelete(false);
            showToast('success', '公开链接已删除，原链接将无法访问');
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '删除公开链接失败');
        } finally {
            setBusy(null);
        }
    };

    if (!conversationId) return <p className="chat-header-menu-note">新对话保存后可以分享。</p>;

    const locked = taskActive || busy !== null;
    return <>
        {status === 'loading' && <p className="chat-header-menu-note">正在读取分享状态…</p>}
        {status === 'error' && <>
            <p className="chat-header-menu-note">读取分享状态失败。</p>
            <button type="button" role="menuitem" onClick={() => { void load(conversationId, { cancelled: false }); }}>
                <RefreshCw size={15} aria-hidden="true" />重试
            </button>
        </>}
        {status === 'ready' && <>
            <p className="chat-header-menu-note">
                {taskActive ? '任务进行中，完成后可以分享。'
                    : share ? '持有链接的任何人都能查看这份只读快照；之后的新消息需「更新链接」才会出现。'
                        : '创建只读快照链接，持有链接的任何人都能查看。'}
            </p>
            {share ? <>
                <button type="button" role="menuitem" disabled={busy !== null} onClick={() => { void copy(); }}>
                    <Link2 size={15} aria-hidden="true" />复制公开链接
                </button>
                <button type="button" role="menuitem" disabled={locked} onClick={() => { void save(); }}>
                    <RefreshCw size={15} aria-hidden="true" />{busy === 'save' ? '正在更新…' : '更新链接'}
                </button>
                <button type="button" role="menuitem" className="is-danger" disabled={busy !== null} onClick={() => { void remove(); }}>
                    <Trash2 size={15} aria-hidden="true" />{busy === 'delete' ? '正在删除…' : confirmDelete ? '确认删除链接' : '删除链接'}
                </button>
            </> : <button type="button" role="menuitem" disabled={locked} onClick={() => { void save(); }}>
                <Link2 size={15} aria-hidden="true" />{busy === 'save' ? '正在创建…' : '创建公开链接'}
            </button>}
            <label className="chat-header-menu-check-row">
                <input type="checkbox" checked={includeCharts} disabled={locked} onChange={event => setIncludeCharts(event.target.checked)} />
                包含命盘与工具结果
            </label>
        </>}
        <div className="chat-header-menu-divider" role="separator" />
        <button type="button" role="menuitem" disabled={exportBusy !== null} onClick={() => { onClose(); onExport('md'); }}>导出 Markdown</button>
        <button type="button" role="menuitem" disabled={exportBusy !== null} onClick={() => { onClose(); onExport('html'); }}>导出 HTML</button>
    </>;
}
