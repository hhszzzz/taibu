/**
 * Web 侧六爻封装层
 *
 * 页面与交互只保留起卦辅助；
 * 核心排盘与断卦规则统一复用 core 的编译产物。
 */

import { XUN_KONG_TABLE as CORE_XUN_KONG_TABLE } from 'taibu-core/data/shensha';
import { HEXAGRAMS as CORE_HEXAGRAMS, YAO_CI as CORE_YAO_CI, type Hexagram } from 'taibu-core/data/hexagrams';
import {
    calculateFullYaoInfo as calculateFullYaoInfoCore,
    calculateGanZhiTime as calculateGanZhiTimeCore,
    calculateKongWangByPillar as calculateKongWangByPillarCore,
    calculateDerivedHexagrams,
    calculateGuaShen,
    findHexagram as findHexagramCore,
    formatGanZhiTime as formatGanZhiTimeCore,
    getHexagramContext,
    hasInvalidYongShenTargets as hasInvalidYongShenTargetsCore,
    normalizeYongShenTargets as normalizeYongShenTargetsCore,
    performFullAnalysis as performFullAnalysisCore,
    KONG_WANG_LABELS,
    MOVEMENT_LABELS,
    WANG_SHUAI_LABELS,
    toLiuyaoCanonicalJson,
    toLiuyaoCanonicalText,
    toLiuyaoText,
    type ChangedYaoDetail,
    type DerivedHexagramInfo,
    type DiZhi,
    type FullYaoInfo,
    type FullYaoInfoExtended,
    type FuShen,
    type GanZhiTime,
    type GuaShenInfo,
    type KongWang,
    type KongWangByPillar,
    type LiuQinType,
    type LiuYaoFullAnalysis,
    type ShenSystemByYongShen,
    type TianGan,
    type TimeRecommendation,
    type LiuyaoCanonicalJSON,
    type LiuyaoOutput,
    type WuXing,
    type YaoChange,
    type YaoInput as CoreYao,
    type YaoStrength,
    type YaoType,
    type YongShenCandidate,
    type YongShenGroup,
} from 'taibu-core/liuyao';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';

export type {
    ChangedYaoDetail,
    DerivedHexagramInfo,
    DiZhi,
    FullYaoInfo,
    FullYaoInfoExtended,
    FuShen,
    GanZhiTime,
    GuaShenInfo,
    KongWang,
    KongWangByPillar,
    LiuYaoFullAnalysis,
    ShenSystemByYongShen,
    TianGan,
    TimeRecommendation,
    LiuyaoCanonicalJSON,
    LiuyaoOutput,
    WuXing,
    YaoChange,
    YaoStrength,
    YaoType,
    YongShenCandidate,
    YongShenGroup,
};
export type LiuQin = LiuQinType;
export type { Hexagram };
export type Yao = CoreYao;
export { calculateDerivedHexagrams, calculateGuaShen, getHexagramContext };

export interface Trigram {
    name: string;
    code: string;
    element: WuXing;
    nature: string;
}

export interface CoinTossResult {
    coins: [boolean, boolean, boolean];
    heads: number;
    sum: number;
    yaoType: YaoType;
    isChanging: boolean;
}

export interface DivinationResult {
    question: string;
    yongShenTargets: LiuQin[];
    yaos: Yao[];
    hexagram: Hexagram;
    changedHexagram?: Hexagram;
    changedLines: number[];
    createdAt: Date;
}

export interface LiuyaoBundleInput {
    yaos: Yao[];
    question: string;
    date: Date;
    yongShenTargets: LiuQin[];
    hexagram: Hexagram;
    changedHexagram?: Hexagram;
}

export interface LiuyaoBundle {
    output: LiuyaoOutput;
    hexagramCode: string;
    changedCode?: string;
}

export const TRIGRAMS: Record<string, Trigram> = {
    '111': { name: '乾', code: '111', element: '金', nature: '天' },
    '000': { name: '坤', code: '000', element: '土', nature: '地' },
    '100': { name: '震', code: '100', element: '木', nature: '雷' },
    '001': { name: '艮', code: '001', element: '土', nature: '山' },
    '010': { name: '坎', code: '010', element: '水', nature: '水' },
    '101': { name: '离', code: '101', element: '火', nature: '火' },
    '110': { name: '兑', code: '110', element: '金', nature: '泽' },
    '011': { name: '巽', code: '011', element: '木', nature: '风' },
};

