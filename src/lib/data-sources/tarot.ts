import { generateTarotReadingText, TAROT_SPREADS } from '@/lib/divination/tarot';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type TarotRow = {
    id: string;
    user_id: string;
    spread_id: string;
    question: string | null;
    cards: unknown;
    metadata?: Record<string, unknown> | null;
    created_at: string;
    conversation_id: string | null;
};

export const tarotProvider: DataSourceProvider<TarotRow> = {
    type: 'tarot_reading',
    displayName: '塔罗记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('tarot_readings')
                .select(['id', 'spread_id', 'question', 'created_at'])
                .where('user_id', '=', userId), ctx, ['question']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => {
            const spreadName = TAROT_SPREADS.find(spread => spread.id === row.spread_id)?.name || row.spread_id || '塔罗占卜';
            return {
                id: row.id,
                type: 'tarot_reading',
                name: `塔罗 - ${spreadName}`,
                preview: row.question ? `问题：${row.question}` : `牌阵：${spreadName}`,
                createdAt: row.created_at ?? '',
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<TarotRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('tarot_readings')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return (data as TarotRow) || null;
    },

    formatForAI(reading: TarotRow, ctx?: DataSourceQueryContext): string {
        const spreadName = TAROT_SPREADS.find(spread => spread.id === reading.spread_id)?.name || reading.spread_id || '塔罗占卜';
        const birthDate = typeof reading.metadata?.birthDate === 'string' ? reading.metadata.birthDate : undefined;
        const seed = typeof reading.metadata?.seed === 'string' ? reading.metadata.seed : undefined;
        return generateTarotReadingText({
            spreadName,
            spreadId: reading.spread_id,
            question: reading.question,
            cards: reading.cards,
            seed,
            numerology: (reading.metadata?.numerology || null) as Parameters<typeof generateTarotReadingText>[0]['numerology'],
            birthDate,
            detailLevel: ctx?.chartPromptDetailLevel,
        });
    },

    summarize(reading: TarotRow): string {
        const spreadName = TAROT_SPREADS.find(spread => spread.id === reading.spread_id)?.name || reading.spread_id || '塔罗占卜';
        return reading.question ? `${spreadName} - ${reading.question}` : spreadName;
    }
};
