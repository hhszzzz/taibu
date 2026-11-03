/**
 * 从 Markdown 文本中提取可视化代码块
 *
 * AI 回复中的图表数据以 ```chart ... ``` 格式嵌入，沙箱 HTML 以 ```visual ... ``` 嵌入。
 * 此工具函数提取并解析这些块，用于图表数据复用与可视化渲染。
 */

import type {
    ChartData,
    ChartType,
    FortuneRadarData,
    LifeFortuneTrendData,
    WuxingElement,
    WuxingEnergyData,
} from '@/lib/visualization/chart-types';
import { getDimensionConfig, normalizeDimensionKey } from '@/lib/visualization/dimensions';

const CHART_BLOCK_REGEX = /```chart\s*\n([\s\S]*?)```/g;

type FortuneRadarPayload = FortuneRadarData['data'];
type FortuneRadarScores = FortuneRadarPayload['scores'];
type LifeFortuneTrendPayload = LifeFortuneTrendData['data'];
type WuxingEnergyPayload = WuxingEnergyData['data'];
type LifeFortuneTrendPeriod = LifeFortuneTrendPayload['periods'][number];
type LifeFortuneTrendYearlyScore = NonNullable<LifeFortuneTrendPeriod['yearlyScores']>[number];
type LifeFortuneTrendTurningDirection = LifeFortuneTrendPayload['lifeHighlight']['nextTurningPoint']['direction'];

export interface ExtractedChart {
    chartType: ChartType;
    title: string;
    raw: ChartData;
}

/** ```visual 代码块的上限（UTF-8 字节）；超过时不渲染，只给源码。 */
export const VISUAL_BLOCK_MAX_BYTES = 64 * 1024;

const VISUAL_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*visual(?:[ \t].*)?$/u;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const VISUAL_TITLE_LINE = /^\s*<!--\s*(.*?)\s*-->\s*$/u;

export interface VisualBlock {
    /** 首行 `<!-- 标题 -->` 注释里的标题；没有则为空串。 */
    title: string;
    /** 去掉标题注释后的 HTML 片段。 */
    html: string;
    /** HTML 片段的 UTF-8 字节数。 */
    bytes: number;
    /** 开围栏之后始终没有闭合围栏时为 false。 */
    complete: boolean;
    /** 超过 {@link VISUAL_BLOCK_MAX_BYTES}。 */
    tooLarge: boolean;
    /** 围栏内的原文，用于和渲染出的代码节点对上。 */
    raw: string;
}

/** 解析单个 ```visual 代码块的正文：可选首行标题注释、大小上限。 */
export function parseVisualSource(source: string): Omit<VisualBlock, 'complete' | 'raw'> {
    const normalized = source.replace(/\r\n?/gu, '\n');
    const [firstLine = '', ...rest] = normalized.split('\n');
    const titleMatch = VISUAL_TITLE_LINE.exec(firstLine);
    const title = titleMatch?.[1].trim() ?? '';
    const html = (titleMatch ? rest.join('\n') : normalized).trim();
    const bytes = utf8Bytes(html);
    return { title, html, bytes, tooLarge: bytes > VISUAL_BLOCK_MAX_BYTES };
}

/**
 * 从 markdown 中取出所有 ```visual 块。没有闭合的块以 complete=false 返回，
 * 由调用方按「内容不完整」处理；旧的 ```chart 不受影响。
 */
export function extractVisualBlocks(markdown: string): VisualBlock[] {
    const lines = markdown.split(/\r?\n/u);
    const blocks: VisualBlock[] = [];
    for (let index = 0; index < lines.length; index++) {
        const open = VISUAL_FENCE_OPEN.exec(lines[index]);
        if (!open) continue;
        const marker = open[1][0];
        const length = open[1].length;
        let end = lines.length;
        let complete = false;
        for (let cursor = index + 1; cursor < lines.length; cursor++) {
            const close = FENCE_CLOSE.exec(lines[cursor]);
            if (close && close[1][0] === marker && close[1].length >= length) {
                end = cursor;
                complete = true;
                break;
            }
        }
        const raw = lines.slice(index + 1, end).join('\n');
        blocks.push({ ...parseVisualSource(raw), complete, raw });
        index = end;
    }
    return blocks;
}

