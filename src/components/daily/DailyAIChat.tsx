/**
 * 日历智能问答组件
 * 
 * 针对选中日期的AI问答，复用现有AI API，消耗1积分
 */
'use client'; // 客户端组件：需要管理实时输入与聊天状态

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Send, Calendar, RefreshCw, Info } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { getCalendarAlmanac } from '@/lib/divination/calendar';
import { useSessionMembership } from '@/lib/hooks/useSessionMembership';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { requestDailyChat } from '@/lib/chat/daily-chat';
import { BrowserDirectProviderError } from '@/lib/ai/browser-direct-provider';

interface DailyAIChatProps {
    date: Date;
    userId: string | null;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const SUGGESTED_QUESTIONS = [
    '这一天适合做什么事情？',
    '这一天有什么需要注意的？',
    '这一天的吉凶如何？',
    '这一天适合出行吗？',
    '这一天适合签约或开业吗？',
    '这一天的财运如何？',
];

export function DailyAIChat({ date, userId }: DailyAIChatProps) {
    // useState: 管理对话输入与展示状态
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { userId: sessionUserId, membershipInfo, refreshMembership } = useSessionMembership();
    const remainingCredits = sessionUserId === userId
        ? (membershipInfo?.aiChatCount ?? null)
        : null;

    useEffect(() => {
        setMessages([]);
        setError(null);
        setInputValue('');
        setIsLoading(false);
    }, [date]);

    // 格式化农历信息（使用 useMemo 避免每次渲染重新计算）
    const almanac = useMemo(() => getCalendarAlmanac(date), [date]);
    const dateDisplay = useMemo(() =>
        `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`,
        [date]
    );
    const lunarDisplay = useMemo(() =>
        `农历${almanac.lunarMonthDay}（${almanac.ganZhi.year}年 ${almanac.ganZhi.month}月 ${almanac.ganZhi.day}日）`,
        [almanac]
    );

    // 发送消息
    const sendMessage = useCallback(async (question: string) => {
        if (!question.trim() || isLoading) return;

        if (!userId) {
            setError('请先登录后使用AI问答功能');
            return;
        }

        setError(null);
        setIsLoading(true);

        // 添加用户消息
        const userMessage: ChatMessage = { role: 'user', content: question };
        setMessages(prev => [...prev, userMessage]);
        setInputValue('');

        try {
            // 构建上下文：包含日期的黄历信息
            const contextMessage = `用户正在查询 ${dateDisplay} 的黄历信息和运势。

该日期的黄历详情如下：
- 农历：${almanac.lunarDate}
- 干支：${almanac.ganZhi.year}年 ${almanac.ganZhi.month}月 ${almanac.ganZhi.day}日
- 生肖：年${almanac.shengXiao.year} 月${almanac.shengXiao.month} 日${almanac.shengXiao.day}
- 纳音：${almanac.naYin.year} ${almanac.naYin.month} ${almanac.naYin.day}
- 节气：${almanac.jieQi.current?.name || '无'}
- 宜：${almanac.yi.join('、') || '诸事不宜'}
- 忌：${almanac.ji.join('、') || '无'}
- 吉神：${almanac.jiShen.join('、') || '无'}
- 凶煞：${almanac.xiongSha.join('、') || '无'}
- 冲煞：${almanac.chongSha.chong}
- 空亡：${almanac.kongWang}
- 财神位：${almanac.shenWei.caiShen}
- 喜神位：${almanac.shenWei.xiShen}
- 福神位：${almanac.shenWei.fuShen}
- 值神：${almanac.zhiShen}

用户问题：${question}

请基于以上黄历信息，用专业但易懂的方式回答用户的问题。`;

            // 调用AI API
            const response = await requestDailyChat(contextMessage);

            if (!response.ok) {
                const errorData = await response.json();
                if (errorData.code === 'INSUFFICIENT_CREDITS') {
                    setError('积分不足，请先获取积分');
                } else {
                    setError(errorData.error || '请求失败');
                }
                // 移除用户消息
                setMessages(prev => prev.slice(0, -1));
                return;
            }

            const data = await response.json();
            const assistantMessage: ChatMessage = { role: 'assistant', content: data.content };
            setMessages(prev => [...prev, assistantMessage]);

            // 刷新剩余次数
            void refreshMembership();
        } catch (err) {
            console.error('AI问答错误:', err);
            setError(err instanceof BrowserDirectProviderError ? err.message : '网络错误，请重试');
            // 移除用户消息
            setMessages(prev => prev.slice(0, -1));
        } finally {
            setIsLoading(false);
        }
    }, [userId, dateDisplay, almanac, isLoading, refreshMembership]);

    const handleSubmit = useCallback(() => {
        sendMessage(inputValue);
    }, [sendMessage, inputValue]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    const handleSuggestionClick = useCallback((question: string) => {
        sendMessage(question);
    }, [sendMessage]);

    const clearChat = useCallback(() => {
        setMessages([]);
        setError(null);
    }, []);

    return (
        <section className="bg-background rounded-xl border-border overflow-hidden">
            {/* 标题栏 */}
            <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                    <h2 className="font-semibold">日历智能问答</h2>
                    <p className="text-sm text-foreground-secondary">
                        针对选中的日期提出问题，获取专业的黄历和运势解答
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {remainingCredits !== null && (
                        <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-full">
                            {remainingCredits}
                        </span>
                    )}
                    {messages.length > 0 && (
                        <button
                            onClick={clearChat}
                            className="p-1.5 rounded-lg hover:bg-background transition-colors text-foreground-secondary"
                            title="清空对话"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* 选中日期卡片 */}
                <div className="bg-background rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                        <Calendar className="w-4 h-4 text-foreground-secondary" />
                        <span className="text-sm text-foreground-secondary">选中日期</span>
                    </div>
                    <p className="font-medium">{dateDisplay}</p>
                    <p className="text-sm text-foreground-secondary">{lunarDisplay}</p>
                </div>

                {/* 功能说明 */}
                <div className="flex items-start gap-2 text-sm text-foreground-secondary">
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>
                        此功能专注于基于日历的特定日期 + 个人运势分析，不提供对话保存功能
                    </p>
                </div>

                {/* 对话历史 */}
                {messages.length > 0 && (
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`p-3 rounded-lg ${msg.role === 'user'
                                    ? 'bg-accent/10 ml-8'
                                    : 'bg-background mr-8'
                                    }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <MarkdownContent content={msg.content} className="text-sm text-foreground" />
                                ) : (
                                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                )}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="p-3 rounded-lg bg-background mr-8 flex items-center gap-2">
                                <SoundWaveLoader variant="inline" />
                                <span className="text-sm text-foreground-secondary">思考中...</span>
                            </div>
                        )}
                    </div>
                )}

                {/* 错误提示 */}
                {error && (
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-sm">
                        {error}
                    </div>
                )}

                {/* 输入框 */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`询问关于${dateDisplay}的问题...`}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/50 text-sm"
                        disabled={isLoading || !userId}
                    />
                    <button
                        onClick={handleSubmit}
                        disabled={!inputValue.trim() || isLoading || !userId}
                        className="px-4 py-2.5 rounded-xl bg-accent text-white font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                    >
                        <Send className="w-4 h-4" />
                        提问
                    </button>
                </div>

                {/* 建议问题 */}
                {messages.length === 0 && (
                    <div>
                        <p className="text-sm text-foreground-secondary mb-2">建议问题：</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {SUGGESTED_QUESTIONS.map((q, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSuggestionClick(q)}
                                    disabled={isLoading || !userId}
                                    className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-background transition-colors text-left text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send className="w-3.5 h-3.5 text-foreground-secondary flex-shrink-0" />
                                    <span>{q}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
