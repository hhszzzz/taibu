import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { judgeAgentEvaluation } from '../lib/agent/evaluation.server';
import { emptyPiAssistant } from '../lib/agent/pi-stream.server';
import type { PiStreamFn } from '../lib/agent/types';
import { config } from './helpers/agent-runtime-fixture';

const input = { question: '原始问题', assertions: ['引用 Core 依据'], answer: '原始答案', core: ['实际 Core 盘面'] };
function response(text: string, stopReason: Exclude<AssistantMessage['stopReason'], 'pending' | 'deferred'> = 'stop'): PiStreamFn {
    return model => {
        const events = createAssistantMessageEventStream(), answer = emptyPiAssistant(model);
        answer.content = [{ type: 'text', text }]; answer.stopReason = stopReason;
        if (stopReason === 'stop' || stopReason === 'length' || stopReason === 'toolUse') events.push({ type: 'done', reason: stopReason, message: answer });
        else events.push({ type: 'error', reason: stopReason, error: answer });
        events.end(answer); return events;
    };
}
test('quality scoring uses a bounded native stream and preserves the question, answer and actual Core data', async () => {
    const signal = new AbortController().signal;
    const result = await judgeAgentEvaluation({ ...config, defaultMaxTokens: 12288 }, input, (model, context, options) => {
        assert.equal(model.maxTokens, 8192); assert.equal(options?.signal, signal);
        assert.deepEqual(JSON.parse(String(context.messages.at(-1)!.content)), input);
        return response('{"passed":true,"failedAssertions":[]}')(model, context, options);
    }, signal);
    assert.equal(result.quality.passed, true);
});
test('scores reject truncated, malformed and contradictory results and retain a real quality failure', async () => {
    await assert.rejects(judgeAgentEvaluation(config, input, response('{"passed":true,"failedAssertions":[]}', 'length')), /未完整/);
    for (const text of ['not json', 'null', '{"passed":false,"failedAssertions":[]}', '{"passed":true,"failedAssertions":["依据不足"]}']) await assert.rejects(judgeAgentEvaluation(config, input, response(text)), /有效判定/);
    const result = await judgeAgentEvaluation(config, input, response('{"passed":false,"failedAssertions":["引用依据不足"]}'));
    assert.deepEqual(result.quality, { passed: false, failedAssertions: ['引用依据不足'] });
});
test('a cancelled score does not start another model request', async () => {
    let called = false;
    await assert.rejects(judgeAgentEvaluation(config, input, () => { called = true; throw new Error('must not start'); }, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(called, false);
});
test('a pairing stored with chart references is rebuilt before the Core recompute', async () => {
    const { assertAgentEvaluation } = require('../lib/agent/evaluation.server') as typeof import('../lib/agent/evaluation.server');
    const core = require('taibu-core/mcp') as typeof import('taibu-core/mcp');
    const { MemoryStore, row } = require('./helpers/agent-runtime-fixture') as typeof import('./helpers/agent-runtime-fixture');
    const run = row(), store = new MemoryStore();
    const artifact = async (id: string, name: string, args: Record<string, unknown>, input = args) => {
        const raw = await core.executeTool(name, input);
        const rendered = core.buildToolSuccessPayload(name, raw, { detailLevel: 'default' });
        const row = { id, call_id: id, tool_name: name, kind: 'calculation' as const, args,
            result: { content: rendered.content, details: rendered.structuredContent, canonicalText: rendered.content.map(part => part.text).join('\n') } };
        store.drafts.set(id, row as never);
        return row;
    };
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    const a = randomUUID(), b = randomUUID();
    await artifact(a, 'bazi', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
    await artifact(b, 'bazi', { gender: 'female', birthYear: 1992, birthMonth: 3, birthDay: 8, birthHour: 14 });
    await artifact(randomUUID(), 'bazi_hepan', { a: { reference: 'artifact:' + a }, b: { reference: 'artifact:' + b } },
        { a: { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 }, b: { gender: 'female', birthYear: 1992, birthMonth: 3, birthDay: 8, birthHour: 14 } });
    await assertAgentEvaluation(run, 'bazi_hepan', [...store.drafts.values()] as never, store);
    await assert.rejects(assertAgentEvaluation(run, 'bazi_hepan', [...store.drafts.values()] as never), /成果存储/);
});
test('a judge request that fails in transport is retried once', async () => {
    let attempts = 0;
    const result = await judgeAgentEvaluation(config, input, model => {
        attempts += 1;
        return response(attempts === 1 ? '' : '{"passed":true,"failedAssertions":[]}', attempts === 1 ? 'error' : 'stop')(model, {} as never, undefined);
    });
    assert.equal(attempts, 2);
    assert.equal(result.quality.passed, true);
});
