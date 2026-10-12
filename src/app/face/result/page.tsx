/**
 * 面相分析结果页
 *
 * 显示面相分析结果，支持从历史记录加载
 */
'use client'; // 需向客户端结果组件传入图标组件与 describe 函数

import { ScanFace } from 'lucide-react';
import { PhotoReadingResult, type PhotoReadingSession } from '@/components/divination/PhotoReadingResult';
import { FACE_ANALYSIS_TYPES } from '@/lib/divination/face';

const FACE_NOTICE = '面相分析仅供娱乐参考，不构成医疗、就业或其他专业建议，也不做疾病诊断。';

function describeFaceReading(result: PhotoReadingSession) {
    const title = FACE_ANALYSIS_TYPES.find(type => type.id === result.analysisType)?.name || '面相分析';
    return { title, knowledgeBaseTitle: title };
}

export default function FaceResultPage() {
    return (
        <PhotoReadingResult
            divinationType="face"
            sessionKey="face_result"
            entryPath="/face"
            kindLabel="面相"
            icon={ScanFace}
            loadingText="正在解读你的面相"
            emptyActionLabel="开始面相分析"
            knowledgeBaseSourceType="face_reading"
            notice={FACE_NOTICE}
            describe={describeFaceReading}
        />
    );
}
