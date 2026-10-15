/**
 * 奇门起局前预览（设计稿 QimenForm 右侧面板）
 *
 * 'use client'：在浏览器端按表单参数防抖试算。
 * 试算复用结果页兜底重算所用的 calculateQimenBundle（按需动态加载），只用于展示；
 * 正式起局仍走 /api/qimen。core 的转盘校验依赖北京时间历法，浏览器时区不符时试算会失败，
 * 此时显示空状态而不是推测数据。
 */
'use client';

import type { QimenInput, QimenOutput } from '@/lib/divination/qimen';
import {
    SanshiPreviewCard,
    SanshiPreviewFacts,
    SanshiPreviewHeadline,
    SanshiPreviewPillars,
    useSanshiPreview,
} from '@/components/divination/SanshiFormControls';
import { toChineseNumeral } from './qimen-display';

async function computeQimenPreview(input: QimenInput): Promise<QimenOutput> {
    const { calculateQimenBundle } = await import('@/lib/divination/qimen');
    const { output } = await calculateQimenBundle(input);
    return output;
}

export function QimenFormPreview({ input, className = '' }: { input: QimenInput; className?: string }) {
    const state = useSanshiPreview(JSON.stringify(input), () => computeQimenPreview(input));

    return (
        <SanshiPreviewCard label="起局前预览" state={state} unavailableText="当前时间暂无法预览局象，起局后查看完整九宫。" className={className}>
            {(output) => (
                <>
                    <SanshiPreviewHeadline
                        title={`${output.dateInfo.solarTerm} · ${output.dunType === 'yang' ? '阳遁' : '阴遁'}${toChineseNumeral(output.juNumber)}局`}
                        subtitle={output.yuan}
                    />
                    <SanshiPreviewPillars pillars={[output.siZhu.year, output.siZhu.month, output.siZhu.day, output.siZhu.hour]} />
                    <SanshiPreviewFacts
                        rows={[
                            { label: '旬首', value: output.xunShou },
                            { label: '值符', value: output.zhiFu.star },
                            { label: '值使', value: output.zhiShi.gate },
                        ]}
                    />
                </>
            )}
        </SanshiPreviewCard>
    );
}
