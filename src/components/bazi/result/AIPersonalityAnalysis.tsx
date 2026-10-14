/**
 * AI人格分析组件
 *
 * 基于八字命盘进行深度人格分析
 * 委托 AIAnalysisSection 处理通用逻辑
 */
'use client';

import { User } from 'lucide-react';
import { AIAnalysisSection } from '@/components/bazi/result/AIAnalysisSection';

interface AIPersonalityAnalysisProps {
    chartId: string;
    userId: string;
    credits?: number | null;
    savedAnalysis?: string | null;
    savedReasoning?: string | null;
    savedModelId?: string | null;
    onSaveAnalysis: (analysis: string) => void;
    onLoginRequired?: () => void;
}

export function AIPersonalityAnalysis(props: AIPersonalityAnalysisProps) {
    return (
        <AIAnalysisSection
            {...props}
            type="personality"
            title="AI人格分析"
            subtitle="MBTI风格深度人格解读"
            lockDescription="消耗1积分，获取基于您命盘的深度人格分析报告"
            loadingText="AI正在分析您的人格特征，请稍候..."
            icon={<User className="w-5 h-5 text-accent-strong" />}
            iconContainerClass="bg-accent-soft"
            headerGradientClass="bg-panel"
        />
    );
}
