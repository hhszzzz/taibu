import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types';
import type { AgentPart } from '../lib/agent/types';
import { randomUUID } from 'node:crypto';
import { executeTool, buildToolSuccessPayload, listToolDefinitions } from 'taibu-core/mcp';
import { getAgentChart } from '../lib/agent/tool-presentation';
import { getAgentToolFamily } from '../lib/agent/tool-catalog';
import { buildAgentWorkspace } from '../lib/agent/workspace';
import {
    collectAgentArtifacts, describeAgentCallNote, describeAgentChartRules, describeAgentChartSteps, describeAgentChartSubject, describeAgentStep, formatAgentToolDuration,
    getAgentStepNumbers, getAgentSteps, getAgentScriptCalls, getAgentLiveLine, getAgentArtifactHref, getAgentLocatedPositions, getAgentReadingState, getAgentToolState,
    getAgentResponseTiming, getAgentTaskDuration, getAgentTaskSpan, groupAgentParts, getAgentActivityLabel, getAgentEvidenceSummary, stripLeadingTitle,
    summarizeAgentProcess, summarizeAgentActivity, summarizeAgentTool, summarizeThinkingTime, formatMemberNames, AGENT_TOOL_FAMILY_LABELS, type AgentArtifact, type AgentTool,
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

test('a turn splits into per-batch blocks so what is said between calls stays between them', () => {
    const parts = [{ type: 'reasoning', id: 'think', text: 'thinking', durationMs: 4000 }, { type: 'tool', id: 'tool', name: 'almanac', title: '黄历查询', status: 'completed' }, { type: 'text', id: 'narration', text: '再查一下大运' }, { type: 'reasoning', id: 'think2', text: 'thinking', durationMs: 2000 }, { type: 'tool', id: 'tool2', name: 'bazi_dayun', title: '大运', status: 'completed' }, { type: 'text', id: 'answer', text: '查到了' }] as const;
    const groups = groupAgentParts([...parts]);
    assert.deepEqual(groups.map(group => group.type === 'content' ? group.part.id : 'activity:' + group.parts.map(part => part.id).join('+')),
        ['activity:think+tool', 'narration', 'activity:think2+tool2', 'answer'], '每一批工具一块，中间的句子留在两块之间');
    const first = groups[0];
    assert.equal(summarizeThinkingTime(first?.type === 'activity' ? first.parts : []), '已思考 4 秒');
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
    assert.equal(summarizeAgentTool(tool('bazi_hepan', { input: { a: { name: '小王', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 }, b: { birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 } } })),
        '小王 · 1990 / 1 / 15 · 9 时 × 乙方 · 1992 / 8 / 3 · 14 时', 'a pairing names both people, by the defaults Core gives the unnamed');
    assert.equal(summarizeAgentTool(tool('bazi_hepan', { input: { a: { name: '我', reference: 'bazi_chart:1', birthMinute: 0 }, b: { reference: 'artifact:2' } } })), '我 · 已有命盘 × 乙方 · 已有命盘');
    assert.equal(summarizeAgentTool(tool('bazi_hour_candidates', { status: 'running', input: { birthYear: 1990, birthMonth: 5, birthDay: 20, fromHour: 5, toHour: 12, eventYears: [2015, 2018] } })),
        '1990 / 5 / 20 · 5–12 时 · 前事 2015、2018', 'hour candidates name the remembered window and past years, and count only once computed');
    assert.equal(summarizeAgentTool(tool('read_user_data', { input: { type: 'liuyao_divination', id: 'x' } })), '六爻占卜', 'a data type reads by its name, not its key');
    assert.equal(summarizeAgentTool(tool('search_knowledge', { input: { query: '庚金 正官 月令' }, output: [{ content: '庚金带煞' }, { content: '八字用神' }] })), '「庚金 正官 月令」 · 命中 2 段');
    assert.equal(summarizeAgentTool(tool('web_search', { input: { query: '丑月' }, output: [] })), '「丑月」 · 没有可引用的公开来源');
    assert.equal(summarizeAgentTool(tool('web_search', { input: { query: '丑月' }, output: [{ title: 'a', url: 'https://a.example', content: 'x' }] })), '「丑月」 · 找到 1 个公开来源');
    assert.equal(summarizeAgentTool(tool('search_knowledge', { output: [] })), '没有匹配的段落', 'a search without a query still reports its outcome');
    assert.equal(summarizeAgentTool(tool('web_search', { status: 'running', input: { query: '丑月' } })), '「丑月」', 'a running search never claims a hit count');
    assert.equal(summarizeAgentTool(tool('list_user_data', { output: { items: [{ id: 'a', type: 'bazi_chart', name: '本人', preview: '己巳' }], errors: [{ message: '塔罗不可读' }] } })), '找到 1 份资料 · 1 项暂不可读');
    assert.equal(summarizeAgentTool(tool('parallel_analysis', { status: 'running', output: { analyses: [{ system: 'bazi', conversationId: 1, status: 'completed', name: '子平格局' }, { system: 'bazi', conversationId: 2, status: 'running', name: '干支关系复核' }] } })), '子平格局、干支关系复核');
    // 成员名过长时只列放得下的，其余收成「等 N 位」；还没返回成员时读调用参数里的名字。
    assert.equal(summarizeAgentTool(tool('parallel_analysis', { status: 'running', input: { tasks: [{ name: '子平格局派' }, { name: '干支关系复核' }, { name: '流年应期' }] } })), '子平格局派、干支关系复核 等 3 位');
    assert.equal(formatMemberNames(['一位名字特别特别特别长的分析师', '乙']), '一位名字特别特别特别长的分析师 等 2 位', 'the first name always shows, even when long');
    assert.equal(summarizeAgentTool(tool('ask_user', { status: 'awaiting_input', input: { questions: [{ id: 'a', question: '城市？' }, { id: 'b', question: '行业？' }] } })), '2 个问题');
    assert.equal(summarizeAgentTool(tool('focus_chart', { output: { chartFocus: { version: 1, reference: 'artifact:11111111-1111-4111-8111-111111111111', targetIds: [], includeRelated: true, caption: '月干丁火' } } })), '月干丁火');
    assert.equal(summarizeAgentTool(tool('read_attachment', { output: { id: 'a', name: '长文.txt', kind: 'text', text: '一二', offset: 0, total: 9, nextOffset: 2 } })), '长文.txt · 读到 2 / 9 字');
    assert.equal(summarizeAgentTool(tool('mcp__archive__lookup', { input: { keyword: 1 } })), null);
    // 按需加载的工具：检索一行写清关键词与加载数量。
    assert.equal(summarizeAgentTool(tool('tool_search', { input: { query: '大运' }, output: { loaded: ['bazi_dayun', 'bazi_relations'] } })), '「大运」 · 加载 2 个工具');
    assert.equal(summarizeAgentTool(tool('tool_search', { status: 'running', input: { query: '大运' } })), '「大运」');
    // 技能：加载写名称、版本与附属文件数，读文件写技能名与路径。
    assert.equal(summarizeAgentTool(tool('load_skill', { input: { name: 'case-review' }, output: { name: 'case-review', version: 3, scope: 'user', files: [{ path: 'notes.md', bytes: 12 }] } })),
        'case-review · v3 · 1 个附属文件');
    assert.equal(summarizeAgentTool(tool('load_skill', { status: 'running', input: { name: 'case-review' } })), 'case-review');
    assert.equal(summarizeAgentTool(tool('read_skill_file', { input: { name: 'case-review', path: 'references/terms.md' } })), 'case-review/references/terms.md');
    assert.equal(summarizeAgentTool(tool('tool_search', { output: { loaded: [] } })), '加载 0 个工具');
    assert.equal(getAgentToolFamily('tool_search'), 'other');
    // 计划模式：计划提交后按用户的决定显示。
    assert.equal(summarizeAgentTool(tool('submit_plan', { input: { plan: '# 计划' }, output: { plan: '# 计划', approved: true } })), '已批准');
    assert.equal(summarizeAgentTool(tool('submit_plan', { input: { plan: '# 计划' }, output: { plan: '# 计划', approved: false } })), '要求修改');
    assert.equal(summarizeAgentTool(tool('submit_plan', { status: 'running', input: { plan: '# 计划' } })), '等待你批准');
    assert.equal(Object.keys(AGENT_TOOL_FAMILY_LABELS).length, 18, 'every tool family has a step tag');
    assert.equal(summarizeAgentTool(tool('generate_image', { status: 'running', input: { prompt: '水墨山居，晨雾缭绕' } })), '「水墨山居，晨雾缭绕」');
    assert.equal(summarizeAgentTool(tool('generate_image', { output: { prompt: '水墨山居', images: [{ id: '11111111-1111-4111-8111-111111111111', size: '1024x1024', mimeType: 'image/png' }] } })), '生成 1 张图片');
    // 个人资料检索：条件、笔记、以往对话与档案各写一行。
    assert.equal(summarizeAgentTool(tool('list_user_data', { input: { keyword: '换工作', since: '2026-01-01', until: '2026-03-31' }, output: { items: [], errors: [] } })),
        '「换工作」 · 2026-01-01 至 2026-03-31 · 找到 0 份资料');
    assert.equal(summarizeAgentTool(tool('read_user_notes', { input: { since: '2026-10-01' }, output: { notes: [{ date: '2026-10-20', mood: '平静', content: '复盘' }], more: true } })), '2026-10-01 起 · 1+ 条笔记');
    assert.equal(summarizeAgentTool(tool('search_conversations', { input: { query: '跳槽 2024' }, output: [] })), '「跳槽 2024」 · 没有找到');
    assert.equal(summarizeAgentTool(tool('search_conversations', { status: 'running', input: { query: '跳槽' } })), '「跳槽」');
    assert.equal(summarizeAgentTool(tool('record_user_event', { input: { title: '换到新公司' } , status: 'running' })), '换到新公司');
    assert.equal(summarizeAgentTool(tool('record_user_event', { output: { target: 'record', id: 'r', event: { date: '2024-03-01', category: '事业', title: '换到新公司', detail: '我去年三月换了工作', chart: null } } })),
        '2024-03-01 · 换到新公司');
    assert.equal(summarizeAgentTool(tool('propose_archive_entry', { output: { runId: 'run', callId: 'call', proposal: { kind: 'conclusion', category: 'prediction', title: '明年换岗', content: '流年见官', date: '2027-01-01', tags: [], chart: null } } })),
        '保存结论 · 明年换岗');
    assert.equal(getAgentToolFamily('record_user_event'), 'archive');
    assert.equal(getAgentToolFamily('read_user_notes'), 'data');
    assert.equal(summarizeAgentTool(tool('bazi_relations', { input: { reference: 'artifact:x', year: 2027, dayun: 4 } })), '2027 年 · 第 4 步大运', 'a drilldown reads its selectors, never the chart reference');
});

test('a code mode script is one step and its calls stay inside it', () => {
    const script: AgentTool = { type: 'tool', id: 'native-tool:3:script', name: 'codemode', title: '运行脚本', status: 'completed', input: { code: 'return 1' },
        output: { calls: [{ id: 1, name: 'bazi', args: '{}', status: 'ok' }, { id: 2, name: 'bazi', args: '{}', status: 'error', error: 'blocked' }, { id: '3', name: 'bazi', status: 'ok' }], output: '1' } };
    const calls: AgentTool[] = [7, 8].map((task, index) => ({ type: 'tool', id: `nested:${task}`, name: 'bazi', title: '八字排盘', status: 'completed', parentId: script.id, scriptCall: index + 1 }));
    const parts: AgentPart[] = [script, ...calls, { type: 'tool', id: 'native-tool:4:focus', name: 'focus_chart', title: '定位分析位置', status: 'completed' }];
    assert.deepEqual(getAgentSteps(parts).map(step => step.id), [script.id, 'native-tool:4:focus'], 'the calls are not steps of their own');
    assert.deepEqual(getAgentScriptCalls(parts).get(script.id)?.map(call => call.id), ['nested:7', 'nested:8']);
    assert.equal(summarizeAgentTool(script), '调用 2 次 · 1 次失败', 'a blocked call counts though it has no part; a row without a call number is not one');
    assert.equal(summarizeAgentTool({ ...script, status: 'running', output: undefined }), null, 'a running script lists no calls yet');
    assert.equal(summarizeAgentActivity([script, ...calls], 0, 0), '已查看 2 张命盘，已运行 1 个脚本');
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
    // 用时只落库、不展示（用户裁定 2026-10-17）：步骤描述里不再带 duration 字段。
    assert.deepEqual(describeAgentStep(tool({ durationMs: 30_000 }), 'completed'), { status: 'completed', label: '完成', summary: '「丑月」 · 没有可引用的公开来源', note: null });
    const failed = describeAgentStep(tool({ status: 'failed', output: '网络错误', durationMs: 1200 }), 'completed');
    assert.equal(failed.note, '失败');
    assert.equal('duration' in failed, false, 'a failed call keeps its measured time in storage only');
    const stopped = describeAgentStep(tool({ status: 'running', durationMs: 50 }), 'cancelled');
    assert.deepEqual([stopped.status, stopped.note], ['interrupted', '已结束（任务停止时未完成）'], 'an unfinished call never shows a time');
    assert.equal(describeAgentStep(tool({ status: 'pending', input: undefined, output: undefined }), 'running').note, '待执行');
    assert.equal(describeAgentStep(tool({ name: 'mcp__x', status: 'running', input: undefined, output: undefined }), 'running').note, '执行中', 'a running call without a summary still says what it is doing');
    assert.equal(describeAgentStep(tool({ status: 'running', output: undefined }), 'running').note, null, 'a running call with a summary needs no note');
});

test('the folded process line names steps in first-use order, counts repeats and skips plan updates', () => {
    const tool = (id: string, title: string, name = 'focus_chart'): AgentTool => ({ type: 'tool', id, name, title, status: 'completed' });
    const tools = [tool('a', '八字排盘', 'bazi'), tool('p', '更新计划', 'todo_write'), tool('b', '定位分析位置'), tool('c', '八字大运', 'bazi_dayun'), tool('d', '定位分析位置'), tool('e', '定位分析位置')];
    assert.equal(summarizeAgentProcess(tools), '八字排盘、定位分析位置 3 次、八字大运');
    assert.equal(summarizeAgentProcess([...tools, tool('f', '读取资料', 'read_user_data'), tool('g', '联网检索', 'web_search')]), '八字排盘、定位分析位置 3 次、八字大运、读取资料等');
    assert.equal(summarizeAgentProcess([]), '');
    assert.equal(summarizeAgentProcess([tool('p', '更新计划', 'todo_write')]), '');
});

test('the claude-style status line groups tools by effect and names collaboration members', () => {
    const tool = (id: string, name: string, extra: Partial<AgentTool> = {}): AgentTool => ({ type: 'tool', id, name, title: name, status: 'completed', ...extra });
    assert.equal(summarizeAgentActivity([tool('a', 'bazi'), tool('b', 'inspect_chart')], 0, 0), '已查看 2 张命盘');
    assert.equal(summarizeAgentActivity([tool('a', 'web_search'), tool('b', 'read_user_data'), tool('c', 'todo_write')], 0, 0), '已搜索 1 次，已读取 1 份资料');
    const team = tool('t', 'parallel_analysis', { output: { analyses: [{ system: 'bazi', conversationId: 1, status: 'completed' }, { system: 'ziwei', conversationId: 2, status: 'completed' }] } });
    assert.equal(summarizeAgentActivity([team], 0, 0), '开启 2 个智能体');
    assert.equal(summarizeAgentActivity([tool('a', 'bazi', { status: 'failed' })], 2, 1), '已查看 1 张命盘，已确认 2 项信息，1 处失败');
    assert.equal(summarizeAgentActivity([], 1, 0), '已确认 1 项信息');
    // A skill counts once: loading it and reading its files are one skill used.
    assert.equal(summarizeAgentActivity([tool('k', 'load_skill', { input: { name: 'case-review' } }), tool('f', 'read_skill_file', { input: { name: 'case-review', path: 'notes.md' } }),
        tool('g', 'load_skill', { input: { name: 'timing' } })], 0, 0), '已使用 2 个技能');
    assert.equal(summarizeAgentActivity([tool('s', 'select_final_artifacts', { input: { artifactIds: ['a', 'b', 'c'] } })], 0, 0), '已运行 1 个工具', 'a step of a retired tool in an earlier answer still counts as a step');
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

test('steps are numbered once across the task and leave plan updates to the task list', () => {
    const tool = (id: string, name: string): AgentTool => ({ type: 'tool', id, name, title: id, status: 'completed' });
    const parts: AgentPart[] = [tool('plan', 'todo_write'), tool('a', 'bazi'), { type: 'text', id: 'say', text: '先看命盘。' }, tool('plan2', 'todo_write'), tool('b', 'focus_chart')];
    assert.deepEqual(getAgentSteps(parts).map(step => step.id), ['a', 'b']);
    assert.deepEqual([...getAgentStepNumbers(parts)], [['a', 1], ['b', 2]], 'narration between groups does not restart the numbering');
    assert.equal(getAgentStepNumbers([tool('plan', 'todo_write')]).size, 0);
});

test('a call note only claims storage for cached results and never shows a measured time', () => {
    const tool = (extra: Partial<AgentTool> = {}): AgentTool => ({ type: 'tool', id: 'b', name: 'bazi', title: '八字排盘', status: 'completed', durationMs: 86, output: { artifactId: 'a1' }, ...extra });
    // 用时只落库、不展示（用户裁定 2026-10-17）：备注只说结果是否已暂存。
    assert.equal(describeAgentCallNote(tool()), '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
    assert.equal(describeAgentCallNote(tool({ startedAt: 1_000, endedAt: 6_000, durationMs: 1_500 })), '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
    assert.equal(describeAgentCallNote(tool({ startedAt: 1_000, endedAt: 1_086 })), '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
    assert.equal(describeAgentCallNote(tool({ output: { result: 1 } })), null, 'an uncached result makes no replay claim');
    assert.equal(describeAgentCallNote(tool({ status: 'failed', durationMs: undefined })), null);
    assert.equal(describeAgentCallNote(tool({ durationMs: Number.NaN })), '结果已按任务与调用 ID 暂存，重放不会重新计算或扣费。');
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

test('the AI-safe liuyao board keeps its body, global shensha and hexagram interplay for the workspace', async () => {
  const input = { question: '本月事业运势如何？', yongShenTargets: ['官鬼'], method: 'select', hexagramName: '天火同人', changedHexagramName: '乾为天', date: '2026-02-10T09:30:00' };
  const rendered = buildToolSuccessPayload('liuyao', await executeTool('liuyao', input), { detailLevel: 'full' });
  const value = getAgentChart({ type: 'tool', id: 'l', name: 'liuyao', title: '六爻', status: 'completed', output: { result: rendered.structuredContent } });
  assert.equal(value?.kind, 'liuyao');
  if (value?.kind !== 'liuyao') return;
  const board = (rendered.structuredContent as { 卦盘: { 卦身?: unknown; 全局神煞?: string[] }; 全局互动: unknown });
  assert.deepEqual(value.chart.卦盘.卦身, board.卦盘.卦身);
  assert.deepEqual(value.chart.全局神煞, board.卦盘.全局神煞);
  assert.deepEqual(value.chart.全局互动, board.全局互动);
  // Moving lines come from Core's 动静, not from comparing hexagram codes.
  assert.deepEqual(value.chart.六爻.filter(line => line.动静.startsWith('明动')).map(line => line.爻位), ['六二']);
  // The AI-safe contract keeps 用神 and 应期 out of the agent board.
  assert.deepEqual(value.chart.用神分析, []);
});

test('the workspace board reads the full-detail reading even when the model only got the default level', async () => {
  const input = { question: '本月事业运势如何？', yongShenTargets: ['官鬼'], method: 'select', hexagramName: '天火同人', changedHexagramName: '乾为天', date: '2026-02-10T09:30:00' };
  const result = await executeTool('liuyao', input);
  const model = buildToolSuccessPayload('liuyao', result, { detailLevel: 'default' }).structuredContent;
  const full = buildToolSuccessPayload('liuyao', result, { detailLevel: 'full' }).structuredContent;
  const tool = (output: unknown) => getAgentChart({ type: 'tool', id: 'l', name: 'liuyao', title: '六爻', status: 'completed', output });
  const strengths = (output: unknown) => { const value = tool(output); return value?.kind === 'liuyao' ? value.chart.六爻.map(line => line.旺衰) : null; };
  assert.ok(strengths({ result: model })?.every(strength => !strength), 'the default level carries no strength');
  assert.ok(strengths({ artifactId: 'a', result: model, board: full })?.every(Boolean), 'the board prefers the full-detail reading');
});

test('thinking time counts only the calls that thought without answering', () => {
    const reasoning = (id: string, durationMs?: number) => ({ type: 'reasoning' as const, id, text: '草稿', ...(durationMs === undefined ? {} : { durationMs }) });
    assert.equal(summarizeThinkingTime([reasoning('a', 4200), reasoning('b', 2600)]), '已思考 7 秒');
    assert.equal(summarizeThinkingTime([reasoning('a', 65_000)]), '已思考 1 分 5 秒');
    assert.equal(summarizeThinkingTime([reasoning('a', 120_000)]), '已思考 2 分');
    assert.equal(summarizeThinkingTime([reasoning('a', 400)]), null, 'under a second is not worth a line');
    assert.equal(summarizeThinkingTime([reasoning('a')]), null, 'legacy runs recorded no duration');
});