export const HEXAGRAMS: Hexagram[] = CORE_HEXAGRAMS;
export const XUN_KONG_TABLE: Record<string, [DiZhi, DiZhi]> = CORE_XUN_KONG_TABLE as Record<string, [DiZhi, DiZhi]>;
export { WANG_SHUAI_LABELS, KONG_WANG_LABELS, MOVEMENT_LABELS };

let _hexagramBrief: Record<string, string> | null = null;
function getHexagramBriefMap(): Record<string, string> {
    if (!_hexagramBrief) {
        _hexagramBrief = Object.fromEntries(
            CORE_HEXAGRAMS.map((item) => [item.name, `${item.upperTrigram}/${item.lowerTrigram}之象，主${item.nature}。`]),
        );
    }
    return _hexagramBrief;
}

export function findHexagram(input: string): Hexagram | undefined {
    return findHexagramCore(input);
}

/** 卦宫与卦宫五行，如「离宫火」；卦数据的 element 是上卦五行，不能当作卦的五行展示。 */
export function formatHexagramPalace(code: string): string {
    const palace = getHexagramContext(code).palace;
    return palace ? `${palace.name}宫${palace.element}` : '';
}

export function tossCoin(): boolean {
    return Math.random() < 0.5;
}

export function resolveCoinTossResult(coins: [boolean, boolean, boolean]): CoinTossResult {
    const heads = coins.filter(Boolean).length;
    const sum = heads + 6;
    let yaoType: YaoType = 0;
    let isChanging = false;

    if (heads === 3) {
        yaoType = 1;
        isChanging = true;
    } else if (heads === 2) {
        yaoType = 0;
    } else if (heads === 1) {
        yaoType = 1;
    } else {
        yaoType = 0;
        isChanging = true;
    }

    return { coins, heads, sum, yaoType, isChanging };
}

export function tossThreeCoins(): CoinTossResult {
    const coins: [boolean, boolean, boolean] = [tossCoin(), tossCoin(), tossCoin()];
    return resolveCoinTossResult(coins);
}

export function divine(): { yaos: Yao[]; results: CoinTossResult[] } {
    const results: CoinTossResult[] = [];
    const yaos: Yao[] = [];
    for (let position = 1; position <= 6; position += 1) {
        const result = tossThreeCoins();
        results.push(result);
        yaos.push({
            type: result.yaoType,
            change: result.isChanging ? 'changing' : 'stable',
            position,
        });
    }
    return { yaos, results };
}

export function yaosTpCode(yaos: Yao[]): string {
    return yaos.map((item) => item.type.toString()).join('');
}

export function calculateChangedHexagram(yaos: Yao[]): { changedCode: string; changedLines: number[] } {
    const changedLines: number[] = [];
    const changedCode = yaos.map((item, index) => {
        if (item.change !== 'changing') return item.type.toString();
        changedLines.push(index + 1);
        return item.type === 1 ? '0' : '1';
    }).join('');
    return { changedCode, changedLines };
}

export function normalizeYongShenTargets(targets?: readonly unknown[]): LiuQin[] {
    if (!targets) return [];
    return normalizeYongShenTargetsCore(targets);
}

export function hasInvalidYongShenTargets(targets?: readonly unknown[]): boolean {
    return hasInvalidYongShenTargetsCore(targets);
}

export function calculateGanZhiTime(date: Date): GanZhiTime {
    return calculateGanZhiTimeCore(date);
}

export function formatGanZhiTime(gz: GanZhiTime): string {
    return formatGanZhiTimeCore(gz);
}

export function calculateKongWangByPillar(ganZhiTime: GanZhiTime): KongWangByPillar {
    return calculateKongWangByPillarCore(ganZhiTime);
}

export function calculateFullYaoInfo(
    yaos: Yao[],
    hexagramCode: string,
    dayStem: TianGan,
): FullYaoInfo[] {
    return calculateFullYaoInfoCore(yaos, hexagramCode, dayStem);
}

export function performFullAnalysis(
    yaos: Yao[],
    hexagramCode: string,
    changedCode: string | undefined,
    question: string,
    date: Date,
    options?: { yongShenTargets?: LiuQin[] },
): LiuYaoFullAnalysis {
    return performFullAnalysisCore(
        yaos,
        hexagramCode,
        changedCode,
        question,
        date,
        { yongShenTargets: options?.yongShenTargets ?? [] },
    );
}

