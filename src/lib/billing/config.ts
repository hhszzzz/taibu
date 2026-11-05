/**
 * Plans, ledger entries, orders and the billing settings as the API and the settings center see them, with the
 * validation of what an administrator writes. Pure data: no database, React or server-only imports.
 */
import { isCentAmount, usdToMicros } from './money';

/** A subscription's allowances, one window each; a charge spends the shortest window first. */
export const SUBSCRIPTION_WINDOWS = ['five_hour', 'daily', 'weekly', 'monthly', 'total'] as const;
export type SubscriptionWindow = (typeof SUBSCRIPTION_WINDOWS)[number];
export const SUBSCRIPTION_WINDOW_LABELS: Record<SubscriptionWindow, string> = {
    five_hour: '每 5 小时', daily: '每天', weekly: '每周', monthly: '每月', total: '整个订阅期',
};
/** Shortest window first, as allowances are listed and charged. */
export function compareWindows(a: { period: SubscriptionWindow }, b: { period: SubscriptionWindow }): number {
    return SUBSCRIPTION_WINDOWS.indexOf(a.period) - SUBSCRIPTION_WINDOWS.indexOf(b.period);
}
/** One allowance of a plan or a subscription, in micro-dollars. */
export type SubscriptionLimit = { period: SubscriptionWindow; allowanceMicros: number };

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
    /** One allowance per window, shortest first; at least one. */
    limits: SubscriptionLimit[];
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

export type BillingSubscriptionLimit = SubscriptionLimit & {
    usedMicros: number;
    /** When this window refills; null for the whole-term allowance. */
    nextResetAt: string | null;
};

export type BillingSubscription = {
    id: string;
    planId: string | null;
    title: string;
    source: string;
    startsAt: string;
    endsAt: string;
    limits: BillingSubscriptionLimit[];
};

export const DEDUCT_ORDERS = ['subscription', 'wallet'] as const;
export type DeductOrder = (typeof DEDUCT_ORDERS)[number];
export const DEDUCT_ORDER_LABELS: Record<DeductOrder, string> = { subscription: '先扣订阅额度', wallet: '先扣余额' };

/** The balance with the active subscriptions its allowance part comes from, and which purse a charge spends first. */
export type BillingSummary = BillingBalance & { subscriptions: BillingSubscription[]; deductOrder: DeductOrder };

export const LEDGER_KINDS = ['usage', 'refund', 'topup', 'subscription', 'redeem', 'adjust'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
    usage: '消费', refund: '退回', topup: '充值', subscription: '订阅', redeem: '兑换', adjust: '调整',
};
export const LEDGER_KIND_TONES: Record<LedgerKind, 'neutral' | 'accent' | 'success' | 'warning'> = {
    usage: 'neutral', refund: 'success', topup: 'success', subscription: 'accent', redeem: 'accent', adjust: 'warning',
};
export const BILLING_SOURCE_LABELS: Record<string, string> = {
    chat: '对话', analysis: '解读', enhance: '润色', image: '生图', agent: '智能体',
    admin: '管理员', balance: '余额', code: '兑换码', epay: '在线支付',
};

/** The prices a call was charged at, in USD per million tokens or per image; a cache price left null cost the input price. */
export type LedgerPrices = { input?: number; output?: number; cacheRead?: number | null; cacheWrite?: number | null; image?: number };

/**
 * A model call's tokens, or the images it generated; `estimated` when the provider reported no usage, `prices` when
 * the charge kept the prices it was computed at (entries recorded before that have none).
 */
export type LedgerUsage = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
    images?: number;
    estimated?: boolean;
    /** The call used the member's own key: recorded for the usage log, never charged. */
    byok?: boolean;
    prices?: LedgerPrices;
};

/** How a charged model is listed: its catalog name and icon; null once the model is deleted. */
export type LedgerModelLabel = { name: string; vendor: string; icon: string | null };

export type LedgerEntryView = {
    id: string;
    kind: LedgerKind;
    /** Negative when spent, positive when credited or returned. */
    amountMicros: number;
    walletMicros: number;
    /** Allowance shares, negative when spent and positive when returned. */
    subscriptionParts: Array<{ id: string; title: string; period?: SubscriptionWindow; micros: number }>;
    walletAfterMicros: number;
    source: string;
    modelKey: string | null;
    usage: LedgerUsage | null;
    /** What the entry belongs to: a conversation, an Agent task, or the charge a refund returns. */
    referenceType: string | null;
    referenceId: string | null;
    description: string;
    createdAt: string;
    modelLabel?: LedgerModelLabel | null;
    /** An administrator's adjustment: who made it, by sign-in address. */
    operatorEmail?: string | null;
};

/** A ledger entry with the account it belongs to; listings that span members fill these in. */
export type LedgerEntryWithUser = LedgerEntryView & { userId?: string; userEmail?: string | null };

