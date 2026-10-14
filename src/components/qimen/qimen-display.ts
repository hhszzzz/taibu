/**
 * 奇门遁甲展示层常量与纯函数
 *
 * 只做「已有数据 → 文案 / 样式 token」的映射，不参与任何排盘计算；
 * 九宫格、宫位详情与结果页共用，避免各处各写一套映射。
 */
import type { QimenPalaceJSON } from 'taibu-core/qimen';
import { elementTextClass, ganZhiTextClass, isFiveElement } from '@/components/bazi/element-classes';

/** 洛书九宫排列顺序（左上→右下，3x3）：巽4 离9 坤2 / 震3 中5 兑7 / 艮8 坎1 乾6 */
export const LUOSHU_ORDER = [4, 9, 2, 3, 5, 7, 8, 1, 6] as const;

export const CENTER_PALACE_INDEX = 5;

const CHINESE_NUMERALS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 后天八卦宫位的固定方位（canonical 默认档不含「方位」字段，此处仅作展示兜底） */
const PALACE_DIRECTIONS: Record<number, string> = {
    1: '北', 2: '西南', 3: '东', 4: '东南', 5: '中', 6: '西北', 7: '西', 8: '东北', 9: '南',
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
    return elementTextClass(isFiveElement(element) ? element : null);
}

/** 优先用 canonical 给出的五行；缺失时按天干本身取色（占位「-」为正文色）。 */
export function getStemTextClass(stem: string | undefined, element?: string): string {
    if (isFiveElement(element)) return elementTextClass(element);
    return stem ? ganZhiTextClass(stem.charAt(0)) : 'text-foreground';
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
        if (palace.宫位状态.some(value => getStatusBase(value) === status)) tags.push({ label: status, emphasis: false });
    }
    return tags;
}

/** 「入墓(乙)」等带注的状态归到「入墓」；宫格只放短标签，详情卡展示全文 */
function getStatusBase(status: string): string {
    const noteStart = status.indexOf('(');
    return noteStart > 0 ? status.slice(0, noteStart) : status;
}

/** 详情卡标签：在宫格标签基础上补齐门迫、击刑等全部宫位状态 */
export function getPalaceDetailTags(palace: QimenPalaceJSON, zhiShi: string | undefined): PalaceTag[] {
    const tags = getPalaceCellTags(palace, zhiShi);
    const shown = new Set(tags.map(tag => tag.label));
    for (const status of palace.宫位状态) {
        const label = STATUS_DISPLAY[status] ?? status;
        if (NON_STATUS_MARKERS.has(status) || shown.has(label)) continue;
        shown.add(label);
        // 带注状态替换宫格里的短标签，不另起一个
        const short = tags.find(tag => !tag.emphasis && tag.label === getStatusBase(status));
        if (short) short.label = label;
        else tags.push({ label, emphasis: false });
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
