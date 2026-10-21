import type { FiveElement } from '@/types';

export const BAZI_CASE_STRENGTH_LEVELS = ['极弱', '偏弱', '中和', '偏强', '极强', '从格'] as const;
export const BAZI_CASE_PATTERN_OPTIONS = [
    '正官格',
    '七杀格',
    '财格',
    '印格',
    '食神格',
    '伤官格',
    '从强格',
    '从弱格',
    '专旺格',
    '调候为先',
    '寒湿偏重',
    '燥热偏重',
] as const;
export const BAZI_CASE_BASIC_ELEMENTS = ['金', '木', '水', '火', '土'] as const satisfies readonly FiveElement[];

export const BAZI_CASE_OCCUPATION_OPTIONS = [
    '上班族',
    '自由职业',
    '创业/经商',
    '体制内',
    '学生',
    '待业/转型',
    '退休',
    '其他',
] as const;
export const BAZI_CASE_EDUCATION_OPTIONS = [
    '小学及以下',
    '初中',
    '高中/中专',
    '大专',
    '本科',
    '硕士',
    '博士及以上',
] as const;
export const BAZI_CASE_WEALTH_LEVEL_OPTIONS = [
    '拮据',
    '一般',
    '小康',
    '宽裕',
    '富足',
    '波动较大',
] as const;
export const BAZI_CASE_MARRIAGE_STATUS_OPTIONS = [
    '未婚',
    '恋爱中',
    '已婚',
    '离异',
    '丧偶',
    '复杂状态',
] as const;
export const BAZI_CASE_HEALTH_STATUS_OPTIONS = [
    '健康稳定',
    '阶段性波动',
    '慢性问题',
    '大病恢复期',
    '需重点关注',
] as const;
export const BAZI_CASE_FAMILY_TAG_OPTIONS = [
    '父母助力',
    '父母缘薄',
    '伴侣支持',
    '伴侣波动',
    '子女助力',
    '手足助力',
    '六亲牵绊',
    '异地亲缘',
] as const;
export const BAZI_CASE_TEMPERAMENT_TAG_OPTIONS = [
    '务实',
    '外放',
    '内敛',
    '理性',
    '感性',
    '果断',
    '谨慎',
    '好胜',
    '稳定',
    '敏感',
] as const;
export const BAZI_CASE_EVENT_CATEGORY_OPTIONS = [
    '事业',
    '学业',
    '财富',
    '婚姻',
    '健康',
    '六亲',
    '其他',
] as const;

const STEM_OPTIONS = [
    { stem: '甲', element: '木' },
    { stem: '乙', element: '木' },
    { stem: '丙', element: '火' },
    { stem: '丁', element: '火' },
    { stem: '戊', element: '土' },
    { stem: '己', element: '土' },
    { stem: '庚', element: '金' },
    { stem: '辛', element: '金' },
    { stem: '壬', element: '水' },
    { stem: '癸', element: '水' },
] as const;

const BRANCH_OPTIONS = [
    { branch: '寅', element: '木' },
    { branch: '卯', element: '木' },
    { branch: '巳', element: '火' },
    { branch: '午', element: '火' },
    { branch: '辰', element: '土' },
    { branch: '戌', element: '土' },
    { branch: '丑', element: '土' },
    { branch: '未', element: '土' },
    { branch: '申', element: '金' },
    { branch: '酉', element: '金' },
    { branch: '亥', element: '水' },
    { branch: '子', element: '水' },
] as const;

export const BAZI_CASE_ADVANCED_GOD_OPTIONS = [
    ...STEM_OPTIONS.flatMap(({ stem, element }) => [stem, `${stem}${element}`]),
    ...BRANCH_OPTIONS.flatMap(({ branch, element }) => [branch, `${branch}${element}`]),
] as const;

