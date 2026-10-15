/**
 * 十神知识库组件
 * 
 * 在八字结果页面「基本信息」中显示十神的详细解释
 *
 * 'use client'：展开 / 收起需要 useState
 */
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Info } from 'lucide-react';
import type { TenGod } from '@/types';

const TEN_GOD_LIST: TenGod[] = [
    '比肩', '劫财', '食神', '伤官', '偏财',
    '正财', '七杀', '正官', '偏印', '正印',
];

// 十神详细知识库
const TEN_GOD_KNOWLEDGE: Record<TenGod, {
    name: TenGod;
    alias: string;        // 别名
    element: string;      // 五行关系
    shortDesc: string;    // 简短描述
    meaning: string;      // 含义
    represent: string[];  // 代表
    character: string[];  // 性格特点
    career: string;       // 事业
    relationship: string; // 感情
}> = {
    '比肩': {
        name: '比肩',
        alias: '比劫、兄弟',
        element: '与日主同五行、同阴阳',
        shortDesc: '代表兄弟、朋友、同辈',
        meaning: '比肩是与日主五行相同、阴阳也相同的天干，代表独立自主、平等竞争的力量',
        represent: ['兄弟', '朋友', '同事', '合作伙伴', '同辈'],
        character: ['独立自主', '坚强刚毅', '竞争意识强', '不服输', '重义气'],
        career: '适合自主创业、合伙经营，或需要团队协作的工作',
        relationship: '在感情中较为独立，需要平等的伴侣关系',
    },
    '劫财': {
        name: '劫财',
        alias: '败财、阳刃',
        element: '与日主同五行、异阴阳',
        shortDesc: '代表竞争对手、损耗',
        meaning: '劫财是与日主五行相同但阴阳相异的天干，代表竞争、争夺和消耗',
        represent: ['竞争者', '异性兄弟姐妹', '对手', '耗费'],
        character: ['冲动急躁', '好胜争强', '慷慨大方', '直来直去', '敢作敢为'],
        career: '适合有挑战性的工作，但需注意理财和控制冲动',
        relationship: '感情中容易有竞争者出现，需要增强安全感',
    },
    '食神': {
        name: '食神',
        alias: '寿星、爵星',
        element: '日主所生、同阴阳',
        shortDesc: '代表才华、福气',
        meaning: '食神是日主所生、阴阳相同的天干，代表才艺、口福和享受',
        represent: ['才艺', '口福', '子女（女命）', '创造力', '表达能力'],
        character: ['温和善良', '聪明和气', '乐天知命', '善于表达', '有口福'],
        career: '适合文艺、餐饮、教育等需要表达和创造的行业',
        relationship: '感情中温柔体贴，懂得享受生活',
    },
    '伤官': {
        name: '伤官',
        alias: '伤星',
        element: '日主所生、异阴阳',
        shortDesc: '代表创造力、叛逆',
        meaning: '伤官是日主所生、阴阳相异的天干，代表才华横溢但也傲气较重',
        represent: ['才华', '创新', '子女（男命）', '叛逆', '表现欲'],
        character: ['才华出众', '聪明绝顶', '傲气凌人', '不拘传统', '口才佳'],
        career: '适合需要创新和表现的工作，如艺术、设计、演艺等',
        relationship: '感情中较为挑剔，需要能欣赏自己才华的伴侣',
    },
    '偏财': {
        name: '偏财',
        alias: '横财',
        element: '日主所克、同阴阳',
        shortDesc: '代表意外之财、父亲',
        meaning: '偏财是日主所克、阴阳相同的天干，代表意外收获和财运',
        represent: ['偏门财', '父亲', '情人', '意外收获', '投资'],
        character: ['人缘好', '慷慨大方', '善于交际', '理财有方', '多情'],
        career: '适合经商、投资、交际应酬类工作',
        relationship: '异性缘佳，感情丰富但需注意桃花过旺',
    },
    '正财': {
        name: '正财',
        alias: '财星',
        element: '日主所克、异阴阳',
        shortDesc: '代表稳定收入、妻子',
        meaning: '正财是日主所克、阴阳相异的天干，代表稳定的财运和正当收入',
        represent: ['正当收入', '妻子（男命）', '工资', '稳定财源'],
        character: ['勤劳务实', '节俭持家', '重视财务', '脚踏实地', '稳重'],
        career: '适合稳定的职业，如财务、银行、行政等',
        relationship: '感情稳定专一，适合传统的婚姻生活',
    },
    '七杀': {
        name: '七杀',
        alias: '偏官、七煞',
        element: '克日主、同阴阳',
        shortDesc: '代表权威、压力',
        meaning: '七杀是克制日主、阴阳相同的天干，代表权威、压力和挑战',
        represent: ['权威', '上司', '小人', '压力', '丈夫（女命）'],
        character: ['魄力强', '果断坚决', '有威势', '不怕挑战', '有时暴躁'],
        career: '适合管理层、军警、法律、武术等需要魄力的行业',
        relationship: '感情中较为强势，需要学会温柔和包容',
    },
    '正官': {
        name: '正官',
        alias: '官星',
        element: '克日主、异阴阳',
        shortDesc: '代表事业、丈夫',
        meaning: '正官是克制日主、阴阳相异的天干，代表正派的管束和规则',
        represent: ['事业', '丈夫（女命）', '上司', '法规', '地位'],
        character: ['正直守规', '有责任心', '重视名誉', '有领导力', '自律'],
        career: '适合公务员、管理者、法官等需要威信的职位',
        relationship: '感情中重视责任和承诺，适合正式婚姻',
    },
    '偏印': {
        name: '偏印',
        alias: '枭神、枭印',
        element: '生日主、同阴阳',
        shortDesc: '代表学问、艺术',
        meaning: '偏印是生助日主、阴阳相同的天干，代表偏门学问和独特思维',
        represent: ['偏门学问', '继母', '艺术', '宗教', '神秘学'],
        character: ['思维独特', '富有创意', '内向', '喜欢钻研', '孤僻'],
        career: '适合研究、艺术、宗教、玄学等需要深度思考的领域',
        relationship: '感情中较为内向，需要能理解自己的伴侣',
    },
    '正印': {
        name: '正印',
        alias: '印绶、印星',
        element: '生日主、异阴阳',
        shortDesc: '代表母亲、学历',
        meaning: '正印是生助日主、阴阳相异的天干，代表正统教育和母爱',
        represent: ['母亲', '学历', '知识', '房产', '贵人'],
        character: ['温和善良', '学识渊博', '有涵养', '仁慈宽容', '重学问'],
        career: '适合教育、学术、医疗、保险等服务类行业',
        relationship: '感情中温柔体贴，有很强的母性/父性',
    },
};

