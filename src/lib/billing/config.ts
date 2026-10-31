/**
 * Plans, ledger entries, orders and the billing settings as the API and the settings center see them, with the
 * validation of what an administrator writes. Pure data: no database, React or server-only imports.
 */
import { usdToMicros } from './money';

export const RESET_PERIODS = ['never', 'daily', 'weekly', 'monthly'] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];
export const RESET_PERIOD_LABELS: Record<ResetPeriod, string> = { never: '不重置', daily: '每日重置', weekly: '每周重置', monthly: '每月重置' };

export const DURATION_UNITS = ['day', 'month', 'year'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];
export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = { day: '天', month: '个月', year: '年' };

export type SubscriptionPlanView = {
    id: string;
    title: string;
    subtitle: string;
    features: string[];
    priceUsd: number;
    durationUnit: DurationUnit;
    durationValue: number;
    /** What each period grants, in micro-dollars. */
    allowanceMicros: number;
    resetPeriod: ResetPeriod;
    purchasable: boolean;
    enabled: boolean;
    maxPerUser: number | null;
    sortOrder: number;
};

export type SubscriptionPlanInput = Omit<SubscriptionPlanView, 'id'>;

/** What a member can spend: the wallet (below zero after a call outran it), what subscriptions have left, and the sum. */
export type BillingBalance = { walletMicros: number; subscriptionMicros: number; spendableMicros: number };

export function normalizeBillingBalance(value: unknown): BillingBalance | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const [walletMicros, subscriptionMicros, spendableMicros] = ['walletMicros', 'subscriptionMicros', 'spendableMicros']
        .map(key => typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] as number : null);
    return walletMicros === null || subscriptionMicros === null || spendableMicros === null
        ? null : { walletMicros, subscriptionMicros, spendableMicros };
}

export type BillingSubscription = {
    id: string;
    planId: string | null;
    title: string;
    source: string;
    allowanceMicros: number;
    usedMicros: number;
    resetPeriod: string;
    startsAt: string;
    endsAt: string;
    nextResetAt: string | null;
};

/** The balance with the active subscriptions its allowance part comes from. */
export type BillingSummary = BillingBalance & { subscriptions: BillingSubscription[] };

export const LEDGER_KINDS = ['usage', 'refund', 'topup', 'subscription', 'redeem', 'adjust'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
    usage: '消费', refund: '退回', topup: '充值', subscription: '订阅', redeem: '兑换', adjust: '调整',
};
export const BILLING_SOURCE_LABELS: Record<string, string> = {
    chat: '对话', analysis: '解读', enhance: '润色', image: '生图', agent: '智能体',
    admin: '管理员', balance: '余额', code: '兑换码', epay: '在线支付',
};

/** A model call's tokens, or the images it generated; `estimated` when the provider reported no usage. */
export type LedgerUsage = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
    images?: number;
    estimated?: boolean;
};

export type LedgerEntryView = {
    id: string;
    kind: LedgerKind;
    /** Negative when spent, positive when credited or returned. */
    amountMicros: number;
    walletMicros: number;
    /** Allowance shares, negative when spent and positive when returned. */
    subscriptionParts: Array<{ id: string; title: string; micros: number }>;
    walletAfterMicros: number;
    source: string;
    modelKey: string | null;
    usage: LedgerUsage | null;
    /** What the entry belongs to: a conversation, an Agent task, or the charge a refund returns. */
    referenceType: string | null;
    referenceId: string | null;
    description: string;
    createdAt: string;
};

/** Model calls in the usage log, summed: the calls, their tokens and images, and what they cost net of refunds. */
export type UsageTotals = {
    calls: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    images: number;
    spentMicros: number;
};

export type AdminUsageEntryView = LedgerEntryView & { userId: string; userEmail: string | null };

export type AdminUsagePage = {
    entries: AdminUsageEntryView[];
    nextOffset: number | null;
    totals: UsageTotals;
    byModel: Array<UsageTotals & { model: string }>;
};

