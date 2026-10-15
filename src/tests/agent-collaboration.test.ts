import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentTools, createAssistantMessageEventStream, type AssistantMessage, type Message } from '@earendil-works/pi-ai';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import { memberStats, memberSteps, positionsInstruction } from '../lib/agent/parallel.server';
import {
    getParallelDivergence, normalizeParallelTopics, parallelAnalysisResults, parallelAnalysisTitle, parallelAnalysisTopics, splitMemberPositions,
    type ParallelAnalysisResult, type ParallelTopic,
} from '../lib/agent/parallel-results';
import type { PiStreamFn } from '../lib/agent/types';
import { row, config, MemoryStore } from './helpers/agent-runtime-fixture';

const TOPICS: ParallelTopic[] = [{ title: '2027 是否变动', options: ['先争取权责', '主动变动'] }, { title: '命局主线' }];
const member = (status: ParallelAnalysisResult['status'], positions?: Record<string, string>): ParallelAnalysisResult =>
    ({ system: 'bazi', conversationId: Math.random(), status, ...(positions ? { positions } : {}) });

test('members state one position per topic; option topics accept only one of their options', () => {
    const text = '取丁火正官为用。\n\n<positions>\n- 2027 是否变动：主动变动，宜早不宜迟\n命局主线: 正官制身\n2027 是否变动：先争取权责\n未知议题：忽略\n</positions>';
    assert.deepEqual(splitMemberPositions(text, TOPICS), { answer: '取丁火正官为用。', positions: { '2027 是否变动': '主动变动', 命局主线: '正官制身' } },
        'a line starting with one option counts; repeats and unknown topics are ignored');
    assert.deepEqual(splitMemberPositions('结论\n<positions>\n2027 是否变动：都有可能\n命局主线：这是一段远远超过二十四个字的长篇论述，不能当作立场摘要\n</positions>\n补充说明', TOPICS),
        { answer: '结论\n\n补充说明', positions: {} }, 'an answer outside the options or a paragraph is not a stance; text after the block stays');
    const both = [{ title: '方向', options: ['主动', '主动变动'] }];
    assert.deepEqual(splitMemberPositions('<positions>\n方向：主动变动\n</positions>', both).positions, { 方向: '主动变动' }, 'an exact option wins over a prefix');
    assert.deepEqual(splitMemberPositions('<positions>\n方向：主动变动更好\n</positions>', both).positions, {}, 'a line matching two options is ambiguous');
    assert.deepEqual(splitMemberPositions('没有表态', TOPICS), { answer: '没有表态', positions: {} });
});

test('topics are trimmed, bounded and rejected when empty or repeated', () => {
    assert.deepEqual(normalizeParallelTopics([{ title: ' 方向 ', options: [' 主动 ', '等待'] }]), [{ title: '方向', options: ['主动', '等待'] }]);
    assert.deepEqual(normalizeParallelTopics(), []);
    for (const topics of [[{ title: ' ' }], [{ title: 'a' }, { title: 'a ' }], [{ title: 'a', options: ['x', ' x'] }], [{ title: 'a', options: ['x', ' '] }], ['a', 'b', 'c', 'd', 'e'].map(title => ({ title }))])
        assert.throws(() => normalizeParallelTopics(topics), /协作议题和选项不能为空或重复/, JSON.stringify(topics));
    assert.equal(positionsInstruction([]), '');
    assert.equal(positionsInstruction(TOPICS), '\n\n回答最后另起一行写 <positions>，每个议题一行“议题：立场”，最后一行写 </positions>。「2027 是否变动」只能从 先争取权责 / 主动变动 中原样选择一项；「命局主线」用不超过 12 个字概括。');
});

test('only finished members choosing different options make a topic divergent', () => {
    const rows = getParallelDivergence(TOPICS, [
        member('completed', { '2027 是否变动': '先争取权责', 命局主线: '正官制身' }),
        member('completed', { '2027 是否变动': '主动变动', 命局主线: '合局做功' }),
        member('running'),
    ]);
    assert.deepEqual(rows.map(row => [row.topic.title, row.stances, row.divergent]), [
        ['2027 是否变动', ['先争取权责', '主动变动', null], true],
        ['命局主线', ['正官制身', '合局做功', null], false],
    ], 'free-text stances are shown but never compared');
    assert.equal(getParallelDivergence(TOPICS, [member('completed', { '2027 是否变动': '主动变动' }), member('failed', { '2027 是否变动': '先争取权责' })])[0].divergent, false,
        'a member that did not finish takes no part in the comparison');
});

test('display-only fields are validated without dropping the member', () => {
    const output = { title: ' 三派会诊 ', topics: [...TOPICS, { title: '' }, { title: '单选', options: ['只有一项'] }, null], analyses: [
        { system: 'bazi', conversationId: 1, status: 'running', steps: [{ name: 'bazi', title: '八字排盘', status: 'completed' }, { name: 'x', title: '读取', status: 'running' }] },
        { system: 'ziwei', conversationId: 2, status: 'completed', positions: { a: 1 }, toolCalls: -1, durationMs: 1.5, steps: [{ name: 'x' }] },
    ] };
    const members = parallelAnalysisResults(output);
    assert.deepEqual(members.map(item => Object.keys(item).sort()), [['conversationId', 'status', 'steps', 'system'], ['conversationId', 'status', 'system']]);
    assert.equal(members[0].steps?.at(-1)?.title, '读取');
    assert.equal(parallelAnalysisTitle(output), '三派会诊');
    assert.equal(parallelAnalysisTitle({ title: ' ' }), null);
    assert.deepEqual(parallelAnalysisTopics(output), TOPICS, 'malformed topics are ignored');
    assert.deepEqual(parallelAnalysisTopics(undefined), []);
});

