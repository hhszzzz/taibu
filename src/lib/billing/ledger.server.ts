import 'server-only';

import {
    BILLING_LEDGER_TOTALS, billingLedgerWhere, billingReferenceCostsQuery, type BillingLedgerRow, type PaymentOrderRow,
} from '@/lib/db/billing-queries';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import type {
    AdminPaymentOrderView, AdminUsagePage, LedgerEntryView, LedgerFilters, LedgerKind, LedgerModelLabel, LedgerPage, LedgerPrices,
    LedgerUsage, PaymentOrderView, ReferenceCost, SubscriptionWindow, UsageByModel, UsageTotals,
} from './config';

const USAGE_COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'images'] as const;
const PRICE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'image'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function ledgerPrices(value: unknown): LedgerPrices | null {
    if (!isRecord(value)) return null;
    const prices: LedgerPrices = {};
    for (const key of PRICE_KEYS) {
        const price = value[key];
        if (typeof price === 'number' && Number.isFinite(price)) prices[key] = price;
        else if (price === null && (key === 'cacheRead' || key === 'cacheWrite')) prices[key] = null;
    }
    return Object.keys(prices).length ? prices : null;
}

function ledgerUsage(value: unknown): LedgerUsage | null {
    if (!isRecord(value)) return null;
    const usage: LedgerUsage = {};
    for (const key of USAGE_COUNTS) if (typeof value[key] === 'number') usage[key] = value[key];
    if (value.estimated === true) usage.estimated = true;
    if (value.byok === true) usage.byok = true;
    const prices = ledgerPrices(value.prices);
    if (prices) usage.prices = prices;
    return usage;
}

function toLedgerEntryView(row: BillingLedgerRow): LedgerEntryView {
    const parts = Array.isArray(row.subscription_parts) ? row.subscription_parts as Array<Record<string, unknown>> : [];
    return {
        id: row.id, kind: row.kind as LedgerKind, amountMicros: Number(row.amount_micros), walletMicros: Number(row.wallet_micros),
        subscriptionParts: parts.map(part => ({
            id: String(part.id), title: String(part.title ?? ''), micros: Number(part.micros) || 0,
            ...(typeof part.period === 'string' ? { period: part.period as SubscriptionWindow } : {}),
        })),
        walletAfterMicros: Number(row.wallet_after_micros), source: row.source, modelKey: row.model_key, usage: ledgerUsage(row.usage),
        referenceType: row.reference_type, referenceId: row.reference_id, description: row.description, createdAt: row.created_at,
    };
}

/** The entries a filter keeps; `kinds` narrows the kinds when the filter names none. */
function matching(filters: LedgerFilters, options: { userIds?: readonly string[]; kinds?: readonly LedgerKind[] } = {}) {
    return billingLedgerWhere({ ...filters, ...options });
}

