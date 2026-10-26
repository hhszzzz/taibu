import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentPlanView } from '../components/chat/agent/AgentPlanView';
import { AgentContextOverview } from '../components/chat/agent/AgentContextUsage';
import { getAgentPlan, getAgentSkills, type AgentToolPart } from '../lib/agent/tool-presentation';
import { estimateTokens } from '../lib/agent/token-estimate';
import { getAgentSteps, summarizeAgentActivity } from '../components/chat/agent/presentation';
import { buildAgentWorkspace, getAgentWorkspaceLocation } from '../lib/agent/workspace';
import type { AgentRuntimeInfo } from '../lib/agent/types';

const part = (id: string, name: string, extra: Partial<AgentToolPart> = {}): AgentToolPart => ({
  type: 'tool', id, name, title: name, status: 'completed', ...extra,
});

const plan = (id: string, text: string, output?: Record<string, unknown>, status: AgentToolPart['status'] = 'completed') =>
  part(id, 'submit_plan', { status, input: { plan: text }, ...(output ? { output } : {}) });

test('a plan is read from the call: the Markdown it proposed and the decision that followed', () => {
  assert.deepEqual(getAgentPlan(plan('p1', '# 计划\n1. 先排盘。')), { plan: '# 计划\n1. 先排盘。', approved: null, feedback: null });
  assert.deepEqual(getAgentPlan(plan('p1', '# 计划', { plan: '# 计划', approved: false, feedback: '先看紫微' })), { plan: '# 计划', approved: false, feedback: '先看紫微' });
  assert.equal(getAgentPlan(part('b', 'bazi', { input: { plan: '# 计划' } })), null, 'only the plan tool');
  assert.equal(getAgentPlan(part('p', 'submit_plan', { input: { plan: '  ' } })), null, 'an empty plan has nothing to show');
});

test('every plan submission of the task shares one workspace page', () => {
  const first = plan('p1', '# 第一版', { plan: '# 第一版', approved: false, feedback: '再具体些' });
  const second = plan('p2', '# 第二版', { plan: '# 第二版', approved: true });
  const model = buildAgentWorkspace({ parts: [first, second], artifacts: [], attachmentIds: [] });
  const resource = model.resources.find(item => item.view === 'plan')!;
  assert.deepEqual(resource.toolIds, ['p1', 'p2']);
  assert.equal(model.locations.get('p1'), resource.id);
  assert.equal(model.locations.get('p2'), resource.id);
  // 「tool:p1」 from a transcript step reaches the same page.
  assert.equal(getAgentWorkspaceLocation(model, { selected: 'tool:p1', followModel: false, status: 'completed' }), resource.id);
});

test('the plan page renders the plan as Markdown, newest first, with the decision and the feedback', () => {
  const html = renderToStaticMarkup(createElement(AgentPlanView, {
    tools: [
      plan('p1', '# 第一版计划\n\n1. 先排八字。', { plan: '# 第一版计划\n\n1. 先排八字。', approved: false, feedback: '加上紫微' }),
      plan('p2', '# 第二版计划\n\n1. 先排八字，再看紫微。', { plan: '# 第二版计划\n\n1. 先排八字，再看紫微。', approved: true }),
    ],
    runStatus: 'completed',
    step: 2,
  }));
  const text = html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.ok(!html.includes('\\n'), 'the plan is not shown as an escaped JSON string');
  assert.match(html, /<h1[^>]*>第一版计划<\/h1>/u);
  assert.match(html, /<h1[^>]*>第二版计划<\/h1>/u);
  assert.ok(html.indexOf('第二版计划') < html.indexOf('第一版计划'), 'the newest submission comes first');
  assert.match(text, /第 2 次提交 · 已批准/u);
  assert.match(text, /第 1 次提交 · 要求修改/u);
  assert.match(text, /你的意见：加上紫微/u);
  assert.match(text, /计划模式 · 第 2 步 · 已批准/u);
});

test('a plan still waiting for the user says so, and an ended task does not pretend it is waiting', () => {
  const waiting = renderToStaticMarkup(createElement(AgentPlanView, { tools: [plan('p1', '# 待批计划', undefined, 'running')], runStatus: 'running' }));
  assert.match(waiting.replace(/<[^>]+>/gu, ' '), /等待你批准/u);
  const ended = renderToStaticMarkup(createElement(AgentPlanView, { tools: [plan('p1', '# 待批计划', undefined, 'running')], runStatus: 'cancelled' }));
  assert.match(ended.replace(/<[^>]+>/gu, ' '), /任务结束时计划未被处理/u);
  assert.ok(!ended.includes('等待你批准'));
});

