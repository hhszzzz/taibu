import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeTool, buildToolSuccessPayload, listToolDefinitions } from 'taibu-core/mcp';
import type { AgentPart } from '../lib/agent/types';
import type { ChatMessage } from '../types';
import { AGENT_SKILL_TOOLS, getAgentToolFamily, isAgentChartTool } from '../lib/agent/tool-catalog';
import { describeOverviewFacts } from '../components/chat/agent/presentation';
import { getAgentAttachmentRead, getAgentCalculation, getAgentChart, getAgentMemories, getAgentMethod, getAgentToolQuestions, type AgentToolPart } from '../lib/agent/tool-presentation';
import {
  buildAgentWorkspace, getAgentQuestionAnswers, getAgentToolQuestionIds, getAgentWorkspaceAutoOpenEvent, getAgentWorkspaceFollowTarget, getAgentWorkspaceLocation,
  getAgentWorkspaceSections, isAgentRunWorking, resolveAgentWorkspaceLocation,
} from '../lib/agent/workspace';
import { loadAnalysisMethod } from '../lib/agent/methods.server';

const tool = (id: string, name: string, extra: Partial<AgentToolPart> = {}): AgentToolPart => ({ type: 'tool', id, name, title: name, status: 'completed', ...extra });
const workspace = (parts: AgentPart[], attachmentIds: string[] = []) => buildAgentWorkspace({ parts, artifacts: [], attachmentIds });

async function coreResult(name: string, extra: Record<string, unknown> = {}) {
  const definition = listToolDefinitions().find(item => item.name === name)!;
  const payload = buildToolSuccessPayload(name, await executeTool(name, { ...(definition.inputSchema.examples![0] as Record<string, unknown>), ...extra }),
    extra.detailLevel ? { detailLevel: extra.detailLevel as 'default' | 'more' | 'full' } : undefined);
  return { output: { artifactId: randomUUID(), result: payload.structuredContent }, canonicalText: payload.content.map(part => part.text).join('\n') };
}

test('notes, earlier conversations and the archive each open one page that keeps every call of its kind', () => {
  const model = workspace([
    tool('n1', 'read_user_notes'), tool('h1', 'search_conversations'), tool('n2', 'read_user_notes'),
    tool('e1', 'record_user_event'), tool('p1', 'propose_archive_entry'),
  ]);
  const page = (id: string) => model.resources.find(resource => resource.toolIds.includes(id));
  assert.deepEqual([page('n1')?.view, page('n1')?.title, page('n1')?.toolIds], ['notes', '每日笔记', ['n1', 'n2']], 'a later read opens the same page');
  assert.deepEqual([page('h1')?.view, page('h1')?.title], ['history', '以往对话']);
  assert.deepEqual([page('e1')?.view, page('e1')?.title, page('e1')?.family], ['archive', '档案', 'archive']);
  assert.equal(page('p1'), page('e1'), 'recorded events and proposed cards share the archive page, where the cards are saved');
  for (const id of ['n1', 'h1', 'e1', 'p1']) assert.equal(model.locations.get(id), page(id)?.id, id);
});

test('every tool family reaches a workspace location, including external and unknown tools', () => {
  const names = [...listToolDefinitions().map(item => item.name), 'inspect_chart', 'web_search', 'search_knowledge', 'list_user_data', 'read_user_data',
    'read_user_profile', 'read_attachment', 'load_skill', 'read_skill_file', 'ask_user', 'parallel_analysis',
    'read_user_memory', 'remember_user_fact', 'select_final_artifacts', 'codemode', 'mcp__archive__lookup', 'retired_tool'];
  const model = workspace(names.map((name, index) => tool(`call-${index}`, name, { status: 'running', input: name === 'read_attachment' ? { id: randomUUID() } : {} })));
  for (const [index, name] of names.entries()) {
    const location = model.locations.get(`call-${index}`);
    assert.ok(location, `${name} has a workspace location`);
    assert.equal(resolveAgentWorkspaceLocation(model, location), location);
  }
  // 任务清单只显示在聊天的进度条里，不再占用工作区标签。
  const plan = workspace([tool('plan', 'todo_write')]);
  assert.equal(plan.locations.get('plan'), undefined);
  // A step of a retired tool in an earlier answer opens as a plain tool view.
  assert.equal(model.resources.find(resource => resource.toolIds.includes(`call-${names.indexOf('select_final_artifacts')}`))?.view, 'tool');
  const external = model.resources.find(resource => resource.toolIds.includes(`call-${names.indexOf('mcp__archive__lookup')}`))!;
  assert.deepEqual([external.view, external.family], ['tool', 'external']);
  assert.equal(model.resources.find(resource => resource.toolIds.includes(`call-${names.indexOf('retired_tool')}`))?.view, 'tool');
});

