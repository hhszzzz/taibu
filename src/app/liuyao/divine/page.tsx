/**
 * 六爻起卦页面
 *
 * 铜钱起卦交互
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, AlertCircle } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import Link from 'next/link';
import { CoinToss } from '@/components/liuyao/CoinToss';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { useToast } from '@/components/ui/Toast';
import { type Yao, type CoinTossResult, findHexagram, yaosTpCode, calculateChangedHexagram, type LiuQin } from '@/lib/divination/liuyao';
import { supabase } from '@/lib/auth';
import { readSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

type LiuyaoQuestionSession = {
    question: string;
    yongShenTargets: LiuQin[];
};

export default function DivinePage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [question] = useState(() => {
        if (typeof window === 'undefined') return '';
        const payload = readSessionJSON<LiuyaoQuestionSession | string>('liuyao_question');
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        return payload.question || '';
    });
    const [yongShenTargets, setYongShenTargets] = useState<LiuQin[]>(() => {
        if (typeof window === 'undefined') return [];
        const payload = readSessionJSON<LiuyaoQuestionSession | string>('liuyao_question');
        if (!payload || typeof payload === 'string') return [];
        return Array.isArray(payload.yongShenTargets) ? payload.yongShenTargets : [];
    });
    const [isComplete, setIsComplete] = useState(false);
    const requiresYongShenTargets = question.trim().length > 0;

    const handleYongShenTargetsChange = (targets: LiuQin[]) => {
        setYongShenTargets(targets);
        writeSessionJSON('liuyao_question', { question, yongShenTargets: targets });
    };

    const handleComplete = async (yaos: Yao[], results: CoinTossResult[]) => {
        if (requiresYongShenTargets && yongShenTargets.length === 0) {
            showToast('error', '请至少选择一个分析目标');
            return;
        }
        setIsComplete(true);

        // 计算卦象
        const hexagramCode = yaosTpCode(yaos);
        const hexagram = findHexagram(hexagramCode);
        const { changedCode, changedLines } = calculateChangedHexagram(yaos);
        const changedHexagram = changedLines.length > 0 ? findHexagram(changedCode) : undefined;

        // 保存起卦记录到数据库
        let divinationId: string | null = null;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const saveResult = await saveDivinationAction({
                    endpoint: '/api/liuyao',
                    body: {
                        question,
                        yongShenTargets,
                        yaos,
                        changedHexagram,
                        changedLines,
                    },
                    idKey: 'divinationId',
                    fallbackMessage: '保存起卦记录失败',
                });
                if (!saveResult.ok) {
                    throw new Error(saveResult.error.message || '保存起卦记录失败');
                }
                if (saveResult.id) {
                    divinationId = saveResult.id;
                }
            }
        } catch (error) {
            console.error('保存起卦记录失败:', error);
        }

        // 存储结果到 sessionStorage
        const result = {
            question,
            yongShenTargets,
            yaos,
            results,
            hexagram,
            changedHexagram,
            changedLines,
            divinationId,
            createdAt: new Date().toISOString(),
        };
        writeSessionJSON('liuyao_result', result);

        // 延迟跳转结果页
        setTimeout(() => {
            router.push('/liuyao/result');
        }, 1500);
    };



    return (
        <div className="bg-background text-foreground md:min-h-screen">
            <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-8 md:py-10">
                {/* 返回 - 仅桌面端显示 */}
                <Link
                    href="/liuyao"
                    className="hidden w-fit items-center gap-1.5 text-sm text-foreground-secondary transition-colors hover:text-foreground lg:inline-flex"
                >
                    <ChevronLeft className="h-4 w-4" />
                    返回
                </Link>

                {/* 标题 */}
                <header className="flex flex-col gap-1.5 text-center lg:text-left">
                    <h1 className="hidden font-display text-[34px] font-normal leading-tight lg:block">铜钱起卦</h1>
                    <p className="text-sm text-foreground-secondary sm:text-[15px]">
                        静心凝神，点击按钮抛掷铜钱
                    </p>
                </header>

                {/* 问题显示 */}
                {question && (
                    <section className="rounded-2xl bg-accent-light p-4 ring-1 ring-inset ring-accent/50">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong">
                            <AlertCircle className="h-3.5 w-3.5" />
                            所问之事
                        </span>
                        <p className="mt-1.5 font-display text-lg text-foreground">{question}</p>
                    </section>
                )}

                {requiresYongShenTargets && yongShenTargets.length === 0 && (
                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-danger">必须先选择分析目标</div>
                        <YongShenTargetPicker
                            value={yongShenTargets}
                            onChange={handleYongShenTargetsChange}
                            variant="block"
                        />
                    </div>
                )}

                {/* 铜钱起卦 */}
                <section className="rounded-2xl border-[0.5px] border-border bg-surface px-4 py-6 md:p-8">
                    <CoinToss
                        onComplete={handleComplete}
                        disabled={isComplete || (requiresYongShenTargets && yongShenTargets.length === 0)}
                    />
                </section>

                {/* 完成提示 */}
                {isComplete && (
                    <div className="flex flex-col items-center gap-2 text-center">
                        <SoundWaveLoader variant="inline" />
                        <p className="text-sm font-medium text-accent md:text-base">卦象已成，正在跳转...</p>
                    </div>
                )}
            </div>
        </div>
    );
}
