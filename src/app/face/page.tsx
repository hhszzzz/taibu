/**
 * 面相分析页面
 *
 * 上传正脸照片、选择分析重点与视觉模型，提交后跳转结果页（设计稿 Face / MobileFace）。
 */
'use client'; // 需向客户端上传组件传入图标组件，且历史抽屉用 next/dynamic 关闭 SSR

import dynamic from 'next/dynamic';
import { ScanFace } from 'lucide-react';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { PhotoReadingEntry, type PhotoReadingCopy } from '@/components/divination/PhotoReadingEntry';
import { FACE_ANALYSIS_TYPES, FACE_DISCLAIMER } from '@/lib/divination/face';

const HistoryDrawer = dynamic(
    () => import('@/components/layout/HistoryDrawer').then(mod => mod.HistoryDrawer),
    { ssr: false }
);

const FACE_COPY: PhotoReadingCopy = {
    title: '面相分析',
    subtitle: '上传一张正脸照片，AI 结合传统相学解读五官与气色。',
    uploadTitle: '点击或拖入照片',
    mobileUploadTitle: '上传一张正脸照片',
    uploadHint: 'JPG / PNG，不超过 10MB',
    previewAlt: '面相照片预览',
    tipsTitle: '拍摄建议',
    tips: [
        '正脸、平视镜头，五官完整露出',
        '自然光，避免强烈阴影与美颜滤镜',
        '摘下眼镜，头发不遮挡额头',
    ],
    questionPlaceholder: '例如：我适合什么样的工作？未来的财运如何？',
    submitLabel: '开始分析面相',
    missingPhoto: '请先上传面部照片',
    notice: '面相分析仅供娱乐参考，不构成医疗、就业或其他专业建议，也不做疾病诊断。我们不保存你上传的照片，分析完成后图片将被删除。请勿上传他人照片。',
    billing: '面相分析需要 Plus 会员或以上，每次消耗 1 积分。',
};

const FACE_CONSENT = { title: '重要提醒', body: FACE_DISCLAIMER };

/** 设计稿桌面端上传区的虚线脸部轮廓。 */
const FACE_OUTLINE = (
    <svg width="120" height="150" viewBox="0 0 120 150" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5">
        <ellipse cx="60" cy="72" rx="44" ry="58" />
        <path d="M36 60h14M70 60h14M60 66v20M48 100c7 6 17 6 24 0" />
    </svg>
);

export default function FacePage() {
    return (
        <AIFeatureGate>
            <PhotoReadingEntry
                kind="face"
                copy={FACE_COPY}
                icon={ScanFace}
                illustration={FACE_OUTLINE}
                capture="user"
                endpoint="/api/face"
                sessionKey="face_result"
                resultPath="/face/result"
                analysisTypes={FACE_ANALYSIS_TYPES}
                consent={FACE_CONSENT}
            />
            <HistoryDrawer type="face" />
        </AIFeatureGate>
    );
}
