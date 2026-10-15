/**
 * 手相分析结果页
 *
 * 显示手相分析结果，支持从历史记录加载
 */
'use client'; // 需向客户端结果组件传入图标组件与 describe 函数

import { Hand } from 'lucide-react';
import { PhotoReadingResult, type PhotoReadingSession } from '@/components/divination/PhotoReadingResult';
import { PALM_ANALYSIS_TYPES, getPalmHandLabel } from '@/lib/divination/palm';

const PALM_NOTICE = '手相分析仅供娱乐参考，不构成医疗、就业或其他专业建议，也不做疾病诊断。';

interface PalmReadingSession extends PhotoReadingSession {
    handType?: string;
}

function describePalmReading(result: PalmReadingSession) {
    const typeName = PALM_ANALYSIS_TYPES.find(type => type.id === result.analysisType)?.name || '手相分析';
    const handLabel = getPalmHandLabel(result.handType);
    return {
        title: handLabel ? `${handLabel} · ${typeName}` : typeName,
        knowledgeBaseTitle: handLabel ? `${typeName}（${handLabel}）` : typeName,
    };
}

export default function PalmResultPage() {
    return (
        <PhotoReadingResult
            divinationType="palm"
            sessionKey="palm_result"
            entryPath="/palm"
            kindLabel="手相"
            icon={Hand}
            loadingText="正在解析你的掌纹"
            emptyActionLabel="开始手相分析"
            knowledgeBaseSourceType="palm_reading"
            notice={PALM_NOTICE}
            describe={describePalmReading}
        />
    );
}
