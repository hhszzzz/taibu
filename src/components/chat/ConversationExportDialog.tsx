'use client';
// 'use client'：导出对话框监听全局导出事件并处理下载状态

import { useEffect, useId, useState } from 'react';
import { FileCode2, FileText, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { CONVERSATION_EXPORT_EVENT, downloadConversationExport, type ConversationExportFormat } from '@/lib/chat/conversation-export';

/** Download state shared by the export dialog and the workspace overview; failures surface as a toast. */
export function useConversationExport(conversationId: string) {
    const [tools, setTools] = useState(false);
    const [busy, setBusy] = useState<ConversationExportFormat | null>(null);
    const { showToast } = useToast();
    /** Resolves true once the file was handed to the browser. */
    const download = async (format: ConversationExportFormat): Promise<boolean> => {
        setBusy(format);
        try {
            await downloadConversationExport(conversationId, format, tools);
            return true;
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '导出失败，请重试');
            return false;
        } finally { setBusy(null); }
    };
    return { tools, setTools, busy, download };
}

/** Export dialog for the saved conversation, opened by the header, the slash command or the workspace menu. */
export function ConversationExportDialog({ conversationId }: { conversationId: string }) {
    const [open, setOpen] = useState(false);
    const { tools, setTools, busy, download: save } = useConversationExport(conversationId);
    const titleId = useId();
    useEffect(() => {
        const show = () => setOpen(true);
        window.addEventListener(CONVERSATION_EXPORT_EVENT, show);
        return () => window.removeEventListener(CONVERSATION_EXPORT_EVENT, show);
    }, []);
    const download = async (format: ConversationExportFormat) => { if (await save(format)) setOpen(false); };
    return <Modal open={open} onClose={() => setOpen(false)} busy={busy !== null} labelledBy={titleId} className="chat-export-dialog">
        <div className="chat-dialog-heading">
            <h2 id={titleId}>导出对话</h2>
            <button type="button" className="chat-header-icon" aria-label="关闭导出" disabled={busy !== null} onClick={() => setOpen(false)}><X size={17} /></button>
        </div>
        <p className="chat-dialog-description">包含当前分支的正文、命盘依据和来源。HTML 可在浏览器中打印为 PDF。</p>
        <div className="chat-export-options">
            <button type="button" disabled={busy !== null} onClick={() => void download('md')}>
                <FileText size={18} aria-hidden="true" /><span><strong>Markdown</strong><small>{busy === 'md' ? '正在导出…' : '适合继续编辑或存档'}</small></span>
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void download('html')}>
                <FileCode2 size={18} aria-hidden="true" /><span><strong>可打印 HTML</strong><small>{busy === 'html' ? '正在导出…' : '排版与工作区一致，可打印'}</small></span>
            </button>
        </div>
        <label className="chat-export-tools"><input type="checkbox" checked={tools} disabled={busy !== null} onChange={event => setTools(event.target.checked)} />包含工具调用参数与原始结果</label>
    </Modal>;
}
