/**
 * MBTI 性格测试核心库
 * 
 * 包含测试题库、性格计算逻辑、16 种性格类型定义
 */

// MBTI 四个维度
export type Dimension = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P';

// 16种人格类型
export type MBTIType =
    | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
    | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
    | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
    | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP';

// 问题选项
export interface MBTIChoice {
    value: Dimension;
    text: string;
}

// 问题
export interface MBTIQuestion {
    question: string;
    choice_a: MBTIChoice;
    choice_b: MBTIChoice;
}

// 人格描述 sections
export interface PersonalitySections {
    概览?: string;
    性格特点?: string;
    处事特点?: string;
    优势?: string;
    劣势?: string;
    生活?: string;
    看法?: string;
    领导能力?: string;
    适合的职业?: string;
    [key: string]: string | undefined;
}

// 人格数据
export interface PersonalityData {
    type: MBTIType;
    sections: PersonalitySections;
}

// Likert 量表值 (1=强烈同意A, 4=中立, 7=强烈同意B)
export type LikertValue = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// 测试答案 (使用 Likert 量表)
export interface TestAnswer {
    questionIndex: number;
    likertValue: LikertValue;  // 1-7 量表值
}

// 测试结果
export interface TestResult {
    type: MBTIType;
    scores: {
        E: number;
        I: number;
        S: number;
        N: number;
        T: number;
        F: number;
        J: number;
        P: number;
    };
    percentages: {
        EI: { E: number; I: number };
        SN: { S: number; N: number };
        TF: { T: number; F: number };
        JP: { J: number; P: number };
    };
}

// 16种人格类型基本信息
export const PERSONALITY_BASICS: Record<MBTIType, { name: string; title: string; emoji: string; description: string }> = {
    INTJ: { name: 'INTJ', title: '策略家', emoji: '🧠', description: '富有想象力和战略性的思想家，有着明确的计划' },
    INTP: { name: 'INTP', title: '逻辑学家', emoji: '🔬', description: '创新型发明家，对知识有着永恒的渴望' },
    ENTJ: { name: 'ENTJ', title: '指挥官', emoji: '👔', description: '大胆、富有想象力的领导者，总能找到或创造解决方案' },
    ENTP: { name: 'ENTP', title: '辩论家', emoji: '💡', description: '聪明好奇的思想家，无法抵抗智力挑战' },
    INFJ: { name: 'INFJ', title: '提倡者', emoji: '🌟', description: '安静而神秘的理想主义者，鼓舞人心' },
    INFP: { name: 'INFP', title: '调停者', emoji: '🌸', description: '诗意、善良的利他主义者，总在寻求帮助他人' },
    ENFJ: { name: 'ENFJ', title: '主人公', emoji: '🎭', description: '魅力四射的领导者，能够感染和激励听众' },
    ENFP: { name: 'ENFP', title: '活动家', emoji: '🎉', description: '热情、创造性的自由精神，总能找到理由微笑' },
    ISTJ: { name: 'ISTJ', title: '物流师', emoji: '📋', description: '实际且注重事实的人，可靠性不容置疑' },
    ISFJ: { name: 'ISFJ', title: '守卫者', emoji: '🛡️', description: '非常专注和温暖的守护者，随时准备保护亲人' },
    ESTJ: { name: 'ESTJ', title: '总经理', emoji: '📊', description: '卓越的管理者，在管理事务或人员方面无与伦比' },
    ESFJ: { name: 'ESFJ', title: '执政官', emoji: '👨‍👩‍👧‍👦', description: '关心他人，社交且受欢迎，总是热心帮助' },
    ISTP: { name: 'ISTP', title: '鉴赏家', emoji: '🔧', description: '勇敢而实际的实验者，掌握各种工具' },
    ISFP: { name: 'ISFP', title: '探险家', emoji: '🎨', description: '灵活迷人的艺术家，随时准备探索和体验新事物' },
    ESTP: { name: 'ESTP', title: '企业家', emoji: '🚀', description: '聪明、精力充沛的人，喜欢冒险' },
    ESFP: { name: 'ESFP', title: '表演者', emoji: '🎤', description: '自发、精力充沛的表演者，生活永不无聊' },
};

