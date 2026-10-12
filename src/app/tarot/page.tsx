/**
 * 塔罗牌占卜页面
 *
 * 写下问题、选择牌阵与是否包含逆位，再「开始洗牌」跳转到结果页抽牌。
 */
'use client'; // 需要管理问题、牌阵选择与每日一牌弹窗状态，并在开始洗牌时路由跳转

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Plus, X } from 'lucide-react';

import { TAROT_SPREADS, getDailyCard, type DrawnCard } from '@/lib/divination/tarot';
import { TarotSpreadPicker } from '@/components/tarot/TarotSpreadPicker';
import { TarotDailyCardDialog } from '@/components/tarot/TarotDailyCardDialog';

const HistoryDrawer = dynamic(
    () => import('@/components/layout/HistoryDrawer').then(mod => mod.HistoryDrawer),
    { ssr: false }
);

/** 默认选中三牌阵（设计稿默认态）；牌阵配置缺失时退回第一个。 */
const DEFAULT_SPREAD_ID = TAROT_SPREADS.some(spread => spread.id === 'three-card') ? 'three-card' : (TAROT_SPREADS[0]?.id ?? '');

const FIELD_CLASS = 'border-[0.5px] border-border-hover bg-surface text-foreground placeholder:text-foreground-tertiary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

export default function TarotPage() {
    const router = useRouter();
    const spreadTitleId = useId();
    const [question, setQuestion] = useState('');
    const [birthDate, setBirthDate] = useState('');
    const [showBirthDate, setShowBirthDate] = useState(false);
    const [spreadId, setSpreadId] = useState(DEFAULT_SPREAD_ID);
    const [allowReversed, setAllowReversed] = useState(true);
    const [dailyCard, setDailyCard] = useState<DrawnCard | null>(null);
    const [dailyCardFailed, setDailyCardFailed] = useState(false);
    const [dailyOpen, setDailyOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void getDailyCard().then((card) => {
            if (!cancelled) setDailyCard(card);
        }).catch(() => {
            if (!cancelled) setDailyCardFailed(true);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleStart = () => {
        if (!spreadId) return;
        const params = new URLSearchParams();
        params.set('spreadId', spreadId);
        if (question.trim()) params.set('question', question.trim());
        if (birthDate) params.set('birthDate', birthDate);
        if (!allowReversed) params.set('reversed', '0');
        router.push(`/tarot/result?${params.toString()}`);
    };

    const handleRemoveBirthDate = () => {
        setBirthDate('');
        setShowBirthDate(false);
    };

    return (
        <>
            <div className="min-h-full bg-background text-foreground">
                <div className="mx-auto flex w-full max-w-[944px] flex-col gap-6 px-4 pt-2 pb-10 lg:gap-8 lg:px-8 lg:pt-14 lg:pb-16">
                    {/* 页面标题：移动端由顶栏显示标题，这里只保留副标题 */}
                    <header className="flex flex-col gap-2">
                        <h1 className="hidden font-display text-[34px] font-normal leading-tight lg:block">塔罗占卜</h1>
                        <p className="text-center text-[0.8125rem] text-foreground-secondary lg:text-left lg:text-[0.9375rem]">
                            聆听内心的声音。先写下问题，再选择牌阵。
                        </p>
                    </header>

                    {/* 所问之事；出生日期为可选的数秘术参数，默认收起 */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between gap-3">
                            <label htmlFor="tarot-question" className="text-sm font-medium">你想问什么？</label>
                            {!showBirthDate && (
                                <button
                                    type="button"
                                    onClick={() => setShowBirthDate(true)}
                                    className="inline-flex items-center gap-1 rounded-md text-[13px] text-accent transition-colors hover:text-accent-strong"
                                >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />出生日期（数秘术）
                                </button>
                            )}
                        </div>
                        <textarea
                            id="tarot-question"
                            rows={2}
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="例如：接下来三个月，我和他的关系会如何发展？"
                            className={`${FIELD_CLASS} min-h-[80px] w-full resize-none rounded-[14px] px-4 py-3.5 text-base leading-relaxed`}
                        />
                        {showBirthDate && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                                <label htmlFor="tarot-birth-date" className="text-[13px] text-foreground-secondary">出生日期</label>
                                <input
                                    id="tarot-birth-date"
                                    type="date"
                                    value={birthDate}
                                    onChange={(e) => setBirthDate(e.target.value)}
                                    className={`${FIELD_CLASS} h-10 min-w-[180px] rounded-[10px] px-3 text-sm`}
                                />
                                <span className="text-xs text-foreground-tertiary">用于塔罗数秘术，选填</span>
                                <button
                                    type="button"
                                    onClick={handleRemoveBirthDate}
                                    aria-label="移除出生日期"
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-tertiary transition-colors hover:bg-background-secondary hover:text-foreground"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* 牌阵选择 */}
                    <section className="flex flex-col gap-3">
                        <h2 id={spreadTitleId} className="font-display text-[1.25rem] font-medium lg:text-[1.375rem]">选择牌阵</h2>
                        <TarotSpreadPicker spreads={TAROT_SPREADS} selectedId={spreadId} onSelect={setSpreadId} labelledBy={spreadTitleId} />
                    </section>

                    {/* 逆位开关与操作 */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t-[0.5px] border-border pt-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                            <input
                                type="checkbox"
                                checked={allowReversed}
                                onChange={(e) => setAllowReversed(e.target.checked)}
                                className="h-4 w-4 accent-accent"
                            />
                            包含逆位
                        </label>
                        <div className="flex w-full gap-2 sm:w-auto">
                            <button
                                type="button"
                                onClick={() => setDailyOpen(true)}
                                className="h-12 rounded-xl border-[0.5px] border-border-hover bg-surface px-[18px] text-[15px] text-foreground transition-colors hover:bg-background-secondary"
                            >
                                每日一牌
                            </button>
                            <button
                                type="button"
                                onClick={handleStart}
                                disabled={!spreadId}
                                className="h-12 flex-1 rounded-xl bg-accent px-6 text-[15px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                            >
                                开始洗牌
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <TarotDailyCardDialog open={dailyOpen} onClose={() => setDailyOpen(false)} dailyCard={dailyCard} unavailable={dailyCardFailed} />
            <HistoryDrawer type="tarot" />
        </>
    );
}
