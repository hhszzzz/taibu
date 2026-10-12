import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types';
import type { AgentPart } from '../lib/agent/types';
import { randomUUID } from 'node:crypto';
import { executeTool, buildToolSuccessPayload, listToolDefinitions } from 'taibu-core/mcp';
import { getAgentChart } from '../lib/agent/tool-presentation';
import { buildAgentWorkspace } from '../lib/agent/workspace';
import {
    collectAgentArtifacts, describeAgentCallNote, describeAgentChartRules, describeAgentChartSteps, describeAgentChartSubject, describeAgentStep, formatAgentToolDuration,
    getAgentStepNumbers, getAgentSteps, getAgentLiveLine, getAgentArtifactHref, getAgentIntermediateResults, getAgentLocatedPositions, getAgentReadingState, getAgentToolState,
    getAgentResponseTiming, getAgentTaskDuration, getAgentTaskSpan, getDayunWindow, groupAgentParts, getAgentActivityLabel, getAgentEvidenceSummary, stripLeadingTitle,
    summarizeAgentProcess, summarizeAgentTool, AGENT_TOOL_FAMILY_LABELS, type AgentArtifact, type AgentTool,
} from '../components/chat/agent/presentation';
import { formatAgentElapsed } from '../components/chat/agent/AgentHeaderStatus';

const chart: AgentArtifact = { type: 'artifact', id: 'chart-part', title: '命盘', chartType: 'bazi', chartId: 'chart/with?special=字符' };
function message(parts: AgentArtifact[]): ChatMessage {
    return { id: 'message', role: 'assistant', content: '', createdAt: '2026-10-06',
        agent: { version: 1, runId: 'run', status: 'completed', parts } };
}

test('Agent artifact destinations encode IDs and prefer the saved record', () => {
    assert.equal(getAgentArtifactHref(chart), '/bazi/result?chart=chart%2Fwith%3Fspecial%3D%E5%AD%97%E7%AC%A6');
    assert.equal(getAgentArtifactHref({ ...chart, chartType: 'ziwei', chartId: 'z' }), '/ziwei/result?chart=z');
    assert.equal(getAgentArtifactHref({ ...chart, recordId: 'record?a=1' }), '/records?id=record%3Fa%3D1');
});

test('Unsupported or incomplete artifacts do not link to an unrelated chart', () => {
    assert.equal(getAgentArtifactHref({ ...chart, chartType: 'unknown' }), null);
    assert.equal(getAgentArtifactHref({ ...chart, chartId: undefined }), null);
    assert.equal(getAgentArtifactHref({ ...chart, chartId: '' }), null);
});

test('Workspace deduplicates reused charts across regenerated tasks and retains distinct records', () => {
    const reused = { ...chart, id: 'new-part', title: '更新的命盘' };
    const firstRecord: AgentArtifact = { type: 'artifact', id: 'first', title: '分析一', recordId: 'r1' };
    const secondRecord: AgentArtifact = { ...firstRecord, id: 'second', recordId: 'r2' };
    assert.deepEqual(collectAgentArtifacts([message([chart, firstRecord]), message([reused, secondRecord])]), [reused, firstRecord, secondRecord]);
});

test('Workspace derives artifacts only from the visible conversation branch', () => {
    const record: AgentArtifact = { type: 'artifact', id: 'record', title: '旧分析', recordId: 'old' };
    const original = [message([chart, record])];
    assert.equal(collectAgentArtifacts(original).length, 2);
    assert.deepEqual(collectAgentArtifacts([message([chart])]), [chart]);
    assert.deepEqual(collectAgentArtifacts([]), []);
    assert.equal(original[0].agent?.parts.length, 2);
});

test('A terminal task never leaves unfinished tools spinning forever', () => {
    const tool = { type: 'tool', id: 'tool', name: 'bazi', title: '八字', status: 'running' } as const;
    for (const status of ['completed', 'cancelled', 'failed'] as const) {
        assert.equal(getAgentToolState(tool, status).status, 'interrupted');
    }
    for (const status of ['running', 'queued', 'awaiting_input', 'cancelling'] as const) {
        assert.equal(getAgentToolState(tool, status).status, 'running');
    }
    assert.equal(getAgentToolState({ ...tool, status: 'completed' }, 'cancelled').status, 'completed');
    assert.equal(getAgentToolState({ ...tool, status: 'failed' }, 'completed').status, 'failed');
    assert.equal(getAgentToolState({ ...tool, status: 'pending' }, 'running').label, '待执行');
    assert.equal(getAgentToolState({ ...tool, status: 'awaiting_input' }, 'awaiting_input').label, '等待回答');
    assert.equal(getAgentToolState({ ...tool, status: 'awaiting_input' }, 'cancelled').status, 'interrupted');
});

