import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

const DAILY_BRIEFING_PROMPT = [
  '今天是 {{date}}（{{weekday}}），时区 {{timezone}}。',
  '请生成今日早报：先调用 almanac 查询今天的黄历宜忌、冲煞与吉时；再读取八字命盘{{chart}}的当日运势；最后用简洁中文给出今日宜忌、总体提示、工作与生活建议，以及两到三条行动事项。',
  '没有命盘时清楚说明，只给一般建议。结论以工具返回的数据为依据，不猜测、不夸大。',
].join('\n');

export async function agentSchedulesDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)});`);
  await asOwner(`UPDATE public.users SET ai_chat_count=20,membership='plus' WHERE id IN (${quote(owner)},${quote(other)});`);
  const admin = statement => asActor(adminId, statement);
  const parsed = async statement => { const value = await admin(statement); return value ? JSON.parse(value) : null; };
  const utc = async (cadence, timezone, after) => asActor(owner,
    `SELECT to_char((public.agent_next_run_at(${json(cadence)},${quote(timezone)},${quote(after)}) AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS');`);
  const latest = async (cadence, timezone, before) => asActor(owner,
    `SELECT to_char((public.agent_latest_schedule_occurrence(${json(cadence)},${quote(timezone)},${quote(before)}) AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS');`);
  const create = async (name, cadence, extra = {}) => JSON.parse(await asActor(owner,
    `SELECT to_jsonb(public.create_agent_schedule(${quote(name)},${quote(extra.template ?? 'custom')},${quote(extra.prompt ?? '整理今天的重点。')},${json(cadence)},${quote(extra.timezone ?? 'Asia/Shanghai')},${json(extra.options ?? { notify: true })},${extra.limit ?? 5})) s;`));
  const dueNow = id => asOwner(`UPDATE public.agent_schedules SET next_run_at=now()-interval '1 minute' WHERE id=${quote(id)};`);
  const runs = id => asOwner(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at),'[]') FROM public.agent_schedule_runs r WHERE r.schedule_id=${quote(id)};`);

  await t.test('next run times honour time zones, DST, month ends and weekdays', async () => {
    assert.equal(await utc({ kind: 'daily', time: '08:00' }, 'Asia/Shanghai', '2026-10-28T23:30:00Z'), '2026-10-29 00:00:00');
    // 02:30 does not exist on spring-forward day in New York; the first wall time that does is used.
    assert.equal(await utc({ kind: 'daily', time: '02:30' }, 'America/New_York', '2026-03-08T06:00:00Z'), '2026-03-08 07:00:00');
    // Fall-back 01:30 exists twice; either instant is accepted as long as the local time round-trips.
    const fallBack = await asActor(owner, `SELECT to_char((public.agent_next_run_at('{"kind":"daily","time":"01:30"}'::jsonb,'America/New_York','2026-11-01T04:00:00Z') AT TIME ZONE 'America/New_York'),'YYYY-MM-DD HH24:MI');`);
    assert.equal(fallBack, '2026-11-01 01:30');
    assert.equal(await utc({ kind: 'monthly', day: 31, time: '08:00' }, 'Asia/Shanghai', '2026-01-31T01:00:00Z'), '2026-02-28 00:00:00');
    assert.equal(await utc({ kind: 'monthly', day: 31, time: '08:00' }, 'Asia/Shanghai', '2026-02-28T01:00:00Z'), '2026-03-31 00:00:00');
    assert.equal(await utc({ kind: 'weekly', weekdays: [1, 3, 5], time: '09:00' }, 'Asia/Shanghai', '2026-10-30T02:00:00Z'), '2026-11-02 01:00:00');
    assert.equal(await utc({ kind: 'interval', hours: 6, time: '08:00' }, 'Asia/Shanghai', '2026-10-29T01:00:00Z'), '2026-10-29 06:00:00');
    // An hourly chain crosses midnight and keeps stepping until the next day's
    // HH:mm anchor, instead of jumping from 00:00 straight to 08:00.
    assert.equal(await utc({ kind: 'interval', hours: 1, time: '08:00' }, 'Asia/Shanghai', '2026-10-28T16:30:00Z'), '2026-10-28 17:00:00');
    assert.equal(await utc({ kind: 'interval', hours: 5, time: '08:00' }, 'Asia/Shanghai', '2026-10-28T22:00:00Z'), '2026-10-29 00:00:00');
    // The catch-up helper returns the newest occurrence at or before the instant,
    // including an interval chain whose last step fell on the current day.
    assert.equal(await latest({ kind: 'daily', time: '08:00' }, 'Asia/Shanghai', '2026-10-28T23:30:00Z'), '2026-10-28 00:00:00');
    assert.equal(await latest({ kind: 'interval', hours: 1, time: '08:00' }, 'Asia/Shanghai', '2026-10-28T16:30:00Z'), '2026-10-28 16:00:00');
    assert.equal(await latest({ kind: 'interval', hours: 1, time: '08:00' }, 'Asia/Shanghai', '2026-10-29T02:30:00Z'), '2026-10-29 02:00:00');
    assert.equal(await latest({ kind: 'interval', hours: 5, time: '08:00' }, 'Asia/Shanghai', '2026-10-28T23:00:00Z'), '2026-10-28 20:00:00');
    assert.equal(await latest({ kind: 'monthly', day: 31, time: '08:00' }, 'Asia/Shanghai', '2026-03-01T00:00:00Z'), '2026-02-28 00:00:00');
    await assert.rejects(asActor(owner, `SELECT public.agent_next_run_at('{"kind":"daily","time":"25:00"}'::jsonb,'Asia/Shanghai',now());`), /AGENT_SCHEDULE_TIME_INVALID/);
    await assert.rejects(asActor(owner, `SELECT public.agent_next_run_at('{"kind":"daily","time":"08:00"}'::jsonb,'Fake/Zone',now());`), /AGENT_SCHEDULE_TIMEZONE_INVALID/);
  });

  await t.test('creating a schedule binds one conversation and the tier limit holds', async () => {
    const schedule = await create('晨间整理', { kind: 'daily', time: '09:00' }, { limit: 1 });
    assert.ok(schedule.conversation_id);
    assert.equal(schedule.template, 'custom');
    assert.equal(await asActor(owner, `SELECT title FROM public.conversations WHERE id=${quote(schedule.conversation_id)};`), '定时 · 晨间整理');
    await assert.rejects(create('第二个任务', { kind: 'daily', time: '09:00' }, { limit: 1 }), /AGENT_SCHEDULE_LIMIT/);
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('a manual occurrence is created once, only for its owner or an administrator', async () => {
    const schedule = await create('手动运行', { kind: 'daily', time: '08:00' });
    const first = JSON.parse(await asActor(owner, `SELECT to_jsonb(public.create_agent_schedule_run(${quote(schedule.id)},${quote(owner)}));`));
    assert.equal(first.status, 'pending');
    assert.equal(first.user_id, owner);
    await assert.rejects(asActor(owner, `SELECT public.create_agent_schedule_run(${quote(schedule.id)},${quote(owner)});`), /AGENT_SCHEDULE_RUN_BUSY/);
    await assert.rejects(asActor(other, `SELECT public.create_agent_schedule_run(${quote(schedule.id)},${quote(owner)});`), /AGENT_SCHEDULE_NOT_FOUND/);
    await asOwner(`UPDATE public.agent_schedule_runs SET status='skipped' WHERE id=${quote(first.id)};`);
    const byAdmin = JSON.parse(await admin(`SELECT to_jsonb(public.create_agent_schedule_run(${quote(schedule.id)},${quote(owner)}));`));
    assert.equal(byAdmin.user_id, owner);
    await asOwner(`UPDATE public.agent_schedules SET conversation_id=NULL WHERE id=${quote(schedule.id)};`);
    await assert.rejects(asActor(owner, `SELECT public.create_agent_schedule_run(${quote(schedule.id)},${quote(owner)});`), /AGENT_SCHEDULE_CONVERSATION_MISSING/);
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('claim is idempotent, advances the next occurrence and refuses members', async () => {
    const schedule = await create('领取契约', { kind: 'daily', time: '08:00' });
    await dueNow(schedule.id);
    const claims = await Promise.all([
      parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;'),
      parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;'),
    ]);
    const mine = claims.flat().filter(run => run.schedule_id === schedule.id);
    assert.equal(mine.length, 1);
    assert.equal(await asOwner(`SELECT (next_run_at>now()) AND (next_run_at IS NOT NULL) FROM public.agent_schedules WHERE id=${quote(schedule.id)};`), 't');
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_schedule_runs WHERE schedule_id=${quote(schedule.id)};`), '1');
    await assert.rejects(asActor(owner, 'SELECT * FROM public.claim_agent_schedules(1);'), /AGENT_ADMIN_REQUIRED/);
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('a running occurrence skips the next one and an expired one is not caught up', async () => {
    const lateTime = await asOwner("SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '3 hours','HH24:MI');");
    const schedule = await create('跳过契约', { kind: 'daily', time: lateTime });
    await dueNow(schedule.id);
    let claimed = await parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;');
    const first = claimed.find(run => run.schedule_id === schedule.id);
    assert.ok(first);
    await asOwner(`UPDATE public.agent_schedule_runs SET status='running' WHERE id=${quote(first.id)};`);
    await dueNow(schedule.id);
    await admin('SELECT public.claim_agent_schedules(10);');
    const skipped = JSON.parse(await runs(schedule.id));
    assert.equal(skipped.filter(run => run.status === 'skipped' && run.skip_reason === 'previous_running').length, 1);
    await asOwner(`UPDATE public.agent_schedule_runs SET status='completed' WHERE id=${quote(first.id)}; UPDATE public.agent_schedules SET next_run_at=now()-interval '3 days' WHERE id=${quote(schedule.id)};`);
    await admin('SELECT public.claim_agent_schedules(10);');
    const missed = JSON.parse(await runs(schedule.id));
    assert.ok(missed.some(run => run.status === 'skipped' && run.skip_reason === 'missed'));
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('settling a run records completion, notifies once and suppresses the generic task notice', async () => {
    const schedule = await create('通知契约', { kind: 'daily', time: '08:00' });
    await dueNow(schedule.id);
    const [run] = (await parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;')).filter(item => item.schedule_id === schedule.id);
    assert.ok(run);
    const agentRunId = randomUUID();
    const checkpoint = { version: 2, messages: [], parts: [], durable: { engine: 'pi-durable/1.4.0' } };
    const assistant = id => ({ id: `agent:${id}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), agent: { version: 1, runId: id, status: 'queued', parts: [] } });
    await admin(`SELECT public.agent_create_run(${quote(agentRunId)},${quote(owner)},${quote(schedule.conversation_id)},${quote('sched:' + agentRunId)},'hash',
      ${json({ model: 'fixture', reasoning: false, webEnabled: false, systemPrompt: 'fixture', userMessage: { id: 'u1', role: 'user', content: '早上好', createdAt: new Date().toISOString() } })},
      ${json(checkpoint)},${json(assistant(agentRunId))},NULL,false);`);
    await admin("SELECT public.agent_worker_heartbeat('sched-contracts','pi-durable/1.4.0');");
    const agentRun = await parsed("SELECT to_jsonb(public.agent_claim_run('sched-contracts'));");
    await admin(`SELECT public.settle_agent_schedule_run(${quote(run.id)},'running',${quote(agentRunId)},NULL,NULL);`);
    assert.equal(await asOwner(`SELECT status FROM public.agent_schedule_runs WHERE id=${quote(run.id)};`), 'running');
    await admin(`SELECT public.agent_finish_run(${quote(agentRunId)},${quote(agentRun.worker_id)},${agentRun.fence},'completed',${json(checkpoint)},
      ${json({ ...assistant(agentRunId), content: '完成', agent: { version: 1, runId: agentRunId, status: 'completed', parts: [] } })});`);
    assert.equal(await asOwner(`SELECT status FROM public.agent_schedule_runs WHERE id=${quote(run.id)};`), 'completed');
    assert.equal(await asOwner(`SELECT last_status FROM public.agent_schedules WHERE id=${quote(schedule.id)};`), 'completed');
    assert.equal(await asActor(owner, `SELECT count(*) FROM public.notifications WHERE event_key=${quote('schedule:' + run.id)};`), '1');
    assert.equal(await asActor(owner, `SELECT count(*) FROM public.notifications WHERE event_key=${quote('agent:' + agentRunId + ':completed')};`), '0');
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('a scheduled run that asks a question still notifies the member', async () => {
    const schedule = await create('提问通知', { kind: 'daily', time: '08:00' });
    await dueNow(schedule.id);
    const [run] = (await parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;')).filter(item => item.schedule_id === schedule.id);
    assert.ok(run);
    const agentRunId = randomUUID();
    const checkpoint = { version: 2, messages: [], parts: [], durable: { engine: 'pi-durable/1.4.0' } };
    const assistant = id => ({ id: `agent:${id}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), agent: { version: 1, runId: id, status: 'queued', parts: [] } });
    await admin(`SELECT public.agent_create_run(${quote(agentRunId)},${quote(owner)},${quote(schedule.conversation_id)},${quote('ask:' + agentRunId)},'hash',
      ${json({ model: 'fixture', reasoning: false, webEnabled: false, systemPrompt: 'fixture', userMessage: { id: 'u2', role: 'user', content: '早上好', createdAt: new Date().toISOString() } })},
      ${json(checkpoint)},${json(assistant(agentRunId))},NULL,false);`);
    await admin("SELECT public.agent_worker_heartbeat('sched-contracts','pi-durable/1.4.0');");
    const agentRun = await parsed("SELECT to_jsonb(public.agent_claim_run('sched-contracts'));");
    await admin(`SELECT public.settle_agent_schedule_run(${quote(run.id)},'running',${quote(agentRunId)},NULL,NULL);`);
    // The generic task notice is suppressed only for a finished scheduled run; a
    // question still needs the member's attention, because the schedule's own
    // notice cannot fire while it waits for an answer.
    await admin(`SELECT public.agent_finish_run(${quote(agentRunId)},${quote(agentRun.worker_id)},${agentRun.fence},'awaiting_input',${json({ ...checkpoint, questionId: 'schedule-question' })},
      ${json(assistant(agentRunId))});`);
    assert.equal(await asOwner(`SELECT status FROM public.agent_schedule_runs WHERE id=${quote(run.id)};`), 'running');
    assert.equal(await asActor(owner,
      `SELECT count(*) FROM public.notifications WHERE event_key=${quote('agent:' + agentRunId + ':awaiting_input:schedule-question')} AND title LIKE '%补充信息%';`), '1');
    // The occurrence stays running while the question waits; the row and its
    // conversation are left for the disposable container to discard.
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('a skipped run records the reason and notifies the owner', async () => {
    const schedule = await create('跳过通知', { kind: 'daily', time: '08:00' });
    await dueNow(schedule.id);
    const [run] = (await parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;')).filter(item => item.schedule_id === schedule.id);
    await admin(`SELECT public.settle_agent_schedule_run(${quote(run.id)},'skipped',NULL,NULL,'insufficient_credits');`);
    assert.equal(await asOwner(`SELECT status||':'||skip_reason FROM public.agent_schedule_runs WHERE id=${quote(run.id)};`), 'skipped:insufficient_credits');
    assert.equal(await asActor(owner, `SELECT count(*) FROM public.notifications WHERE event_key=${quote('schedule:' + run.id)} AND title LIKE '%已跳过%';`), '1');
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('consecutive failures accumulate across starts and reset on a non-failure', async () => {
    const schedule = await create('失败计数', { kind: 'daily', time: '08:00' });
    const nextRun = async () => {
      await dueNow(schedule.id);
      return (await parsed('SELECT coalesce(jsonb_agg(to_jsonb(r)),\'[]\') FROM public.claim_agent_schedules(10) r;'))
        .find(item => item.schedule_id === schedule.id);
    };
    const fail = async () => {
      const run = await nextRun();
      assert.ok(run);
      await admin(`SELECT public.settle_agent_schedule_run(${quote(run.id)},'failed',NULL,'boom',NULL);`);
      return asOwner(`SELECT consecutive_failures FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
    };
    assert.equal(await fail(), '1');
    assert.equal(await fail(), '2');
    const skipped = await nextRun();
    assert.ok(skipped);
    await admin(`SELECT public.settle_agent_schedule_run(${quote(skipped.id)},'skipped',NULL,NULL,'insufficient_credits');`);
    assert.equal(await asOwner(`SELECT consecutive_failures FROM public.agent_schedules WHERE id=${quote(schedule.id)};`), '0');
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('a downgrade pauses the schedules beyond the tier limit', async () => {
    const first = await create('保留的任务', { kind: 'daily', time: '08:00' });
    const second = await create('超出的任务', { kind: 'daily', time: '09:00' });
    assert.ok(Number(await admin(`SELECT public.enforce_agent_schedule_limits('{"free":1,"plus":1,"pro":2}'::jsonb);`)) >= 1);
    assert.equal(await asOwner(`SELECT enabled FROM public.agent_schedules WHERE id=${quote(first.id)};`), 't');
    assert.equal(await asOwner(`SELECT enabled||':'||last_status FROM public.agent_schedules WHERE id=${quote(second.id)};`), 'false:paused');
    assert.equal(await asOwner(`SELECT next_run_at IS NULL FROM public.agent_schedules WHERE id=${quote(second.id)};`), 't');
    await assert.rejects(asActor(owner, `SELECT public.enforce_agent_schedule_limits('{"free":1}'::jsonb);`), /AGENT_ADMIN_REQUIRED/);
    await asOwner(`DELETE FROM public.agent_schedules WHERE id IN (${quote(first.id)},${quote(second.id)});`);
  });

  await t.test('deleting the bound conversation pauses the schedule with one notice', async () => {
    const schedule = await create('删除对话', { kind: 'daily', time: '08:00' });
    await asActor(owner, `SELECT public.delete_conversation_graph(${quote(schedule.conversation_id)});`);
    assert.equal(await asOwner(`SELECT enabled||':'||last_status||':'||(conversation_id IS NULL) FROM public.agent_schedules WHERE id=${quote(schedule.id)};`), 'false:paused:true');
    assert.equal(await asActor(owner, `SELECT count(*) FROM public.notifications WHERE event_key=${quote('schedule-paused:' + schedule.conversation_id)};`), '1');
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('schedules and runs are visible only to their owner', async () => {
    const schedule = await create('私有任务', { kind: 'daily', time: '08:00' });
    await dueNow(schedule.id);
    await admin('SELECT public.claim_agent_schedules(10);');
    assert.ok(Number(await asActor(owner, 'SELECT count(*) FROM public.agent_schedules;')) >= 1);
    assert.equal(await asActor(other, 'SELECT count(*) FROM public.agent_schedules;'), '0');
    assert.equal(await asActor(other, 'SELECT count(*) FROM public.agent_schedule_runs;'), '0');
    assert.equal(await admin('SELECT count(*) >= 1 FROM public.agent_schedules;'), 't');
    await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
  });

  await t.test('the go-live migration turns each enabled briefing into one schedule', async () => {
    const legacy = randomUUID(), chartId = randomUUID();
    await sql(`INSERT INTO identity.users(id) VALUES(${quote(legacy)});`);
    await asOwner(`UPDATE public.users SET membership='plus',ai_chat_count=6 WHERE id=${quote(legacy)};
      INSERT INTO public.bazi_charts(id,user_id,name,birth_date) VALUES(${quote(chartId)},${quote(legacy)},'早报命盘','1990-01-01');
      ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS daily_briefing_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE public.reminder_subscriptions DROP CONSTRAINT IF EXISTS reminder_subscription_type;
      ALTER TABLE public.reminder_subscriptions ADD CONSTRAINT reminder_subscription_type CHECK (reminder_type = ANY (ARRAY['solar_term','fortune','key_date','daily_briefing']));
      INSERT INTO public.user_settings(user_id,daily_briefing_settings,default_bazi_chart_id) VALUES(${quote(legacy)},'{"timezone":"America/New_York","time":"07:15"}',${quote(chartId)});
      INSERT INTO public.reminder_subscriptions(user_id,reminder_type,enabled) VALUES(${quote(legacy)},'daily_briefing',true);`);
    const prompt = DAILY_BRIEFING_PROMPT.replace('{{chart}}', '（用户默认命盘；没有命盘时说明）');
    await asOwner(`WITH candidates AS (
        SELECT s.user_id,
          coalesce(nullif(btrim(u.daily_briefing_settings->>'timezone'),''),'Asia/Shanghai') AS zone,
          CASE WHEN u.daily_briefing_settings->>'time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN (u.daily_briefing_settings->>'time')::time ELSE time '08:00' END AS delivery_time,
          u.default_bazi_chart_id AS chart_id
        FROM public.reminder_subscriptions s
        LEFT JOIN public.user_settings u ON u.user_id=s.user_id
        WHERE s.reminder_type='daily_briefing' AND s.enabled
      ), created AS (
        INSERT INTO public.conversations(user_id,title,personality,messages)
        SELECT c.user_id,'定时 · 每日早报','general','[]'::jsonb FROM candidates c
        RETURNING id,user_id
      )
      INSERT INTO public.agent_schedules(user_id,name,template,prompt,cadence,timezone,conversation_id,options,enabled,next_run_at)
      SELECT c.user_id,'每日早报','daily_briefing',${quote(prompt)},
        jsonb_build_object('kind','daily','time',to_char(c.delivery_time,'HH24:MI')),
        c.zone,cc.id,jsonb_build_object('notify',true,'webEnabled',false,'baziChartId',c.chart_id),true,
        public.agent_next_run_at(jsonb_build_object('kind','daily','time',to_char(c.delivery_time,'HH24:MI')),c.zone,now())
      FROM candidates c JOIN created cc ON cc.user_id=c.user_id;`);
    const migrated = JSON.parse(await asOwner(`SELECT coalesce(jsonb_agg(jsonb_build_object('template',template,'timezone',timezone,'cadence',cadence,'options',options,'conversation',conversation_id)),'[]') FROM public.agent_schedules WHERE user_id=${quote(legacy)};`));
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].template, 'daily_briefing');
    assert.equal(migrated[0].timezone, 'America/New_York');
    assert.deepEqual(migrated[0].cadence, { kind: 'daily', time: '07:15' });
    assert.equal(migrated[0].options.baziChartId, chartId);
    assert.equal(await asActor(legacy, `SELECT title FROM public.conversations WHERE id=${quote(migrated[0].conversation)};`), '定时 · 每日早报');
    await asOwner(`DELETE FROM public.agent_schedules WHERE user_id=${quote(legacy)}; DELETE FROM public.conversations WHERE user_id=${quote(legacy)}; DELETE FROM public.user_settings WHERE user_id=${quote(legacy)}; DELETE FROM public.reminder_subscriptions WHERE user_id=${quote(legacy)}; DELETE FROM public.bazi_charts WHERE id=${quote(chartId)};`);
  });
}
