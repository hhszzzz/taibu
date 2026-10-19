// 本地演示数据重建：只作用于本机 Docker 演示栈的演示账号（user@taibu.local）。
// 先清空该账号的全部对话与 Agent 自动保存的记录，再按离线演示模型的 SHOWCASE 场景
// 通过真实 API 依次发起 Agent 任务，展示自主多步查看、详查、多模型协作与补充提问。
// 用法：node scripts/selfhost-showcase.mjs --project taibu-agent-1006b
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, localDocker, validateConfig, validateProject, validateResourceOwnership } from './selfhost.mjs';

/** 与 scripts/selfhost/demo.mjs 的 SHOWCASE 原文一致；按此顺序创建，最后一个在侧栏最上方。 */
const SCENARIOS = [
  { prompt: '今天心情有点低落，有什么调整状态的小建议吗？' },
  { prompt: '帮我排个八字，看看今年运势怎么样。', awaiting: true },
  { prompt: '对比一下我和对象的八字合不合：我是男，1990年1月15日9点；她是女，1995年6月20日10点30分。' },
  { prompt: '看看我的本命盘里金星和第七宫的情况（1990年1月1日12点30分生于上海），再帮我挑下个月适合嫁娶的日子。' },
  { prompt: '这份新工作 offer 要不要接？先起一课大六壬，再用六爻对照看看。' },
  { prompt: '下周要谈一个合作项目，用奇门遁甲起一局看看形势和时机。' },
  { prompt: '用紫微斗数看看我的命宫，再看看今年的迁移宫：女，1992年8月8日20点出生。' },
  { prompt: '请几位分析师一起会诊这个八字：男，1988年2月3日13点出生，重点看事业转折的时机和方向。', collaboration: true },
  { prompt: '帮我细看这个八字：男，1988年2月3日13点出生。命局里干支之间有哪些刑冲合害？五行流通顺不顺？2026 到 2030 年哪年变动最大？' },
];
const MEMBERS = [
  { name: '子平格局', model: '本地推理演示', focus: '从格局与五行流通判断事业取向', reasoningEffort: 'high' },
  { name: '干支关系复核', model: '本地深度演示', focus: '独立核对原局与流年的刑冲合害', reasoningEffort: 'max' },
  { name: '流年应期', model: '本地快速演示', focus: '扫描 2026–2030 年流年，给出应期', reasoningEffort: null },
];
const MIN_CREDITS = 60;

const index = process.argv.indexOf('--project');
assert.ok(index >= 0, 'specify the local demo project with --project');
const project = validateProject(process.argv[index + 1]);
const file = path.join(ROOT, '.taibu-local', project, 'config.json');
const stat = await lstat(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'config.json must be a private regular file');
const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
assert.equal(config.LOCAL_PROJECT, project);
assert.equal(config.DEMO_ENABLED, 'true', 'the showcase needs the offline demo model');

// 只碰本项目自己的数据库容器：先核对容器标签上的实例标识。
const env = await localDocker(), container = `${project}-db-1`;
validateResourceOwnership(execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "io.taibu.local.instance"}}', container], { env, encoding: 'utf8' }).trim(), config.LOCAL_INSTANCE_ID);
const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu'], { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const userId = sql(`SELECT id FROM auth.users WHERE email='${config.USER_EMAIL}';`);
assert.match(userId, /^[0-9a-f-]{36}$/u, 'demo account exists');