test('Completed cards show the durable-measured tool time without inventing a value for unfinished steps', () => {
    assert.equal(formatAgentToolDuration(0), '不足 1 毫秒');
    assert.equal(formatAgentToolDuration(240), '240 毫秒');
    assert.equal(formatAgentToolDuration(999), '999 毫秒');
    assert.equal(formatAgentToolDuration(1000), '1 秒');
    assert.equal(formatAgentToolDuration(2400), '2.4 秒');
    assert.equal(formatAgentToolDuration(9950), '10 秒');
    assert.equal(formatAgentToolDuration(10_000), '10 秒');
    assert.equal(formatAgentToolDuration(65_400), '65 秒');
    const completed = { type: 'tool', id: 'tool', name: 'bazi', title: '八字', status: 'completed', durationMs: 2400 } as const;
    assert.equal(completed.durationMs, 2400);
    const running = { type: 'tool', id: 'tool', name: 'bazi', title: '八字', status: 'running' } as const;
    assert.equal('durationMs' in running, false);
});

test('response measurements survive JSON history without counting duplicate IDs or inventing old measurements', () => {
    assert.equal(getAgentResponseTiming(undefined), null);
    const responses = [{ id: 'old' }, { id: 'first', durationMs: 1500 }, { id: 'second', durationMs: 0 }, { id: 'first', durationMs: 1500 }, { id: 'invalid', durationMs: -1 }];
    assert.deepEqual(getAgentResponseTiming(JSON.parse(JSON.stringify(responses))), { count: 2, durationMs: 1500 });
    assert.equal(getAgentResponseTiming([{ id: 'invalid', durationMs: NaN }, { id: 'invalid2', durationMs: Infinity }]), null);
    assert.equal(getAgentTaskSpan({ startedAt: 1000, endedAt: 6500 }), 5500);
    assert.equal(getAgentTaskSpan({ startedAt: 1000 }), null);
    assert.equal(getAgentTaskSpan({ endedAt: 6500 }), null);
    assert.equal(getAgentTaskSpan({ startedAt: 2000, endedAt: 1000 }), null);
    assert.equal(getAgentTaskSpan({ startedAt: NaN, endedAt: 1000 }), null);
});

test('Activity grouping preserves narration, question IDs and tool ordering', () => {
    const parts = [{ type: 'text', id: 'intro', text: 'intro' }, { type: 'reasoning', id: 'think', text: 'thinking' }, { type: 'tool', id: 'tool', name: 'bazi', title: '排盘', status: 'completed' }, { type: 'question', id: 'ask', question: 'question' }, { type: 'text', id: 'answer', text: 'answer' }] as const;
    const groups = groupAgentParts([...parts]);
    assert.equal(groups.length, 3);
    assert.equal(groups[1].type, 'activity');
    if (groups[1].type === 'activity') assert.deepEqual(groups[1].parts.map(part => part.id), ['think', 'tool', 'ask']);
    const data = { version: 1, runId: 'run', status: 'running', parts: [] } as const;
    assert.equal(getAgentActivityLabel({ ...data, parts: [], runtime: { model: { id: 'm', name: 'm', contextWindow: null, limitSource: 'unknown' }, activity: { phase: 'compacting' } } }), '正在压缩上下文');
    assert.equal(getAgentActivityLabel({ ...data, parts: [], status: 'awaiting_input' }), '等待你回答问题');
});

