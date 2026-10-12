import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeTool, buildToolSuccessPayload, listToolDefinitions } from 'taibu-core/mcp';
import type { AgentPart } from '../lib/agent/types';
import type { ChatMessage } from '../types';
import { getAgentToolFamily } from '../lib/agent/tool-catalog';
import { getAgentAttachmentRead, getAgentCalculation, getAgentMemories, getAgentMethod, getAgentMethodCatalog, getAgentToolQuestions, type AgentToolPart } from '../lib/agent/tool-presentation';
import {
  buildAgentWorkspace, getAgentQuestionAnswers, getAgentToolQuestionIds, getAgentWorkspaceAutoOpenEvent, getAgentWorkspaceFollowTarget, getAgentWorkspaceLocation,
  getAgentWorkspaceSections, isAgentRunWorking, resolveAgentWorkspaceLocation,
} from '../lib/agent/workspace';
import { ANALYSIS_METHODS, loadAnalysisMethod } from '../lib/agent/methods.server';

const tool = (id: string, name: string, extra: Partial<AgentToolPart> = {}): AgentToolPart => ({ type: 'tool', id, name, title: name, status: 'completed', ...extra });
const workspace = (parts: AgentPart[], attachmentIds: string[] = []) => buildAgentWorkspace({ parts, artifacts: [], attachmentIds });

async function coreResult(name: string) {
  const definition = listToolDefinitions().find(item => item.name === name)!;
  const payload = buildToolSuccessPayload(name, await executeTool(name, definition.inputSchema.examples![0] as Record<string, unknown>));
  return { output: { artifactId: randomUUID(), result: payload.structuredContent }, canonicalText: payload.content.map(part => part.text).join('\n') };
}

test('every tool family reaches a workspace location, including external and unknown tools', () => {
  const names = [...listToolDefinitions().map(item => item.name), 'inspect_chart', 'web_search', 'search_knowledge', 'list_user_data', 'read_user_data',
    'read_user_profile', 'read_attachment', 'list_analysis_methods', 'load_analysis_method', 'todo_write', 'ask_user', 'parallel_analysis',
    'read_user_memory', 'remember_user_fact', 'select_final_artifacts', 'mcp__archive__lookup', 'retired_tool'];
  const model = workspace(names.map((name, index) => tool(`call-${index}`, name, { status: 'running', input: name === 'read_attachment' ? { id: randomUUID() } : {} })));
  for (const [index, name] of names.entries()) {
    const location = model.locations.get(`call-${index}`);
    assert.ok(location, `${name} has a workspace location`);
    assert.equal(resolveAgentWorkspaceLocation(model, location), location);
  }
  assert.equal(model.locations.get(`call-${names.indexOf('todo_write')}`), 'process');
  assert.equal(model.locations.get(`call-${names.indexOf('select_final_artifacts')}`), 'results');
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
  const record = randomUUID(), attachment = randomUUID();
  const model = workspace([
    tool('web', 'web_search', { input: { query: '庚金' }, output: [{ title: '来源', url: 'https://example.com', content: '摘要' }] }),
    tool('kb', 'search_knowledge', { input: { query: '月令' }, output: [] }),
    tool('list', 'list_user_data', { output: { items: [{ id: record, type: 'bazi_chart', name: '本人', preview: '己巳 丁丑' }], errors: [] } }),
    tool('read-1', 'read_user_data', { input: { type: 'bazi_chart', id: record } }),
    tool('read-2', 'read_user_data', { input: { type: 'bazi_chart', id: record } }),
    tool('attachment', 'read_attachment', { input: { id: attachment }, output: { id: attachment, name: '手相说明.txt', kind: 'text', text: '掌纹', offset: 0, total: 2, nextOffset: null } }),
    tool('method-1', 'load_analysis_method', { input: { id: 'bazi' }, output: loadAnalysisMethod('bazi') }),
    tool('method-2', 'load_analysis_method', { input: { id: 'bazi' }, status: 'running' }),
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
  assert.deepEqual([by('method:bazi')?.title, by('method:bazi')?.toolIds], ['八字命理解读指引', ['method-1', 'method-2']]);
  assert.deepEqual(by('memory')?.toolIds, ['memory-read', 'memory-write']);
});

test('only chart readings, questions and collaborations open the workspace by themselves', async () => {
  const bazi = await coreResult('bazi');
  const running = tool('calc', 'bazi', { status: 'running' });
  assert.equal(getAgentWorkspaceAutoOpenEvent([running]), null, 'a chart opens the panel once there is a reading to show');
  assert.equal(getAgentWorkspaceAutoOpenEvent([running, tool('web', 'web_search', { status: 'running' })]), null);
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('calc', 'bazi', bazi), tool('web', 'web_search')]), 'calc');
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('calc', 'bazi', bazi), tool('ask', 'ask_user', { status: 'awaiting_input' })]), 'ask');
  assert.equal(getAgentWorkspaceAutoOpenEvent([tool('team', 'parallel_analysis', { status: 'running' }), { type: 'text', id: 'text', text: '汇总' }]), 'team');
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
  const guide = getAgentMethod(tool('m', 'load_analysis_method', { output: loadAnalysisMethod('bazi') }))!;
  assert.equal(guide.title, '八字命理解读指引');
  assert.equal(guide.version, '1.0.0');
  assert.ok(guide.tools.includes('bazi') && guide.instructions.includes('不授予工具'));
  assert.equal(getAgentMethod(tool('m', 'load_analysis_method', { output: { id: 'bazi' } })), null);
  assert.equal(getAgentMethodCatalog(tool('l', 'list_analysis_methods', { output: ANALYSIS_METHODS }))?.length, ANALYSIS_METHODS.length);
  const memories = getAgentMemories(tool('w', 'remember_user_fact', { output: { id: 'm', user_id: 'owner', title: '历法', content: '以后都用公历时间', kind: 'preference' } }));
  assert.deepEqual(memories, [{ id: 'm', title: '历法', content: '以后都用公历时间', kind: 'preference' }]);
  assert.deepEqual(getAgentMemories(tool('r', 'read_user_memory', { output: [{ id: 'bad', title: 1 }] })), []);
  const read = getAgentAttachmentRead(tool('a', 'read_attachment', { output: { id: 'a', name: '长文.txt', kind: 'text', text: '一二三', offset: 8000, total: 9000, nextOffset: null } }));
  assert.deepEqual([read?.readUntil, read?.total, read?.nextOffset], [8003, 9000, null]);
  assert.equal(getAgentAttachmentRead(tool('i', 'read_attachment', { output: { id: 'i', name: '手相.jpg', kind: 'image', note: '图片已通过视觉输入提供' } }))?.readUntil, null);
});

