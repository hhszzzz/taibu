import test from 'node:test';
import assert from 'node:assert/strict';

import { MICROS_PER_USD, formatPrice, formatUsd, isCentAmount, microsToUsd, usdToMicros } from '../lib/billing/money';
import {
  DEFAULT_BILLING_SETTINGS,
  cnyForUsd,
  normalizeBillingBalance,
  normalizeBillingSettings,
  parseLedgerFilters,
  parsePlanInput,
} from '../lib/billing/config';
import {
  billingSourceLabel,
  describeFunding,
  describeUsage,
  formatBillingDay,
  formatBillingSecond,
  formatBillingTime,
  formatCostLine,
  ledgerCostBreakdown,
  ledgerDetailParts,
  ledgerModelName,
  formatTokenPrices,
  isFreeTokenPricing,
  ledgerEntryTitle,
  windowLabel,
} from '../lib/billing/format';
import { estimateUsage, hasTokens, imageCostMicros, tokenUsageOf, usageCostMicros } from '../lib/billing/pricing';
import { epaySign, getEpayConfig, settleEpayPayment, verifyEpaySign } from '../lib/billing/epay.server';
import { generateRedemptionCode, validateRedemptionBatch } from '../lib/billing/redemption.server';
const PRICED = { input: 2, output: 4, cacheRead: 1, cacheWrite: null, image: 0.02 };
const noUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

test('money converts between USD and whole micro-dollars and formats balances and prices', () => {
  assert.equal(MICROS_PER_USD, 1_000_000);
  assert.equal(usdToMicros(12.3), 12_300_000);
  assert.equal(usdToMicros(0.000001), 1);
  assert.equal(usdToMicros(1.234567), 1_234_567);
  assert.equal(microsToUsd(12_300_000), 12.3);

  assert.equal(formatUsd(12_300_000), '$12.30');
  assert.equal(formatUsd(-12_300_000), '-$12.30');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(123, { precise: true }), '$0.000123');
  assert.equal(formatUsd(1_500_000, { signed: true }), '+$1.50');
  assert.equal(formatUsd(-1_500_000, { signed: true }), '-$1.50');
  assert.equal(formatPrice(3), '$3');
  assert.equal(formatPrice(0.15), '$0.15');
  assert.equal(formatPrice(1.2345), '$1.2345');
});

test('a billing balance requires all three finite amounts', () => {
  assert.deepEqual(normalizeBillingBalance({ walletMicros: 1, subscriptionMicros: 2, spendableMicros: 3 }), {
    walletMicros: 1, subscriptionMicros: 2, spendableMicros: 3,
  });
  assert.equal(normalizeBillingBalance(null), null);
  assert.equal(normalizeBillingBalance({ walletMicros: 1, subscriptionMicros: 2 }), null);
  assert.equal(normalizeBillingBalance({ walletMicros: 1, subscriptionMicros: 2, spendableMicros: Number.NaN }), null);
  assert.equal(normalizeBillingBalance({ walletMicros: '1', subscriptionMicros: 2, spendableMicros: 3 }), null);
});

