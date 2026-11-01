import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const literal = value => (value === null ? 'NULL' : typeof value === 'number' || typeof value === 'boolean' ? String(value) : quote(value));

/** Wallets, allowances, codes and orders, inside the disposable PostgreSQL fixture. */
export async function billingDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const member = async () => {
    const id = randomUUID();
    await sql(`INSERT INTO identity.users(id) VALUES(${quote(id)});`);
    return id;
  };
  const admin = statement => asActor(adminId, statement);
  const parsed = async (statement, actor = adminId) => {
    const value = await asActor(actor, statement);
    return value ? JSON.parse(value) : null;
  };
  /** A plan with its allowance windows; `allowance_micros`/`reset_period` describe one window for short fixtures. */
  const plan = async (values = {}) => {
    const { allowance_micros = 1_000_000, reset_period = 'never', limits, ...fields } = values;
    const row = { title: '测试套餐', duration_unit: 'month', duration_value: 1, ...fields };
    const id = await admin(`INSERT INTO public.subscription_plans(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(literal).join(',')}) RETURNING id;`);
    const windows = limits ?? [{ period: reset_period === 'never' ? 'total' : reset_period, allowance_micros }];
    await admin(`INSERT INTO public.subscription_plan_limits(plan_id,period,allowance_micros) VALUES ${windows
      .map(item => `(${quote(id)},${quote(item.period)},${literal(item.allowance_micros)})`).join(',')};`);
    return id;
  };
  const grant = (user, planId) => parsed(`SELECT public.billing_grant_subscription(${quote(user)},${quote(planId)});`);
  const credit = (user, micros) => parsed(`SELECT public.billing_adjust_wallet(${quote(user)},${micros},'测试加款');`);
  const charge = (user, micros, { debt = true, key = null, actor = adminId } = {}) => parsed(
    `SELECT public.billing_charge(${quote(user)},${micros},${debt},'chat','fixture-model','{"input":1000}'::jsonb,'fixture',NULL,${literal(key)},'测试用量');`, actor);
  const refund = (chargeKey, micros, key) => parsed(`SELECT public.billing_refund(${quote(chargeKey)},${micros},${quote(key)},'测试退款');`);
  const wallet = user => asOwner(`SELECT coalesce((SELECT balance_micros FROM public.billing_accounts WHERE user_id=${quote(user)}),0);`).then(Number);
  const spendable = user => admin(`SELECT public.billing_spendable(${quote(user)});`).then(Number);
  const used = (id, period = 'total') => asOwner(`SELECT used_micros FROM public.user_subscription_limits WHERE subscription_id=${quote(id)} AND period=${quote(period)};`).then(Number);
  /** One window of a sold subscription, as the member's summary sees it. */
  const window_ = async (id, period = 'total') => {
    const value = await asOwner(`SELECT jsonb_build_object('allowance',allowance_micros,'used',used_micros,'next',next_reset_at) FROM public.user_subscription_limits WHERE subscription_id=${quote(id)} AND period=${quote(period)};`);
    return value ? JSON.parse(value) : null;
  };
  const ledgerCount = user => asOwner(`SELECT count(*) FROM public.billing_ledger WHERE user_id=${quote(user)};`).then(Number);

  await t.test('members read only their own money and change it only through definer functions', async () => {
    const owner = await member(), other = await member();
    await credit(owner, 2_000_000);
    assert.equal(await asActor(owner, 'SELECT count(*) FROM public.billing_accounts;'), '1');
    assert.equal(await asActor(owner, 'SELECT count(*) FROM public.billing_ledger;'), '1');
    assert.equal(await asActor(other, `SELECT count(*) FROM public.billing_ledger WHERE user_id=${quote(owner)};`), '0');
    assert.equal(await asActor(owner, `SELECT public.billing_spendable(${quote(owner)});`), '2000000');
    assert.equal((await parsed(`SELECT public.billing_summary(${quote(owner)});`, owner)).walletMicros, 2_000_000);
    for (const statement of [
      `SELECT public.billing_spendable(${quote(owner)});`,
      `SELECT public.billing_summary(${quote(owner)});`,
      `SELECT public.billing_redeem(${quote(owner)},'ANY-CODE');`,
    ]) await assert.rejects(asActor(other, statement), /42501/, statement);
    for (const actor of [owner, adminId]) {
      // Not even an administrator writes the money tables directly.
      await assert.rejects(asActor(actor, `UPDATE public.billing_accounts SET balance_micros=999999999 WHERE user_id=${quote(owner)};`), /42501/);
      await assert.rejects(asActor(actor, `INSERT INTO public.billing_ledger(user_id,kind,amount_micros,wallet_after_micros) VALUES(${quote(owner)},'adjust',1,1);`), /42501/);
    }
    // Allowance windows carry money too: a direct write is filtered to no rows, an insert is refused.
    const guarded = await grant(owner, await plan({ title: '只读额度', allowance_micros: 1_000_000 }));
    await charge(owner, 400_000);
    for (const actor of [owner, adminId]) {
      await asActor(actor, 'UPDATE public.user_subscription_limits SET used_micros=0;');
      await assert.rejects(asActor(actor, `INSERT INTO public.user_subscription_limits(subscription_id,period,allowance_micros) VALUES(${quote(guarded.id)},'daily',1);`), /42501/);
    }
    assert.equal(await used(guarded.id), 400_000, 'neither a member nor an administrator rewrites an allowance directly');
    for (const statement of [
      `SELECT public.billing_charge(${quote(owner)},1,true,'chat');`,
      `SELECT public.billing_refund('missing',1,'missing-refund');`,
      `SELECT public.billing_adjust_wallet(${quote(owner)},1000000,'自助加款');`,
      `SELECT public.billing_grant_subscription(${quote(owner)},${quote(randomUUID())});`,
      `SELECT public.billing_cancel_subscription(${quote(randomUUID())});`,
      'SELECT public.billing_expire_due(10);',
      `SELECT public.payment_order_create(${quote(owner)},'T-forged','topup',NULL,1000000,7.2,'CNY','alipay');`,
      "SELECT public.payment_order_complete('T-forged','epay',7.2,'P-forged','{}'::jsonb);",
    ]) await assert.rejects(asActor(owner, statement), /42501/, statement);
    await assert.rejects(asActor(null, `SELECT public.billing_spendable(${quote(owner)});`, 'anon'), /42501/);
    for (const helper of [
      'public.billing_lock_account(uuid)', 'public.billing_apply_limit_reset(public.user_subscription_limits)',
      'public.billing_open_subscription(uuid,public.subscription_plans,text,uuid,text)',
      'public.billing_next_reset(timestamp with time zone,timestamp with time zone,text,timestamp with time zone)',
    ]) assert.equal(await sql(`SELECT has_function_privilege('authenticated',${quote(helper)},'EXECUTE');`), 'f', helper);
    assert.equal(await wallet(owner), 2_000_000);
  });

  await t.test('usage spends allowances soonest-ending first, then the wallet, and records every share', async () => {
    const user = await member();
    const monthly = await plan({ title: '月度', allowance_micros: 1_000_000 });
    const yearly = await plan({ title: '年度', duration_unit: 'year', allowance_micros: 2_000_000 });
    const later = await grant(user, yearly), sooner = await grant(user, monthly);
    await credit(user, 5_000_000);
    assert.equal(await spendable(user), 8_000_000);
    const first = await charge(user, 2_500_000, { debt: false });
    assert.equal(first.amount_micros, -2_500_000);
    assert.equal(first.wallet_micros, 0);
    assert.deepEqual(first.subscription_parts.map(part => [part.id, part.micros]), [[sooner.id, -1_000_000], [later.id, -1_500_000]]);
    assert.equal(first.wallet_after_micros, 5_000_000);
    const second = await charge(user, 1_000_000, { debt: false });
    assert.deepEqual(second.subscription_parts.map(part => [part.id, part.micros]), [[later.id, -500_000]]);
    assert.equal(second.wallet_micros, -500_000);
    assert.deepEqual([await used(sooner.id), await used(later.id), await wallet(user)], [1_000_000, 2_000_000, 4_500_000]);
    const summary = await parsed(`SELECT public.billing_summary(${quote(user)});`, user);
    assert.deepEqual([summary.walletMicros, summary.subscriptionMicros, summary.spendableMicros], [4_500_000, 0, 4_500_000]);
    assert.deepEqual(summary.subscriptions.map(item => item.title), ['月度', '年度']);
    const zero = await charge(user, 0);
    assert.deepEqual([zero.amount_micros, zero.wallet_after_micros], [0, 4_500_000], 'a free model still leaves its usage on record');
    await assert.rejects(charge(user, -1), /BILLING_AMOUNT_INVALID/);
  });

  await t.test('a subscription\'s windows fill on their own schedules, shortest first', async () => {
    const user = await member();
    const planId = await plan({ title: '多窗口', duration_value: 7, limits: [
      { period: 'daily', allowance_micros: 2_000_000 }, { period: 'five_hour', allowance_micros: 1_000_000 },
    ] });
    const sub = await grant(user, planId);
    await credit(user, 5_000_000);
    const first = await charge(user, 1_500_000, { debt: false });
    assert.deepEqual(first.subscription_parts.map(part => [part.period, part.micros]), [['five_hour', -1_000_000], ['daily', -500_000]],
      'the shorter window is spent before the longer one');
    assert.deepEqual([await used(sub.id, 'five_hour'), await used(sub.id, 'daily')], [1_000_000, 500_000]);
    assert.equal(await spendable(user), 6_500_000, 'spendable counts what each window has left');

    // Only the five-hour window has come due; the daily one keeps its usage until its own boundary.
    await asOwner(`UPDATE public.user_subscription_limits SET next_reset_at=now()-interval '1 second' WHERE subscription_id=${quote(sub.id)} AND period='five_hour';`);
    const summary = await parsed(`SELECT public.billing_summary(${quote(user)});`, user);
    assert.deepEqual(summary.subscriptions[0].limits.map(limit => [limit.period, limit.usedMicros]), [['five_hour', 0], ['daily', 500_000]]);
    assert.ok(summary.subscriptions[0].limits[0].nextResetAt, 'the reset boundary is reported for the window that has one');
    const second = await charge(user, 1_500_000, { debt: false });
    assert.deepEqual(second.subscription_parts.map(part => [part.period, part.micros]), [['five_hour', -1_000_000], ['daily', -500_000]]);
    assert.deepEqual([await used(sub.id, 'five_hour'), await used(sub.id, 'daily')], [1_000_000, 1_000_000]);
    assert.equal(typeof (await window_(sub.id, 'five_hour')).next, 'string', 'the reset wrote the next boundary');
    assert.equal(await window_(sub.id, 'total'), null, 'a plan without a whole-term window has no such row');
  });

  await t.test('the member chooses which purse pays first, and a prepaid charge still sees every purse', async () => {
    const user = await member(), other = await member();
    const sub = await grant(user, await plan({ title: '顺序', allowance_micros: 1_000_000 }));
    await credit(user, 2_000_000);
    assert.equal((await parsed(`SELECT public.billing_summary(${quote(user)});`, user)).deductOrder, 'subscription', 'allowances pay first unless the member says otherwise');
    const allowanceFirst = await charge(user, 500_000, { debt: false });
    assert.deepEqual([allowanceFirst.subscription_parts.length, allowanceFirst.wallet_micros, await wallet(user)], [1, 0, 2_000_000]);

    const setOrder = (actor, order, member = user) => asActor(actor, `SELECT public.billing_set_deduct_order(${quote(member)},${literal(order)});`);
    await assert.rejects(setOrder(user, 'other'), /BILLING_ORDER_INVALID/);
    await assert.rejects(setOrder(user, null), /BILLING_ORDER_INVALID/);
    await assert.rejects(setOrder(other, 'wallet'), /42501/, 'nobody changes another member\'s order');
    await assert.rejects(setOrder(null, 'wallet'), /42501/);
    assert.equal(await setOrder(user, 'wallet'), 'wallet');
    assert.equal((await parsed(`SELECT public.billing_summary(${quote(user)});`, user)).deductOrder, 'wallet');
    assert.equal(await setOrder(adminId, 'wallet', other), 'wallet', 'an administrator may set anyone\'s order');

    // The wallet pays first, but the allowance still stands behind it: together they must cover a prepaid charge.
    await asOwner(`UPDATE public.user_subscription_limits SET used_micros=0 WHERE subscription_id=${quote(sub.id)};`);
    const walletFirst = await charge(user, 1_500_000, { debt: false });
    assert.deepEqual([walletFirst.wallet_micros, walletFirst.subscription_parts.length, await wallet(user)], [-1_500_000, 0, 500_000]);
    assert.equal(await used(sub.id), 0);
    await assert.rejects(charge(user, 1_500_001, { debt: false }), /INSUFFICIENT_BALANCE/, 'the wallet and the allowance together must cover the charge');
    const exact = await charge(user, 1_500_000, { debt: false });
    assert.deepEqual([exact.wallet_micros, exact.subscription_parts.map(part => part.micros), await wallet(user), await used(sub.id)], [-500_000, [-1_000_000], 0, 1_000_000]);
    const debt = await charge(user, 700_000);
    assert.deepEqual([debt.wallet_micros, debt.wallet_after_micros, await used(sub.id)], [-700_000, -700_000, 1_000_000], 'usage that already happened may leave the wallet in debt');
  });

  await t.test('a due reset restores the allowance first; usage may end in debt, a prepaid charge never', async () => {
    const user = await member();
    const daily = await grant(user, await plan({ title: '日额度', reset_period: 'daily', allowance_micros: 1_000_000, duration_value: 2 }));
    assert.ok((await window_(daily.id, 'daily')).next);
    await charge(user, 1_000_000);
    assert.equal(await spendable(user), 0);
    await asOwner(`UPDATE public.user_subscription_limits SET next_reset_at=now()-interval '1 second' WHERE subscription_id=${quote(daily.id)} AND period='daily';`);
    assert.equal(await spendable(user), 1_000_000, 'a due reset counts as a full allowance before anything writes it');
    const summary = await parsed(`SELECT public.billing_summary(${quote(user)});`, user);
    assert.equal(summary.subscriptions[0].limits[0].usedMicros, 0);
    assert.equal(summary.subscriptions[0].limits[0].period, 'daily');
    await charge(user, 600_000);
    assert.equal(await used(daily.id, 'daily'), 600_000);
    assert.equal(await asOwner(`SELECT next_reset_at>now() FROM public.user_subscription_limits WHERE subscription_id=${quote(daily.id)} AND period='daily';`), 't');
    const before = await ledgerCount(user);
    await assert.rejects(charge(user, 1_000_000, { debt: false }), /INSUFFICIENT_BALANCE/);
    assert.deepEqual([await used(daily.id, 'daily'), await wallet(user), await ledgerCount(user)], [600_000, 0, before], 'a refused prepaid charge changes nothing');
    const debt = await charge(user, 1_000_000);
    assert.deepEqual([debt.wallet_micros, debt.wallet_after_micros], [-600_000, -600_000]);
    assert.equal(await spendable(user), -600_000);
    await credit(user, 1_000_000);
    assert.equal(await wallet(user), 400_000, 'a top-up settles the debt first');
  });

  await t.test('an idempotency key records a charge once, and one member\'s charges serialize', async () => {
    const user = await member();
    await credit(user, 1_000_000);
    const replays = await Promise.all(Array.from({ length: 4 }, () => charge(user, 100_000, { key: 'run:fixture:1' })));
    assert.equal(new Set(replays.map(entry => entry.id)).size, 1);
    assert.equal(replays.filter(entry => !entry.replayed).length, 1);
    assert.equal(await wallet(user), 900_000);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => charge(user, 100_000, { debt: false, key: `run:fixture:${index + 2}` })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 9);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /INSUFFICIENT_BALANCE/);
    assert.equal(await wallet(user), 0);
    const other = await member();
    await assert.rejects(charge(other, 1, { key: 'run:fixture:1' }), /23505/, 'a key belongs to the member who used it');
  });

  await t.test('refunds return the wallet share first, then allowances in reverse, never more than was charged', async () => {
    const user = await member();
    const sub = await grant(user, await plan({ title: '退款套餐', allowance_micros: 1_000_000 }));
    await credit(user, 1_000_000);
    await charge(user, 1_500_000, { debt: false, key: 'image:fixture' });
    assert.deepEqual([await used(sub.id), await wallet(user)], [1_000_000, 500_000]);
    const first = await refund('image:fixture', 700_000, 'image:fixture:refund:1');
    assert.deepEqual([first.amount_micros, first.wallet_micros, first.reference_type], [700_000, 500_000, 'billing_ledger']);
    assert.deepEqual(first.subscription_parts.map(part => [part.id, part.micros]), [[sub.id, 200_000]]);
    assert.deepEqual([await used(sub.id), await wallet(user)], [800_000, 1_000_000]);
    assert.equal((await refund('image:fixture', 700_000, 'image:fixture:refund:1')).replayed, true);
    assert.deepEqual([await used(sub.id), await wallet(user)], [800_000, 1_000_000]);
    const second = await refund('image:fixture', 2_000_000, 'image:fixture:refund:2');
    assert.deepEqual([second.amount_micros, second.wallet_micros], [800_000, 0], 'only what is still owed comes back');
    assert.equal(await used(sub.id), 0);
    assert.equal(await refund('image:fixture', 1, 'image:fixture:refund:3'), null);
    await assert.rejects(refund('image:missing', 1, 'image:missing:refund'), /BILLING_CHARGE_NOT_FOUND/);
    await charge(user, 300_000, { debt: false, key: 'image:lapsed' });
    await parsed(`SELECT public.billing_cancel_subscription(${quote(sub.id)},'测试取消');`);
    assert.equal(await refund('image:lapsed', 300_000, 'image:lapsed:refund'), null, 'an ended allowance cannot take its share back');
    assert.equal(await wallet(user), 1_000_000);
  });

  await t.test('buying a plan with the wallet needs the full price and honours the per-member limit', async () => {
    const user = await member(), other = await member();
    const limited = await plan({ title: '限购', price_usd: 3, allowance_micros: 5_000_000, max_per_user: 1 });
    const buy = (actor, planId = limited) => parsed(`SELECT public.billing_buy_plan_with_balance(${quote(user)},${quote(planId)});`, actor);
    await credit(user, 2_000_000);
    await assert.rejects(buy(user), /INSUFFICIENT_BALANCE/);
    await credit(user, 2_000_000);
    await assert.rejects(buy(other), /42501/, 'nobody buys on another member\'s wallet');
    const bought = await buy(user);
    assert.deepEqual([bought.entry.kind, bought.entry.amount_micros, bought.subscription.source], ['subscription', -3_000_000, 'balance']);
    assert.deepEqual(await window_(bought.subscription.id), { allowance: 5_000_000, used: 0, next: null }, 'the plan\'s windows are copied, the whole-term one never resets');
    assert.equal(await wallet(user), 1_000_000);
    await assert.rejects(buy(user), /BILLING_PLAN_LIMIT/);
    await grant(user, limited);
    assert.equal(await asOwner(`SELECT count(*) FROM public.user_subscriptions WHERE user_id=${quote(user)};`), '2', 'an administrator grant ignores the limit');
    await credit(user, 10_000_000);
    await assert.rejects(buy(user, await plan({ title: '停用', price_usd: 1, enabled: false })), /BILLING_PLAN_UNAVAILABLE/);
    await assert.rejects(buy(user, await plan({ title: '不售', price_usd: 1, purchasable: false })), /BILLING_PLAN_UNAVAILABLE/);
    assert.equal(await asActor(user, "SELECT count(*) FROM public.subscription_plans WHERE title IN ('停用','不售','限购');"), '2', 'members see enabled plans only');
    await assert.rejects(asActor(user, "INSERT INTO public.subscription_plans(title) VALUES('自建');"), /42501/);
    await assert.rejects(asActor(user, `INSERT INTO public.subscription_plan_limits(plan_id,period,allowance_micros) VALUES(${quote(limited)},'daily',1);`), /42501/, 'members never write plan windows');
  });

  await t.test('a redemption code is used once, by one member', async () => {
    const first = await member(), second = await member();
    const planId = await plan({ title: '兑换套餐', allowance_micros: 3_000_000 });
    await admin(`INSERT INTO public.redemption_codes(code,kind,amount_micros,created_by) VALUES('TB-BALANCE-ONCE','balance',2000000,${quote(adminId)}),('TB-DISABLED','balance',1,NULL),('TB-EXPIRED','balance',1,NULL);
      INSERT INTO public.redemption_codes(code,kind,plan_id) VALUES('TB-PLAN-ONCE','subscription',${quote(planId)});
      UPDATE public.redemption_codes SET status='disabled' WHERE code='TB-DISABLED';
      UPDATE public.redemption_codes SET expires_at=now()-interval '1 minute' WHERE code='TB-EXPIRED';`);
    const redeem = (user, code) => parsed(`SELECT public.billing_redeem(${quote(user)},${quote(code)});`, user);
    const results = await Promise.allSettled([redeem(first, ' TB-BALANCE-ONCE '), redeem(second, 'TB-BALANCE-ONCE')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /REDEMPTION_CODE_USED/);
    assert.equal(await wallet(first) + await wallet(second), 2_000_000);
    const plan_ = await redeem(first, 'TB-PLAN-ONCE');
    assert.deepEqual([plan_.kind, plan_.subscription.source], ['subscription', 'redeem']);
    assert.deepEqual(await window_(plan_.subscription.id), { allowance: 3_000_000, used: 0, next: null });
    await assert.rejects(redeem(second, 'TB-DISABLED'), /REDEMPTION_CODE_UNAVAILABLE/);
    await assert.rejects(redeem(second, 'TB-EXPIRED'), /REDEMPTION_CODE_UNAVAILABLE/);
    await assert.rejects(redeem(second, 'TB-UNKNOWN'), /REDEMPTION_CODE_NOT_FOUND/);
    assert.equal(await asActor(first, 'SELECT count(*) FROM public.redemption_codes;'), '0', 'members never read codes');
    await assert.rejects(asActor(first, "INSERT INTO public.redemption_codes(code,kind,amount_micros) VALUES('TB-SELF','balance',1);"), /42501/);
    await assert.rejects(asActor(null, "SELECT public.billing_redeem(NULL,'TB-PLAN-ONCE');"), /42501/);
  });

  await t.test('a paid order settles once, for its provider and exact amount, even after it expired', async () => {
    const user = await member();
    const order = (trade, kind, planId, micros, amount) => parsed(
      `SELECT public.payment_order_create(${quote(user)},${quote(trade)},${quote(kind)},${literal(planId)},${literal(micros)},${amount},'CNY','alipay');`);
    const complete = (trade, amount, provider = 'epay') => parsed(
      `SELECT public.payment_order_complete(${quote(trade)},${quote(provider)},${amount},${quote(`P-${trade}`)},${quote(JSON.stringify({ trade_status: 'TRADE_SUCCESS' }))}::jsonb);`);
    const tradeTopup = `T-${randomUUID()}`;
    assert.equal((await order(tradeTopup, 'topup', null, 10_000_000, '72.00')).status, 'pending');
    await assert.rejects(complete(tradeTopup, '71.99'), /PAYMENT_AMOUNT_MISMATCH/);
    await assert.rejects(complete(tradeTopup, '72.00', 'stripe'), /PAYMENT_PROVIDER_MISMATCH/);
    assert.equal(await asOwner(`SELECT status FROM public.payment_orders WHERE trade_no=${quote(tradeTopup)};`), 'pending');
    const settled = await Promise.all([complete(tradeTopup, '72.0'), complete(tradeTopup, '72')]);
    assert.deepEqual(settled.map(result => result.status).sort(), ['already_paid', 'paid']);
    assert.equal(await wallet(user), 10_000_000);
    assert.equal(await asOwner(`SELECT count(*) FROM public.billing_ledger WHERE idempotency_key=${quote(`payment:${tradeTopup}`)};`), '1');
    assert.equal(await asActor(user, `SELECT status||':'||provider_trade_no FROM public.payment_orders WHERE trade_no=${quote(tradeTopup)};`), `paid:P-${tradeTopup}`);

    const planId = await plan({ title: '在线套餐', price_usd: 9.9, allowance_micros: 12_000_000, max_per_user: 1 });
    const tradePlan = `T-${randomUUID()}`;
    await order(tradePlan, 'subscription', planId, null, '71.28');
    await asOwner(`UPDATE public.payment_orders SET created_at=now()-interval '3 hours' WHERE trade_no=${quote(tradePlan)};`);
    assert.ok((await parsed('SELECT public.billing_expire_due(100);')).orders >= 1);
    assert.equal(await asOwner(`SELECT status FROM public.payment_orders WHERE trade_no=${quote(tradePlan)};`), 'expired');
    assert.equal((await complete(tradePlan, '71.28')).status, 'paid', 'the money was taken, so a late callback is honoured');
    assert.equal(await asOwner(`SELECT source||':'||(order_id IS NOT NULL) FROM public.user_subscriptions WHERE user_id=${quote(user)} AND plan_id=${quote(planId)};`), 'epay:true');
    await assert.rejects(order(`T-${randomUUID()}`, 'subscription', planId, null, '71.28'), /BILLING_PLAN_LIMIT/);
    await assert.rejects(complete(`T-${randomUUID()}`, '1.00'), /PAYMENT_ORDER_NOT_FOUND/);
    await assert.rejects(order(`T-${randomUUID()}`, 'topup', null, 0, '1.00'), /23514/);
  });

  await t.test('maintenance marks ended subscriptions, and spending ignores them before it does', async () => {
    const user = await member();
    const sub = await grant(user, await plan({ title: '到期', allowance_micros: 1_000_000 }));
    await asOwner(`UPDATE public.user_subscriptions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 second' WHERE id=${quote(sub.id)};`);
    assert.equal(await spendable(user), 0);
    await assert.rejects(charge(user, 1, { debt: false }), /INSUFFICIENT_BALANCE/);
    assert.ok((await parsed('SELECT public.billing_expire_due(100);')).subscriptions >= 1);
    assert.equal(await asOwner(`SELECT status FROM public.user_subscriptions WHERE id=${quote(sub.id)};`), 'expired');
    await assert.rejects(parsed(`SELECT public.billing_cancel_subscription(${quote(sub.id)});`), /BILLING_SUBSCRIPTION_NOT_ACTIVE/);
  });

  await t.test('administrator adjustments name the administrator and cannot overdraw the wallet', async () => {
    const user = await member();
    const entry = await credit(user, 1_500_000);
    assert.deepEqual([entry.kind, entry.reference_type, entry.reference_id], ['adjust', 'user', adminId]);
    await assert.rejects(parsed(`SELECT public.billing_adjust_wallet(${quote(user)},-2000000,'扣款');`), /INSUFFICIENT_BALANCE/);
    await assert.rejects(parsed(`SELECT public.billing_adjust_wallet(${quote(user)},0,'无效');`), /BILLING_AMOUNT_INVALID/);
    assert.equal((await parsed(`SELECT public.billing_adjust_wallet(${quote(user)},-1500000,'清零');`)).wallet_after_micros, 0);
  });

  await t.test('a failed ledger write rolls back the wallet and allowance together', async () => {
    const user = await member();
    const sub = await grant(user, await plan({ title: '原子', allowance_micros: 1_000_000 }));
    await credit(user, 1_000_000);
    await sql(`ALTER TABLE public.billing_ledger ADD CONSTRAINT fixture_reject_billing CHECK (user_id<>${quote(user)}::uuid OR kind<>'usage') NOT VALID;`);
    try {
      await assert.rejects(charge(user, 1_500_000), /23514/);
      assert.deepEqual([await used(sub.id), await wallet(user)], [0, 1_000_000]);
    } finally {
      await sql('ALTER TABLE public.billing_ledger DROP CONSTRAINT fixture_reject_billing;');
    }
  });

  await t.test('reset boundaries count from the start, strictly after the instant, and stop at the end', async () => {
    const next = (start, end, period, after) => asOwner(`SET LOCAL TimeZone='UTC';
      SELECT to_char(public.billing_next_reset(${quote(start)},${quote(end)},${quote(period)},${quote(after)}),'YYYY-MM-DD HH24:MI');`);
    assert.equal(await next('2026-01-31 00:00+00', '2027-01-31 00:00+00', 'monthly', '2026-02-28 12:00+00'), '2026-03-31 00:00', 'month ends do not drift');
    assert.equal(await next('2026-01-31 00:00+00', '2027-01-31 00:00+00', 'monthly', '2026-01-31 00:00+00'), '2026-02-28 00:00');
    assert.equal(await next('2026-01-01 00:00+00', '2027-01-01 00:00+00', 'weekly', '2026-01-08 00:00+00'), '2026-01-15 00:00');
    assert.equal(await next('2026-01-01 08:00+00', '2026-02-01 08:00+00', 'daily', '2026-01-05 07:59+00'), '2026-01-05 08:00');
    assert.equal(await next('2026-01-01 00:00+00', '2026-01-02 00:00+00', 'daily', '2026-01-01 01:00+00'), '');
    assert.equal(await next('2026-01-01 00:00+00', '2027-01-01 00:00+00', 'total', '2026-01-01 01:00+00'), '');
  });
}
