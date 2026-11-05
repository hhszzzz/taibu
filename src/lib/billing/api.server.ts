import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, jsonOk, readJsonBody, requireAdminUser, requireUserContext } from '@/lib/api-utils';
import { readFeatureModuleStateFresh } from '@/lib/app-settings';
import { systemDb, userDb, type ScopedDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseConfiguredOrigin } from '@/lib/runtime-env';
import { isValidUUID } from '@/lib/validation';
import { getBillingSummary } from './account.server';
import {
    clampText, REDEMPTION_CODE_STATUS_LABELS, normalizeBillingSettings, parseLedgerFilters, parsePlanInput,
    type AdminBillingUserView, type BillingOverview, type BillingPaymentView, type EpayCheckoutInput,
    type PaymentOrderView, type RedemptionBatchInput, type RedemptionCodeKind, type RedemptionCodeStatus,
} from './config';
import { EPAY_METHOD_LABELS, EpayError, createEpayCheckout, getEpayConfig, settleEpayPayment, type EpaySettlement } from './epay.server';
import { emailsOf, listAllOrders, listLedger, listOrders, listUsage } from './ledger.server';
import { usdToMicros } from './money';
import {
    BillingPlanError, buyPlanWithBalance, cancelSubscription, createPlan, deletePlan, grantSubscription, listPlans, updatePlan,
} from './plans.server';
import { RedemptionError, createRedemptionCodes, disableRedemptionCode, listRedemptionCodes, redeemCode } from './redemption.server';
import { getBillingSettings, setBillingSettings } from './settings.server';

/**
 * Billing endpoints. Members read and spend on their own account through their own identity, so the database checks
 * the account is theirs; administrators act through the system identity. Gateway callbacks carry no session: the
 * signature is their authority.
 */
type Member = { db: ScopedDb; userId: string };

const REDEEM_RATE_LIMIT = { endpoint: '/api/billing/redeem', maxRequests: 10, windowMs: 10 * 60_000 } as const;
const CHECKOUT_RATE_LIMIT = { endpoint: '/api/billing/epay/checkout', maxRequests: 10, windowMs: 60_000 } as const;
const GATEWAY_BODY_LIMIT = 16 * 1024;

/** The signed-in member's own scope; callers return the Response as their reply. */
async function authenticatedMember(request: NextRequest): Promise<Member | Response> {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    return { db: auth.db, userId: auth.user.id };
}

