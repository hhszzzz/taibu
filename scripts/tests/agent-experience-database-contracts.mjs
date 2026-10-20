import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

export async function agentExperienceDatabaseContracts(t, { sql, asActor, asOwner, adminId }) {
  const owner = randomUUID(), other = randomUUID();
  await sql(`INSERT INTO auth.users(id) VALUES(${quote(owner)}),(${quote(other)});`);
  await asOwner(`UPDATE public.users SET ai_chat_count=20,membership='plus' WHERE id IN (${quote(owner)},${quote(other)});`);
  const admin = statement => asActor(adminId, statement);
  const parsed = async statement => { const value=await admin(statement); return value ? JSON.parse(value) : null; };
  const balance = async () => Number(await asOwner(`SELECT ai_chat_count FROM public.users WHERE id=${quote(owner)};`));
  const conversation = () => asActor(owner,`SELECT public.create_conversation_with_messages(${quote(owner)},'经验契约','general','chat','{}','[]');`);
  const message = (id, content='资料问题') => ({ id, role:'user', content, createdAt:new Date().toISOString() });
  const assistant = (id, content='') => ({ id:`agent:${id}`,role:'assistant',content,createdAt:new Date().toISOString(),agent:{version:1,runId:id,status:'queued',parts:[]} });
  const cp = {version:2,messages:[],parts:[],finalArtifacts:[],durable:{engine:'pi-durable/1.3.0',seeded:true}};
  async function run() {
    const id=randomUUID(), cid=await conversation();
    await admin(`SELECT public.agent_create_run(${quote(id)},${quote(owner)},${quote(cid)},${quote(id)},'hash',${json({model:'fixture',reasoning:false,webEnabled:false,systemPrompt:'fixture',userMessage:message(`u:${id}`)})},${json(cp)},${json(assistant(id))},NULL,false);`);
    await admin("SELECT public.agent_worker_heartbeat('experience-db','pi-durable/1.3.0');");
    const claimed=await parsed("SELECT to_jsonb(public.agent_claim_run('experience-db'));");
    assert.equal(claimed.id,id); return claimed;
  }
  const lease = r => `${quote(r.id)},${quote(r.worker_id)},${r.fence}`;
  const finish = (r,status='cancelled', checkpoint=cp, output=assistant(r.id)) => admin(`SELECT public.agent_finish_run(${lease(r)},${quote(status)},${json(checkpoint)},${json(output)},NULL);`);
  const submit = async(r, request=randomUUID(), content='待发送',mode='follow_up',attachments,metadata) => JSON.parse(await asActor(owner,`SELECT to_jsonb(public.agent_submit_command(${quote(r.id)},${quote(request)},${quote(mode)},${json({...message(randomUUID(),content),attachments,metadata})}));`));

  await t.test('long-term memory is opt-in, owner-isolated, evidence-bound and lease-fenced', async () => {
    const r = await run(), evidence = '我希望每次分析都使用简洁直接的表达方式';
    await asOwner(`UPDATE public.agent_runs SET input=jsonb_set(input,'{userMessage}',${json(message('memory-source', evidence))}) WHERE id=${quote(r.id)};`);
    const write = (content=evidence, proof=evidence, fence=r.fence) => admin(`SELECT to_jsonb(public.agent_write_memory(${quote(r.id)},${quote(r.worker_id)},${fence},'表达方式',${quote(content)},'preference',${quote(proof)}));`);
    await assert.rejects(write(), /AGENT_MEMORY_DISABLED/);
    await asOwner(`INSERT INTO public.user_settings(user_id,chat_preferences) VALUES(${quote(owner)},'{"memoryEnabled":true}') ON CONFLICT(user_id) DO UPDATE SET chat_preferences=excluded.chat_preferences;`);
    await assert.rejects(write(evidence, '不在用户消息中的原话'), /AGENT_MEMORY_EVIDENCE_REQUIRED/);
    await assert.rejects(write('模型擅自推断的事实'), /AGENT_MEMORY_EVIDENCE_REQUIRED/);
    await assert.rejects(write(evidence,evidence,r.fence+1), /AGENT_LEASE_LOST/);
    const first = JSON.parse(await write()), duplicate = JSON.parse(await write());
    assert.equal(first.id, duplicate.id);
    assert.equal(await admin(`SELECT count(*) FROM public.user_agent_memory WHERE user_id=${quote(owner)};`),'1');
    assert.equal(await asActor(other,`SELECT count(*) FROM public.user_agent_memory WHERE id=${quote(first.id)};`),'0');
    assert.equal(await asActor(other,`WITH deleted AS (DELETE FROM public.user_agent_memory WHERE id=${quote(first.id)} RETURNING id) SELECT count(*) FROM deleted;`),'0');
    await assert.rejects(asActor(other,`INSERT INTO public.user_agent_memory(user_id,title,content) VALUES(${quote(owner)},'伪造','另一个人的内容');`), /AGENT_ADMIN_REQUIRED|row-level security/);
    await asOwner(`UPDATE public.agent_runs SET input=jsonb_set(input,'{userMessage,role}','"assistant"') WHERE id=${quote(r.id)};`);
    await assert.rejects(write(), /AGENT_MEMORY_EVIDENCE_REQUIRED/);
    const command = await submit(r,randomUUID(),evidence,'steer');
    await assert.rejects(write(), /AGENT_MEMORY_EVIDENCE_REQUIRED/);
    await asOwner(`UPDATE public.agent_run_commands SET delivery_state='admitted' WHERE sequence=${command.sequence};`);
    assert.equal(JSON.parse(await write()).id,first.id);
    await asOwner(`UPDATE public.agent_run_commands SET message=jsonb_set(message,'{role}','"assistant"') WHERE sequence=${command.sequence};`);
    await assert.rejects(write(), /AGENT_MEMORY_EVIDENCE_REQUIRED/);
    await asOwner(`UPDATE public.agent_runs SET input=jsonb_set(input,'{userMessage,role}','"user"'),lease_until=now()-interval '1 second' WHERE id=${quote(r.id)};`);
    await assert.rejects(write(), /AGENT_LEASE_LOST/);
    await asOwner(`UPDATE public.agent_runs SET lease_until=now()+interval '60 seconds',cancel_requested=true WHERE id=${quote(r.id)};`);
    await assert.rejects(write(), /AGENT_CANCELLED/);
    await asOwner(`UPDATE public.agent_runs SET cancel_requested=false WHERE id=${quote(r.id)};`);
    await asOwner(`UPDATE public.user_settings SET chat_preferences='{"memoryEnabled":false}' WHERE user_id=${quote(owner)};`);
    await assert.rejects(write(), /AGENT_MEMORY_DISABLED/);
    await asActor(owner,`INSERT INTO public.user_agent_memory(user_id,title,content) SELECT ${quote(owner)},'手动记忆', '容量记录 '||n FROM generate_series(1,127) n;`);
    await assert.rejects(asActor(owner,`INSERT INTO public.user_agent_memory(user_id,title,content) VALUES(${quote(owner)},'溢出','第129条记忆');`), /AGENT_MEMORY_LIMIT/);
    assert.equal(await asActor(owner,`SELECT count(*) FROM public.user_agent_memory;`),'128');
    await asActor(owner,`DELETE FROM public.user_agent_memory WHERE user_id=${quote(owner)};`);
    await finish(r);
  });

  await t.test('literal branch search stays owner-isolated and does not search inactive version trees',async()=>{
    const cid=await conversation(); const marker=`literal_%_${randomUUID()}`;
    await asActor(owner,`SELECT public.replace_conversation_messages(${quote(cid)},${json([{...message('visible',marker),versions:[{userContent:'inactive-secret',aiContent:'inactive-only'}]}])});`);
    const found=JSON.parse(await asActor(owner,`SELECT public.search_conversation_messages(${quote(marker)},30);`));
    assert.equal(found.length,1); assert.equal(found[0].messageId,'visible');
    assert.equal(await asActor(other,`SELECT public.search_conversation_messages(${quote(marker)},30);`),'[]');
    assert.equal(await asActor(owner,"SELECT public.search_conversation_messages('inactive-secret',30);"),'[]');
  });
  await t.test('enhancement quota admits exactly five concurrent calls without charging credits',async()=>{
    const before=await balance();
    const calls=await Promise.all(Array.from({length:8},()=>asActor(owner,'SELECT public.claim_prompt_enhancement();')));
    assert.equal(calls.filter(value=>value==='t').length,5); assert.equal(await balance(),before);
  });
  await t.test('pending queue edits preserve command identity; claims lock edits and add history once',async()=>{
    const r=await run(), request=randomUUID(); const queued=await submit(r,request);
    assert.equal(queued.delivery_state,'pending');
    assert.equal(await asOwner(`SELECT count(*) FROM public.conversation_messages WHERE conversation_id=${quote(r.conversation_id)} AND message_id=${quote(queued.message.id)};`),'0');
    const edited=JSON.parse(await asActor(owner,`SELECT to_jsonb(public.agent_change_command(${quote(r.id)},${queued.sequence},1,'edit','{"content":"编辑后"}'));`));
    assert.equal(edited.sequence,queued.sequence); assert.equal(edited.revision,2);
    const duplicate=await submit(r,request); assert.equal(duplicate.sequence,queued.sequence); assert.equal(duplicate.message.content,'编辑后');
    await assert.rejects(asActor(other,`SELECT public.agent_change_command(${quote(r.id)},${queued.sequence},2,'withdraw','{}');`),/AGENT_RUN_NOT_FOUND/);
    const races=await Promise.allSettled([admin(`SELECT public.agent_claim_command(${lease(r)},${queued.sequence});`),asActor(owner,`SELECT public.agent_change_command(${quote(r.id)},${queued.sequence},2,'promote','{}');`)]);
    assert.equal(races[0].status,'fulfilled');
    const final=await parsed(`SELECT to_jsonb(c) FROM public.agent_run_commands c WHERE sequence=${queued.sequence};`);
    assert.equal(final.delivery_state,'claimed');
    await assert.rejects(asActor(owner,`SELECT public.agent_change_command(${quote(r.id)},${queued.sequence},${final.revision},'withdraw','{}');`),/AGENT_COMMAND_LOCKED/);
    await admin(`SELECT public.agent_claim_command(${lease(r)},${queued.sequence});`);
    assert.equal(await asOwner(`SELECT count(*) FROM public.conversation_messages WHERE conversation_id=${quote(r.conversation_id)} AND message_id=${quote(queued.message.id)};`),'1');
    await finish(r); assert.equal(await asOwner(`SELECT delivery_state FROM public.agent_run_commands WHERE sequence=${queued.sequence};`),'cancelled');
  });
  await t.test('stopping cancels pending inputs and rejects submissions after cancellation',async()=>{
    const r=await run(); const first=await submit(r); const second=await submit(r);
    await asActor(owner,`SELECT public.agent_cancel_run(${quote(r.id)});`);
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_commands WHERE sequence IN (${first.sequence},${second.sequence}) AND delivery_state='cancelled';`),'2');
    await assert.rejects(submit(r),/AGENT_RUN_CLOSED/);
    await finish(r);
  });
  await t.test('structured question replies deduplicate across request IDs and reject conflicting answers',async()=>{
    const r=await run(); const questionId='same-question'; const question={...cp,question:'请补充出生日期',questionId,questions:[{id:'birth',question:'出生日期',allowCustom:true}]};
    await finish(r,'awaiting_input',question,{...assistant(r.id),agent:{version:1,runId:r.id,status:'awaiting_input',parts:[{type:'question',id:questionId,question:'请补充出生日期'}]}});
    const metadata={agentQuestionId:questionId,agentAnswers:{birth:'1990-01-15'}};
    const first=await submit(r,randomUUID(),'1990-01-15','reply',undefined,metadata);
    const duplicate=await submit(r,randomUUID(),'1990-01-15','reply',undefined,metadata);
    assert.equal(duplicate.sequence,first.sequence);
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_commands WHERE run_id=${quote(r.id)} AND mode='reply';`),'1');
    await assert.rejects(submit(r,randomUUID(),'1991-01-15','reply',undefined,{...metadata,agentAnswers:{birth:'1991-01-15'}}),/AGENT_QUESTION_ALREADY_ANSWERED/);
    await asActor(owner,`SELECT public.agent_cancel_run(${quote(r.id)});`); const cancelled=await parsed("SELECT to_jsonb(public.agent_claim_run('experience-db')); "); await finish(cancelled);
  });
  await t.test('task notices and popup claims are idempotent across concurrent tabs',async()=>{
    const r=await run(); const question={...cp,question:'补充信息',questionId:'call-a',questions:[{id:'birth',question:'出生日期',allowCustom:true}]};
    await finish(r,'awaiting_input',question,{...assistant(r.id),agent:{version:1,runId:r.id,status:'awaiting_input',parts:[{type:'question',id:'call-a',question:'补充信息'}]}});
    const notice=await asOwner(`SELECT id FROM public.notifications WHERE event_key=${quote(`agent:${r.id}:awaiting_input:call-a`)};`);
    assert.ok(notice);
    await assert.rejects(asActor(other,`SELECT public.agent_submit_command(${quote(r.id)},'foreign','reply',${json(message('foreign'))});`),/AGENT_RUN_NOT_FOUND/);
    const claims=await Promise.all([asActor(owner,`SELECT public.claim_notification_popup(${quote(notice)});`),asActor(owner,`SELECT public.claim_notification_popup(${quote(notice)});`)]);
    assert.equal(claims.filter(value=>value==='t').length,1);
    assert.equal(await asActor(other,`SELECT public.claim_notification_popup(${quote(notice)});`),'f');
    await asActor(owner,`SELECT public.agent_cancel_run(${quote(r.id)});`); const cancelled=await parsed("SELECT to_jsonb(public.agent_claim_run('experience-db')); "); await finish(cancelled);
  });
  await t.test('private attachments retain version and fork references until the last conversation is removed',async()=>{
    const id=randomUUID(), cid=await conversation();
    await asOwner(`INSERT INTO public.agent_attachments(id,user_id,object_path,name,kind,mime_type,size,sha256,status) VALUES(${quote(id)},${quote(owner)},${quote(`${owner}/${id}`)},'文本资料','text','text/plain',20,'digest','ready');`);
    const source=[{...message('source'),attachments:{ids:[id]}},{id:'answer',role:'assistant',content:'回答',createdAt:'now'}];
    await asActor(owner,`SELECT public.replace_conversation_messages(${quote(cid)},${json(source)});`);
    assert.equal(await asActor(other,`SELECT count(*) FROM public.agent_attachments WHERE id=${quote(id)};`),'0');
    const otherCid=await asActor(other,`SELECT public.create_conversation_with_messages(${quote(other)},'别人的对话','general','chat','{}','[]');`);
    await assert.rejects(asActor(other,`SELECT public.replace_conversation_messages(${quote(otherCid)},${json(source)});`),/ATTACHMENT_NOT_AVAILABLE/);
    const fork=await asActor(owner,`SELECT public.fork_conversation_snapshot(${quote(cid)},'answer',${json(source)},${json(source.map(item=>({...item,id:randomUUID(),metadata:{forkHistory:true}})))});`);
    await assert.rejects(asActor(owner,`SELECT public.replace_conversation_messages(${quote(fork)},'[]');`),/FORK_HISTORY_READ_ONLY/);
    await asActor(owner,`SELECT public.delete_conversation_graph(${quote(cid)});`);
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_attachment_refs WHERE attachment_id=${quote(id)};`),'1');
    assert.equal(await asOwner(`SELECT orphaned_at IS NULL FROM public.agent_attachments WHERE id=${quote(id)};`),'t');
    await asActor(owner,`SELECT public.delete_conversation_graph(${quote(fork)});`);
    assert.equal(await asOwner(`SELECT orphaned_at IS NOT NULL FROM public.agent_attachments WHERE id=${quote(id)};`),'t');
    await asOwner(`UPDATE public.agent_attachments SET orphaned_at=now()-interval '25 hours' WHERE id=${quote(id)};`);
    const cleanup=JSON.parse(await admin('SELECT coalesce(jsonb_agg(to_jsonb(a)),\'[]\') FROM public.claim_agent_attachment_cleanup(50) a;'));
    assert.ok(cleanup.some(item=>item.id===id && item.status==='deleting'));
  });
  await t.test('fork rejects a stale branch atomically without creating another conversation',async()=>{
    const cid=await conversation(), source=[{id:'a',role:'assistant',content:'完成',createdAt:'now'}];
    await asActor(owner,`SELECT public.replace_conversation_messages(${quote(cid)},${json(source)});`);
    await assert.rejects(asActor(owner,`SELECT public.fork_conversation_snapshot(${quote(cid)},'a','[]',${json(source)});`),/BRANCH_CHANGED/);
    await assert.rejects(asActor(other,`SELECT public.fork_conversation_snapshot(${quote(cid)},'a',${json(source)},${json(source)});`),/CONVERSATION_NOT_FOUND/);
  });
  await t.test('daily briefings default off, claim once, settle one credit and deliver without regeneration',async()=>{
    assert.equal(await admin(`SELECT count(*) FROM public.daily_briefing_jobs WHERE user_id=${quote(owner)};`),'0');
    await asOwner(`INSERT INTO public.user_settings(user_id,daily_briefing_settings) VALUES(${quote(owner)},'{"timezone":"America/New_York","time":"00:00"}') ON CONFLICT(user_id) DO UPDATE SET daily_briefing_settings=excluded.daily_briefing_settings; INSERT INTO public.reminder_subscriptions(user_id,reminder_type,enabled,notify_site) VALUES(${quote(owner)},'daily_briefing',true,true);`);
    const before=await balance();
    const claims=await Promise.all([parsed("SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM public.claim_daily_briefings(2) j;"),parsed("SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM public.claim_daily_briefings(2) j;")]);
    const jobs=claims.flat().filter(job=>job.user_id===owner); assert.equal(jobs.length,1); const job=jobs[0];
    assert.equal(job.attempts,1); assert.equal(job.billing,'reserved'); assert.equal(await balance(),before-1);
    const result=await admin(`SELECT public.settle_daily_briefing(${quote(job.id)},${quote(job.lease_token)},'今日早报：请合理安排工作和生活，保持稳定节奏，优先完成重要事项。',NULL);`); assert.equal(result,'t');
    assert.equal(await admin(`SELECT public.settle_daily_briefing(${quote(job.id)},${quote(job.lease_token)},'重复提交不应再次扣费或生成对话。',NULL);`),'f');
    await admin('SELECT public.deliver_daily_briefing_notices(50);'); await admin('SELECT public.deliver_daily_briefing_notices(50);');
    assert.equal(await asOwner(`SELECT count(*) FROM public.notifications WHERE event_key=${quote(`briefing:${job.id}`)};`),'1');
    assert.equal(await balance(),before-1);
    assert.equal(await admin(`SELECT count(*) FROM public.claim_daily_briefings(2) WHERE user_id=${quote(owner)};`),'0');
  });
  await t.test('disabled briefing jobs refund once and ordinary callers cannot claim',async()=>{
    const id=randomUUID(), before=await balance();
    await asOwner(`INSERT INTO public.daily_briefing_jobs(id,user_id,local_date,timezone,deadline,status,billing,attempts,lease_token,lease_until) VALUES(${quote(id)},${quote(other)},current_date,'UTC',now()+interval '1 hour','generating','reserved',3,gen_random_uuid(),now()-interval '1 minute'); UPDATE public.users SET ai_chat_count=4 WHERE id=${quote(other)};`);
    await admin('SELECT public.claim_daily_briefings(2);'); await admin('SELECT public.claim_daily_briefings(2);');
    assert.equal(await asOwner(`SELECT status||':'||billing FROM public.daily_briefing_jobs WHERE id=${quote(id)};`),'cancelled:refunded');
    assert.equal(await asOwner(`SELECT ai_chat_count FROM public.users WHERE id=${quote(other)};`),'5'); assert.equal(await balance(),before);
    await assert.rejects(asActor(owner,'SELECT public.claim_daily_briefings(2);'),/AGENT_ADMIN_REQUIRED/);
  });
  await t.test('briefing failures share one reservation, fence stale leases and refund on the third failure',async()=>{
    const user=randomUUID();
    await sql(`INSERT INTO auth.users(id) VALUES(${quote(user)});`);
    await asOwner(`UPDATE public.users SET ai_chat_count=5 WHERE id=${quote(user)}; INSERT INTO public.user_settings(user_id,daily_briefing_settings) VALUES(${quote(user)},'{"timezone":"Pacific/Auckland","time":"00:00"}'); INSERT INTO public.reminder_subscriptions(user_id,reminder_type,enabled) VALUES(${quote(user)},'daily_briefing',true);`);
    let previous;
    for(let attempt=1;attempt<=3;attempt++){
      const jobs=await parsed("SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM public.claim_daily_briefings(10) j;");
      const job=jobs.find(item=>item.user_id===user); assert.ok(job); assert.equal(job.attempts,attempt);
      assert.equal(await asOwner(`SELECT ai_chat_count FROM public.users WHERE id=${quote(user)};`),'4');
      if(previous) assert.equal(await admin(`SELECT public.settle_daily_briefing(${quote(job.id)},${quote(previous)},'旧租约的结果不应被保存到当前早报。',NULL);`),'f');
      previous=job.lease_token;
      if(attempt===1){
        assert.equal(await asOwner(`SELECT (deadline AT TIME ZONE timezone)::time=time '00:00' AND local_date=(now() AT TIME ZONE timezone)::date FROM public.daily_briefing_jobs WHERE id=${quote(job.id)};`),'t');
        await asOwner(`UPDATE public.daily_briefing_jobs SET lease_until=now()-interval '1 second' WHERE id=${quote(job.id)};`);
      } else await admin(`SELECT public.settle_daily_briefing(${quote(job.id)},${quote(job.lease_token)},NULL,'fixture failure');`);
    }
    const status=await asOwner(`SELECT status||':'||billing FROM public.daily_briefing_jobs WHERE user_id=${quote(user)};`);
    assert.equal(status,'failed:refunded');
    await admin('SELECT public.claim_daily_briefings(10);'); assert.equal(await asOwner(`SELECT ai_chat_count FROM public.users WHERE id=${quote(user)};`),'5');
    await asOwner(`UPDATE public.reminder_subscriptions SET enabled=false WHERE user_id=${quote(user)};`);
  });
  await t.test('zero balance skips a local day and feature shutdown refunds an outstanding job',async()=>{
    const users=[randomUUID(),randomUUID()]; await sql(`INSERT INTO auth.users(id) VALUES(${users.map(quote).join('),(')});`);
    for(let index=0;index<users.length;index++) await asOwner(`UPDATE public.users SET ai_chat_count=${index} WHERE id=${quote(users[index])}; INSERT INTO public.user_settings(user_id,daily_briefing_settings) VALUES(${quote(users[index])},'{"timezone":"Asia/Shanghai","time":"00:00"}'); INSERT INTO public.reminder_subscriptions(user_id,reminder_type,enabled) VALUES(${quote(users[index])},'daily_briefing',true);`);
    await admin('SELECT public.claim_daily_briefings(10);');
    assert.equal(await asOwner(`SELECT status||':'||billing FROM public.daily_briefing_jobs WHERE user_id=${quote(users[0])};`),'skipped:none');
    await admin('SELECT public.claim_daily_briefings(10,false);'); await admin('SELECT public.claim_daily_briefings(10,false);');
    assert.equal(await asOwner(`SELECT status||':'||billing FROM public.daily_briefing_jobs WHERE user_id=${quote(users[1])};`),'cancelled:refunded');
    assert.equal(await asOwner(`SELECT ai_chat_count FROM public.users WHERE id=${quote(users[1])};`),'1');
    const dst=await sql("SELECT ((date '2026-03-09')::timestamp AT TIME ZONE 'America/New_York')-((date '2026-03-08')::timestamp AT TIME ZONE 'America/New_York');"); assert.equal(dst,'23:00:00');
  });
}