/** Model calls in the usage log, summed: the calls, their tokens and images, and what they cost net of refunds. */
export type UsageTotals = {
    calls: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** Already counted in `output`; shown as its own line. */
    reasoning: number;
    images: number;
    spentMicros: number;
};

export type UsageByModel = UsageTotals & { model: string; modelLabel?: LedgerModelLabel | null };

/** What an object's model calls cost, net of refunds: an Agent task's, say. */
export type ReferenceCost = { calls: number; spentMicros: number };

/** A page of one member's ledger; the first page also carries the spending sums within the filters. */
export type LedgerPage = { entries: LedgerEntryView[]; nextOffset: number | null; totals?: UsageTotals; byModel?: UsageByModel[] };

export type AdminUsageEntryView = LedgerEntryView & { userId: string; userEmail: string | null };

export type AdminUsagePage = {
    entries: AdminUsageEntryView[];
    nextOffset: number | null;
    totals: UsageTotals;
    byModel: UsageByModel[];
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

/** What the browser posts to start an online payment, and the signed form it posts to the gateway. */
export type EpayCheckoutInput =
    | { kind: 'topup'; amountUsd: number; method: string }
    | { kind: 'subscription'; planId: string; method: string };
export type EpayCheckout = { url: string; params: Record<string, string> };

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

/** Trim and cap a user-supplied string; non-strings become empty. */
export const clampText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isIn = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);

/** The plan's allowances: one per window, at most one per period, amounts in USD. */
function parsePlanLimits(raw: unknown): { value: SubscriptionLimit[] } | { error: string } {
    if (!Array.isArray(raw) || raw.length === 0) return { error: '请至少设置一个额度周期' };
    if (raw.length > SUBSCRIPTION_WINDOWS.length) return { error: '额度周期过多' };
    const seen = new Set<string>();
    const value: SubscriptionLimit[] = [];
    for (const item of raw) {
        const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        if (!isIn(SUBSCRIPTION_WINDOWS, entry.period)) return { error: '额度周期无效' };
        if (seen.has(entry.period)) return { error: '同一个额度周期只能设置一次' };
        seen.add(entry.period);
        const allowanceUsd = Number(entry.allowanceUsd);
        if (!Number.isFinite(allowanceUsd) || allowanceUsd <= 0 || allowanceUsd > 1_000_000) return { error: '额度需要是大于 0 的美元金额' };
        value.push({ period: entry.period, allowanceMicros: usdToMicros(allowanceUsd) });
    }
    return { value: value.sort(compareWindows) };
}

/** A plan as the administrator submitted it, or what is wrong with it. Amounts arrive in USD. */
export function parsePlanInput(body: unknown): { value: SubscriptionPlanInput } | { error: string } {
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const title = clampText(raw.title, 60);
    if (!title) return { error: '请填写套餐名称（最多 60 字）' };
    const priceUsd = Number(raw.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 100_000 || !isCentAmount(priceUsd)) {
        return { error: '价格需要是 0 到 100000 之间、最多两位小数的美元金额' };
    }
    const limits = parsePlanLimits(raw.limits);
    if ('error' in limits) return limits;
    if (!isIn(DURATION_UNITS, raw.durationUnit)) return { error: '时长单位无效' };
    const durationValue = Number(raw.durationValue);
    if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 3650) return { error: '时长需要是 1 到 3650 之间的整数' };
    const maxPerUser = raw.maxPerUser === null || raw.maxPerUser === undefined || raw.maxPerUser === '' ? null : Number(raw.maxPerUser);
    if (maxPerUser !== null && (!Number.isInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > 1000)) return { error: '每人限购需要留空或填 1 到 1000 的整数' };
    const features = Array.isArray(raw.features) ? raw.features.map(item => clampText(item, 80)).filter(Boolean) : [];
    if (features.length > 12) return { error: '套餐亮点最多 12 条' };
    const sortOrder = Number(raw.sortOrder ?? 0);
    return {
        value: {
            title, subtitle: clampText(raw.subtitle, 200), features, priceUsd,
            durationUnit: raw.durationUnit, durationValue, limits: limits.value,
            purchasable: raw.purchasable !== false, enabled: raw.enabled !== false, maxPerUser,
            sortOrder: Number.isInteger(sortOrder) ? Math.max(-1000, Math.min(1000, sortOrder)) : 0,
        },
    };
}

/** What the member's ledger and the administrator's usage log can be narrowed to. Times are ISO instants, `to` exclusive. */
export type LedgerFilters = { kind?: LedgerKind; source?: string; model?: string; from?: string; to?: string; query?: string };

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
    const query = params.get('q')?.trim();
    if (query) {
        if (query.length > 100) return { error: '搜索词过长' };
        filters.query = query;
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

/** The largest single top-up, in USD, that a member may pay or enter. */
export const MAX_TOPUP_USD = 10_000;
const isUsd = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
    && value <= MAX_TOPUP_USD && isCentAmount(value);

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