test('repeated reads of one chart share a tab and focus follows the reading the model looks at', async () => {
  const bazi = await coreResult('bazi');
  const artifact = bazi.output.artifactId, saved = randomUUID();
  const calculated = tool('calc', 'bazi', { ...bazi, title: '八字排盘' });
  const inspected = tool('inspect', 'inspect_chart', { input: { reference: 'artifact:' + artifact }, output: { chartReference: 'artifact:' + artifact, chartKind: 'bazi', result: bazi.output.result } });
  const focused = tool('focus', 'focus_chart', { output: { chartFocus: { version: 1, reference: 'artifact:' + artifact, targetIds: ['bazi:cell:2:0'], includeRelated: true, caption: '日主' } } });
  const savedRead = tool('saved-inspect', 'inspect_chart', { status: 'running', input: { reference: 'bazi_chart:' + saved } });
  const savedFocus = tool('saved-focus', 'focus_chart', { status: 'running', input: { reference: 'BAZI_CHART:' + saved.toUpperCase() } });
  const plan = tool('plan', 'todo_write', { output: { revision: 1, items: [] } });
  const model = workspace([calculated, inspected, focused, savedRead, savedFocus, plan]);
  const charts = model.resources.filter(resource => resource.view === 'chart');
  assert.deepEqual(charts.map(resource => [resource.id, resource.title, resource.toolIds]), [
    ['tool:calc', '八字命盘', ['calc', 'inspect', 'focus']],
    ['tool:saved-inspect', '八字命盘', ['saved-inspect', 'saved-focus']],
  ]);
  assert.equal(resolveAgentWorkspaceLocation(model, 'tool:inspect'), 'tool:calc', 'pinning an inspection opens the chart tab');
  assert.equal(getAgentWorkspaceFollowTarget(model), 'tool:saved-inspect', 'plans never pull the panel away from the chart');
  assert.equal(getAgentWorkspaceFollowTarget(workspace([plan])), null);
  const pending = workspace([tool('pending', 'inspect_chart', { status: 'running', title: '查看命盘', input: { reference: 'artifact:' + artifact } }), inspected]);
  assert.deepEqual(pending.resources.map(resource => [resource.id, resource.title]), [['tool:pending', '八字命盘']], 'the tab takes the chart title once the reading arrives');
  const orphan = workspace([tool('focus-only', 'focus_chart', { input: { reference: 'not a reference' } })]);
  assert.deepEqual(orphan.resources.map(resource => [resource.id, resource.view]), [['tool:focus-only', 'tool']]);
});

test('searches share the evidence view; records, attachments, methods and memories merge by identity', () => {
  const record = randomUUID(), attachment = randomUUID(), card = loadAnalysisMethod('bazi');
  const method = (id: string) => tool(id, AGENT_SKILL_TOOLS.load, {
    input: { name: 'bazi' }, output: { name: 'bazi', version: 0, scope: 'builtin', files: [], method: card },
  });
  const model = workspace([
    tool('web', 'web_search', { input: { query: '庚金' }, output: [{ title: '来源', url: 'https://example.com', content: '摘要' }] }),
    tool('kb', 'search_knowledge', { input: { query: '月令' }, output: [] }),
    tool('list', 'list_user_data', { output: { items: [{ id: record, type: 'bazi_chart', name: '本人', preview: '己巳 丁丑' }], errors: [] } }),
    tool('read-1', 'read_user_data', { input: { type: 'bazi_chart', id: record } }),
    tool('read-2', 'read_user_data', { input: { type: 'bazi_chart', id: record } }),
    tool('attachment', 'read_attachment', { input: { id: attachment }, output: { id: attachment, name: '手相说明.txt', kind: 'text', text: '掌纹', offset: 0, total: 2, nextOffset: null } }),
    method('method-1'), method('method-2'),
    tool('memory-read', 'read_user_memory', { output: [] }),
    tool('memory-write', 'remember_user_fact', { status: 'failed' }),
  ], [attachment]);
  const by = (id: string) => model.resources.find(resource => resource.id === id);
  assert.deepEqual(by('evidence')?.toolIds, ['web', 'kb']);
  assert.equal(resolveAgentWorkspaceLocation(model, 'source:web:0'), 'evidence');
  assert.equal(resolveAgentWorkspaceLocation(model, 'source:missing'), 'evidence');
  assert.equal(resolveAgentWorkspaceLocation(workspace([]), 'source:missing'), null, 'no evidence tab means no source target');
  assert.equal(resolveAgentWorkspaceLocation(model, 'tool:missing'), null);
  assert.deepEqual([by('record:bazi_chart:' + record)?.title, by('record:bazi_chart:' + record)?.toolIds], ['本人', ['read-1', 'read-2']]);
  assert.deepEqual([by('attachment:' + attachment)?.title, by('attachment:' + attachment)?.toolIds], ['手相说明.txt', ['attachment']]);
  assert.equal(model.resources.filter(resource => resource.id.startsWith('attachment:')).length, 1);
  assert.deepEqual([by('method:bazi')?.title, by('method:bazi')?.toolIds], ['子平八字', ['method-1', 'method-2']]);
  assert.deepEqual(by('memory')?.toolIds, ['memory-read'], 'failed calls stay in the task process, not the workspace');
});

