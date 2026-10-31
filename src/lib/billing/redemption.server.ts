import 'server-only';

import { randomInt } from 'node:crypto';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { REDEMPTION_BATCH_MAX, type RedeemResult, type RedemptionBatchInput, type RedemptionCodeKind, type RedemptionCodeStatus, type RedemptionCodeView } from './config';
import { usdToMicros } from './money';

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 20;

export class RedemptionError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
        this.name = 'RedemptionError';
    }
}

/**
 * `tb-` and 20 lowercase letters or digits. A code is money, so it comes from a cryptographic source: Math.random's
 * state can be recovered from issued codes and the rest of a batch predicted.
 */
export function generateRedemptionCode(): string {
    let code = 'tb-';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    return code;
}

/** What is wrong with a batch request, or null. */
export function validateRedemptionBatch(input: RedemptionBatchInput): string | null {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > REDEMPTION_BATCH_MAX) return `数量需要在 1 到 ${REDEMPTION_BATCH_MAX} 之间`;
    if (input.kind === 'balance') {
        if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0 || input.amountUsd > 10_000) return '金额需要是 0 到 10000 之间的美元金额';
    } else if (input.kind !== 'subscription' || typeof input.planId !== 'string' || !input.planId) {
        return '兑换码类型无效';
    }
    if (input.expiresAt != null && (Number.isNaN(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now())) return '过期时间需要晚于现在';
    return null;
}

export async function createRedemptionCodes(adminId: string, input: RedemptionBatchInput): Promise<string[]> {
    const invalid = validateRedemptionBatch(input);
    if (invalid) throw new RedemptionError(invalid, 400, 'INVALID');
    const rows = Array.from({ length: input.count }, () => ({
        code: generateRedemptionCode(), kind: input.kind,
        amount_micros: input.kind === 'balance' ? usdToMicros(input.amountUsd) : null,
        plan_id: input.kind === 'subscription' ? input.planId : null,
        expires_at: input.expiresAt ?? null, batch_note: input.batchNote?.trim().slice(0, 200) || null, created_by: adminId,
    }));
    try {
        const inserted = await systemDb().tx((trx) => trx.insertInto('redemption_codes').values(rows).returning('code').execute());
        return inserted.map((row) => row.code);
    } catch (error) {
        if (toDbError(error).code === '23503') throw new RedemptionError('套餐不存在', 400, 'PLAN_NOT_FOUND');
        throw error;
    }
}

export async function listRedemptionCodes(filters?: { status?: RedemptionCodeStatus; kind?: RedemptionCodeKind; limit?: number }): Promise<RedemptionCodeView[]> {
    const rows = await systemDb().tx((trx) => {
        let query = trx.selectFrom('redemption_codes as code')
            .leftJoin('subscription_plans as plan', 'plan.id', 'code.plan_id')
            .select(['code.id', 'code.code', 'code.kind', 'code.amount_micros', 'code.plan_id', 'plan.title as plan_title', 'code.status',
                'code.used_by', 'code.used_at', 'code.expires_at', 'code.batch_note', 'code.created_at'])
            .orderBy('code.created_at', 'desc')
            .limit(Math.min(Math.max(filters?.limit ?? 500, 1), 2000));
        if (filters?.status) query = query.where('code.status', '=', filters.status);
        if (filters?.kind) query = query.where('code.kind', '=', filters.kind);
        return query.execute();
    });
    return rows.map((row) => ({
        id: row.id, code: row.code, kind: row.kind as RedemptionCodeKind,
        amountMicros: row.amount_micros === null ? null : Number(row.amount_micros), planId: row.plan_id, planTitle: row.plan_title ?? null,
        status: row.status as RedemptionCodeStatus, usedBy: row.used_by, usedAt: row.used_at, expiresAt: row.expires_at,
        batchNote: row.batch_note, createdAt: row.created_at,
    }));
}

/** An unused code can be disabled; a used one stays as the record of who redeemed it. */
export async function disableRedemptionCode(id: string): Promise<boolean> {
    const result = await systemDb().tx((trx) => trx.updateTable('redemption_codes').set({ status: 'disabled' })
        .where('id', '=', id).where('status', '=', 'unused').executeTakeFirst());
    return Number(result.numUpdatedRows) > 0;
}

/** Codes are issued in lowercase; one typed or pasted in capitals still matches. */
export async function redeemCode(userId: string, code: string, db: ScopedDb = systemDb()): Promise<RedeemResult> {
    const trimmed = code.trim().toLowerCase();
    if (!/^tb-[a-z0-9]{20}$/u.test(trimmed)) throw new RedemptionError('兑换码格式不正确', 400, 'INVALID_CODE');
    let result: unknown;
    try {
        result = await db.rpc('billing_redeem', { p_user_id: userId, p_code: trimmed });
    } catch (error) {
        const { message } = toDbError(error);
        if (message === 'REDEMPTION_CODE_NOT_FOUND') throw new RedemptionError('兑换码不存在', 404, 'CODE_NOT_FOUND');
        if (message === 'REDEMPTION_CODE_USED') throw new RedemptionError('兑换码已被使用', 409, 'CODE_USED');
        if (message === 'REDEMPTION_CODE_UNAVAILABLE') throw new RedemptionError('兑换码已失效', 410, 'CODE_UNAVAILABLE');
        throw error;
    }
    const value = (result ?? {}) as { kind?: string; entry?: { amount_micros?: number }; subscription?: { title?: string } | null };
    return {
        kind: value.kind === 'subscription' ? 'subscription' : 'balance',
        amountMicros: Number(value.entry?.amount_micros ?? 0),
        planTitle: value.subscription?.title ?? null,
    };
}