test('plan input accepts a complete plan and rejects each invalid field', () => {
  const valid = parsePlanInput({
    title: ' 月卡 ', subtitle: ' 每月额度 ', features: [' 亮点 ', '', 3],
    priceUsd: 3, limits: [{ period: 'monthly', allowanceUsd: 5 }, { period: 'five_hour', allowanceUsd: 1 }],
    durationUnit: 'month', durationValue: 1,
    purchasable: false, enabled: true, maxPerUser: 2, sortOrder: 5000,
  });
  assert.ok('value' in valid);
  assert.deepEqual(valid.value, {
    title: '月卡', subtitle: '每月额度', features: ['亮点'],
    priceUsd: 3, durationUnit: 'month', durationValue: 1,
    limits: [{ period: 'five_hour', allowanceMicros: 1_000_000 }, { period: 'monthly', allowanceMicros: 5_000_000 }],
    purchasable: false, enabled: true, maxPerUser: 2, sortOrder: 1000,
  });

  const errors: Array<[Record<string, unknown>, RegExp]> = [
    [{ title: '' }, /套餐名称/u],
    [{ priceUsd: -1 }, /价格/u],
    [{ priceUsd: 1.234 }, /价格/u],
    [{ limits: [] }, /额度周期/u],
    [{ limits: [{ period: 'hourly', allowanceUsd: 1 }] }, /额度周期/u],
    [{ limits: [{ period: 'daily', allowanceUsd: 0 }] }, /额度/u],
    [{ limits: [{ period: 'daily', allowanceUsd: 1 }, { period: 'daily', allowanceUsd: 2 }] }, /只能设置一次/u],
    [{ limits: [{ period: 'daily', allowanceUsd: 1_000_001 }] }, /额度/u],
    [{ limits: ['daily', 'weekly', 'monthly', 'total', 'five_hour', 'monthly'].map(period => ({ period, allowanceUsd: 1 })) }, /额度周期过多/u],
    [{ durationUnit: 'week' }, /时长单位/u],
    [{ durationValue: 0 }, /时长/u],
    [{ maxPerUser: 0 }, /限购/u],
    [{ features: Array.from({ length: 13 }, () => 'x') }, /12 条/u],
  ];
  const base = {
    title: '套餐', priceUsd: 1, limits: [{ period: 'monthly', allowanceUsd: 1 }], durationUnit: 'month', durationValue: 1,
  };
  for (const [overrides, pattern] of errors) {
    const result = parsePlanInput({ ...base, ...overrides });
    assert.ok('error' in result, JSON.stringify(overrides));
    assert.match(result.error, pattern);
  }
});

