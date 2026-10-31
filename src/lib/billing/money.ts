/**
 * Amounts are integer micro-dollars (1 USD = 1,000,000), shared by the server and the browser. Prices stay in USD:
 * per million tokens for text, per image for image models.
 */

export const MICROS_PER_USD = 1_000_000;

/** Whole micro-dollars; the database stores them as bigint. */
export function usdToMicros(usd: number): number {
    return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
    return micros / MICROS_PER_USD;
}

function trimmed(value: number, minDigits: number, maxDigits: number) {
    return value.toLocaleString('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits, useGrouping: false });
}

/**
 * `$12.30` for balances; `precise` keeps what a single call costs (`$0.000123`) and never shows a non-zero amount as
 * `$0.00`.
 */
export function formatUsd(micros: number, options?: { precise?: boolean; signed?: boolean }): string {
    const sign = micros < 0 ? '-' : options?.signed && micros > 0 ? '+' : '';
    const usd = Math.abs(micros) / MICROS_PER_USD;
    return `${sign}$${options?.precise ? trimmed(usd, 2, 6) : trimmed(usd, 2, 2)}`;
}

/** A configured price, as the administrator wrote it: `$3`, `$0.15`, `$1.2345`. */
export function formatPrice(usd: number): string {
    return `$${trimmed(usd, 0, 4)}`;
}
