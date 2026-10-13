/**
 * 盘面要点（纯展示）：把规范 JSON 中已经算好的用神、动变、日辰旬空等事实
 * 整理成可扫读的短句，不做任何新的断卦推演。
 */
import type { LiuyaoCanonicalJSON } from 'taibu-core/liuyao';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';

type LiuyaoLine = LiuyaoCanonicalJSON['六爻'][number];
type SelectedYongShen = LiuyaoCanonicalJSON['用神分析'][number]['已选用神'];

/** 化变关系为「平」时不赘述。 */
const NEUTRAL_RELATION = '平';

function ganZhi(item: { 六亲: string; 纳甲?: string; 五行?: string }): string {
    return `${item.六亲}${item.纳甲 ?? ''}${item.五行 ?? ''}`;
}

/** 用神所在：持世 / 临应 / 伏藏 / 变出 / 居某爻。 */
function describeYongShen(selected: SelectedYongShen): string {
    const subject = `用神${ganZhi(selected)}`;
    if (selected.是否世爻) return `${subject}持世`;
    if (selected.是否应爻) return `${subject}临应`;
    if (!selected.爻位) return subject;
    if (selected.来源 === 'fushen') return `${subject}伏于${selected.爻位}下`;
    if (selected.来源 === 'changed') return `${subject}由${selected.爻位}化出`;
    return `${subject}居${selected.爻位}`;
}

/** 动爻：一爻独发 / 多爻发动，并列出化出之爻与化变关系；无动爻时说明为静卦。 */
function describeMovingLines(lines: readonly LiuyaoLine[]): string[] {
    const moving = lines.filter((line) => line.动静状态 === 'changing');
    if (moving.length === 0) return ['六爻安静，无动爻'];
    const verb = moving.length === 1 ? '独发' : '发动';
    return moving.map((line) => {
        const changed = line.变爻;
        const relation = changed?.关系 && changed.关系 !== NEUTRAL_RELATION ? `（${changed.关系}）` : '';
        return `${line.爻位}${ganZhi(line)}${verb}${changed ? `，化出${ganZhi(changed)}${relation}` : ''}`;
    });
}

/**
 * 盘面要点短句，顺序：用神 → 动爻（自下而上）→ 暗动 / 日破 / 月破 → 日辰旬空 → 卦级关系 → 伏神。
 * 告警（提示）与卦身、全局神煞由调用方单独呈现。
 */
export function buildLiuyaoHighlights(analysis: LiuyaoCanonicalJSON): string[] {
    const lines = [...analysis.六爻].sort(
        (left, right) => (parseTraditionalYaoPosition(left.爻位) ?? 0) - (parseTraditionalYaoPosition(right.爻位) ?? 0),
    );
    const highlights = analysis.用神分析.map((group) => describeYongShen(group.已选用神));
    highlights.push(...describeMovingLines(lines));
    for (const line of lines) {
        if (line.动静状态 === 'hidden_moving') highlights.push(`${line.爻位}${ganZhi(line)}暗动`);
        // day_break 涵盖日破与月破，具体是哪一种由 Core 的动静标签给出
        if (line.动静状态 === 'day_break') highlights.push(`${line.爻位}${ganZhi(line)}${line.动静}`);
    }
    const day = analysis.干支时间.find((pillar) => pillar.柱 === '日');
    if (day) highlights.push(day.空亡.length > 0 ? `日辰${day.干支}，旬空${day.空亡.join('')}` : `日辰${day.干支}`);
    highlights.push(...analysis.卦级分析);
    for (const line of lines) {
        if (line.伏神) highlights.push(`${ganZhi(line.伏神)}伏于${line.爻位}下`);
    }
    return highlights;
}