/** 把 ```chart 的 JSON 正文解析为 ChartData；不合法时返回 null。 */
export function parseChartSource(source: string): ChartData | null {
    const json = source.trim();
    if (!json) return null;
    try {
        const parsed = JSON.parse(json) as ChartData;
        if (parsed && typeof parsed.chartType === 'string') {
            // 旧消息可能没写 title；卡片标题栏会用「图表」兜底，不因此判为解析失败。
            return normalizeChartData({ ...parsed, title: typeof parsed.title === 'string' ? parsed.title : '' });
        }
    } catch {
        // Malformed chart JSON falls back to the source view.
    }
    return null;
}

function utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).length;
}

/**
 * 从 markdown 文本中提取所有 chart 块并解析为 ChartData。
 * 无效 JSON 会被静默跳过。
 */
export function extractChartBlocks(markdown: string): ExtractedChart[] {
    const results: ExtractedChart[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    CHART_BLOCK_REGEX.lastIndex = 0;

    while ((match = CHART_BLOCK_REGEX.exec(markdown)) !== null) {
        const jsonStr = match[1]?.trim();
        if (!jsonStr) continue;

        try {
            const parsed = JSON.parse(jsonStr) as ChartData;
            if (parsed && typeof parsed.chartType === 'string' && typeof parsed.title === 'string') {
                const normalized = normalizeChartData(parsed);
                results.push({
                    chartType: normalized.chartType,
                    title: normalized.title,
                    raw: normalized,
                });
            }
        } catch {
            // Skip malformed chart blocks
        }
    }

    return results;
}

/**
 * 从对话 messages 数组中提取所有 AI 回复里的 chart 数据。
 * 返回去重后的图表列表（按 chartType + title 去重，保留最新的）。
 */
export function extractChartsFromMessages(
    messages: Array<{ role: string; content: string }>,
): ExtractedChart[] {
    const seen = new Map<string, ExtractedChart>();

    for (const msg of messages) {
        if (msg.role !== 'assistant') continue;
        const charts = extractChartBlocks(msg.content);
        for (const chart of charts) {
            // Later messages override earlier ones for the same chart type + title
            seen.set(`${chart.chartType}:${chart.title}`, chart);
        }
    }

    return Array.from(seen.values());
}

/**
 * 将提取的图表数据格式化为可注入 AI prompt 的参考文本。
 * 用于在对话中引用之前生成的图表，避免 AI 重复生成。
 */
export function formatPreviousChartsForPrompt(charts: ExtractedChart[], maxCharts = 3): string {
    if (charts.length === 0) return '';

    const selected = charts.slice(-maxCharts);
    const lines = selected.map((chart) => {
        return `- ${chart.title} (${chart.chartType})`;
    });

    return [
        '用户之前的分析中已生成以下图表，如果与当前问题相关，可以参考或更新其中的数据，而不必从头生成：',
        ...lines,
    ].join('\n');
}

export function normalizeChartData(chart: ChartData): ChartData {
    const data = asRecord(chart.data);
    if (!data) return chart;

    if (chart.chartType === 'fortune_radar') {
        return {
            ...chart,
            data: normalizeFortuneRadarData(data),
        };
    }

    if (chart.chartType === 'life_fortune_trend') {
        return {
            ...chart,
            data: normalizeLifeFortuneTrendData(data),
        };
    }

    if (chart.chartType === 'wuxing_energy') {
        return {
            ...chart,
            data: normalizeWuxingEnergyData(data),
        };
    }

    return chart;
}

function normalizeFortuneRadarData(data: Record<string, unknown>): FortuneRadarPayload {
    const scores = normalizeRadarScores(data.scores);
    const previousScores = normalizeNumericDimensionScores(data.previousScores);
    const computedOverall = average(Object.values(scores).map((entry) => entry.score));

    return {
        ...data,
        period: normalizeString(data.period),
        scores,
        previousScores,
        overallScore: normalizeScore(data.overallScore) ?? computedOverall ?? 0,
        overallLabel: normalizeString(data.overallLabel),
        topAdvice: normalizeString(data.topAdvice),
    };
}

function normalizeLifeFortuneTrendData(data: Record<string, unknown>): LifeFortuneTrendPayload {
    const currentAge = toFiniteNumber(data.currentAge);
    const currentYear = toFiniteNumber(data.currentYear);
    const rawPeriods = Array.isArray(data.periods) ? data.periods : [];

    const periods = rawPeriods
        .map((period, index) => normalizeLifeFortuneTrendPeriod(asRecord(period), index, currentAge, currentYear))
        .filter((period): period is NonNullable<typeof period> => period !== null);

    const rawLifeHighlight = asRecord(data.lifeHighlight);
    const rawBestPeriod = asRecord(rawLifeHighlight?.bestPeriod);
    const rawTurningPoint = asRecord(rawLifeHighlight?.nextTurningPoint);
    const normalizedTurningAge = toFiniteNumber(rawTurningPoint?.age);
    const normalizedDirection: LifeFortuneTrendTurningDirection | undefined =
        rawTurningPoint?.direction === 'up' || rawTurningPoint?.direction === 'down'
        ? rawTurningPoint.direction
        : undefined;
    // 模型偶尔把 lifeHighlight 写成一句话；放进「当前状态」，而不是整张图报错。
    const highlightText = typeof data.lifeHighlight === 'string' ? data.lifeHighlight.trim() : '';

    return {
        ...data,
        currentAge: currentAge ?? Number.NaN,
        currentYear: currentYear ?? Number.NaN,
        periods,
        lifeHighlight: {
            bestPeriod: {
                label: normalizeString(rawBestPeriod?.label),
                ages: normalizeString(rawBestPeriod?.ages),
                reason: normalizeString(rawBestPeriod?.reason),
            },
            currentStatus: normalizeString(rawLifeHighlight?.currentStatus, highlightText),
            nextTurningPoint: {
                age: normalizedTurningAge ?? Number.NaN,
                direction: normalizedDirection ?? 'up',
                reason: normalizeString(rawTurningPoint?.reason),
            },
        },
    };
}

function normalizeLifeFortuneTrendPeriod(
    period: Record<string, unknown> | undefined,
    index: number,
    currentAge: number | undefined,
    currentYear: number | undefined,
): LifeFortuneTrendPeriod | null {
    if (!period) return null;

    const scores = normalizeNumericDimensionScores(period.scores);
    const overall = normalizeScore(period.overall ?? period.score);
    const yearlyScores = normalizeYearlyScores(period.yearlyScores);
    const parsedAgeRange = parseAgeRange(period.ageRange ?? period.age ?? period.ages);
    const inferredStartAge = yearlyScores[0]?.age;
    const inferredEndAge = yearlyScores[yearlyScores.length - 1]?.age;
    const normalizedAgeRange = normalizeAscendingPair(
        toFiniteNumber(period.startAge) ?? parsedAgeRange?.[0] ?? inferredStartAge,
        toFiniteNumber(period.endAge) ?? parsedAgeRange?.[1] ?? inferredEndAge,
    );

    if (Object.keys(scores).length === 0 && overall == null && !normalizedAgeRange && yearlyScores.length === 0) {
        return null;
    }

    const inferredStartYear = yearlyScores[0]?.year;
    const inferredEndYear = yearlyScores[yearlyScores.length - 1]?.year;
    const normalizedYearRange = normalizeAscendingPair(
        toFiniteNumber(period.startYear) ?? inferredStartYear,
        toFiniteNumber(period.endYear) ?? inferredEndYear,
    );

    const startAge = normalizedAgeRange?.[0] ?? inferredStartAge ?? Number.NaN;
    const endAge = normalizedAgeRange?.[1] ?? inferredEndAge ?? Number.NaN;
    const startYear = normalizedYearRange?.[0]
        ?? inferYearFromAge(startAge, currentAge, currentYear)
        ?? Number.NaN;
    const endYear = normalizedYearRange?.[1]
        ?? inferYearFromAge(endAge, currentAge, currentYear)
        ?? Number.NaN;

    return {
        label: normalizeString(period.label ?? period.name, `阶段${index + 1}`),
        startAge,
        endAge,
        startYear,
        endYear,
        scores,
        overall,
        summary: normalizeString(period.summary ?? period.description ?? period.desc),
        highlights: normalizeStringArray(period.highlights),
        warnings: normalizeStringArray(period.warnings),
        yearlyScores,
    };
}

/** 解析「22-31」「22–31岁」「22至31」这类大运年龄段。 */
function parseAgeRange(value: unknown): readonly [number, number] | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /(\d+)\s*(?:[-–—~至到]|岁\s*[-–—~至到])\s*(\d+)/u.exec(value);
    if (!match) return undefined;
    return normalizeAscendingPair(Number(match[1]), Number(match[2]));
}