test('each collaboration member gets its own workspace page beside the collaboration', () => {
  const team = tool('team', 'parallel_analysis', { output: { title: '三派会诊', analyses: [
    { system: 'bazi', conversationId: 10, status: 'completed', name: '格局派', answer: '取流通。' },
    { system: 'bazi', conversationId: 11, status: 'running', name: '应期派' },
  ] } });
  const model = workspace([team]);
  assert.deepEqual(model.resources.filter(resource => resource.view === 'member').map(resource => [resource.id, resource.title, resource.member]),
    [['member:team:10', '格局派', { toolId: 'team', conversationId: 10 }], ['member:team:11', '应期派', { toolId: 'team', conversationId: 11 }]]);
  assert.equal(resolveAgentWorkspaceLocation(model, 'member:team:10'), 'member:team:10');
  assert.equal(model.locations.get('team'), 'tool:team', 'the member pages do not take the call away from the collaboration');
});

test('a script has a code page and each chart it reads opens where a direct call would', async () => {
  const bazi = await coreResult('bazi');
  const script = tool('native-tool:1:script', 'codemode', { title: '运行脚本', input: { code: 'return 1' }, output: { calls: [], output: '' } });
  const call = tool('nested:5', 'bazi', { ...bazi, title: '八字排盘', parentId: script.id });
  const model = workspace([script, call]);
  assert.deepEqual(model.resources.map(resource => [resource.id, resource.view]), [['tool:native-tool:1:script', 'code'], ['tool:nested:5', 'chart']]);
  assert.equal(getAgentWorkspaceFollowTarget(model), 'tool:nested:5', 'the chart a script reads is what the model is looking at');
  assert.equal(getAgentWorkspaceAutoOpenEvent([script, call]), 'nested:5');
});

test('only boards open the workspace by themselves; tasks without one leave it closed', async () => {
  const bazi = await coreResult('bazi');
  const running = tool('calc', 'bazi', { status: 'running' });
  assert.equal(getAgentWorkspaceAutoOpenEvent([running]), null, 'a chart opens the panel once there is a reading to show');
  assert.equal(getAgentWorkspaceAutoOpenEvent([running, tool('web', 'web_search', { status: 'running' })]), null);
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('calc', 'bazi', bazi), tool('web', 'web_search')]), 'calc');
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('calc', 'bazi', bazi), tool('relations', 'bazi_relations', { status: 'running' })]), 'relations', 'a drilldown is the model looking at the board');
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('calc', 'bazi', bazi), tool('ask', 'ask_user', { status: 'awaiting_input' })]), 'calc', 'a question stays in the chat');
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('ask', 'ask_user', { status: 'awaiting_input' })]), null);
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('team', 'parallel_analysis', { status: 'running' }), { type: 'text', id: 'text', text: '汇总' }]), null, 'a collaboration has no board of its own');
});

