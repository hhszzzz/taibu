/**
 * 手相分析页面
 *
 * 上传手掌照片、选择手型 · 分析重点 · 视觉模型，提交后跳转结果页（与面相共用设计稿 Face / MobileFace）。
 */
'use client'; // 需要手型选择状态，并向客户端上传组件传入图标组件；历史抽屉用 next/dynamic 关闭 SSR

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Hand } from 'lucide-react';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import {
    PhotoOptionRow,
    PhotoOptionSegmented,
    PhotoReadingEntry,
    type PhotoReadingCopy,
} from '@/components/divination/PhotoReadingEntry';
import { PALM_ANALYSIS_TYPES, type HandType } from '@/lib/divination/palm';

const HistoryDrawer = dynamic(
    () => import('@/components/layout/HistoryDrawer').then(mod => mod.HistoryDrawer),
    { ssr: false }
);

const PALM_COPY: PhotoReadingCopy = {
    title: '手相分析',
    subtitle: '上传手掌照片，AI 结合传统相学解读掌纹与掌丘。',
    uploadTitle: '点击或拖入照片',
    mobileUploadTitle: '上传一张手掌照片',
    uploadHint: 'JPG / PNG，不超过 10MB',
    previewAlt: '手相照片预览',
    tipsTitle: '拍摄建议',
    tips: [
        '手掌自然展开，五指分开',
        '光线充足，避免阴影遮挡掌纹',
        '正面垂直拍摄，背景干净简洁',
    ],
    questionPlaceholder: '例如：我的事业运势如何？什么时候会有桃花运？',
    submitLabel: '开始分析手相',
    missingPhoto: '请先上传手相图片',
    notice: '手相分析仅供娱乐参考，不构成医疗、就业或其他专业建议，也不做疾病诊断。我们不保存你上传的照片。',
    billing: '手相分析需要 Plus 会员或以上，每次消耗 1 积分。',
};

const HAND_OPTIONS: ReadonlyArray<{ value: HandType; label: string; hint: string }> = [
    { value: 'left', label: '左手', hint: '先天命格' },
    { value: 'right', label: '右手', hint: '后天发展' },
];

/** 桌面端上传区的虚线手掌轮廓：放大的 Hand 图标（与移动端图标一致），线宽与虚线节奏对齐面相轮廓。 */
const PALM_OUTLINE = (
    <svg width="120" height="150" viewBox="-1 -4.25 26 32.5" fill="none" stroke="currentColor" strokeWidth="0.325" strokeDasharray="0.87 1.08" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
);

export default function PalmPage() {
    const [handType, setHandType] = useState<HandType>('left');
    const extraFields = useMemo(() => ({ handType }), [handType]);

    return (
        <AIFeatureGate>
            <PhotoReadingEntry
                kind="palm"
                copy={PALM_COPY}
                icon={Hand}
                illustration={PALM_OUTLINE}
                capture="environment"
                endpoint="/api/palm"
                sessionKey="palm_result"
                resultPath="/palm/result"
                analysisTypes={PALM_ANALYSIS_TYPES}
                extraOptions={(
                    <PhotoOptionRow label="手型">
                        <PhotoOptionSegmented options={HAND_OPTIONS} value={handType} onChange={setHandType} />
                    </PhotoOptionRow>
                )}
                extraFields={extraFields}
            />
            <HistoryDrawer type="palm" />
        </AIFeatureGate>
    );
}
