'use client';
// 'use client'：复制按钮需要剪贴板与「已复制」状态

/**
 * 详情弹窗的排版：分区小标题 + 浅底块，字段名一列、值一列，可选等宽与复制；
 * 可折叠分区带计数、默认收起。流水详情与定时任务运行详情共用，弹窗加 `detail-dialog` 取 36rem 宽。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import './detail-layout.css';

function CopyValue({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);
    return <Button unstyled type="button" className="detail-copy" aria-label={`复制${/^[A-Za-z]/.test(label) ? ' ' : ''}${label}`} title="复制" onClick={async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    }}>{copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}</Button>;
}

export function DetailStack({ children }: { children: ReactNode }) {
    return <div className="detail-stack">{children}</div>;
}

/** One field; `copy` adds a copy button for that text, `action` sits after the value, `total` rules a line above. */
export function DetailRow({ label, children, action, mono, copy, total }: {
    label: string; children: ReactNode; action?: ReactNode; mono?: boolean; copy?: string; total?: boolean;
}) {
    return <div className="detail-row" data-total={total || undefined}>
        <dt>{label}</dt>
        <dd>
            <span className={`min-w-0 break-all ${mono ? 'font-mono' : ''}`}>{children}</span>
            {copy ? <CopyValue text={copy} label={label} /> : null}
            {action}
        </dd>
    </div>;
}

export function DetailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
    return <section className="detail-section">
        <h3>{title}{aside}</h3>
        <dl>{children}</dl>
    </section>;
}

export function CollapsibleDetailSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
    return <details className="detail-section detail-collapsible">
        <summary>{title}<Badge variant="neutral">{count}</Badge><ChevronDown size={14} aria-hidden="true" /></summary>
        <dl>{children}</dl>
    </details>;
}