export type BaziCaseStrengthLevel = typeof BAZI_CASE_STRENGTH_LEVELS[number];
export type BaziCasePattern = string;
export type BaziCaseBasicElement = typeof BAZI_CASE_BASIC_ELEMENTS[number];
export type BaziCaseAdvancedGod = typeof BAZI_CASE_ADVANCED_GOD_OPTIONS[number];
export type BaziCaseOccupation = typeof BAZI_CASE_OCCUPATION_OPTIONS[number];
export type BaziCaseEducation = typeof BAZI_CASE_EDUCATION_OPTIONS[number];
export type BaziCaseWealthLevel = typeof BAZI_CASE_WEALTH_LEVEL_OPTIONS[number];
export type BaziCaseMarriageStatus = typeof BAZI_CASE_MARRIAGE_STATUS_OPTIONS[number];
export type BaziCaseHealthStatus = typeof BAZI_CASE_HEALTH_STATUS_OPTIONS[number];
export type BaziCaseFamilyTag = string;
export type BaziCaseTemperamentTag = string;
export type BaziCaseEventCategory = typeof BAZI_CASE_EVENT_CATEGORY_OPTIONS[number];

export interface BaziCaseGodSelection {
    basic: BaziCaseBasicElement[];
    advanced: BaziCaseAdvancedGod[];
}

export interface BaziCaseMasterReview {
    strengthLevel: BaziCaseStrengthLevel | null;
    patterns: BaziCasePattern[];
    yongShen: BaziCaseGodSelection;
    xiShen: BaziCaseGodSelection;
    jiShen: BaziCaseGodSelection;
    xianShen: BaziCaseGodSelection;
    summary: string;
}

export interface BaziCaseOwnerFeedback {
    occupation: BaziCaseOccupation | null;
    education: BaziCaseEducation | null;
    wealthLevel: BaziCaseWealthLevel | null;
    marriageStatus: BaziCaseMarriageStatus | null;
    healthStatus: BaziCaseHealthStatus | null;
    familyStatusTags: BaziCaseFamilyTag[];
    temperamentTags: BaziCaseTemperamentTag[];
    summary: string;
}

/** The Agent task that wrote an entry and the conversation it ran in, read back for display only. */
export interface BaziCaseSource {
    runId: string;
    conversationId: string | null;
}

export interface BaziCaseEvent {
    id?: string;
    eventDate: string;
    category: BaziCaseEventCategory;
    title: string;
    detail: string;
    createdAt?: string;
    updatedAt?: string;
    /** Recorded by the Agent from the user's own words; kept while the event keeps its ID. */
    source?: BaziCaseSource | null;
}

export interface BaziCaseProfile {
    id?: string;
    chartId?: string;
    userId?: string;
    masterReview: BaziCaseMasterReview;
    ownerFeedback: BaziCaseOwnerFeedback;
    events: BaziCaseEvent[];
    createdAt?: string;
    updatedAt?: string;
    /** The Agent task whose proposal filled the master review, until the review is changed. */
    masterReviewSource?: BaziCaseSource | null;
}

type ObjectLike = Record<string, unknown>;

function isObjectLike(value: unknown): value is ObjectLike {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimText(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
    return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function assertChoice<T extends readonly string[]>(
    value: unknown,
    options: T,
    field: string,
    { allowNull = false }: { allowNull?: boolean } = {},
): T[number] | null {
    if (value == null || value === '') {
        if (allowNull) {
            return null;
        }
        throw new Error(`${field} 不能为空`);
    }
    if (!isOneOf(value, options)) {
        throw new Error(`${field} 包含未收录的值`);
    }
    return value;
}

function assertChoiceArray<T extends readonly string[]>(value: unknown, options: T, field: string): T[number][] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${field} 必须为数组`);
    }
    const unique: T[number][] = [];
    for (const item of value) {
        if (!isOneOf(item, options)) {
            throw new Error(`${field} 包含未收录的值`);
        }
        if (!unique.includes(item)) {
            unique.push(item);
        }
    }
    return unique;
}

function parseTextArray(value: unknown, field: string, maxLength: number): string[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${field} 必须为数组`);
    }
    const unique: string[] = [];
    for (const item of value) {
        const next = trimText(item, maxLength);
        if (!next) {
            continue;
        }
        if (!unique.includes(next)) {
            unique.push(next);
        }
    }
    return unique;
}

