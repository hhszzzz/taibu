/**
 * How ledger entries, usage and subscriptions read in the billing center and the administrator's usage log.
 * Shared by the browser and the server; no React.
 */
import {
    BILLING_SOURCE_LABELS, LEDGER_KIND_LABELS, SUBSCRIPTION_WINDOW_LABELS, type LedgerEntryView, type LedgerUsage,
    type SubscriptionWindow,
} from './config';
import { formatPrice, formatUsd } from './money';

const TIME = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const SECONDS = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const COUNT = new Intl.NumberFormat('en-US');

function dateText(formatter: Intl.DateTimeFormat, value: string | null | undefined): string {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? formatter.format(date) : '—';
}

export function formatBillingTime(value: string | null | undefined): string {
    return dateText(TIME, value);
}

/** To the second, for an entry's details. */
export function formatBillingSecond(value: string | null | undefined): string {
    return dateText(SECONDS, value);
}

export function formatBillingDay(value: string | null | undefined): string {
    return dateText(DAY, value);
}

export function formatCount(value: number): string {
    return COUNT.format(value);
}

export function billingSourceLabel(source: string): string {
    return BILLING_SOURCE_LABELS[source] ?? source;
}

/** `每 5 小时` and the like, for a plan's or a subscription's allowance windows. */
export function windowLabel(period: string): string {
    return SUBSCRIPTION_WINDOW_LABELS[period as SubscriptionWindow] ?? period;
}

type TokenPrices = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null };

/** Every token costs nothing, so calls need no balance. */
export function isFreeTokenPricing(pricing: TokenPrices | undefined): boolean {
    return !!pricing && !pricing.input && !pricing.output && !pricing.cacheRead && !pricing.cacheWrite;
}

/** A text model's prices as the model menu shows them: `$0.27 / $1.1` (input / output per million tokens), or 免费. */
export function formatTokenPrices(pricing: TokenPrices | undefined): string | null {
    if (!pricing) return null;
    if (isFreeTokenPricing(pricing)) return '免费';
    return `${formatPrice(pricing.input)} / ${formatPrice(pricing.output)}`;
}

/** `输入 1,200 · 缓存读 800 · 输出 300`, or `2 张图片`; null when the entry used nothing. */
export function describeUsage(usage: LedgerUsage | null): string | null {
    if (!usage) return null;
    if (usage.images) return `${formatCount(usage.images)} 张图片`;
    const parts = [
        usage.input ? `输入 ${formatCount(usage.input)}` : null,
        usage.cacheRead ? `缓存读 ${formatCount(usage.cacheRead)}` : null,
        usage.cacheWrite ? `缓存写 ${formatCount(usage.cacheWrite)}` : null,
        usage.output ? `输出 ${formatCount(usage.output)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
}

/** What paid for an entry, or what it went back to: `订阅「月卡」 -$0.12 · 余额 -$0.03`. */
export function describeFunding(entry: Pick<LedgerEntryView, 'subscriptionParts' | 'walletMicros'>): string | null {
    const parts = [
        ...entry.subscriptionParts.filter(part => part.micros).map(part =>
            `订阅「${part.title}」${part.period ? ` · ${windowLabel(part.period)}` : ''} ${formatUsd(part.micros, { precise: true, signed: true })}`),
        entry.walletMicros ? `余额 ${formatUsd(entry.walletMicros, { precise: true, signed: true })}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
}

export type LedgerCostLine = { label: string; quantity: number; unit: 'token' | 'image'; price: number; micros: number; inputPrice?: boolean };

/**
 * What each priced quantity of a call came to, at the prices it was charged: a cache price left empty is the input
 * price, as when charging. Null when the entry kept no prices. The lines are for reading; the entry's amount is the charge.
 */
export function ledgerCostBreakdown(usage: LedgerUsage | null): LedgerCostLine[] | null {
    const prices = usage?.prices;
    if (!usage || !prices) return null;
    if (usage.images) {
        if (prices.image === undefined) return null;
        return [{ label: '图片', quantity: usage.images, unit: 'image', price: prices.image, micros: Math.round(prices.image * 10_000) * 100 * usage.images }];
    }
    const input = prices.input ?? 0;
    const lines: LedgerCostLine[] = [
        { label: '输入', quantity: usage.input ?? 0, unit: 'token', price: input, micros: 0 },
        { label: '缓存读', quantity: usage.cacheRead ?? 0, unit: 'token', price: prices.cacheRead ?? input, micros: 0, inputPrice: prices.cacheRead == null },
        { label: '缓存写', quantity: usage.cacheWrite ?? 0, unit: 'token', price: prices.cacheWrite ?? input, micros: 0, inputPrice: prices.cacheWrite == null },
        { label: '输出', quantity: usage.output ?? 0, unit: 'token', price: prices.output ?? 0, micros: 0 },
    ];
    return lines.filter(line => line.quantity > 0).map(line => ({ ...line, micros: line.quantity * line.price }));
}

/** `$3/百万 × 1,200` or `$0.04/张 × 2`. */
export function formatCostLine(line: LedgerCostLine): string {
    return `${formatPrice(line.price)}/${line.unit === 'image' ? '张' : '百万'} × ${formatCount(line.quantity)}`;
}

/** The pieces a details column summarises an entry with: priced quantities, else usage, then what paid for it. */
export function ledgerDetailParts(entry: Pick<LedgerEntryView, 'usage' | 'subscriptionParts' | 'walletMicros' | 'description'>): string[] {
    const lines = ledgerCostBreakdown(entry.usage);
    const usage = lines ? lines.map(line => `${line.label} ${formatCostLine(line)}`) : describeUsage(entry.usage)?.split(' · ') ?? [];
    const funding = describeFunding(entry)?.split(' · ') ?? [];
    const parts = [...usage, ...funding];
    return parts.length ? parts : entry.description ? [entry.description] : [];
}

/** The model as lists name it: the catalog's display name, or the ID once the model is gone. */
export function ledgerModelName(entry: Pick<LedgerEntryView, 'modelKey' | 'modelLabel'>): string | null {
    return entry.modelLabel?.name ?? entry.modelKey;
}

/** The signed amount a ledger row shows: a charge is displayed without its sign, because the column says it was spent. */
export function ledgerAmount(entry: Pick<LedgerEntryView, 'kind' | 'amountMicros'>): { micros: number; signed: boolean } {
    return entry.kind === 'usage'
        ? { micros: Math.abs(entry.amountMicros), signed: false }
        : { micros: entry.amountMicros, signed: true };
}

/** The line an entry is listed under: its own description, or where a model call came from. */
export function ledgerEntryTitle(entry: Pick<LedgerEntryView, 'kind' | 'source' | 'description'>): string {
    if (entry.description) return entry.description;
    return entry.kind === 'usage' ? `${billingSourceLabel(entry.source)}调用` : LEDGER_KIND_LABELS[entry.kind];
}
