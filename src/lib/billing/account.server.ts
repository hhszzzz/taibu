import 'server-only';

import { randomUUID } from 'node:crypto';
import type { AIModelConfig, AIModelPricing } from '@/types';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { SUBSCRIPTION_WINDOWS, normalizeBillingBalance, type BillingSummary, type SubscriptionWindow } from './config';
import { hasTokens, imageCostMicros, isFreeTextModel, usageCostMicros, type TokenUsage } from './pricing';

/** Where a charge came from; the ledger shows it beside the model. */
export type BillingSource = 'chat' | 'analysis' | 'enhance' | 'image' | 'agent';

export const INSUFFICIENT_BALANCE_MESSAGE = '余额不足，请充值、兑换或订阅后再试';

export class InsufficientBalanceError extends Error {
    readonly code = 'INSUFFICIENT_BALANCE';

    constructor(message = INSUFFICIENT_BALANCE_MESSAGE) {
        super(message);
        this.name = 'InsufficientBalanceError';
    }
}

export function isInsufficientBalance(error: unknown): boolean {
    return error instanceof InsufficientBalanceError || toDbError(error).message === 'INSUFFICIENT_BALANCE';
}

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);

function normalizeSummary(value: unknown): BillingSummary {
    const source = (value ?? {}) as Record<string, unknown>;
    const subscriptions = Array.isArray(source.subscriptions) ? source.subscriptions as Record<string, unknown>[] : [];
    const balances = normalizeBillingBalance(value) ?? {
        walletMicros: amount(source.walletMicros),
        subscriptionMicros: amount(source.subscriptionMicros),
        spendableMicros: amount(source.spendableMicros),
    };
    return {
        ...balances,
        deductOrder: source.deductOrder === 'wallet' ? 'wallet' : 'subscription',
        subscriptions: subscriptions.map(item => ({
            id: String(item.id),
            planId: typeof item.planId === 'string' ? item.planId : null,
            title: String(item.title ?? ''),
            source: String(item.source ?? ''),
            startsAt: String(item.startsAt),
            endsAt: String(item.endsAt),
            limits: (Array.isArray(item.limits) ? item.limits as Record<string, unknown>[] : []).flatMap(limit => {
                const period = limit.period;
                if (!SUBSCRIPTION_WINDOWS.includes(period as SubscriptionWindow)) return [];
                return [{
                    period: period as SubscriptionWindow,
                    allowanceMicros: amount(limit.allowanceMicros),
                    usedMicros: amount(limit.usedMicros),
                    nextResetAt: typeof limit.nextResetAt === 'string' ? limit.nextResetAt : null,
                }];
            }),
        })),
    };
}

/** The wallet, the allowances left and their sum. `db` may be the member's own scope; it defaults to the system's. */
export async function getBillingSummary(userId: string, db: ScopedDb = systemDb()): Promise<BillingSummary> {
    return normalizeSummary(await db.rpc('billing_summary', { p_user_id: userId }));
}

export async function getSpendableMicros(userId: string, db: ScopedDb = systemDb()): Promise<number> {
    return amount(await db.rpc('billing_spendable', { p_user_id: userId }));
}

/** Ends subscriptions past their end and abandons payment orders left pending; the maintenance job runs it. */
export async function expireDueBilling(limit = 500): Promise<{ subscriptions: number; orders: number }> {
    const result = await systemDb().rpc('billing_expire_due', { p_limit: limit }) as { subscriptions?: unknown; orders?: unknown } | null;
    return { subscriptions: amount(result?.subscriptions), orders: amount(result?.orders) };
}

/** Admission before a platform call: a free model asks for nothing, anything else needs a positive balance. */
export async function assertSpendable(userId: string, pricing?: AIModelPricing | null, db?: ScopedDb): Promise<void> {
    if (isFreeTextModel(pricing)) return;
    if (await getSpendableMicros(userId, db) <= 0) throw new InsufficientBalanceError();
}

/** The prices a charge is computed at, kept with its usage so the ledger can itemise it; a null cache price costs the input price. */
function tokenPrices(pricing: AIModelPricing | null | undefined) {
    return pricing ? { input: pricing.input ?? 0, output: pricing.output ?? 0, cacheRead: pricing.cacheRead ?? null, cacheWrite: pricing.cacheWrite ?? null } : undefined;
}

export type UsageCharge = {
    userId: string;
    model: Pick<AIModelConfig, 'id' | 'pricing'>;
    usage: TokenUsage;
    /** The provider reported no usage, so the counts are a local estimate. */
    estimated?: boolean;
    source: BillingSource;
    referenceType?: string;
    referenceId?: string;
    /** Retrying with the same key records the charge once. */
    idempotencyKey?: string;
    description?: string;
};

type ChargeRecord = {
    userId: string;
    micros: number;
    allowDebt: boolean;
    source: BillingSource;
    modelKey: string;
    usage: Record<string, unknown>;
    key: string;
    description: string;
    referenceType?: string;
    referenceId?: string;
};

/** One `billing_charge`; the idempotency key and the failure policy stay with each caller. */
function recordCharge(input: ChargeRecord) {
    return systemDb().rpc('billing_charge', {
        p_user_id: input.userId, p_amount: input.micros, p_allow_debt: input.allowDebt, p_source: input.source,
        p_model_key: input.modelKey, p_usage: input.usage,
        p_reference_type: input.referenceType ?? null, p_reference_id: input.referenceId ?? null,
        p_idempotency_key: input.key, p_description: input.description,
    });
}