function parseGodSelection(value: unknown, field: string): BaziCaseGodSelection {
    if (value == null) {
        return createEmptyGodSelection();
    }
    if (!isObjectLike(value)) {
        throw new Error(`${field} 必须为对象`);
    }
    return {
        basic: assertChoiceArray(value.basic, BAZI_CASE_BASIC_ELEMENTS, `${field}.basic`),
        advanced: assertChoiceArray(value.advanced, BAZI_CASE_ADVANCED_GOD_OPTIONS, `${field}.advanced`),
    };
}

function isValidDateString(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

export function createEmptyGodSelection(): BaziCaseGodSelection {
    return { basic: [], advanced: [] };
}

export function createEmptyBaziCaseMasterReview(): BaziCaseMasterReview {
    return {
        strengthLevel: null,
        patterns: [],
        yongShen: createEmptyGodSelection(),
        xiShen: createEmptyGodSelection(),
        jiShen: createEmptyGodSelection(),
        xianShen: createEmptyGodSelection(),
        summary: '',
    };
}

export function createEmptyBaziCaseOwnerFeedback(): BaziCaseOwnerFeedback {
    return {
        occupation: null,
        education: null,
        wealthLevel: null,
        marriageStatus: null,
        healthStatus: null,
        familyStatusTags: [],
        temperamentTags: [],
        summary: '',
    };
}

export function createEmptyBaziCaseProfile(): BaziCaseProfile {
    return {
        masterReview: createEmptyBaziCaseMasterReview(),
        ownerFeedback: createEmptyBaziCaseOwnerFeedback(),
        events: [],
    };
}

export function parseBaziCaseMasterReview(value: unknown): BaziCaseMasterReview {
    if (!isObjectLike(value)) return createEmptyBaziCaseMasterReview();
    return {
        strengthLevel: assertChoice(value.strengthLevel, BAZI_CASE_STRENGTH_LEVELS, 'masterReview.strengthLevel', { allowNull: true }),
        patterns: parseTextArray(value.patterns, 'masterReview.patterns', 24),
        yongShen: parseGodSelection(value.yongShen, 'masterReview.yongShen'),
        xiShen: parseGodSelection(value.xiShen, 'masterReview.xiShen'),
        jiShen: parseGodSelection(value.jiShen, 'masterReview.jiShen'),
        xianShen: parseGodSelection(value.xianShen, 'masterReview.xianShen'),
        summary: trimText(value.summary, 300),
    };
}

export function parseBaziCaseOwnerFeedback(value: unknown): BaziCaseOwnerFeedback {
    if (!isObjectLike(value)) return createEmptyBaziCaseOwnerFeedback();
    return {
        occupation: assertChoice(value.occupation, BAZI_CASE_OCCUPATION_OPTIONS, 'ownerFeedback.occupation', { allowNull: true }),
        education: assertChoice(value.education, BAZI_CASE_EDUCATION_OPTIONS, 'ownerFeedback.education', { allowNull: true }),
        wealthLevel: assertChoice(value.wealthLevel, BAZI_CASE_WEALTH_LEVEL_OPTIONS, 'ownerFeedback.wealthLevel', { allowNull: true }),
        marriageStatus: assertChoice(value.marriageStatus, BAZI_CASE_MARRIAGE_STATUS_OPTIONS, 'ownerFeedback.marriageStatus', { allowNull: true }),
        healthStatus: assertChoice(value.healthStatus, BAZI_CASE_HEALTH_STATUS_OPTIONS, 'ownerFeedback.healthStatus', { allowNull: true }),
        familyStatusTags: parseTextArray(value.familyStatusTags, 'ownerFeedback.familyStatusTags', 24),
        temperamentTags: parseTextArray(value.temperamentTags, 'ownerFeedback.temperamentTags', 24),
        summary: trimText(value.summary, 300),
    };
}

export function parseBaziCaseEvents(value: unknown): BaziCaseEvent[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw new Error('events 必须为数组');
    }
    return value.map((item, index) => {
        if (!isObjectLike(item)) {
            throw new Error(`events[${index}] 必须为对象`);
        }
        const eventDate = trimText(item.eventDate, 10);
        if (!eventDate || !isValidDateString(eventDate)) {
            throw new Error(`events[${index}].eventDate 格式无效`);
        }
        const category = assertChoice(item.category, BAZI_CASE_EVENT_CATEGORY_OPTIONS, `events[${index}].category`);
        const title = trimText(item.title, 80);
        if (!title) {
            throw new Error(`events[${index}].title 不能为空`);
        }
        const detail = trimText(item.detail, 500);
        return {
            id: typeof item.id === 'string' ? item.id : undefined,
            eventDate,
            category: category as BaziCaseEventCategory,
            title,
            detail,
        };
    });
}

