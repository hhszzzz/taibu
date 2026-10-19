/**
 * 奇门遁甲薄封装层
 *
 * Web 侧仅保留输入归一化，计算与输出结构完全以 taibu-core/qimen 为准。
 */

import {
    calculateQimen,
    toQimenJson,
    toQimenText,
    type QimenCanonicalJSON,
    type QimenInput as CoreQimenInput,
    type QimenOutput,
} from 'taibu-core/qimen';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';

export type { QimenCanonicalJSON, QimenOutput } from 'taibu-core/qimen';
export type StoredQimenZhiFuJiGong = 'ji_liuyi' | 'ji_wugong';

export interface QimenInput extends Omit<CoreQimenInput, 'minute' | 'panType' | 'zhiFuJiGong'> {
    minute: number;
    panType: 'zhuan';
    zhiFuJiGong: 'jiLiuYi' | 'jiWuGong';
}

export async function calculateQimenBundle(input: QimenInput): Promise<{ output: QimenOutput }> {
    const output = await calculateQimen({
        ...input,
        zhiFuJiGong: toStoredQimenZhiFuJiGong(input.zhiFuJiGong),
    });

    return { output };
}

export function toStoredQimenZhiFuJiGong(value: QimenInput['zhiFuJiGong']): StoredQimenZhiFuJiGong {
    return value === 'jiWuGong' ? 'ji_wugong' : 'ji_liuyi';
}

export function fromStoredQimenZhiFuJiGong(value: string | null | undefined): QimenInput['zhiFuJiGong'] {
    return value === 'ji_wugong' ? 'jiWuGong' : 'jiLiuYi';
}

export function buildQimenCanonicalJSON(output: QimenOutput): QimenCanonicalJSON {
    // 结果页展示完整盘面：方位、格局、宫旺衰、空亡/驿马与十干月令旺衰只在完整档输出。
    return toQimenJson(output, { detailLevel: 'full' });
}

export function generateQimenChartText(
    output: QimenOutput,
    options?: {
        question?: string;
        detailLevel?: ChartTextDetailLevel;
    },
): string {
    return toQimenText(options?.question ? { ...output, question: options.question } : output, {
        detailLevel: resolveChartTextDetailLevel('qimen', options?.detailLevel),
    });
}