test('a member reports the calls it made and how long it analysed from its own transcript', () => {
    const messages = [
        { role: 'user', content: '分析', timestamp: 1_000 },
        { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'bazi', arguments: {} }, { type: 'toolCall', id: 'b', name: 'load_analysis_method', arguments: {} }], timestamp: 2_000, durationMs: 500 },
        { role: 'toolResult', toolCallId: 'a', toolName: 'bazi', content: [], isError: false, timestamp: 3_000 },
        { role: 'toolResult', toolCallId: 'b', toolName: 'load_analysis_method', content: [], isError: true, timestamp: 3_500 },
        { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'unknown_tool', arguments: {} }], timestamp: 4_000, durationMs: 1_000 },
    ] as unknown as Message[];
    assert.deepEqual(memberSteps(messages, new Map([['bazi', '八字排盘']])), [
        { name: 'bazi', title: '八字排盘', status: 'completed' },
        { name: 'load_analysis_method', title: 'load_analysis_method', status: 'failed' },
        { name: 'unknown_tool', title: 'unknown_tool', status: 'running' },
    ]);
    assert.deepEqual(memberStats(messages), { toolCalls: 2, durationMs: 4_000 });
    assert.deepEqual(memberStats([{ role: 'assistant', content: [], timestamp: 5 } as unknown as Message]), { toolCalls: 0 }, 'no input timestamp, no duration');
});

test('the collaboration names its topics and shows each finished member with its stances', { timeout: 20000 }, async t => {
    const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
    const features = require('../lib/app-settings') as typeof import('../lib/app-settings');
    t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: 'plus', credits: 10, expiresAt: null }));
    t.mock.method(features, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
    const run = row(), store = new MemoryStore();
    run.input.collaborators = [
        { id: 'ziping', name: '子平', model: 'ziping-model', focus: '格局与用神', reasoning: false, reasoningEffort: null },
        { id: 'mangpai', name: '盲派', model: 'mangpai-model', focus: '做功与应期', reasoning: false, reasoningEffort: null },
    ];
    const configs = run.input.collaborators.map(item => ({ ...config, id: item.model, name: item.name }));
    const inputs: string[] = [];
    const replies: Record<string, string> = {
        'ziping-model': '取丁火正官为用，宜先稳住。\n<positions>\n2027 是否变动：先争取权责\n命局主线：正官制身\n</positions>',
        'mangpai-model': '未冲丑引动月令，变动明显。\n<positions>\n2027 是否变动：主动变动\n命局主线：合局做功\n</positions>',
    };
    const stream: PiStreamFn = (model, context) => {
        let content: AssistantMessage['content'];
        if (getCurrentTools(context.messages).some(tool => tool.name === 'parallel_analysis')) {
            content = context.messages.some(message => message.role === 'toolResult' && message.toolName === 'parallel_analysis') ? [{ type: 'text', text: '两派在 2027 是否变动上有分歧。' }]
                : [{ type: 'toolCall', id: 'parallel', name: 'parallel_analysis', arguments: { title: '两派会诊', topics: TOPICS,
                    tasks: run.input.collaborators!.map(item => ({ agentId: item.id, system: 'bazi', question: '资料完整，请独立分析。' })) } }];
        } else {
            const input = context.messages.find(message => message.role === 'user');
            inputs.push(typeof input?.content === 'string' ? input.content : input?.content.map(part => part.type === 'text' ? part.text : '').join('') ?? '');
            content = [{ type: 'text', text: replies[model.id] }];
        }
        const events = createAssistantMessageEventStream(), message = emptyPiAssistant(model);
        message.content = content; message.stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop';
        events.push({ type: 'done', reason: message.stopReason, message }); events.end(message); return events;
    };
    await executeAgentRun(store, run, undefined, { config, configs, streamFn: stream });
    const finished = store.writes.findLast(write => write.name === 'agent_finish_run')!;
    assert.equal(finished.args.p_status, 'completed');
    assert.equal(inputs.length, 2);
    assert.ok(inputs.every(input => input.endsWith(positionsInstruction(TOPICS))), 'each member is told how to state its positions');

    const checkpoint = finished.args.p_checkpoint as typeof run.checkpoint;
    const collaboration = checkpoint.parts.find(part => part.type === 'tool' && part.name === 'parallel_analysis');
    const output = collaboration?.type === 'tool' ? collaboration.output : undefined;
    assert.equal(parallelAnalysisTitle(output), '两派会诊');
    assert.deepEqual(parallelAnalysisTopics(output), TOPICS);
    const members = parallelAnalysisResults(output);
    assert.deepEqual(members.map(item => [item.name, item.status, item.answer, item.positions, item.toolCalls]), [
        ['子平', 'completed', '取丁火正官为用，宜先稳住。', { '2027 是否变动': '先争取权责', 命局主线: '正官制身' }, 0],
        ['盲派', 'completed', '未冲丑引动月令，变动明显。', { '2027 是否变动': '主动变动', 命局主线: '合局做功' }, 0],
    ], 'the positions block never reaches the answer');
    assert.deepEqual(getParallelDivergence(TOPICS, members).map(item => item.divergent), [true, false]);
});
