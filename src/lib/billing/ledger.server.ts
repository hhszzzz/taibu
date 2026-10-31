import 'server-only';

import { BILLING_LEDGER_TOTALS, billingLedgerWhere, type BillingLedgerRow, type PaymentOrderRow } from '@/lib/db/billing-queries';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import type {
    AdminPaymentOrderView, AdminUsagePage, LedgerEntryView, LedgerFilters, LedgerKind, LedgerUsage, PaymentOrderView, UsageTotals,
} from './config';

const USAGE_COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'images'] as const;

function ledgerUsage(value: unknown): LedgerUsage | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const usage: LedgerUsage = {};
    for (const key of USAGE_COUNTS) if (typeof source[key] === 'number') usage[key] = source[key];
    if (source.estimated === true) usage.estimated = true;
    return usage;
}

export function toLedgerEntryView(row: BillingLedgerRow): LedgerEntryView {
    const parts = Array.isArray(row.subscription_parts) ? row.subscription_parts as Array<Record<string, unknown>> : [];
    return {
        id: row.id, kind: row.kind as LedgerKind, amountMicros: Number(row.amount_micros), walletMicros: Number(row.wallet_micros),
        subscriptionParts: parts.map(part => ({ id: String(part.id), title: String(part.title ?? ''), micros: Number(part.micros) || 0 })),
        walletAfterMicros: Number(row.wallet_after_micros), source: row.source, modelKey: row.model_key, usage: ledgerUsage(row.usage),
        referenceType: row.reference_type, referenceId: row.reference_id, description: row.description, createdAt: row.created_at,
    };
}

/** The entries a filter keeps; `kinds` narrows the kinds when the filter names none. */
function matching(filters: LedgerFilters, options: { userIds?: readonly string[]; kinds?: readonly LedgerKind[] } = {}) {
    return billingLedgerWhere({ ...filters, ...options });
}

export function toPaymentOrderView(row: PaymentOrderRow & { plan_title: string | null }): PaymentOrderView {
    return {
        id: row.id, tradeNo: row.trade_no, kind: row.kind as PaymentOrderView['kind'], planId: row.plan_id, planTitle: row.plan_title,
        creditMicros: row.credit_micros === null ? null : Number(row.credit_micros), payAmount: Number(row.pay_amount),
        payCurrency: row.pay_currency, payMethod: row.pay_method, status: row.status as PaymentOrderView['status'],
        paidAt: row.paid_at, createdAt: row.created_at,
    };
}

type Page = { limit?: number; offset?: number };
const pageOf = (page?: Page) => ({
    limit: Math.min(Math.max(Math.trunc(page?.limit ?? 20), 1), 100),
    offset: Math.max(Math.trunc(page?.offset ?? 0), 0),
});

