/**
 * 选卦起卦页面
 *
 * 支持用户手动选择本卦和变爻
 */
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Sparkles, Grid3X3, Layers } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { HexagramSelector } from '@/components/liuyao/HexagramSelector';
import { TrigramSelector } from '@/components/liuyao/TrigramSelector';
import { ChangingLinesSelector } from '@/components/liuyao/ChangingLinesSelector';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import {
    findHexagram,
    calculateChangedHexagram,
    formatHexagramPalace,
    type Yao,
    type LiuQin,
} from '@/lib/divination/liuyao';
import { supabase } from '@/lib/auth';
import { readSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

type SelectMode = 'list' | 'trigram';

const SELECT_MODES = [
    { mode: 'list', label: '64卦列表', Icon: Grid3X3 },
    { mode: 'trigram', label: '上下卦组合', Icon: Layers },
] as const satisfies ReadonlyArray<{ mode: SelectMode; label: string; Icon: typeof Grid3X3 }>;
const CARD_CLASS = 'rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-5';
const RESULT_CHIP_CLASS = 'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-accent-light px-3.5 py-2.5 text-sm ring-1 ring-inset ring-accent/50';
type LiuyaoQuestionSession = {
    question: string;
    yongShenTargets: LiuQin[];
};

export default function SelectHexagramPage() {
    const router = useRouter();
    const { showToast } = useToast();

    // 选择方式
    const [selectMode, setSelectMode] = useState<SelectMode>('list');

    // 64卦列表模式
    const [hexagramCode, setHexagramCode] = useState<string>('');

    // 八卦选择模式
    const [upperTrigram, setUpperTrigram] = useState<string>('');
    const [lowerTrigram, setLowerTrigram] = useState<string>('');

    // 变爻
    const [changedPositions, setChangedPositions] = useState<number[]>([]);

    // 问题
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

    // 加载状态
    const [isLoading, setIsLoading] = useState(false);
    const requiresYongShenTargets = question.trim().length > 0;

    const handleYongShenTargetsChange = (targets: LiuQin[]) => {
        setYongShenTargets(targets);
        writeSessionJSON('liuyao_question', { question, yongShenTargets: targets });
    };

    // 计算当前有效的卦码
    const effectiveCode = useMemo(() => {
        if (selectMode === 'list') {
            return hexagramCode;
        } else {
            // 八卦组合模式：下卦在前（位置1-3），上卦在后（位置4-6）
            if (lowerTrigram && upperTrigram) {
                return lowerTrigram + upperTrigram;
            }
            return '';
        }
    }, [selectMode, hexagramCode, lowerTrigram, upperTrigram]);

    // 获取当前卦象信息
    const currentHexagram = effectiveCode ? findHexagram(effectiveCode) : null;

    // 获取变卦信息
    const changedInfo = useMemo(() => {
        if (!effectiveCode || changedPositions.length === 0) return null;
        const yaos: Yao[] = effectiveCode.split('').map((char, i) => ({
            type: parseInt(char) as 0 | 1,
            change: changedPositions.includes(i + 1) ? 'changing' : 'stable',
            position: i + 1,
        }));
        const { changedCode, changedLines } = calculateChangedHexagram(yaos);
        const changedHexagram = findHexagram(changedCode);
        return { changedCode, changedLines, changedHexagram };
    }, [effectiveCode, changedPositions]);

    // 生成卦象
    const handleGenerate = async () => {
        if (!effectiveCode || !currentHexagram) return;
        if (requiresYongShenTargets && yongShenTargets.length === 0) {
            showToast('error', '请至少选择一个分析目标');
            return;
        }

        setIsLoading(true);

        try {
            // 构建 yaos 数组
            const yaos: Yao[] = effectiveCode.split('').map((char, i) => ({
                type: parseInt(char) as 0 | 1,
                change: changedPositions.includes(i + 1) ? 'changing' : 'stable',
                position: i + 1,
            }));

            const changedHexagram = changedInfo?.changedHexagram;
            const changedLines = changedInfo?.changedLines || [];

            // 保存到数据库
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

            // 构建结果
            const result = {
                question,
                yongShenTargets,
                yaos,
                hexagram: currentHexagram,
                changedHexagram,
                changedLines,
                divinationId,
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

    // 切换选择模式时清空状态
    const handleModeChange = (mode: SelectMode) => {
        setSelectMode(mode);
        setHexagramCode('');
        setUpperTrigram('');
        setLowerTrigram('');
        setChangedPositions([]);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-4 py-4 sm:gap-5 sm:px-8 md:py-10">
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
                    <h1 className="hidden font-display text-[34px] font-normal leading-tight lg:block">选卦起卦</h1>
                    <p className="text-sm text-foreground-secondary">
                        选择已知卦象，根据当前时间计算分析
                    </p>
                </header>

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

                {/* 选择方式切换 */}
                <div className="flex gap-1 rounded-[10px] bg-background-secondary p-1" role="group" aria-label="选卦方式">
                    {SELECT_MODES.map(({ mode, label, Icon }) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => handleModeChange(mode)}
                            aria-pressed={selectMode === mode}
                            className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-lg text-sm transition-colors
                                ${selectMode === mode
                                    ? 'bg-surface font-medium text-foreground shadow-sm'
                                    : 'text-foreground-secondary hover:text-foreground'
                                }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </button>
                    ))}
                </div>
                <p className="px-1 text-xs text-foreground-secondary">
                    64 卦列表适合直接选已知卦名；上下卦组合适合按外卦/内卦组合推得本卦。
                </p>

                {/* 卦选择区域 */}
                <section className={CARD_CLASS}>
                    {selectMode === 'list' ? (
                        <HexagramSelector
                            value={hexagramCode}
                            onChange={setHexagramCode}
                        />
                    ) : (
                        <div className="flex flex-col gap-4">
                            <TrigramSelector
                                label="上卦（外卦）"
                                value={upperTrigram}
                                onChange={setUpperTrigram}
                            />
                            <TrigramSelector
                                label="下卦（内卦）"
                                value={lowerTrigram}
                                onChange={setLowerTrigram}
                            />

                            {/* 组合结果 */}
                            {currentHexagram && (
                                <div className={RESULT_CHIP_CLASS}>
                                    <span className="text-foreground-secondary">组合结果：</span>
                                    <span className="font-display text-base text-accent-strong">{currentHexagram.name}</span>
                                    <span className="text-foreground-secondary">
                                        · {formatHexagramPalace(currentHexagram.code)} · {currentHexagram.nature}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* 变爻选择 */}
                <section className={CARD_CLASS}>
                    <ChangingLinesSelector
                        hexagramCode={effectiveCode}
                        value={changedPositions}
                        onChange={setChangedPositions}
                    />
                    <p className="mt-2 text-xs text-foreground-secondary">
                        变爻可多选；不选表示静卦，适合仅看当前态势。
                    </p>

                    {/* 变卦显示 */}
                    {changedInfo?.changedHexagram && (
                        <div className={`mt-3 ${RESULT_CHIP_CLASS}`}>
                            <span className="text-foreground-secondary">变卦：</span>
                            <span className="font-display text-base text-accent-strong">{changedInfo.changedHexagram.name}</span>
                            <span className="text-foreground-secondary">
                                · {formatHexagramPalace(changedInfo.changedHexagram.code)}
                            </span>
                        </div>
                    )}
                </section>

                {/* 生成按钮 */}
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!effectiveCode || isLoading}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isLoading ? (
                        <>
                            <SoundWaveLoader variant="inline" />
                            生成中...
                        </>
                    ) : (
                        <>
                            <Sparkles className="h-5 w-5" />
                            生成卦象
                        </>
                    )}
                </button>

                {/* 提示 */}
                <p className="text-center text-xs text-foreground-secondary">
                    系统将根据当前时间计算干支、旺衰、空亡等传统分析
                </p>
            </div>
        </div>
    );
}
