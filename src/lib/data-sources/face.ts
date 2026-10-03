import { getSystemAdminClient } from '@/lib/api-utils';
import { FACE_ANALYSIS_TYPES } from '@/lib/divination/face';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type FaceRow = {
    id: string;
    user_id: string;
    analysis_type: string | null;
    created_at: string;
    conversation_id: string | null;
    conversation?: { messages?: unknown; source_data?: Record<string, unknown> } | null;
};

const extractConversationAnalysis = (conversation?: { messages?: unknown } | null): string | null => {
    const messages = Array.isArray(conversation?.messages) ? conversation?.messages : [];
    const assistant = messages.find((m: { role?: string; content?: string }) => m?.role === 'assistant' && m?.content);
    return assistant?.content || null;
};

function getFaceAnalysisTypeLabel(type: string | null | undefined): string {
    return FACE_ANALYSIS_TYPES.find((item) => item.id === type)?.name || type || '面相分析';
}

export const faceProvider: DataSourceProvider<FaceRow> = {
    type: 'face_reading',
    displayName: '面相记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('face_readings')
            .select('id, analysis_type, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; analysis_type: string | null; created_at: string }) => {
            const typeName = FACE_ANALYSIS_TYPES.find(t => t.id === row.analysis_type)?.name || row.analysis_type || '面相分析';
            return {
                id: row.id,
                type: 'face_reading',
                name: `面相分析 - ${typeName}`,
                preview: row.analysis_type ? `类型：${typeName}` : '面相分析记录',
                createdAt: row.created_at
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<FaceRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('face_readings')
            .select('*, conversation:conversations(messages, source_data)')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as FaceRow) || null;
    },

    formatForAI(r: FaceRow): string {
        const analysisText = extractConversationAnalysis(r.conversation);
        const sourceData = r.conversation?.source_data || {};
        const typeLabel = getFaceAnalysisTypeLabel(r.analysis_type);
        return [
            '## 面相分析记录',
            r.analysis_type ? `- 类型：${typeLabel}` : '',
            typeof sourceData?.question === 'string' && sourceData.question ? `- 提问：${sourceData.question}` : '',
            analysisText ? `\n【AI解读】\n${analysisText}` : ''
        ].filter(Boolean).join('\n');
    },

    summarize(r: FaceRow): string {
        return getFaceAnalysisTypeLabel(r.analysis_type);
    }
};
