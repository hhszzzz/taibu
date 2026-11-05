import 'server-only';

import type { SubscriptionPlanRow } from '@/lib/db/billing-queries';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { isInsufficientBalance } from './account.server';
import {
    SUBSCRIPTION_WINDOWS, compareWindows, type DurationUnit, type SubscriptionLimit, type SubscriptionPlanInput,
    type SubscriptionPlanView, type SubscriptionWindow,
} from './config';
import { BillingError } from './errors';

export class BillingPlanError extends BillingError {}

const windowOf = (period: string): SubscriptionWindow =>
    SUBSCRIPTION_WINDOWS.includes(period as SubscriptionWindow) ? period as SubscriptionWindow : 'total';

function toPlanView(row: SubscriptionPlanRow, limits: SubscriptionLimit[]): SubscriptionPlanView {
    return {
        id: row.id, title: row.title, subtitle: row.subtitle,
        features: Array.isArray(row.features) ? row.features.filter((item): item is string => typeof item === 'string') : [],
        priceUsd: Number(row.price_usd), durationUnit: row.duration_unit as DurationUnit, durationValue: row.duration_value,
        limits: [...limits].sort(compareWindows),
        purchasable: row.purchasable, enabled: row.enabled, maxPerUser: row.max_per_user, sortOrder: row.sort_order,
    };
}

function planColumns(input: SubscriptionPlanInput) {
    return {
        title: input.title, subtitle: input.subtitle, features: input.features, price_usd: input.priceUsd,
        duration_unit: input.durationUnit, duration_value: input.durationValue,
        purchasable: input.purchasable, enabled: input.enabled,
        max_per_user: input.maxPerUser, sort_order: input.sortOrder,
    };
}

/** Writes a plan's allowances; an update replaces the whole set. */
type Trx = Parameters<Parameters<ScopedDb['tx']>[0]>[0];

function insertLimits(trx: Trx, planId: string, limits: readonly SubscriptionLimit[]) {
    return trx.insertInto('subscription_plan_limits')
        .values(limits.map(limit => ({ plan_id: planId, period: limit.period, allowance_micros: limit.allowanceMicros })))
        .execute();
}

/** The windows of each plan, keyed by plan; one query for the whole list. */
async function limitsOf(db: ScopedDb, planIds: readonly string[]): Promise<Map<string, SubscriptionLimit[]>> {
    const map = new Map<string, SubscriptionLimit[]>(planIds.map(id => [id, []]));
    if (!planIds.length) return map;
    const rows = await db.tx((trx) => trx.selectFrom('subscription_plan_limits')
        .selectAll().where('plan_id', 'in', [...planIds]).execute());
    for (const row of rows) map.get(row.plan_id)?.push({ period: windowOf(row.period), allowanceMicros: Number(row.allowance_micros) });
    return map;
}

/** Enabled plans for members (RLS shows them nothing else); every plan for an administrator. */
export async function listPlans(db: ScopedDb = systemDb(), options?: { includeDisabled?: boolean }): Promise<SubscriptionPlanView[]> {
    const rows = await db.tx((trx) => {
        let query = trx.selectFrom('subscription_plans').selectAll().orderBy('sort_order', 'asc').orderBy('created_at', 'asc');
        if (!options?.includeDisabled) query = query.where('enabled', '=', true);
        return query.execute();
    });
    const limits = await limitsOf(db, rows.map(row => row.id));
    return rows.map(row => toPlanView(row, limits.get(row.id) ?? []));
}

export async function createPlan(input: SubscriptionPlanInput): Promise<SubscriptionPlanView> {
    const db = systemDb();
    const row = await db.tx(async (trx) => {
        const created = await trx.insertInto('subscription_plans').values(planColumns(input)).returningAll().executeTakeFirstOrThrow();
        await insertLimits(trx, created.id, input.limits);
        return created;
    });
    return toPlanView(row, input.limits);
}

/** Subscriptions already sold keep their own title and windows. */
export async function updatePlan(id: string, input: SubscriptionPlanInput): Promise<SubscriptionPlanView | null> {
    const db = systemDb();
    const row = await db.tx(async (trx) => {
        const updated = await trx.updateTable('subscription_plans')
            .set({ ...planColumns(input), updated_at: new Date().toISOString() })
            .where('id', '=', id).returningAll().executeTakeFirst();
        if (!updated) return null;
        await trx.deleteFrom('subscription_plan_limits').where('plan_id', '=', id).execute();
        await insertLimits(trx, id, input.limits);
        return updated;
    });
    return row ? toPlanView(row, input.limits) : null;
}

/** Only a plan nothing points at can go; one with orders or codes is disabled instead. */
export async function deletePlan(id: string): Promise<boolean> {
    try {
        const result = await systemDb().tx((trx) => trx.deleteFrom('subscription_plans').where('id', '=', id).executeTakeFirst());
        return Number(result.numDeletedRows) > 0;
    } catch (error) {
        if (toDbError(error).code === '23503') throw new BillingPlanError('已有订单或兑换码引用该套餐，只能停用', 409, 'PLAN_IN_USE');
        throw error;
    }
}

function planFailure(error: unknown): never {
    const { message } = toDbError(error);
    if (isInsufficientBalance(error)) throw new BillingPlanError('余额不足，无法购买该套餐', 402, 'INSUFFICIENT_BALANCE');
    if (message === 'BILLING_PLAN_UNAVAILABLE' || message === 'BILLING_PLAN_NOT_FOUND') throw new BillingPlanError('套餐不存在或已下架', 404, 'PLAN_UNAVAILABLE');
    if (message === 'BILLING_PLAN_LIMIT') throw new BillingPlanError('已达到该套餐的限购次数', 409, 'PLAN_LIMIT');
    if (message === 'BILLING_SUBSCRIPTION_NOT_FOUND') throw new BillingPlanError('订阅不存在', 404, 'SUBSCRIPTION_NOT_FOUND');
    if (message === 'BILLING_SUBSCRIPTION_NOT_ACTIVE') throw new BillingPlanError('订阅已结束或已取消', 409, 'SUBSCRIPTION_NOT_ACTIVE');
    throw error;
}

/** The member pays the full price from the wallet; the subscription starts now. */
export async function buyPlanWithBalance(userId: string, planId: string, db: ScopedDb = systemDb()) {
    try {
        return await db.rpc('billing_buy_plan_with_balance', { p_user_id: userId, p_plan_id: planId });
    } catch (error) {
        planFailure(error);
    }
}

export async function grantSubscription(userId: string, planId: string, note?: string | null) {
    try {
        return await systemDb().rpc('billing_grant_subscription', { p_user_id: userId, p_plan_id: planId, p_note: note ?? null });
    } catch (error) {
        planFailure(error);
    }
}

export async function cancelSubscription(subscriptionId: string, note?: string | null) {
    try {
        return await systemDb().rpc('billing_cancel_subscription', { p_subscription_id: subscriptionId, p_note: note ?? null });
    } catch (error) {
        planFailure(error);
    }
}
