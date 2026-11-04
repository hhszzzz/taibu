/**
 * AI 分析对话存储服务端函数
 * 
 * 用于各功能模块（普通聊天、八字五行、八字人格、塔罗、六爻、MBTI、合盘）的 AI 分析结果存储
 * 统一存入 conversations 表，通过 source_type 区分来源
 */

import { systemDb } from '@/lib/db/context.server';
import {
    getSourceDataModelId,
    getSourceDataReasoning,
    normalizeAnalysisSourceData,
    type AnalysisSourceData,
    type AnalysisSourceType,
} from '@/lib/source-contracts';
import type { ChatMessage } from '@/types';

export class AIAnalysisConversationPersistenceError extends Error {
    sourceType: AnalysisSourceType;

    constructor(sourceType: AnalysisSourceType, message: string) {
        super(message);
        this.name = 'AIAnalysisConversationPersistenceError';
        this.sourceType = sourceType;
    }
}

function throwPersistenceError(sourceType: AnalysisSourceType, logLabel: string, detail: unknown): never {
    console.error(`[${sourceType}] ${logLabel}:`, detail);
    throw new AIAnalysisConversationPersistenceError(sourceType, logLabel);
}

// 创建 AI 分析对话记录的参数
export interface CreateAIAnalysisParams {
    userId: string;
    sourceType: AnalysisSourceType;
    sourceData: AnalysisSourceData;
    title: string;
    aiResponse: string;
    historyBinding?: {
        type: 'mbti' | 'tarot' | 'hepan' | 'palm' | 'face' | 'qimen' | 'daliuren' | 'liuyao' | 'meihua' | 'xiaoliuren';
        payload: Record<string, unknown>;
    } | null;
}

/**
 * 创建 AI 分析对话记录（服务端使用）
 * 绕过 RLS，用于 API 路由中保存 AI 分析结果
 */
export async function createAIAnalysisConversation(params: CreateAIAnalysisParams): Promise<string> {
    const normalizedSourceData = normalizeAnalysisSourceData(params.sourceType, params.sourceData);

    const modelId = getSourceDataModelId(normalizedSourceData) ?? undefined;
    const reasoningText = getSourceDataReasoning(normalizedSourceData) ?? undefined;
    const createdAt = new Date().toISOString();
    const messages: ChatMessage[] = [
        {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: params.aiResponse,
            createdAt,
            model: modelId,
            reasoning: reasoningText,
        },
    ];

    if (params.historyBinding) {
        const data = await systemDb().rpc('create_analysis_conversation_with_history_as_service', {
            p_user_id: params.userId,
            p_source_type: params.sourceType,
            p_source_data: normalizedSourceData,
            p_title: params.title,
            p_messages: messages,
            p_history_type: params.historyBinding.type,
            p_history_payload: params.historyBinding.payload,
        }).catch((error) => {
            throwPersistenceError(params.sourceType, '事务化保存 AI 分析失败', error);
        });

        if (typeof data !== 'string') {
            throwPersistenceError(params.sourceType, '事务化保存 AI 分析失败', data);
        }

        return data;
    }

    const data = await systemDb().rpc('create_conversation_with_messages', {
        p_user_id: params.userId,
        p_title: params.title,
        p_source_type: params.sourceType,
        p_source_data: normalizedSourceData,
        p_messages: messages,
    }).catch((error) => {
        throwPersistenceError(params.sourceType, '事务化创建 AI 分析对话失败', error);
    });

    if (typeof data !== 'string') {
        throwPersistenceError(params.sourceType, '事务化创建 AI 分析对话失败', data);
    }

    return data;
}

/**
 * 生成六爻分析标题
 * @param hexagramName 主卦名称
 * @param changedHexagramName 变卦名称（可选）
 */
export function generateLiuyaoTitle(
    question: string | undefined,
    hexagramName: string,
    changedHexagramName?: string
): string {
    // 生成卦象显示文本：主卦 或 主卦 -> 变卦
    const hexagramDisplay = changedHexagramName
        ? `${hexagramName} 变 ${changedHexagramName}`
        : hexagramName;

    if (question && question.trim()) {
        return `${question.trim().substring(0, 20)} - ${hexagramDisplay}`;
    }
    return `六爻占卜 - ${hexagramDisplay}`;
}

/**
 * 生成八字分析标题
 */
export function generateBaziAnalysisTitle(chartName: string, analysisType: 'wuxing' | 'personality'): string {
    const typeName = analysisType === 'wuxing' ? '五行分析' : '人格分析';
    return `${chartName} - ${typeName}`;
}

export function generateZiweiAnalysisTitle(chartName: string): string {
    return `${chartName} - 紫微斗数分析`;
}
