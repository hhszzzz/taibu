/**
 * MBTI 性格测试主页面
 *
 * 提供测试介绍与进入入口
 */
'use client'; // Uses client-side state for modal and question count.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

import { loadQuestions, type MBTIQuestion, PERSONALITY_BASICS } from '@/lib/divination/mbti';

function MBTIPageContent() {
    const router = useRouter();
    // Tracks question count to enable start button after load.
    const [questions, setQuestions] = useState<MBTIQuestion[]>([]);

    // 加载全部题目
    useEffect(() => {
        loadQuestions().then((allQuestions) => {
            setQuestions(allQuestions);
        });
    }, []);

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-5 lg:gap-10 lg:px-8 lg:py-12">
                {/* 页面标题与开始入口；移动端标题由顶栏显示 */}
                <section className="flex flex-col items-center gap-4 rounded-2xl border-[0.5px] border-border bg-surface px-5 py-8 text-center lg:rounded-[20px] lg:py-12">
                    <h1 className="font-display text-[1.625rem] font-normal leading-tight lg:text-[2.125rem]">
                        MBTI 性格测试
                    </h1>
                    <p className="max-w-md text-[0.9375rem] leading-relaxed text-foreground-secondary">
                        探索你的性格类型，发现你与生俱来的天赋与倾向
                    </p>

                    {/* 开始按钮 */}
                    <button
                        type="button"
                        onClick={() => router.push('/mbti/test')}
                        disabled={questions.length === 0}
                        className="mt-2 inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-8 text-base font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
                    >
                        {questions.length === 0 ? (
                            <>
                                <SoundWaveLoader variant="inline" />
                                <span>准备试题中...</span>
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                                <span>开始测试</span>
                            </>
                        )}
                    </button>
                    <p className="text-[0.8125rem] text-foreground-tertiary">
                        共 {questions.length || 93} 道题目 · 约需 10-15 分钟
                    </p>
                </section>

                {/* 16种人格预览 */}
                <section aria-labelledby="mbti-types-title" className="flex flex-col gap-4">
                    <div className="flex items-baseline justify-between gap-3">
                        <h2 id="mbti-types-title" className="font-display text-[1.375rem] font-medium">16 型人格图鉴</h2>
                        <span className="text-xs text-foreground-tertiary">点击查看详细解读</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {Object.entries(PERSONALITY_BASICS).map(([type, info]) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => router.push(`/mbti/personality/${type}`)}
                                className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-[0.5px] border-border bg-surface px-3 py-5 text-center transition-colors hover:border-accent/50 hover:bg-accent-light active:bg-accent-soft"
                            >
                                <span className="mb-2 text-4xl" aria-hidden="true">{info.emoji}</span>
                                <span className="font-display text-lg tracking-wide">{type}</span>
                                <span className="text-sm text-accent-strong">{info.title}</span>
                                <span className="w-full truncate text-xs text-foreground-secondary">{info.description}</span>
                            </button>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

export default function MBTIPage() {
    return <MBTIPageContent />;
}
