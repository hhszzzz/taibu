#!/usr/bin/env node
// Seeds a local self-hosted stack with demo accounts and sample content.
//
//   node scripts/seed-local-demo.mjs [--project taibu-v2] [--password '...']
//
// The stack must be running (`pnpm local:up`). Credentials are read from the
// private .taibu-local directory and never printed; only the demo password you
// choose here is shown so you can sign in. Demo attachment files are written
// into the stack's file volume through its web container.
//
// Re-running replaces the three demo accounts and everything that hangs off
// them. Real accounts you registered yourself are untouched. The Agent
// conversations come from seed-local-demo-agent.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { buildAgentDemo } from './seed-local-demo-agent.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const project = option('--project', 'taibu-v2');
const password = option('--password', 'TaibuLocal2026!');
if (password.length < 8) throw new Error('--password must be at least 8 characters');

const projectDir = path.join(root, '.taibu-local', project);
const parseEnv = (file) => {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
};
const composeEnv = parseEnv(path.join(projectDir, 'compose.env'));
const dbEnv = parseEnv(path.join(projectDir, 'env', 'db.env'));
const redisEnv = parseEnv(path.join(projectDir, 'env', 'redis.env'));
const port = composeEnv.DB_HOST_PORT || '54329';
const databaseUrl = `postgres://postgres:${encodeURIComponent(dbEnv.POSTGRES_PASSWORD ?? '')}@127.0.0.1:${port}/taibu`;

const ADMIN = '11111111-1111-4111-8111-111111111111';
const DEMO = '22222222-2222-4222-8222-222222222222';
const NEWBIE = '33333333-3333-4333-8333-333333333333';
const IDS = [ADMIN, DEMO, NEWBIE];

const hash = await bcrypt.hash(password, 10);
const q = (value) => (value === null || value === undefined
  ? 'null'
  : `'${String(value).replaceAll("'", "''")}'`);
const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
const at = (ms) => q(new Date(ms).toISOString());
const now = Date.now();
const DAY = 86_400_000;

const users = [
  { id: ADMIN, email: 'admin@taibu.local', name: '管理员', nickname: '太卜管理员', membership: 'pro', credits: 9999, admin: true },
  { id: DEMO, email: 'demo@taibu.local', name: '演示用户', nickname: '阿卜', membership: 'plus', credits: 300, admin: false },
  { id: NEWBIE, email: 'newbie@taibu.local', name: '新用户', nickname: '初来乍到', membership: 'free', credits: 5, admin: false },
];

const plainConversations = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    user: DEMO,
    title: '最近工作压力有点大',
    messages: [
      ['user', '最近工作压力有点大，晚上总是睡不好，想找人聊聊。'],
      ['assistant', '先别急着解决所有问题。可以试着把压力拆成三件具体的事：今天必须完成的、这周能推进的、可以暂时放下的。你现在最放不下的是哪一件？'],
      ['user', '大概是下周的汇报，怕讲不好。'],
      ['assistant', '那就只准备汇报这一件事：列出三个必须讲清楚的结论，每个结论配一条证据。剩下的时间留给休息，而不是反复改稿。'],
    ],
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    user: DEMO,
    title: '八字里的日主是什么意思',
    messages: [
      ['user', '八字里的“日主”到底看什么？'],
      ['assistant', '日主就是日柱的天干，代表命局以谁为中心来论强弱和取用。它不决定吉凶，只提供一个观察角度：先看月令得不得气，再看有没有根、有没有生扶。'],
      ['user', '那日主弱就一定不好吗？'],
      ['assistant', '不是。强弱只是结构描述。弱而有印比成势、或从弱成格，都可以是好局；关键在流通与用神是否到位。'],
    ],
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    user: DEMO,
    title: '周末去哪里散心比较好',
    messages: [
      ['user', '这周末想出去走走，不想跑太远。'],
      ['assistant', '给你两个方向：一是近郊有水的地方，走路半小时以内，适合放空；二是有旧街区和书店的小城，节奏慢、补给方便。你更想安静还是想有点烟火气？'],
      ['user', '想安静一点。'],
      ['assistant', '那就选水边。早上出发，午后回来，留半天给自己恢复，不要把周末塞满。'],
    ],
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000004',
    user: ADMIN,
    title: '管理员测试会话',
    messages: [
      ['user', '这是一条管理员账号的测试消息。'],
      ['assistant', '收到。这个会话用于验证管理端的会话查看与导出功能。'],
    ],
  },
];