function toPaymentOrderView(row: PaymentOrderRow & { plan_title: string | null }): PaymentOrderView {
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

/** Catalog names and icons of the charged models, readable from any scope; a model deleted since is left out. */
async function modelLabels(db: ScopedDb, keys: ReadonlyArray<string | null>): Promise<Map<string, LedgerModelLabel>> {
    const wanted = [...new Set(keys.filter((key): key is string => !!key))];
    if (!wanted.length) return new Map();
    const rows = await db.tx((trx) => trx.selectFrom('ai_models').select(['model_key', 'display_name', 'vendor', 'icon'])
        .where('model_key', 'in', wanted).execute());
    return new Map(rows.map(row => [row.model_key, { name: row.display_name, vendor: row.vendor, icon: row.icon }] as const));
}

const labelOf = (labels: ReadonlyMap<string, LedgerModelLabel>, key: string | null) => (key ? labels.get(key) ?? null : null);

/** An administrator's adjustment names them as the reference; the others' references point at the thing, not a person. */
const operatorOf = (entry: LedgerEntryView) => (entry.kind === 'adjust' && entry.referenceType === 'user' && entry.referenceId ? entry.referenceId : null);

async function operatorEmails(entries: readonly LedgerEntryView[]): Promise<Map<string, string>> {
    return emailsOf(entries.map(operatorOf).filter((id): id is string => id !== null));
}

function withOperator<T extends LedgerEntryView>(entry: T, operators: ReadonlyMap<string, string>): T {
    const id = operatorOf(entry);
    return id ? { ...entry, operatorEmail: operators.get(id) ?? null } : entry;
}

/**
 * Newest first. `db` is the member's own scope for their ledger, the system's for an administrator's view. `sums` adds,
 * on the first page, what the member's model calls cost within the filters; `operators` names who adjusted the wallet.
 */
export async function listLedger(userId: string, db: ScopedDb = systemDb(), page?: Page, filters: LedgerFilters = {}, options: { sums?: boolean; operators?: boolean } = {}): Promise<LedgerPage> {
    const { limit, offset } = pageOf(page);
    const [rows, sums] = await Promise.all([
        db.tx((trx) => trx.selectFrom('billing_ledger').selectAll()
            .where('user_id', '=', userId).where(matching(filters))
            .orderBy('created_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit + 1).execute()),
        options.sums && !offset ? usageSums(db, filters, [userId]) : null,
    ]);
    const shown = rows.slice(0, limit);
    const entries = shown.map(row => toLedgerEntryView(row));
    const [labels, operators] = await Promise.all([
        modelLabels(db, [...shown.map(row => row.model_key), ...(sums?.byModel.map(row => row.model) ?? [])]),
        options.operators ? operatorEmails(entries) : Promise.resolve(new Map<string, string>()),
    ]);
    return {
        entries: entries.map(entry => withOperator({ ...entry, modelLabel: labelOf(labels, entry.modelKey) }, operators)),
        nextOffset: rows.length > limit ? offset + limit : null,
        ...(sums ? { totals: sums.totals, byModel: sums.byModel.map(row => ({ ...row, modelLabel: labelOf(labels, row.model) })) } : {}),
    };
}

type TotalsRow = { calls: unknown; input: unknown; output: unknown; cache_read: unknown; cache_write: unknown; reasoning: unknown; images: unknown; spent: unknown };

function usageTotals(row: TotalsRow | undefined): UsageTotals {
    return {
        calls: Number(row?.calls ?? 0), input: Number(row?.input ?? 0), output: Number(row?.output ?? 0),
        cacheRead: Number(row?.cache_read ?? 0), cacheWrite: Number(row?.cache_write ?? 0),
        reasoning: Number(row?.reasoning ?? 0),
        images: Number(row?.images ?? 0), spentMicros: Number(row?.spent ?? 0),
    };
}

/**
 * Model calls and the refunds of what they did not deliver, summed and per model within the filters. The kind filter
 * is ignored: top-ups, subscriptions and the like are never spending.
 */
async function usageSums(db: ScopedDb, filters: LedgerFilters, userIds?: readonly string[]): Promise<{ totals: UsageTotals; byModel: UsageByModel[] }> {
    const where = matching({ ...filters, kind: undefined }, { userIds, kinds: ['usage', 'refund'] });
    const [totals, byModel] = await Promise.all([
        db.tx((trx) => trx.selectFrom('billing_ledger').select(BILLING_LEDGER_TOTALS).where(where).executeTakeFirst()),
        db.tx((trx) => trx.selectFrom('billing_ledger').select(['model_key', ...BILLING_LEDGER_TOTALS]).where(where)
            .where('model_key', 'is not', null).groupBy('model_key').orderBy('spent', 'desc').limit(50).execute()),
    ]);
    return {
        totals: usageTotals(totals as TotalsRow | undefined),
        byModel: byModel.map(row => ({ model: row.model_key as string, ...usageTotals(row as TotalsRow) })),
    };
}

const NO_USAGE: AdminUsagePage = { entries: [], nextOffset: null, totals: usageTotals(undefined), byModel: [] };

/**
 * The ledger across every member, newest first, with the account of each: every kind unless the filters name one,
 * plus the spending sums within the filters. `email` matches addresses by prefix.
 */
export async function listUsage(filters: LedgerFilters & { email?: string }, page?: Page): Promise<AdminUsagePage> {
    const db = systemDb();
    const { limit, offset } = pageOf(page);
    let userIds: string[] | undefined;
    if (filters.email) {
        userIds = (await db.rpc('admin_find_users_by_email', { p_query: filters.email, p_limit: 50 })).map(row => row.user_id);
        if (!userIds.length) return NO_USAGE;
    }
    const [rows, sums] = await Promise.all([
        db.tx((trx) => trx.selectFrom('billing_ledger').selectAll().where(matching(filters, { userIds }))
            .orderBy('created_at', 'desc').orderBy('id', 'desc').offset(offset).limit(limit + 1).execute()),
        usageSums(db, filters, userIds),
    ]);
    const shown = rows.slice(0, limit);
    const entries = shown.map(row => toLedgerEntryView(row));
    const [emails, labels, operators] = await Promise.all([
        emailsOf(shown.map(row => row.user_id)),
        modelLabels(db, [...shown.map(row => row.model_key), ...sums.byModel.map(row => row.model)]),
        operatorEmails(entries),
    ]);
    return {
        entries: shown.map((row, index) => withOperator({
            ...entries[index], modelLabel: labelOf(labels, row.model_key), userId: row.user_id, userEmail: emails.get(row.user_id) ?? null,
        }, operators)),
        nextOffset: rows.length > limit ? offset + limit : null,
        totals: sums.totals,
        byModel: sums.byModel.map(row => ({ ...row, modelLabel: labelOf(labels, row.model) })),
    };
}

/**
 * What model calls charged each referenced object (an Agent task, say), net of the refunds of those charges; objects
 * with no charge are left out.
 */
export async function referenceCosts(referenceType: string, ids: readonly string[], db: ScopedDb = systemDb()): Promise<Map<string, ReferenceCost>> {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return new Map();
    const { rows } = await db.tx((trx) => billingReferenceCostsQuery(referenceType, wanted).execute(trx));
    return new Map(rows.map(row => [row.reference_id, { calls: Number(row.calls), spentMicros: Number(row.spent) }] as const));
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
