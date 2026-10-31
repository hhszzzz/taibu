import 'server-only';

import type { SubscriptionPlanRow } from '@/lib/db/billing-queries';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { isInsufficientBalance } from './account.server';
import type { DurationUnit, ResetPeriod, SubscriptionPlanInput, SubscriptionPlanView } from './config';

export class BillingPlanError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
        this.name = 'BillingPlanError';
    }
}

function toPlanView(row: SubscriptionPlanRow): SubscriptionPlanView {
    return {
        id: row.id, title: row.title, subtitle: row.subtitle,
        features: Array.isArray(row.features) ? row.features.filter((item): item is string => typeof item === 'string') : [],
        priceUsd: Number(row.price_usd), durationUnit: row.duration_unit as DurationUnit, durationValue: row.duration_value,
        allowanceMicros: Number(row.allowance_micros), resetPeriod: row.reset_period as ResetPeriod,
        purchasable: row.purchasable, enabled: row.enabled, maxPerUser: row.max_per_user, sortOrder: row.sort_order,
    };
}

function planColumns(input: SubscriptionPlanInput) {
    return {
        title: input.title, subtitle: input.subtitle, features: input.features, price_usd: input.priceUsd,
        duration_unit: input.durationUnit, duration_value: input.durationValue, allowance_micros: input.allowanceMicros,
        reset_period: input.resetPeriod, purchasable: input.purchasable, enabled: input.enabled,
        max_per_user: input.maxPerUser, sort_order: input.sortOrder,
    };
}

/** Enabled plans for members (RLS shows them nothing else); every plan for an administrator. */
export async function listPlans(db: ScopedDb = systemDb(), options?: { includeDisabled?: boolean }): Promise<SubscriptionPlanView[]> {
    const rows = await db.tx((trx) => {
        let query = trx.selectFrom('subscription_plans').selectAll().orderBy('sort_order', 'asc').orderBy('created_at', 'asc');
        if (!options?.includeDisabled) query = query.where('enabled', '=', true);
        return query.execute();
    });
    return rows.map(toPlanView);
}

export async function createPlan(input: SubscriptionPlanInput): Promise<SubscriptionPlanView> {
    const row = await systemDb().tx((trx) => trx.insertInto('subscription_plans').values(planColumns(input)).returningAll().executeTakeFirstOrThrow());
    return toPlanView(row);
}

/** Subscriptions already sold keep their own title, allowance and reset period. */
export async function updatePlan(id: string, input: SubscriptionPlanInput): Promise<SubscriptionPlanView | null> {
    const row = await systemDb().tx((trx) => trx.updateTable('subscription_plans')
        .set({ ...planColumns(input), updated_at: new Date().toISOString() })
        .where('id', '=', id).returningAll().executeTakeFirst());
    return row ? toPlanView(row) : null;
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