test('process steps summarize each call from its arguments and stored result only', () => {
    const tool = (name: string, extra: Partial<AgentTool> = {}): AgentTool => ({ type: 'tool', id: name, name, title: name, status: 'completed', ...extra });
    assert.equal(summarizeAgentTool(tool('bazi_dayun', { input: { birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 } })), '1990 / 1 / 15 · 9 时');
    assert.equal(summarizeAgentTool(tool('search_knowledge', { input: { query: '庚金 正官 月令' }, output: [{ content: '庚金带煞' }, { content: '八字用神' }] })), '「庚金 正官 月令」 · 命中 2 段');
    assert.equal(summarizeAgentTool(tool('web_search', { input: { query: '丑月' }, output: [] })), '「丑月」 · 没有可引用的公开来源');
    assert.equal(summarizeAgentTool(tool('web_search', { input: { query: '丑月' }, output: [{ title: 'a', url: 'https://a.example', content: 'x' }] })), '「丑月」 · 找到 1 个公开来源');
    assert.equal(summarizeAgentTool(tool('search_knowledge', { output: [] })), '没有匹配的段落', 'a search without a query still reports its outcome');
    assert.equal(summarizeAgentTool(tool('web_search', { status: 'running', input: { query: '丑月' } })), '「丑月」', 'a running search never claims a hit count');
    assert.equal(summarizeAgentTool(tool('list_user_data', { output: { items: [{ id: 'a', type: 'bazi_chart', name: '本人', preview: '己巳' }], errors: [{ message: '塔罗不可读' }] } })), '找到 1 份资料 · 1 项暂不可读');
    assert.equal(summarizeAgentTool(tool('parallel_analysis', { status: 'running', output: { analyses: [{ system: 'bazi', conversationId: 1, status: 'completed' }, { system: 'bazi', conversationId: 2, status: 'running' }] } })), '2 名成员 · 1 名已完成');
    assert.equal(summarizeAgentTool(tool('ask_user', { status: 'awaiting_input', input: { questions: [{ id: 'a', question: '城市？' }, { id: 'b', question: '行业？' }] } })), '2 个问题');
    assert.equal(summarizeAgentTool(tool('focus_chart', { output: { chartFocus: { version: 1, reference: 'artifact:11111111-1111-4111-8111-111111111111', targetIds: [], includeRelated: true, caption: '月干丁火' } } })), '月干丁火');
    assert.equal(summarizeAgentTool(tool('read_attachment', { output: { id: 'a', name: '长文.txt', kind: 'text', text: '一二', offset: 0, total: 9, nextOffset: 2 } })), '长文.txt · 读到 2 / 9 字');
    assert.equal(summarizeAgentTool(tool('mcp__archive__lookup', { input: { keyword: 1 } })), null);
    assert.equal(Object.keys(AGENT_TOOL_FAMILY_LABELS).length, 12, 'every tool family has a step tag');
});

test('the evidence chip counts only completed search results and the header clock never runs backwards', () => {
    const focus = { type: 'tool', id: 'f', name: 'focus_chart', title: '', status: 'completed', output: { chartFocus: { version: 1, reference: 'artifact:11111111-1111-4111-8111-111111111111', targetIds: [], includeRelated: true, caption: '月柱 丁丑' } } } as AgentTool;
    const parts = [
        { type: 'tool', id: 'w', name: 'web_search', title: '', status: 'completed', output: [{ title: 'a', url: 'https://a.example', content: 'x' }] },
        { type: 'tool', id: 'k', name: 'search_knowledge', title: '', status: 'completed', output: [{ content: 'y' }, { content: 'z' }] },
        { type: 'tool', id: 'r', name: 'web_search', title: '', status: 'running' },
        { type: 'tool', id: 'b', name: 'bazi', title: '', status: 'completed', output: [{ content: 'not evidence' }] },
        focus,
    ] as AgentTool[];
    assert.deepEqual(getAgentEvidenceSummary(parts), { total: 4, web: 1, knowledge: 2, chart: 1 }, 'located chart positions count beside search results');
    assert.equal(getAgentEvidenceSummary([]), null);
    assert.equal(getAgentEvidenceSummary([focus]), null, 'a task that never searched has no chip; its positions live in the chart');
    assert.equal(getAgentEvidenceSummary([{ type: 'tool', id: 'e', name: 'web_search', title: '', status: 'completed', output: [] }]), null, 'empty searches leave nothing to cite');
    assert.equal(formatAgentElapsed(72_000), '1 分 12 秒');
    assert.equal(formatAgentElapsed(-5), '0 秒');
    assert.equal(formatAgentElapsed(3_723_000), '1 小时 2 分');
});

