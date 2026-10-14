/**
 * 合盘页面展示常量（纯文案 / 选项，不含业务逻辑）
 */
import type { HepanType } from '@/lib/divination/hepan';
import type { SegmentedOption } from '@/components/bazi/SegmentedControl';

/** 关系类型分段控件选项 */
export const HEPAN_TYPE_OPTIONS: readonly SegmentedOption<HepanType>[] = [
    { value: 'love', label: '情侣' },
    { value: 'business', label: '商业合伙' },
    { value: 'family', label: '亲子' },
];

/** 各关系类型下双方的称谓 */
export const HEPAN_PERSON_LABELS: Record<HepanType, { p1: string; p2: string }> = {
    love: { p1: '您', p2: '对方' },
    business: { p1: '合伙人A', p2: '合伙人B' },
    family: { p1: '父/母', p2: '子/女' },
};

/** 合盘原理解析：与 analyzeCompatibility / calculateCompatibilityTrend 的计算维度一一对应 */
export const HEPAN_PRINCIPLES: readonly { title: string; body: string }[] = [
    { title: '日柱相合', body: '看双方日支是六合还是相冲。' },
    { title: '五行互补', body: '看双方最旺的五行是相生还是相克。' },
    { title: '运势走线', body: '对比未来半年到一年流月的起伏。' },
];

/** 合盘时辰选项（保持原有取值：偶数小时代表对应时辰） */
export const HEPAN_HOUR_OPTIONS: readonly { value: number; label: string }[] = [
    { value: 0, label: '子时 (23:00-01:00)' },
    { value: 2, label: '丑时 (01:00-03:00)' },
    { value: 4, label: '寅时 (03:00-05:00)' },
    { value: 6, label: '卯时 (05:00-07:00)' },
    { value: 8, label: '辰时 (07:00-09:00)' },
    { value: 10, label: '巳时 (09:00-11:00)' },
    { value: 12, label: '午时 (11:00-13:00)' },
    { value: 14, label: '未时 (13:00-15:00)' },
    { value: 16, label: '申时 (15:00-17:00)' },
    { value: 18, label: '酉时 (17:00-19:00)' },
    { value: 20, label: '戌时 (19:00-21:00)' },
    { value: 22, label: '亥时 (21:00-23:00)' },
];
