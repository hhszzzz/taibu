/**
 * 八字基本信息区块
 *
 * 日主特征卡片 + 十神知识库；颜色全部来自主题 token。
 */
import { User } from 'lucide-react';
import type { BaziCanonicalJSON } from 'taibu-core/bazi';
import { elementTextClass } from '@/components/bazi/element-classes';
import { TenGodKnowledge } from '@/components/bazi/TenGodKnowledge';
import type { FiveElement, TenGod } from '@/types';

const FIVE_ELEMENTS: readonly FiveElement[] = ['木', '火', '土', '金', '水'];
const ELEMENT_SOFT_BG: Record<FiveElement, string> = {
    木: 'bg-wood-soft',
    火: 'bg-fire-soft',
    土: 'bg-earth-soft',
    金: 'bg-metal-soft',
    水: 'bg-water-soft',
};

interface BasicInfoSectionProps {
    canonicalChart: BaziCanonicalJSON;
    dayMasterDescription: string;
}

export function BasicInfoSection({
    canonicalChart,
    dayMasterDescription,
}: BasicInfoSectionProps) {
    // 获取命盘中出现的十神
    const highlightedTenGods: TenGod[] = [
        canonicalChart.四柱[0]?.天干十神,
        canonicalChart.四柱[1]?.天干十神,
        canonicalChart.四柱[3]?.天干十神,
    ].filter((g): g is TenGod => !!g);
    const dayMasterElement = canonicalChart.基本信息.命主五行?.slice(-1) || '';
    const dayMasterKnownElement = FIVE_ELEMENTS.find((element) => element === dayMasterElement) ?? null;

    return (
        <div className="flex flex-col gap-6 animate-fade-in">
            {/* 1. 日主特征 */}
            <section className="rounded-2xl border-[0.5px] border-border bg-surface p-5 sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                    <User className="h-4 w-4 text-foreground-tertiary" />
                    <h2 className="text-[13px] text-foreground-secondary">日主特征</h2>
                </div>
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-5">
                    <div
                        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-display text-[34px] ${dayMasterKnownElement ? ELEMENT_SOFT_BG[dayMasterKnownElement] : 'bg-panel'} ${elementTextClass(dayMasterKnownElement)}`}
                    >
                        {canonicalChart.基本信息.日主}
                    </div>
                    <div className="space-y-2">
                        <div className="font-display text-lg text-foreground">
                            日主「{canonicalChart.基本信息.日主}」，五行属{dayMasterElement}
                        </div>
                        <p className="max-w-2xl text-sm leading-relaxed text-foreground-secondary">
                            {dayMasterDescription}
                        </p>
                    </div>
                </div>
            </section>

            {/* 2. 十神知识库 - 独立区域 */}
            <TenGodKnowledge highlightedTenGods={highlightedTenGods} />
        </div>
    );
}