const login = await fetch(`${config.APP_ORIGIN}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: config.ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: config.USER_EMAIL, password: config.USER_PASSWORD }),
});
assert.ok(login.ok, `login: ${login.status}`);
const token = (await login.json()).access_token;
const api = async (route, init = {}) => {
  const response = await fetch(`${config.APP_ORIGIN}${route}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${route}: ${response.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  return body;
};

// 1. 清空：先取消进行中的任务（删除对话会被活动任务拦住），再逐个走删除对话的正式路径（级联任务、事件与成果）。
const active = sql(`SELECT id FROM public.agent_runs WHERE user_id='${userId}' AND status IN ('queued','running','awaiting_input','cancelling');`).split('\n').filter(Boolean);
for (const id of active) await api(`/api/agent/runs/${id}/cancel`, { method: 'POST' }).catch(error => console.warn('取消任务失败：', error.message));
for (let attempt = 0; attempt < 40 && sql(`SELECT count(*) FROM public.agent_runs WHERE user_id='${userId}' AND status IN ('queued','running','awaiting_input','cancelling');`) !== '0'; attempt++) await delay(500);
let deleted = 0;
for (;;) {
  const { conversations } = await api('/api/conversations?limit=100&offset=0');
  if (!conversations.length) break;
  for (const conversation of conversations) { await api(`/api/conversations/${conversation.id}`, { method: 'DELETE' }); deleted++; }
}
// Agent 自动保存的分析记录与「Agent 八字/紫微命盘」不随对话删除；被设为默认命盘的保留。
const removed = sql(`BEGIN;
WITH r AS (DELETE FROM public.ming_records WHERE user_id='${userId}' AND tags @> ARRAY['Agent'] RETURNING 1) SELECT 'records', count(*) FROM r;
WITH b AS (DELETE FROM public.bazi_charts WHERE user_id='${userId}' AND name='Agent 八字命盘'
  AND id NOT IN (SELECT default_bazi_chart_id FROM public.user_settings WHERE user_id='${userId}' AND default_bazi_chart_id IS NOT NULL) RETURNING 1) SELECT 'bazi', count(*) FROM b;
WITH z AS (DELETE FROM public.ziwei_charts WHERE user_id='${userId}' AND name='Agent 紫微命盘'
  AND id NOT IN (SELECT default_ziwei_chart_id FROM public.user_settings WHERE user_id='${userId}' AND default_ziwei_chart_id IS NOT NULL) RETURNING 1) SELECT 'ziwei', count(*) FROM z;
COMMIT;`);
console.log(`已清空：对话 ${deleted} 个；${removed.replaceAll('\n', '；').replaceAll('|', ' ')}`);

// 2. 额度：每个场景扣一次，不够时用 service_role 补足（只在本地库）。
const credits = Number(sql(`SELECT ai_chat_count FROM public.users WHERE id='${userId}';`));
if (credits < MIN_CREDITS) sql(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.increment_ai_chat_count('${userId}', ${MIN_CREDITS - credits});`);

// 3. 模型：主模型用本地离线演示，协作成员用三个不同的演示模型（各自按 model_key 请求，回复里报告实际模型）。
const { models } = await api('/api/models');
const modelId = name => { const found = models.find(model => model.name === name); assert.ok(found, `model ${name} is available`); return found.id; };
const main = modelId('本地离线演示');
const collaborators = MEMBERS.map((member, position) => ({
  id: `showcase-${position + 1}`, name: member.name, model: modelId(member.model), focus: member.focus,
  reasoning: member.reasoningEffort !== null, reasoningEffort: member.reasoningEffort,
}));

// 4. 重建：每个场景一个新对话，发起 Agent 任务并等它结束（补充提问停在等待回答）。
const created = [];
for (const scenario of SCENARIOS) {
  const { id: conversationId } = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: scenario.prompt.slice(0, 30), messages: [] }) });
  const run = await api('/api/agent/runs', { method: 'POST', body: JSON.stringify({
    conversationId, clientRequestId: `showcase-${randomUUID()}`,
    message: { id: randomUUID(), content: scenario.prompt, attachments: { ids: [] } },
    model: main, webEnabled: false, reasoning: true, reasoningEffort: 'medium',
    collaborators: scenario.collaboration ? collaborators : [],
  }) });
  const expected = scenario.awaiting ? 'awaiting_input' : 'completed';
  let status = run.status;
  for (let attempt = 0; attempt < 480 && status !== expected; attempt++) {
    assert.ok(!['failed', 'cancelled', 'completed', 'awaiting_input'].includes(status) || status === expected, `${scenario.prompt.slice(0, 16)}… ended as ${status}`);
    await delay(250);
    status = (await api(`/api/agent/runs/${run.id}`)).status;
  }
  assert.equal(status, expected, `${scenario.prompt.slice(0, 16)}… reaches ${expected}`);
  const finished = await api(`/api/agent/runs/${run.id}`);
  const tools = (finished.message.agent?.parts ?? []).filter(part => part.type === 'tool');
  created.push({ conversationId, prompt: scenario.prompt, status, tools: tools.length });
  console.log(`✓ ${scenario.prompt.slice(0, 24)}…  ${status}，工具调用 ${tools.length} 次`);
}
console.log(`\n演示数据已重建（${created.length} 个对话），打开 ${config.APP_ORIGIN}/chat 查看：`);
for (const item of [...created].reverse()) console.log(`- ${config.APP_ORIGIN}/chat?id=${item.conversationId}  ${item.prompt.slice(0, 28)}…`);
