import type { BaziCanonicalJSON } from 'taibu-core/bazi';
import type { BaziMeta } from '@/lib/divination/bazi';
import { formatLunarDateFromSolar } from '@/lib/divination/bazi-form-utils';

const HOUR_PILLAR_INDEX = 3;

/** 公历命盘补充农历日期与时辰（时辰取时柱地支，与真太阳时校正后的排盘一致）。 */
function getLunarSummary(meta: BaziMeta, canonicalChart: BaziCanonicalJSON): string | null {
    if (meta.calendarType !== 'solar') return null;
    const [year, month, day] = meta.birthDate.split('-').map(Number);
    const lunarDate = formatLunarDateFromSolar(year, month, day);
    if (!lunarDate) return null;
    const hourBranch = meta.isUnknownTime ? '' : canonicalChart.四柱[HOUR_PILLAR_INDEX]?.干支.charAt(1) ?? '';
    return `农历 ${lunarDate}${hourBranch ? ` ${hourBranch}时` : ''}`;
}

/**
 * 命盘标题区：姓名标题 + 一行出生信息摘要。
 * 桌面端左对齐（与操作按钮同行），移动端居中。
 */
export function ProfileSummaryCard({
    meta,
    canonicalChart,
}: {
    meta: BaziMeta;
    canonicalChart: BaziCanonicalJSON;
}) {
    const timeText = meta.isUnknownTime
        ? '时辰未知'
        : meta.birthTime;
    const genderText = meta.gender === 'male' ? '乾造 · 男' : '坤造 · 女';
    const calendarText = meta.calendarType === 'lunar'
        ? `农历${meta.isLeapMonth ? '闰月' : ''}`
        : '公历';
    const birthPlace = canonicalChart.基本信息.出生地;
    const trueSolarTime = canonicalChart.基本信息.真太阳时;
    const lunarSummary = getLunarSummary(meta, canonicalChart);

    const summaryItems = [
        { key: 'gender', label: '性别', value: genderText },
        { key: 'birth', label: '出生时间', value: `${calendarText} ${meta.birthDate} ${timeText}` },
        lunarSummary ? { key: 'lunar', label: '农历', value: lunarSummary } : null,
        birthPlace
            ? { key: 'place', label: '出生地点', value: trueSolarTime ? `${birthPlace} · 真太阳时` : birthPlace }
            : null,
    ].filter((item): item is { key: string; label: string; value: string } => Boolean(item));

    return (
        <div className="flex min-w-0 flex-col gap-1.5 text-center lg:gap-2 lg:text-left">
            <h1 className="truncate font-display text-[1.625rem] font-normal leading-tight text-foreground lg:text-[34px]">
                {meta.name}的命盘
            </h1>
            <dl className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.8125rem] text-foreground-secondary lg:justify-start lg:text-sm">
                {summaryItems.map((item) => (
                    <div key={item.key} className="min-w-0">
                        <dt className="sr-only">{item.label}</dt>
                        <dd className="truncate">{item.value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
