/**
 * 「问问这一天」：针对选中日期的 AI 问答，复用现有聊天接口（消耗 1 次额度）。
 *
 * 桌面端为页面右栏卡片；移动端输入框固定在底部导航之上，有对话后才在页尾展开卡片。
 * 'use client'：需要管理实时输入、对话与请求状态。
 */
'use client';

import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { ArrowUp, RefreshCw } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { getCalendarAlmanac } from '@/lib/divination/calendar';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { buildDailyChatContext, requestDailyChat } from '@/lib/chat/daily-chat';
import { BrowserDirectProviderError } from '@/lib/ai/browser-direct-provider';
import { toLocalDateKey } from '@/components/daily/useDailyAlmanacDetail';
import type { DailyFortune } from '@/lib/divination/fortune';

interface DailyAIChatProps {
    date: Date;
    userId: string | null;
    /** 未登录时点击提问或建议问题的回调（打开登录框）。 */
    onRequireLogin: () => void;
    /** 个性化日运（有可用命盘时，与 date 为同一天）：并入提问上下文，使回答结合命主当日运势。 */
    personalFortune?: { chartName: string; fortune: DailyFortune } | null;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const SUGGESTED_QUESTIONS = [
    '这一天适合签约或开业吗？',
    '这一天的财运如何？',
    '这一天有什么需要注意的？',
];

export function DailyAIChat({ date, userId, onRequireLogin, personalFortune = null }: DailyAIChatProps) {
    const dateKey = toLocalDateKey(date);
    // 对话归属日期：换日后不再显示其他日期的对话与错误（无需在 effect 中同步清空）
    const [session, setSession] = useState<{ key: string; messages: ChatMessage[]; error: string | null }>({ key: dateKey, messages: [], error: null });
    const [inputValue, setInputValue] = useState('');
    const [pendingKey, setPendingKey] = useState<string | null>(null);
    const sectionRef = useRef<HTMLElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const messages = session.key === dateKey ? session.messages : [];
    const error = session.key === dateKey ? session.error : null;
    const isLoading = pendingKey === dateKey;
    // 移动端无对话时只保留底部输入框（建议问题与说明仅桌面端展示）
    const hasConversation = messages.length > 0 || isLoading || Boolean(error);
    const { userId: sessionUserId, membershipInfo, refreshMembership } = useSessionMembership();
    const remainingCredits = sessionUserId === userId ? (membershipInfo?.aiChatCount ?? null) : null;

    const almanac = useMemo(() => getCalendarAlmanac(date), [date]);
    const personalFortuneData = personalFortune?.fortune ?? null;
    const dateDisplay = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

    const sendMessage = useCallback(async (question: string) => {
        const trimmed = question.trim();
        if (!trimmed || isLoading) return;
        if (!userId) {
            onRequireLogin();
            return;
        }

        const key = dateKey;
        const baseMessages = session.key === key ? session.messages : [];
        setSession({ key, messages: [...baseMessages, { role: 'user', content: trimmed }], error: null });
        setPendingKey(key);
        setInputValue('');

        const contextMessage = buildDailyChatContext({ date, almanac, question: trimmed, personalFortune: personalFortuneData });

        // 请求失败：撤回本次提问并提示（仅当仍停留在同一日期时更新）
        const fail = (message: string) => setSession((current) => (current.key === key
            ? { key, messages: current.messages.slice(0, -1), error: message }
            : current));

        try {
            const response = await requestDailyChat(contextMessage);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { code?: string; error?: string };
                fail(errorData.code === 'INSUFFICIENT_CREDITS' ? '积分不足，请先获取积分' : errorData.error || '请求失败');
                return;
            }
            const data = await response.json() as { content: string };
            setSession((current) => (current.key === key
                ? { key, messages: [...current.messages, { role: 'assistant', content: data.content }], error: null }
                : current));
            void refreshMembership();
        } catch (err) {
            console.error('AI问答错误:', err);
            fail(err instanceof BrowserDirectProviderError ? err.message : '网络错误，请重试');
        } finally {
            setPendingKey((current) => (current === key ? null : current));
        }
    }, [isLoading, userId, onRequireLogin, dateKey, session, date, almanac, personalFortuneData, refreshMembership]);