/**
 * Records what a finished call used. The usage already happened, so the wallet may end slightly below zero; the next
 * top-up settles it. A free model's call is recorded at $0, so the usage log shows it too. Never throws: a failed
 * write is logged and the call stays unbilled.
 */
export async function chargeUsage(charge: UsageCharge): Promise<number> {
    if (!hasTokens(charge.usage)) return 0;
    const micros = usageCostMicros(charge.model.pricing, charge.usage);
    const prices = tokenPrices(charge.model.pricing);
    const input = {
        userId: charge.userId, micros, allowDebt: true, source: charge.source, modelKey: charge.model.id,
        usage: { ...charge.usage, ...(charge.estimated ? { estimated: true } : {}), ...(prices ? { prices } : {}) },
        key: charge.idempotencyKey ?? `${charge.source}:${randomUUID()}`, description: charge.description ?? '',
        referenceType: charge.referenceType, referenceId: charge.referenceId,
    } satisfies ChargeRecord;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await recordCharge(input);
            return micros;
        } catch (error) {
            if (attempt === 1) console.error('[billing] usage charge failed', { userId: charge.userId, key: input.key, micros, code: toDbError(error).code });
        }
    }
    return 0;
}

/** The `onUsage` of a platform call the member pays for. */
export function usageBiller(userId: string, source: BillingSource, reference?: { type: string; id: string }) {
    return async (report: { model: Pick<AIModelConfig, 'id' | 'pricing'>; usage: TokenUsage; estimated?: boolean }) => {
        await chargeUsage({
            userId, model: report.model, usage: report.usage, estimated: report.estimated, source,
            referenceType: reference?.type, referenceId: reference?.id,
        });
    };
}

/**
 * A call the member made with their own key, reported by the browser or made here with the key they stored: it lands
 * in the usage log at $0 with `byok`, so the log shows every call without the platform charging for it. `model` is
 * the provider's model ID. A no-op when the provider reported nothing. Never throws.
 */
export async function recordDirectUsage(input: {
    userId: string;
    model: string;
    usage: TokenUsage;
    source?: BillingSource;
    referenceType?: string;
    referenceId?: string;
}): Promise<void> {
    if (!hasTokens(input.usage)) return;
    const key = `byok:${randomUUID()}`;
    try {
        await recordCharge({
            userId: input.userId, micros: 0, allowDebt: true, source: input.source ?? 'chat', modelKey: input.model,
            usage: { ...input.usage, byok: true }, key, description: '自带密钥调用',
            referenceType: input.referenceType, referenceId: input.referenceId,
        });
    } catch (error) {
        console.error('[billing] byok usage record failed', { userId: input.userId, key, code: toDbError(error).code });
    }
}

export type ImagePrepayment = { key: string; micros: number; images: number };

/**
 * Generated images have a known price, charged in full before generating and never on credit. Null for a free image
 * model: there is nothing to charge or refund.
 */
export async function prepayImages(input: {
    userId: string;
    model: Pick<AIModelConfig, 'id' | 'pricing'>;
    images: number;
    referenceType?: string;
    referenceId?: string;
}): Promise<ImagePrepayment | null> {
    const micros = imageCostMicros(input.model.pricing, input.images);
    if (micros <= 0) return null;
    const key = `image:${randomUUID()}`;
    try {
        await recordCharge({
            userId: input.userId, micros, allowDebt: false, source: 'image', modelKey: input.model.id,
            usage: { images: input.images, prices: { image: input.model.pricing?.image ?? 0 } },
            referenceType: input.referenceType, referenceId: input.referenceId,
            key, description: `生成 ${input.images} 张图片`,
        });
    } catch (error) {
        if (isInsufficientBalance(error)) throw new InsufficientBalanceError();
        throw error;
    }
    return { key, micros, images: input.images };
}

/**
 * The images a free image model, or the member's own one (`byok`), delivered, recorded at $0 so the usage log shows
 * them. Never throws.
 */
export async function recordFreeImages(input: {
    userId: string;
    model: Pick<AIModelConfig, 'id'>;
    images: number;
    byok?: boolean;
    referenceType?: string;
    referenceId?: string;
}): Promise<void> {
    if (input.images <= 0) return;
    const key = `image:${randomUUID()}`;
    try {
        await recordCharge({
            userId: input.userId, micros: 0, allowDebt: true, source: 'image', modelKey: input.model.id,
            usage: { images: input.images, prices: { image: 0 }, ...(input.byok ? { byok: true } : {}) },
            referenceType: input.referenceType, referenceId: input.referenceId,
            key, description: `生成 ${input.images} 张图片`,
        });
    } catch (error) {
        console.error('[billing] image usage record failed', { userId: input.userId, key, code: toDbError(error).code });
    }
}

/** Returns the share of the images that were not delivered. */
export async function refundImages(prepayment: ImagePrepayment, missing: number): Promise<boolean> {
    const images = Math.min(Math.max(0, Math.trunc(missing)), prepayment.images);
    if (!images) return true;
    try {
        await systemDb().rpc('billing_refund', {
            p_charge_key: prepayment.key, p_amount: prepayment.micros / prepayment.images * images,
            p_idempotency_key: `${prepayment.key}:refund`, p_description: `${images} 张图片未生成，退回`,
        });
        return true;
    } catch (error) {
        console.error('[billing] image refund failed', { key: prepayment.key, images, code: toDbError(error).code });
        return false;
    }
}
