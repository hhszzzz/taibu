/**
 * How ledger entries, usage and subscriptions read in the billing center and the administrator's usage log.
 * Shared by the browser and the server; no React.
 */
import { BILLING_SOURCE_LABELS, LEDGER_KIND_LABELS, RESET_PERIOD_LABELS, type LedgerEntryView, type LedgerUsage, type ResetPeriod } from './config';
import { formatPrice, formatUsd } from './money';

const TIME = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const COUNT = new Intl.NumberFormat('en-US');

export function formatBillingTime(value: string | null | undefined): string {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? TIME.format(date) : '—';
}

export function formatBillingDay(value: string | null | undefined): string {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? DAY.format(date) : '—';
}

export function formatCount(value: number): string {
    return COUNT.format(value);
}

export function billingSourceLabel(source: string): string {
    return BILLING_SOURCE_LABELS[source] ?? source;
}

export function resetPeriodLabel(period: string): string {
    return RESET_PERIOD_LABELS[period as ResetPeriod] ?? period;
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
        ...entry.subscriptionParts.filter(part => part.micros).map(part => `订阅「${part.title}」 ${formatUsd(part.micros, { precise: true, signed: true })}`),
        entry.walletMicros ? `余额 ${formatUsd(entry.walletMicros, { precise: true, signed: true })}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
}

/** The line an entry is listed under: its own description, or where a model call came from. */
export function ledgerEntryTitle(entry: Pick<LedgerEntryView, 'kind' | 'source' | 'description'>): string {
    if (entry.description) return entry.description;
    return entry.kind === 'usage' ? `${billingSourceLabel(entry.source)}调用` : LEDGER_KIND_LABELS[entry.kind];
}
