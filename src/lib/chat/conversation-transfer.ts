import type { ChatMessage } from '@/types';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { isAskTimeoutReminder } from '@/lib/chat/ask-timeout';
import { parseVisualSource } from '@/lib/visualization/chart-data-extract';

/** Copy only the selected visible branch. No version trees, run state or credentials. */
export function forkConversationMessages(messages: ChatMessage[], throughId: string, newId: () => string): ChatMessage[] {
    const index = messages.findIndex(message => message.id === throughId);
    const target = messages[index];
    if (index < 0 || target.role !== 'assistant' || (target.agent && target.agent.status !== 'completed')) throw new Error('只能从已完成的回答分叉');
    return messages.slice(0, index + 1).filter(message => message.role !== 'system' && !isAskTimeoutReminder(message)).map(message => ({
        id: newId(), role: message.role, content: message.content, createdAt: message.createdAt,
        model: message.model, modelName: message.modelName, reasoning: message.reasoning,
        mentions: message.mentions, quotes: message.quotes, attachments: message.attachments, chartInfo: message.chartInfo,
        metadata: { forkHistory: true, forkOriginMessageId: message.id },
        ...(message.agent ? { agent: { version: 1 as const, runId: newId(), status: 'completed' as const, parts: message.agent.parts.filter(part => part.type !== 'question').map(part => ({ ...part, id: newId() })) } } : {}),
    }));
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function redactExportValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactExportValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/api.?key|secret|password|authorization|credential|system.?prompt|signed.?url/iu.test(key)).map(([key, item]) => [key, redactExportValue(item)]));
    return value;
}

export function conversationMarkdown(title: string, messages: ChatMessage[], tools = false): string {
    const sections = [`# ${title.replace(/[\r\n]/gu, ' ')}`];
    for (const message of messages) {
        if (message.role === 'system') continue;
        // The timeout reminder is the system talking, not a question the user asked.
        if (isAskTimeoutReminder(message)) continue;
        sections.push(`## ${message.role === 'user' ? '提问' : '太卜'}\n\n${message.content}`);
        for (const part of message.agent?.parts ?? []) {
            if (part.type === 'artifact') sections.push(`### ${part.title}\n\n${part.chartId ? `命盘 ID：${part.chartId}（${part.chartType ?? ''}）` : ''}`);
            if (part.type === 'source' && /^https?:\/\//iu.test(part.url)) sections.push(`来源：${part.title || part.url}\n${part.url}\n\n${part.content ?? ''}`);
            if (part.type === 'tool' && part.status === 'completed') {
                const output = part.output as { canonicalText?: string } | null;
                if (part.canonicalText || output?.canonicalText) sections.push(`### ${part.title} · 命盘依据\n\n${part.canonicalText ?? output?.canonicalText}`);
                if (tools) sections.push(`### ${part.title} · 工具详情\n\n\`\`\`json\n${JSON.stringify(redactExportValue({ input: part.input, output: part.output }), null, 2)}\n\`\`\``);
            }
        }
    }
    return sections.join('\n\n---\n\n');
}

/** Static HTML is escaped and printable, with no scripts, remote styles or raw HTML. */
export function conversationHtml(title: string, markdown: string): string {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.8;color:#222}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.5rem}img{max-width:100%;max-height:80vh;object-fit:contain}blockquote{border-left:3px solid #ddd;padding-left:1rem}.visual-note{margin:1rem 0;padding:.75rem 1rem;border:1px solid #ddd;border-radius:8px;background:#fafafa}summary{cursor:pointer}@media print{body{margin:0;max-width:none}pre{orphans:3;widows:3}img,tr{break-inside:avoid}}</style><body>${renderExportNode(tree as ExportNode)}</body></html>`;
}

type ExportNode = { type: string; value?: string; children?: ExportNode[]; depth?: number; ordered?: boolean; start?: number; url?: string; alt?: string; lang?: string | null };
function safeExportUrl(value = '') { return /^(https?:\/\/|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$)/i.test(value) ? value : ''; }
function renderExportNode(node: ExportNode): string {
    const content = (node.children ?? []).map(renderExportNode).join('');
    const tags: Record<string, string> = { paragraph: 'p', emphasis: 'em', strong: 'strong', delete: 'del', blockquote: 'blockquote', listItem: 'li', tableCell: 'td' };
    if (tags[node.type]) return `<${tags[node.type]}>${content}</${tags[node.type]}>`;
    if (node.type === 'heading') { const level = Math.max(1, Math.min(6, node.depth ?? 2)); return `<h${level}>${content}</h${level}>`; }
    if (node.type === 'code' && node.lang === 'visual') {
        // 静态导出禁用脚本：```visual 只留说明与可折叠源码。
        const title = parseVisualSource(node.value ?? '').title;
        return `<div class="visual-note"><p>${title ? `可视化「${escapeHtml(title)}」` : '可视化图'}未在静态导出中渲染，下面是源码。</p><details><summary>查看源码</summary><pre><code>${escapeHtml(node.value ?? '')}</code></pre></details></div>`;
    }
    if (node.type === 'code') return `<pre><code>${escapeHtml(node.value ?? '')}</code></pre>`;
    if (node.type === 'inlineCode') return `<code>${escapeHtml(node.value ?? '')}</code>`;
    if (node.type === 'link') { const url = safeExportUrl(node.url); return url ? `<a href="${escapeHtml(url)}" rel="noreferrer">${content}</a>` : content; }
    if (node.type === 'image') { const url = safeExportUrl(node.url); return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(node.alt ?? '')}">` : escapeHtml(node.alt ?? ''); }
    if (node.type === 'list') { const tag = node.ordered ? 'ol' : 'ul'; return `<${tag}>${content}</${tag}>`; }
    if (node.type === 'table') return `<table>${(node.children ?? []).map((row, index) => `<tr>${(row.children ?? []).map(cell => `<${index ? 'td' : 'th'}>${(cell.children ?? []).map(renderExportNode).join('')}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
    if (node.type === 'break') return '<br>';
    if (node.type === 'thematicBreak') return '<hr>';
    return node.value === undefined ? content : escapeHtml(node.value);
}