const BAZI_CHART = 'dddddddd-0000-4000-8000-000000000001';
// Test models for the model menu: free/Plus/Pro tiers, reasoning on and off, both reasoning-effort
// wire formats and vision. They attach to the newapi gateway; without NEWAPI_API_KEY the menu still
// shows them (and their effort levels) but sending reports the missing key.
const TEST_GATEWAY = '99999999-7000-4000-8000-000000000000';
const TEST_MODELS = [
  { id: '99999999-7000-4000-8000-000000000001', key: 'deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'deepseek', tier: 'free', reasoningTier: null, reasoning: false, effortFormat: null, effort: null, vision: false, reasoningDefault: false, sort: 10, description: '免费档；不推理，用于对照。' },
  { id: '99999999-7000-4000-8000-000000000002', key: 'kimi-k2.5', name: 'Kimi K2.5', vendor: 'moonshot', tier: 'free', reasoningTier: 'free', reasoning: true, effortFormat: 'reasoning_effort', effort: 'medium', vision: false, reasoningDefault: true, sort: 20, description: '免费档的推理模型（reasoning_effort），选中即开启思考。' },
  { id: '99999999-7000-4000-8000-000000000003', key: 'glm-4.7', name: 'GLM-4.7', vendor: 'glm', tier: 'free', reasoningTier: 'free', reasoning: true, effortFormat: 'reasoning_object', effort: 'high', vision: false, reasoningDefault: false, sort: 30, description: '免费档的推理模型（reasoning 对象），默认高。' },
  { id: '99999999-7000-4000-8000-000000000004', key: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'anthropic', tier: 'plus', reasoningTier: 'plus', reasoning: true, effortFormat: 'reasoning_effort', effort: 'medium', vision: true, reasoningDefault: false, sort: 40, description: 'Plus 档；支持图片与思考等级，默认中等。' },
  { id: '99999999-7000-4000-8000-000000000005', key: 'gemini-3', name: 'Gemini 3 Pro', vendor: 'google', tier: 'plus', reasoningTier: 'plus', reasoning: true, effortFormat: 'reasoning_effort', effort: 'high', vision: true, reasoningDefault: false, sort: 50, description: 'Plus 档；支持图片与思考等级，默认高。' },
  { id: '99999999-7000-4000-8000-000000000006', key: 'gpt-5.1', name: 'GPT-5.1', vendor: 'openai', tier: 'pro', reasoningTier: 'pro', reasoning: true, effortFormat: 'reasoning_object', effort: 'xhigh', vision: true, reasoningDefault: true, sort: 60, description: 'Pro 档；用于检查会员限制，默认超高。' },
];
const agentDemo = await buildAgentDemo({ root, baziChartId: BAZI_CHART, plainConversations, now });
// Private attachments are stored as the upload route stores them: `agent-attachments/<user>/<id>` in the file volume.
const attachmentRows = agentDemo.attachments.map((item) => {
  const bytes = Buffer.from(item.text, 'utf-8');
  return { ...item, bytes, objectPath: `${DEMO}/${item.id}`, sha256: createHash('sha256').update(bytes).digest('hex') };
});

const records = [
  ['近郊水库散步', '风不大，沿堤走了四十分钟，回来睡得很好。', 'life', ['散步', '睡眠'], '2026-10-18'],
  ['汇报提纲', '只保留三个结论：现状、方案、需要的支持。', 'work', ['汇报'], '2026-10-21'],
  ['读书摘记', '“先把问题写清楚，答案会自己浮出来。”', 'general', ['阅读'], '2026-10-23'],
];
// Moods are NOTE_MOODS values (src/lib/records.ts).
const notes = [
  ['2026-10-22', 'peaceful', '今天把手机放在另一个房间，专注时间明显变长。'],
  ['2026-10-23', 'anxious', '睡得晚，但早上还是按计划起来了。'],
];

const statements = [];
const idArray = `array[${IDS.map(q).join(', ')}]::uuid[]`;
// Most business FKs to public.users are NO ACTION, so the child rows must go
// first. Community rows have their own FKs between them, hence the fixed order.
statements.push(`
-- Acts as the schema owner so the entitlement guard accepts demo entitlements,
-- and as the Agent writer so the busy-conversation guards let the seed replace
-- a conversation whose demo task is waiting for an answer.
set local role taibu_owner;
set local search_path = public, identity, pg_catalog;
set local taibu.agent_write = 'true';
delete from public.community_comments where user_id = any(${idArray});
delete from public.community_votes where user_id = any(${idArray});
delete from public.community_reports where reporter_id = any(${idArray}) or reviewed_by = any(${idArray});
delete from public.community_posts where user_id = any(${idArray});
delete from public.activation_keys where used_by = any(${idArray}) or created_by = any(${idArray});
delete from public.announcements where content like '本地演示环境已就绪%' or content like '社区与命盘记录已放入示例数据%';
-- Test models and their bindings; the gateway row stays when someone configured their own newapi gateway.
delete from public.ai_model_gateway_bindings where model_id = any(array[${TEST_MODELS.map(model => q(model.id)).join(', ')}]::uuid[]) or gateway_id = ${q(TEST_GATEWAY)};
delete from public.ai_models where id = any(array[${TEST_MODELS.map(model => q(model.id)).join(', ')}]::uuid[]);
delete from public.ai_gateways where id = ${q(TEST_GATEWAY)};
-- Memories before runs (clearing their source run is an update the memory guard
-- only allows the owner), runs before conversations (a waiting task keeps its
-- conversation from being deleted).
delete from public.user_agent_memory where user_id = any(${idArray});
delete from public.agent_runs where user_id = any(${idArray});
delete from public.conversations where user_id = any(${idArray});
-- Settings point at the default charts, so they go before the charts.
delete from public.user_settings where user_id = any(${idArray});
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.users'::regclass and array_length(c.conkey, 1) = 1
  loop
    execute format('delete from %s where %I = any(%L::uuid[])', r.tbl, r.col, ${q(`{${IDS.join(',')}}`)});
  end loop;
end $$;
delete from identity.users where id = any(${idArray});`);

for (const user of users) {
  statements.push(`insert into identity.users (id, email, email_verified, name)
    values (${q(user.id)}, ${q(user.email)}, true, ${q(user.name)});`);
  statements.push(`insert into identity.accounts (user_id, account_id, provider_id, password)
    values (${q(user.id)}, ${q(user.id)}, 'credential', ${q(hash)});`);
  statements.push(`update public.users set nickname = ${q(user.nickname)}, membership = ${q(user.membership)},
    ai_chat_count = ${user.credits}, is_admin = ${user.admin} where id = ${q(user.id)};`);
  statements.push(`insert into public.user_settings (user_id, custom_instructions, language)
    values (${q(user.id)}, ${q('这是本地演示账号，可以随意修改设置。')}, 'zh')
    on conflict (user_id) do update set custom_instructions = excluded.custom_instructions;`);
}

// Model menu entries. The gateway keeps whatever base URL a real one already has; ours takes NEWAPI_BASE_URL
// from the environment (selfhost passes NEWAPI_BASE_URL/NEWAPI_API_KEY through to the stack).
statements.push(`insert into public.ai_gateways (id, gateway_key, display_name, base_url, api_key_env_var, transport, is_enabled, notes)
  values (${q(TEST_GATEWAY)}, 'newapi', '本地测试网关', ${q(process.env.NEWAPI_BASE_URL || 'http://newapi.local')}, 'NEWAPI_API_KEY', 'openai_compatible', true,
    ${q('本地演示用：把 base_url 改成可用的 NewAPI 地址，并在启动环境里提供 NEWAPI_API_KEY 后，测试模型即可真正调用。')})
  on conflict (gateway_key) do nothing;`);
for (const model of TEST_MODELS) {
  statements.push(`insert into public.ai_models
    (id, model_key, display_name, vendor, is_enabled, sort_order, required_tier, supports_reasoning, reasoning_required_tier,
     is_reasoning_default, supports_vision, default_temperature, default_max_tokens, description, usage_type, routing_mode,
     default_reasoning_effort, reasoning_effort_format)
    values (${q(model.id)}, ${q(model.key)}, ${q(model.name)}, ${q(model.vendor)}, true, ${model.sort}, ${q(model.tier)}, ${model.reasoning},
      ${q(model.reasoningTier)}, ${model.reasoningDefault}, ${model.vision}, 0.7, 8192, ${q(`本地测试模型：${model.description}`)}, 'chat', 'auto',
      ${q(model.effort)}, ${q(model.effortFormat)});`);
}
statements.push(`insert into public.ai_model_gateway_bindings (model_id, gateway_id, model_id_override, is_enabled, priority)
  select model.id, gateway.id, null, true, 1
  from public.ai_models model, public.ai_gateways gateway
  where model.id = any(array[${TEST_MODELS.map(model => q(model.id)).join(', ')}]::uuid[]) and gateway.gateway_key = 'newapi'
  on conflict (model_id, gateway_id) do nothing;`);

statements.push(`insert into public.bazi_charts (id, user_id, name, gender, birth_date, birth_time, birth_place, longitude, created_at)
  values (${q(BAZI_CHART)}, ${q(DEMO)}, ${q('演示命盘')}, 'male', '1990-01-15', '09:00', '上海市', 121.47, ${at(now - 26 * 3_600_000)});`);
statements.push(`insert into public.ziwei_charts (user_id, name, gender, birth_date, birth_time, birth_place, longitude)
  values (${q(DEMO)}, ${q('演示紫微')}, 'female', '1992-08-08', '20:00', '杭州市', 120.15);`);
// Attachments before the conversations that send them: saving the messages binds each file to its conversation.
for (const item of attachmentRows) {
  statements.push(`insert into public.agent_attachments (id, user_id, object_path, name, kind, mime_type, size, sha256, status)
    values (${q(item.id)}, ${q(DEMO)}, ${q(item.objectPath)}, ${q(item.name)}, 'text', 'text/plain', ${item.bytes.length}, ${q(item.sha256)}, 'ready');`);
}
// Long-term memory on, a profile, and the saved bazi as the default chart: what the demo tasks read.
statements.push(`update public.user_settings set
    chat_preferences = chat_preferences || ${json({ memoryEnabled: true })},
    user_profile = ${json({ identity: '互联网产品经理，正在考虑转向更有决策权的岗位' })},
    default_bazi_chart_id = ${q(BAZI_CHART)}
  where user_id = ${q(DEMO)};`);

/** A conversation and its messages; `conversations.messages` mirrors the rows as replace_conversation_messages writes them. */
const insertConversation = ({ id, user, title, createdAt, updatedAt, messages }) => {
  const chatMessages = messages.map((message) => ({
    id: message.messageId, role: message.role, content: message.content, createdAt: new Date(message.createdAt).toISOString(), ...(message.metadata ?? {}),
  }));
  statements.push(`insert into public.conversations (id, user_id, title, source_type, messages, created_at, updated_at)
    values (${q(id)}, ${q(user)}, ${q(title)}, 'chat', ${json(chatMessages)}, ${at(createdAt)}, ${at(updatedAt)});`);
  for (const message of messages) {
    statements.push(`insert into public.conversation_messages (conversation_id, sequence, message_id, role, content, metadata, created_at)
      values (${q(id)}, ${message.sequence}, ${q(message.messageId)}, ${q(message.role)}, ${q(message.content)},
        ${json(message.metadata ?? {})}, ${at(message.createdAt)});`);
  }
};

plainConversations.forEach((conversation, index) => {
  const start = now - (index + 1) * DAY;
  insertConversation({
    id: conversation.id, user: conversation.user, title: conversation.title, createdAt: start, updatedAt: start + conversation.messages.length * 30_000,
    messages: conversation.messages.map(([role, content], messageIndex) => ({
      sequence: messageIndex, messageId: `${conversation.id}-${messageIndex + 1}`, role, content, metadata: {}, createdAt: start + messageIndex * 30_000,
    })),
  });
});

for (const conversation of agentDemo.conversations) {
  insertConversation({ ...conversation, user: DEMO });
  for (const run of conversation.runs) {
    statements.push(`insert into public.agent_runs
      (id, user_id, conversation_id, request_id, request_hash, status, input, checkpoint, public_message, billing, fence, created_at, updated_at)
      values (${q(run.id)}, ${q(DEMO)}, ${q(conversation.id)}, ${q(`demo-${run.id}`)}, ${q('demo')}, ${q(run.status)},
        ${json(run.input)}, ${json(run.checkpoint)}, ${json(run.publicMessage)}, ${q(run.billing)}, 0, ${at(run.createdAt)}, ${at(run.updatedAt)});`);
  }
}
for (const artifact of agentDemo.artifacts) {
  statements.push(`insert into public.agent_run_artifacts (id, run_id, call_id, tool_name, kind, args, result)
    values (${q(artifact.id)}, ${q(artifact.runId)}, ${q(artifact.callId)}, ${q(artifact.toolName)}, ${q(artifact.kind)}, ${json(artifact.args)}, ${json(artifact.result)});`);
}
// The memory guard only lets the owner (or an admin) write memories.
statements.push(`select set_config('request.jwt.claims', ${q(JSON.stringify({ sub: DEMO }))}, true);`);
for (const memory of agentDemo.memories) {
  statements.push(`insert into public.user_agent_memory (id, user_id, title, content, kind, source_run_id, source_text, created_at)
    values (${q(memory.id)}, ${q(DEMO)}, ${q(memory.title)}, ${q(memory.content)}, ${q(memory.kind)}, ${q(memory.sourceRunId)}, ${q(memory.sourceText)}, ${q(memory.updated_at)});`);
}
statements.push(`select set_config('request.jwt.claims', '', true);`);
// The life event the archive task recorded (agent_archive_event writes it with the entry's derived ID).
for (const record of agentDemo.records) {
  statements.push(`insert into public.ming_records (id, user_id, title, content, category, tags, event_date, source_run_id)
    values (${q(record.id)}, ${q(DEMO)}, ${q(record.title)}, ${q(record.content)}, ${q(record.category)}, array[${record.tags.map(q).join(', ')}]::text[], ${q(record.eventDate)}, ${q(record.sourceRunId)});`);
}

records.forEach(([title, content, category, tags, date], index) => {
  statements.push(`insert into public.ming_records (user_id, title, content, category, tags, event_date, is_pinned)
    values (${q(DEMO)}, ${q(title)}, ${q(content)}, ${q(category)}, array[${tags.map(q).join(', ')}]::text[], ${q(date)}, ${index === 0});`);
});
notes.forEach(([date, mood, content]) => {
  statements.push(`insert into public.ming_notes (user_id, note_date, mood, content)
    values (${q(DEMO)}, ${q(date)}, ${q(mood)}, ${q(content)});`);
});

const posts = [
  ['aaaaaaaa-bbbb-4000-8000-000000000001', DEMO, '第一次看八字，应该先看什么？', '刚接触命理，书里说的“月令”“用神”有点绕，有什么入门的顺序吗？', 'question', ['入门'], 42, 3],
  ['aaaaaaaa-bbbb-4000-8000-000000000002', ADMIN, '社区使用说明', '这里可以提问、分享学习笔记。请勿发布个人隐私与付费咨询广告。', 'general', ['公告'], 128, 5],
  ['aaaaaaaa-bbbb-4000-8000-000000000003', NEWBIE, '记录一次成功的早睡', '连续三天十一点前睡了，白天精神好很多，来打卡。', 'general', ['打卡'], 17, 1],
];
posts.forEach(([id, user, title, content, category, tags, views, votes]) => {
  statements.push(`insert into public.community_posts
    (id, user_id, title, content, category, tags, view_count, upvote_count, comment_count)
    values (${q(id)}, ${q(user)}, ${q(title)}, ${q(content)}, ${q(category)}, array[${tags.map(q).join(', ')}]::text[],
      ${views}, ${votes}, 1);`);
  statements.push(`insert into public.community_votes (target_type, target_id, user_id, vote_type)
    values ('post', ${q(id)}, ${q(user === DEMO ? ADMIN : DEMO)}, 'up');`);
});
statements.push(`insert into public.community_comments (post_id, user_id, content)
  values (${q(posts[0][0])}, ${q(ADMIN)}, '先看日主和月令的关系，再学十神。别一上来背神煞。');`);
statements.push(`insert into public.community_comments (post_id, user_id, content)
  values (${q(posts[2][0])}, ${q(DEMO)}, '恭喜，保持住。');`);

statements.push(`insert into public.announcements (content, published_at)
  values ('本地演示环境已就绪：admin@taibu.local / demo@taibu.local / newbie@taibu.local 均可登录。', now() - interval '2 hours');`);
statements.push(`insert into public.announcements (content, published_at)
  values ('社区与命盘记录已放入示例数据，可随时删除。', now() - interval '1 day');`);

statements.push(`insert into public.notifications (user_id, type, title, content, link)
  values (${q(DEMO)}, 'system', '欢迎回来', '这是本地演示环境的示例通知。', '/user/notifications');`);
statements.push(`insert into public.notifications (user_id, type, title, content, link)
  values (${q(DEMO)}, 'announcement', '演示数据已加载', ${q(`共 ${plainConversations.length - 1 + agentDemo.conversations.length} 个会话、3 条记录、2 篇笔记。`)}, '/records');`);

statements.push(`insert into public.credit_transactions (user_id, amount, type, source, description, balance_after)
  values (${q(DEMO)}, 300, 'earn', 'demo', '本地演示初始积分', 300);`);
statements.push(`insert into public.credit_transactions (user_id, amount, type, source, description, balance_after)
  values (${q(DEMO)}, -20, 'spend', 'chat', '示例消费', 280);`);
statements.push(`insert into public.credit_transactions (user_id, amount, type, source, description, balance_after)
  values (${q(DEMO)}, 20, 'refund', 'chat', '示例退回', 300);`);
statements.push(`insert into public.daily_checkins (user_id, checkin_date, reward_credits)
  values (${q(DEMO)}, current_date, 2) on conflict do nothing;`);

if (attachmentRows.length) {
  const web = execFileSync('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=web'], { encoding: 'utf8' }).trim().split('\n')[0];
  if (!web) throw new Error(`the ${project} web container is not running`);
  for (const item of attachmentRows) {
    const file = `/data/files/agent-attachments/${item.objectPath}`;
    execFileSync('docker', ['exec', '-i', web, 'sh', '-c', 'umask 027 && mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', file], { input: item.bytes });
  }
}