test('a process step pairs its state with the summary and a note only where the state needs one', () => {
    const tool = (extra: Partial<AgentTool> = {}): AgentTool => ({ type: 'tool', id: 'step', name: 'web_search', title: '联网检索', status: 'completed', input: { query: '丑月' }, output: [], ...extra });
    assert.deepEqual(describeAgentStep(tool({ durationMs: 30_000 }), 'completed'), { status: 'completed', label: '完成', summary: '「丑月」 · 没有可引用的公开来源', note: null, duration: '30 秒' });
    const failed = describeAgentStep(tool({ status: 'failed', output: '网络错误', durationMs: 1200 }), 'completed');
    assert.equal(failed.note, '失败');
    assert.equal(failed.duration, '1.2 秒', 'a failed call keeps its measured execution time');
    const stopped = describeAgentStep(tool({ status: 'running', durationMs: 50 }), 'cancelled');
    assert.deepEqual([stopped.status, stopped.note, stopped.duration], ['interrupted', '已结束（任务停止时未完成）', null], 'an unfinished call never shows a time');
    assert.equal(describeAgentStep(tool({ status: 'pending', input: undefined, output: undefined }), 'running').note, '待执行');
    assert.equal(describeAgentStep(tool({ name: 'mcp__x', status: 'running', input: undefined, output: undefined }), 'running').note, '执行中', 'a running call without a summary still says what it is doing');
    assert.equal(describeAgentStep(tool({ status: 'running', output: undefined }), 'running').note, null, 'a running call with a summary needs no note');
    assert.equal(describeAgentStep(tool({ durationMs: Number.NaN }), 'completed').duration, null);
    assert.equal(describeAgentStep(tool({ durationMs: -1 }), 'completed').duration, null);
});

test('the folded process line names steps in first-use order, counts repeats and skips plan updates', () => {
    const tool = (id: string, title: string, name = 'focus_chart'): AgentTool => ({ type: 'tool', id, name, title, status: 'completed' });
    const tools = [tool('a', '八字排盘', 'bazi'), tool('p', '更新计划', 'todo_write'), tool('b', '定位分析位置'), tool('c', '八字大运', 'bazi_dayun'), tool('d', '定位分析位置'), tool('e', '定位分析位置')];
    assert.equal(summarizeAgentProcess(tools), '八字排盘、定位分析位置 3 次、八字大运');
    assert.equal(summarizeAgentProcess([...tools, tool('f', '确定最终成果', 'select_final_artifacts'), tool('g', '联网检索', 'web_search')]), '八字排盘、定位分析位置 3 次、八字大运、确定最终成果等');
    assert.equal(summarizeAgentProcess([]), '');
    assert.equal(summarizeAgentProcess([tool('p', '更新计划', 'todo_write')]), '');
});

test('the live line describes the running call only while tools run', () => {
    const runtime = (phase: 'tools' | 'thinking') => ({ model: { id: 'm', name: '主模型', contextWindow: null, limitSource: 'unknown' as const }, activity: { phase, toolTitle: '定位分析位置' } });
    const focus: AgentTool = { type: 'tool', id: 'f', name: 'focus_chart', title: '定位分析位置', status: 'running', input: { reference: 'artifact:11111111-1111-4111-8111-111111111111', targetIds: [], caption: '月干丁火 · 日主庚金' } };
    const data = { version: 1 as const, runId: 'run', status: 'running' as const, parts: [focus] };
    assert.equal(getAgentLiveLine({ ...data, runtime: runtime('tools') }), '正在定位分析位置 · 月干丁火 · 日主庚金');
    assert.equal(getAgentLiveLine(data), '正在定位分析位置 · 月干丁火 · 日主庚金', 'older runs without activity name the running call itself');
    assert.equal(getAgentLiveLine({ ...data, runtime: runtime('thinking') }), '正在思考', 'a call left marked running does not describe a thinking phase');
    assert.equal(getAgentLiveLine({ ...data, status: 'awaiting_input' }), '等待你回答问题');
    assert.equal(getAgentLiveLine({ ...data, parts: [] }), '等待模型响应');
    const team: AgentTool = { type: 'tool', id: 't', name: 'parallel_analysis', title: '协作分析', status: 'running', output: { analyses: [
        { system: 'bazi', conversationId: 1, name: '子平', status: 'completed' }, { system: 'ziwei', conversationId: 2, name: '紫微', status: 'running' }, { system: 'bazi', conversationId: 3, status: 'running' },
    ] } };
    assert.equal(getAgentLiveLine({ ...data, parts: [focus, team] }), '等待协作成员 · 紫微、bazi 正在分析', 'unnamed members fall back to their system');
    assert.equal(getAgentLiveLine({ ...data, parts: [{ ...team, output: { analyses: [] } }] }), '正在协作分析', 'a collaboration that has not reported members only names itself');
});