export type PaymentOrderView = {
    id: string;
    tradeNo: string;
    kind: 'topup' | 'subscription';
    planId: string | null;
    planTitle: string | null;
    creditMicros: number | null;
    payAmount: number;
    payCurrency: string;
    payMethod: string | null;
    status: 'pending' | 'paid' | 'expired' | 'failed';
    paidAt: string | null;
    createdAt: string;
};

export const PAYMENT_ORDER_STATUS_LABELS: Record<PaymentOrderView['status'], string> = {
    pending: '待支付', paid: '已支付', expired: '已过期', failed: '失败',
};

export type AdminPaymentOrderView = PaymentOrderView & { userId: string; userEmail: string | null };

/** Online payment as the member sees it: whether it is on, and the methods the gateway takes. */
export type BillingPaymentView = { enabled: boolean; methods: Array<{ id: string; label: string }> };

/** What the billing center opens with. */
export type BillingOverview = {
    summary: BillingSummary;
    plans: SubscriptionPlanView[];
    settings: BillingSettings;
    payment: BillingPaymentView;
};

/** A member as the administrator's account search lists them. */
export type AdminBillingUserView = { userId: string; email: string | null; nickname: string | null; walletMicros: number };

export type RedemptionCodeKind = 'balance' | 'subscription';
export type RedemptionCodeStatus = 'unused' | 'used' | 'disabled';
export const REDEMPTION_CODE_STATUS_LABELS: Record<RedemptionCodeStatus, string> = { unused: '未使用', used: '已使用', disabled: '已作废' };

export type RedemptionCodeView = {
    id: string;
    code: string;
    kind: RedemptionCodeKind;
    amountMicros: number | null;
    planId: string | null;
    planTitle: string | null;
    status: RedemptionCodeStatus;
    usedBy: string | null;
    usedAt: string | null;
    expiresAt: string | null;
    batchNote: string | null;
    createdAt: string;
};

/** Codes one batch may create. */
export const REDEMPTION_BATCH_MAX = 200;

export type RedemptionBatchInput =
    | { kind: 'balance'; amountUsd: number; count: number; expiresAt?: string | null; batchNote?: string | null }
    | { kind: 'subscription'; planId: string; count: number; expiresAt?: string | null; batchNote?: string | null };

export type RedeemResult = { kind: RedemptionCodeKind; amountMicros: number; planTitle: string | null };

export function describePlanDuration(plan: Pick<SubscriptionPlanView, 'durationUnit' | 'durationValue'>): string {
    return `${plan.durationValue} ${DURATION_UNIT_LABELS[plan.durationUnit]}`;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isIn = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);

/** A plan as the administrator submitted it, or what is wrong with it. Amounts arrive in USD. */
export function parsePlanInput(body: unknown): { value: SubscriptionPlanInput } | { error: string } {
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const title = text(raw.title, 60);
    if (!title) return { error: '请填写套餐名称（最多 60 字）' };
    const priceUsd = Number(raw.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 100_000 || Math.round(priceUsd * 100) !== priceUsd * 100) {
        return { error: '价格需要是 0 到 100000 之间、最多两位小数的美元金额' };
    }
    const allowanceUsd = Number(raw.allowanceUsd);
    if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0 || allowanceUsd > 1_000_000) return { error: '额度需要是大于 0 的美元金额' };
    if (!isIn(DURATION_UNITS, raw.durationUnit)) return { error: '时长单位无效' };
    const durationValue = Number(raw.durationValue);
    if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 3650) return { error: '时长需要是 1 到 3650 之间的整数' };
    if (!isIn(RESET_PERIODS, raw.resetPeriod)) return { error: '重置周期无效' };
    const maxPerUser = raw.maxPerUser === null || raw.maxPerUser === undefined || raw.maxPerUser === '' ? null : Number(raw.maxPerUser);
    if (maxPerUser !== null && (!Number.isInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > 1000)) return { error: '每人限购需要留空或填 1 到 1000 的整数' };
    const features = Array.isArray(raw.features) ? raw.features.map(item => text(item, 80)).filter(Boolean) : [];
    if (features.length > 12) return { error: '套餐亮点最多 12 条' };
    const sortOrder = Number(raw.sortOrder ?? 0);
    return {
        value: {
            title, subtitle: text(raw.subtitle, 200), features, priceUsd,
            durationUnit: raw.durationUnit, durationValue,
            allowanceMicros: usdToMicros(allowanceUsd), resetPeriod: raw.resetPeriod,
            purchasable: raw.purchasable !== false, enabled: raw.enabled !== false, maxPerUser,
            sortOrder: Number.isInteger(sortOrder) ? Math.max(-1000, Math.min(1000, sortOrder)) : 0,
        },
    };
}

