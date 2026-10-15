/**
 * 运势解读文本库
 *
 * 提供白话/专业/术语三种解读模式的文本模板
 */

import type { InterpretationMode } from '@/components/fortune/InterpretationModeToggle';
import type { FortuneLevel } from '@/types';
import { compareLevels } from './fortune';

// 十神解读模板
export const TEN_GOD_INTERPRETATIONS: Record<string, Record<InterpretationMode, string>> = {
    '比肩': {
        colloquial: '今天适合和朋友合作，互帮互助，一起做事会更顺利。',
        professional: '比肩临日，同辈助力运旺，宜团队协作，但需注意资源分配。',
        technical: '日临比肩，主同类助身，比劫旺地宜合作共事，然比劫争财，防财务纷争。',
    },
    '劫财': {
        colloquial: '今天可能会有意外花销，钱包要捂紧点，别冲动消费。',
        professional: '劫财当令，财运波动，投资需谨慎，防小人争利。',
        technical: '日逢劫财，劫财克正财，主破财之象，忌大额支出及借贷，宜守不宜攻。',
    },
    '食神': {
        colloquial: '创意爆棚的一天！适合发挥才华，好点子特别多。',
        professional: '食神透出，创造力旺盛，利文艺创作，人际关系和谐。',
        technical: '食神泄秀，主才华横溢，食伤生财，利技艺展示，身心愉悦之日。',
    },
    '伤官': {
        colloquial: '思维特别活跃，但说话要注意分寸，容易得罪人。',
        professional: '伤官主事，思维敏捷但锋芒过露，需谨言慎行，防口舌是非。',
        technical: '伤官临日，主聪明伶俐然傲气凌人，伤官见官祸百端，宜收敛锋芒。',
    },
    '偏财': {
        colloquial: '今天运气不错，可能有意外收获！适合尝试新的赚钱机会。',
        professional: '偏财透出，偏财运旺，利投机取巧，有意外之财。',
        technical: '偏财临日，主财缘广进，偏财为意外之财，利经商贸易，投资可期。',
    },
    '正财': {
        colloquial: '努力工作会有好回报，今天适合脚踏实地做事。',
        professional: '正财当令，正财运稳，工作有成，利薪资收入。',
        technical: '日临正财，主勤劳致富，正财为辛勤所得，宜踏实经营，稳扎稳打。',
    },
    '七杀': {
        colloquial: '今天压力可能有点大，但挑战中也藏着机会，加油！',
        professional: '七杀透出，压力与机遇并存，利竞争突破，需果断行动。',
        technical: '七杀临日，主威严肃杀，杀为名利之神，有制则权，无制则灾，宜攻不宜守。',
    },
    '正官': {
        colloquial: '今天贵人运很好，工作上可能得到领导赏识或提拔。',
        professional: '正官得位，贵人运旺，利职场晋升，宜拓展人脉。',
        technical: '正官临日，主官禄显达，官为贵人之星，宜谒贵求名，事业可期。',
    },
    '偏印': {
        colloquial: '适合安静学习、看书、思考人生，别太操心其他事。',
        professional: '偏印主事，利学习研究，思维深邃，宜独处内省。',
        technical: '偏印临日，主玄学智慧，枭神夺食需防，宜学术研究，不利求财。',
    },
    '正印': {
        colloquial: '今天学习运很好，也可能得到长辈的帮助和照顾。',
        professional: '正印透出，学业顺遂，长辈贵人相助，身心安泰。',
        technical: '正印临日，主文昌显达，印星生身，利学业考试，有靠山庇佑。',
    },
};

/** 个性化日运标题：一句话点出流日十神的基调与取舍。 */
export const DAILY_TEN_GOD_HEADLINES: Record<string, string> = {
    '比肩': '比肩助身，宜协作，不宜争先',
    '劫财': '劫财临日，宜守财，不宜冲动',
    '食神': '食神吐秀，宜创作，宜悦己',
    '伤官': '食伤当令，宜表达，不宜硬碰',
    '偏财': '偏财透出，宜把握机缘，不宜贪多',
    '正财': '正财当令，宜踏实经营，稳中求进',
    '七杀': '七杀临身，宜果断应对，不宜意气用事',
    '正官': '正官得位，宜守规矩，利见贵人',
    '偏印': '偏印主事，宜独处深思，少涉杂务',
    '正印': '正印护身，宜学习进修，得长辈相助',
};

/** 流日十神 → 日运标题；十神缺失或无法识别时返回 null，由调用方回退到通用文案。 */
export function getDailyHeadline(tenGod: string | null | undefined): string | null {
    return (tenGod && DAILY_TEN_GOD_HEADLINES[tenGod]) || null;
}

