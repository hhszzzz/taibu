import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { executeAgentRun } from '../lib/agent/runtime.server';
import type { AgentRunRow } from '../lib/agent/store.server';
import { AGENT_FOLLOW_UP_LIMIT, shouldPrefillFollowUp, splitAgentFollowUps } from '../lib/agent/follow-ups';
import { config, MemoryStore, row, scripted } from './helpers/agent-runtime-fixture';

beforeEach((t) => {
    assert.ok('mock' in t);
    const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
    const sdk = require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider');
    t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: 'enabled' as const }));
    t.mock.method(sdk, 'isModelAvailable', () => true);
    t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

test('suggested follow-ups leave the answer as one short suggestion', () => {
    assert.deepEqual(splitAgentFollowUps('结论：适合变动。\n\n<followups>\n- 适合往哪个城市发展？\n2. 2027 年哪个月最适合行动？\n适合往哪个城市发展？\n\n把结论导出成报告\n第四个问题\n</followups>'), {
        text: '结论：适合变动。',
        followUps: ['适合往哪个城市发展？'],
    });
    assert.equal(AGENT_FOLLOW_UP_LIMIT, 1);
    assert.deepEqual(splitAgentFollowUps('答复\n<followups>\n这一行写得太长了，已经不是一个可以直接点选的追问，而是夹在列表里的一段说明文字，应当忽略\n<b>标签</b>\n</followups>\n附注'),
        { text: '答复\n\n附注', followUps: [] }, 'prose and markup in the block are dropped; text after it stays');
    assert.deepEqual(splitAgentFollowUps('没有建议的回答'), { text: '没有建议的回答', followUps: [] });
});

test('a follow-up block never shows while it streams in', () => {
    assert.deepEqual(splitAgentFollowUps('答复\n<follow'), { text: '答复', followUps: [] }, 'a partial opening tag on its own line is held back');
    assert.deepEqual(splitAgentFollowUps('答复\n<followups>\n适合往'), { text: '答复', followUps: ['适合往'] }, 'an unclosed block is already hidden');
    assert.deepEqual(splitAgentFollowUps('a < b 且 c<d'), { text: 'a < b 且 c<d', followUps: [] }, 'a comparison is not a tag');
    assert.deepEqual(splitAgentFollowUps('<'), { text: '', followUps: [] });
});

test('the public answer drops the follow-up block and an answer of follow-ups alone does not complete', async () => {
    const store = new MemoryStore(), run = row();
    await executeAgentRun(store, run, undefined, { config, streamFn: scripted(() => [{ type: 'text', text: '结论：适合变动。\n\n<followups>\n适合往哪个城市发展？\n2027 年哪个月最适合行动？\n</followups>' }]) });
    const finished = store.writes.findLast(write => write.name === 'agent_finish_run')!;
    const message = finished.args.p_message as AgentRunRow['public_message'];
    assert.equal(finished.args.p_status, 'completed');
    assert.equal(message.content, '结论：适合变动。');
    assert.deepEqual(message.agent!.followUps, ['适合往哪个城市发展？']);

    const bare = new MemoryStore(), second = row();
    await executeAgentRun(bare, second, undefined, { config, streamFn: scripted(() => [{ type: 'text', text: '<followups>\n还有吗？\n</followups>' }]) });
    const failed = bare.writes.findLast(write => write.name === 'agent_finish_run')!;
    assert.equal(failed.args.p_status, 'failed');
    assert.equal((failed.args.p_message as AgentRunRow['public_message']).content, '');
});

test('a finished task fills its one suggestion into an empty composer only', () => {
    const base = { previousStatus: 'running' as const, status: 'completed' as const, suggestion: '2026 年适合换工作吗？', draft: '', disabled: false };
    assert.equal(shouldPrefillFollowUp(base), true, 'a task seen running that just completed fills its suggestion');
    assert.equal(shouldPrefillFollowUp({ ...base, draft: '我自己写的问题' }), false, 'an existing draft is never overwritten');
    assert.equal(shouldPrefillFollowUp({ ...base, previousStatus: undefined }), false, 'a conversation opened already finished gets no suggestion');
    assert.equal(shouldPrefillFollowUp({ ...base, previousStatus: 'completed' }), false, 'a suggestion is filled once per task');
    assert.equal(shouldPrefillFollowUp({ ...base, status: 'running' }), false, 'nothing is filled while the task still runs');
    assert.equal(shouldPrefillFollowUp({ ...base, suggestion: undefined }), false, 'no suggestion, nothing to fill');
    assert.equal(shouldPrefillFollowUp({ ...base, disabled: true }), false, 'a locked composer takes no draft');
});
