/**
 * AI 人格元数据（客户端/服务端共享）
 *
 * 仅包含展示用的元信息（name / emoji / title / description），
 * 不包含 systemPrompt（server-only，在 ai.ts 中定义）。
 *
 * 这是人格显示信息的唯一来源（Single Source of Truth），
 * 其他模块（prompt-labels、前端组件等）应从此处读取，禁止重复硬编码。
 */

import type { AIPersonality } from '@/types';

export interface AIPersonalityMeta {
    id: AIPersonality;
    name: string;
    title: string;
    description: string;
    emoji: string;
}

export const AI_PERSONALITY_META: Record<AIPersonality, AIPersonalityMeta> = {
    bazi: {
        id: 'bazi',
        name: '八字宗师',
        title: '八字命理分析',
        description: '以月令格局与用神喜忌为纲，结论明确并讲清依据',
        emoji: '🧙‍♂️',
    },
    ziwei: {
        id: 'ziwei',
        name: '紫微斗数',
        title: '紫微斗数分析',
        description: '结构清晰、注重星曜与宫位关系，给出可执行建议',
        emoji: '✨',
    },
    general: {
        id: 'general',
        name: '通用分析',
        title: '综合命理分析',
        description: '擅长多体系综合判断，给出整合建议',
        emoji: '🧭',
    },
    tarot: {
        id: 'tarot',
        name: '塔罗解读师',
        title: '塔罗牌解读',
        description: '精通韦特塔罗，温暖有洞察力，给出具体建议',
        emoji: '🃏',
    },
    liuyao: {
        id: 'liuyao',
        name: '易学大师',
        title: '六爻占卜分析',
        description: '精通周易六爻，以用神为核心进行吉凶断定',
        emoji: '☯️',
    },
    mbti: {
        id: 'mbti',
        name: 'MBTI专家',
        title: 'MBTI性格分析',
        description: '专业心理学视角，结合维度百分比给出个性化建议',
        emoji: '🧠',
    },
    hepan: {
        id: 'hepan',
        name: '合盘分析师',
        title: '八字合盘分析',
        description: '精通八字合盘，给出专业的相处建议',
        emoji: '💑',
    },
    qimen: {
        id: 'qimen',
        name: '奇门遁甲师',
        title: '奇门遁甲分析',
        description: '精通奇门遁甲，以九宫格局、星门神综合断局',
        emoji: '🔮',
    },
    daliuren: {
        id: 'daliuren',
        name: '大六壬师',
        title: '大六壬分析',
        description: '精通三传四课，以类神取用进行分类占断',
        emoji: '📜',
    },
    meihua: {
        id: 'meihua',
        name: '梅花易数师',
        title: '梅花易数分析',
        description: '以体用、动爻与卦象演进为核心，给出结构化判断',
        emoji: '🌸',
    },
    xiaoliuren: {
        id: 'xiaoliuren',
        name: '小六壬师',
        title: '小六壬分析',
        description: '沿月、日、时三步落宫，给出简明而可执行的提示',
        emoji: '🧭',
    },
};
