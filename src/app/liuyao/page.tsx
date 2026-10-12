/**
 * 六爻占卜主页面
 *
 * 提供起卦方式选择和历史记录
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronRight, Loader } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { divine, yaosTpCode, findHexagram, calculateChangedHexagram, type LiuQin } from '@/lib/divination/liuyao';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { YongShenTargetPicker } from '@/components/liuyao/YongShenTargetPicker';
import { supabase } from '@/lib/auth';
import { writeSessionJSON } from '@/lib/cache/session-storage';
import { saveDivinationAction } from '@/lib/divination/save-client';

const METHOD_CARD_CLASS = 'flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-5 text-left text-foreground transition-colors hover:bg-background-secondary active:bg-background-tertiary sm:p-[22px]';
const COIN_ICON_KEYS = ['left', 'middle', 'right'] as const;
/** 图标自上而下：阳、阴、阳、阳、阴。 */
const HEXAGRAM_ICON_LINES = [true, false, true, true, false] as const;
const ABOUT_LIUYAO = [
    { title: '铜钱法', body: '三正为老阳、三反为老阴，均为变爻；二正一反为少阳，一正二反为少阴。' },
    { title: '变卦', body: '老阳、老阴变化后得到变卦，反映事情的发展趋势。' },
    { title: '用神', body: '按所问之事取六亲为用神，如问工作取官鬼、问财取妻财。' },
    { title: '一事一占', body: '同一问题不宜反复起卦，以第一次为准。' },
] as const;

