import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockAuthContext } from './helpers/auth-mock';

const USER = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const SUMMARY = { walletMicros: 1_000_000, subscriptionMicros: 2_000_000, spendableMicros: 3_000_000, subscriptions: [] };

type Mutable = Record<string, (...args: never[]) => unknown>;

function setup(t: TestContext) {
  const apiUtils = require('../lib/api-utils') as unknown as Mutable;
  const appSettings = require('../lib/app-settings') as unknown as Mutable;
  const rateLimit = require('../lib/rate-limit') as unknown as Mutable;
  const account = require('../lib/billing/account.server') as unknown as Mutable;
  const plans = require('../lib/billing/plans.server') as unknown as Mutable;
  const redemption = require('../lib/billing/redemption.server') as unknown as Mutable;
  const epay = require('../lib/billing/epay.server') as unknown as Mutable;
  const ledger = require('../lib/billing/ledger.server') as unknown as Mutable;
  const settings = require('../lib/billing/settings.server') as unknown as Mutable;

  const feature = { status: 'enabled' as 'enabled' | 'disabled' | 'unavailable' };
  const calls: Record<string, unknown[]> = {};
  const record = (key: string, value: unknown) => { (calls[key] ??= []).push(value); };

  const originals = {
    readFeatureModuleStateFresh: appSettings.readFeatureModuleStateFresh,
    requireUserContext: apiUtils.requireUserContext,
    requireAdminUser: apiUtils.requireAdminUser,
    checkRateLimit: rateLimit.checkRateLimit,
    getBillingSummary: account.getBillingSummary,
    buyPlanWithBalance: plans.buyPlanWithBalance,
    redeemCode: redemption.redeemCode,
    createRedemptionCodes: redemption.createRedemptionCodes,
    createEpayCheckout: epay.createEpayCheckout,
    settleEpayPayment: epay.settleEpayPayment,
    listUsage: ledger.listUsage,
    setBillingSettings: settings.setBillingSettings,
  };

  appSettings.readFeatureModuleStateFresh = async () => ({ status: feature.status });
  apiUtils.requireUserContext = async () => createMockAuthContext('user-1');
  apiUtils.requireAdminUser = async () => ({ user: { id: 'admin-1' } });
  rateLimit.checkRateLimit = async () => ({ allowed: true, remaining: 9, resetAt: new Date() });
  account.getBillingSummary = async () => SUMMARY;
  plans.buyPlanWithBalance = async () => undefined;
  redemption.redeemCode = async (_userId: unknown, code: unknown) => {
    record('redeem', code);
    return { kind: 'balance', amountMicros: 2_000_000, planTitle: null };
  };
  redemption.createRedemptionCodes = async (adminId: unknown, input: unknown) => {
    record('codes', { adminId, input });
    return ['tb-aaaaaaaaaaaaaaaaaaaa'];
  };
  epay.createEpayCheckout = async (userId: unknown, input: unknown) => {
    record('checkout', { userId, input });
    return { url: 'https://pay.example/submit.php', params: { pid: '1' } };
  };
  epay.settleEpayPayment = async (params: unknown) => {
    record('settle', params);
    return params && (params as Record<string, string>).out_trade_no === 'UNKNOWN' ? 'rejected' : 'paid';
  };
  ledger.listUsage = async (filters: unknown, page: unknown) => {
    record('usage', { filters, page });
    return { entries: [], nextOffset: null, totals: {}, byModel: [] };
  };
  settings.setBillingSettings = async (value: unknown) => { record('settings', value); };

  t.after(() => {
    appSettings.readFeatureModuleStateFresh = originals.readFeatureModuleStateFresh;
    apiUtils.requireUserContext = originals.requireUserContext;
    apiUtils.requireAdminUser = originals.requireAdminUser;
    rateLimit.checkRateLimit = originals.checkRateLimit;
    account.getBillingSummary = originals.getBillingSummary;
    plans.buyPlanWithBalance = originals.buyPlanWithBalance;
    redemption.redeemCode = originals.redeemCode;
    redemption.createRedemptionCodes = originals.createRedemptionCodes;
    epay.createEpayCheckout = originals.createEpayCheckout;
    epay.settleEpayPayment = originals.settleEpayPayment;
    ledger.listUsage = originals.listUsage;
    settings.setBillingSettings = originals.setBillingSettings;
  });

  return {
    api: require('../lib/billing/api.server') as Record<string, (...args: unknown[]) => Promise<Response>>,
    feature, calls, originals,
    modules: { apiUtils, plans, redemption, epay, rateLimit },
    reset: () => { for (const key of Object.keys(calls)) delete calls[key]; },
  };
}

