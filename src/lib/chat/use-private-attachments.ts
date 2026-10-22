'use client';
import { useRef, useState } from 'react';
import type { AttachmentState, PrivateAttachment } from '@/types';
import { documentFileProblem } from '@/lib/chat/composer-files';

export async function prepareImage(file: File): Promise<File> {
    if (file.size > 10 * 1024 * 1024) throw new Error('图片原始文件不能超过 10MB');
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > 40_000_000) throw new Error('图片尺寸过大');
        const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法处理图片');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法处理图片')), 'image/jpeg', .88));
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } finally { bitmap.close(); }
}

export function usePrivateAttachments({ scopeKey, state, change, onError }: {
    scopeKey: string; state: AttachmentState; change: (state: AttachmentState) => void; onError: (message: string) => void;
}) {
    const latest = useRef({ scopeKey, state, change, onError });
    latest.current = { scopeKey, state, change, onError };
    const busyRef = useRef(false);
    const [uploadingScope, setUploadingScope] = useState<string | null>(null);
    async function upload(files: File[]) {
        if (busyRef.current || !files.length) return;
        const scope = latest.current.scopeKey;
        const initial = latest.current.state.uploaded ?? [];
        const images = files.filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name));
        if (initial.filter(item => item.kind === 'image').length + images.length > 4) { latest.current.onError('每条消息最多 4 张图片'); return; }
        if (initial.length + files.length > 12) { latest.current.onError('每条消息最多 12 份资料'); return; }
        busyRef.current = true; setUploadingScope(scope);
        try {
            for (let file of files) {
                if (latest.current.scopeKey !== scope) break;
                if (images.includes(file)) file = await prepareImage(file);
                else {
                    // The server reads the document's text as it stores it.
                    const problem = documentFileProblem(file);
                    if (problem) throw new Error(`${file.name}：${problem}`);
                }
                if (latest.current.scopeKey !== scope) break;
                const form = new FormData(); form.append('file', file);
                const response = await fetch('/api/agent/attachments', { method: 'POST', body: form });
                const result = await response.json() as { attachment?: PrivateAttachment; error?: string };
                if (!response.ok || !result.attachment) throw new Error(result.error || '上传资料失败');
                if (latest.current.scopeKey !== scope) break; // An unbound upload is reclaimed after 24h.
                const current = latest.current.state;
                const next = { ...current, uploaded: [...current.uploaded ?? [], result.attachment] };
                latest.current.state = next;
                latest.current.change(next);
            }
        } catch (error) { if (latest.current.scopeKey === scope) latest.current.onError(error instanceof Error ? error.message : '上传资料失败'); }
        finally { busyRef.current = false; setUploadingScope(null); }
    }
    return { upload, uploading: uploadingScope === scopeKey };
}
