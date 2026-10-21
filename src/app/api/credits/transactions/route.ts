import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';

type CreditTransactionRow = {
    id: string;
    amount: number;
    type: 'earn' | 'spend' | 'refund';
    source: string;
    description: string | null;
    balance_after: number | null;
    reference_type: string | null;
    reference_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
};

export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const limitParam = Number.parseInt(new URL(request.url).searchParams.get('limit') || '100', 10);
        const limit = Number.isFinite(limitParam)
            ? Math.min(Math.max(limitParam, 1), 200)
            : 100;

        const now = new Date();
        const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const startOfTomorrowUtc = new Date(startOfTodayUtc);
        startOfTomorrowUtc.setUTCDate(startOfTomorrowUtc.getUTCDate() + 1);

        const [data, todaySpendRows] = await auth.scoped.tx(async (trx) => Promise.all([
            trx
                .selectFrom('credit_transactions')
                .select(['id', 'amount', 'type', 'source', 'description', 'balance_after', 'reference_type', 'reference_id', 'metadata', 'created_at'])
                .where('user_id', '=', auth.user.id)
                .orderBy('created_at', 'desc')
                .limit(limit)
                .execute(),
            trx
                .selectFrom('credit_transactions')
                .select('amount')
                .where('user_id', '=', auth.user.id)
                .where('amount', '<', 0)
                .where('created_at', '>=', startOfTodayUtc.toISOString())
                .where('created_at', '<', startOfTomorrowUtc.toISOString())
                .execute(),
        ])).catch((error) => {
            console.error('[credits/transactions] Failed to load transactions:', error);
            return [null, null] as const;
        });

        if (data === null) {
            return jsonError('获取积分流水失败', 500);
        }

        const todaySpent = (todaySpendRows ?? []).reduce((sum, row) => {
            const amount = typeof row?.amount === 'number' ? row.amount : 0;
            return sum + Math.abs(amount);
        }, 0);

        return jsonOk({
            items: data as CreditTransactionRow[],
            summary: {
                todaySpent,
            },
        });
    } catch (error) {
        console.error('[credits/transactions] Error:', error);
        return jsonError('服务器错误', 500);
    }
}