test('question cards find their answers through the question part their call created', () => {
  const parts: AgentPart[] = [
    tool('ask', 'ask_user', { status: 'completed', output: { question: '出生时间？', questions: [{ id: 'birth', question: '出生时间？', allowCustom: true, allowSkip: false }] } }),
    { type: 'question', id: '3:ask', question: '出生时间？' },
    tool('other', 'web_search'),
    { type: 'question', id: 'stray', question: '不属于任何卡片' },
  ];
  assert.deepEqual([...getAgentToolQuestionIds(parts)], [['ask', '3:ask']]);
  const messages = [
    { id: 'reply', role: 'user', content: '早上 9 点', createdAt: '', metadata: { agentQuestionId: '3:ask', agentAnswers: { birth: ['早上 9 点'] } } },
    { id: 'forged', role: 'assistant', content: 'ignored', createdAt: '', metadata: { agentQuestionId: 'other' } },
    { id: 'invalid', role: 'user', content: '跳过', createdAt: '', metadata: { agentQuestionId: 'legacy', agentAnswers: { birth: [1] } } },
  ] as ChatMessage[];
  const answers = getAgentQuestionAnswers(messages);
  assert.deepEqual(answers.get('3:ask'), { content: '早上 9 点', answers: { birth: ['早上 9 点'] } });
  assert.deepEqual(answers.get('legacy'), { content: '跳过' }, 'malformed structured answers keep only the visible reply');
  assert.equal(answers.has('other'), false);
  assert.deepEqual(getAgentToolQuestions(tool('running', 'ask_user', { status: 'running', input: { question: '你的出生地？' } })).map(item => item.question), ['你的出生地？']);
  assert.deepEqual(getAgentToolQuestions(tool('broken', 'ask_user', { input: { questions: 'nope' } })), []);
});

test('family parsers read real Core and method results and reject incomplete ones', async () => {
  for (const name of listToolDefinitions().map(item => item.name).filter(name => getAgentToolFamily(name) === 'calculation')) {
    const result = await coreResult(name);
    assert.equal(getAgentCalculation(tool(name, name, result))?.kind, name, `${name} has a structured view`);
    assert.equal(getAgentCalculation(tool(name, name, { ...result, status: 'running' })), null);
    assert.equal(getAgentCalculation(tool(name, name, { output: { artifactId: 'x', result: {} } })), null, `${name} falls back to canonical text`);
  }
  // full 档的大运带流年列表；异常字段整卡回退，不渲染半截数据。
  const fullDayun = await coreResult('bazi_dayun', { detailLevel: 'full' });
  const dayun = getAgentCalculation(tool('full', 'bazi_dayun', fullDayun))!;
  const liunian = dayun.kind === 'bazi_dayun' ? dayun.data.大运列表.find(item => (item.流年列表?.length ?? 0) > 0)?.流年列表 : undefined;
  assert.ok(liunian?.length, 'full 档大运可展开流年');
  const broken = structuredClone(fullDayun) as { output: { result: { 大运列表: Array<{ 流年列表?: Array<Record<string, unknown>>; 干支: string }> } } };
  const brokenDayun = broken.output.result.大运列表.find(item => (item.流年列表?.length ?? 0) > 0)!;
  brokenDayun.流年列表![0].流年 = '二〇二七';
  assert.equal(getAgentCalculation(tool('bad', 'bazi_dayun', broken)), null, '异常流年列表回退到规范文本');
  // 合盘两人各四柱，关系行都带柱位；缺一柱或缺柱位时整卡回退。
  const hepan = await coreResult('bazi_hepan');
  const pairing = getAgentCalculation(tool('pair', 'bazi_hepan', hepan));
  assert.deepEqual(pairing?.kind === 'bazi_hepan' && pairing.data.双方.map(person => person.称呼), ['男方', '女方']);
  type Pairing = { 双方: Array<{ 四柱: unknown[] }>; 年柱之间: Array<{ 位置?: unknown }> };
  const damaged = (breakIt: (result: Pairing) => void) => {
    const copy = structuredClone(hepan);
    breakIt(copy.output.result as unknown as Pairing);
    return getAgentCalculation(tool('bad', 'bazi_hepan', copy));
  };
  assert.equal(damaged(result => { result.双方[1].四柱.pop(); }), null, '少一柱整卡回退');
  assert.equal(damaged(result => { delete result.年柱之间[0].位置; }), null, '关系行缺柱位整卡回退');
  // 择日可同时为多人避冲；旧版把避冲写成一个字符串，按规范文本显示。
  const avoiding = await coreResult('almanac_select', { excludeClash: ['牛', '鸡'] });
  const selection = getAgentCalculation(tool('sel', 'almanac_select', avoiding));
  assert.deepEqual(selection?.kind === 'almanac_select' && selection.data.查询.排除冲煞, ['丑牛（冲未）', '酉鸡（冲卯）']);
  const legacy = structuredClone(avoiding) as unknown as { output: { result: { 查询: Record<string, unknown> } } };
  legacy.output.result.查询.排除冲煞 = '丑牛（冲未）';
  assert.equal(getAgentCalculation(tool('old', 'almanac_select', legacy)), null);
  // 方法是内置技能：load_skill 读回的 details.method 让工作区按方法显示，即使没有 canonicalText 也有完整正文。
  const method = loadAnalysisMethod('bazi');
  const guide = getAgentMethod(tool('m', AGENT_SKILL_TOOLS.load, {
    output: { name: 'bazi', version: 0, scope: 'builtin', files: [], method },
  }))!;
  assert.deepEqual([guide.title, guide.version], ['子平八字', method.version]);
  assert.ok(guide.tools.includes('bazi') && guide.instructions.includes('不授予工具'), 'the card body comes from details.method.instructions');
  assert.ok(!guide.instructions.includes('<skill'));
  assert.equal(getAgentMethod(tool('m', AGENT_SKILL_TOOLS.load, { output: { name: 'case-review', version: 1, scope: 'user', files: [] } })), null);
  const memories = getAgentMemories(tool('w', 'remember_user_fact', { output: { id: 'm', user_id: 'owner', title: '历法', content: '以后都用公历时间', kind: 'preference' } }));
  assert.deepEqual(memories, [{ id: 'm', title: '历法', content: '以后都用公历时间', kind: 'preference' }]);
  assert.deepEqual(getAgentMemories(tool('r', 'read_user_memory', { output: [{ id: 'bad', title: 1 }] })), []);
  const read = getAgentAttachmentRead(tool('a', 'read_attachment', { output: { id: 'a', name: '长文.txt', kind: 'text', text: '一二三', offset: 8000, total: 9000, nextOffset: null } }));
  assert.deepEqual([read?.readUntil, read?.total, read?.nextOffset], [8003, 9000, null]);
  assert.equal(getAgentAttachmentRead(tool('i', 'read_attachment', { output: { id: 'i', name: '手相.jpg', kind: 'image', note: '图片已通过视觉输入提供' } }))?.readUntil, null);
});

