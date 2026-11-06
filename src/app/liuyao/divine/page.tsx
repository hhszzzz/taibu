/**
 * 六爻起卦页面
 *
 * 铜钱起卦交互
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoinToss } from '@/components/liuyao/CoinToss';
import { LiuyaoCastingHeader } from '@/components/liuyao/LiuyaoCastingHeader';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { useLiuyaoQuestion } from '@/components/liuyao/use-liuyao-question';
import { useToast } from '@/components/ui/Toast';
import { type Yao, type CoinTossResult, findHexagram, yaosTpCode, calculateChangedHexagram } from '@/lib/divination/liuyao';
import { getSessionSnapshot } from '@/lib/auth';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

export default function DivinePage() {
    const router = useRouter();
    const { showToast } = useToast();
    const { question, yongShenTargets, setYongShenTargets, needsTargets } = useLiuyaoQuestion();
    const [isComplete, setIsComplete] = useState(false);

    const handleComplete = async (yaos: Yao[], results: CoinTossResult[]) => {
        if (needsTargets) {
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
        let recordOwnerId: string | null = null;
        try {
            const { data: { user } } = await getSessionSnapshot();
            recordOwnerId = user?.id ?? null;
            if (user) {
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
            recordOwnerId,
            createdAt: new Date().toISOString(),
        };
        writeSessionJSON('liuyao_result', result);

        // 留一会儿看清卦名再跳转结果页
        setTimeout(() => {
            router.push('/liuyao/result');
        }, 1500);
    };

    return (
        <div className="bg-background text-foreground md:min-h-screen">
            <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-8 md:py-8">
                <LiuyaoCastingHeader
                    title="铜钱起卦"
                    description="三枚铜钱掷六次，自下而上成卦。"
                    question={question}
                    yongShenTargets={yongShenTargets}
                />

                {needsTargets && (
                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-danger">必须先选择分析目标</div>
                        <YongShenTargetPicker
                            value={yongShenTargets}
                            onChange={setYongShenTargets}
                            variant="block"
                        />
                    </div>
                )}

                <CoinToss onComplete={handleComplete} disabled={isComplete || needsTargets} />
            </div>
        </div>
    );
}