interface TenGodKnowledgeProps {
    highlightedTenGods?: TenGod[];  // 命盘中有的十神，高亮显示
}

export function TenGodKnowledge({ highlightedTenGods = [] }: TenGodKnowledgeProps) {
    const [expandedGod, setExpandedGod] = useState<TenGod | null>(null);

    return (
        <div className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
            {/* 标题 */}
            <div className="flex items-center gap-2 border-b-[0.5px] border-border px-4 py-3.5 sm:px-5">
                <BookOpen className="h-4 w-4 text-clay" />
                <h3 className="font-display text-lg">十神知识库</h3>
            </div>

            {/* 十神列表 */}
            <div className="divide-y-[0.5px] divide-border">
                {TEN_GOD_LIST.map((god) => {
                    const info = TEN_GOD_KNOWLEDGE[god];
                    const isExpanded = expandedGod === god;
                    const isHighlighted = highlightedTenGods.includes(god);

                    return (
                        <div key={god}>
                            {/* 标题行 */}
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedGod(isExpanded ? null : god)}
                                className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-background-secondary sm:px-5 ${isHighlighted ? 'bg-accent-light' : ''
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`font-display text-[15px] ${isHighlighted ? 'text-accent-strong' : 'text-foreground'
                                        }`}>
                                        {god}
                                    </span>
                                    {isHighlighted && (
                                        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs text-accent-strong">
                                            命盘中有
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-foreground-secondary hidden sm:inline">
                                        {info.shortDesc}
                                    </span>
                                    {isExpanded ? (
                                        <ChevronDown className="w-4 h-4 text-foreground-secondary" />
                                    ) : (
                                        <ChevronRight className="w-4 h-4 text-foreground-secondary" />
                                    )}
                                </div>
                            </button>

                            {/* 展开详情 */}
                            {isExpanded && (
                                <div className="space-y-3 bg-panel px-4 pb-4 pt-3 text-sm sm:px-5">
                                    {/* 五行关系 */}
                                    <div className="flex items-start gap-2">
                                        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-clay" />
                                        <div>
                                            <span className="text-foreground-secondary">五行关系：</span>
                                            <span>{info.element}</span>
                                        </div>
                                    </div>

                                    {/* 含义 */}
                                    <div className="text-foreground-secondary">
                                        {info.meaning}
                                    </div>

                                    {/* 代表 */}
                                    <div>
                                        <span className="text-foreground-secondary">代表：</span>
                                        <span>{info.represent.join('、')}</span>
                                    </div>

                                    {/* 性格特点 */}
                                    <div>
                                        <span className="text-foreground-secondary">性格：</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {info.character.map((trait, i) => (
                                                <span
                                                    key={i}
                                                    className="rounded-md bg-surface px-2 py-0.5 text-xs"
                                                >
                                                    {trait}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* 事业 */}
                                    <div>
                                        <span className="text-foreground-secondary">事业：</span>
                                        <span>{info.career}</span>
                                    </div>

                                    {/* 感情 */}
                                    <div>
                                        <span className="text-foreground-secondary">感情：</span>
                                        <span>{info.relationship}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