/** The member's side follows the feature switch, failing closed when it cannot be read. */
async function member(request: NextRequest): Promise<Member | Response> {
    const state = await readFeatureModuleStateFresh('billing');
    if (state.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
    if (state.status !== 'enabled') return jsonError('钱包与用量日志当前未开放', 403, { code: 'FEATURE_DISABLED' });
    return authenticatedMember(request);
}

async function administrator(request: NextRequest): Promise<{ userId: string } | Response> {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    return { userId: auth.user.id };
}

function failure(error: unknown, action: string): Response {
    if (error instanceof BillingPlanError || error instanceof RedemptionError || error instanceof EpayError) {
        return jsonError(error.message, error.status, { code: error.code });
    }
    console.error('[billing]', { action, code: toDbError(error).code });
    return jsonError(`${action}失败`, 500);
}

const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const readBody = async (request: NextRequest) => {
    const parsed = await readJsonBody(request, 256 * 1024);
    return 'error' in parsed ? null : record(parsed.body);
};
const integer = (value: string | null) => (value !== null && /^\d{1,6}$/u.test(value) ? Number(value) : undefined);
const pageOf = (params: URLSearchParams) => ({ offset: integer(params.get('offset')), limit: integer(params.get('limit')) });

function paymentView(): BillingPaymentView {
    const config = getEpayConfig();
    return config
        ? { enabled: true, methods: config.methods.map(id => ({ id, label: EPAY_METHOD_LABELS[id] ?? id })) }
        : { enabled: false, methods: [] };
}

// ─── Member ───

export async function readBillingOverview(request: NextRequest) {
    const who = await member(request);
    if (who instanceof Response) return who;
    try {
        const [summary, plans, settings] = await Promise.all([
            getBillingSummary(who.userId, who.db), listPlans(who.db), getBillingSettings(),
        ]);
        return jsonOk({ summary, plans, settings, payment: paymentView() } satisfies BillingOverview);
    } catch (error) {
        return failure(error, '读取账户');
    }
}

/** Which purse a charge spends first; the wallet page's switch writes it. */
export async function updateBillingDeductOrder(request: NextRequest) {
    const who = await member(request);
    if (who instanceof Response) return who;
    const body = await readBody(request);
    const order = body?.deductOrder;
    if (order !== 'subscription' && order !== 'wallet') return jsonError('扣费顺序无效', 400);
    try {
        await who.db.rpc('billing_set_deduct_order', { p_user_id: who.userId, p_order: order });
        return jsonOk({ summary: await getBillingSummary(who.userId, who.db) });
    } catch (error) {
        return failure(error, '保存扣费顺序');
    }
}

async function usageReader(request: NextRequest): Promise<Member | Response> {
    const [usage, billing] = await Promise.all([
        readFeatureModuleStateFresh('usage-log'),
        readFeatureModuleStateFresh('billing'),
    ]);
    if (usage.status === 'unavailable' || billing.status === 'unavailable') return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
    if (usage.status !== 'enabled' && billing.status !== 'enabled') return jsonError('用量日志当前未开放', 403, { code: 'FEATURE_DISABLED' });
    return authenticatedMember(request);
}

export async function readBillingLedger(request: NextRequest) {
    const who = await usageReader(request);
    if (who instanceof Response) return who;
    const params = request.nextUrl.searchParams;
    const filters = parseLedgerFilters(params);
    if ('error' in filters) return jsonError(filters.error, 400);
    try {
        return jsonOk(await listLedger(who.userId, who.db, pageOf(params), filters, { sums: true }));
    } catch (error) {
        return failure(error, '读取用量日志');
    }
}

export async function readBillingOrders(request: NextRequest) {
    const who = await member(request);
    if (who instanceof Response) return who;
    try {
        return jsonOk(await listOrders(who.userId, who.db, pageOf(request.nextUrl.searchParams)));
    } catch (error) {
        return failure(error, '读取订单');
    }
}

export async function redeemBillingCode(request: NextRequest) {
    const who = await member(request);
    if (who instanceof Response) return who;
    const code = clampText((await readBody(request))?.code, 100);
    if (!code) return jsonError('请输入兑换码', 400);
    if (!(await checkRateLimit(who.userId, REDEEM_RATE_LIMIT.endpoint, REDEEM_RATE_LIMIT)).allowed) {
        return jsonError('兑换太频繁，请稍后再试', 429);
    }
    try {
        const result = await redeemCode(who.userId, code, who.db);
        // The code is spent either way; a failed read leaves the client to refresh the balance itself.
        return jsonOk({ result, summary: await getBillingSummary(who.userId, who.db).catch(() => null) });
    } catch (error) {
        return failure(error, '兑换');
    }
}

export async function buyBillingPlan(request: NextRequest, planId: string) {
    const who = await member(request);
    if (who instanceof Response) return who;
    if (!isValidUUID(planId)) return jsonError('套餐不存在或已下架', 404, { code: 'PLAN_UNAVAILABLE' });
    try {
        await buyPlanWithBalance(who.userId, planId, who.db);
        return jsonOk({ summary: await getBillingSummary(who.userId, who.db).catch(() => null) });
    } catch (error) {
        return failure(error, '购买套餐');
    }
}

export async function startEpayCheckout(request: NextRequest) {
    const who = await member(request);
    if (who instanceof Response) return who;
    const body = await readBody(request);
    const method = clampText(body?.method, 20);
    let input: EpayCheckoutInput;
    if (body?.kind === 'topup') input = { kind: 'topup', amountUsd: Number(body.amountUsd), method };
    else if (body?.kind === 'subscription' && typeof body.planId === 'string' && isValidUUID(body.planId)) input = { kind: 'subscription', planId: body.planId, method };
    else return jsonError('请选择充值金额或套餐', 400);
    if (!(await checkRateLimit(who.userId, CHECKOUT_RATE_LIMIT.endpoint, CHECKOUT_RATE_LIMIT)).allowed) {
        return jsonError('下单太频繁，请稍后再试', 429);
    }
    try {
        return jsonOk(await createEpayCheckout(who.userId, input));
    } catch (error) {
        return failure(error, '创建支付订单');
    }
}

// ─── Payment gateway ───

/** The query string, or a urlencoded body of at most 16 KiB; null when the body is larger. */
async function gatewayParams(request: NextRequest): Promise<Record<string, string> | null> {
    if (request.method !== 'POST') return Object.fromEntries(request.nextUrl.searchParams);
    const reader = request.body?.getReader();
    if (!reader) return {};
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > GATEWAY_BODY_LIMIT) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/** The signed message's settlement, for either route the gateway calls. */
async function settleGatewayRequest(request: NextRequest): Promise<EpaySettlement> {
    const params = await gatewayParams(request).catch(() => null);
    return params && Object.keys(params).length ? settleEpayPayment(params) : 'rejected';
}

/** The gateway retries until it reads `success`; an ignored status is acknowledged too. */
export async function handleEpayNotify(request: NextRequest): Promise<Response> {
    const outcome = await settleGatewayRequest(request);
    return new Response(outcome === 'rejected' ? 'fail' : 'success', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

/** The member's browser coming back from the gateway: settle what it signs, then show the billing center. */
export async function handleEpayReturn(request: NextRequest): Promise<Response> {
    const outcome = await settleGatewayRequest(request);
    const payment = outcome === 'paid' || outcome === 'already-paid' ? 'success' : outcome === 'ignored' ? 'pending' : 'fail';
    const origin = parseConfiguredOrigin(process.env.APP_ORIGIN, 'APP_ORIGIN').origin;
    return NextResponse.redirect(`${origin}/settings/billing?payment=${payment}`, 303);
}

// ─── Administrator ───

export async function adminListPlans(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    try {
        return jsonOk({ plans: await listPlans(systemDb(), { includeDisabled: true }) });
    } catch (error) {
        return failure(error, '读取套餐');
    }
}

export async function adminCreatePlan(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const input = parsePlanInput(await readBody(request));
    if ('error' in input) return jsonError(input.error, 400);
    try {
        return jsonOk({ plan: await createPlan(input.value) }, 201);
    } catch (error) {
        return failure(error, '创建套餐');
    }
}

export async function adminUpdatePlan(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('套餐不存在', 404);
    const input = parsePlanInput(await readBody(request));
    if ('error' in input) return jsonError(input.error, 400);
    try {
        const plan = await updatePlan(id, input.value);
        return plan ? jsonOk({ plan }) : jsonError('套餐不存在', 404);
    } catch (error) {
        return failure(error, '保存套餐');
    }
}

export async function adminDeletePlan(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('套餐不存在', 404);
    try {
        return await deletePlan(id) ? jsonOk({ deleted: true }) : jsonError('套餐不存在', 404);
    } catch (error) {
        return failure(error, '删除套餐');
    }
}

export async function adminListCodes(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const params = request.nextUrl.searchParams;
    const status = params.get('status') || undefined;
    const kind = params.get('kind') || undefined;
    if (status && !Object.hasOwn(REDEMPTION_CODE_STATUS_LABELS, status)) return jsonError('状态无效', 400);
    if (kind && kind !== 'balance' && kind !== 'subscription') return jsonError('类型无效', 400);
    try {
        return jsonOk({ codes: await listRedemptionCodes({
            status: status as RedemptionCodeStatus | undefined, kind: kind as RedemptionCodeKind | undefined,
        }) });
    } catch (error) {
        return failure(error, '读取兑换码');
    }
}

export async function adminCreateCodes(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const body = await readBody(request);
    const expires = clampText(body?.expiresAt, 40);
    if (expires && Number.isNaN(Date.parse(expires))) return jsonError('过期时间无效', 400);
    const common = {
        count: Number(body?.count), expiresAt: expires ? new Date(Date.parse(expires)).toISOString() : null, batchNote: clampText(body?.batchNote, 200) || null,
    };
    let input: RedemptionBatchInput;
    if (body?.kind === 'balance') input = { kind: 'balance', amountUsd: Number(body.amountUsd), ...common };
    else if (body?.kind === 'subscription') {
        if (typeof body.planId !== 'string' || !isValidUUID(body.planId)) return jsonError('请选择套餐', 400);
        input = { kind: 'subscription', planId: body.planId, ...common };
    } else return jsonError('兑换码类型无效', 400);
    try {
        return jsonOk({ codes: await createRedemptionCodes(admin.userId, input) }, 201);
    } catch (error) {
        return failure(error, '生成兑换码');
    }
}

export async function adminDisableCode(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('兑换码不存在', 404);
    try {
        return await disableRedemptionCode(id) ? jsonOk({ disabled: true }) : jsonError('兑换码不存在或已使用', 409);
    } catch (error) {
        return failure(error, '作废兑换码');
    }
}

/** Accounts whose sign-in address starts with the query, exact match first. */
export async function adminSearchUsers(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const email = request.nextUrl.searchParams.get('email')?.trim() ?? '';
    if (!email) return jsonError('请输入邮箱', 400);
    if (email.length > 254) return jsonError('邮箱过长', 400);
    try {
        const db = systemDb();
        const found = await db.rpc('admin_find_users_by_email', { p_query: email, p_limit: 20 });
        const ids = found.map(row => row.user_id);
        const [wallets, profiles] = ids.length ? await Promise.all([
            db.tx((trx) => trx.selectFrom('billing_accounts').select(['user_id', 'balance_micros']).where('user_id', 'in', ids).execute()),
            db.tx((trx) => trx.selectFrom('users').select(['id', 'nickname']).where('id', 'in', ids).execute()),
        ]) : [[], []];
        const wallet = new Map(wallets.map(row => [row.user_id, Number(row.balance_micros)]));
        const nickname = new Map(profiles.map(row => [row.id, row.nickname]));
        const users: AdminBillingUserView[] = found.map(row => ({
            userId: row.user_id, email: row.email, nickname: nickname.get(row.user_id) ?? null, walletMicros: wallet.get(row.user_id) ?? 0,
        }));
        return jsonOk({ users });
    } catch (error) {
        return failure(error, '查找用户');
    }
}

/** One account: the balance and subscriptions, a page of its ledger and its latest orders. */
export async function adminReadUser(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('用户不存在', 404);
    try {
        const db = systemDb();
        const profile = await db.tx((trx) => trx.selectFrom('users').select(['id', 'nickname']).where('id', '=', id).executeTakeFirst());
        if (!profile) return jsonError('用户不存在', 404);
        const [emails, summary, ledger, orders] = await Promise.all([
            emailsOf([id]),
            getBillingSummary(id, db),
            listLedger(id, db, pageOf(request.nextUrl.searchParams), {}, { operators: true }),
            listOrders(id, db, { limit: 20 }),
        ]);
        const user: AdminBillingUserView = { userId: id, email: emails.get(id) ?? null, nickname: profile.nickname, walletMicros: summary.walletMicros };
        return jsonOk({ user, summary, ledger, orders: orders.orders });
    } catch (error) {
        return failure(error, '读取用户账户');
    }
}

/** `adjust` adds to or takes from the wallet (never below zero); `grant` gives a plan, outside its purchase limit. */
export async function adminChangeUser(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('用户不存在', 404);
    const body = await readBody(request);
    try {
        if (body?.action === 'adjust') {
            const usd = Number(body.amountUsd);
            const micros = Number.isFinite(usd) && Math.abs(usd) <= 100_000 ? usdToMicros(usd) : 0;
            if (!micros) return jsonError('金额需要是 -100000 到 100000 之间、不为 0 的美元金额', 400);
            try {
                // 用管理员自己的身份调用：流水里记下的操作人就是他，而不是系统账号。
                await userDb(admin.userId).rpc('billing_adjust_wallet', { p_user_id: id, p_amount: micros, p_description: clampText(body.description, 200) });
            } catch (error) {
                const { message, code } = toDbError(error);
                if (message === 'INSUFFICIENT_BALANCE') return jsonError('余额不足以扣减这么多', 409, { code: 'INSUFFICIENT_BALANCE' });
                if (code === '23503') return jsonError('用户不存在', 404);
                throw error;
            }
        } else if (body?.action === 'grant') {
            if (typeof body.planId !== 'string' || !isValidUUID(body.planId)) return jsonError('请选择套餐', 400);
            await grantSubscription(id, body.planId, clampText(body.note, 200) || null);
        } else {
            return jsonError('操作无效', 400);
        }
        return jsonOk({ summary: await getBillingSummary(id).catch(() => null) });
    } catch (error) {
        return failure(error, body?.action === 'grant' ? '开通套餐' : '调整余额');
    }
}

export async function adminCancelSubscription(request: NextRequest, id: string) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    if (!isValidUUID(id)) return jsonError('订阅不存在', 404);
    try {
        await cancelSubscription(id);
        return jsonOk({ cancelled: true });
    } catch (error) {
        return failure(error, '取消订阅');
    }
}

const ORDER_STATUSES: ReadonlyArray<PaymentOrderView['status']> = ['pending', 'paid', 'expired', 'failed'];

export async function adminListOrders(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const params = request.nextUrl.searchParams;
    const status = params.get('status') || undefined;
    if (status && !ORDER_STATUSES.includes(status as PaymentOrderView['status'])) return jsonError('状态无效', 400);
    try {
        return jsonOk(await listAllOrders(pageOf(params), status as PaymentOrderView['status'] | undefined));
    } catch (error) {
        return failure(error, '读取订单');
    }
}

export async function adminReadSettings(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    try {
        return jsonOk({ settings: await getBillingSettings(), payment: paymentView() });
    } catch (error) {
        return failure(error, '读取计费设置');
    }
}

export async function adminSaveSettings(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const settings = normalizeBillingSettings((await readBody(request))?.settings, true);
    if ('error' in settings) return jsonError(settings.error, 400);
    try {
        await setBillingSettings(settings);
        return jsonOk({ settings });
    } catch (error) {
        return failure(error, '保存计费设置');
    }
}

/** Every member's model calls, filtered like the member's own ledger, plus by sign-in address prefix. */
export async function adminReadUsage(request: NextRequest) {
    const admin = await administrator(request);
    if (admin instanceof Response) return admin;
    const params = request.nextUrl.searchParams;
    const filters = parseLedgerFilters(params);
    if ('error' in filters) return jsonError(filters.error, 400);
    const email = params.get('email')?.trim() || undefined;
    if (email && email.length > 254) return jsonError('邮箱过长', 400);
    try {
        return jsonOk(await listUsage({ ...filters, email }, pageOf(params)));
    } catch (error) {
        return failure(error, '读取用量日志');
    }
}