export function parseBaziCaseProfileInput(input: unknown): {
    chartId: string;
    masterReview: BaziCaseMasterReview;
    ownerFeedback: BaziCaseOwnerFeedback;
    events: BaziCaseEvent[];
} {
    if (!isObjectLike(input)) {
        throw new Error('请求体必须为对象');
    }
    const chartId = trimText(input.chartId, 64);
    if (!chartId) {
        throw new Error('chartId 不能为空');
    }
    return {
        chartId,
        masterReview: parseBaziCaseMasterReview(input.masterReview),
        ownerFeedback: parseBaziCaseOwnerFeedback(input.ownerFeedback),
        events: parseBaziCaseEvents(input.events),
    };
}

function formatSelection(label: string, selection: BaziCaseGodSelection): string | null {
    const parts: string[] = [];
    if (selection.basic.length > 0) {
        parts.push(`基础=${selection.basic.join('、')}`);
    }
    if (selection.advanced.length > 0) {
        parts.push(`进阶=${selection.advanced.join('、')}`);
    }
    return parts.length > 0 ? `${label}：${parts.join('；')}` : null;
}

export function formatBaziCaseProfileForAI(profile?: Pick<BaziCaseProfile, 'masterReview' | 'ownerFeedback' | 'events'> | null, maxEvents = 10): string {
    if (!profile) return '';

    const lines: string[] = ['【断事笔记】'];
    const masterReview = parseBaziCaseMasterReview(profile.masterReview);
    const ownerFeedback = parseBaziCaseOwnerFeedback(profile.ownerFeedback);
    const events = parseBaziCaseEvents(profile.events).slice().sort((a, b) => b.eventDate.localeCompare(a.eventDate));

    const masterLines = [
        masterReview.strengthLevel ? `旺衰：${masterReview.strengthLevel}` : null,
        masterReview.patterns.length > 0 ? `格局：${masterReview.patterns.join('、')}` : null,
        formatSelection('用神', masterReview.yongShen),
        formatSelection('喜神', masterReview.xiShen),
        formatSelection('忌神', masterReview.jiShen),
        formatSelection('闲神', masterReview.xianShen),
        masterReview.summary ? `总结：${masterReview.summary}` : null,
    ].filter(Boolean) as string[];

    if (masterLines.length > 0) {
        lines.push('【师傅点评】');
        lines.push(...masterLines);
    }

    const feedbackLines = [
        ownerFeedback.occupation ? `职业：${ownerFeedback.occupation}` : null,
        ownerFeedback.education ? `学历：${ownerFeedback.education}` : null,
        ownerFeedback.wealthLevel ? `财富：${ownerFeedback.wealthLevel}` : null,
        ownerFeedback.marriageStatus ? `婚姻：${ownerFeedback.marriageStatus}` : null,
        ownerFeedback.healthStatus ? `健康：${ownerFeedback.healthStatus}` : null,
        ownerFeedback.familyStatusTags.length > 0 ? `六亲反馈：${ownerFeedback.familyStatusTags.join('、')}` : null,
        ownerFeedback.temperamentTags.length > 0 ? `性情反馈：${ownerFeedback.temperamentTags.join('、')}` : null,
        ownerFeedback.summary ? `总结：${ownerFeedback.summary}` : null,
    ].filter(Boolean) as string[];

    if (feedbackLines.length > 0) {
        lines.push('【命主反馈】');
        lines.push(...feedbackLines);
    }

    if (events.length > 0) {
        lines.push('【关键事件】');
        for (const event of events.slice(0, maxEvents)) {
            const detail = event.detail ? `：${event.detail}` : '';
            lines.push(`- ${event.eventDate}｜${event.category}｜${event.title}${detail}`);
        }
    }

    return lines.length > 1 ? lines.join('\n') : '';
}
