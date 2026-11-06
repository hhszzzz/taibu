/**
 * 选卦起卦页面
 *
 * 左侧按卦名或上下卦选本卦，右侧画出卦象并点选动爻。
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { HexagramSelector } from '@/components/liuyao/HexagramSelector';
import { TrigramSelector } from '@/components/liuyao/TrigramSelector';
import { ChangingLinesSelector } from '@/components/liuyao/ChangingLinesSelector';
import { LiuyaoCastingHeader } from '@/components/liuyao/LiuyaoCastingHeader';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { useLiuyaoQuestion } from '@/components/liuyao/use-liuyao-question';
import {
    findHexagram,
    calculateChangedHexagram,
    formatHexagramPalace,
    type Yao,
} from '@/lib/divination/liuyao';
import { getSessionSnapshot } from '@/lib/auth';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

type SelectMode = 'list' | 'trigram';

const SELECT_MODES = [
    { value: 'list', label: '按卦名' },
    { value: 'trigram', label: '按上下卦' },
] as const;
const CARD_CLASS = 'rounded-2xl border-[0.5px] border-border bg-surface';

function toYaos(code: string, changedPositions: number[]): Yao[] {
    return code.split('').map((char, i) => ({
        type: parseInt(char) as 0 | 1,
        change: changedPositions.includes(i + 1) ? 'changing' : 'stable',
        position: i + 1,
    }));
}

export default function SelectHexagramPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const { question, yongShenTargets, setYongShenTargets, needsTargets } = useLiuyaoQuestion();

    const [selectMode, setSelectMode] = useState<SelectMode>('list');
    // 卦码自下而上：下卦在前（1–3 爻），上卦在后（4–6 爻）；两种选法共用，切换时保留已选。
    const [lowerTrigram, setLowerTrigram] = useState('');
    const [upperTrigram, setUpperTrigram] = useState('');
    const [changedPositions, setChangedPositions] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const effectiveCode = lowerTrigram && upperTrigram ? lowerTrigram + upperTrigram : '';
    const currentHexagram = effectiveCode ? findHexagram(effectiveCode) : undefined;
    const changed = effectiveCode && changedPositions.length > 0
        ? calculateChangedHexagram(toYaos(effectiveCode, changedPositions))
        : null;
    const changedHexagram = changed ? findHexagram(changed.changedCode) : undefined;

    const selectHexagram = (code: string) => {
        setLowerTrigram(code.slice(0, 3));
        setUpperTrigram(code.slice(3));
    };

    const handleGenerate = async () => {
        if (!effectiveCode || !currentHexagram) return;
        if (needsTargets) {
            showToast('error', '请至少选择一个分析目标');
            return;
        }

        setIsLoading(true);

        try {
            const yaos = toYaos(effectiveCode, changedPositions);
            const changedLines = changed?.changedLines || [];

            // 保存到数据库
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

            const result = {
                question,
                yongShenTargets,
                yaos,
                hexagram: currentHexagram,
                changedHexagram,
                changedLines,
                divinationId,
                recordOwnerId,
                createdAt: new Date().toISOString(),
            };

            writeSessionJSON('liuyao_result', result);
            router.push('/liuyao/result');
        } catch (error) {
            console.error('生成卦象失败:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-8 md:py-8">
                <LiuyaoCastingHeader
                    title="选卦起卦"
                    description="已知卦象时，选定本卦、点出动爻，按此刻时间排盘。"
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

                <div className="@container/select">
                    <div className="grid gap-4 @3xl/select:grid-cols-[minmax(0,1fr)_20rem] @3xl/select:items-start @3xl/select:gap-5">
                        <section className={`${CARD_CLASS} flex flex-col gap-4 p-4 sm:p-5`} aria-labelledby="liuyao-select-base">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 id="liuyao-select-base" className="text-[0.9375rem] font-medium">选本卦</h2>
                                <SegmentedControl
                                    ariaLabel="选卦方式"
                                    value={selectMode}
                                    onChange={setSelectMode}
                                    options={SELECT_MODES}
                                    size="sm"
                                    className="w-[13rem]"
                                />
                            </div>
                            {selectMode === 'list' ? (
                                <HexagramSelector
                                    value={effectiveCode}
                                    onChange={selectHexagram}
                                    gridClassName="max-h-[min(25rem,55vh)] overflow-y-auto @3xl/select:max-h-none @3xl/select:overflow-visible"
                                />
                            ) : (
                                <div className="flex flex-col gap-5">
                                    <TrigramSelector label="上卦（外卦）" value={upperTrigram} onChange={setUpperTrigram} />
                                    <TrigramSelector label="下卦（内卦）" value={lowerTrigram} onChange={setLowerTrigram} />
                                </div>
                            )}
                        </section>

                        <aside className={`${CARD_CLASS} flex flex-col gap-4 p-4 sm:p-5 @3xl/select:sticky @3xl/select:top-6`} aria-label="卦象与动爻">
                            <div className="flex min-h-[3.25rem] flex-col justify-center gap-1 px-2.5">
                                {currentHexagram ? (
                                    <>
                                        <p className="font-display text-[1.375rem] leading-tight">
                                            {currentHexagram.name}
                                            {changedHexagram && <> <span className="text-base text-foreground-secondary">之</span> {changedHexagram.name}</>}
                                        </p>
                                        <p className="text-xs text-foreground-secondary">
                                            {formatHexagramPalace(currentHexagram.code)} · 主{currentHexagram.nature}
                                            {changedHexagram && <>，变入{formatHexagramPalace(changedHexagram.code)}</>}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="font-display text-[1.375rem] leading-tight text-foreground-tertiary">未选卦</p>
                                        <p className="text-xs text-foreground-secondary">
                                            {selectMode === 'trigram' && (upperTrigram || lowerTrigram) ? '上下卦都选好后显示本卦' : '选好本卦后，在这里点出动爻'}
                                        </p>
                                    </>
                                )}
                            </div>

                            <ChangingLinesSelector
                                hexagramCode={effectiveCode}
                                value={changedPositions}
                                onChange={setChangedPositions}
                            />

                            <p className="px-2.5 text-xs leading-relaxed text-foreground-tertiary">
                                点爻线设为动爻，可多选；不点为静卦。
                            </p>

                            <Button
                                size="lg"
                                onClick={handleGenerate}
                                disabled={!currentHexagram}
                                loading={isLoading}
                                loadingText="正在排盘"
                                className="w-full"
                            >
                                排出卦盘
                            </Button>
                            <p className="-mt-1 text-center text-xs text-foreground-tertiary">
                                按此刻时间取月建、日辰与旬空
                            </p>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
