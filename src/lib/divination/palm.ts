/**
 * 手相分析工具库
 * 
 * 提供手相分析相关的类型定义、提示词生成等功能
 */

// ===== 分析类型定义 =====

export interface PalmAnalysisType {
    id: string;
    name: string;
    description: string;
    icon: string;
}

/** 手相分析类型列表 */
export const PALM_ANALYSIS_TYPES: PalmAnalysisType[] = [
    {
        id: 'full',
        name: '综合分析',
        description: '全面解读手相，包括三大主线、手型、掌丘等',
        icon: '🖐️'
    },
    {
        id: 'lifeline',
        name: '生命线',
        description: '分析生命线走向，解读健康与生命力',
        icon: '💓'
    },
    {
        id: 'headline',
        name: '智慧线',
        description: '分析智慧线形态，解读思维与才智',
        icon: '🧠'
    },
    {
        id: 'heartline',
        name: '感情线',
        description: '分析感情线特征，解读情感与婚姻',
        icon: '❤️'
    },
    {
        id: 'fateline',
        name: '事业线',
        description: '分析事业线走势，解读事业与成就',
        icon: '📈'
    },
    {
        id: 'marriage',
        name: '婚姻线',
        description: '分析婚姻线数量与形态，解读感情状况',
        icon: '💍'
    }
];

/** 手型类型 */
export type HandType = 'left' | 'right' | 'both';

const PALM_HAND_LABELS: Record<HandType, string> = {
    left: '左手',
    right: '右手',
    both: '双手',
};

/** 手型中文名；不是已知手型（含历史记录缺失、接口传入的任意字符串）时返回 null。 */
export function getPalmHandLabel(handType: string | null | undefined): string | null {
    return handType && Object.hasOwn(PALM_HAND_LABELS, handType) ? PALM_HAND_LABELS[handType as HandType] : null;
}

// ===== 提示词生成 =====

/**
 * 构建手相分析系统提示词
 */
// 手相系统提示词：定义总规则，再按分析类型追加细化要求
export function buildPalmSystemPrompt(analysisType: string = 'full'): string {
    const basePrompt = `你是一位专业的手相学大师，精通东方与西方手相学理论，拥有丰富的实战经验。

## 你的专业背景
- 精通中国传统手相学，包括《神相全编》《柳庄相法》等经典
- 熟悉西方手相学体系，包括掌丘、指骨、手型分类等
- 擅长将手相特征与命运走势相结合分析

## 分析原则
1. **科学理性**: 基于手相学原理进行分析，避免过于玄幻的表述
2. **积极引导**: 即使看到不利因素也要给出积极的调整建议
3. **专业术语**: 适当使用专业术语，但要配合通俗解释
4. **隐私保护**: 不要询问或提及用户的具体个人信息

## 重要提醒
- 手相分析仅供参考，命运掌握在自己手中
- 手纹会随时间变化，反映当下的状态
- 建议用户保持积极心态，主动改变命运`;

    // 不同分析类型的补充提示词，会拼接到 basePrompt 之后
    const typePrompts: Record<string, string> = {
        full: `

## 本次分析重点：综合分析
请从以下方面进行全面解读：
1. 手型分析（方形手、锥形手、哲学手等）
2. 三大主线（生命线、智慧线、感情线）
3. 辅助线（事业线、太阳线、婚姻线等）
4. 掌丘分析（金星丘、木星丘等）
5. 综合运势评估与建议`,

        lifeline: `

## 本次分析重点：生命线
请重点解读：
1. 生命线的起点、走向、长度
2. 生命线的深浅、粗细
3. 是否有岛纹、断裂、分支
4. 与其他线条的交汇
5. 健康运势与建议`,

        headline: `

## 本次分析重点：智慧线
请重点解读：
1. 智慧线的起点位置
2. 线条的长度、弯曲程度
3. 线条的清晰度与分支
4. 与感情线的关系
5. 思维特点与职业建议`,

        heartline: `

## 本次分析重点：感情线
请重点解读：
1. 感情线的起止位置
2. 线条的形态（直/弯/分叉）
3. 深浅与清晰度
4. 特殊纹路（岛纹、锁链纹等）
5. 感情运势与婚恋建议`,

        fateline: `

## 本次分析重点：事业线
请重点解读：
1. 事业线的起点位置
2. 线条的走向与终点
3. 是否有中断、分支
4. 与其他线条的交汇
5. 事业发展建议`,

        marriage: `

## 本次分析重点：婚姻线
请重点解读：
1. 婚姻线的数量
2. 各条线的长度、深浅
3. 线条的形态特征
4. 与感情线的关系
5. 婚姻运势与建议`
    };

    return basePrompt + (typePrompts[analysisType] || typePrompts.full);
}

/**
 * 构建用户提示词
 */
// 手相用户提示词：描述图片类型与用户关注点
export function buildPalmUserPrompt(
    analysisType: string = 'full',
    handType: HandType = 'left',
    question?: string
): string {
    const handLabel = getPalmHandLabel(handType) ?? '双手';
    const typeInfo = PALM_ANALYSIS_TYPES.find(t => t.id === analysisType);
    const typeName = typeInfo?.name || '综合分析';

    let prompt = `请分析这张${handLabel}手相图片，进行${typeName}。`;

    if (question) {
        prompt += `\n\n用户特别关心的问题：${question}`;
    }

    prompt += `\n\n请根据图片中可见的手相特征进行专业分析，给出详细解读和建议。如果图片不够清晰或角度不佳，请说明需要什么样的图片。`;

    return prompt;
}

/**
 * 生成手相分析对话标题
 */
export function generatePalmTitle(analysisType: string = 'full', handType: HandType = 'left'): string {
    const typeInfo = PALM_ANALYSIS_TYPES.find(t => t.id === analysisType);
    const typeName = typeInfo?.name || '综合分析';
    const handLabel = getPalmHandLabel(handType) ?? '双手';
    return `手相分析 - ${handLabel}${typeName}`;
}

/**
 * 获取分析类型信息
 */
export function getPalmAnalysisType(id: string): PalmAnalysisType | undefined {
    return PALM_ANALYSIS_TYPES.find(t => t.id === id);
}