test('the overview joins the process once the task ends, and following shows the latest call only until then', () => {
  assert.deepEqual(getAgentWorkspaceSections(null), ['results']);
  assert.deepEqual(getAgentWorkspaceSections('queued'), ['process']);
  assert.deepEqual(getAgentWorkspaceSections('awaiting_input'), ['process']);
  for (const status of ['completed', 'cancelled', 'failed'] as const) assert.deepEqual(getAgentWorkspaceSections(status), ['results', 'process']);
  assert.deepEqual([null, 'queued', 'running', 'cancelling', 'awaiting_input', 'completed', 'failed'].map(status => isAgentRunWorking(status as Parameters<typeof isAgentRunWorking>[0])),
    [false, true, true, true, false, false, false], 'a task waiting for an answer is not working');

  const model = workspace([tool('profile', 'read_user_profile'), tool('plan', 'todo_write', { output: { revision: 1, items: [] } }), tool('ask', 'ask_user', { status: 'awaiting_input' })]);
  const profile = model.locations.get('profile')!, question = model.locations.get('ask')!;
  const at = (selected: string | null, followModel: boolean, status: Parameters<typeof getAgentWorkspaceLocation>[1]['status']) => getAgentWorkspaceLocation(model, { selected, followModel, status });
  assert.equal(at(null, true, 'awaiting_input'), question, 'a waiting task keeps its question in view');
  assert.equal(at('tool:profile', true, 'running'), question, 'following overrides the reader’s last choice');
  assert.equal(at('tool:profile', false, 'running'), profile);
  assert.equal(at('process', true, 'completed'), 'results', 'following ends on the overview');
  assert.equal(at('results', false, 'running'), 'process', 'a section not shown falls back to the first one that is');
  assert.equal(at('tool:missing', false, 'completed'), 'results', 'a selection that no longer exists falls back');
  assert.equal(at(null, false, null), 'results', 'without a task only the overview exists');
  assert.equal(getAgentWorkspaceLocation(workspace([tool('plan', 'todo_write')]), { selected: null, followModel: true, status: 'running' }), 'process', 'nothing to follow yet');
});