test('ledger filters accept only known kinds, sources, models and instants', () => {
  const params = new URLSearchParams({ kind: 'usage', source: 'chat', model: ' gpt-4.1 ', from: '2026-01-01T00:00:00Z' });
  assert.deepEqual(parseLedgerFilters(params), {
    kind: 'usage', source: 'chat', model: 'gpt-4.1', from: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(parseLedgerFilters(new URLSearchParams()), {});
  for (const [key, value] of [['kind', 'refunded'], ['source', 'stripe'], ['from', 'yesterday'], ['model', 'x'.repeat(201)]]) {
    const result = parseLedgerFilters(new URLSearchParams({ [key]: value }));
    assert.ok('error' in result, key);
  }
});

test('billing settings fall back field by field and strict mode names the first invalid one', () => {
  assert.deepEqual(normalizeBillingSettings(null), DEFAULT_BILLING_SETTINGS);
  assert.deepEqual(normalizeBillingSettings({
    topupOptionsUsd: [20, 5, 20], minTopupUsd: 2, cnyPerUsd: 7.123456,
  }), { topupOptionsUsd: [5, 20], minTopupUsd: 2, cnyPerUsd: 7.1235 });
  assert.deepEqual(normalizeBillingSettings({ topupOptionsUsd: [0], minTopupUsd: -1, cnyPerUsd: 0 }), DEFAULT_BILLING_SETTINGS);
  assert.deepEqual(normalizeBillingSettings({ topupOptionsUsd: [0] }, true), { error: '充值档位需要是 1 到 8 个大于 0、最多两位小数的美元金额' });
  assert.deepEqual(normalizeBillingSettings({ topupOptionsUsd: [5], minTopupUsd: 0 }, true), { error: '最低充值需要是大于 0、最多两位小数的美元金额' });
  assert.deepEqual(normalizeBillingSettings({ topupOptionsUsd: [5], minTopupUsd: 1, cnyPerUsd: 0 }, true), { error: '汇率需要在 0.01 到 100 之间' });
  // 0.29 * 100 is 28.999… in binary floating point; a valid cent amount must still pass.
  assert.equal(isCentAmount(0.29), true);
  assert.equal(isCentAmount(9.99), true);
  assert.equal(isCentAmount(1.005), false);
  assert.equal(isCentAmount(Number.NaN), false);
  assert.equal(isCentAmount(10), true);
  assert.equal(cnyForUsd(10, { ...DEFAULT_BILLING_SETTINGS, cnyPerUsd: 7.3 }), 73);
  assert.equal(cnyForUsd(9.9, { ...DEFAULT_BILLING_SETTINGS, cnyPerUsd: 7.2 }), 71.28);
});

test('token usage is priced per million tokens, cached input defaults to the input price, and rounds up', () => {
  assert.equal(usageCostMicros(PRICED, { ...noUsage, input: 1_000_000 }), 2_000_000);
  assert.equal(usageCostMicros(PRICED, { ...noUsage, output: 1_000_000 }), 4_000_000);
  assert.equal(usageCostMicros(PRICED, { ...noUsage, cacheRead: 1_000_000 }), 1_000_000);
  assert.equal(usageCostMicros({ ...PRICED, cacheRead: null }, { ...noUsage, cacheRead: 1_000_000 }), 2_000_000);
  assert.equal(usageCostMicros(PRICED, { ...noUsage, cacheWrite: 1_000_000 }), 2_000_000);
  assert.equal(usageCostMicros({ ...PRICED, input: 0.0001 }, { ...noUsage, input: 1 }), 1, 'a fraction of a micro-dollar rounds up');
  assert.equal(usageCostMicros(PRICED, { ...noUsage, output: 1_000_000, reasoning: 1_000_000 }), 4_000_000, 'reasoning is already inside output and is never billed twice');
  assert.equal(usageCostMicros(null, { ...noUsage, input: 1_000_000 }), 0);
  assert.equal(imageCostMicros(PRICED, 2), 40_000);
  assert.equal(imageCostMicros(null, 2), 0);
  assert.equal(imageCostMicros(PRICED, -1), 0);
  assert.equal(hasTokens(noUsage), false);
  assert.equal(hasTokens({ ...noUsage, output: 1 }), true);

  const estimate = estimateUsage('gpt-4.1', 'a prompt', 'an answer');
  assert.ok(estimate.input > 0 && estimate.output > 0);
  assert.deepEqual([estimate.cacheRead, estimate.cacheWrite], [0, 0]);
});

test('AI SDK usage maps cached input and reasoning without double counting', () => {
  const detailed = tokenUsageOf({
    inputTokens: 100, outputTokens: 20, totalTokens: 120,
    inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 20, cacheWriteTokens: 10 },
    outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
  });
  assert.deepEqual(detailed, { input: 70, output: 20, cacheRead: 20, cacheWrite: 10, reasoning: 5 });

  const derived = tokenUsageOf({
    inputTokens: 100, outputTokens: 20, totalTokens: 120,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 20, cacheWriteTokens: 10 },
  } as never);
  assert.deepEqual(derived, { input: 70, output: 20, cacheRead: 20, cacheWrite: 10 });

  assert.deepEqual(tokenUsageOf(undefined), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('formatting helpers describe usage, funding and ledger titles in Chinese', () => {
  assert.equal(formatBillingTime(null), '—');
  assert.equal(formatBillingTime('not-a-date'), '—');
  assert.equal(formatBillingDay('2026-03-04T05:06:07Z'), formatBillingDay('2026-03-04T05:06:07Z'));
  assert.equal(formatTokenPrices(PRICED), '$2 / $4');
  assert.equal(formatTokenPrices({ input: 0, output: 0, cacheRead: null, cacheWrite: null }), '免费');
  assert.equal(formatTokenPrices(undefined), null);
  assert.equal(isFreeTokenPricing({ input: 0, output: 0, cacheRead: null, cacheWrite: null }), true);
  assert.equal(isFreeTokenPricing(undefined), false);
  assert.equal(describeUsage(null), null);
  assert.equal(describeUsage({ input: 1200, cacheRead: 800, output: 300 }), '输入 1,200 · 缓存读 800 · 输出 300');
  assert.equal(describeUsage({ images: 2 }), '2 张图片');
  assert.equal(describeUsage({ estimated: true }), null);
  assert.equal(describeFunding({
    subscriptionParts: [{ id: 's1', title: '月卡', micros: -120_000 }, { id: 's2', title: '空', micros: 0 }],
    walletMicros: -30_000,
  }), '订阅「月卡」 -$0.12 · 余额 -$0.03');
  assert.equal(describeFunding({ subscriptionParts: [], walletMicros: 0 }), null);
  assert.equal(ledgerEntryTitle({ kind: 'usage', source: 'chat', description: '' }), '对话调用');
  assert.equal(ledgerEntryTitle({ kind: 'topup', source: 'epay', description: '充值 $5' }), '充值 $5');
  assert.equal(ledgerEntryTitle({ kind: 'topup', source: 'epay', description: '' }), '充值');
  assert.equal(billingSourceLabel('agent'), '太卜Agent');
  assert.equal(billingSourceLabel('unknown'), 'unknown');
  assert.equal(windowLabel('five_hour'), '每 5 小时');
  assert.equal(windowLabel('daily'), '每天');
  assert.equal(windowLabel('weekly'), '每周');
  assert.equal(windowLabel('monthly'), '每月');
  assert.equal(windowLabel('total'), '整个订阅期');
});

test('epay configuration needs an address, merchant and key, and filters methods', () => {
  assert.equal(getEpayConfig({}), null);
  assert.equal(getEpayConfig({ EPAY_API_URL: 'https://pay.example', EPAY_PID: '1' }), null);
  assert.equal(getEpayConfig({ EPAY_API_URL: 'ftp://pay.example', EPAY_PID: '1', EPAY_KEY: 'k' }), null);
  assert.deepEqual(getEpayConfig({
    EPAY_API_URL: ' https://pay.example/ ', EPAY_PID: ' 1001 ', EPAY_KEY: ' secret ',
  }), { apiUrl: 'https://pay.example', pid: '1001', key: 'secret', methods: ['alipay', 'wxpay'] });
  assert.deepEqual(getEpayConfig({
    EPAY_API_URL: 'https://pay.example', EPAY_PID: '1', EPAY_KEY: 'k', EPAY_METHODS: 'alipay, Alipay,bad method,wxpay',
  })?.methods, ['alipay', 'wxpay']);
  assert.deepEqual(getEpayConfig({
    EPAY_API_URL: 'https://pay.example', EPAY_PID: '1', EPAY_KEY: 'k', EPAY_METHODS: '$$',
  })?.methods, ['alipay', 'wxpay']);
});

test('epay signing sorts parameters, skips sign fields and empty values, and is compared safely', () => {
  const params = {
    pid: '1001', type: 'alipay', out_trade_no: 'tb123',
    notify_url: 'https://example.test/api/billing/epay/notify',
    return_url: 'https://example.test/api/billing/epay/return',
    name: 'Taibu topup 10 USD', money: '73.00',
  };
  assert.equal(epaySign(params, 'secret'), '0f43f8b62bd6c37f9e161a2f749e7f7b');
  assert.equal(epaySign({ ...params, sign: 'ignored', sign_type: 'MD5', empty: '' }, 'secret'), '0f43f8b62bd6c37f9e161a2f749e7f7b');
  assert.equal(verifyEpaySign({ ...params, sign: '0f43f8b62bd6c37f9e161a2f749e7f7b' }, 'secret'), true);
  assert.equal(verifyEpaySign({ ...params, sign: '0f43f8b62bd6c37f9e161a2f749e7f7b' }, 'wrong'), false);
  assert.equal(verifyEpaySign({ ...params, money: '0.01', sign: '0f43f8b62bd6c37f9e161a2f749e7f7b' }, 'secret'), false);
  assert.equal(verifyEpaySign(params, 'secret'), false, 'a missing signature is rejected');
  assert.throws(() => epaySign({ ...params, name: 'a&b' }, 'secret'), /EPAY_PARAMS_INVALID/u);
  assert.equal(verifyEpaySign({ ...params, name: 'a&b', sign: 'x' }, 'secret'), false);
});

test('redemption codes are lowercase, cryptographically shaped and batch input is validated', () => {
  const codes = new Set(Array.from({ length: 200 }, generateRedemptionCode));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^tb-[a-z0-9]{20}$/u);

  assert.equal(validateRedemptionBatch({ kind: 'balance', amountUsd: 5, count: 1 }), null);
  assert.equal(validateRedemptionBatch({ kind: 'subscription', planId: 'plan-1', count: 200 }), null);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 5, count: 0 }) ?? '', /数量/u);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 5, count: 201 }) ?? '', /数量/u);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 0, count: 1 }) ?? '', /金额/u);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 10_001, count: 1 }) ?? '', /金额/u);
  assert.match(validateRedemptionBatch({ kind: 'subscription', planId: '', count: 1 }) ?? '', /类型/u);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 5, count: 1, expiresAt: 'yesterday' }) ?? '', /过期时间/u);
  assert.match(validateRedemptionBatch({ kind: 'balance', amountUsd: 5, count: 1, expiresAt: '2020-01-01T00:00:00Z' }) ?? '', /过期时间/u);
});

