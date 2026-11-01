import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { parseConfiguredOrigin } from '@/lib/runtime-env';
import { cnyForUsd } from './config';
import { isCentAmount, usdToMicros } from './money';
import { getBillingSettings } from './settings.server';

/**
 * 易支付（彩虹易支付 v1 协议，与 new-api 所用 go-epay 相同）：跳转 `submit.php` 下单，异步通知与同步跳回都带 MD5 签名。
 * 商户地址、商户号与密钥三项配齐才开放在线支付。
 */
export type EpayConfig = { apiUrl: string; pid: string; key: string; methods: string[] };

export const EPAY_METHOD_LABELS: Record<string, string> = { alipay: '支付宝', wxpay: '微信支付', qqpay: 'QQ 钱包' };

export function getEpayConfig(env: Record<string, string | undefined> = process.env): EpayConfig | null {
    const apiUrl = env.EPAY_API_URL?.trim(), pid = env.EPAY_PID?.trim(), key = env.EPAY_KEY?.trim();
    if (!apiUrl || !pid || !key) return null;
    let url: URL;
    try {
        url = new URL(apiUrl);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const methods = [...new Set((env.EPAY_METHODS ?? 'alipay,wxpay').split(',').map(method => method.trim())
        .filter(method => /^[a-z0-9_]{1,20}$/u.test(method)))];
    return { apiUrl: url.toString().replace(/\/+$/u, ''), pid, key, methods: methods.length ? methods : ['alipay', 'wxpay'] };
}

/** MD5 of the parameters sorted by name, without `sign`, `sign_type` and empty values, joined as k=v&… with the key appended. */
export function epaySign(params: Record<string, string>, key: string): string {
    const names = Object.keys(params).filter(name => name !== 'sign' && name !== 'sign_type' && params[name] !== '').sort();
    // The protocol does not encode values, so a separator inside one would move the boundaries the gateway signs.
    if (names.some(name => /[&=]/u.test(name) || params[name].includes('&'))) throw new Error('EPAY_PARAMS_INVALID');
    return createHash('md5').update(names.map(name => `${name}=${params[name]}`).join('&') + key, 'utf8').digest('hex');
}

export function verifyEpaySign(params: Record<string, string>, key: string): boolean {
    let expected: Buffer;
    try {
        expected = Buffer.from(epaySign(params, key));
    } catch {
        return false;
    }
    const given = Buffer.from(params.sign ?? '');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

export class EpayError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
        this.name = 'EpayError';
    }
}

export type EpayCheckoutInput =
    | { kind: 'topup'; amountUsd: number; method: string }
    | { kind: 'subscription'; planId: string; method: string };

/** Where the browser posts to pay: the gateway's submit address and the signed form fields. */
export type EpayCheckout = { url: string; params: Record<string, string> };

/** A pending order, and the signed form that takes the member to the gateway. */
export async function createEpayCheckout(userId: string, input: EpayCheckoutInput): Promise<EpayCheckout> {
    const config = getEpayConfig();
    if (!config) throw new EpayError('在线支付未开启', 503, 'PAYMENT_DISABLED');
    if (!config.methods.includes(input.method)) throw new EpayError('不支持的支付方式', 400, 'PAYMENT_METHOD_INVALID');
    const settings = await getBillingSettings();
    let usd: number;
    let creditMicros: number | null = null;
    let planId: string | null = null;
    if (input.kind === 'topup') {
        usd = input.amountUsd;
        if (!isCentAmount(usd) || usd < settings.minTopupUsd || usd > 10_000) {
            throw new EpayError(`充值金额需要在 $${settings.minTopupUsd} 到 $10000 之间，最多两位小数`, 400, 'AMOUNT_INVALID');
        }
        creditMicros = usdToMicros(usd);
    } else {
        const plan = await systemDb().tx(trx => trx.selectFrom('subscription_plans').select(['id', 'price_usd'])
            .where('id', '=', input.planId).where('enabled', '=', true).where('purchasable', '=', true).executeTakeFirst());
        if (!plan) throw new EpayError('套餐不存在或已下架', 404, 'PLAN_UNAVAILABLE');
        usd = Number(plan.price_usd);
        if (usd <= 0) throw new EpayError('免费套餐请直接用余额开通', 400, 'PLAN_FREE');
        planId = plan.id;
    }
    const payAmount = cnyForUsd(usd, settings);
    if (payAmount < 0.01) throw new EpayError('支付金额过低', 400, 'AMOUNT_INVALID');
    const tradeNo = `tb${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
    try {
        await systemDb().rpc('payment_order_create', {
            p_user_id: userId, p_trade_no: tradeNo, p_kind: input.kind, p_plan_id: planId, p_credit_micros: creditMicros,
            p_pay_amount: payAmount, p_pay_currency: 'CNY', p_pay_method: input.method,
        });
    } catch (error) {
        const { message } = toDbError(error);
        if (message === 'BILLING_PLAN_UNAVAILABLE') throw new EpayError('套餐不存在或已下架', 404, 'PLAN_UNAVAILABLE');
        if (message === 'BILLING_PLAN_LIMIT') throw new EpayError('已达到该套餐的限购次数', 409, 'PLAN_LIMIT');
        throw error;
    }
    const origin = parseConfiguredOrigin(process.env.APP_ORIGIN, 'APP_ORIGIN').origin;
    const params: Record<string, string> = {
        pid: config.pid,
        type: input.method,
        out_trade_no: tradeNo,
        notify_url: `${origin}/api/billing/epay/notify`,
        return_url: `${origin}/api/billing/epay/return`,
        // ASCII only: gateways that sign in another encoding would reject a Chinese name.
        name: input.kind === 'topup' ? `Taibu topup ${usd} USD` : 'Taibu subscription',
        money: payAmount.toFixed(2),
    };
    return { url: `${config.apiUrl}/submit.php`, params: { ...params, sign: epaySign(params, config.key), sign_type: 'MD5' } };
}

export type EpaySettlement = 'paid' | 'already-paid' | 'ignored' | 'rejected';

/**
 * Settles the order a signed gateway message reports paid: the asynchronous notification, or the browser coming back.
 * Only `TRADE_SUCCESS` with the order's exact amount credits anything, once.
 */
export async function settleEpayPayment(params: Record<string, string>): Promise<EpaySettlement> {
    const config = getEpayConfig();
    if (!config || !verifyEpaySign(params, config.key)) return 'rejected';
    if (params.trade_status !== 'TRADE_SUCCESS') return 'ignored';
    const paid = Number(params.money);
    if (!params.out_trade_no || !Number.isFinite(paid)) return 'rejected';
    try {
        const result = await systemDb().rpc('payment_order_complete', {
            p_trade_no: params.out_trade_no, p_provider: 'epay', p_paid_amount: paid,
            p_provider_trade_no: params.trade_no ?? null, p_payload: params,
        }) as { status?: string } | null;
        return result?.status === 'already_paid' ? 'already-paid' : 'paid';
    } catch (error) {
        const { message, code } = toDbError(error);
        console.error('[billing] epay settlement failed', { tradeNo: params.out_trade_no, message, code });
        return 'rejected';
    }
}
