import 'server-only';

import type { AIModelPricing } from '@/types';
import type { ScopedDb } from '@/lib/db/context.server';
import { jsonError } from '@/lib/api-utils';
import { assertSpendable, INSUFFICIENT_BALANCE_MESSAGE, isInsufficientBalance } from '@/lib/billing/account.server';

export function insufficientBalanceResponse(): Response {
  return jsonError(INSUFFICIENT_BALANCE_MESSAGE, 402, { code: 'INSUFFICIENT_BALANCE', needRecharge: true });
}

export function balanceUnavailableResponse(): Response {
  return jsonError('读取余额失败，请稍后重试', 500, { code: 'BALANCE_UNAVAILABLE' });
}

/** Return an error response when the member cannot start a platform call on a model with this pricing. */
export async function getBalanceGuardResponse(userId: string, pricing: AIModelPricing | undefined, db: ScopedDb): Promise<Response | null> {
  try {
    await assertSpendable(userId, pricing, db);
    return null;
  } catch (error) {
    if (isInsufficientBalance(error)) return insufficientBalanceResponse();
    console.error('[balance-guard] balance unavailable:', error);
    return balanceUnavailableResponse();
  }
}
