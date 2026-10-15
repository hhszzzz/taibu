/**
 * 大六壬起课前预览（沿用设计稿 QimenForm 右侧面板样式）
 *
 * 'use client'：在浏览器端按表单参数防抖试算。
 * 试算复用 /api/daliuren 同一个 calculateDaliurenBundle 与 canonical 渲染（按需动态加载），
 * 只用于展示；正式起课仍由结果页请求接口。试算失败时显示空状态。
 */
'use client';

import type { DaliurenCanonicalJSON, DaliurenInput } from '@/lib/divination/daliuren';
import {
    SanshiPreviewCard,
    SanshiPreviewFacts,
    SanshiPreviewHeadline,
    SanshiPreviewPillars,
    useSanshiPreview,
} from '@/components/divination/SanshiFormControls';
import { formatKeShiDetail, isPlaceholder, parseKeShi } from './daliuren-display';

async function computeDaliurenPreview(input: DaliurenInput): Promise<DaliurenCanonicalJSON> {
    const { calculateDaliurenBundle, buildDaliurenCanonicalJSON } = await import('@/lib/divination/daliuren');
    return buildDaliurenCanonicalJSON(calculateDaliurenBundle(input).output);
}

export function DaliurenFormPreview({ input, className = '' }: { input: DaliurenInput; className?: string }) {
    const state = useSanshiPreview(JSON.stringify(input), () => computeDaliurenPreview(input));

    return (
        <SanshiPreviewCard label="起课前预览" state={state} unavailableText="当前时间暂无法预览课体，起课后查看完整课盘。" className={className}>
            {(chart) => {
                const keShi = parseKeShi(chart.基本信息.课式);
                const transmissions = chart.三传.map(step => step.地支).filter(branch => !isPlaceholder(branch));
                return (
                    <>
                        <SanshiPreviewHeadline title={keShi.title} subtitle={formatKeShiDetail(keShi.detail) || undefined} />
                        <SanshiPreviewPillars pillars={chart.基本信息.四柱.split(/\s+/u).filter(Boolean)} />
                        <SanshiPreviewFacts
                            rows={[
                                { label: '月将', value: chart.基本信息.月将 },
                                { label: '空亡', value: chart.基本信息.关键状态.空亡.join('') },
                                { label: '三传', value: transmissions.join(' · ') },
                            ]}
                        />
                    </>
                );
            }}
        </SanshiPreviewCard>
    );
}
