'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { requestBrowserJson } from '@/lib/browser-api';
export function AnalysisMethodPicker({ onSelect }: { onSelect: (text:string) => void }) {
    const [open,setOpen]=useState(false);
    const [methods,setMethods]=useState<Array<{id:string;title:string;version:string;description:string}>>([]);
    const [error,setError]=useState('');
    useEffect(() => { const show=() => setOpen(true); window.addEventListener('taibu:methods',show); return () => window.removeEventListener('taibu:methods',show); },[]);
    useEffect(() => { if (!open) return; const controller=new AbortController(); void requestBrowserJson<{methods:typeof methods}>('/api/agent/methods',{signal:controller.signal}).then(result => { if (!controller.signal.aborted) { setMethods(result.data?.methods ?? []); setError(result.error?.message ?? ''); } }).catch(() => { if (!controller.signal.aborted) setError('读取分析方法失败，请重试'); }); return () => controller.abort(); },[open]);
    return <Modal open={open} onClose={() => setOpen(false)} labelledBy="analysis-method-title" className="agent-question-dialog"><h2 id="analysis-method-title">选择分析方法</h2><p className="text-sm text-foreground-secondary my-3">按需加载方法，排盘继续使用太卜 Core。</p>{error && <p role="alert">{error}</p>}{methods.map(method => <button key={method.id} type="button" className="block w-full p-3 border-b border-border text-left" onClick={() => { onSelect(`请使用 ${method.title} 方法（${method.id}@${method.version}）分析。`); setOpen(false); }}><strong className="text-sm">{method.title}</strong><span className="block text-xs text-foreground-secondary">{method.description} · {method.version}</span></button>)}</Modal>;
}
