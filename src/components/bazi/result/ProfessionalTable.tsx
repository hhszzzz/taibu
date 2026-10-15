/**
 * 八字专业排盘表格组件
 *
 * 对齐 Notion 风格：极简线条、清晰层级、去除阴影与大圆角
 */
'use client';

import { useState } from 'react';
import type { BaziCanonicalJSON, BaziCellJSON } from 'taibu-core/bazi';
import {
    type DaYunInfo,
    type LiuNianInfo,
    type LiuYueInfo,
    type LiuRiInfo,
} from '@/lib/divination/bazi';
import { getBranchElement, getElementColor, getStemElement } from '@/lib/divination/display-helpers';
import type { HiddenStemDetail } from '@/types';
import { ChevronDown, ChevronUp } from 'lucide-react';

// 神煞吉凶分类
const JI_SHEN = new Set([
    '天乙贵人', '太极贵人', '天德贵人', '月德贵人', '天德合', '月德合',
    '三奇贵人', '文昌贵人', '文昌', '学堂', '词馆', '华盖', '金舆',
    '天医', '福星', '禄神', '天禄', '暗禄', '驿马', '将星', '天厨',
    '金匮', '玉堂', '龙德', '紫薇', '天喜', '红鸾', '月德', '天德',
    '天赦', '天巫', '国印', '进神', '天罗', '地网', '天官', '福德',
    '红鸾', '天喜',
]);

const XIONG_SHA = new Set([
    '羊刃', '飞刃', '亡神', '劫煞', '灾煞', '血刃', '血光',
    '白虎', '丧门', '吊客', '天狗', '勾绞', '孤辰', '寡宿',
    '空亡', '元辰', '破碎', '大耗', '小耗', '咸池', '桃花',
    '红艳', '流霞', '披麻', '天哭', '病符', '死符', '官符',
    '岁破', '月破', '四废', '阴差阳错', '孤鸾', '童子煞',
    '铁扫', '扫把', '寒命', '孤神', '亡劫', '六厄',
]);

// 获取神煞的吉凶颜色样式
function getShenShaStyle(sha: string): { text: string; bg: string } {
    if (JI_SHEN.has(sha)) {
        return { text: 'text-success', bg: 'bg-success/5' };
    }
    if (XIONG_SHA.has(sha)) {
        return { text: 'text-danger', bg: 'bg-danger/5' };
    }
    return { text: 'text-foreground-secondary', bg: 'bg-background-secondary/50' };
}

interface FortuneColumn {
    key: string;
    label: string;
    stem: string;
    branch: string;
    shiShen?: string;
    hiddenStems: HiddenStemDetail[];
    naYin: string;
    diShi: string;
    shenSha: string[];
    active?: boolean;
}

