'use client';
// 'use client'：附件预览需要弹窗状态与浏览器内的私有资料请求

import { useEffect, useState } from 'react';
import { FileText, ImageIcon, X } from 'lucide-react';
import type { PrivateAttachment } from '@/types';
import { Modal } from '@/components/ui/Modal';
import './attachments.css';
import Image from 'next/image';

const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const typeLabel = (name: string) => name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'TXT';

export function PrivateAttachments({ ids, items, onRemove, disabled }: {
    ids?: string[]; items?: PrivateAttachment[]; onRemove?: (id: string) => void; disabled?: boolean;
}) {
    const [selected, setSelected] = useState<string | null>(null);
    const all: Array<Pick<PrivateAttachment, 'id' | 'name' | 'kind'> & { size?: number }> = items ?? (ids ?? []).map(id => ({ id, name: '资料预览', kind: 'text' as const }));
    if (!all.length) return null;
    return <div className="agent-attachments">{all.map(item => <div key={item.id} className="agent-attachment-chip">
        <button type="button" onClick={() => setSelected(item.id)} aria-label={`预览 ${item.name}`}>
            {item.kind === 'image' && items
                ? <Image unoptimized width={36} height={36} src={`/api/agent/attachments/${item.id}?content=1`} alt="" className="agent-attachment-thumb" />
                : <span className="agent-attachment-type" aria-hidden="true">{item.kind === 'image' ? <ImageIcon size={16} /> : items ? typeLabel(item.name) : <FileText size={16} />}</span>}
            <span className="agent-attachment-name">{item.name}{item.size ? <small> · {sizeLabel(item.size)}</small> : null}</span>
        </button>
        {onRemove && <button type="button" aria-label={`移除 ${item.name}`} disabled={disabled} onClick={() => onRemove(item.id)}><X size={14} /></button>}
    </div>)}{selected && <PrivateAttachmentPreview key={selected} id={selected} onClose={() => setSelected(null)} />}</div>;
}
export function PrivateAttachmentPreview({ id, onClose, inline = false }: { id: string; onClose?: () => void; inline?: boolean }) {
    const [metadata, setMetadata] = useState<PrivateAttachment | null>(null);
    const [text, setText] = useState('');
    const [offset, setOffset] = useState<number | null>(0);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/agent/attachments/${id}`, { signal: controller.signal }).then(async response => {
            const data = await response.json(); if (!response.ok) throw new Error(data.error || '无法预览资料'); setMetadata(data.attachment);
        }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
        return () => controller.abort();
    }, [id]);
    useEffect(() => {
        if (metadata?.kind !== 'text') return;
        const controller = new AbortController();
        void fetch(`/api/agent/attachments/${id}?content=1&offset=0`, { signal: controller.signal }).then(async response => {
            const data = await response.json(); if (!response.ok) throw new Error(data.error || '无法读取资料'); setText(data.text); setOffset(data.nextOffset);
        }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
        return () => controller.abort();
    }, [id, metadata?.kind]);
    async function more() {
        if (busy || offset === null || text.length >= 128_000) return;
        setBusy(true);
        try { const response = await fetch(`/api/agent/attachments/${id}?content=1&offset=${offset}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || '读取失败'); setText(value => value + data.text); setOffset(data.nextOffset); }
        catch (error) { setError(error instanceof Error ? error.message : '读取失败'); }
        finally { setBusy(false); }
    }
    const content = <><div className="flex items-center justify-between"><h2 id={`attachment-preview-${id}`}>{metadata?.name ?? '资料预览'}</h2>{onClose && <button type="button" onClick={onClose} aria-label="关闭资料预览"><X size={18} /></button>}</div>{error && <p role="alert">{error}</p>}{metadata?.kind === 'image' ? <Image unoptimized width={metadata.width ?? 2048} height={metadata.height ?? 2048} src={`/api/agent/attachments/${id}?content=1`} alt={metadata.name} className="max-h-[65dvh] w-full object-contain" /> : <pre className="my-4 max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words text-sm">{text || '正在读取…'}</pre>}{metadata?.kind === 'text' && offset !== null && text.length < 128_000 && <button type="button" disabled={busy} onClick={() => void more()} className="agent-secondary-button">{busy ? '正在读取' : '继续读取'}</button>}</>;
    return inline ? <section>{content}</section> : <Modal open onClose={onClose ?? (() => {})} labelledBy={`attachment-preview-${id}`} className="agent-question-dialog">{content}</Modal>;
}
