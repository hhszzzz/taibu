/**
 * 大六壬展示层常量与纯函数
 *
 * 只把 canonical JSON 里已有的字段映射为文案与样式 token，不参与起课计算。
 */
import type { DaliurenCanonicalJSON } from 'taibu-core/daliuren';
import { elementTextClass, ganZhiTextClass, isFiveElement } from '@/components/bazi/element-classes';

type Palace = DaliurenCanonicalJSON['天地盘'][number];

/**
 * 天地盘 4x4 外圈布局（与紫微十二宫一致）：
 * 巳 午 未 申 / 辰 · · 酉 / 卯 · · 戌 / 寅 丑 子 亥
 * 键为天地盘数组下标（子丑寅卯…亥 = 0…11），值为 1 起始的网格行列。
 */
export const TIANDIPAN_GRID_POSITIONS: ReadonlyArray<{ index: number; row: number; col: number }> = [
    { index: 5, row: 1, col: 1 }, { index: 6, row: 1, col: 2 }, { index: 7, row: 1, col: 3 }, { index: 8, row: 1, col: 4 },
    { index: 4, row: 2, col: 1 }, { index: 9, row: 2, col: 4 },
    { index: 3, row: 3, col: 1 }, { index: 10, row: 3, col: 4 },
    { index: 2, row: 4, col: 1 }, { index: 1, row: 4, col: 2 }, { index: 0, row: 4, col: 3 }, { index: 11, row: 4, col: 4 },
];

export const TRANSMISSION_TAGS = ['初传', '中传', '末传'] as const;

export interface DaliurenCellTag {
    label: string;
    /** 三传用陶土色强调，其余（干上 / 支上 / 贵人）为中性标签 */
    emphasis: boolean;
}

export function isPlaceholder(value: string | undefined): boolean {
    return !value || value === '-';
}

export function getElementTextClass(element: string | undefined): string {
    return elementTextClass(isFiveElement(element) ? element : null);
}

/** 优先用 canonical 给出的五行；缺失（如四课下神为日干）时按干支本身取色。 */
export function getGanZhiTextClass(char: string | undefined, element?: string): string {
    if (isFiveElement(element)) return elementTextClass(element);
    return char ? ganZhiTextClass(char.charAt(0)) : 'text-foreground';
}

/** 「初传 (发端)」→ { name: '初传', note: '发端' }；无括注时 note 为空 */
export function splitLabel(label: string): { name: string; note: string } {
    const match = label.match(/^(\S+?)\s*[(（](.+?)[)）]$/u);
    return match ? { name: match[1], note: match[2] } : { name: label, note: '' };
}

/**
 * 课式「丁巳日第二局 干上子 / 重审课」拆为标题与副标题：
 * title「重审课」、day「丁巳日」、ju「第二局」、ganShang「干上子」。
 * 格式不符时退回原文，保证不丢信息。
 */
export function parseKeShi(keShi: string): { title: string; day: string; ju: string; ganShang: string; detail: string } {
    const [head = '', tail = ''] = keShi.split(' / ');
    const title = tail || head;
    const detail = tail ? head : '';
    const [dayJu = '', ganShang = ''] = detail.split(/\s+/u);
    const dayJuMatch = dayJu.match(/^(.+日)(第.+局)$/u);
    return {
        title,
        day: dayJuMatch?.[1] ?? '',
        ju: dayJuMatch?.[2] ?? '',
        ganShang,
        detail,
    };
}

/** 「丁巳日第二局 干上子」→「丁巳日第二局 · 干上子」 */
export function formatKeShiDetail(detail: string): string {
    return detail.split(/\s+/u).filter(Boolean).join(' · ');
}

/** 结果页会话里的起课参数（date / hour / minute / birthYear / gender 等），字段均需运行时收窄。 */
export type DaliurenCastParams = Readonly<Record<string, unknown>>;

function isWholeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

/** 起课时间「YYYY-MM-DD HH:mm」取自起课参数；参数不完整时退回引擎的占测时间文案。 */
export function formatCastTime(params: DaliurenCastParams | null, fallback: string): string {
    const date = params?.date;
    const hour = params?.hour;
    const minute = params?.minute;
    if (typeof date !== 'string' || !date || !isWholeNumber(hour) || !isWholeNumber(minute)) return fallback;
    return `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 「本命 1984 坤 · 行年庚寅」：出生年与乾坤取自起课参数，行年取自引擎；未填出生年时只保留行年。 */
export function formatBenMing(params: DaliurenCastParams | null, xingNian: string | undefined): string {
    const birthYear = isWholeNumber(params?.birthYear) ? params.birthYear : undefined;
    const qianKun = params?.gender === 'female' ? '坤' : params?.gender === 'male' ? '乾' : '';
    return [
        birthYear ? `本命 ${birthYear}${qianKun ? ` ${qianKun}` : ''}` : '',
        xingNian ? `行年${xingNian}` : '',
    ].filter(Boolean).join(' · ');
}

/** 四柱「丙午 戊戌 丁巳 辛亥」的时支 */
export function getHourBranch(siZhu: string): string {
    return siZhu.trim().split(/\s+/u)[3]?.slice(-1) ?? '';
}

/** 宫格角标：地盘 · 遁干；旬空无遁干时标「空」 */
export function getPalaceCornerText(palace: Palace, kongSet: ReadonlySet<string>): { dunGan: string; isKong: boolean } {
    const isKong = kongSet.has(palace.地盘);
    if (!isPlaceholder(palace.遁干)) return { dunGan: palace.遁干, isKong };
    return { dunGan: isKong ? '空' : '', isKong };
}

/** 按课别前缀（一课 / 二课 / 三课 / 四课）取四课，不依赖数组顺序 */
export function findLesson(chart: DaliurenCanonicalJSON, prefix: string): DaliurenCanonicalJSON['四课'][number] | undefined {
    return chart.四课.find(lesson => lesson.课别.startsWith(prefix));
}

/** 宫格标签：三传、干上、支上、贵人（按断课时的关注顺序） */
export function getPalaceTags(palace: Palace, chart: DaliurenCanonicalJSON): DaliurenCellTag[] {
    const tags: DaliurenCellTag[] = [];
    chart.三传.forEach((step, index) => {
        if (!isPlaceholder(step.地支) && step.地支 === palace.天盘) tags.push({ label: TRANSMISSION_TAGS[index] ?? splitLabel(step.传序).name, emphasis: true });
    });
    const ganShang = findLesson(chart, '一课')?.上神;
    const zhiShang = findLesson(chart, '三课')?.上神;
    if (!isPlaceholder(ganShang) && ganShang === palace.天盘) tags.push({ label: '干上', emphasis: false });
    if (!isPlaceholder(zhiShang) && zhiShang === palace.天盘) tags.push({ label: '支上', emphasis: false });
    if (palace.天将 === '贵人') tags.push({ label: '贵人', emphasis: false });
    return tags;
}