test('a redemption batch writes one row per code with its amount, plan, expiry and note', async (t) => {
  const { createRedemptionCodes } = require('../lib/billing/redemption.server') as typeof import('../lib/billing/redemption.server');
  const context = require('../lib/db/context.server') as { systemDb: unknown };
  const original = context.systemDb;
  let written: Array<Record<string, unknown>> = [];
  context.systemDb = () => ({
    tx: async (work: (trx: unknown) => unknown) => work({
      insertInto: (table: string) => {
        assert.equal(table, 'redemption_codes');
        return {
          values: (rows: Array<Record<string, unknown>>) => {
            written = rows;
            return { returning: () => ({ execute: async () => rows.map(row => ({ code: row.code })) }) };
          },
        };
      },
    }),
  });
  t.after(() => { context.systemDb = original; });

  const codes = await createRedemptionCodes('admin-1', {
    kind: 'balance', amountUsd: 12.5, count: 3, expiresAt: '2099-01-01T00:00:00.000Z', batchNote: ' 活动 ',
  });
  assert.equal(codes.length, 3);
  assert.equal(new Set(codes).size, 3);
  assert.equal(written.length, 3);
  for (const row of written) {
    assert.match(String(row.code), /^tb-[a-z0-9]{20}$/u);
    assert.equal(row.kind, 'balance');
    assert.equal(row.amount_micros, 12_500_000);
    assert.equal(row.plan_id, null);
    assert.equal(row.expires_at, '2099-01-01T00:00:00.000Z');
    assert.equal(row.batch_note, '活动');
    assert.equal(row.created_by, 'admin-1');
  }

  await createRedemptionCodes('admin-1', { kind: 'subscription', planId: 'plan-1', count: 1 });
  assert.equal(written[0]!.kind, 'subscription');
  assert.equal(written[0]!.amount_micros, null);
  assert.equal(written[0]!.plan_id, 'plan-1');
  assert.equal(written[0]!.expires_at, null);
  assert.equal(written[0]!.batch_note, null);

  context.systemDb = () => ({
    tx: async () => { throw Object.assign(new Error('fk violated'), { code: '23503' }); },
  });
  await assert.rejects(
    createRedemptionCodes('admin-1', { kind: 'subscription', planId: 'missing', count: 1 }),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'PLAN_NOT_FOUND',
  );
});