/**
 * 从题库文件加载问题（在客户端使用 fetch）
 */
export async function loadQuestions(): Promise<MBTIQuestion[]> {
    try {
        const response = await fetch('/mbti/questions/output.txt');
        const text = await response.text();
        return JSON.parse(text) as MBTIQuestion[];
    } catch (error) {
        console.error('加载 MBTI 题库失败:', error);
        return [];
    }
}

/**
 * 加载人格详细数据
 */
export async function loadPersonalityData(type: MBTIType): Promise<PersonalityData | null> {
    try {
        const response = await fetch(`/mbti/personalities/${type}.json`);
        const data = await response.json();
        return data as PersonalityData;
    } catch (error) {
        console.error(`加载 ${type} 人格数据失败:`, error);
        return null;
    }
}

/**
 * Likert 量表权重映射
 * 1 = 强烈同意 choice_a (+3)
 * 2 = 同意 choice_a (+2)
 * 3 = 略同意 choice_a (+1)
 * 4 = 中立 (0)
 * 5 = 略同意 choice_b (+1)
 * 6 = 同意 choice_b (+2)
 * 7 = 强烈同意 choice_b (+3)
 */
const LIKERT_WEIGHTS: Record<LikertValue, { a: number; b: number }> = {
    1: { a: 3, b: 0 },
    2: { a: 2, b: 0 },
    3: { a: 1, b: 0 },
    4: { a: 0, b: 0 },
    5: { a: 0, b: 1 },
    6: { a: 0, b: 2 },
    7: { a: 0, b: 3 },
};

/**
 * 计算测试结果 (使用 Likert 加权计分)
 */
export function calculateResult(questions: MBTIQuestion[], answers: TestAnswer[]): TestResult {
    // 初始化分数
    const scores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };

    // 统计每个维度的加权分数
    for (const answer of answers) {
        const question = questions[answer.questionIndex];
        if (!question) continue;

        const weights = LIKERT_WEIGHTS[answer.likertValue];
        const dimA = question.choice_a.value as Dimension;
        const dimB = question.choice_b.value as Dimension;

        scores[dimA] += weights.a;
        scores[dimB] += weights.b;
    }

    // 确定每个维度的倾向
    const type = [
        scores.E >= scores.I ? 'E' : 'I',
        scores.S >= scores.N ? 'S' : 'N',
        scores.T >= scores.F ? 'T' : 'F',
        scores.J >= scores.P ? 'J' : 'P',
    ].join('') as MBTIType;

    // 计算百分比
    const calcPercent = (a: number, b: number) => {
        const total = a + b;
        if (total === 0) return { a: 50, b: 50 };
        return { a: Math.round((a / total) * 100), b: Math.round((b / total) * 100) };
    };

    const eiPercent = calcPercent(scores.E, scores.I);
    const snPercent = calcPercent(scores.S, scores.N);
    const tfPercent = calcPercent(scores.T, scores.F);
    const jpPercent = calcPercent(scores.J, scores.P);

    return {
        type,
        scores,
        percentages: {
            EI: { E: eiPercent.a, I: eiPercent.b },
            SN: { S: snPercent.a, N: snPercent.b },
            TF: { T: tfPercent.a, F: tfPercent.b },
            JP: { J: jpPercent.a, P: jpPercent.b },
        },
    };
}

// ===== 答题分页 =====

/** 每页题数：设计稿 MbtiTest 一屏三题 */
export const MBTI_QUESTIONS_PER_PAGE = 3;

export interface MBTIPageState {
    /** 本页题目的全局下标区间 [start, end) */
    start: number;
    end: number;
    totalPages: number;
    isLastPage: boolean;
    /** 本页第一道未答题的全局下标；本页已答完时为 null */
    firstUnanswered: number | null;
}

