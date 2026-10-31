import 'server-only';

import { randomUUID } from 'node:crypto';
import type { AIModelConfig, AIModelPricing } from '@/types';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import type { BillingSummary } from './config';
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
    return {
        walletMicros: amount(source.walletMicros),
        subscriptionMicros: amount(source.subscriptionMicros),
        spendableMicros: amount(source.spendableMicros),
        subscriptions: subscriptions.map(item => ({
            id: String(item.id),
            planId: typeof item.planId === 'string' ? item.planId : null,
            title: String(item.title ?? ''),
            source: String(item.source ?? ''),
            allowanceMicros: amount(item.allowanceMicros),
            usedMicros: amount(item.usedMicros),
            resetPeriod: String(item.resetPeriod ?? 'never'),
            startsAt: String(item.startsAt),
            endsAt: String(item.endsAt),
            nextResetAt: typeof item.nextResetAt === 'string' ? item.nextResetAt : null,
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

/**
 * Records what a finished call used. The usage already happened, so the wallet may end slightly below zero; the next
 * top-up settles it. A free model's call is recorded at $0, so the usage log shows it too. Never throws: a failed
 * write is logged and the call stays unbilled.
 */
export async function chargeUsage(charge: UsageCharge): Promise<number> {
    if (!hasTokens(charge.usage)) return 0;
    const micros = usageCostMicros(charge.model.pricing, charge.usage);
    const args = {
        p_user_id: charge.userId, p_amount: micros, p_allow_debt: true, p_source: charge.source,
        p_model_key: charge.model.id, p_usage: charge.estimated ? { ...charge.usage, estimated: true } : charge.usage,
        p_reference_type: charge.referenceType ?? null, p_reference_id: charge.referenceId ?? null,
        p_idempotency_key: charge.idempotencyKey ?? `${charge.source}:${randomUUID()}`, p_description: charge.description ?? '',
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await systemDb().rpc('billing_charge', args);
            return micros;
        } catch (error) {
            if (attempt === 1) console.error('[billing] usage charge failed', { userId: charge.userId, key: args.p_idempotency_key, micros, code: toDbError(error).code });
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
        await systemDb().rpc('billing_charge', {
            p_user_id: input.userId, p_amount: micros, p_allow_debt: false, p_source: 'image', p_model_key: input.model.id,
            p_usage: { images: input.images }, p_reference_type: input.referenceType ?? null, p_reference_id: input.referenceId ?? null,
            p_idempotency_key: key, p_description: `生成 ${input.images} 张图片`,
        });
    } catch (error) {
        if (isInsufficientBalance(error)) throw new InsufficientBalanceError();
        throw error;
    }
    return { key, micros, images: input.images };
}

/** The images a free image model delivered, recorded at $0 so the usage log shows them. Never throws. */
export async function recordFreeImages(input: {
    userId: string;
    model: Pick<AIModelConfig, 'id'>;
    images: number;
    referenceType?: string;
    referenceId?: string;
}): Promise<void> {
    if (input.images <= 0) return;
    const key = `image:${randomUUID()}`;
    try {
        await systemDb().rpc('billing_charge', {
            p_user_id: input.userId, p_amount: 0, p_allow_debt: true, p_source: 'image', p_model_key: input.model.id,
            p_usage: { images: input.images }, p_reference_type: input.referenceType ?? null, p_reference_id: input.referenceId ?? null,
            p_idempotency_key: key, p_description: `生成 ${input.images} 张图片`,
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
