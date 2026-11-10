import type { MentionType } from '@/types';

export const mentionTypeLabels: Record<MentionType | 'default', string> = {
    knowledge_base: '知识库',
    bazi_chart: '八字命盘',
    ziwei_chart: '紫微命盘',
    tarot_reading: '塔罗占卜',
    liuyao_divination: '六爻占卜',
    mbti_reading: 'MBTI测评',
    hepan_chart: '合盘',
    face_reading: '面相分析',
    palm_reading: '手相分析',
    ming_record: '命理记录',
    daily_fortune: '每日运势',
    monthly_fortune: '每月运势',
    qimen_chart: '奇门遁甲',
    daliuren_divination: '大六壬',
    meihua_divination: '梅花易数',
    xiaoliuren_divination: '小六壬',
    default: '数据'
};
