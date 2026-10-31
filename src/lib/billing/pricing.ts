/**
 * What a model call costs, shared by every platform path (AI SDK calls, the Agent's Pi requests, image generation)
 * so one usage is always priced the same way. Pure: no database or server-only imports.
 */
import type { LanguageModelUsage } from 'ai';
import type { AIModelPricing } from '@/types';
import { estimateTokens } from '@/lib/agent/token-estimate';
import { toPiUsage } from '@/lib/agent/usage';

/** Token counts of one call. Output includes reasoning tokens, as providers bill them. */
export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number };

// numeric(12,4): every price is a whole number of 1/10000 dollars, so costs are computed exactly.
const PRICE_UNITS = BigInt(10_000);
const units = (price: number | null | undefined) => BigInt(Math.round((price ?? 0) * 10_000));
const count = (value: number | undefined) => BigInt(Number.isFinite(value) && value! > 0 ? Math.round(value!) : 0);

/** Text calls need both the input and the output price; an unpriced model is not offered on the platform. */
export function isTextPriced(pricing: AIModelPricing | null | undefined): pricing is AIModelPricing {
    return pricing?.input != null && pricing.output != null;
}

export function isImagePriced(pricing: AIModelPricing | null | undefined): pricing is AIModelPricing {
    return pricing?.image != null;
}

/** Every token costs nothing: such a model needs no balance. */
export function isFreeTextModel(pricing: AIModelPricing | null | undefined): boolean {
    return isTextPriced(pricing) && pricing.input === 0 && pricing.output === 0
        && (pricing.cacheRead ?? 0) === 0 && (pricing.cacheWrite ?? 0) === 0;
}

/**
 * Micro-dollars for one call, rounded up: tokens × USD per million tokens is micro-dollars per token. Cached input
 * without its own price costs the input price.
 */
export function usageCostMicros(pricing: AIModelPricing | null | undefined, usage: TokenUsage): number {
    if (!pricing) return 0;
    const input = units(pricing.input);
    const total = count(usage.input) * input
        + count(usage.cacheRead) * (pricing.cacheRead == null ? input : units(pricing.cacheRead))
        + count(usage.cacheWrite) * (pricing.cacheWrite == null ? input : units(pricing.cacheWrite))
        + count(usage.output) * units(pricing.output);
    return Number((total + PRICE_UNITS - BigInt(1)) / PRICE_UNITS);
}

/** Micro-dollars for `images` generated images. */
export function imageCostMicros(pricing: AIModelPricing | null | undefined, images: number): number {
    return Number(units(pricing?.image) * BigInt(100)) * Math.max(0, Math.trunc(images));
}

export function hasTokens(usage: TokenUsage): boolean {
    return usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0;
}

/** A call whose provider reported no usage: the prompt and the reply as counted locally. */
export function estimateUsage(model: string, prompt: string, output: string): TokenUsage {
    return { input: estimateTokens(model, prompt), output: estimateTokens(model, output), cacheRead: 0, cacheWrite: 0 };
}

export function tokenUsageOf(usage: LanguageModelUsage | undefined): TokenUsage {
    const { input, output, cacheRead, cacheWrite, reasoning } = toPiUsage(usage);
    return { input, output, cacheRead, cacheWrite, ...(reasoning === undefined ? {} : { reasoning }) };
}

/** The same prices on a Pi model, so Pi's own cost figures agree with what is charged. */
export function piModelCost(pricing: AIModelPricing | null | undefined) {
    const input = pricing?.input ?? 0;
    return { input, output: pricing?.output ?? 0, cacheRead: pricing?.cacheRead ?? input, cacheWrite: pricing?.cacheWrite ?? input };
}
