import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentMessageData } from '../lib/agent/types';
import type { ChatMessage, Mention } from '../types';
import { captureCurrentBranch, switchToVersion, versionReplyId, withPendingVersion } from '../lib/chat/message-versions';

const keep = (mentions?: Mention[]) => mentions ?? [];
const agent = (runId: string): AgentMessageData => ({ version: 1, runId, status: 'completed', parts: [] });
const user = (patch: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'u1', role: 'user', content: '问题 v2', createdAt: '2026-10-01T00:00:00Z', ...patch });

/** Server shape after agent_create_run + agent_sync_message: no aiMessageId, runId inside aiAgent. */
function agentConversation(): ChatMessage[] {
    return [
        user({
            versions: [
                { userContent: '问题 v1', aiContent: '回答 v1', aiAgent: agent('run-1'), createdAt: '2026-10-01T00:01:00Z' },
                { userContent: '问题 v2', aiContent: '回答 v2', aiAgent: agent('run-2'), createdAt: '2026-10-01T00:02:00Z' },
            ],
            currentVersionIndex: 1,
        }),
        { id: 'agent:run-2', role: 'assistant', content: '回答 v2', createdAt: '2026-10-01T00:02:00Z', agent: agent('run-2'), model: 'm', modelName: '模型乙' },
        { id: 'u2', role: 'user', content: '追问', createdAt: '2026-10-01T00:03:00Z' },
        { id: 'agent:run-3', role: 'assistant', content: '追问回答', createdAt: '2026-10-01T00:04:00Z', agent: agent('run-3') },
    ];
}

test('F1: switching away and back keeps the follow-up written after the current version', () => {
    const away = switchToVersion(agentConversation(), 'u1', 0, keep);
    assert.ok(away);
    assert.deepEqual(away.map(message => message.content), ['问题 v1', '回答 v1']);
    const back = switchToVersion(away, 'u1', 1, keep);
    assert.ok(back);
    assert.deepEqual(back.map(message => message.content), ['问题 v2', '回答 v2', '追问', '追问回答']);
});

test('F2: an Agent version restores its durable message id so the next run can replay its checkpoint', () => {
    const away = switchToVersion(agentConversation(), 'u1', 0, keep);
    assert.equal(away?.[1].id, 'agent:run-1');
    const back = switchToVersion(away!, 'u1', 1, keep);
    assert.equal(back?.[1].id, 'agent:run-2');
    assert.equal(back?.[1].modelName, '模型乙');
});

test('captureCurrentBranch always overwrites the current snapshot with the live branch', () => {
    const [question, answer, ...rest] = agentConversation();
    const stale = { ...question, versions: question.versions!.map((version, index) => index === 1 ? { ...version, subsequentMessages: [rest[0]] } : version) };
    const captured = captureCurrentBranch(stale, answer, rest);
    assert.equal(captured.index, 1);
    assert.deepEqual(captured.versions[1].subsequentMessages?.map(message => message.id), ['u2', 'agent:run-3']);
    assert.equal(captured.versions[1].aiMessageId, 'agent:run-2');
    assert.equal(captured.versions[0].aiContent, '回答 v1');
});

test('a turn without versions gets a first snapshot and plain replies keep their saved id', () => {
    const plain: ChatMessage[] = [user({ content: '问' }), { id: '1700000000001', role: 'assistant', content: '答', createdAt: '2026-10-01T00:01:00Z', model: 'm' }];
    const captured = captureCurrentBranch(plain[0], plain[1], []);
    assert.deepEqual(captured, { index: 0, versions: [{ userContent: '问', attachments: undefined, mentions: undefined, aiContent: '答', aiAgent: undefined, aiMetadata: undefined, aiMessageId: '1700000000001', aiModel: 'm', aiModelName: undefined, createdAt: '2026-10-01T00:01:00Z', subsequentMessages: undefined, pending: undefined }] });
});

test('replies of versions saved before ids were stored get a deterministic fallback id', () => {
    assert.equal(versionReplyId('u1', { userContent: 'q', aiContent: 'a', createdAt: 'x' }, 2), 'u1:v2');
    assert.equal(versionReplyId('u1', { userContent: 'q', aiContent: 'a', createdAt: 'x', aiAgent: agent('run-9') }, 2), 'agent:run-9');
    assert.equal(versionReplyId('u1', { userContent: 'q', aiContent: 'a', createdAt: 'x', aiMessageId: 'saved' }, 2), 'saved');
});

test('F4: a pending version counts at once and blocks switching until the server versions replace it', () => {
    const [question, answer, ...rest] = agentConversation();
    const pending = withPendingVersion(captureCurrentBranch(question, answer, rest), '问题 v3');
    assert.equal(pending.versions.length, 3);
    assert.equal(pending.index, 2);
    assert.equal(pending.versions[2].pending, true);
    const running: ChatMessage[] = [{ ...question, content: '问题 v3', versions: pending.versions, currentVersionIndex: pending.index }];
    assert.equal(switchToVersion(running, 'u1', 0, keep), null);
});

test('unknown turns and out-of-range indexes are rejected', () => {
    assert.equal(switchToVersion(agentConversation(), 'missing', 0, keep), null);
    assert.equal(switchToVersion(agentConversation(), 'u1', 2, keep), null);
    assert.equal(switchToVersion(agentConversation(), 'u1', -1, keep), null);
    assert.equal(switchToVersion(agentConversation(), 'agent:run-2', 0, keep), null);
});

test('F3: only a forced reload of the validated, on-screen conversation keeps its transcript while fetching', async () => {
    const { isInPlaceReload } = await import('../lib/chat/use-chat-state');
    assert.equal(isInPlaceReload({ forceReload: true, sameConversation: true, validated: true }), true);
    // Opening another conversation, or retrying after a failed first load, still pre-renders/loads as before.
    assert.equal(isInPlaceReload({ forceReload: true, sameConversation: false, validated: true }), false);
    assert.equal(isInPlaceReload({ forceReload: true, sameConversation: true, validated: false }), false);
    assert.equal(isInPlaceReload({ sameConversation: true, validated: true }), false);
});