/** Newest first. `db` is the member's own scope for their ledger, the system's for an administrator's view. */
export async function listLedger(userId: string, db: ScopedDb = systemDb(), page?: Page, filters: LedgerFilters = {}) {
    const { limit, offset } = pageOf(page);
    const rows = await db.tx((trx) => trx.selectFrom('billing_ledger').selectAll()
        .where('user_id', '=', userId).where(matching(filters))
        .orderBy('created_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit + 1).execute());
    return { entries: rows.slice(0, limit).map(toLedgerEntryView), nextOffset: rows.length > limit ? offset + limit : null };
}

const TOTALS = BILLING_LEDGER_TOTALS;

type TotalsRow = { calls: unknown; input: unknown; output: unknown; cache_read: unknown; cache_write: unknown; images: unknown; spent: unknown };

function usageTotals(row: TotalsRow | undefined): UsageTotals {
    return {
        calls: Number(row?.calls ?? 0), input: Number(row?.input ?? 0), output: Number(row?.output ?? 0),
        cacheRead: Number(row?.cache_read ?? 0), cacheWrite: Number(row?.cache_write ?? 0),
        images: Number(row?.images ?? 0), spentMicros: Number(row?.spent ?? 0),
    };
}

const NO_USAGE: AdminUsagePage = { entries: [], nextOffset: null, totals: usageTotals(undefined), byModel: [] };

/**
 * The usage log across every member: model calls and the refunds of what they did not deliver, newest first, with
 * the account of each, the sums within the filters and the sums per model. `email` matches addresses by prefix.
 */
export async function listUsage(filters: LedgerFilters & { email?: string }, page?: Page): Promise<AdminUsagePage> {
    const db = systemDb();
    const { limit, offset } = pageOf(page);
    let userIds: string[] | undefined;
    if (filters.email) {
        userIds = (await db.rpc('admin_find_users_by_email', { p_query: filters.email, p_limit: 50 })).map(row => row.user_id);
        if (!userIds.length) return NO_USAGE;
    }
    const where = matching(filters, { userIds, kinds: ['usage', 'refund'] });
    const [rows, totals, byModel] = await Promise.all([
        db.tx((trx) => trx.selectFrom('billing_ledger').selectAll().where(where)
            .orderBy('created_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit + 1).execute()),
        db.tx((trx) => trx.selectFrom('billing_ledger').select(TOTALS).where(where).executeTakeFirst()),
        db.tx((trx) => trx.selectFrom('billing_ledger').select(['model_key', ...TOTALS]).where(where)
            .where('model_key', 'is not', null).groupBy('model_key').orderBy('spent', 'desc').limit(50).execute()),
    ]);
    const shown = rows.slice(0, limit);
    const emails = await emailsOf(shown.map(row => row.user_id));
    return {
        entries: shown.map(row => ({ ...toLedgerEntryView(row), userId: row.user_id, userEmail: emails.get(row.user_id) ?? null })),
        nextOffset: rows.length > limit ? offset + limit : null,
        totals: usageTotals(totals as TotalsRow | undefined),
        byModel: byModel.map(row => ({ model: row.model_key as string, ...usageTotals(row as TotalsRow) })),
    };
}

/** Orders newest first, with the title of the plan bought; one member's, or everyone's when `userId` is null. */
async function orderRows(db: ScopedDb, userId: string | null, page: { limit: number; offset: number }, status?: PaymentOrderView['status']) {
    return db.tx((trx) => {
        let query = trx.selectFrom('payment_orders as o').leftJoin('subscription_plans as plan', 'plan.id', 'o.plan_id')
            .selectAll('o').select('plan.title as plan_title')
            .orderBy('o.created_at', 'desc').orderBy('o.id', 'desc').offset(page.offset).limit(page.limit + 1);
        if (userId) query = query.where('o.user_id', '=', userId);
        if (status) query = query.where('o.status', '=', status);
        return query.execute();
    });
}

/** A member's orders; `db` is their own scope, or the system's for an administrator's view of one account. */
export async function listOrders(userId: string, db: ScopedDb = systemDb(), page?: Page) {
    const { limit, offset } = pageOf(page);
    const rows = await orderRows(db, userId, { limit, offset });
    return { orders: rows.slice(0, limit).map(toPaymentOrderView), nextOffset: rows.length > limit ? offset + limit : null };
}

/** Every member's orders for the administrator, with the account of each. */
export async function listAllOrders(page?: Page, status?: PaymentOrderView['status']): Promise<{ orders: AdminPaymentOrderView[]; nextOffset: number | null }> {
    const db = systemDb();
    const { limit, offset } = pageOf(page);
    const rows = (await orderRows(db, null, { limit, offset }, status));
    const shown = rows.slice(0, limit);
    const emails = await emailsOf(shown.map(row => row.user_id));
    return {
        orders: shown.map(row => ({ ...toPaymentOrderView(row), userId: row.user_id, userEmail: emails.get(row.user_id) ?? null })),
        nextOffset: rows.length > limit ? offset + limit : null,
    };
}

/** Sign-in addresses by account; an address that cannot be read is left out rather than failing the list. */
export async function emailsOf(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();
    const rows = await systemDb().rpc('admin_get_auth_user_emails', { p_user_ids: ids }).catch(() => []);
    return new Map(rows.map(row => [row.user_id, row.email] as const));
}
