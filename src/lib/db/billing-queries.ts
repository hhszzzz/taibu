import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import type { BillingLedger, DB, PaymentOrders, SubscriptionPlans } from '@/lib/db/generated/schema';

/** Rows as the billing module (src/lib/billing) reads them. */
export type BillingLedgerRow = Selectable<BillingLedger>;
export type PaymentOrderRow = Selectable<PaymentOrders>;
export type SubscriptionPlanRow = Selectable<SubscriptionPlans>;

/** What a ledger listing narrows by; `kinds` applies only when `kind` names none. */
export interface BillingLedgerConditions {
    userIds?: readonly string[];
    kind?: string;
    kinds?: readonly string[];
    source?: string;
    model?: string;
    from?: string;
    to?: string;
}

export function billingLedgerWhere(conditions: BillingLedgerConditions) {
    return (eb: ExpressionBuilder<DB, 'billing_ledger'>) => eb.and([
        ...(conditions.userIds ? [eb('user_id', 'in', conditions.userIds)] : []),
        ...(conditions.kind ? [eb('kind', '=', conditions.kind)] : conditions.kinds ? [eb('kind', 'in', conditions.kinds)] : []),
        ...(conditions.source ? [eb('source', '=', conditions.source)] : []),
        ...(conditions.model ? [eb('model_key', '=', conditions.model)] : []),
        ...(conditions.from ? [eb('created_at', '>=', conditions.from)] : []),
        ...(conditions.to ? [eb('created_at', '<', conditions.to)] : []),
    ]);
}

/** Sums over ledger entries. Refunds have no usage and count no call; they only take back part of what was spent. */
export const BILLING_LEDGER_TOTALS = [
    sql<string>`count(*) filter (where kind = 'usage')`.as('calls'),
    sql<string>`coalesce(sum((usage->>'input')::numeric), 0)`.as('input'),
    sql<string>`coalesce(sum((usage->>'output')::numeric), 0)`.as('output'),
    sql<string>`coalesce(sum((usage->>'cacheRead')::numeric), 0)`.as('cache_read'),
    sql<string>`coalesce(sum((usage->>'cacheWrite')::numeric), 0)`.as('cache_write'),
    sql<string>`coalesce(sum((usage->>'images')::numeric), 0)`.as('images'),
    sql<string>`coalesce(-sum(amount_micros), 0)`.as('spent'),
] as const;