test('intermediate results name what the task computed but did not save', () => {
    const selected: AgentArtifact = { type: 'artifact', id: 'kept', title: '本人', chartId: 'c', chartType: 'bazi' };
    const tools: AgentTool[] = [
        { type: 'tool', id: 'b', name: 'bazi', title: '八字排盘', status: 'completed', output: { artifactId: 'kept' } },
        { type: 'tool', id: 'b2', name: 'bazi', title: '八字排盘', status: 'completed', output: { artifactId: 'dropped' } },
        { type: 'tool', id: 'd', name: 'bazi_dayun', title: '八字大运', status: 'completed' },
        { type: 'tool', id: 'f1', name: 'focus_chart', title: '定位分析位置', status: 'completed' },
        { type: 'tool', id: 'f2', name: 'focus_chart', title: '定位分析位置', status: 'completed' },
        { type: 'tool', id: 'x', name: 'bazi_dayun', title: '八字大运', status: 'failed' },
        { type: 'tool', id: 's', name: 'web_search', title: '联网检索', status: 'completed', output: [] },
    ];
    assert.equal(getAgentIntermediateResults(tools, [selected]), '八字排盘、八字大运、定位分析位置 2 次');
    assert.equal(getAgentIntermediateResults(tools.slice(0, 1), [selected]), null, 'a selected reading is not intermediate');
    assert.equal(getAgentIntermediateResults([], []), null);
});

test('steps are numbered once across the task and leave plan updates to the task list', () => {
    const tool = (id: string, name: string): AgentTool => ({ type: 'tool', id, name, title: id, status: 'completed' });
    const parts: AgentPart[] = [tool('plan', 'todo_write'), tool('a', 'bazi'), { type: 'text', id: 'say', text: '先看命盘。' }, tool('plan2', 'todo_write'), tool('b', 'focus_chart')];
    assert.deepEqual(getAgentSteps(parts).map(step => step.id), ['a', 'b']);
    assert.deepEqual([...getAgentStepNumbers(parts)], [['a', 1], ['b', 2]], 'narration between groups does not restart the numbering');
    assert.equal(getAgentStepNumbers([tool('plan', 'todo_write')]).size, 0);
});

