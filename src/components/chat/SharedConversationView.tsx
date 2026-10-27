/**
 * 公开分享页的只读对话视图（服务端渲染）。
 *
 * 复用聊天区的气泡与 cds prose 排版（chat-workspace.css + MarkdownContent），
 * 不含任何操作、版本切换或运行态；命盘依据仅在分享者勾选后出现。
 */
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { mentionTypeLabels } from '@/components/chat/mentionStyles';
import type { PublicConversationShare } from '@/lib/chat/conversation-share.server';
import type { SharedMessage } from '@/lib/chat/conversation-share';
import { GeneratedImageGallery } from '@/components/chat/agent/GeneratedImageGallery';
import { MessageQuoteCards } from '@/components/chat/MessageQuotes';
import '@/components/chat/chat-workspace.css';

const SHARE_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });

function formatShareDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : SHARE_DATE_FORMAT.format(date);
}

function SharedUserMessage({ message }: { message: SharedMessage }) {
    const labels = [...(message.attachments ?? []), ...(message.mentionTypes ?? []).map(type => mentionTypeLabels[type])];
    return (
        <div className="flex justify-end">
            <div className="chat-user-column flex flex-col items-end">
                {message.quotes?.length ? <MessageQuoteCards quotes={message.quotes} /> : null}
                {labels.length > 0 && <ul className="mb-1 flex flex-wrap justify-end gap-1.5" aria-label="附带资料">
                    {labels.map((label, index) => <li key={`${label}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground-secondary">
                        <FileText size={12} aria-hidden="true" /><span className="truncate">{label}</span>
                    </li>)}
                </ul>}
                {message.content && <div className="chat-user-bubble text-foreground">
                    <p className="whitespace-pre-wrap text-base leading-relaxed">{message.content}</p>
                </div>}
            </div>
        </div>
    );
}

function SharedAssistantMessage({ message, token }: { message: SharedMessage; token: string }) {
    return (
        <div className="min-w-0">
            {message.content && <div className="chat-answer"><MarkdownContent content={message.content} className="chat-prose" /></div>}
            {message.images && <GeneratedImageGallery images={message.images} shareToken={token} label="生成的图片" />}
            {message.basis?.map((basis, index) => <details key={`${basis.title}-${index}`} className="mt-3 rounded-xl border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer text-foreground-secondary">{basis.title} · 命盘依据</summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground-secondary">{basis.text}</pre>
            </details>)}
            {message.sources && <section className="mt-3 text-sm" aria-label="参考来源">
                <p className="text-xs text-foreground-tertiary">参考来源</p>
                <ol className="mt-1 space-y-1">
                    {message.sources.map((source, index) => <li key={source.url} className="flex min-w-0 gap-2">
                        <span className="text-foreground-tertiary tabular-nums">{index + 1}.</span>
                        <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-foreground-secondary underline-offset-2 hover:underline">{source.title}</a>
                    </li>)}
                </ol>
            </section>}
            {(message.modelName || message.references) && <p className="mt-2 px-1 text-xs text-foreground-tertiary">
                {[message.modelName, message.references ? `参考了 ${message.references} 项资料` : null].filter(Boolean).join(' · ')}
            </p>}
        </div>
    );
}

export function SharedConversationView({ share, token }: { share: PublicConversationShare; token: string }) {
    const sharedAt = formatShareDate(share.updatedAt);
    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
                    <Link href="/" className="text-sm font-medium text-foreground">太卜 · 分享的对话</Link>
                    <Link href="/chat" className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-background-secondary">开始你的对话</Link>
                </div>
            </header>
            <article className="mx-auto max-w-3xl px-4 pb-16" aria-labelledby="shared-conversation-title">
                <div className="border-b border-border py-8">
                    <h1 id="shared-conversation-title" className="text-2xl font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">{share.title}</h1>
                    <p className="mt-2 text-sm text-foreground-secondary">{sharedAt ? `分享于 ${sharedAt}` : '分享的对话'}{share.includeCharts ? ' · 含命盘依据' : ''}</p>
                    <p className="mt-1 text-xs text-foreground-tertiary">这是一份只读快照，内容为 AI 生成的命理解读，仅供参考。</p>
                </div>
                <ol className="pt-2">
                    {share.messages.map((message, index) => <li key={index} className="chat-transcript-row" data-role={message.role}>
                        {message.role === 'user' ? <SharedUserMessage message={message} /> : <SharedAssistantMessage message={message} token={token} />}
                    </li>)}
                </ol>
                <footer className="mt-10 border-t border-border pt-6 text-center text-sm text-foreground-secondary">
                    由 <Link href="/" className="text-foreground underline-offset-2 hover:underline">太卜</Link> 生成 · 分享者可随时删除此链接
                </footer>
            </article>
        </div>
    );
}