const post = (url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('member billing endpoints fail closed before authentication when the feature is off or unknown', async (t) => {
  const state = setup(t);
  for (const [status, httpStatus, code] of [['unavailable', 503, 'FEATURE_STATE_UNAVAILABLE'], ['disabled', 403, 'FEATURE_DISABLED']] as const) {
    state.feature.status = status;
    const response = await state.api.readBillingOverview(post('/api/billing'));
    assert.equal(response.status, httpStatus);
    assert.equal((await response.json()).code, code);
  }
});

test('redeeming validates the code, rate-limits, and maps domain failures', async (t) => {
  const state = setup(t);
  const { redemption } = state.modules;
  assert.equal((await state.api.redeemBillingCode(post('/api/billing/redeem', {}))).status, 400);

  const limited = state.modules.rateLimit.checkRateLimit as unknown as (...args: unknown[]) => Promise<unknown>;
  state.modules.rateLimit.checkRateLimit = async () => ({ allowed: false, remaining: 0, resetAt: new Date() });
  t.after(() => { state.modules.rateLimit.checkRateLimit = limited; });
  assert.equal((await state.api.redeemBillingCode(post('/api/billing/redeem', { code: 'tb-x' }))).status, 429);
  state.modules.rateLimit.checkRateLimit = limited;

  redemption.redeemCode = async () => {
    const { RedemptionError } = require('../lib/billing/redemption.server') as typeof import('../lib/billing/redemption.server');
    throw new RedemptionError('兑换码已被使用', 409, 'CODE_USED');
  };
  const used = await state.api.redeemBillingCode(post('/api/billing/redeem', { code: 'TB-CODE' }));
  assert.equal(used.status, 409);
  assert.equal((await used.json()).code, 'CODE_USED');

  redemption.redeemCode = async (_userId: unknown, code: unknown) => {
    state.calls.redeem = [code];
    return { kind: 'subscription', amountMicros: 0, planTitle: '月卡' };
  };
  const ok = await state.api.redeemBillingCode(post('/api/billing/redeem', { code: '  TB-CODE  ' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    result: { kind: 'subscription', amountMicros: 0, planTitle: '月卡' }, summary: SUMMARY,
  });
  assert.deepEqual(state.calls.redeem, ['TB-CODE']);
});

test('buying a plan requires a valid plan id and reports plan failures', async (t) => {
  const state = setup(t);
  const { plans } = state.modules;
  assert.equal((await state.api.buyBillingPlan(post('/api/billing/plans/nope/buy'), 'nope')).status, 404);

  plans.buyPlanWithBalance = async () => {
    const { BillingPlanError } = require('../lib/billing/plans.server') as typeof import('../lib/billing/plans.server');
    throw new BillingPlanError('已达到该套餐的限购次数', 409, 'PLAN_LIMIT');
  };
  const limited = await state.api.buyBillingPlan(post(`/api/billing/plans/${PLAN}/buy`), PLAN);
  assert.equal(limited.status, 409);
  assert.equal((await limited.json()).code, 'PLAN_LIMIT');

  plans.buyPlanWithBalance = async () => { state.calls.buy = [PLAN]; };
  const ok = await state.api.buyBillingPlan(post(`/api/billing/plans/${PLAN}/buy`), PLAN);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { summary: SUMMARY });
  assert.deepEqual(state.calls.buy, [PLAN]);
});

test('checkout validates its input, forwards the selected method and maps gateway failures', async (t) => {
  const state = setup(t);
  const { epay } = state.modules;
  assert.equal((await state.api.startEpayCheckout(post('/api/billing/epay/checkout', { kind: 'other' }))).status, 400);
  assert.equal((await state.api.startEpayCheckout(post('/api/billing/epay/checkout', { kind: 'topup', amountUsd: 5 }))).status, 200);

  epay.createEpayCheckout = async () => {
    const { EpayError } = require('../lib/billing/epay.server') as typeof import('../lib/billing/epay.server');
    throw new EpayError('在线支付未开启', 503, 'PAYMENT_DISABLED');
  };
  const disabled = await state.api.startEpayCheckout(post('/api/billing/epay/checkout', { kind: 'topup', amountUsd: 5, method: 'alipay' }));
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, 'PAYMENT_DISABLED');

  epay.createEpayCheckout = async (userId: unknown, input: unknown) => {
    state.calls.checkout = [{ userId, input }];
    return { url: 'https://pay.example/submit.php', params: { pid: '1', sign: 'x', sign_type: 'MD5' } };
  };
  const ok = await state.api.startEpayCheckout(post('/api/billing/epay/checkout', { kind: 'subscription', planId: PLAN, method: 'wxpay' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { url: 'https://pay.example/submit.php', params: { pid: '1', sign: 'x', sign_type: 'MD5' } });
  assert.deepEqual(state.calls.checkout, [{ userId: 'user-1', input: { kind: 'subscription', planId: PLAN, method: 'wxpay' } }]);
});

test('the gateway notify acknowledges signed settlements only and rejects oversized bodies', async (t) => {
  const state = setup(t);
  const signed = new NextRequest('http://localhost/api/billing/epay/notify?out_trade_no=T1&money=73.00&sign=x');
  const paid = await state.api.handleEpayNotify(signed);
  assert.equal(await paid.text(), 'success');

  const rejected = await state.api.handleEpayNotify(new NextRequest('http://localhost/api/billing/epay/notify?out_trade_no=UNKNOWN'));
  assert.equal(await rejected.text(), 'fail');
  assert.equal((await state.api.handleEpayNotify(new NextRequest('http://localhost/api/billing/epay/notify'))).status, 200);
  assert.equal(await (await state.api.handleEpayNotify(new NextRequest('http://localhost/api/billing/epay/notify'))).text(), 'fail');

  const oversized = await state.api.handleEpayNotify(new NextRequest('http://localhost/api/billing/epay/notify', {
    method: 'POST', body: `out_trade_no=T1&${'a='.repeat(9000)}`,
  }));
  assert.equal(await oversized.text(), 'fail');
});

test('returning from the gateway sends the browser back with the settled result', async (t) => {
  const state = setup(t);
  const original = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://taibu.test';
  t.after(() => {
    if (original === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = original;
  });

  const paid = await state.api.handleEpayReturn(new NextRequest('http://localhost/api/billing/epay/return?out_trade_no=T1'));
  assert.equal(paid.status, 303);
  assert.equal(paid.headers.get('location'), 'https://taibu.test/settings/billing?payment=success');

  state.modules.epay.settleEpayPayment = async () => 'already-paid';
  assert.equal((await state.api.handleEpayReturn(new NextRequest('http://localhost/api/billing/epay/return?out_trade_no=T1'))).headers.get('location'), 'https://taibu.test/settings/billing?payment=success');

  state.modules.epay.settleEpayPayment = async () => 'ignored';
  assert.equal((await state.api.handleEpayReturn(new NextRequest('http://localhost/api/billing/epay/return?out_trade_no=T1'))).headers.get('location'), 'https://taibu.test/settings/billing?payment=pending');

  state.modules.epay.settleEpayPayment = async () => 'rejected';
  assert.equal((await state.api.handleEpayReturn(new NextRequest('http://localhost/api/billing/epay/return?out_trade_no=T1'))).headers.get('location'), 'https://taibu.test/settings/billing?payment=fail');
});

test('an administrator usage request forwards filters and rejects unknown ones', async (t) => {
  const state = setup(t);
  const { apiUtils } = state.modules;
  apiUtils.requireAdminUser = async () => ({ error: { message: '无权限', status: 403 } });
  assert.equal((await state.api.adminReadUsage(new NextRequest('http://localhost/api/admin/billing/usage'))).status, 403);
  apiUtils.requireAdminUser = async () => ({ user: { id: 'admin-1' } });

  assert.equal((await state.api.adminReadUsage(new NextRequest('http://localhost/api/admin/billing/usage?kind=refunded'))).status, 400);
  assert.equal((await state.api.adminReadUsage(new NextRequest(`http://localhost/api/admin/billing/usage?email=${'a'.repeat(255)}`))).status, 400);

  const ok = await state.api.adminReadUsage(new NextRequest(`http://localhost/api/admin/billing/usage?kind=usage&source=chat&model=gpt&email=user%40example.test&offset=20&limit=10`));
  assert.equal(ok.status, 200);
  assert.deepEqual(state.calls.usage, [{
    filters: {
      kind: 'usage', source: 'chat', model: 'gpt', email: 'user@example.test',
    },
    page: { offset: 20, limit: 10 },
  }]);
});

test('administrator settings and redemption batches validate before writing', async (t) => {
  const state = setup(t);
  const invalidSettings = await state.api.adminSaveSettings(post('/api/admin/billing/settings', { settings: { topupOptionsUsd: [0] } }));
  assert.equal(invalidSettings.status, 400);

  const saved = await state.api.adminSaveSettings(post('/api/admin/billing/settings', {
    settings: { topupOptionsUsd: [5, 10], minTopupUsd: 2, cnyPerUsd: 7.2 },
  }));
  assert.equal(saved.status, 200);
  assert.deepEqual(state.calls.settings, [{ topupOptionsUsd: [5, 10], minTopupUsd: 2, cnyPerUsd: 7.2 }]);

  assert.equal((await state.api.adminCreateCodes(post('/api/admin/billing/codes', { kind: 'other', count: 1 }))).status, 400);
  assert.equal((await state.api.adminCreateCodes(post('/api/admin/billing/codes', { kind: 'balance', amountUsd: 5, count: 1, expiresAt: 'not-a-date' }))).status, 400);
  assert.equal((await state.api.adminCreateCodes(post('/api/admin/billing/codes', { kind: 'subscription', planId: 'nope', count: 1 }))).status, 400);

  const created = await state.api.adminCreateCodes(post('/api/admin/billing/codes', {
    kind: 'subscription', planId: PLAN, count: 3, batchNote: '活动', expiresAt: '2099-01-01T00:00:00Z',
  }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { codes: ['tb-aaaaaaaaaaaaaaaaaaaa'] });
  const recorded = state.calls.codes.at(-1) as { adminId: string; input: Record<string, unknown> };
  assert.equal(recorded.adminId, 'admin-1');
  assert.equal(recorded.input.kind, 'subscription');
  assert.equal(recorded.input.planId, PLAN);
  assert.equal(recorded.input.count, 3);
  assert.equal(recorded.input.batchNote, '活动');
  assert.equal(recorded.input.expiresAt, '2099-01-01T00:00:00.000Z');
});

test('adjusting a user rejects an empty or out-of-range amount and forwards the chosen one', async (t) => {
  const state = setup(t);
  assert.equal((await state.api.adminChangeUser(post(`/api/admin/billing/users/${USER}`, { action: 'adjust', amountUsd: 0 }), USER)).status, 400);
  assert.equal((await state.api.adminChangeUser(post(`/api/admin/billing/users/${USER}`, { action: 'adjust', amountUsd: 100_001 }), USER)).status, 400);
  assert.equal((await state.api.adminChangeUser(post(`/api/admin/billing/users/${USER}`, { action: 'other' }), USER)).status, 400);

  const systemDb = require('../lib/db/context.server') as unknown as { systemDb: unknown };
  const original = systemDb.systemDb;
  const rpcCalls: unknown[] = [];
  systemDb.systemDb = () => ({
    rpc: async (name: string, args: unknown) => { rpcCalls.push({ name, args }); return null; },
    tx: async () => [],
  });
  t.after(() => { systemDb.systemDb = original; });
  const adjusted = await state.api.adminChangeUser(post(`/api/admin/billing/users/${USER}`, { action: 'adjust', amountUsd: -2.5, description: ' 补扣 ' }), USER);
  assert.equal(adjusted.status, 200);
  assert.deepEqual(rpcCalls, [{ name: 'billing_adjust_wallet', args: { p_user_id: USER, p_amount: -2_500_000, p_description: '补扣' } }]);
});
