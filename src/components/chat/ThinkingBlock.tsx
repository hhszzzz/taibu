/**
 * AI 思考过程展示组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect, useRef)
 * - 有折叠/展开交互和实时计时功能
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Brain, Clock3, LoaderCircle } from 'lucide-react';

interface ThinkingBlockProps {
    content: string;
    duration?: number;  // 思考时长（秒）- 流式结束后传入
    isStreaming?: boolean;  // 是否正在流式输出
    startTime?: number;  // 开始时间戳（ms），用于实时计时
    /** 对话页使用设计稿的样式：一行“已思考 N 秒 ›”，流式时显示浅底文本框；其它页面保持原样式。 */
    variant?: 'default' | 'chat';
    className?: string;
}

// 格式化时长显示（提取到组件外部，避免每次渲染重新创建）
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)} 秒`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0
        ? `${minutes} 分 ${remainingSeconds} 秒`
        : `${minutes} 分`;
}

/**
 * 思考过程展示组件
 * 可折叠，显示 AI 的推理过程
 * - 流式模式：自动展开，显示实时计时器
 * - 流式结束：自动收起，显示总用时
 */
export function ThinkingBlock({ content, duration, isStreaming = false, startTime, variant = 'default', className }: ThinkingBlockProps) {
    const [isExpanded, setIsExpanded] = useState(isStreaming);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const prevStreamingRef = useRef(isStreaming);

    // 实时计时器 - 仅在流式模式且有开始时间时运行
    useEffect(() => {
        if (!isStreaming || !startTime) {
            return;
        }

        // 使用立即执行的 interval (0ms 延迟启动)
        const interval = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);

        // 立即触发第一次更新（通过 microtask 避免同步 setState）
        queueMicrotask(() => {
            setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
        });

        return () => clearInterval(interval);
    }, [isStreaming, startTime]);

    // 监听流式状态变化
    useEffect(() => {
        // 流式开始时展开（通过 microtask 避免同步 setState）
        if (!prevStreamingRef.current && isStreaming) {
            queueMicrotask(() => setIsExpanded(true));
        }
        // 流式刚结束，延迟收起
        if (prevStreamingRef.current && !isStreaming) {
            const timer = setTimeout(() => setIsExpanded(false), 500);
            prevStreamingRef.current = isStreaming;
            return () => clearTimeout(timer);
        }
        prevStreamingRef.current = isStreaming;
    }, [isStreaming]);

    if (!content) return null;

    // 显示的时长：流式时使用实时计时，结束后使用传入的 duration
    const displayDuration = isStreaming ? elapsedSeconds : duration;

    if (variant === 'chat') {
        const timed = displayDuration !== undefined && displayDuration > 0 ? ` ${formatDuration(displayDuration)}` : '';
        return (
            <div className={`chat-thinking${isStreaming ? ' is-streaming' : ''}${className ? ` ${className}` : ''}`}>
                <button type="button" className="chat-thinking-toggle" aria-expanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)}>
                    {isStreaming
                        ? <LoaderCircle size={13} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <Clock3 size={14} aria-hidden="true" />}
                    <span>{isStreaming ? `正在思考…${timed}` : `已思考${timed}`}</span>
                    <ChevronRight size={14} aria-hidden="true" className={isExpanded ? 'rotate-90' : undefined} />
                </button>
                {isExpanded && <p className="chat-thinking-text">{content}</p>}
            </div>
        );
    }

    return (
        <div className="mb-3">
            {/* 头部 - 可点击展开/折叠 */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1.5 text-accent hover:text-accent/80 transition-colors"
            >
                {/* 脑图标 */}
                <Brain className="w-4.5 h-4.5" />

                <span className="text-sm font-medium">
                    {isStreaming ? '正在思考...' : '已思考'}
                    {displayDuration !== undefined && displayDuration > 0 && (
                        <span className="text-foreground-secondary">（用时 {formatDuration(displayDuration)}）</span>
                    )}
                </span>

                {/* 展开/折叠箭头 */}
                {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                ) : (
                    <ChevronRight className="w-4 h-4" />
                )}
            </button>

            {/* 内容区域 - 仅展开时显示 */}
            {isExpanded && (
                <div className="mt-2 ml-[7px] flex">
                    {/* 左侧装饰线 */}
                    <div className="flex flex-col items-center mr-3 gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                        <span className="w-0.5 flex-1 bg-accent/30" />
                    </div>
                    {/* 内容 */}
                    <div className="text-sm text-foreground-secondary whitespace-pre-wrap flex-1 pb-1">
                        {content}
                    </div>
                </div>
            )}
        </div>
    );
}