const client = new pg.Client({ connectionString: databaseUrl, application_name: 'taibu-demo-seed' });
await client.connect();
try {
  await client.query('begin');
  for (const statement of statements) await client.query(statement);
  await client.query('commit');
  const counts = await client.query(`select
      (select count(*) from public.conversations where user_id = $1) as conversations,
      (select count(*) from public.conversation_messages cm join public.conversations c on c.id = cm.conversation_id where c.user_id = $1) as messages,
      (select count(*) from public.agent_runs where user_id = $1) as agent_runs,
      (select count(*) from public.agent_run_artifacts a join public.agent_runs r on r.id = a.run_id where r.user_id = $1) as agent_artifacts,
      (select count(*) from public.ming_records where user_id = $1) as records,
      (select count(*) from public.ai_models where id = any($2::uuid[])) as test_models`, [DEMO, TEST_MODELS.map(model => model.id)]);
  console.log(`[seed] demo accounts: admin@taibu.local, demo@taibu.local, newbie@taibu.local`);
  console.log(`[seed] password: ${password}`);
  console.log(`[seed] demo content: ${JSON.stringify(counts.rows[0])}`);
  // The model catalog is cached in Redis and mirrored in each process; drop it so the menu sees the new rows now.
  const redis = execFileSync('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=redis'], { encoding: 'utf8' }).trim().split('\n')[0];
  if (redis) {
    const cli = (...args) => execFileSync('docker', ['exec', '-e', `REDISCLI_AUTH=${redisEnv.REDIS_PASSWORD ?? ''}`, redis, 'redis-cli', '--no-auth-warning', ...args], { encoding: 'utf8' });
    cli('del', 'taibu:cache:v1:ai-models');
    cli('publish', 'taibu:cache:invalidate', 'ai-models');
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