const WUXING_KEYS: WuxingElement[] = ['wood', 'fire', 'earth', 'metal', 'water'];
const WUXING_KEY_BY_LABEL: Record<string, WuxingElement> = {
    木: 'wood', 火: 'fire', 土: 'earth', 金: 'metal', 水: 'water',
    wood: 'wood', fire: 'fire', earth: 'earth', metal: 'metal', water: 'water',
};

/** 兼容模型把 elements 写成 [{name,value}]、分数用汉字元素名或带注解的写法。 */
function normalizeWuxingElementKey(value: unknown): WuxingElement | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (WUXING_KEY_BY_LABEL[text]) return WUXING_KEY_BY_LABEL[text];
    const head = text.charAt(0);
    return WUXING_KEY_BY_LABEL[head];
}

function normalizeWuxingEnergyData(data: Record<string, unknown>): WuxingEnergyPayload {
    const raw = data.elements;
    const strengths = new Map<WuxingElement, number>();
    const levels = new Map<WuxingElement, string>();
    const stars = new Map<WuxingElement, string[]>();

    if (Array.isArray(raw)) {
        for (const item of raw) {
            const record = asRecord(item);
            if (!record) continue;
            const key = normalizeWuxingElementKey(record.name ?? record.element ?? record.key);
            const strength = normalizeScore(record.strength ?? record.value ?? record.score);
            if (!key || strength == null) continue;
            strengths.set(key, strength);
            const level = normalizeString(record.level);
            if (level) levels.set(key, level);
            const normalizedStars = normalizeStringArray(record.stars);
            if (normalizedStars.length > 0) stars.set(key, normalizedStars);
        }
    } else {
        const record = asRecord(raw);
        if (record) {
            for (const [rawKey, rawValue] of Object.entries(record)) {
                const key = normalizeWuxingElementKey(rawKey);
                if (!key) continue;
                const value = asRecord(rawValue);
                const strength = normalizeScore(value?.strength ?? value?.value ?? value?.score ?? rawValue);
                if (strength == null) continue;
                strengths.set(key, strength);
                const level = normalizeString(value?.level);
                if (level) levels.set(key, level);
                const normalizedStars = normalizeStringArray(value?.stars);
                if (normalizedStars.length > 0) stars.set(key, normalizedStars);
            }
        }
    }

    const total = [...strengths.values()].reduce((sum, value) => sum + value, 0);
    const elements = Object.fromEntries(WUXING_KEYS.map((key) => {
        const strength = strengths.get(key) ?? 0;
        const share = total > 0 ? strength / total : 0;
        const level = levels.get(key) ?? (share >= 0.25 ? '旺' : share <= 0.1 ? '弱' : '平');
        return [key, { strength, level, stars: stars.get(key) ?? [] }];
    })) as WuxingEnergyPayload['elements'];

    const strongest = [...strengths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const weakest = [...strengths.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];

    return {
        ...data,
        elements,
        favorableElement: normalizeWuxingElementKey(data.favorableElement) ?? strongest ?? 'wood',
        unfavorableElement: normalizeWuxingElementKey(data.unfavorableElement) ?? weakest ?? 'wood',
        advice: normalizeString(data.advice),
        interactions: normalizeWuxingInteractions(data.interactions),
    };
}

function normalizeWuxingInteractions(input: unknown): WuxingEnergyPayload['interactions'] {
    if (!Array.isArray(input)) return [];
    const result: WuxingEnergyPayload['interactions'] = [];
    for (const item of input) {
        if (typeof item === 'string') {
            const impact = item.trim();
            if (impact) result.push({ impact });
            continue;
        }
        const record = asRecord(item);
        if (!record) continue;
        const impact = normalizeString(record.impact ?? record.description ?? record.detail);
        if (!impact) continue;
        result.push({
            from: normalizeWuxingElementKey(record.from),
            to: normalizeWuxingElementKey(record.to),
            type: normalizeString(record.type),
            impact,
        });
    }
    return result;
}

function normalizeRadarScores(input: unknown): FortuneRadarScores {
    const rawScores = asRecord(input);
    if (!rawScores) return {};

    const result: FortuneRadarScores = {};
    for (const [rawKey, rawValue] of Object.entries(rawScores)) {
        const key = normalizeDimensionKey(rawKey);
        if (!key) continue;

        const score = normalizeScore(asRecord(rawValue)?.score ?? rawValue);
        if (score == null) continue;

        result[key] = {
            score,
            label: normalizeString(asRecord(rawValue)?.label, getDimensionConfig(key).label),
            trend: normalizeTrend(asRecord(rawValue)?.trend),
        };
    }

    return result;
}

function normalizeNumericDimensionScores(input: unknown): LifeFortuneTrendPeriod['scores'] {
    const rawScores = asRecord(input);
    if (!rawScores) return {};

    const result: LifeFortuneTrendPeriod['scores'] = {};
    for (const [rawKey, rawValue] of Object.entries(rawScores)) {
        const key = normalizeDimensionKey(rawKey);
        if (!key) continue;

        const score = normalizeScore(asRecord(rawValue)?.score ?? rawValue);
        if (score == null) continue;
        result[key] = score;
    }

    return result;
}

function normalizeYearlyScores(input: unknown): LifeFortuneTrendYearlyScore[] {
    if (!Array.isArray(input)) return [];

    return input
        .map((item) => {
            const record = asRecord(item);
            if (!record) return null;

            const age = toFiniteNumber(record.age);
            const year = toFiniteNumber(record.year);
            const overall = normalizeScore(record.overall);
            if (age == null || year == null || overall == null) return null;

            return { age, year, overall };
        })
        .filter((item): item is LifeFortuneTrendYearlyScore => item !== null)
        .sort((a, b) => a.age - b.age || a.year - b.year);
}

function normalizeTrend(value: unknown): 'up' | 'down' | 'stable' {
    return value === 'up' || value === 'down' || value === 'stable' ? value : 'stable';
}

function normalizeString(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    return [];
}

function normalizeScore(value: unknown): number | undefined {
    const parsed = toFiniteNumber(value);
    if (parsed == null) return undefined;
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = Number.parseFloat(trimmed.replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function normalizeAscendingPair(first: number | undefined, second: number | undefined) {
    if (first == null || second == null) return undefined;
    return first <= second ? [first, second] as const : [second, first] as const;
}

function inferYearFromAge(age: number, currentAge: number | undefined, currentYear: number | undefined) {
    if (!Number.isFinite(age) || currentAge == null || currentYear == null) {
        return undefined;
    }

    return currentYear - currentAge + age;
}

function average(values: number[]) {
    if (values.length === 0) return undefined;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}
