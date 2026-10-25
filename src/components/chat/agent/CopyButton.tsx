'use client';
// 需要复制状态与 Toast 反馈

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

/** Copies `text`; an icon-only button is named by `label` and confirms with a check mark for two seconds, as code blocks do. */
export function CopyButton({ text, label, name, iconOnly = false, className = 'agent-tool-copy' }: { text: string; label: string; name?: string; iconOnly?: boolean; className?: string }) {
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);
    const size = iconOnly ? 16 : 12;
    return <button type="button" className={className} aria-label={name ?? (iconOnly ? label : undefined)} title={iconOnly ? label : undefined} onClick={async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    }}>
        {copied ? <Check size={size} aria-hidden="true" /> : <Copy size={size} aria-hidden="true" />}
        {!iconOnly && (copied ? '已复制' : label)}
    </button>;
}