    // 新消息或等待中：对话列表滚到底部，并把卡片带入视口（移动端卡片在页尾、底部被输入框遮挡）
    const messageCount = messages.length;
    useEffect(() => {
        if (messageCount === 0 && !isLoading) return;
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
        sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [messageCount, isLoading]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendMessage(inputValue);
    };

    return (
        <section
            ref={sectionRef}
            aria-labelledby="daily-ai-chat-title"
            className={`flex h-full min-w-0 scroll-mb-40 flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-panel p-4 lg:scroll-mb-0 lg:p-[22px] ${hasConversation ? '' : 'max-lg:border-0 max-lg:bg-transparent max-lg:p-0'}`}
        >
            <div className={`flex items-center justify-between gap-3 ${hasConversation ? '' : 'max-lg:hidden'}`}>
                <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-clay font-display text-[17px] font-semibold leading-none text-on-accent">
                        卜
                    </span>
                    <h2 id="daily-ai-chat-title" className="font-display text-lg">问问这一天</h2>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    {remainingCredits !== null && (
                        <span className="rounded-full bg-accent-light px-2 py-0.5 text-xs text-accent-strong" title="剩余次数">
                            剩余 {remainingCredits}
                        </span>
                    )}
                    {messages.length > 0 && !isLoading && (
                        <button
                            type="button"
                            onClick={() => setSession({ key: dateKey, messages: [], error: null })}
                            className="rounded-lg p-1.5 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground"
                            title="清空对话"
                            aria-label="清空对话"
                        >
                            <RefreshCw className="size-4" />
                        </button>
                    )}
                </div>
            </div>

            {messages.length > 0 && (
                <div ref={listRef} className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'ml-8 bg-accent-light' : 'mr-8 bg-surface'}`}>
                            {msg.role === 'assistant'
                                ? <MarkdownContent content={msg.content} className="text-sm text-foreground" />
                                : <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="mr-8 flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2.5">
                            <SoundWaveLoader variant="inline" />
                            <span className="text-sm text-foreground-secondary">思考中…</span>
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div role="alert" className="rounded-xl border-[0.5px] border-danger/30 bg-fire-soft px-3.5 py-2.5 text-sm text-danger">
                    {error}
                </div>
            )}

            {messages.length === 0 && (
                <div className="flex flex-col gap-3 max-lg:hidden">
                    {SUGGESTED_QUESTIONS.map((question) => (
                        <button
                            key={question}
                            type="button"
                            onClick={() => { void sendMessage(question); }}
                            disabled={isLoading}
                            className="flex min-h-10 items-center rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 py-1.5 text-left text-sm transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {question}
                        </button>
                    ))}
                </div>
            )}

            {/* 输入：移动端固定在底部导航之上，桌面端位于卡片内 */}
            <div className="fixed inset-x-0 bottom-[calc(4rem+var(--sab))] z-30 border-t-[0.5px] border-border bg-background px-4 py-2.5 sm:px-6 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
                {userId ? (
                    <form onSubmit={handleSubmit} className="flex h-12 items-center gap-2 rounded-[14px] border-[0.5px] border-border-hover bg-surface pr-1.5 pl-3.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 lg:h-11 lg:rounded-xl lg:pl-3">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(event) => setInputValue(event.target.value)}
                            placeholder="问问这一天…"
                            aria-label={`询问 ${dateDisplay} 的问题`}
                            disabled={isLoading}
                            enterKeyHint="send"
                            className="h-full min-w-0 flex-1 bg-transparent text-sm placeholder:text-foreground-tertiary focus:outline-none disabled:opacity-60"
                        />
                        <button
                            type="submit"
                            aria-label="发送"
                            disabled={!inputValue.trim() || isLoading}
                            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 lg:size-8 lg:rounded-lg"
                        >
                            <ArrowUp className="size-[18px]" strokeWidth={2} />
                        </button>
                    </form>
                ) : (
                    <button
                        type="button"
                        onClick={onRequireLogin}
                        className="flex h-12 w-full items-center justify-between rounded-[14px] border-[0.5px] border-border-hover bg-surface pr-1.5 pl-3.5 text-left text-sm text-foreground-tertiary transition-colors hover:bg-background-secondary lg:h-11 lg:rounded-xl lg:pl-3"
                    >
                        登录后问问这一天
                        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-accent text-on-accent lg:size-8 lg:rounded-lg">
                            <ArrowUp className="size-[18px]" strokeWidth={2} />
                        </span>
                    </button>
                )}
            </div>

            <p className={`text-xs text-foreground-secondary ${hasConversation ? '' : 'max-lg:hidden'}`}>
                {personalFortune ? `回答会结合黄历与${personalFortune.chartName}的命盘，对话不会保存` : '回答基于这一天的黄历宜忌，对话不会保存'}
            </p>
        </section>
    );
}
