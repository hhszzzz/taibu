import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const nullable = value => value === null ? 'NULL' : quote(value);
/** The entry one tool call writes, as agent_archive_entry_id derives it. */
const entryId = (runId, callId) => {
  const hex = createHash('md5').update(`${runId}:${callId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// 20261021_120000_agent_user_archive: facts the user told are written by the leased task, judgements only by the owner's
// own save of a card the task cached, and the case notes page keeps what the Agent wrote while it is unchanged.
export async function agentArchiveDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO identity.users(id) VALUES(${quote(owner)}),(${quote(other)});`);
  const admin = statement => asActor(adminId, statement);
  const memory = enabled => asOwner(`INSERT INTO public.user_settings(user_id,chat_preferences) VALUES(${quote(owner)},${json({ memoryEnabled: enabled })})
    ON CONFLICT(user_id) DO UPDATE SET chat_preferences=excluded.chat_preferences;`);
  const message = (id, content, role = 'user') => ({ id, role, content, createdAt: new Date().toISOString() });
  const conversation = (userId, title, messages = []) =>
    asActor(userId, `SELECT public.create_conversation_with_messages(${quote(userId)},${quote(title)},'general','chat','{}',${json(messages)});`);
  const cp = { version: 2, messages: [], parts: [], durable: { engine: 'pi-durable/1.4.0', seeded: true } };
  const assistant = id => ({ id: `agent:${id}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), agent: { version: 1, runId: id, status: 'queued', parts: [] } });
  const said = '我2024年3月从老东家离职，换到了现在这家公司做产品经理';
  const evidence = '2024年3月从老东家离职，换到了现在这家公司';

  const id = randomUUID(), cid = await conversation(owner, '档案契约', [message('current', '这段对话里也提到跳槽')]);
  await admin(`SELECT public.agent_create_run(${quote(id)},${quote(owner)},${quote(cid)},${quote(id)},'hash',${json({ model: 'fixture', reasoning: false, webEnabled: false, memoryEnabled: true, systemPrompt: 'fixture', userMessage: message(`u:${id}`, said) })},${json(cp)},${json(assistant(id))},NULL,false);`);
  await admin("SELECT public.agent_worker_heartbeat('archive-db','pi-durable/1.4.0');");
  const r = JSON.parse(await admin("SELECT to_jsonb(public.agent_claim_run('archive-db'));"));
  assert.equal(r.id, id);
  const finish = () => admin(`SELECT public.agent_finish_run(${quote(r.id)},${quote(r.worker_id)},${r.fence},'cancelled',${json(cp)},${json(assistant(r.id))});`);

  const chart = randomUUID(), othersChart = randomUUID();
  await asOwner(`INSERT INTO public.bazi_charts(id,user_id,name,birth_date) VALUES(${quote(chart)},${quote(owner)},'本人','1990-01-15'),(${quote(othersChart)},${quote(other)},'别人','1991-02-01');`);
  const label = { type: 'bazi_chart', id: chart, label: '八字命盘「本人」' };
  const record = (callId, { chartType = null, chartId = null, date = '2024-03-01', category = '事业', title = '换到新公司', proof = evidence, fence = r.fence, actor = admin } = {}) =>
    actor(`SELECT public.agent_record_user_event(${quote(r.id)},${quote(r.worker_id)},${fence},${quote(callId)},${nullable(chartType)},${nullable(chartId)},${quote(date)},${quote(category)},${quote(title)},${quote(proof)});`);
  const cache = (callId, proposal, toolName = 'propose_archive_entry') => admin(`SELECT public.agent_cache_tool(${quote(r.id)},${quote(r.worker_id)},${r.fence},${quote(callId)},${quote(toolName)},'tool',${json({ kind: proposal.kind })},${json({ content: [{ type: 'text', text: '已生成保存卡片' }], details: { runId: r.id, callId, proposal } })});`);
  const save = (callId, userId = owner, role = 'authenticated') => asActor(userId, `SELECT public.agent_save_archive_proposal(${quote(r.id)},${quote(callId)});`, role);
  const review = async () => JSON.parse(await asActor(owner, `SELECT json_build_object('review',master_review,'source',source_run_id) FROM public.bazi_case_profiles WHERE bazi_chart_id=${quote(chart)};`));
  const events = async () => JSON.parse(await asActor(owner, `SELECT coalesce(json_agg(json_build_object('id',id,'title',title,'detail',detail,'date',event_date,'category',category,'created',created_at,'source',source_run_id) ORDER BY created_at,id),'[]') FROM public.bazi_case_events WHERE bazi_chart_id=${quote(chart)};`));
  const saveProfile = (masterReview, list, actor = admin) => actor(`SELECT public.save_bazi_case_profile_as_service(${quote(owner)},${quote(chart)},${json(masterReview)},'{}'::jsonb,${json(list)});`);
  // The case notes page sends every event it shows, with the ID it read.
  const payload = list => list.map(event => ({ id: event.id, event_date: event.date, category: event.category, title: event.title, detail: event.detail ?? '' }));

  // A running task holds its conversation; it is settled even when a contract fails, so the modules after this one start clean.
  try {
    await t.test('told events are recorded verbatim only with long-term memory on, on the owner\'s charts, once per call', async () => {
      await memory(false);
      await assert.rejects(record('e1'), /AGENT_MEMORY_DISABLED/);
      await memory(true);
      await assert.rejects(record('e1', { proof: '我从没说过这句话的内容' }), /AGENT_ARCHIVE_EVIDENCE_REQUIRED/);
      await assert.rejects(record('e1', { proof: '离职' }), /AGENT_ARCHIVE_EVIDENCE_REQUIRED/, 'four characters at least');
      await assert.rejects(record('e1', { fence: r.fence + 1 }), /AGENT_LEASE_LOST/);
      await assert.rejects(record('e1', { actor: statement => asActor(owner, statement) }), /AGENT_ADMIN_REQUIRED/, 'only the worker writes facts');
      await assert.rejects(record('e1', { category: '旅行' }), /AGENT_ARCHIVE_ENTRY_INVALID/);
      await assert.rejects(record('e1', { title: '   ' }), /AGENT_ARCHIVE_ENTRY_INVALID/);
      await assert.rejects(record('e1', { chartType: 'bazi_chart', chartId: othersChart }), /AGENT_ARCHIVE_CHART_NOT_FOUND/);
      await assert.rejects(record('e1', { chartType: 'unknown_chart', chartId: chart }), /AGENT_ARCHIVE_CHART_NOT_FOUND/);

      const plain = JSON.parse(await record('e1'));
      assert.deepEqual(plain, { target: 'record', id: entryId(r.id, 'e1') });
      assert.deepEqual(JSON.parse(await record('e1')), plain, 'a replayed call finds its own entry');
      const row = JSON.parse(await asActor(owner, `SELECT json_build_object('count',count(*),'title',min(title),'content',min(content),'category',min(category),
        'tags',min(tags::text),'date',min(event_date)::text,'source',min(source_run_id::text),'conversation',min(source_conversation_id::text))
        FROM public.ming_records_with_archive_status WHERE id=${quote(plain.id)};`));
      assert.deepEqual(row, { count: 1, title: '换到新公司', content: evidence, category: 'event', tags: '{事业}', date: '2024-03-01', source: r.id, conversation: cid });
      assert.equal(await asActor(other, `SELECT count(*) FROM public.ming_records_with_archive_status WHERE id=${quote(plain.id)};`), '0');

      const onChart = JSON.parse(await record('e2', { chartType: 'bazi_chart', chartId: chart }));
      assert.deepEqual(onChart, { target: 'case_event', id: entryId(r.id, 'e2') });
      assert.deepEqual((await events()).map(event => ({ id: event.id, detail: event.detail, source: event.source })), [{ id: onChart.id, detail: evidence, source: r.id }]);
      assert.equal(await asActor(owner, `SELECT count(*) FROM public.bazi_case_profiles WHERE bazi_chart_id=${quote(chart)};`), '1', 'the first event opens the case notes');

      // A steer becomes evidence once it is delivered to the task, never before.
      const married = { proof: '2019年7月结的婚', category: '婚姻', title: '结婚', date: '2019-07-01' };
      const command = JSON.parse(await asActor(owner, `SELECT to_jsonb(public.agent_submit_command(${quote(r.id)},${quote(randomUUID())},'steer',${json(message(randomUUID(), '其实我是2019年7月结的婚，婚礼在杭州办的'))}));`));
      await assert.rejects(record('e3', married), /AGENT_ARCHIVE_EVIDENCE_REQUIRED/);
      await asOwner(`UPDATE public.agent_run_commands SET delivery_state='admitted' WHERE sequence=${command.sequence};`);
      assert.equal(JSON.parse(await record('e3', married)).target, 'record');
      await asOwner(`UPDATE public.agent_runs SET cancel_requested=true WHERE id=${quote(r.id)};`);
      await assert.rejects(record('e4'), /AGENT_CANCELLED/);
      await asOwner(`UPDATE public.agent_runs SET cancel_requested=false WHERE id=${quote(r.id)};`);
    });

    await t.test('a card saves the task\'s cached entry, only for the owner, once, and fills only blank judgements', async () => {
      const conclusion = { kind: 'conclusion', category: 'prediction', title: '2027 年换岗', content: '流年官星透出，宜在下半年调整岗位', date: '2027-06-01', tags: ['事业', '应期'], chart: label };
      await cache('c1', conclusion);
      await assert.rejects(save('c1', other), /AGENT_RUN_NOT_FOUND/);
      await assert.rejects(save('c1', null, 'anon'), /permission denied|42501/);
      await assert.rejects(save('missing'), /AGENT_ARCHIVE_PROPOSAL_NOT_FOUND/);
      const saved = JSON.parse(await save('c1'));
      assert.deepEqual(saved, { target: 'record', id: entryId(r.id, 'c1') });
      assert.deepEqual(JSON.parse(await save('c1')), saved, 'a second click finds the same entry');
      const stored = JSON.parse(await asActor(owner, `SELECT json_build_object('count',count(*),'category',min(category),'tags',min(tags::text),'date',min(event_date)::text,
        'chartType',min(related_chart_type),'chart',min(related_chart_id::text),'source',min(source_run_id::text)) FROM public.ming_records WHERE id=${quote(saved.id)};`));
      assert.deepEqual(stored, { count: 1, category: 'prediction', tags: '{事业,应期}', date: '2027-06-01', chartType: 'bazi_chart', chart, source: r.id });

      // The entry is what the task cached: a result under another tool's name is not a card.
      await cache('m0', { kind: 'conclusion', category: 'general', title: '伪造', content: '不是保存卡片', date: null, tags: [], chart: null }, 'remember_user_fact');
      await assert.rejects(save('m0'), /AGENT_ARCHIVE_PROPOSAL_NOT_FOUND/);
      await cache('c2', { ...conclusion, chart: { ...label, id: othersChart } });
      await assert.rejects(save('c2'), /AGENT_ARCHIVE_CHART_NOT_FOUND/);
      await cache('c3', { ...conclusion, category: 'reflection' });
      await assert.rejects(save('c3'), /AGENT_ARCHIVE_ENTRY_INVALID/);

      await cache('v1', { kind: 'event', date: '2015-09-01', category: '学业', title: '读研', detail: '去北京读研究生', chart: label });
      assert.deepEqual(JSON.parse(await save('v1')), { target: 'case_event', id: entryId(r.id, 'v1') });

      const gods = { yongShen: { basic: ['水'], advanced: [] }, xiShen: { basic: ['金'], advanced: [] }, jiShen: { basic: ['火'], advanced: ['丙'] }, xianShen: { basic: [], advanced: [] } };
      await cache('m1', { kind: 'master_review', chart: label, review: { strengthLevel: '偏弱', patterns: ['正官格'], gods } });
      assert.deepEqual(JSON.parse(await save('m1')).filled, ['strengthLevel', 'patterns', 'gods']);
      const first = await review();
      assert.equal(first.source, r.id);
      assert.deepEqual({ strength: first.review.strengthLevel, patterns: first.review.patterns, yong: first.review.yongShen, ji: first.review.jiShen, summary: first.review.summary },
        { strength: '偏弱', patterns: ['正官格'], yong: { basic: ['水'], advanced: [] }, ji: { basic: ['火'], advanced: ['丙'] }, summary: '' });

      // The user's own judgement is never overwritten: their 旺衰 stays, and one filled role keeps all four.
      const empty = { basic: [], advanced: [] };
      await saveProfile({ ...first.review, strengthLevel: '中和', patterns: [], yongShen: { basic: ['木'], advanced: [] }, xiShen: empty, jiShen: empty, xianShen: empty }, payload(await events()));
      assert.equal((await review()).source, null, 'a changed review is no longer the Agent\'s');
      await cache('m2', { kind: 'master_review', chart: label, review: { strengthLevel: '偏强', patterns: ['七杀格'], gods } });
      assert.deepEqual(JSON.parse(await save('m2')).filled, ['patterns']);
      const second = await review();
      assert.deepEqual({ strength: second.review.strengthLevel, patterns: second.review.patterns, yong: second.review.yongShen, source: second.source },
        { strength: '中和', patterns: ['七杀格'], yong: { basic: ['木'], advanced: [] }, source: r.id });
      await cache('m3', { kind: 'master_review', chart: label, review: { strengthLevel: '极强' } });
      assert.deepEqual(JSON.parse(await save('m3')).filled, [], 'nothing left to fill changes nothing');
      assert.equal((await review()).review.strengthLevel, '中和');
      await cache('m4', { kind: 'master_review', chart: label, review: { strengthLevel: '强' } });
      await assert.rejects(save('m4'), /AGENT_ARCHIVE_ENTRY_INVALID/);
    });

    await t.test('case notes keep each event\'s identity, and its source only while it is unchanged', async () => {
      const current = await events();
      const agentEvent = current.find(event => event.source === r.id && event.title === '换到新公司');
      assert.ok(agentEvent);
      assert.deepEqual(current.map(event => event.title).sort(), ['换到新公司', '读研'], 'saving the review kept the events');
      const masterReview = (await review()).review;
      await assert.rejects(saveProfile(masterReview, payload(current), statement => asActor(owner, statement)), /forbidden|42501/);
      await saveProfile(masterReview, payload(current));
      assert.deepEqual(await events(), current, 'an unchanged save keeps every ID, creation time and source');
      assert.equal((await review()).source, r.id, 'an unchanged review keeps its source');

      const forged = randomUUID();
      const edited = payload(current).map(event => event.id === agentEvent.id ? { ...event, title: '换到新公司（已核对）' } : event);
      await saveProfile(masterReview, [...edited, { id: forged.toUpperCase(), event_date: '2021-05-01', category: '健康', title: '体检', detail: '' }]);
      const after = await events();
      const kept = after.find(event => event.id === agentEvent.id);
      assert.deepEqual({ title: kept.title, created: kept.created, source: kept.source }, { title: '换到新公司（已核对）', created: agentEvent.created, source: null });
      const added = after.find(event => event.title === '体检');
      assert.ok(added && added.id !== forged && added.source === null, 'a new event never brings its own ID or source');
      await assert.rejects(saveProfile(masterReview, [payload(current)[0], payload(current)[0]]), /duplicate event ids|22023/);
    });

    await t.test('records the user edits are no longer the Agent\'s, and a source is always the owner\'s own task', async () => {
      const plain = entryId(r.id, 'e1');
      const source = () => asActor(owner, `SELECT coalesce(source_run_id::text,'') FROM public.ming_records WHERE id=${quote(plain)};`);
      await asOwner(`UPDATE public.ming_records SET is_pinned=true, tags=ARRAY['事业','跳槽'] WHERE id=${quote(plain)};`);
      assert.equal(await source(), r.id, 'pinning and tags are not what it says');
      await asOwner(`UPDATE public.ming_records SET title='换到新公司' WHERE id=${quote(plain)};`);
      assert.equal(await source(), r.id, 'an unchanged title is not an edit');
      await asOwner(`UPDATE public.ming_records SET content='改写后的内容' WHERE id=${quote(plain)};`);
      assert.equal(await source(), '');
      await assert.rejects(asOwner(`INSERT INTO public.ming_records(user_id,title,source_run_id) VALUES(${quote(other)},'冒用',${quote(r.id)});`), /AGENT_ARCHIVE_SOURCE_OWNER/);
      const theirs = await asOwner(`INSERT INTO public.ming_records(user_id,title) VALUES(${quote(other)},'别人的记录') RETURNING id;`);
      await assert.rejects(asOwner(`UPDATE public.ming_records SET source_run_id=${quote(r.id)} WHERE id=${quote(theirs)};`), /AGENT_ARCHIVE_SOURCE_OWNER/);
      await assert.rejects(asOwner(`UPDATE public.bazi_case_profiles SET user_id=${quote(other)} WHERE bazi_chart_id=${quote(chart)} AND source_run_id IS NOT NULL;`), /AGENT_ARCHIVE_SOURCE_OWNER/);
    });

    await t.test('conversation search reads only the owner\'s other conversations, with long-term memory on', async () => {
      const search = (query, limit = 8) => admin(`SELECT public.agent_search_conversations(${quote(r.id)},${quote(r.worker_id)},${r.fence},${quote(query)},${limit});`);
      const job = await conversation(owner, '跳槽的事', [message('q1', '2024年我跳槽去了上海的新公司，前途如何？'), message('a1', '从流年看，2024年官星透出，这次跳槽顺利。', 'assistant'), message('q2', '100%满意吗')]);
      await conversation(owner, '婚姻', [message('q3', '婚姻什么时候到来')]);
      await conversation(other, '别人的跳槽', [message('x1', '我也跳槽了')]);
      const hits = JSON.parse(await search('跳槽'));
      assert.deepEqual(hits.map(hit => [hit.conversationId, hit.messageId, hit.role]), [[job, 'q1', 'user'], [job, 'a1', 'assistant']]);
      assert.equal(hits[0].title, '跳槽的事');
      assert.equal(hits[0].reply, '从流年看，2024年官星透出，这次跳槽顺利。');
      assert.equal(hits[1].question, '2024年我跳槽去了上海的新公司，前途如何？');
      assert.ok(!JSON.stringify(hits).includes('这段对话里也提到跳槽'), 'the current conversation is already in context');
      assert.deepEqual(JSON.parse(await search('跳槽 上海')).map(hit => hit.messageId), ['q1'], 'every word must appear');
      assert.deepEqual(JSON.parse(await search('100%')).map(hit => hit.messageId), ['q2'], 'LIKE wildcards are literal');
      assert.deepEqual(JSON.parse(await search('1_0')), []);
      assert.equal(JSON.parse(await search('跳槽', 1)).length, 1);
      await assert.rejects(search('   '), /AGENT_SEARCH_QUERY_INVALID/);
      await assert.rejects(search('一 二 三 四 五 六'), /AGENT_SEARCH_QUERY_INVALID/);
      await assert.rejects(search('跳槽', 21), /INVALID_SEARCH_LIMIT/);
      await assert.rejects(asActor(owner, `SELECT public.agent_search_conversations(${quote(r.id)},${quote(r.worker_id)},${r.fence},'跳槽',8);`), /AGENT_ADMIN_REQUIRED/);
      await memory(false);
      await assert.rejects(search('跳槽'), /AGENT_MEMORY_DISABLED/);
      await memory(true);
    });

    await t.test('the archive helpers stay private to the definer functions, and a deleted task leaves no source behind', async () => {
      assert.equal(await sql(`SELECT string_agg(conrelid::regclass::text||':'||confdeltype::text,',' ORDER BY conrelid::regclass::text) FROM pg_constraint
        WHERE contype='f' AND confrelid='public.agent_runs'::regclass AND conname IN ('ming_records_source_run_id_fkey','bazi_case_events_source_run_id_fkey','bazi_case_profiles_source_run_id_fkey');`),
        'bazi_case_events:n,bazi_case_profiles:n,ming_records:n', 'ON DELETE SET NULL on all three');
      for (const signature of ['agent_user_said(public.agent_runs,text)', 'agent_archive_entry_id(uuid,text)', 'agent_archive_chart_owned(uuid,text,uuid)',
        'agent_archive_event(public.agent_runs,uuid,text,uuid,date,text,text,text)', 'agent_fill_master_review(public.agent_runs,uuid,jsonb)']) {
        for (const role of ['anon', 'authenticated']) assert.equal(await sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE');`), 'f', `${role} ${signature}`);
      }
      assert.equal(await sql("SELECT has_function_privilege('anon','public.agent_save_archive_proposal(uuid,text)','EXECUTE');"), 'f');
      assert.equal(await sql("SELECT has_function_privilege('authenticated','public.agent_save_archive_proposal(uuid,text)','EXECUTE');"), 't');
    });
  } finally {
    await finish();
  }
}