export function calculateLiuyaoBundle(input: LiuyaoBundleInput): LiuyaoBundle {
    const hexagramCode = yaosTpCode(input.yaos);
    const { changedCode } = calculateChangedHexagram(input.yaos);
    const resolvedChangedCode = input.changedHexagram ? changedCode : undefined;
    const analysis = performFullAnalysisCore(
        input.yaos,
        hexagramCode,
        resolvedChangedCode,
        input.question,
        input.date,
        { yongShenTargets: input.yongShenTargets },
    );
    const derived = calculateDerivedHexagrams(hexagramCode);
    const baseCtx = getHexagramContext(hexagramCode);
    const changedCtx = resolvedChangedCode ? getHexagramContext(resolvedChangedCode) : undefined;
    // 与 core calculateLiuyao 一致：按本卦附上各爻爻辞，canonical JSON/文本据此输出动爻爻辞
    const baseYaoCi = baseCtx.hexagram ? CORE_YAO_CI[baseCtx.hexagram.name] : undefined;

    return {
        output: {
            question: input.question,
            hexagramName: input.hexagram.name,
            hexagramGong: baseCtx.palace?.name || '',
            hexagramElement: baseCtx.palace?.element ?? input.hexagram.element,
            hexagramBrief: input.hexagram.nature,
            guaCi: baseCtx.guaCi,
            xiangCi: baseCtx.xiangCi,
            changedHexagramName: input.changedHexagram?.name,
            changedHexagramGong: changedCtx?.palace?.name || '',
            changedHexagramElement: changedCtx?.palace?.element ?? input.changedHexagram?.element,
            changedGuaCi: changedCtx?.guaCi,
            changedXiangCi: changedCtx?.xiangCi,
            ganZhiTime: analysis.ganZhiTime,
            kongWang: analysis.kongWang,
            kongWangByPillar: analysis.kongWangByPillar,
            fullYaos: analysis.fullYaos.map((yao) => ({ ...yao, yaoCi: baseYaoCi?.[yao.position - 1] })),
            yongShen: analysis.yongShen,
            fuShen: analysis.fuShen,
            shenSystemByYongShen: analysis.shenSystemByYongShen,
            globalShenSha: analysis.globalShenSha,
            liuChongGuaInfo: analysis.liuChongGuaInfo,
            liuHeGuaInfo: analysis.liuHeGuaInfo,
            chongHeTransition: analysis.chongHeTransition,
            guaFanFuYin: analysis.guaFanFuYin,
            sanHeAnalysis: analysis.sanHeAnalysis,
            warnings: analysis.warnings,
            timeRecommendations: analysis.timeRecommendations,
            nuclearHexagram: derived.nuclearHexagram,
            oppositeHexagram: derived.oppositeHexagram,
            reversedHexagram: derived.reversedHexagram,
            guaShen: calculateGuaShen(hexagramCode),
        },
        hexagramCode,
        changedCode: resolvedChangedCode,
    };
}

export function buildLiuyaoCanonicalJSON(output: LiuyaoOutput): LiuyaoCanonicalJSON {
    return toLiuyaoCanonicalJson(output);
}

export function generateLiuyaoChartText(
    output: LiuyaoOutput,
    options?: { detailLevel?: ChartTextDetailLevel },
): string {
    if (options?.detailLevel === undefined) {
        return toLiuyaoCanonicalText(output);
    }

    return toLiuyaoText(output, {
        detailLevel: resolveChartTextDetailLevel('liuyao', options.detailLevel),
    });
}

export function getHexagramBrief(name: string): string {
    return getHexagramBriefMap()[name] || '此卦宜结合问题、用神与动变条件综合判断。';
}

export function getLiuShenMeaning(liuShen: string): string {
    const meanings: Record<string, string> = {
        青龙: '主喜庆、贵人、顺势之助。',
        朱雀: '主言语、文书、消息与争辩。',
        勾陈: '主迟滞、牵连、田土与反复。',
        螣蛇: '主虚惊、疑虑、反复与牵绊。',
        白虎: '主压力、伤病、是非与急事。',
        玄武: '主隐情、暗事、拖延与虚实难辨。',
    };
    return meanings[liuShen] || '需结合六亲、旺衰与动变判断。';
}

export function getLiuQinMeaning(liuQin: LiuQin): string {
    const meanings: Record<LiuQin, string> = {
        父母: '文书、证件、长辈、学业、房屋车辆',
        兄弟: '同辈、合作、竞争、分财',
        子孙: '子女后辈、成果、医药、解忧',
        妻财: '钱财、资源、交易、经营、男测感情线索',
        官鬼: '事业、规则、压力、风险、疾病、女测感情线索',
    };
    return meanings[liuQin];
}