test('the skills are the method cards this task loaded, listed once each', () => {
  const catalog = part('c', 'list_analysis_methods', { output: [{ id: 'bazi', title: '子平八字', version: '2.1.0', description: '论八字' }] });
  const loaded = (id: string, version: string, tokens?: number) => part(`m-${id}-${version}`, 'load_analysis_method', {
    output: { id, title: id === 'bazi' ? '子平八字' : '紫微斗数', version, instructions: '# 卡', tools: ['bazi'], ...(tokens === undefined ? {} : { tokens }) },
  });
  const ziwei = loaded('ziwei', '1.0.0');
  // A skill counts once by name, its latest load opening its step; one loaded before counting is shown at zero.
  const skill = (id: string, version: number, tokens?: number) => part(id, 'load_skill', {
    output: { name: 'case-review', version, scope: 'user', files: [{ path: 'notes.md', bytes: 12 }], ...(tokens === undefined ? {} : { tokens }) },
  });
  const skills = getAgentSkills([catalog, loaded('bazi', '2.0.0', 300), skill('s1', 1, 90), loaded('bazi', '2.1.0', 640), ziwei, skill('s2', 2, 120)], 'deepseek-v3.2');
  assert.equal(skills.listed, true, 'the injected directory was used');
  assert.deepEqual(skills.cards, [
    { id: 'method:bazi', kind: 'method', title: '子平八字', version: '2.1.0', tokens: 640 },
    { id: 'tool:s2', kind: 'skill', title: 'case-review', version: 'v2', tokens: 120 },
    { id: 'method:ziwei', kind: 'method', title: '紫微斗数', version: '1.0.0', tokens: estimateTokens('deepseek-v3.2', JSON.stringify(ziwei.output)) },
  ], 'a reloaded card replaces its earlier version; a card counted at run time keeps its count, an older one is estimated from what the model read');
  assert.deepEqual(getAgentSkills([]), { listed: false, cards: [] });
});

test('the context card reports skills instead of leaving the row as a placeholder', () => {
  const runtime: AgentRuntimeInfo = {
    model: { id: 'main', name: '主模型', contextWindow: 100_000, limitSource: 'configured' },
    context: { tokens: 8000, measuredTokens: 8000, estimatedTokens: 0, source: 'usage', compactions: 0 },
  };
  const render = (props: Parameters<typeof AgentContextOverview>[0]) =>
    renderToStaticMarkup(createElement(AgentContextOverview, props)).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  const withSkills = render({ runtime, skills: { listed: true, cards: [{ id: 'method:bazi', title: '子平八字', version: '2.1.0', tokens: 1_200 }] } });
  assert.match(withSkills, /技能 1 张卡 · 1\.2k/u, 'the row states the card count and the tokens it occupies');
  assert.ok(!withSkills.includes('技能 未启用'), 'a used skill row is not a placeholder');
  const unusedSkills = render({ runtime, skills: { listed: false, cards: [] } });
  assert.match(unusedSkills, /技能 方法目录 · /u, 'the injected catalog is counted as skills, not «未加载»');
  assert.ok(!unusedSkills.includes('未加载'));
  assert.match(render({ runtime }), /技能 0 项 未启用/u, 'without skill data the row stays as it was');
  // The skill directory is counted with the method directory; a loaded skill is named apart from the cards.
  const listed = { ...runtime, skillsTokens: 500, skills: { listed: 2, sectionTokens: 300 } };
  assert.match(render({ runtime: listed, skills: { listed: false, cards: [] } }), /技能 方法与技能目录 · 800/u);
  assert.match(render({ runtime: listed, skills: { listed: false, cards: [
    { id: 'method:bazi', kind: 'method', title: '子平八字', version: '2.1.0', tokens: 200 },
    { id: 'tool:s1', kind: 'skill', title: 'case-review', version: 'v2', tokens: 100 },
  ] } }), /技能 1 张卡 · 1 个技能 · 1\.1k/u);
});

test('a plan is a process step; the task list stays a progress bar', () => {
  const steps = getAgentSteps([
    part('todo', 'todo_write', { output: { revision: 1, items: [] } }),
    plan('p1', '# 计划'),
    part('b', 'bazi'),
  ]);
  assert.deepEqual(steps.map(step => step.name), ['submit_plan', 'bazi']);
  assert.equal(summarizeAgentActivity(steps, 0, 0), '已查看 1 张命盘，已提交 1 次计划');
  assert.equal(summarizeAgentActivity([part('todo', 'todo_write')], 0, 0), '任务过程', 'task-list updates do not count as work');
});

test('the status line counts method cards, not method calls', () => {
  const load = (id: string, card: string) => part(id, 'load_analysis_method', { input: { id: card } });
  const catalog = part('c', 'list_analysis_methods');
  assert.equal(summarizeAgentActivity([catalog, load('m1', 'bazi'), load('m2', 'bazi'), load('m3', 'ziwei')], 0, 0), '已加载 2 套分析方法',
    'listing the directory loads nothing, and reading a card twice is still one card');
  assert.equal(summarizeAgentActivity([catalog], 0, 0), '已查看方法目录');
});
