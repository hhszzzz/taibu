/**
 * MBTI 测试流程组件（设计稿 MbtiTest / MobileMbti）
 *
 * 每页三题，答完本页才能翻页；最后一页答完即可提交，结果写入 sessionStorage 后跳转结果页。
 * 答题说明直接放在页头，不再弹出说明框；移动端翻页按钮固定在底部导航之上。
 */
'use client'; // 需要作答状态、翻页滚动、保存记录与路由跳转

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Brain } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { QuestionCard } from '@/components/mbti/QuestionCard';
import { saveDivinationAction } from '@/lib/divination/save-client';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import {
    loadQuestions,
    calculateResult,
    getMBTIPageState,
    toggleMBTIAnswer,
    type MBTIQuestion,
    type TestAnswer,
    type LikertValue,
} from '@/lib/divination/mbti';
import { supabase } from '@/lib/auth';

/** 提交后保留分析动画的时长，避免结果页闪现 */
const RESULT_REDIRECT_DELAY_MS = 1500;

export function MBTITestFlow() {
    const router = useRouter();
    const { showToast } = useToast();
    const [questions, setQuestions] = useState<MBTIQuestion[]>([]);
    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [currentPage, setCurrentPage] = useState(0);
    const [answers, setAnswers] = useState<TestAnswer[]>([]);
    const [isCalculating, setIsCalculating] = useState(false);
    const redirectTimerRef = useRef<number | null>(null);

    // 离开页面时取消尚未触发的结果页跳转
    useEffect(() => () => {
        if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
    }, []);

    useEffect(() => {
        let active = true;
        loadQuestions()
            .then((allQuestions) => {
                if (!active) return;
                setQuestions(allQuestions);
                setLoadState(allQuestions.length > 0 ? 'ready' : 'failed');
            })
            .catch(() => {
                if (active) setLoadState('failed');
            });
        return () => {
            active = false;
        };
    }, []);

    const answerByIndex = useMemo(
        () => new Map(answers.map(answer => [answer.questionIndex, answer.likertValue])),
        [answers],
    );
    const answeredIndexes = useMemo(() => new Set(answerByIndex.keys()), [answerByIndex]);
    const page = useMemo(
        () => getMBTIPageState(currentPage, questions.length, answeredIndexes),
        [currentPage, questions.length, answeredIndexes],
    );
    const pageQuestions = useMemo(() => questions.slice(page.start, page.end), [questions, page.start, page.end]);
    const pageComplete = page.firstUnanswered === null;
    const allAnswered = questions.length > 0 && answeredIndexes.size === questions.length;

    const handleAnswer = useCallback((questionIndex: number, likertValue: LikertValue) => {
        setAnswers(previous => toggleMBTIAnswer(previous, questionIndex, likertValue));
    }, []);

    const changePage = useCallback((nextPage: number) => {
        setCurrentPage(nextPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const goToPreviousPage = () => {
        if (currentPage > 0) changePage(currentPage - 1);
    };

    const goToNextPage = () => {
        if (!pageComplete) {
            showToast('warning', '请完成当前页的所有题目后再翻页');
            return;
        }
        if (!page.isLastPage) changePage(currentPage + 1);
    };

    const finishTest = async () => {
        if (isCalculating) return;
        if (!allAnswered) {
            showToast('warning', `还有 ${questions.length - answeredIndexes.size} 道题未完成，请完成所有题目后再提交`);
            return;
        }

        setIsCalculating(true);
        const result = calculateResult(questions, answers);

        // 已登录时保存测试记录；保存失败不阻断查看结果
        let readingId: string | null = null;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const saveResult = await saveDivinationAction({
                    endpoint: '/api/mbti',
                    body: {
                        type: result.type,
                        scores: result.scores,
                        percentages: result.percentages,
                    },
                    idKey: 'readingId',
                    fallbackMessage: '保存测试记录失败',
                });
                if (!saveResult.ok) {
                    throw new Error(saveResult.error.message || '保存测试记录失败');
                }
                readingId = saveResult.id ?? null;
            }
        } catch (error) {
            console.error('保存测试记录失败:', error);
        }

        writeSessionJSON('mbti_result', { ...result, readingId });
        redirectTimerRef.current = window.setTimeout(() => {
            router.push('/mbti/result');
        }, RESULT_REDIRECT_DELAY_MS);
    };

    if (isCalculating) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-light text-accent">
                        <Brain className="h-7 w-7" aria-hidden="true" />
                    </span>
                    <h2 className="font-display text-xl font-normal">正在分析你的性格类型</h2>
                    <SoundWaveLoader variant="block" text="请稍候" />
                </div>
            </div>
        );
    }

    if (loadState === 'loading') {
        return (
            <div className="flex min-h-[60vh] items-center justify-center bg-background">
                <SoundWaveLoader variant="block" text="正在加载题目" />
            </div>
        );
    }

    if (loadState === 'failed') {
        return (
            <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
                <div className="flex flex-col items-center gap-4 text-center">
                    <p className="text-sm text-foreground-secondary">题库加载失败，请稍后再试</p>
                    <button
                        type="button"
                        onClick={() => router.push('/mbti')}
                        className="h-11 rounded-xl bg-accent px-6 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    const pageQuestionCount = page.end - page.start;
    const progressPercent = (answeredIndexes.size / questions.length) * 100;
    // 翻页受阻时的说明：答完本页才能翻页 / 最后一页答完才能提交
    const gatingNote = pageComplete
        ? null
        : page.isLastPage
            ? `答完本页 ${pageQuestionCount} 题后即可完成测试`
            : `答完本页 ${pageQuestionCount} 题后才能翻页`;

    return (
        <div className="min-h-full bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[884px] flex-col gap-3 px-4 pt-4 pb-40 sm:px-6 lg:gap-6 lg:px-8 lg:pt-10 lg:pb-16">
                {/* 标题、进度与说明；移动端标题由顶栏显示 */}
                <header className="flex flex-col gap-1.5 lg:gap-3.5">
                    <div className="flex items-baseline justify-between gap-4 text-xs text-foreground-secondary lg:text-sm">
                        <h1 className="hidden font-display text-[30px] font-normal text-foreground lg:block">MBTI 性格测试</h1>
                        <span>第 {currentPage + 1} 页 · 已答 {answeredIndexes.size} / {questions.length}</span>
                        <span className="lg:hidden">共 {page.totalPages} 页</span>
                    </div>
                    <div
                        role="progressbar"
                        aria-label="答题进度"
                        aria-valuemin={0}
                        aria-valuemax={questions.length}
                        aria-valuenow={answeredIndexes.size}
                        className="h-1 overflow-hidden rounded-full bg-background-tertiary lg:h-1.5"
                    >
                        <div className="h-full rounded-full bg-accent transition-[width] duration-300 lg:bg-clay" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-foreground-secondary lg:mt-0 lg:text-sm lg:leading-normal">
                        凭第一反应作答，不要过度思考。<span className="hidden lg:inline">用量表选择你的倾向程度，</span>越靠近哪一侧就越倾向那一项。
                    </p>
                </header>

                <div className="flex flex-col gap-3 lg:gap-6">
                    {pageQuestions.map((question, offset) => {
                        const index = page.start + offset;
                        return (
                            <QuestionCard
                                key={index}
                                question={question}
                                questionNumber={index + 1}
                                selectedValue={answerByIndex.get(index)}
                                isCurrent={index === page.firstUnanswered}
                                onAnswer={(value) => handleAnswer(index, value)}
                            />
                        );
                    })}
                </div>

                {/* 翻页：移动端固定在底部导航之上，桌面端跟随题目 */}
                <div className="fixed inset-x-0 bottom-[calc(4rem+var(--sab))] z-30 flex flex-wrap items-center gap-2 border-t-[0.5px] border-border bg-background px-4 py-3 sm:px-6 lg:static lg:z-auto lg:flex-nowrap lg:justify-between lg:gap-4 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1">
                    <p aria-live="polite" className="w-full text-center text-xs text-foreground-secondary empty:hidden lg:order-2 lg:w-auto lg:flex-1 lg:text-[0.8125rem]">
                        {gatingNote}
                    </p>
                    <button
                        type="button"
                        onClick={goToPreviousPage}
                        disabled={currentPage === 0}
                        className="h-12 shrink-0 rounded-xl border-[0.5px] border-border-hover bg-surface px-[18px] text-[0.9375rem] text-foreground transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface lg:order-1 lg:h-[46px] lg:bg-transparent lg:disabled:hover:bg-transparent"
                    >
                        上一页
                    </button>
                    {page.isLastPage ? (
                        <button
                            type="button"
                            onClick={() => { void finishTest(); }}
                            disabled={!allAnswered}
                            className="h-12 flex-1 rounded-xl bg-accent px-[22px] text-[0.9375rem] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent lg:order-3 lg:ml-auto lg:h-[46px] lg:flex-none"
                        >
                            完成测试
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={goToNextPage}
                            disabled={!pageComplete}
                            className="h-12 flex-1 rounded-xl bg-accent px-[22px] text-[0.9375rem] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent lg:order-3 lg:ml-auto lg:h-[46px] lg:flex-none"
                        >
                            下一页
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
