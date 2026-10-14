/**
 * AI专业五行分析组件
 *
 * 基于八字命盘进行深度五行分析
 * 委托 AIAnalysisSection 处理通用逻辑
 */
'use client';

import { Sparkles } from 'lucide-react';
import { AIAnalysisSection } from '@/components/bazi/result/AIAnalysisSection';

interface AIWuxingAnalysisProps {
    chartId: string;
    userId: string;
    credits?: number | null;
    savedAnalysis?: string | null;
    savedReasoning?: string | null;
    savedModelId?: string | null;
    onSaveAnalysis: (analysis: string) => void;
    onLoginRequired?: () => void;
}

export function AIWuxingAnalysis(props: AIWuxingAnalysisProps) {
    return (
        <AIAnalysisSection
            {...props}
            type="wuxing"
            title="AI专业五行分析"
            subtitle="深度解读五行配置与喜用神"
            lockDescription="消耗1积分，获取基于您命盘的深度五行分析报告"
            loadingText="AI正在分析您的八字，请稍候..."
            icon={<Sparkles className="w-5 h-5 text-accent-strong" />}
            iconContainerClass="bg-accent-soft"
            headerGradientClass="bg-panel"
        />
    );
}
