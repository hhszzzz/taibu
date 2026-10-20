/**
 * 八字盘面的详查数据：从关系 / 五行详查的工具结果里取出 Core 的规范 JSON。
 * 盘面据五行详查画干支自坐与相邻天干，并在藏干旁标出通根与月令透出。只读工具结果，不重新计算。
 */
import type { BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import type { AgentToolPart } from '@/lib/agent/tool-presentation';
import type { GlyphMark, GlyphMarks } from '@/components/bazi/result/ProfessionalTable';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (value: Json | undefined): value is { [key: string]: Json } => !!value && typeof value === 'object' && !Array.isArray(value);
const isRelationList = (value: Json | undefined) => Array.isArray(value) && value.every(row => isRecord(row) && typeof row.类型 === 'string' && Array.isArray(row.位置));

/** 岁运叠加的关系详查；旧版只查原局的结果没有「叠加关系」，按通用详查展示。 */
export function asBaziRelations(result: Json): BaziRelationsCanonicalJSON | null {
    if (!isRecord(result) || !Array.isArray(result.参与柱位) || !isRelationList(result.叠加关系)) return null;
    if (result.同字牵连 !== undefined && !isRelationList(result.同字牵连)) return null;
    return result.参与柱位.every(item => isRecord(item) && typeof item.柱 === 'string' && typeof item.干支 === 'string')
        ? result as unknown as BaziRelationsCanonicalJSON : null;
}

/** 按 sections 可只取一部分的事实组；无根随通根一起给出。日主、月令与缺失五行总在。 */
const WUXING_GROUPS = ['通根', '干支自坐', '相邻天干'] as const;

/** 当前版本的五行详查；旧版（五行统计、相生链、透干）的结果月令里没有藏干，不再画到盘上。 */
export function asBaziWuxing(result: Json): BaziWuxingCanonicalJSON | null {
    if (!isRecord(result) || !Array.isArray(result.缺失五行) || !isRecord(result.月令) || !isRecord(result.日主)) return null;
    if (!Array.isArray(result.月令.藏干) || (result.无根 !== undefined && !Array.isArray(result.无根))) return null;
    return WUXING_GROUPS.every(key => result[key] === undefined || isRelationList(result[key])) ? result as unknown as BaziWuxingCanonicalJSON : null;
}

/** 同名详查里能解析的结果，最近的在前。 */
function completedResults<T>(tools: readonly AgentToolPart[], name: string, parse: (result: Json) => T | null): T[] {
    return [...tools].reverse().flatMap(tool => {
        if (tool.name !== name || tool.status !== 'completed') return [];
        const output = tool.output && typeof tool.output === 'object' ? tool.output as { result?: Json } : {};
        const parsed = parse(output.result ?? null);
        return parsed ? [parsed] : [];
    });
}

/** 月令取最近一次；按 sections 只取了部分事实组时，每组取最近一次给出该组的详查（无根跟着通根走）。 */
function mergeWuxing(results: readonly BaziWuxingCanonicalJSON[]): BaziWuxingCanonicalJSON | null {
    const [latest] = results;
    if (!latest) return null;
    const merged = { ...latest };
    delete merged.筛选;
    const roots = merged.通根 === undefined ? results.find(result => result.通根 !== undefined) : undefined;
    if (roots) Object.assign(merged, { 通根: roots.通根, ...(roots.无根 ? { 无根: roots.无根 } : {}) });
    for (const key of ['干支自坐', '相邻天干'] as const) {
        const found = merged[key] === undefined ? results.find(result => result[key] !== undefined) : undefined;
        if (found) merged[key] = found[key];
    }
    return merged;
}

/** 一张八字已完成的五行详查汇总；盘面据此画自坐、相邻天干，并标出通根与透出。 */
export function getLatestBaziWuxing(tools: readonly AgentToolPart[]): BaziWuxingCanonicalJSON | null {
    return mergeWuxing(completedResults(tools, 'bazi_wuxing', asBaziWuxing));
}

const PILLAR_SHORT: Record<string, string> = { 年柱: '年', 月柱: '月', 日柱: '日', 时柱: '时' };
const STEM_NAMES: Record<string, string> = { 年柱: '年干', 月柱: '月干', 日柱: '日主', 时柱: '时干' };
const BRANCH_NAMES: Record<string, string> = { 年柱: '年支', 月柱: '月支', 日柱: '日支', 时柱: '时支' };
/** 月令藏干透出的天干名到柱名。 */
const REVEALED_PILLARS: Record<string, string> = { 年干: '年柱', 月干: '月柱', 时干: '时柱' };

/**
 * 五行详查在盘面字旁的标记，全部来自 Core 的结构化字段：
 * - 根：同一地支里的同一藏干给哪些天干作根，合成一个标记，写出所指的天干（日·时），悬停时点亮这支与那几干；
 * - 透：月令藏干透出到哪些天干，标在月支的藏干旁；
 * - 无根：给出通根组时，没有任何根的天干标在它的十神旁。
 */
export function baziGlyphMarks(wuxing: BaziWuxingCanonicalJSON | null): GlyphMarks | undefined {
    if (!wuxing) return undefined;
    const hidden: Record<string, GlyphMark[]> = {};
    const add = (key: string, mark: GlyphMark) => { hidden[key] = [...(hidden[key] ?? []), mark]; };
    const roots = new Map<string, NonNullable<BaziWuxingCanonicalJSON['通根']>>();
    for (const row of wuxing.通根 ?? []) {
        const [stem, branch] = row.位置;
        if (stem?.部位 !== '天干' || branch?.部位 !== '地支') continue;
        const key = branch.柱 + ':' + row.藏干;
        roots.set(key, [...(roots.get(key) ?? []), row]);
    }
    for (const [key, rows] of roots) {
        const branch = rows[0].位置[1];
        const stems = rows.map(row => row.位置[0]);
        add(key, {
            kind: 'root', text: '根', detail: stems.map(cell => PILLAR_SHORT[cell.柱] ?? cell.柱).join('·'),
            title: `${BRANCH_NAMES[branch.柱] ?? branch.柱}${branch.字}藏${rows[0].藏干}（${rows[0].结果}）：${stems.map(cell => (STEM_NAMES[cell.柱] ?? cell.柱) + cell.字).join('、')}之根`,
            spot: [branch.柱 + ':地支', ...stems.map(cell => cell.柱 + ':天干')],
        });
    }
    for (const item of wuxing.月令.藏干) {
        const pillars = item.透出.flatMap(label => REVEALED_PILLARS[label] ? [REVEALED_PILLARS[label]] : []);
        if (!pillars.length) continue;
        add('月柱:' + item.天干, {
            kind: 'reveal', text: '透', detail: pillars.map(pillar => PILLAR_SHORT[pillar]).join('·'),
            title: `月令${wuxing.月令.月支}藏${item.天干}（${item.气性}）透出于${item.透出.join('、')}`,
            spot: ['月柱:地支', ...pillars.map(pillar => pillar + ':天干')],
        });
    }
    const stems: Record<string, GlyphMark[]> = {};
    if (wuxing.通根) {
        const rooted = new Set(wuxing.通根.map(row => row.位置[0]?.柱));
        for (const pillar of Object.keys(STEM_NAMES)) {
            if (rooted.has(pillar)) continue;
            stems[pillar] = [{ kind: 'rootless', text: '无根', title: `${STEM_NAMES[pillar]}无根：四支藏干都没有与它同五行的`, spot: [pillar + ':天干'] }];
        }
    }
    return { hidden, stems };
}