// 运势分数解读
export const SCORE_INTERPRETATIONS: Record<'high' | 'medium' | 'low', Record<InterpretationMode, string>> = {
    high: {
        colloquial: '运势很好，可以大胆行动，把握机会！',
        professional: '运势处于高位，利积极进取，可主动出击。',
        technical: '运势高昂，阳气旺盛，宜攻不宜守，诸事可为。',
    },
    medium: {
        colloquial: '运势平稳，按部就班做事就好。',
        professional: '运势中平，宜稳健行事，不宜冒进。',
        technical: '运势中和，阴阳平衡，宜守常规，静待时机。',
    },
    low: {
        colloquial: '今天宜静不宜动，别做重大决定。',
        professional: '运势低迷，宜韬光养晦，避免冲突。',
        technical: '运势不振，阴气偏盛，宜潜藏固守，避凶趋吉。',
    },
};

// 各维度建议
export const DIMENSION_ADVICE: Record<string, Record<'high' | 'medium' | 'low', Record<InterpretationMode, string>>> = {
    career: {
        high: {
            colloquial: '事业运超旺！有什么想法就大胆去做。',
            professional: '事业运强劲，利职场突破，可争取晋升机会。',
            technical: '官禄临门，事业宫得力，宜进取求名，功名可期。',
        },
        medium: {
            colloquial: '工作按部就班，稳步前进就好。',
            professional: '事业运平稳，宜坚守本职，厚积薄发。',
            technical: '事业宫中和，宜守不宜攻，静待贵人提携。',
        },
        low: {
            colloquial: '职场上要低调，少说多做，避免冲突。',
            professional: '事业运偏弱，需低调行事，防小人暗算。',
            technical: '官禄受损，事业宫不利，宜韬晦避祸，防口舌官非。',
        },
    },
    wealth: {
        high: {
            colloquial: '财运亨通！适合投资理财，但别太贪心。',
            professional: '财运旺盛，利投资经营，可适度扩张。',
            technical: '财星高照，财库充盈，宜进财不宜守财，利商贸活动。',
        },
        medium: {
            colloquial: '财运平平，守住已有的就好。',
            professional: '财运中平，宜稳健理财，不宜投机。',
            technical: '财宫中和，财星不显，宜守财固本，静待财机。',
        },
        low: {
            colloquial: '今天别乱花钱，也别做投资决定。',
            professional: '财运偏弱，需控制支出，防破财之象。',
            technical: '财星受克，财库空虚，忌大额支出，防劫财破财。',
        },
    },
    love: {
        high: {
            colloquial: '桃花运爆棚！单身的有机会脱单哦。',
            professional: '感情运旺，利情感交流，单身者有望遇良缘。',
            technical: '桃花临门，情感宫得力，宜婚恋交际，情缘可期。',
        },
        medium: {
            colloquial: '感情平稳，多陪伴另一半。',
            professional: '感情运平，宜维护现有关系，增进感情。',
            technical: '情感宫中和，桃花不显，宜固守情缘，静待良机。',
        },
        low: {
            colloquial: '今天少争吵，多包容对方。',
            professional: '感情运弱，需多沟通理解，防争执冲突。',
            technical: '桃花受损，情感宫不利，宜隐忍退让，防情感纷争。',
        },
    },
    health: {
        high: {
            colloquial: '精力充沛！适合运动健身。',
            professional: '健康运佳，精力旺盛，利体育锻炼。',
            technical: '身宫得力，元气充沛，宜动不宜静，利养生健体。',
        },
        medium: {
            colloquial: '身体状态正常，保持良好习惯。',
            professional: '健康运平，需保持作息规律，注意饮食。',
            technical: '身宫中和，气血平稳，宜固本培元，调养身心。',
        },
        low: {
            colloquial: '注意休息，别太累了。',
            professional: '健康运弱，需多休息，避免过劳。',
            technical: '身宫受损，元气不足，宜静养调息，忌劳心伤神。',
        },
    },
    social: {
        high: {
            colloquial: '人际关系超好！适合社交聚会。',
            professional: '人际运旺，利社交拓展，贵人运佳。',
            technical: '贵人临门，人缘宫得力，宜广结善缘，贵人相助。',
        },
        medium: {
            colloquial: '人际关系正常，保持和善态度。',
            professional: '人际运平，宜维护现有人脉，不宜冲突。',
            technical: '人缘宫中和，宜守常规交际，静待贵人提携。',
        },
        low: {
            colloquial: '今天少参加应酬，容易遇到不顺心的人。',
            professional: '人际运弱，需避免冲突，防小人是非。',
            technical: '贵人不显，人缘宫不利，宜独处静修，避凶趋吉。',
        },
    },
};

