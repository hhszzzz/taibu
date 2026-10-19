/**
 * 大六壬薄封装层
 *
 * 统一 Web 侧对 core 计算、canonical JSON 与复制文本的访问入口。
 */

import {
    calculateDaliuren,
    toDaliurenJson,
    toDaliurenText,
    type DaliurenCanonicalJSON,
    type DaliurenInput,
    type DaliurenOutput,
} from 'taibu-core/daliuren';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';

export type {
    DaliurenCanonicalJSON,
    DaliurenInput,
    DaliurenOutput,
} from 'taibu-core/daliuren';

export function calculateDaliurenBundle(input: DaliurenInput): { output: DaliurenOutput } {
    return {
        output: calculateDaliuren(input),
    };
}

export function buildDaliurenCanonicalJSON(output: DaliurenOutput): DaliurenCanonicalJSON {
    // 结果页展示完整盘面：建除与神煞只在完整档输出。
    return toDaliurenJson(output, { detailLevel: 'full' }) as DaliurenCanonicalJSON;
}

export function generateDaliurenChartText(
    output: DaliurenOutput,
    options?: {
        question?: string;
        detailLevel?: ChartTextDetailLevel;
    },
): string {
    const nextOutput = options?.question
        ? { ...output, question: options.question }
        : output;

    return toDaliurenText(nextOutput, {
        detailLevel: resolveChartTextDetailLevel('daliuren', options?.detailLevel),
    });
}