export function ProfessionalTable({
    canonicalChart,
    isUnknownTime = false,
    activeDaYun,
    activeLiuNian,
    activeLiuYue,
    activeLiuRi,
    highlightedCells,
    onCellSelect,
    canonicalLabels = false,
}: {
    canonicalChart: BaziCanonicalJSON;
    isUnknownTime?: boolean;
    activeDaYun?: DaYunInfo;
    activeLiuNian?: LiuNianInfo;
    activeLiuYue?: LiuYueInfo;
    activeLiuRi?: LiuRiInfo;
    highlightedCells?: BaziCellJSON[];
    onCellSelect?: (cell: BaziCellJSON) => void;
    /** Name rows by the canonical fields (十神, 地势) and the day pillar 日主, as the Agent workspace does. */
    canonicalLabels?: boolean;
}) {
    const [shenShaExpanded, setShenShaExpanded] = useState(false);

    const fortuneColumns: FortuneColumn[] = [];

    if (activeLiuRi) {
        fortuneColumns.push({
            key: 'liuRi',
            label: '流日',
            stem: activeLiuRi.gan,
            branch: activeLiuRi.zhi,
            shiShen: activeLiuRi.tenGod,
            hiddenStems: activeLiuRi.hiddenStems,
            naYin: activeLiuRi.naYin,
            diShi: activeLiuRi.diShi,
            shenSha: activeLiuRi.shenSha,
            active: true,
        });
    }

    if (activeLiuYue) {
        fortuneColumns.push({
            key: 'liuYue',
            label: '流月',
            stem: activeLiuYue.gan,
            branch: activeLiuYue.zhi,
            shiShen: activeLiuYue.tenGod,
            hiddenStems: activeLiuYue.hiddenStems,
            naYin: activeLiuYue.naYin,
            diShi: activeLiuYue.diShi,
            shenSha: activeLiuYue.shenSha,
            active: true,
        });
    }

    if (activeLiuNian) {
        fortuneColumns.push({
            key: 'liuNian',
            label: '流年',
            stem: activeLiuNian.gan,
            branch: activeLiuNian.zhi,
            shiShen: activeLiuNian.tenGod,
            hiddenStems: activeLiuNian.hiddenStems,
            naYin: activeLiuNian.naYin,
            diShi: activeLiuNian.diShi,
            shenSha: activeLiuNian.shenSha,
            active: true,
        });
    }

    if (activeDaYun) {
        fortuneColumns.push({
            key: 'daYun',
            label: '大运',
            stem: activeDaYun.gan,
            branch: activeDaYun.zhi,
            shiShen: activeDaYun.tenGod,
            hiddenStems: activeDaYun.hiddenStems,
            naYin: activeDaYun.naYin,
            diShi: activeDaYun.diShi,
            shenSha: activeDaYun.shenSha,
            active: true,
        });
    }

    const columns = canonicalChart.四柱.map((pillar, index) => {
        const stem = pillar.干支.charAt(0);
        const branch = pillar.干支.charAt(1);
        return {
            key: ['year', 'month', 'day', 'hour'][index] || `pillar-${index}`,
            label: pillar.柱,
            pillar,
            stem,
            branch,
            shiShen: index === 2 ? (canonicalLabels ? '日主' : canonicalChart.基本信息.性别 === '男' ? '元男' : '元女') : (pillar.天干十神 || ''),
            hidden: isUnknownTime && index === 3,
        };
    });

    const hasShenSha = columns.some(col => (col.pillar.神煞 || []).length > 0)
        || fortuneColumns.some(col => col.shenSha.length > 0);
    // Canonical JSON may leave 纳音 out; an empty row says nothing.
    const hasNaYin = columns.some(col => col.pillar.纳音) || fortuneColumns.some(col => col.naYin);
    const hasFortuneColumns = fortuneColumns.length > 0;

    const getStemColor = (stem: string) => {
        const element = getStemElement(stem);
        return element ? getElementColor(element) : undefined;
    };

    const getBranchColor = (branch: string) => {
        const element = getBranchElement(branch);
        return element ? getElementColor(element) : undefined;
    };

    const columnCount = fortuneColumns.length + columns.length;
    const character = (col: typeof columns[number], part: BaziCellJSON['部位'], index: number) => {
        const char = part === '天干' ? col.stem : col.branch;
        const style = { color: col.hidden ? undefined : part === '天干' ? getStemColor(char) : getBranchColor(char) };
        if (!onCellSelect || col.hidden) return <span className="text-xl sm:text-2xl font-bold" style={style}>{col.hidden ? '*' : char}</span>;
        const cell: BaziCellJSON = { 柱: col.label as BaziCellJSON['柱'], 部位: part, 字: char };
        const highlighted = highlightedCells?.some(item => item.柱 === cell.柱 && item.部位 === cell.部位 && item.字 === char) ?? false;
        return <button type="button" className="chart-cell-button text-xl sm:text-2xl font-bold" style={style}
            data-chart-target={'bazi:cell:' + index + ':' + (part === '天干' ? 0 : 1)}
            aria-label={col.label + part + char} aria-pressed={highlighted} onClick={() => onCellSelect(cell)}>{char}</button>;
    };

    return (
        <div className="overflow-x-auto -mx-2 px-1">
            <table className="w-max sm:w-full table-fixed border-collapse text-sm">
                <colgroup>
                    <col className="w-14 sm:w-20" />
                    {Array.from({ length: columnCount }).map((_, idx) => (
                        <col key={idx} className="w-[52px] sm:w-auto" />
                    ))}
                </colgroup>
                <thead>
                    <tr className="border-b border-border">
                        <th className="py-2.5 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60"></th>
                        {fortuneColumns.map((col) => (
                            <th key={col.key} className="py-2.5 px-1 text-center font-bold text-[11px] text-accent uppercase tracking-wider bg-blue-50/30">
                                {col.label}
                            </th>
                        ))}
                        {columns.map((col, idx) => (
                            <th key={col.key} className={`py-2.5 px-1 text-center font-bold text-[11px] text-foreground-secondary uppercase tracking-wider ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {col.label}
                                {col.hidden && <span className="text-warning ml-0.5">*</span>}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {/* 主星行 */}
                    <tr>
                        <td className="py-3 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">{canonicalLabels ? '十神' : '主星'}</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-3 px-1 text-center text-xs font-semibold text-foreground/70 bg-blue-50/10">
                                {col.shiShen || '-'}
                            </td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-3 px-1 text-center text-xs font-semibold text-foreground/70 ${col.hidden ? 'opacity-30' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {col.hidden ? '?' : col.shiShen}
                            </td>
                        ))}
                    </tr>
                    {/* 天干行 */}
                    <tr>
                        <td className="py-4 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">天干</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-4 px-1 text-center bg-blue-50/10">
                                <span className="text-xl sm:text-2xl font-bold" style={{ color: getStemColor(col.stem) }}>
                                    {col.stem}
                                </span>
                            </td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-4 px-1 text-center ${col.hidden ? 'opacity-30' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {character(col, '天干', idx)}
                            </td>
                        ))}
                    </tr>
                    {/* 地支行 */}
                    <tr>
                        <td className="py-4 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">地支</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-4 px-1 text-center bg-blue-50/10">
                                <span className="text-xl sm:text-2xl font-bold" style={{ color: getBranchColor(col.branch) }}>
                                    {col.branch}
                                </span>
                            </td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-4 px-1 text-center ${col.hidden ? 'opacity-30' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {character(col, '地支', idx)}
                            </td>
                        ))}
                    </tr>
                    {/* 藏干行 */}
                    <tr>
                        <td className="py-3 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">藏干</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-3 px-1 bg-blue-50/10">
                                <div className="flex flex-col items-center gap-1">
                                    {col.hiddenStems.map((stem, idx) => (
                                        <div key={idx} className="flex items-center gap-1">
                                            <span className="text-[11px] font-bold" style={{ color: getStemColor(stem.stem) }}>{stem.stem}</span>
                                            <span className="text-[10px] font-medium text-foreground-secondary">{stem.tenGod}</span>
                                        </div>
                                    ))}
                                </div>
                            </td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-3 px-1 ${col.hidden ? 'opacity-30 text-center' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {col.hidden ? <span className="text-xs">*</span> : (
                                    <div className="flex flex-col items-center gap-1">
                                        {(col.pillar.藏干 || []).map((stem, idx) => (
                                            <div key={idx} className="flex items-center gap-1">
                                                <span className="text-[11px] font-bold" style={{ color: getStemColor(stem.天干) }}>{stem.天干}</span>
                                                <span className="text-[10px] font-medium text-foreground-secondary">{stem.十神}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </td>
                        ))}
                    </tr>
                    {/* 辅助行：星运、纳音 */}
                    <tr>
                        <td className="py-2.5 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">{canonicalLabels ? '地势' : '星运'}</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-2.5 px-1 text-center text-[11px] font-medium text-foreground-secondary bg-blue-50/10">{col.diShi}</td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-2.5 px-1 text-center text-[11px] font-medium text-foreground-secondary ${col.hidden ? 'opacity-30' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {col.hidden ? '?' : col.pillar.地势}
                            </td>
                        ))}
                    </tr>
                    {hasNaYin && <tr>
                        <td className="py-2.5 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">纳音</td>
                        {fortuneColumns.map((col) => (
                            <td key={col.key} className="py-2.5 px-1 text-center text-[11px] font-medium text-foreground-secondary bg-blue-50/10">{col.naYin}</td>
                        ))}
                        {columns.map((col, idx) => (
                            <td key={col.key} className={`py-2.5 px-1 text-center text-[11px] font-medium text-foreground-secondary ${col.hidden ? 'opacity-30' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                {col.hidden ? '?' : col.pillar.纳音}
                            </td>
                        ))}
                    </tr>}
                    {/* 神煞星行 */}
                    {hasShenSha && (
                        <tr>
                            <td className="py-3 px-2 text-center text-[10px] font-bold text-foreground-secondary uppercase tracking-widest sticky left-0 z-20 bg-background border-r border-border/60">
                                <button
                                    onClick={() => setShenShaExpanded(!shenShaExpanded)}
                                    className="inline-flex items-center justify-center gap-1 group"
                                >
                                    <span className="group-hover:text-foreground-secondary transition-colors">神煞</span>
                                    {shenShaExpanded ? <ChevronUp className="w-3 h-3 text-foreground/20" /> : <ChevronDown className="w-3 h-3 text-foreground/20" />}
                                </button>
                            </td>
                            {fortuneColumns.map((col) => (
                                <td key={col.key} className="py-3 px-1 bg-blue-50/10">
                                    <div className="flex flex-col items-center gap-1">
                                        {(shenShaExpanded ? col.shenSha : col.shenSha.slice(0, 1)).map((sha, idx) => {
                                            const style = getShenShaStyle(sha);
                                            return <span key={idx} className={`text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap ${style.text} ${style.bg}`}>{sha}</span>;
                                        })}
                                        {!shenShaExpanded && col.shenSha.length > 1 && <span className="text-[9px] font-bold text-foreground/20">+{col.shenSha.length - 1}</span>}
                                    </div>
                                </td>
                            ))}
                            {columns.map((col, idx) => (
                                <td key={col.key} className={`py-3 px-1 ${col.hidden ? 'opacity-30 text-center' : ''} ${idx === 0 && hasFortuneColumns ? 'border-l border-border/60' : ''}`}>
                                    {col.hidden ? <span className="text-xs">?</span> : (
                                        <div className="flex flex-col items-center gap-1">
                                            {(shenShaExpanded ? (col.pillar.神煞 || []) : (col.pillar.神煞?.slice(0, 1) || [])).map((sha, idx) => {
                                                const style = getShenShaStyle(sha);
                                                return <span key={idx} className={`text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap ${style.text} ${style.bg}`}>{sha}</span>;
                                            })}
                                            {!shenShaExpanded && (col.pillar.神煞?.length || 0) > 1 && <span className="text-[9px] font-bold text-foreground/20">+{(col.pillar.神煞?.length || 0) - 1}</span>}
                                        </div>
                                    )}
                                </td>
                            ))}
                        </tr>
                    )}
                </tbody>
            </table>
            {isUnknownTime && <p className="mt-4 px-2 text-[11px] font-medium text-warning italic opacity-80">* 时辰未知，时柱数据仅供逻辑参考</p>}
        </div>
    );
}
