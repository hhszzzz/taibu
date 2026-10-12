import test from 'node:test';
import assert from 'node:assert/strict';
import { composerNote, isRunningComposerNote } from '../lib/chat/composer-copy';

test('composer note follows the conversation state in priority order', () => {
    assert.equal(composerNote({ agentMode: false, running: true }), '普通对话不调用工具 · 需要排盘或检索时切换到 Agent');
    assert.equal(composerNote({ agentMode: true, agentUnavailable: true, running: true }), '后台任务暂不可用，可切换到普通对话');
    assert.equal(composerNote({ agentMode: true, reconnecting: true, awaiting: true }), '正在重新连接任务 · 后台仍在执行');
    assert.equal(composerNote({ agentMode: true, awaiting: true, running: true }), '也可以在对话里直接回答 · 等待期间不会超时，也不会再次扣费');
    assert.equal(composerNote({ agentMode: true, running: true }), '后台执行中，关闭页面也会继续 · 补充内容在下一个安全步骤生效');
    assert.equal(composerNote({ agentMode: true, running: true, collaborators: 3 }), '协作配置在任务创建时冻结 · 修改将用于下一项任务 · 整项任务只计费一次');
    assert.equal(composerNote({ agentMode: true, collaborators: 3 }), '解读仅供参考 · 排盘与计算由太卜 Core 完成');
    assert.equal(composerNote({ agentMode: true }), '解读仅供参考 · 排盘与计算由太卜 Core 完成');
});

test('only the running note is left out on phones', () => {
    assert.equal(isRunningComposerNote({ agentMode: true, running: true }), true);
    assert.equal(isRunningComposerNote({ agentMode: true, running: true, collaborators: 3 }), true);
    for (const state of [
        { agentMode: false, running: true },
        { agentMode: true, agentUnavailable: true, running: true },
        { agentMode: true, reconnecting: true, running: true },
        { agentMode: true, awaiting: true, running: true },
        { agentMode: true },
    ]) assert.equal(isRunningComposerNote(state), false, composerNote(state));
});
