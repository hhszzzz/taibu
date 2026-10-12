/**
 * 奇门遁甲展示层常量与纯函数
 *
 * 只做「已有数据 → 文案 / 样式 token」的映射，不参与任何排盘计算；
 * 九宫格、宫位详情与结果页共用，避免各处各写一套映射。
 */
import type { QimenPalaceJSON } from 'taibu-core/qimen';

/** 洛书九宫排列顺序（左上→右下，3x3）：巽4 离9 坤2 / 震3 中5 兑7 / 艮8 坎1 乾6 */
export const LUOSHU_ORDER = [4, 9, 2, 3, 5, 7, 8, 1, 6] as const;

export const CENTER_PALACE_INDEX = 5;

const CHINESE_NUMERALS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 后天八卦宫位的固定方位（canonical 默认档不含「方位」字段，此处仅作展示兜底） */
const PALACE_DIRECTIONS: Record<number, string> = {
    1: '北', 2: '西南', 3: '东', 4: '东南', 5: '中', 6: '西北', 7: '西', 8: '东北', 9: '南',
};

/** 五行 → 文字色 token */
const ELEMENT_TEXT_CLASS: Record<string, string> = {
    木: 'text-wood',
    火: 'text-fire',
    土: 'text-earth',
    金: 'text-metal',
    水: 'text-water',
};

/** 天干 → 五行 */
const STEM_ELEMENT: Record<string, string> = {
    甲: '木', 乙: '木',
    丙: '火', 丁: '火',
    戊: '土', 己: '土',
    庚: '金', 辛: '金',
    壬: '水', 癸: '水',
};

/** 图例使用的五行顺序与色块 */
export const ELEMENT_LEGEND = [
    { label: '木', text: 'text-wood', swatch: 'bg-wood' },
    { label: '火', text: 'text-fire', swatch: 'bg-fire' },
    { label: '土', text: 'text-earth', swatch: 'bg-earth' },
    { label: '金', text: 'text-metal', swatch: 'bg-metal' },
    { label: '水', text: 'text-water', swatch: 'bg-water' },
] as const;

/** 宫格底部标签：只展示对断局最常用的状态，其余（门迫、击刑）在详情卡展示 */
const CELL_STATUS_TAGS = ['日空', '时空', '驿马', '入墓'] as const;

/** 中五宫的寄宫说明不是「状态」，详情卡里需要排除 */
const NON_STATUS_MARKERS = new Set(['寄宫参看对应宫位']);

const STATUS_DISPLAY: Record<string, string> = { 六仪击刑: '击刑' };

export interface PalaceTag {
    label: string;
    /** 值符 / 值使 用陶土色强调 */
    emphasis: boolean;
}

export function isPlaceholder(value: string | undefined): boolean {
    return !value || value === '-';
}

export function toChineseNumeral(value: number): string {
    return CHINESE_NUMERALS[value] ?? String(value);
}

/** 「阴遁9局」→「阴遁九局」；无法识别时原样返回 */
export function formatJuLabel(ju: string): string {
    return ju.replace(/(\d)局$/u, (_, digit: string) => `${toChineseNumeral(Number(digit))}局`);
}

export function getPalaceDirection(palace: Pick<QimenPalaceJSON, '宫位序号' | '方位'>): string {
    return palace.方位 && palace.方位 !== '-' ? palace.方位.replace(/^正/u, '') : PALACE_DIRECTIONS[palace.宫位序号] ?? '';
}

/** 「巽」+4 →「巽四」 */
export function getPalaceShortName(palace: Pick<QimenPalaceJSON, '宫名' | '宫位序号'>): string {
    return palace.宫位序号 === CENTER_PALACE_INDEX ? '中五' : `${palace.宫名}${toChineseNumeral(palace.宫位序号)}`;
}

export function getElementTextClass(element: string | undefined): string {
    return (element && ELEMENT_TEXT_CLASS[element]) || 'text-foreground';
}

export function getStemTextClass(stem: string | undefined, element?: string): string {
    if (element && ELEMENT_TEXT_CLASS[element]) return ELEMENT_TEXT_CLASS[element];
    return getElementTextClass(stem ? STEM_ELEMENT[stem.charAt(0)] : undefined);
}

/** 「天任星」→「天任」，宫格内节省宽度 */
export function getShortStarName(star: string): string {
    return star.replace(/星$/u, '');
}

/** 寄星「天禽星」→「禽寄」 */
export function getHostedStarLabel(stars: readonly string[] | undefined): string {
    if (!stars?.length) return '';
    return `${stars.map(star => star.replace(/^天/u, '').replace(/星$/u, '')).join('')}寄`;
}

export function isZhiFuPalace(palace: QimenPalaceJSON): boolean {
    return palace.八神 === '值符';
}

export function isZhiShiPalace(palace: QimenPalaceJSON, zhiShi: string | undefined): boolean {
    return !!zhiShi && !isPlaceholder(palace.八门) && palace.八门 === zhiShi;
}

export function findZhiShiPalaceIndex(palaces: readonly QimenPalaceJSON[], zhiShi: string | undefined): number | undefined {
    return zhiShi ? palaces.find(palace => isZhiShiPalace(palace, zhiShi))?.宫位序号 : undefined;
}

/** 宫格底部标签：值符 / 值使 在前，随后是空亡、驿马、入墓 */
export function getPalaceCellTags(palace: QimenPalaceJSON, zhiShi: string | undefined): PalaceTag[] {
    const tags: PalaceTag[] = [];
    if (isZhiFuPalace(palace)) tags.push({ label: '值符', emphasis: true });
    if (isZhiShiPalace(palace, zhiShi)) tags.push({ label: '值使', emphasis: true });
    for (const status of CELL_STATUS_TAGS) {
        if (palace.宫位状态.includes(status)) tags.push({ label: status, emphasis: false });
    }
    return tags;
}

/** 详情卡标签：在宫格标签基础上补齐门迫、击刑等全部宫位状态 */
export function getPalaceDetailTags(palace: QimenPalaceJSON, zhiShi: string | undefined): PalaceTag[] {
    const tags = getPalaceCellTags(palace, zhiShi);
    const shown = new Set(tags.map(tag => tag.label));
    for (const status of palace.宫位状态) {
        const label = STATUS_DISPLAY[status] ?? status;
        if (NON_STATUS_MARKERS.has(status) || shown.has(label)) continue;
        shown.add(label);
        tags.push({ label, emphasis: false });
    }
    return tags;
}

/** 中五宫寄宫说明，如「天禽星与壬 / 寄乾六宫」；转盘以外或无寄宫数据时返回 null */
export function getCenterHostNote(palaces: readonly QimenPalaceJSON[]): { subject: string; target: string } | null {
    const host = palaces.find(palace => palace.宫位序号 !== CENTER_PALACE_INDEX && (palace.寄星?.length || palace.寄天盘干?.length));
    if (!host) return null;
    const subject = [...(host.寄星 ?? []), ...(host.寄天盘干 ?? [])].join('与');
    return { subject, target: `寄${getPalaceShortName(host)}宫` };
}
