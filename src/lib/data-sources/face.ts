import { FACE_ANALYSIS_TYPES } from '@/lib/divination/face';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { extractConversationAnalysis, loadProviderConversation } from '@/lib/data-sources/conversation';
import { applyListFilters } from '@/lib/db/data-source-filters';

type FaceRow = {
    id: string;
    user_id: string;
    analysis_type: string | null;
    created_at: string;
    conversation_id: string | null;
    conversation?: { messages?: unknown; source_data?: Record<string, unknown> } | null;
};

function getFaceAnalysisTypeLabel(type: string | null | undefined): string {
    return FACE_ANALYSIS_TYPES.find((item) => item.id === type)?.name || type || '面相分析';
}

export const faceProvider: DataSourceProvider<FaceRow> = {
    type: 'face_reading',
    displayName: '面相记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        // A face reading has no text of its own: a keyword lists none.
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('face_readings')
                .select(['id', 'analysis_type', 'created_at'])
                .where('user_id', '=', userId), ctx, []);
            if (!query) return [];
            return (ctx?.offset ? query.offset(ctx.offset) : query)
                .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => {
            const typeName = FACE_ANALYSIS_TYPES.find(t => t.id === row.analysis_type)?.name || row.analysis_type || '面相分析';
            return {
                id: row.id,
                type: 'face_reading',
                name: typeName,
                preview: row.analysis_type ? `类型：${typeName}` : '面相分析记录',
                createdAt: row.created_at ?? '',
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<FaceRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
            .selectFrom('face_readings')
            .selectAll()
            .where('id', '=', id)
            .where('user_id', '=', userId)
            .executeTakeFirst());
        if (!data) return null;
        const conversation = await loadProviderConversation(db, data.conversation_id);
        return { ...data, conversation } as FaceRow;
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
