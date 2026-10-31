/**
 * 会话头部「分享」浮层内容：公开只读链接（创建 / 复制 / 更新 / 删除）与导出。
 *
 * 'use client' 标记说明：
 * - 打开时读取链接状态，按钮操作需要本地状态、剪贴板与 Toast
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { MenuCheckboxItem, MenuItem, MenuSeparator } from '@/components/ui/Menu';
import { copyShareUrl, deleteConversationShare, fetchConversationShare, saveConversationShare } from '@/lib/chat/conversation-share-client';
import type { ConversationShareState } from '@/lib/chat/conversation-share';
import type { ConversationExportFormat } from '@/lib/chat/conversation-export';

type ShareMenuStatus = 'loading' | 'ready' | 'error';

interface ShareConversationMenuProps {
    conversationId: string | null;
    /** A queued or running task freezes the transcript; sharing waits for it. */
    taskActive: boolean;
    /** 分享开关关闭时只保留导出，不再读写公开链接。 */
    shareLinksEnabled?: boolean;
    exportBusy: ConversationExportFormat | null;
    onExport: (format: ConversationExportFormat) => void;
    onClose: () => void;
}

export function ShareConversationMenu({ conversationId, taskActive, shareLinksEnabled = true, exportBusy, onExport, onClose }: ShareConversationMenuProps) {
    const { showToast } = useToast();
    const [status, setStatus] = useState<ShareMenuStatus>('loading');
    const [share, setShare] = useState<ConversationShareState | null>(null);
    const [includeCharts, setIncludeCharts] = useState(false);
    const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const requestSequence = useRef(0);

    const load = useCallback(async (id: string) => {
        const sequence = ++requestSequence.current;
        setStatus('loading');
        setShare(null);
        setIncludeCharts(false);
        setConfirmDelete(false);
        setBusy(null);
        try {
            const current = await fetchConversationShare(id);
            if (sequence !== requestSequence.current) return;
            setShare(current);
            setIncludeCharts(current?.includeCharts ?? false);
            setStatus('ready');
        } catch {
            if (sequence === requestSequence.current) setStatus('error');
        }
    }, []);

    useEffect(() => {
        if (!conversationId || !shareLinksEnabled) return;
        void load(conversationId);
        return () => { requestSequence.current += 1; };
    }, [conversationId, load, shareLinksEnabled]);

    const save = async () => {
        if (!conversationId || busy) return;
        const sequence = ++requestSequence.current;
        setBusy('save');
        try {
            const next = await saveConversationShare(conversationId, includeCharts);
            if (sequence !== requestSequence.current) return;
            const created = !share;
            setShare(next);
            if (created) {
                const copied = await copyShareUrl(next.path);
                if (sequence !== requestSequence.current) return;
                showToast('success', copied ? '已创建公开链接并复制' : '已创建公开链接');
            } else {
                showToast('success', '公开链接已更新为当前对话');
            }
        } catch (error) {
            if (sequence === requestSequence.current) showToast('error', error instanceof Error ? error.message : '更新公开链接失败');
        } finally {
            if (sequence === requestSequence.current) setBusy(null);
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
        const sequence = ++requestSequence.current;
        setBusy('delete');
        try {
            await deleteConversationShare(conversationId);
            if (sequence !== requestSequence.current) return;
            setShare(null);
            setConfirmDelete(false);
            showToast('success', '公开链接已删除，原链接将无法访问');
        } catch (error) {
            if (sequence === requestSequence.current) showToast('error', error instanceof Error ? error.message : '删除公开链接失败');
        } finally {
            if (sequence === requestSequence.current) setBusy(null);
        }
    };

    if (!conversationId) return <p className="chat-header-menu-note">新对话保存后可以分享。</p>;

    const locked = taskActive || busy !== null;
    return <>
        {shareLinksEnabled ? <>
            {status === 'loading' && <p className="chat-header-menu-note">正在读取分享状态…</p>}
            {status === 'error' && <>
                <p className="chat-header-menu-note">读取分享状态失败。</p>
                <MenuItem className="chat-header-menu-item" onClick={() => { void load(conversationId); }}>
                    <RefreshCw size={15} aria-hidden="true" />重试
                </MenuItem>
            </>}
            {status === 'ready' && <>
                <p className="chat-header-menu-note">
                    {taskActive ? '任务进行中，完成后可以分享。'
                        : share ? '持有链接的任何人都能查看这份只读快照；之后的新消息需「更新链接」才会出现。'
                            : '创建只读快照链接，持有链接的任何人都可以查看。'}
                </p>
                {share ? <>
                    <MenuItem className="chat-header-menu-item" closeOnClick={false} disabled={busy !== null} onClick={() => { void copy(); }}>
                        <Link2 size={15} aria-hidden="true" />复制公开链接
                    </MenuItem>
                    <MenuItem className="chat-header-menu-item" closeOnClick={false} disabled={locked} onClick={() => { void save(); }}>
                        <RefreshCw size={15} aria-hidden="true" />{busy === 'save' ? '正在更新…' : '更新链接'}
                    </MenuItem>
                    <MenuItem tone="danger" className="chat-header-menu-item" closeOnClick={false} disabled={busy !== null} onClick={() => { void remove(); }}>
                        <Trash2 size={15} aria-hidden="true" />{busy === 'delete' ? '正在删除…' : confirmDelete ? '确认删除链接' : '删除链接'}
                    </MenuItem>
                </> : <MenuItem className="chat-header-menu-item" closeOnClick={false} disabled={locked} onClick={() => { void save(); }}>
                    <Link2 size={15} aria-hidden="true" />{busy === 'save' ? '正在创建…' : '创建公开链接'}
                </MenuItem>}
                <MenuCheckboxItem className="chat-header-menu-item" checked={includeCharts} closeOnClick={false}
                    disabled={locked} onCheckedChange={setIncludeCharts}>
                    包含命盘与工具结果
                </MenuCheckboxItem>
            </>}
        </> : null}
        {shareLinksEnabled ? <MenuSeparator /> : null}
        <MenuItem className="chat-header-menu-item" disabled={exportBusy !== null} onClick={() => { onClose(); onExport('md'); }}>导出 Markdown</MenuItem>
        <MenuItem className="chat-header-menu-item" disabled={exportBusy !== null} onClick={() => { onClose(); onExport('html'); }}>导出 HTML</MenuItem>
    </>;
}