/** 某页的题目区间与作答状态；页码越界时夹到有效范围，题库为空时视为只有一页空页。 */
export function getMBTIPageState(
    page: number,
    totalQuestions: number,
    answered: ReadonlySet<number>,
    perPage: number = MBTI_QUESTIONS_PER_PAGE,
): MBTIPageState {
    const pageSize = Math.max(1, Math.floor(perPage) || 1);
    const questionCount = Math.max(0, Math.floor(totalQuestions) || 0);
    const totalPages = Math.max(1, Math.ceil(questionCount / pageSize));
    const safePage = Math.min(Math.max(0, Math.floor(page) || 0), totalPages - 1);
    const start = safePage * pageSize;
    const end = Math.min(start + pageSize, questionCount);
    let firstUnanswered: number | null = null;
    for (let index = start; index < end; index += 1) {
        if (!answered.has(index)) {
            firstUnanswered = index;
            break;
        }
    }
    return { start, end, totalPages, isLastPage: safePage === totalPages - 1, firstUnanswered };
}

/** 记录一道题的作答；再次点选同一档位视为取消作答。返回新数组，不修改入参。 */
export function toggleMBTIAnswer(answers: readonly TestAnswer[], questionIndex: number, likertValue: LikertValue): TestAnswer[] {
    const existing = answers.find(answer => answer.questionIndex === questionIndex);
    if (existing?.likertValue === likertValue) {
        return answers.filter(answer => answer.questionIndex !== questionIndex);
    }
    const next: TestAnswer = { questionIndex, likertValue };
    return existing
        ? answers.map(answer => (answer.questionIndex === questionIndex ? next : answer))
        : [...answers, next];
}

/**
 * 获取维度描述
 */
export function getDimensionDescription(dimension: Dimension): { name: string; description: string } {
    const descriptions: Record<Dimension, { name: string; description: string }> = {
        E: { name: '外向', description: '从与他人互动中获取能量' },
        I: { name: '内向', description: '从独处和内省中获取能量' },
        S: { name: '实感', description: '关注实际和具体的信息' },
        N: { name: '直觉', description: '关注可能性和未来' },
        T: { name: '思考', description: '基于逻辑和客观分析做决定' },
        F: { name: '情感', description: '基于价值观和人际考量做决定' },
        J: { name: '判断', description: '喜欢有计划和有组织的生活' },
        P: { name: '知觉', description: '喜欢灵活和开放的生活方式' },
    };
    return descriptions[dimension];
}

/**
 * 获取随机问题子集（用于简化测试）
 */
export function getRandomQuestions(questions: MBTIQuestion[], count: number = 28): MBTIQuestion[] {
    // 确保每个维度对都有足够的问题
    const dimensionQuestions: Record<string, MBTIQuestion[]> = {
        'EI': [],
        'SN': [],
        'TF': [],
        'JP': [],
    };

    // 分类问题
    for (const q of questions) {
        const dim = q.choice_a.value;
        if (dim === 'E' || dim === 'I') dimensionQuestions['EI'].push(q);
        else if (dim === 'S' || dim === 'N') dimensionQuestions['SN'].push(q);
        else if (dim === 'T' || dim === 'F') dimensionQuestions['TF'].push(q);
        else if (dim === 'J' || dim === 'P') dimensionQuestions['JP'].push(q);
    }

    // 从每个维度随机选择
    const perDimension = Math.floor(count / 4);
    const selected: MBTIQuestion[] = [];

    for (const key of Object.keys(dimensionQuestions)) {
        const pool = dimensionQuestions[key];
        const shuffled = pool.sort(() => Math.random() - 0.5);
        selected.push(...shuffled.slice(0, perDimension));
    }

    // 打乱顺序
    return selected.sort(() => Math.random() - 0.5);
}

/**
 * 构建查看模式的默认结果数据
 */
export function buildViewResult(type: string): TestResult | null {
    if (!Object.prototype.hasOwnProperty.call(PERSONALITY_BASICS, type)) {
        return null;
    }

    const defaultScores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
    const defaultPercentages = {
        EI: { E: 50, I: 50 },
        SN: { S: 50, N: 50 },
        TF: { T: 50, F: 50 },
        JP: { J: 50, P: 50 },
    };

    return {
        type: type as MBTIType,
        scores: defaultScores,
        percentages: defaultPercentages,
    };
}