/** What the member's ledger and the administrator's usage log can be narrowed to. Times are ISO instants, `to` exclusive. */
export type LedgerFilters = { kind?: LedgerKind; source?: string; model?: string; from?: string; to?: string };

export function parseLedgerFilters(params: URLSearchParams): LedgerFilters | { error: string } {
    const filters: LedgerFilters = {};
    const kind = params.get('kind');
    if (kind) {
        if (!isIn(LEDGER_KINDS, kind)) return { error: '流水类型无效' };
        filters.kind = kind;
    }
    const source = params.get('source');
    if (source) {
        if (!Object.hasOwn(BILLING_SOURCE_LABELS, source)) return { error: '来源无效' };
        filters.source = source;
    }
    const model = params.get('model')?.trim();
    if (model) {
        if (model.length > 200) return { error: '模型 ID 过长' };
        filters.model = model;
    }
    for (const key of ['from', 'to'] as const) {
        const value = params.get(key);
        if (!value) continue;
        const time = Date.parse(value);
        if (Number.isNaN(time)) return { error: '时间范围无效' };
        filters[key] = new Date(time).toISOString();
    }
    return filters;
}

// ─── Settings ───

export const BILLING_SETTINGS_KEY = 'billing_settings';

/** The top-up choices offered, the smallest custom amount, and the CNY rate online payments are charged at. */
export type BillingSettings = { topupOptionsUsd: number[]; minTopupUsd: number; cnyPerUsd: number };

export const DEFAULT_BILLING_SETTINGS: BillingSettings = { topupOptionsUsd: [5, 10, 20, 50, 100], minTopupUsd: 1, cnyPerUsd: 7.3 };

const MAX_TOPUP_USD = 10_000;
const isUsd = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
    && value <= MAX_TOPUP_USD && Math.round(value * 100) === value * 100;

/** Stored settings, each field falling back to its default; `strict` reports the first invalid field instead. */
export function normalizeBillingSettings(value: unknown): BillingSettings;
export function normalizeBillingSettings(value: unknown, strict: true): BillingSettings | { error: string };
export function normalizeBillingSettings(value: unknown, strict = false): BillingSettings | { error: string } {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const options = Array.isArray(raw.topupOptionsUsd) && raw.topupOptionsUsd.length <= 8 && raw.topupOptionsUsd.every(isUsd)
        ? [...new Set(raw.topupOptionsUsd as number[])].sort((a, b) => a - b) : null;
    if (strict && !options) return { error: '充值档位需要是 1 到 8 个大于 0、最多两位小数的美元金额' };
    const min = isUsd(raw.minTopupUsd) ? raw.minTopupUsd : null;
    if (strict && min === null) return { error: '最低充值需要是大于 0、最多两位小数的美元金额' };
    const rate = typeof raw.cnyPerUsd === 'number' && Number.isFinite(raw.cnyPerUsd) && raw.cnyPerUsd >= 0.01 && raw.cnyPerUsd <= 100
        ? Math.round(raw.cnyPerUsd * 10_000) / 10_000 : null;
    if (strict && rate === null) return { error: '汇率需要在 0.01 到 100 之间' };
    return {
        topupOptionsUsd: options ?? DEFAULT_BILLING_SETTINGS.topupOptionsUsd,
        minTopupUsd: min ?? DEFAULT_BILLING_SETTINGS.minTopupUsd,
        cnyPerUsd: rate ?? DEFAULT_BILLING_SETTINGS.cnyPerUsd,
    };
}

/** What a top-up of `usd` is charged in CNY, to the cent. */
export function cnyForUsd(usd: number, settings: BillingSettings): number {
    return Math.round(usd * settings.cnyPerUsd * 100) / 100;
}
