'use client';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Expand, X } from 'lucide-react';
import type { ThemedToken } from 'shiki';
import { Modal } from './Modal';
import { useTheme } from './ThemeProvider';
import { useToast } from './Toast';
import { tableCsv } from '@/lib/chat/markdown-blocks';

const highlighted = new Map<string, ThemedToken[][]>();
const highlightSizes = new Map<string, number>();
let highlightedBytes = 0;
export const HighlightedCode = memo(function HighlightedCode({ code, language }: { code: string; language: string }) {
    const { theme } = useTheme();
    const [result, setResult] = useState<{ key: string; tokens: ThemedToken[][] } | null>(null);
    const key = `${theme}:${language}:${code}`;
    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!language || code.length > 100_000) return;
            let tokens = highlighted.get(key);
            if (!tokens) {
                const shiki = await import('shiki/bundle/web');
                if (!(language in shiki.bundledLanguages)) return;
                tokens = (await shiki.codeToTokens(code, { lang: language as Parameters<typeof shiki.codeToTokens>[1]['lang'], theme: theme === 'dark' ? 'github-dark' : 'github-light' })).tokens;
                const size = key.length * 2 + tokens.flat().reduce((total, token) => total + token.content.length * 2 + 96, 0);
                if (size <= 4 * 1024 * 1024) {
                    while (highlighted.size && (highlighted.size >= 128 || highlightedBytes + size > 4 * 1024 * 1024)) {
                        const oldest = highlighted.keys().next().value!;
                        highlightedBytes -= highlightSizes.get(oldest) ?? 0;
                        highlighted.delete(oldest); highlightSizes.delete(oldest);
                    }
                    highlighted.set(key, tokens); highlightSizes.set(key, size); highlightedBytes += size;
                }
            }
            if (!cancelled) setResult({ key, tokens });
        }
        const timer = setTimeout(() => { void load().catch(() => undefined); }, 80);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [code, language, theme, key]);
    return <code className="markdown-code">{result?.key === key ? result.tokens.map((line, i) => <span key={i}>{line.map((token, j) => <span key={j} style={{ color: token.color }}>{token.content}</span>)}{i < result.tokens.length - 1 ? '\n' : ''}</span>) : code}</code>;
});

/** Fenced code: language label and a copy button whose icon turns into a check (no toast on success). */
export function CodeBlock({ code, language }: { code: string; language: string }) {
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);
    const copy = async () => {
        try { await navigator.clipboard.writeText(code.replace(/\n$/, '')); setCopied(true); }
        catch { showToast('error', '复制失败'); }
    };
    return <div className="markdown-code-frame">
        <div className="markdown-code-head">
            <span>{language || '代码'}</span>
            <button type="button" onClick={() => void copy()} aria-label={copied ? '已复制代码' : '复制代码'}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
        </div>
        <HighlightedCode code={code} language={language} />
    </div>;
}

export function MarkdownTable({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLTableElement>(null);
    const [open, setOpen] = useState(false);
    const { showToast } = useToast();
    const rows = () => Array.from(ref.current?.rows ?? []).map(row => Array.from(row.cells).map(cell => cell.textContent ?? ''));
    const copy = async () => { try { await navigator.clipboard.writeText(rows().map(row => row.join('\t')).join('\n')); showToast('success', '已复制表格'); } catch { showToast('error', '复制失败'); } };
    const csv = () => {
        const url = URL.createObjectURL(new Blob([tableCsv(rows())], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = '太卜-表格.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return <div className="markdown-table-container">
        <div className="markdown-table-toolbar"><button type="button" onClick={() => void copy()} aria-label="复制表格"><Copy size={14} />复制</button><button type="button" onClick={csv}><Download size={14} />CSV</button><button type="button" onClick={() => setOpen(true)} aria-label="放大表格"><Expand size={14} /></button></div>
        <div className="overflow-x-auto"><table ref={ref} className="w-full border-collapse">{children}</table></div>
        <Modal open={open} onClose={() => setOpen(false)} labelledBy="table-preview-title" className="markdown-table-dialog"><div className="flex justify-between p-4"><h2 id="table-preview-title">表格预览</h2><button type="button" aria-label="关闭表格预览" onClick={() => setOpen(false)}><X size={18} /></button></div><div className="overflow-auto p-4"><table className="w-full border-collapse">{children}</table></div></Modal>
    </div>;
}
