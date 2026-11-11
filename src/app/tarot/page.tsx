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

import { TAROT_SPREADS, buildTarotDrawHref, getDailyCard, type DrawnCard } from '@/lib/divination/tarot';
import { TarotSpreadPicker } from '@/components/tarot/TarotSpreadPicker';
import { TarotDailyCardDialog } from '@/components/tarot/TarotDailyCardDialog';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Textarea } from '@/components/ui/Textarea';

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
        router.push(buildTarotDrawHref({ spreadId, question, birthDate, allowReversed }));
    };

    const handleRemoveBirthDate = () => {
        setBirthDate('');
        setShowBirthDate(false);
    };

    return (
        <>
            <div className="min-h-full bg-background text-foreground">
                <div className="mx-auto flex w-full max-w-[944px] flex-col gap-6 px-4 pt-2 pb-10 lg:gap-8 lg:px-8 lg:pt-8 lg:pb-16">
                    {/* 页面标题：移动端由顶栏显示标题，这里只保留副标题 */}
                    <header className="flex flex-col gap-2">
                        <h1 className="hidden font-display text-[2rem] font-normal leading-tight lg:block">塔罗占卜</h1>
                        <p className="text-center text-[0.8125rem] text-foreground-secondary lg:text-left lg:text-[0.9375rem]">
                            聆听内心的声音。可先写下问题，也可以直接选择牌阵。
                        </p>
                    </header>

                    {/* 所问之事；出生日期按钮点开后原位变成日期输入 */}
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label htmlFor="tarot-question" className="text-sm font-medium">你想问什么？ <span className="font-normal text-foreground-secondary">选填</span></label>
                            {/* 固定高度与宽度：按钮和日期输入切换时行高与位置不变 */}
                            <div className="flex h-8 min-w-[190px] items-center justify-end">
                                {showBirthDate ? (
                                    <div className="flex items-center gap-1.5">
                                        <Input
                                            id="tarot-birth-date"
                                            type="date"
                                            aria-label="出生日期（数秘术）"
                                            value={birthDate}
                                            onChange={(e) => setBirthDate(e.target.value)}
                                            className={`${FIELD_CLASS} h-8 w-[9.5rem] rounded-lg px-2 text-[13px]`}
                                        />
                                        <Button unstyled
                                            type="button"
                                            onClick={handleRemoveBirthDate}
                                            aria-label="移除出生日期"
                                            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-tertiary transition-colors hover:bg-background-secondary hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                                        </Button>
                                    </div>
                                ) : (
                                    <Button unstyled
                                        type="button"
                                        onClick={() => setShowBirthDate(true)}
                                        className="inline-flex h-8 items-center gap-1 rounded-md text-[13px] text-accent transition-colors hover:text-accent-strong"
                                    >
                                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />出生日期（数秘术）
                                    </Button>
                                )}
                            </div>
                        </div>
                        <Textarea
                            id="tarot-question"
                            rows={2}
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="例如：接下来三个月，我和他的关系会如何发展？"
                            className={`${FIELD_CLASS} min-h-[80px] resize-none rounded-2xl px-4 py-3.5 text-base leading-relaxed`}
                        />
                    </div>

                    {/* 牌阵选择与操作 */}
                    <section className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <div className="flex items-center gap-4">
                                <h2 id={spreadTitleId} className="font-display text-[1.25rem] font-medium lg:text-[1.375rem]">选择牌阵</h2>
                                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                                    <Checkbox checked={allowReversed} onCheckedChange={setAllowReversed} />
                                    包含逆位
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button unstyled
                                    type="button"
                                    onClick={() => setDailyOpen(true)}
                                    className="h-9 rounded-xl border-[0.5px] border-border-hover bg-surface px-4 text-sm text-foreground transition-colors hover:bg-background-secondary"
                                >
                                    每日一牌
                                </Button>
                                <Button unstyled
                                    type="button"
                                    onClick={handleStart}
                                    disabled={!spreadId}
                                    className="h-9 rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    开始洗牌
                                </Button>
                            </div>
                        </div>
                        <TarotSpreadPicker spreads={TAROT_SPREADS} selectedId={spreadId} onSelect={setSpreadId} labelledBy={spreadTitleId} />
                    </section>
                </div>
            </div>
            <TarotDailyCardDialog open={dailyOpen} onClose={() => setDailyOpen(false)} dailyCard={dailyCard} unavailable={dailyCardFailed} />
            <HistoryDrawer type="tarot" />
        </>
    );
}