test('the overview is the only workspace section; following shows the latest call until the task ends', () => {
  // 过程标签已移除：执行过程只留在聊天转录里。
  assert.deepEqual(getAgentWorkspaceSections(), ['results']);
  assert.deepEqual([null, 'queued', 'running', 'cancelling', 'awaiting_input', 'completed', 'failed'].map(status => isAgentRunWorking(status as Parameters<typeof isAgentRunWorking>[0])),
    [false, true, true, true, false, false, false], 'a task waiting for an answer is not working');

  const model = workspace([tool('profile', 'read_user_profile'), tool('plan', 'todo_write', { output: { revision: 1, items: [] } }), tool('ask', 'ask_user', { status: 'awaiting_input' })]);
  const profile = model.locations.get('profile')!, question = model.locations.get('ask')!;
  const at = (selected: string | null, followModel: boolean, status: Parameters<typeof getAgentWorkspaceLocation>[1]['status']) => getAgentWorkspaceLocation(model, { selected, followModel, status });
  assert.equal(at(null, true, 'awaiting_input'), question, 'a waiting task keeps its question in view');
  assert.equal(at('tool:profile', true, 'running'), question, 'following overrides the reader’s last choice');
  assert.equal(at('tool:profile', false, 'running'), profile);
  assert.equal(at('results', true, 'completed'), 'results', 'following ends on the overview');
  assert.equal(at('results', false, 'running'), 'results', 'the overview is always shown');
  assert.equal(at('tool:missing', false, 'completed'), 'results', 'a selection that no longer exists falls back');
  assert.equal(at(null, false, null), 'results', 'without a task only the overview exists');
  assert.equal(getAgentWorkspaceLocation(workspace([tool('plan', 'todo_write')]), { selected: null, followModel: true, status: 'running' }), 'results', 'nothing to follow falls back to the overview');
});

test('overview rows state only what the thumbnail does not already show', async () => {
  for (const name of listToolDefinitions().map(item => item.name).filter(isAgentChartTool)) {
    const result = await coreResult(name);
    const part = tool(name, name, result);
    const value = getAgentChart(part)!;
    const facts = describeOverviewFacts(part, value);
    assert.ok(facts.trim(), `${name} has a facts line`);
    assert.doesNotMatch(facts, /\n/, `${name} facts stay on one line`);
    if (value.kind === 'bazi') {
      assert.doesNotMatch(facts, /日主/, 'the day master is already the thumbnail day pillar');
      assert.doesNotMatch(facts, /Asia\//, 'the timezone is left to the full board');
    }
    if (value.kind === 'ziwei') assert.match(facts, /命主 .+ · 身主 /);
    if (value.kind === 'tarot') assert.doesNotMatch(facts, new RegExp(value.chart.问卜设定.问题 || '^$'), 'the question is not repeated');
  }
});