test('a call note separates execution from waiting and only claims storage for cached results', () => {
    const tool = (extra: Partial<AgentTool> = {}): AgentTool => ({ type: 'tool', id: 'b', name: 'bazi', title: '八字排盘', status: 'completed', durationMs: 86, output: { artifactId: 'a1' }, ...extra });
    assert.equal(describeAgentCallNote(tool()), '执行阶段 86 毫秒（不含等待）。结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
    assert.equal(describeAgentCallNote(tool({ startedAt: 1_000, endedAt: 6_000, durationMs: 1_500 })), '执行阶段 1.5 秒（不含等待），连同等待共 5 秒。结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
    assert.equal(describeAgentCallNote(tool({ startedAt: 1_000, endedAt: 1_086 })), '执行阶段 86 毫秒（不含等待）。结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。', 'a span that reads the same is not repeated');
    assert.equal(describeAgentCallNote(tool({ output: { result: 1 } })), '执行阶段 86 毫秒（不含等待）。', 'an uncached result makes no replay claim');
    assert.equal(describeAgentCallNote(tool({ status: 'failed', durationMs: undefined })), null);
    assert.equal(describeAgentCallNote(tool({ durationMs: Number.NaN })), '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。', 'an unmeasured call never shows an invented time');
});

/** A completed call of a Core chart tool with its real result, as the projection stores it. */
async function chartCall(id: string, name: string, input?: Record<string, unknown>): Promise<AgentTool> {
    const definition = listToolDefinitions().find(item => item.name === name)!;
    const args = input ?? definition.inputSchema.examples![0] as Record<string, unknown>;
    const payload = buildToolSuccessPayload(name, await executeTool(name, args));
    return { type: 'tool', id, name, title: name, status: 'completed', input: args,
        output: { artifactId: randomUUID(), result: payload.structuredContent }, canonicalText: payload.content.map(part => part.text).join('\n') };
}

test('a bazi reading names its subject from the call and the rules Core calculated with, as returned', async () => {
    const calculated = await chartCall('calc', 'bazi', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
    const value = getAgentChart(calculated)!;
    assert.equal(describeAgentChartSubject(calculated, value), '男 · 公历 1990-01-15 09:00 · Asia/Shanghai · 日主 庚');
    assert.equal(describeAgentChartSubject({ ...calculated, input: { calendarType: 'lunar', isLeapMonth: true, birthYear: 1990, birthMonth: 5, birthDay: 3 } }, value),
        '男 · 农历 1990-闰05-03 · Asia/Shanghai · 日主 庚', 'a lunar date without an hour keeps its leap month');
    assert.equal(describeAgentChartSubject({ ...calculated, name: 'inspect_chart', input: { reference: 'artifact:x' } }, value), '男 · Asia/Shanghai · 日主 庚', 'a saved chart read back has no birth arguments');
    assert.equal(describeAgentChartSubject({ ...calculated, input: { birthYear: 1990.5, birthMonth: 1, birthDay: 15 } }, value), '男 · Asia/Shanghai · 日主 庚', 'malformed arguments are left out');
    assert.equal(describeAgentChartRules(value), '子时换日 midnight · Asia/Shanghai · 节气 instant · bazi-2026.10');
    assert.equal(describeAgentChartRules({ ...value, chart: { ...value.chart, 计算规则: undefined } } as typeof value), null);
    assert.equal(describeAgentChartRules({ ...value, chart: { ...value.chart, 计算规则: { timezone: ' ', ruleVersion: 7 } } } as unknown as typeof value), null);
    const ziwei = await chartCall('ziwei', 'ziwei');
    const ziweiValue = getAgentChart(ziwei)!;
    assert.equal(describeAgentChartSubject(ziwei, ziweiValue), ziweiValue.summary, 'other kinds keep their summary');
});

test('a chart tab names the latest task’s steps behind it and what became of the reading', async () => {
    const calculated = await chartCall('calc', 'bazi');
    const artifactId = (calculated.output as { artifactId: string }).artifactId;
    const inspected: AgentTool = { ...calculated, id: 'inspect', name: 'inspect_chart' };
    const focus: AgentTool = { type: 'tool', id: 'focus', name: 'focus_chart', title: '定位', status: 'completed',
        output: { chartFocus: { version: 1, reference: 'artifact:' + artifactId, targetIds: ['bazi:cell:2:0', 'bazi:cell:2:1', 'bazi:cell:2:0'], includeRelated: true, caption: '日柱' } } };
    assert.equal(getAgentReadingState(calculated, new Set([artifactId])), '已保存');
    assert.equal(getAgentReadingState(calculated, new Set()), '暂存成果');
    assert.equal(getAgentReadingState(inspected, new Set([artifactId])), '已存资料', 'a reading of a saved chart is the saved record itself');
    const numbers = new Map([['calc', 2], ['inspect', 3], ['focus', 5]]);
    assert.equal(describeAgentChartSteps({ reading: calculated, focus, numbers, state: '暂存成果' }), '第 2 步计算 · 第 5 步定位 · 暂存成果');
    assert.equal(describeAgentChartSteps({ reading: inspected, focus: undefined, numbers, state: '已存资料' }), '第 3 步读取 · 已存资料');
    assert.equal(describeAgentChartSteps({ reading: calculated, focus, numbers: new Map(), state: '已保存' }), '已保存', 'calls of earlier tasks carry no number');
    assert.equal(describeAgentChartSteps({ reading: undefined, focus: undefined, numbers, state: null }), '');

    const model = buildAgentWorkspace({ parts: [calculated, focus, { ...focus, id: 'focus-again' }], artifacts: [], attachmentIds: [] });
    assert.deepEqual(getAgentLocatedPositions(model), { toolIds: ['focus', 'focus-again'], labels: ['日柱天干 庚', '日柱地支 辰'] }, 'positions are listed once, in first-located order');
    assert.deepEqual(getAgentLocatedPositions(buildAgentWorkspace({ parts: [calculated], artifacts: [], attachmentIds: [] })), { toolIds: [], labels: [] });
});

test('the overview shows three luck periods around the year, marking the one it falls in', () => {
    const periods = [{ 干支: '戊寅', 起运年份: 2000 }, { 干支: '己卯', 起运年份: 2010 }, { 干支: '庚辰', 起运年份: 2020 }, { 干支: '辛巳', 起运年份: 2030 }];
    const window = (year: number, list = periods) => getDayunWindow(list, year).map(period => period.干支 + (period.current ? '*' : ''));
    assert.deepEqual(window(2025), ['己卯', '庚辰*', '辛巳']);
    assert.deepEqual(window(2005), ['戊寅*', '己卯', '庚辰'], 'the first period keeps the next two');
    assert.deepEqual(window(2045), ['己卯', '庚辰', '辛巳*'], 'the last period keeps the two before it');
    assert.deepEqual(window(1995), ['戊寅', '己卯', '庚辰'], 'before luck starts nothing is current');
    assert.deepEqual(window(2015, periods.slice(0, 2)), ['戊寅', '己卯*']);
    assert.deepEqual(getDayunWindow([], 2025), []);
});

test('an ended task’s duration runs from its creation to the last measured end, never backwards', () => {
    const createdAt = '2026-10-12T08:00:00.000Z', started = Date.parse(createdAt);
    const parts: AgentPart[] = [
        { type: 'tool', id: 'a', name: 'bazi', title: '八字', status: 'completed', startedAt: started + 1000, endedAt: started + 106_000 },
        { type: 'tool', id: 'b', name: 'web_search', title: '检索', status: 'failed' },
    ];
    const runtime = { model: { id: 'm', name: 'm', contextWindow: null, limitSource: 'unknown' as const },
        responses: [{ id: 'r1', durationMs: 4000, startedAt: started, endedAt: started + 46_000 }, { id: 'r2', endedAt: Number.NaN }] };
    assert.equal(getAgentTaskDuration(createdAt, { parts, runtime }), 106_000);
    assert.equal(getAgentTaskDuration(createdAt, { parts: [], runtime }), 46_000, 'model responses alone measure it');
    assert.equal(getAgentTaskDuration(createdAt, { parts: [{ ...parts[0], endedAt: started - 1 } as AgentPart] }), null, 'an end before creation is not a measurement');
    assert.equal(getAgentTaskDuration(createdAt, { parts: [parts[1]] }), null, 'nothing measured, nothing invented');
    assert.equal(getAgentTaskDuration('not a date', { parts, runtime }), null);
    assert.equal(getAgentTaskDuration(undefined, { parts, runtime }), null);
    assert.equal(getAgentTaskDuration(createdAt, undefined), null);
});

test('a guide shown under its own title drops only a leading heading that repeats it', () => {
    assert.equal(stripLeadingTitle('# 八字命理解读指引\n\n## 分析框架\n1. 定盘', '八字命理解读指引'), '## 分析框架\n1. 定盘');
    assert.equal(stripLeadingTitle('  # 八字命理解读指引 #\r\n\r\n正文', ' 八字命理解读指引'), '正文', 'closing hashes, spaces and CRLF are tolerated');
    assert.equal(stripLeadingTitle('# 八字命理解读指引', '八字命理解读指引'), '');
    assert.equal(stripLeadingTitle('# 紫微解读指引\n正文', '八字命理解读指引'), '# 紫微解读指引\n正文', 'a different title stays');
    assert.equal(stripLeadingTitle('## 八字命理解读指引\n正文', '八字命理解读指引'), '## 八字命理解读指引\n正文', 'only a top-level heading repeats the title');
    assert.equal(stripLeadingTitle('正文\n# 八字命理解读指引', '八字命理解读指引'), '正文\n# 八字命理解读指引', 'a later heading stays');
});