// 关键日期描述
export const KEY_DATE_DESCRIPTIONS: Record<string, Record<InterpretationMode, string>> = {
    '大吉日': {
        colloquial: '超级幸运日，做什么都顺！',
        professional: '诸事皆宜，运势高峰期。',
        technical: '天时地利，诸星拱照，万事亨通。',
    },
    '财运日': {
        colloquial: '财运爆棚，适合理财投资。',
        professional: '财星高照，利求财活动。',
        technical: '财库开启，偏正财俱旺，利商贸进财。',
    },
    '事业吉日': {
        colloquial: '工作顺利，可能有好消息。',
        professional: '官禄临门，利职场发展。',
        technical: '官星得力，权禄加身，宜谒贵求名。',
    },
    '桃花日': {
        colloquial: '桃花运来了，注意身边的人哦。',
        professional: '桃花星动，利情感交流。',
        technical: '红鸾星动，姻缘可期，宜婚恋社交。',
    },
    '转运日': {
        colloquial: '运势开始回升，好运要来了！',
        professional: '运势转折点，否极泰来。',
        technical: '阴极阳生，运势回春，宜图新谋变。',
    },
    '需谨慎': {
        colloquial: '今天小心点，别冲动行事。',
        professional: '运势转弱，宜谨慎行事。',
        technical: '阳极阴生，运势回落，宜守不宜攻。',
    },
};

/**
 * 根据模式获取十神解读
 */
export function getTenGodInterpretation(tenGod: string, mode: InterpretationMode): string {
    return TEN_GOD_INTERPRETATIONS[tenGod]?.[mode] || TEN_GOD_INTERPRETATIONS['比肩'][mode];
}

/**
 * 根据分数获取运势等级
 */
export function getScoreLevel(level: FortuneLevel): 'high' | 'medium' | 'low' {
    if (compareLevels(level, '吉') >= 0) return 'high';
    if (compareLevels(level, '平') >= 0) return 'medium';
    return 'low';
}

/**
 * 根据模式获取分数解读
 */
export function getScoreInterpretation(level: FortuneLevel, mode: InterpretationMode): string {
    const grade = getScoreLevel(level);
    return SCORE_INTERPRETATIONS[grade][mode];
}

/**
 * 根据模式获取维度建议
 */
export function getDimensionAdvice(
    dimension: 'career' | 'wealth' | 'love' | 'health' | 'social',
    level: FortuneLevel,
    mode: InterpretationMode
): string {
    const grade = getScoreLevel(level);
    return DIMENSION_ADVICE[dimension]?.[grade]?.[mode] || '';
}

/**
 * 根据模式获取关键日期描述
 */
export function getKeyDateDescription(desc: string, mode: InterpretationMode): string {
    return KEY_DATE_DESCRIPTIONS[desc]?.[mode] || desc;
}

/**
 * 生成完整的运势解读
 */
export function generateFortuneInterpretation(
    tenGod: string,
    scores: {
        overall: FortuneLevel;
        career: FortuneLevel;
        love: FortuneLevel;
        wealth: FortuneLevel;
        health: FortuneLevel;
        social: FortuneLevel;
    },
    mode: InterpretationMode
): string[] {
    const interpretation: string[] = [];

    // 十神总述
    interpretation.push(getTenGodInterpretation(tenGod, mode));

    // 综合运势
    interpretation.push(getScoreInterpretation(scores.overall, mode));

    // 各维度建议（只添加分数较高或较低的）
    const dimensions = [
        { key: 'career' as const, level: scores.career },
        { key: 'wealth' as const, level: scores.wealth },
        { key: 'love' as const, level: scores.love },
        { key: 'health' as const, level: scores.health },
        { key: 'social' as const, level: scores.social },
    ];

    // 找出最高和最低的维度
    const sorted = [...dimensions].sort((a, b) => compareLevels(b.level, a.level));
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    if (compareLevels(highest.level, '吉') >= 0) {
        interpretation.push(getDimensionAdvice(highest.key, highest.level, mode));
    }

    if (compareLevels(lowest.level, '中吉') < 0 && lowest.key !== highest.key) {
        interpretation.push(getDimensionAdvice(lowest.key, lowest.level, mode));
    }

    return interpretation.filter(Boolean);
}