export default function LiuyaoPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [question, setQuestion] = useState('');
    const [yongShenTargets, setYongShenTargets] = useState<LiuQin[]>([]);
    const [isQuickLoading, setIsQuickLoading] = useState(false);

    const ensureTargetsSelected = (): boolean => {
        const requiresTargets = question.trim().length > 0;
        if (!requiresTargets) return true;
        if (yongShenTargets.length > 0) return true;
        showToast('error', '请至少选择一个分析目标');
        return false;
    };

    // 铜钱起卦 - 跳转到起卦页面
    const handleCoinDivine = () => {
        if (!ensureTargetsSelected()) return;
        writeSessionJSON('liuyao_question', { question, yongShenTargets });
        router.push('/liuyao/divine');
    };

    const handleSelectDivine = () => {
        if (!ensureTargetsSelected()) return;
        writeSessionJSON('liuyao_question', { question, yongShenTargets });
        router.push('/liuyao/select');
    };

    // 快速起卦 - 系统自动生成
    const handleQuickDivine = async () => {
        if (!ensureTargetsSelected()) return;
        setIsQuickLoading(true);

        // 添加延迟让用户看到加载状态
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            const { yaos } = divine();
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

            const result = {
                question,
                yongShenTargets,
                yaos,
                hexagram,
                changedHexagram,
                changedLines,
                divinationId,
                createdAt: new Date().toISOString(),
            };
            writeSessionJSON('liuyao_result', result);
            router.push('/liuyao/result');
        } catch (error) {
            console.error('快速起卦失败:', error);
            showToast('error', '起卦失败，请重试');
        } finally {
            setIsQuickLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-[944px] flex-col gap-6 px-4 py-5 sm:gap-8 sm:px-8 sm:py-14">
                <header className="hidden flex-col gap-2 lg:flex">
                    <h1 className="font-display text-[34px] font-normal leading-tight">六爻占卜</h1>
                    <p className="text-[15px] text-foreground-secondary">源自《易经》。一事一占，先想清楚要问什么。</p>
                </header>

                {/* 问题与分析目标 */}
                <section className="flex flex-col gap-4 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:p-6">
                    <div className="flex flex-col gap-2">
                        <label htmlFor="liuyao-question" className="text-sm font-medium">
                            所问之事 <span className="font-normal text-foreground-secondary">选填</span>
                        </label>
                        <input
                            id="liuyao-question"
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="例如：这次合作能否顺利达成？"
                            className="h-[52px] w-full rounded-xl border-[0.5px] border-border-hover bg-surface px-4 font-display text-lg text-foreground placeholder:font-sans placeholder:text-[15px] placeholder:text-foreground-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                    </div>
                    <div className="flex flex-col gap-2.5">
                        <span className="text-sm font-medium">
                            分析目标 <span className="font-normal text-foreground-secondary">决定取哪一类用神，可多选</span>
                        </span>
                        <YongShenTargetPicker value={yongShenTargets} onChange={setYongShenTargets} variant="chips" />
                    </div>
                </section>

                {/* 起卦方式 */}
                <section className="flex flex-col gap-3">
                    <h2 className="font-display text-[22px] font-medium">选择起卦方式</h2>
                    <div className="grid gap-3 md:grid-cols-3">
                        <button type="button" onClick={handleCoinDivine} className={METHOD_CARD_CLASS}>
                            <span className="flex h-10 items-center gap-1.5" aria-hidden="true">
                                {COIN_ICON_KEYS.map((key) => (
                                    <span key={key} className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-accent">
                                        <span className="h-2 w-2 border-[1.5px] border-accent" />
                                    </span>
                                ))}
                            </span>
                            <span className="font-display text-[19px]">铜钱起卦</span>
                            <span className="text-sm leading-relaxed text-foreground-secondary">三枚铜钱抛掷六次，亲手感应卦象，保留古法的仪式感。</span>
                            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm text-accent">开始抛掷 <ArrowRight className="h-3.5 w-3.5" /></span>
                        </button>

                        <button type="button" onClick={handleQuickDivine} disabled={isQuickLoading} className={`${METHOD_CARD_CLASS} disabled:cursor-not-allowed disabled:opacity-70`}>
                            <span className="flex h-10 items-center text-accent" aria-hidden="true">
                                {isQuickLoading ? <SoundWaveLoader variant="inline" /> : <Loader className="h-8 w-8" strokeWidth={1.5} />}
                            </span>
                            <span className="font-display text-[19px]">{isQuickLoading ? '正在起卦...' : '快速起卦'}</span>
                            <span className="text-sm leading-relaxed text-foreground-secondary">随机生成卦象，适合不方便手动起卦或想马上得到指引时。</span>
                            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm text-accent">立即生成 <ArrowRight className="h-3.5 w-3.5" /></span>
                        </button>

                        <button type="button" onClick={handleSelectDivine} className={METHOD_CARD_CLASS}>
                            <span className="flex h-10 w-10 flex-col justify-center gap-1" aria-hidden="true">
                                {HEXAGRAM_ICON_LINES.map((yang, index) => (
                                    yang
                                        ? <span key={index} className="h-[3px] rounded-sm bg-accent" />
                                        : <span key={index} className="flex h-[3px] gap-1.5"><span className="flex-1 rounded-sm bg-accent" /><span className="flex-1 rounded-sm bg-accent" /></span>
                                ))}
                            </span>
                            <span className="font-display text-[19px]">选卦起卦</span>
                            <span className="text-sm leading-relaxed text-foreground-secondary">已有卦象时，手动选择本卦与动爻，直接排盘分析。</span>
                            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm text-accent">选择卦象 <ArrowRight className="h-3.5 w-3.5" /></span>
                        </button>
                    </div>
                </section>

                {/* 说明 */}
                <details className="group border-t-[0.5px] border-border pt-[18px]">
                    <summary className="cursor-pointer list-none text-[15px] text-foreground-secondary transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex items-center gap-2">
                            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                            关于六爻：起卦方法、变爻与注意事项
                        </span>
                    </summary>
                    <div className="grid gap-x-8 gap-y-4 pt-4 text-sm leading-relaxed text-foreground-secondary md:grid-cols-2">
                        {ABOUT_LIUYAO.map((item) => (
                            <p key={item.title}><strong className="mr-2 font-medium text-foreground">{item.title}</strong>{item.body}</p>
                        ))}
                    </div>
                </details>
            </div>
            {/* 历史记录抽屉 */}
            <HistoryDrawer type="liuyao" />
        </div>
    );
}
