import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from 'node:fs/promises';

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;

/** Runs inside the existing disposable PostgreSQL fixture, never a live DB. */
export async function agentDatabaseContracts(
  t,
  { sql, asActor, asOwner, adminId },
) {
  const owner = randomUUID(),
    other = randomUUID();
  await sql(
    `INSERT INTO identity.users(id) VALUES (${quote(owner)}),(${quote(other)});`,
  );
  const admin = (statement) => asActor(adminId, statement);
  const parsed = async (statement) => {
    const value = await admin(statement);
    return value ? JSON.parse(value) : null;
  };
  const createConversation = () =>
    asActor(
      owner,
      `SELECT public.create_conversation_with_messages(${quote(owner)},'Agent fixture','chat','{}','[]');`,
    );
  const input = (id) => ({
    model: "fixture",
    reasoning: false,
    webEnabled: true,
    systemPrompt: "fixture",
    title: "Agent fixture",
    userMessage: {
      id: `user:${id}`,
      role: "user",
      content: "请排盘",
      createdAt: new Date().toISOString(),
    },
  });
  const checkpoint = {
    version: 2,
    durable: { engine: 'pi-durable/1.5.0' },
    messages: [],
    parts: [],
  };
  const assistant = (id) => ({
    id: `agent:${id}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    agent: { version: 1, runId: id, status: "queued", parts: [] },
  });
  const create = async (conversationId, options = {}) => {
    const id = options.id ?? randomUUID();
    return parsed(
      `SELECT to_jsonb(public.agent_create_run(${quote(id)},${quote(owner)},${quote(conversationId)},${quote(options.request ?? id)},${quote(options.hash ?? "same-hash")},${json(options.input ?? input(id))},${json(options.checkpoint ?? checkpoint)},${json(assistant(id))},${json({ version: 1, data: "encrypted-fixture", iv: "nonce", tag: "tag" })},${quote(options.billing ?? "metered")}));`,
    );
  };
  const claim = async (worker = "worker-a") => {
    await admin(`SELECT public.agent_worker_heartbeat(${quote(worker)},'pi-durable/1.5.0');`);
    return parsed(`SELECT to_jsonb(public.agent_claim_run(${quote(worker)}));`);
  };
  const lease = (run) =>
    `${quote(run.id)},${quote(run.worker_id)},${run.fence}`;
  const finish = (
    run,
    status,
    message = assistant(run.id),
    cp = checkpoint,
  ) =>
    parsed(
      `SELECT to_jsonb(public.agent_finish_run(${lease(run)},${quote(status)},${json(cp)},${json(message)}));`,
    );
  const get = (id) =>
    parsed(
      `SELECT to_jsonb(r) FROM public.agent_runs r WHERE id=${quote(id)};`,
    );
  const runCount = () =>
    asOwner(`SELECT count(*) FROM public.agent_runs WHERE user_id=${quote(owner)};`);
  const command = (
    run,
    request = randomUUID(),
    mode = "reply",
    content = "1990年1月15日9点，男性",
  ) =>
    asActor(
      owner,
      `SELECT to_jsonb(public.agent_submit_command(${quote(run.id)},${quote(request)},${quote(mode)},${json({ id: randomUUID(), role: "user", content, createdAt: new Date().toISOString() })}));`,
    );
  const saveTool = (run, callId = "chart") =>
    parsed(
      `SELECT to_jsonb(public.agent_cache_tool(${lease(run)},${quote(callId)},'bazi','calculation','{"gender":"male"}',${json({ content: [{ type: "text", text: "规范命盘" }], details: { 真实: true }, canonicalText: "规范命盘" })}));`,
    );

  await t.test("repeated Agent edits snapshot each selected version's complete current branch, metadata and new tail", async () => {
    const conversationId = await createConversation();
    const question = { id: "early-user", role: "user", content: "original", createdAt: "2026-01-01" };
    const answer = { id: "early-answer", role: "assistant", content: "original answer", createdAt: "2026-01-02",
      agent: { version: 1, runId: "old-run", status: "completed", parts: [{ type: "text", id: "text", text: "original answer" }] }, metadata: { kbHitCount: 2 } };
    const tail = (id) => ({ id, role: "user", content: id, createdAt: "2026-01-03" });
    const save = messages => asActor(owner, `SELECT public.replace_conversation_messages(${quote(conversationId)},${json(messages)});`);
    const history = async () => JSON.parse(await asOwner(`SELECT messages FROM public.conversations WHERE id=${quote(conversationId)};`));
    await save([question, answer, tail("original-tail")]);
    const edit = async content => {
      const id = randomUUID();
      const queued = await create(conversationId, { id, billing: "exempt", input: { ...input(id), replaceFromMessageId: question.id, userMessage: { ...question, content } } });
      const run = await claim();
      assert.equal(run.id, queued.id);
      await finish(run, "completed", { ...assistant(run.id), content: `answer:${content}`, metadata: { kbHitCount: 3 } });
      return queued;
    };
    await edit("first-edit");
    let messages = await history();
    assert.equal(messages[0].versions.length, 2);
    assert.deepEqual(messages[0].versions[0].subsequentMessages, [tail("original-tail")]);
    assert.deepEqual(messages[0].versions[0].aiAgent, answer.agent);
    assert.deepEqual(messages[0].versions[0].aiMetadata, answer.metadata);
    await save([...messages, tail("first-tail")]);
    await edit("second-edit");
    messages = await history();
    assert.equal(messages[0].versions.length, 3);
    assert.deepEqual(messages[0].versions[1].subsequentMessages, [tail("first-tail")]);
    assert.equal(messages[0].versions[1].aiContent, "answer:first-edit");
    const untouched = structuredClone(messages[0].versions[2]);
    // Select the oldest branch, extend it, then regenerate: update slot zero,
    // rather than always treating the newest version as the selected branch.
    await save([{ ...messages[0], content: question.content, currentVersionIndex: 0 }, answer, tail("original-tail"), tail("added-after-switch")]);
    const regenerated = await edit("original");
    assert.equal(regenerated.input.userMessage.currentVersionIndex, 0);
    messages = await history();
    assert.deepEqual(messages[0].versions[0].subsequentMessages, [tail("original-tail"), tail("added-after-switch")]);
    assert.deepEqual(messages[0].versions[2], untouched);
    assert.equal(messages[0].currentVersionIndex, 3);
  });

  await t.test("Agent edit tolerates legacy null versions and never drops a following user message without an assistant", async () => {
    const conversationId = await createConversation(), id = randomUUID();
    const question = { id: "legacy-user", role: "user", content: "old", versions: null, currentVersionIndex: 9999999999, createdAt: "2026-01-01" };
    const following = { id: "following-user", role: "user", content: "tail", createdAt: "2026-01-01" };
    await asActor(owner, `SELECT public.replace_conversation_messages(${quote(conversationId)},${json([question, following])});`);
    const queued = await create(conversationId, { id, billing: "exempt", input: { ...input(id), replaceFromMessageId: question.id, userMessage: { ...question, content: "new" } } });
    assert.equal(queued.input.userMessage.versions[0].aiContent, "");
    assert.deepEqual(queued.input.userMessage.versions[0].subsequentMessages, [following]);
    await finish(await claim(), "failed");
  });

  await t.test("active conversation deletion is blocked through owner/admin DELETE and graph RPC until cancellation settles once", async () => {
    for (const status of ["queued", "running", "awaiting_input", "cancelling"]) {
      const conversationId = await createConversation();
      const queued = await create(conversationId);
      let run;
      if (status !== "queued") {
        run = await claim();
        if (status === "awaiting_input") await finish(run, "awaiting_input");
        if (status === "cancelling") await asActor(owner, `SELECT public.agent_cancel_run(${quote(queued.id)});`);
      }
      const direct = `DELETE FROM public.conversations WHERE id=${quote(conversationId)};`;
      await assert.rejects(asActor(owner, direct), /AGENT_CONVERSATION_BUSY/, status);
      await assert.rejects(admin(direct), /AGENT_CONVERSATION_BUSY/, status);
      await assert.rejects(asActor(owner, `SELECT public.delete_conversation_graph(${quote(conversationId)});`), /AGENT_CONVERSATION_BUSY/, status);
      assert.equal((await get(queued.id)).billing, "metered");
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(queued.id)};`), "1");
      await asActor(owner, `SELECT public.agent_cancel_run(${quote(queued.id)});`);
      if (status === "queued" || status === "awaiting_input") run = await claim();
      const settled = await finish(run, "cancelled");
      assert.equal(settled.billing, "metered", "finishing never changes how the run is billed");
      await assert.rejects(finish(run, "cancelled"), /AGENT_LEASE_LOST/);
      assert.equal(await asActor(owner, `SELECT public.delete_conversation_graph(${quote(conversationId)});`), "t");
      assert.equal(await get(queued.id), null);
    }
  });

  await t.test("Pi Durable commits checkpoints atomically, deduplicates receipts, and consumes only placed commands", async () => {
    const nativeCheckpoint = { ...checkpoint, version: 2, durable: { engine: "pi-durable/1.5.0", seeded: true } };
    const queued = await create(await createConversation(), { checkpoint: nativeCheckpoint });
    await assert.rejects(admin("SELECT public.agent_worker_heartbeat('old-engine','pi-agent-core/1.0.2');"), /AGENT_ENGINE_UNSUPPORTED/);
    assert.equal(await parsed("SELECT to_jsonb(public.agent_claim_run('old-engine'));"), null, "unregistered workers cannot claim tasks");
    await admin("SELECT public.agent_worker_heartbeat('durable-worker','pi-durable/1.5.0');");
    const run = await claim("durable-worker");
    assert.equal(run.id, queued.id);
    const cmd = JSON.parse(await command(run, randomUUID(), "steer", "继续对比"));
    const admission = [{ type: "submission", value: { id: 2, conversationId: 1, type: "input", status: "queued", requestId: `command:${cmd.sequence}` } }];
    const placed = [{ type: "submission", value: { ...admission[0].value, status: "placed", entry: 3 } }];
    const commit = (sequence, writes, cp = nativeCheckpoint) =>
      parsed(`SELECT public.agent_durable_commit(${lease(run)},${sequence},${json(writes)},${json(cp)});`);
    assert.equal(await commit(1, admission), 1);
    assert.equal(await asOwner(`SELECT consumed FROM public.agent_run_commands WHERE run_id=${quote(run.id)};`), "f");
    const updated = { ...nativeCheckpoint, planApproved: true };
    assert.equal(await commit(2, placed, updated), 2);
    assert.equal(await asOwner(`SELECT consumed FROM public.agent_run_commands WHERE run_id=${quote(run.id)};`), "t");
    assert.equal(await commit(1, admission), 1, "lost receipt can be retried without overwriting newer metadata");
    assert.equal((await get(run.id)).checkpoint.planApproved, true);
    await assert.rejects(commit(2, admission), /AGENT_DURABLE_CONFLICT/);
    await assert.rejects(commit(4, []), /AGENT_DURABLE_CONFLICT/);
    const rows = JSON.parse(await admin(`SELECT public.agent_durable_read(${lease(run)},1);`));
    assert.deepEqual(rows, [{ sequence: 2, writes: placed }]);
    await assert.rejects(asActor(owner, `SELECT * FROM public.agent_durable_commits;`), /42501/);
    await assert.rejects(asActor(other, `SELECT public.agent_durable_read(${lease(run)},0);`), /AGENT_ADMIN_REQUIRED/);
    await asOwner(`UPDATE public.agent_runs SET lease_until=now()-interval '1 second' WHERE id=${quote(run.id)};`);
    assert.equal(await parsed("SELECT to_jsonb(public.agent_claim_run('old-engine'));"), null);
    await admin("SELECT public.agent_worker_heartbeat('durable-replacement','pi-durable/1.5.0');");
    const replacement = await claim("durable-replacement");
    assert.equal(replacement.fence, run.fence + 1);
    await assert.rejects(commit(3, []), /AGENT_LEASE_LOST/);
    await assert.rejects(admin(`SELECT public.agent_durable_read(${lease(run)},0);`), /AGENT_LEASE_LOST/);
    assert.equal(JSON.parse(await admin(`SELECT public.agent_durable_read(${lease(replacement)},0);`)).length, 2);
    await finish(replacement, "failed");
  });

  await t.test("admins read a run's task log without its content, after the run ends too; nobody else can", async () => {
    const cp = { ...checkpoint, version: 2, durable: { engine: "pi-durable/1.5.0", seeded: true } };
    const queued = await create(await createConversation(), { checkpoint: cp });
    const run = await claim("durable-worker");
    assert.equal(run.id, queued.id);
    const conversation = { type: "conversation", value: { id: 1 } };
    const question = { type: "entry", value: { id: 2, conversationId: 1, kind: "pi.input", model: [{ role: "user", content: "1990年1月15日9点，男性", timestamp: 1 }] } };
    const calls = { type: "entry", value: { id: 3, conversationId: 1, kind: "pi.assistant", model: [{ role: "assistant", content: [
      { type: "thinking", thinking: "先排盘" }, { type: "text", text: "我来排盘" },
      { type: "toolCall", id: "call-1", name: "bazi", arguments: { birthYear: 1990 } }, { type: "toolCall", id: "call-2", name: "bazi_dayun", arguments: {} },
    ] }] } };
    const result = { type: "entry", value: { id: 4, conversationId: 1, kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "call-1", toolName: "bazi", content: [{ type: "text", text: "四柱" }], isError: false }] } };
    const task = { type: "task", value: { id: 5, conversationId: 1, kind: "pi.tool", version: 2, owner: 6, background: false, abortRequested: false,
      input: { kind: "model", assistant: 3, callId: "call-1" }, state: { status: "running", checkpoint: { phase: "call" } }, memos: { asked: { question: "出生时间？" } } } };
    const submission = { type: "submission", value: { id: 7, conversationId: 1, type: "input", status: "placed", entry: 2, requestId: "initial" } };
    const doc = { type: "document.change", id: 8, content: { kind: "base", value: { private: true } } };
    await admin(`SELECT public.agent_durable_commit(${lease(run)},1,${json([conversation, question, calls])},${json(cp)});`);
    await admin(`SELECT public.agent_durable_commit(${lease(run)},2,${json([result, task, submission, doc])},${json(cp)});`);
    const log = async (after = 0, actor = admin) => JSON.parse(await actor(`SELECT public.agent_admin_task_log(${quote(run.id)},${after});`));
    const read = await log();
    assert.deepEqual(read.map(commit => commit.sequence), [1, 2]);
    assert.ok(read.every(commit => !Number.isNaN(Date.parse(commit.at))), "each commit carries its time");
    assert.deepEqual(read[0].writes, [conversation, { type: "entry", value: { id: 3, conversationId: 1, kind: "pi.assistant",
      model: [{ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bazi" }, { type: "toolCall", id: "call-2", name: "bazi_dayun" }] }] } }],
      "an entry keeps only its tool calls' ids and names, and one without calls is left out");
    const kept = { ...task.value };
    delete kept.memos;
    assert.deepEqual(read[1].writes, [{ type: "task", value: kept }, submission], "no memos, tool results or documents");
    assert.deepEqual((await log(1)).map(commit => commit.sequence), [2]);
    await assert.rejects(log(-1), /AGENT_DURABLE_CURSOR_INVALID/);
    await assert.rejects(log(0, statement => asActor(owner, statement)), /AGENT_ADMIN_REQUIRED/);
    await assert.rejects(asActor(owner, `SELECT * FROM public.agent_durable_commits WHERE run_id=${quote(run.id)};`), /42501/);
    await finish(run, "failed");
    assert.equal((await log()).length, 2, "a finished run's log stays readable");
    await asOwner(`INSERT INTO public.agent_durable_commits(run_id,sequence,writes) SELECT ${quote(run.id)},s,'[]' FROM generate_series(3,202) s;`);
    const page = await log();
    assert.deepEqual([page.length, page[0].sequence, page.at(-1).sequence], [200, 1, 200], "pages of 200 in sequence order");
    assert.deepEqual((await log(200)).map(commit => [commit.sequence, commit.writes]), [[201, []], [202, []]]);
  });

  await t.test("Pi Durable admitted input stays awaiting a human reply instead of spinning queued leases", async () => {
    const cp = { ...checkpoint, version: 2, question: "补充信息？", durable: { engine: "pi-durable/1.5.0", seeded: true } };
    await create(await createConversation(), { checkpoint: cp });
    const run = await claim("durable-worker");
    const first = JSON.parse(await command(run, randomUUID(), "follow_up", "之后比较两份命盘"));
    const submission = (cmd, id, status) => ({ type: "submission", value: { id, conversationId: 1, type: "input", status, requestId: `command:${cmd.sequence}`, ...(status === "placed" ? { entry: id + 100 } : {}) } });
    await admin(`SELECT public.agent_durable_commit(${lease(run)},1,${json([submission(first, 2, "queued")])},${json(cp)});`);
    const waiting = await finish(run, "awaiting_input", assistant(run.id), cp);
    assert.equal(waiting.status, "awaiting_input");
    assert.equal(await claim("durable-worker"), null);
    const second = JSON.parse(await command(run));
    const resumed = await claim("durable-worker");
    assert.equal(resumed.id, run.id);
    assert.equal(resumed.fence, run.fence + 1);
    await admin(`SELECT public.agent_durable_commit(${lease(resumed)},2,${json([submission(first, 2, "placed"), submission(second, 3, "placed")])},${json(cp)});`);
    await finish(resumed, "failed");
  });

  await t.test('only the current engine may heartbeat, create or claim; unsupported creation records nothing', async () => {
    const before = await runCount();
    for (const engine of ['pi-durable/1.0.4', 'pi-durable/1.1.0', 'pi-durable/1.3.0', 'pi-durable/1.4.0', 'pi-agent-core/1.0.2', 'pi-durable/9.9.9']) {
      await assert.rejects(admin(`SELECT public.agent_worker_heartbeat('unsupported',${quote(engine)});`), /AGENT_ENGINE_UNSUPPORTED/);
      await assert.rejects(create(await createConversation(), { checkpoint: { ...checkpoint, durable: { engine } } }), /AGENT_ENGINE_UNSUPPORTED/);
    }
    await assert.rejects(create(await createConversation(), { checkpoint: { ...checkpoint, version: 1 } }), /AGENT_ENGINE_UNSUPPORTED/);
    assert.equal(await runCount(), before);
    const next = await create(await createConversation());
    assert.equal(await parsed("SELECT to_jsonb(public.agent_claim_run('unsupported'));"), null);
    const current = await claim('v15-worker');
    assert.equal(current.id, next.id);
    await finish(current, 'failed');
  });

  await t.test('engine retirement fences every old active state, settles once and preserves completed history and artifacts', async () => {
    const active = [];
    for (const status of ['queued', 'running', 'awaiting_input', 'cancelling']) {
      const queued = await create(await createConversation()), run = await claim(`retire-${status}`);
      const artifact = await saveTool(run);
      await command(run, randomUUID(), 'follow_up', '旧任务待处理消息');
      const output = { ...assistant(run.id), content: status === 'running' ? '已有局部回答' : '' };
      await asOwner(`UPDATE public.agent_runs SET checkpoint=${json({ ...checkpoint, durable: { engine: 'pi-durable/1.4.0' } })},status=${quote(status)},cancel_requested=${status === 'cancelling'},public_message=${json(output)} WHERE id=${quote(queued.id)};`);
      active.push({ run, artifact });
    }
    const historical = await create(await createConversation(), { billing: "exempt" });
    await finish(await claim(), 'completed', { ...assistant(historical.id), content: '历史答复保留' });
    await asOwner(`UPDATE public.agent_runs SET checkpoint=${json({ ...checkpoint, durable: { engine: 'pi-durable/1.1.0' } })} WHERE id=${quote(historical.id)};`);
    const current = await create(await createConversation(), { billing: "exempt" });
    // seed.sql settles retired-engine runs as the system principal it seeds;
    // the principal is removed again so later contracts keep their own admins.
    const seed = await readFile(new URL('../../database/seed.sql', import.meta.url), 'utf8');
    await asOwner(seed);
    for (const { run, artifact } of active) {
      const ended = await get(run.id);
      assert.ok(['failed', 'cancelled'].includes(ended.status));
      assert.equal(ended.worker_id, null); assert.equal(ended.lease_until, null); assert.equal(ended.fence, run.fence + 1);
      assert.match(ended.public_message.agent.error, /运行版本已更新/);
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(run.id)};`), '0');
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_commands WHERE run_id=${quote(run.id)} AND NOT consumed;`), '0');
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_events WHERE run_id=${quote(run.id)} AND type IN ('failed','cancelled');`), '1');
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_artifacts WHERE id=${quote(artifact.id)};`), '1');
      const messages = JSON.parse(await asOwner(`SELECT messages FROM public.conversations WHERE id=${quote(run.conversation_id)};`));
      assert.equal(messages.at(-1).agent.status, ended.status);
      await assert.rejects(finish(run, 'failed'), /AGENT_LEASE_LOST/);
    }
    assert.equal((await get(historical.id)).public_message.content, '历史答复保留');
    assert.equal((await get(current.id)).status, 'queued');
    await asOwner(seed);
    for (const { run } of active) assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_events WHERE run_id=${quote(run.id)} AND type IN ('failed','cancelled');`), '1');
    // seed.sql keeps the system principal it created; later contracts use their own administrators.
    await finish(await claim(), 'failed');
  });

  await t.test(
    "Agent creation/dedup is atomic; active conversation and browser overwrite are fenced",
    async () => {
      const conversationId = await createConversation(),
        id = randomUUID();
      const [a, b] = await Promise.all([
        create(conversationId, { id, request: id }),
        create(conversationId, { id: randomUUID(), request: id }),
      ]);
      assert.equal(a.id, b.id);
      assert.equal(await asOwner(`SELECT count(*) FROM public.agent_runs WHERE request_id=${quote(id)};`), "1");
      await assert.rejects(create(await createConversation(), { billing: "charged" }), /23514/);
      await assert.rejects(
        create(conversationId, { request: id, hash: "different" }),
        /AGENT_REQUEST_MISMATCH/,
      );
      await assert.rejects(create(conversationId), /AGENT_CONVERSATION_BUSY/);
      assert.equal(
        await asActor(
          other,
          `SELECT count(*) FROM public.agent_runs WHERE id=${quote(a.id)};`,
        ),
        "0",
      );
      assert.equal(
        await asActor(
          owner,
          `SELECT count(*) FROM public.agent_run_credentials;`,
        ),
        "0",
      );
      await assert.rejects(
        asActor(
          owner,
          `UPDATE public.agent_runs SET status='completed' WHERE id=${quote(a.id)};`,
        ),
        /42501/,
      );
      await assert.rejects(
        asActor(owner, `SELECT public.agent_claim_run('intruder');`),
        /AGENT_ADMIN_REQUIRED/,
      );
      await assert.rejects(
        asActor(other, `SELECT public.agent_cancel_run(${quote(a.id)});`),
        /AGENT_RUN_NOT_FOUND/,
      );
      await assert.rejects(
        asActor(
          owner,
          `SELECT public.replace_conversation_messages(${quote(conversationId)},'[]');`,
        ),
        /AGENT_CONVERSATION_BUSY/,
      );
      await assert.rejects(
        asActor(
          owner,
          `UPDATE public.conversation_messages SET content='stale browser' WHERE conversation_id=${quote(conversationId)};`,
        ),
        /AGENT_CONVERSATION_BUSY/,
      );
      const claimed = await claim();
      const ended = await finish(claimed, "failed");
      assert.equal(ended.billing, "metered");
      await assert.rejects(finish(claimed, "failed"), /AGENT_LEASE_LOST/);
      assert.equal(
        await asOwner(
          `SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(a.id)};`,
        ),
        "0",
      );
    },
  );

  await t.test(
    "Agent leases exclude concurrent workers, reclaim stale work, and reject stale writes",
    async () => {
      const queued = await create(await createConversation());
      const results = await Promise.all([claim("first"), claim("second")]);
      const owners = results.filter(Boolean);
      assert.equal(owners.length, 1);
      const first = owners[0];
      assert.equal(first.id, queued.id);
      const cached = await saveTool(first);
      await asOwner(
        `UPDATE public.agent_runs SET lease_until=now()-interval '1 second' WHERE id=${quote(first.id)};`,
      );
      const second = await claim("replacement");
      assert.equal(second.id, first.id);
      assert.equal(second.fence, first.fence + 1);
      await assert.rejects(
        admin(
          `SELECT public.agent_checkpoint(${lease(first)},${json(checkpoint)},${json(assistant(first.id))},'{}',NULL);`,
        ),
        /AGENT_LEASE_LOST/,
      );
      const replay = await saveTool(second);
      assert.equal(replay.id, cached.id);
      await assert.rejects(
        admin(
          `SELECT public.agent_cache_tool(${lease(second)},'chart','bazi','calculation','{"gender":"female"}','{}');`,
        ),
        /AGENT_TOOL_CALL_MISMATCH/,
      );
      await asActor(
        owner,
        `SELECT public.agent_cancel_run(${quote(second.id)});`,
      );
      const stopped = await finish(second, "completed");
      assert.equal(stopped.status, "cancelled");
      assert.equal(stopped.billing, "metered");
    },
  );

  await t.test(
    "Agent input pause/reply keep one run; completion saves neither charts nor analysis records",
    async () => {
      const queued = await create(await createConversation());
      let run = await claim();
      assert.equal(run.id, queued.id);
      const waiting = await finish(run, "awaiting_input", assistant(run.id), {
        ...checkpoint,
        question: "出生信息？",
      });
      assert.equal(waiting.status, "awaiting_input");
      assert.equal(
        await asOwner(
          `SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(run.id)};`,
        ),
        "1",
      );
      const request = randomUUID();
      const a = JSON.parse(await command(run, request)),
        b = JSON.parse(await command(run, request));
      assert.equal(a.sequence, b.sequence);
      assert.equal(a.message.id, b.message.id);
      await assert.rejects(
        command(run, request, "reply", "different"),
        /AGENT_REQUEST_MISMATCH/,
      );
      run = await claim();
      await admin(
        `SELECT public.agent_checkpoint(${lease(run)},${json(checkpoint)},${json(assistant(run.id))},'{}',${a.sequence});`,
      );
      await saveTool(run, "final-chart");
      const result = await finish(
        run,
        "completed",
        { ...assistant(run.id), content: "可见分析" },
      );
      assert.equal(result.record_id, null);
      const durable = JSON.parse(
        await asOwner(
          `SELECT json_build_object('records',(SELECT count(*) FROM public.ming_records WHERE user_id=${quote(owner)}),'charts',(SELECT count(*) FROM public.bazi_charts WHERE user_id=${quote(owner)}),'credentials',(SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(run.id)}),'message',(SELECT messages FROM public.conversations WHERE id=${quote(run.conversation_id)}),'cursor',(SELECT max(sequence) FROM public.agent_run_events WHERE run_id=${quote(run.id)}));`,
        ),
      );
      assert.equal(durable.records, 0);
      assert.equal(durable.charts, 0, "saving a chart to the library is the user's action on the board, not settlement");
      assert.equal(durable.credentials, 0);
      assert.equal(Number(result.event_cursor), durable.cursor);
      assert.equal(
        durable.message.find((m) => m.id === result.public_message.id).agent
          .status,
        "completed",
      );
      assert.equal(result.public_message.content, "可见分析");
      assert.equal(result.public_message.agent.parts.some(part => part.type === 'artifact'), false);
      await assert.rejects(
        finish(run, "completed", result.public_message, checkpoint),
        /AGENT_LEASE_LOST/,
      );
      const columns = await asOwner(`SELECT string_agg(column_name,',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_run_artifacts';`);
      assert.equal(columns, 'args,call_id,id,kind,result,run_id,tool_name');
      for (const signature of ['agent_finish_run(uuid,text,bigint,text,jsonb,jsonb,jsonb)', 'agent_cache_tool(uuid,text,bigint,text,text,text,jsonb,jsonb,jsonb)'])
        assert.equal(await asOwner(`SELECT to_regprocedure('public.${signature}') IS NULL;`), 't', `${signature} is gone`);
    },
  );

  await t.test(
    "Agent accepted late commands are resumed before final save; the billing mode chosen at creation stays",
    async () => {
      await create(await createConversation());
      let run = await claim();
      const cmd = JSON.parse(
        await command(run, randomUUID(), "steer", "改为比较两份命盘"),
      );
      let ended = await finish(
        run,
        "completed",
        { ...assistant(run.id), content: "第一部分" },
        checkpoint,
      );
      assert.equal(ended.status, "queued");
      assert.equal(ended.record_id, null);
      assert.equal(
        await asOwner(
          `SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(run.id)};`,
        ),
        "1",
      );
      run = await claim();
      await admin(
        `SELECT public.agent_checkpoint(${lease(run)},${json(checkpoint)},${json({ ...assistant(run.id), content: "第一部分" })},'{}',${cmd.sequence});`,
      );
      await asActor(owner, `SELECT public.agent_cancel_run(${quote(run.id)});`);
      ended = await finish(run, "cancelled", {
        ...assistant(run.id),
        content: "第一部分",
      });
      assert.equal(ended.billing, "metered");
      await create(await createConversation(), { billing: "exempt" });
      run = await claim();
      ended = await finish(run, "failed");
      assert.equal(ended.billing, "exempt");
    },
  );

  await t.test(
    "Agent completion event failure rolls back status and message; retry commits once without a record",
    async () => {
      await create(await createConversation());
      const run = await claim();
      await saveTool(run, "atomic");
      const message = { ...assistant(run.id), content: "atomic analysis" };
      await asOwner(
        `CREATE FUNCTION public.fixture_agent_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id=${quote(run.id)}::uuid AND NEW.type='completed' THEN RAISE EXCEPTION 'fixture event failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_agent_event_failure BEFORE INSERT ON public.agent_run_events FOR EACH ROW EXECUTE FUNCTION public.fixture_agent_event_failure();`,
      );
      try {
        await assert.rejects(finish(run, "completed", message), /fixture event failure/);
      } finally {
        await asOwner(
          "DROP TRIGGER fixture_agent_event_failure ON public.agent_run_events; DROP FUNCTION public.fixture_agent_event_failure();",
        );
      }
      const current = await get(run.id);
      assert.equal(current.status, "running");
      assert.equal(current.record_id, null);
      assert.notEqual(current.public_message.content, "atomic analysis");
      const result = await finish(run, "completed", message);
      assert.equal(result.status, "completed");
      assert.equal(result.record_id, null);
      assert.equal(
        await asOwner(
          `SELECT count(*) FROM public.ming_records WHERE title='atomic analysis';`,
        ),
        "0",
      );
    },
  );

  await t.test(
    "Agent knowledge searches bind the leased owner, then restore admin claims",
    async () => {
      const kb = randomUUID(),
        otherKb = randomUUID();
      await asOwner(
        `INSERT INTO public.knowledge_bases(id,user_id,name) VALUES (${quote(kb)},${quote(owner)},'Agent KB'),(${quote(otherKb)},${quote(other)},'Other KB'); INSERT INTO public.knowledge_entries(kb_id,content,source_type,source_id) VALUES (${quote(kb)},'agent celestial galaxy','record',${quote(randomUUID())}),(${quote(otherKb)},'agent celestial galaxy','record',${quote(randomUUID())});`,
      );
      await create(await createConversation());
      const run = await claim();
      const search = `public.agent_search_knowledge(${lease(run)},'fts','{"p_query":"agent celestial galaxy","p_kb_ids":null,"p_limit":5}')`;
      const result = JSON.parse(
        await admin(
          `SELECT json_build_object('rows',${search},'identity',auth.uid());`,
        ),
      );
      assert.equal(result.identity, adminId);
      assert.ok(result.rows.length);
      assert.deepEqual([...new Set(result.rows.map((r) => r.kb_id))], [kb]);
      assert.deepEqual(
        JSON.parse(
          await admin(
            `SELECT public.agent_search_knowledge(${lease(run)},'fts',${json({ p_query: "agent celestial galaxy", p_kb_ids: [otherKb], p_limit: 5 })});`,
          ),
        ),
        [],
      );
      await finish(run, "failed");
    },
  );

  const questionCheckpoint = (qid, questions = [{ id: "birth", question: "出生时间", allowCustom: true, allowSkip: false }]) => ({
    ...checkpoint, question: "出生信息？", questions, questionId: qid,
  });
  const awaitingRun = async (qid = `q-${randomUUID()}`, questions) => {
    const conversationId = await createConversation();
    await create(conversationId);
    const claimed = await claim();
    const waiting = await finish(claimed, "awaiting_input", assistant(claimed.id), questionCheckpoint(qid, questions));
    assert.equal(waiting.status, "awaiting_input");
    return claimed;
  };
  const ageRun = (id) => sql(`UPDATE public.agent_runs SET updated_at=now()-interval '61 minutes' WHERE id=${quote(id)};`);
  const expire = async () => JSON.parse(await admin("SELECT public.agent_expire_awaiting_inputs(60);"));

  await t.test("an unanswered question is nudged once, then the run expires with a notice", async () => {
    let run = await awaitingRun("q1");
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 1, cancelled: 0, failed: 0 });
    assert.equal((await get(run.id)).status, "queued");
    const nudge = JSON.parse(await asOwner(
      `SELECT to_jsonb(c) FROM public.agent_run_commands c WHERE c.run_id=${quote(run.id)} AND c.request_id='ask-timeout:q1';`,
    ));
    assert.match(nudge.message.content, /用户未在 60 分钟内回答/u);
    assert.deepEqual(
      [nudge.message.metadata.agentRunId, nudge.message.metadata.agentQuestionId, nudge.message.metadata.askTimeout, nudge.message.metadata.askTimeoutMinutes, nudge.message.metadata.agentCommandMode],
      [run.id, "q1", true, 60, "reply"],
    );
    assert.deepEqual(nudge.message.metadata.agentAnswers, { birth: null });
    assert.equal(await asOwner(`SELECT count(*) FROM public.notifications WHERE user_id=${quote(owner)} AND event_key=${quote(`agent-expired:${run.id}`)};`), "0");

    // The worker consumes the notice and the model asks again; this second pause expires the run.
    run = await claim();
    await sql(`UPDATE public.agent_run_commands SET consumed=true,delivery_state='consumed' WHERE run_id=${quote(run.id)} AND request_id='ask-timeout:q1';`);
    assert.equal((await finish(run, "awaiting_input", assistant(run.id), questionCheckpoint("q2"))).status, "awaiting_input");
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 0, cancelled: 1, failed: 0 });
    const ended = await get(run.id);
    assert.deepEqual([ended.status, ended.cancel_requested, ended.public_message.agent.status], ["cancelled", true, "cancelled"]);
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_credentials WHERE run_id=${quote(run.id)};`), "0");
    assert.equal(await asOwner(`SELECT count(*) FROM public.notifications WHERE user_id=${quote(owner)} AND event_key=${quote(`agent-expired:${run.id}`)};`), "1");
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_commands WHERE run_id=${quote(run.id)} AND request_id LIKE 'ask-timeout:%';`), "1");
  });

  await t.test("the sweep is administrator-only and rejects a non-positive window", async () => {
    await assert.rejects(asActor(owner, "SELECT public.agent_expire_awaiting_inputs(60);"), /AGENT_ADMIN_REQUIRED/u);
    await assert.rejects(admin("SELECT public.agent_expire_awaiting_inputs(0);"), /AGENT_ASK_TIMEOUT_INVALID/u);
  });

  await t.test("plan approval is ended on its first timeout instead of being nudged", async () => {
    const run = await awaitingRun("plan-q", [{ id: "plan", question: "是否按这个计划执行？", allowCustom: true, allowSkip: false }]);
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 0, cancelled: 1, failed: 0 });
    assert.equal((await get(run.id)).status, "cancelled");
    assert.equal(await asOwner(`SELECT count(*) FROM public.agent_run_commands WHERE run_id=${quote(run.id)} AND request_id LIKE 'ask-timeout:%';`), "0");
  });

  await t.test("one rejected row does not starve the rest of the sweep", async () => {
    const blocked = await awaitingRun();
    const open = await awaitingRun();
    await asOwner(`INSERT INTO public.agent_run_commands(run_id,request_id,mode,message,sort_order)
      SELECT ${quote(blocked.id)},'fill-'||g,'steer',${json({ id: "fill", role: "user", content: "filler", createdAt: new Date().toISOString() })},g
      FROM generate_series(1,50) g;`);
    await ageRun(blocked.id);
    await ageRun(open.id);
    assert.deepEqual(await expire(), { nudged: 1, cancelled: 0, failed: 1 });
    assert.equal((await get(open.id)).status, "queued");
    assert.equal((await get(blocked.id)).status, "awaiting_input");
    // Later suites claim the oldest queued run; neither fixture may outlive this test.
    await asOwner(`UPDATE public.agent_runs SET status='cancelled',cancel_requested=true
      WHERE id IN (${quote(blocked.id)},${quote(open.id)}) AND status IN ('awaiting_input','queued');`);
  });

  await t.test("an expiry notice honours the owner's notification switch", async (t) => {
    const run = await awaitingRun("q1");
    t.after(async () => {
      await asOwner(`DELETE FROM public.user_settings WHERE user_id=${quote(owner)};`);
      await asOwner(`UPDATE public.agent_runs SET status='cancelled',cancel_requested=true
        WHERE id=${quote(run.id)} AND status IN ('awaiting_input','queued','running');`);
    });
    await asOwner(`INSERT INTO public.user_settings(user_id,notifications_enabled,notify_site) VALUES(${quote(owner)},false,false)
      ON CONFLICT(user_id) DO UPDATE SET notifications_enabled=false,notify_site=false;`);
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 1, cancelled: 0, failed: 0 });
    let claimed = await claim();
    await sql(`UPDATE public.agent_run_commands SET consumed=true,delivery_state='consumed' WHERE run_id=${quote(run.id)} AND request_id LIKE 'ask-timeout:%';`);
    await finish(claimed, "awaiting_input", assistant(claimed.id), questionCheckpoint("q2"));
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 0, cancelled: 1, failed: 0 });
    assert.equal(await asOwner(`SELECT count(*) FROM public.notifications WHERE user_id=${quote(owner)} AND event_key=${quote(`agent-expired:${run.id}`)};`), "0");
  });

  await t.test("a scheduled run's expiry leaves the notice to its schedule", async (t) => {
    const schedule = JSON.parse(await asActor(owner,
      `SELECT to_jsonb(public.create_agent_schedule(${quote('超时契约')},${quote('custom')},${quote('整理今天的重点。')},${json({ kind: 'daily', time: '08:00' })},${quote('Asia/Shanghai')},${json({ notify: true })})) s;`));
    const run = await awaitingRun("q1");
    t.after(async () => {
      await asOwner(`DELETE FROM public.agent_schedule_runs WHERE agent_run_id=${quote(run.id)};`);
      await asOwner(`DELETE FROM public.agent_schedules WHERE id=${quote(schedule.id)};`);
      await asOwner(`UPDATE public.agent_runs SET status='cancelled',cancel_requested=true
        WHERE id=${quote(run.id)} AND status IN ('awaiting_input','queued','running');`);
    });
    await asOwner(`INSERT INTO public.agent_schedule_runs(schedule_id,user_id,scheduled_for,status,agent_run_id)
      VALUES(${quote(schedule.id)},${quote(owner)},now(),'running',${quote(run.id)});`);
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 1, cancelled: 0, failed: 0 });
    const claimed = await claim();
    assert.equal(claimed.id, run.id);
    await sql(`UPDATE public.agent_run_commands SET consumed=true,delivery_state='consumed' WHERE run_id=${quote(run.id)} AND request_id LIKE 'ask-timeout:%';`);
    await finish(claimed, "awaiting_input", assistant(claimed.id), questionCheckpoint("q2"));
    await ageRun(run.id);
    assert.deepEqual(await expire(), { nudged: 0, cancelled: 1, failed: 0 });
    assert.equal((await get(run.id)).status, "cancelled");
    // The schedule's own notification covers it; the generic task notice would duplicate it.
    assert.equal(await asOwner(`SELECT count(*) FROM public.notifications WHERE user_id=${quote(owner)} AND event_key=${quote(`agent-expired:${run.id}`)};`), "0");
  });
}