test('an agent charge keeps its run reference and retries under one idempotency key', async (t) => {
  const { chargeUsage } = require('../lib/billing/account.server') as typeof import('../lib/billing/account.server');
  const context = require('../lib/db/context.server') as { systemDb: unknown };
  const original = context.systemDb;
  const attempts: Array<{ name: string; args: Record<string, unknown> }> = [];
  let failures = 1;
  context.systemDb = () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    attempts.push({ name, args });
    if (failures-- > 0) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    return null;
  } });
  t.after(() => { context.systemDb = original; });

  const micros = await chargeUsage({
    userId: 'user-1', model: { id: 'agent-model', pricing: { input: 2, output: 4, cacheRead: null, cacheWrite: null, image: null } },
    usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, source: 'agent',
    referenceType: 'agent_run', referenceId: 'run-1', idempotencyKey: 'agent:run-1:1',
  });
  assert.equal(micros, 4000);
  assert.deepEqual(attempts.map(attempt => attempt.args.p_idempotency_key), ['agent:run-1:1', 'agent:run-1:1'],
    'a retry replays the same key instead of writing a second entry');
  assert.deepEqual({
    source: attempts[0]!.args.p_source, reference: [attempts[0]!.args.p_reference_type, attempts[0]!.args.p_reference_id],
    debt: attempts[0]!.args.p_allow_debt, amount: attempts[0]!.args.p_amount,
  }, { source: 'agent', reference: ['agent_run', 'run-1'], debt: true, amount: 4000 });
});

test('a signed gateway settlement credits once, ignores other states and rejects tampering', async (t) => {
  const env = { EPAY_API_URL: 'https://pay.example', EPAY_PID: '1001', EPAY_KEY: 'secret' };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const context = require('../lib/db/context.server') as { systemDb: unknown };
  const original = context.systemDb;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let response: unknown = { status: 'paid' };
  context.systemDb = () => ({ rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return response; } });
  t.after(() => {
    context.systemDb = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const params = { pid: '1001', trade_status: 'TRADE_SUCCESS', out_trade_no: 'T-pay-1', trade_no: 'P-1', money: '73.00' };
  const signed = { ...params, sign: epaySign(params, 'secret') };
  assert.equal(await settleEpayPayment(signed), 'paid');
  assert.deepEqual(rpcCalls[0], {
    name: 'payment_order_complete',
    args: {
      p_trade_no: 'T-pay-1', p_provider: 'epay', p_paid_amount: 73, p_provider_trade_no: 'P-1', p_payload: signed,
    },
  });

  response = { status: 'already_paid' };
  assert.equal(await settleEpayPayment(signed), 'already-paid');

  rpcCalls.length = 0;
  assert.equal(await settleEpayPayment({ ...signed, money: '0.01' }), 'rejected', 'a tampered amount fails the signature');
  assert.deepEqual(rpcCalls, []);

  assert.equal(await settleEpayPayment({ ...params, trade_status: 'TRADE_CLOSED', sign: epaySign({ ...params, trade_status: 'TRADE_CLOSED' }, 'secret') }), 'ignored');
  assert.deepEqual(rpcCalls, []);

  response = null;
  context.systemDb = () => ({ rpc: async () => { throw Object.assign(new Error('PAYMENT_AMOUNT_MISMATCH'), { code: 'P0001' }); } });
  assert.equal(await settleEpayPayment(signed), 'rejected');
});

test('a ledger entry itemises what each priced quantity cost, using the input price for an empty cache price', () => {
  const token = ledgerCostBreakdown({
    input: 1000, output: 500, cacheRead: 200, cacheWrite: 100,
    prices: { input: 2, output: 4, cacheRead: null, cacheWrite: 1 },
  });
  assert.deepEqual(token, [
    { label: '输入', quantity: 1000, unit: 'token', price: 2, micros: 2000 },
    { label: '缓存读', quantity: 200, unit: 'token', price: 2, micros: 400, inputPrice: true },
    { label: '缓存写', quantity: 100, unit: 'token', price: 1, micros: 100, inputPrice: false },
    { label: '输出', quantity: 500, unit: 'token', price: 4, micros: 2000 },
  ]);
  assert.deepEqual(ledgerCostBreakdown({ images: 2, prices: { image: 0.02 } }), [
    { label: '图片', quantity: 2, unit: 'image', price: 0.02, micros: 40_000 },
  ]);
  assert.equal(ledgerCostBreakdown({ input: 1000 }), null, 'an entry kept without prices has no breakdown');
  assert.equal(ledgerCostBreakdown({ images: 2, prices: { input: 1 } }), null);
  assert.equal(ledgerCostBreakdown(null), null);

  assert.equal(formatCostLine({ label: '输入', quantity: 1000, unit: 'token', price: 2, micros: 2000 }), '$2/百万 × 1,000');
  assert.equal(formatCostLine({ label: '图片', quantity: 2, unit: 'image', price: 0.02, micros: 40_000 }), '$0.02/张 × 2');
});

test('ledger details prefer priced lines, then usage, then the description', () => {
  const priced = ledgerDetailParts({
    usage: { input: 1000, prices: { input: 2, output: 4 } },
    subscriptionParts: [{ id: 's1', title: '月卡', micros: -120_000 }],
    walletMicros: -30_000,
    description: 'ignored',
  });
  assert.deepEqual(priced, ['输入 $2/百万 × 1,000', '订阅「月卡」 -$0.12', '余额 -$0.03']);
  assert.deepEqual(ledgerDetailParts({
    usage: { input: 1000, output: 500 },
    subscriptionParts: [],
    walletMicros: 0,
    description: '',
  }), ['输入 1,000', '输出 500']);
  assert.deepEqual(ledgerDetailParts({ usage: null, subscriptionParts: [], walletMicros: 0, description: '兑换码充值' }), ['兑换码充值']);
  assert.deepEqual(ledgerDetailParts({ usage: null, subscriptionParts: [], walletMicros: 0, description: '' }), []);

  assert.equal(ledgerModelName({ modelKey: 'deepseek-chat', modelLabel: { name: 'DeepSeek Chat', vendor: 'deepseek', icon: 'DeepSeek' } }), 'DeepSeek Chat');
  assert.equal(ledgerModelName({ modelKey: 'deleted-model', modelLabel: null }), 'deleted-model');
  assert.equal(ledgerModelName({ modelKey: 'deleted-model' }), 'deleted-model');
  assert.equal(formatBillingSecond(null), '—');
  assert.match(formatBillingSecond('2026-03-04T05:06:07Z'), /\d{2}:\d{2}:\d{2}/u);
});

test('charges keep the prices they used, and image charges keep theirs', async (t) => {
  const { chargeUsage, prepayImages, recordDirectUsage, recordFreeImages } = require('../lib/billing/account.server') as typeof import('../lib/billing/account.server');
  const context = require('../lib/db/context.server') as { systemDb: unknown };
  const original = context.systemDb;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  context.systemDb = () => ({ rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return null; } });
  t.after(() => { context.systemDb = original; });

  const pricing = { input: 2, output: 4, cacheRead: null, cacheWrite: 1, image: null };
  const charged = await chargeUsage({
    userId: 'user-1', model: { id: 'fixture', pricing },
    usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, source: 'chat',
  });
  assert.equal(charged, 4000);
  assert.deepEqual(rpcCalls[0], {
    name: 'billing_charge',
    args: {
      p_user_id: 'user-1', p_amount: 4000, p_allow_debt: true, p_source: 'chat', p_model_key: 'fixture',
      p_usage: {
        input: 1000, output: 500, cacheRead: 0, cacheWrite: 0,
        prices: { input: 2, output: 4, cacheRead: null, cacheWrite: 1 },
      },
      p_reference_type: null, p_reference_id: null,
      p_idempotency_key: rpcCalls[0]!.args.p_idempotency_key, p_description: '',
    },
  });
  assert.match(String(rpcCalls[0]!.args.p_idempotency_key), /^chat:/u);

  await chargeUsage({
    userId: 'user-1', model: { id: 'fixture', pricing },
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: true, source: 'analysis',
  });
  assert.equal((rpcCalls[1]!.args.p_usage as Record<string, unknown>).estimated, true);

  const prepayment = await prepayImages({ userId: 'user-1', model: { id: 'image', pricing: { ...pricing, image: 0.02 } }, images: 2 });
  assert.deepEqual(prepayment && { micros: prepayment.micros, images: prepayment.images }, { micros: 40_000, images: 2 });
  assert.deepEqual(rpcCalls[2], {
    name: 'billing_charge',
    args: {
      p_user_id: 'user-1', p_amount: 40_000, p_allow_debt: false, p_source: 'image', p_model_key: 'image',
      p_usage: { images: 2, prices: { image: 0.02 } },
      p_reference_type: null, p_reference_id: null,
      p_idempotency_key: rpcCalls[2]!.args.p_idempotency_key, p_description: '生成 2 张图片',
    },
  });

  await recordFreeImages({ userId: 'user-1', model: { id: 'image' }, images: 2 });
  assert.deepEqual(rpcCalls[3]!.args.p_usage, { images: 2, prices: { image: 0 } });
  assert.equal(rpcCalls[3]!.args.p_amount, 0);

  // A call with the member's own key still lands in the usage log, at $0.
  await recordDirectUsage({
    userId: 'user-1', model: 'own-model',
    usage: { input: 120, output: 30, cacheRead: 10, cacheWrite: 0, reasoning: 5 },
    referenceType: 'conversation', referenceId: 'conversation-1',
  });
  const byok = rpcCalls[4]!;
  assert.equal(byok.name, 'billing_charge');
  assert.deepEqual({
    amount: byok.args.p_amount, debt: byok.args.p_allow_debt, source: byok.args.p_source,
    usage: byok.args.p_usage, reference: [byok.args.p_reference_type, byok.args.p_reference_id], description: byok.args.p_description,
  }, {
    amount: 0, debt: true, source: 'chat',
    usage: { input: 120, output: 30, cacheRead: 10, cacheWrite: 0, reasoning: 5, byok: true },
    reference: ['conversation', 'conversation-1'], description: '自带密钥调用',
  });
  assert.match(String(byok.args.p_idempotency_key), /^byok:/u);

  rpcCalls.length = 0;
  await recordDirectUsage({ userId: 'user-1', model: 'own-model', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual(rpcCalls, [], 'a provider that reported nothing writes nothing');

  // Reporting is best effort: it never breaks the call it describes.
  const originalConsoleError = console.error;
  console.error = () => {};
  context.systemDb = () => ({ rpc: async () => { throw new Error('usage log down'); } });
  t.after(() => { console.error = originalConsoleError; });
  await recordDirectUsage({ userId: 'user-1', model: 'own-model', usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } });
});
