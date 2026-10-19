/**
 * 消息版本（编辑 / 重新生成的分支）纯函数。
 *
 * 版本挂在用户消息上：versions[currentVersionIndex] 描述「当前可见分支」，
 * 其后的回答与后续消息就是该分支的活内容。与 SQL `agent_create_run` 相同，
 * 离开一个分支前总是用活内容覆盖它的快照，切回来时才能完整还原。
 */
import type { ChatMessage, Mention, MessageVersion } from '@/types';

export type CapturedBranch = { versions: MessageVersion[]; index: number };

function validIndex(message: ChatMessage, length: number) {
    const current = message.currentVersionIndex;
    return typeof current === 'number' && Number.isInteger(current) && current >= 0 && current < length ? current : length - 1;
}

/** Snapshot the live branch (user turn, its reply, everything after) into the current version slot. */
export function captureCurrentBranch(userMessage: ChatMessage, reply: ChatMessage | undefined, subsequent: ChatMessage[]): CapturedBranch {
    const versions = [...(userMessage.versions ?? [])];
    const index = validIndex(userMessage, versions.length);
    const answer = reply?.role === 'assistant' ? reply : undefined;
    const snapshot: MessageVersion = {
        ...(index >= 0 ? versions[index] : undefined),
        userContent: userMessage.content,
        attachments: userMessage.attachments,
        mentions: userMessage.mentions ? [...userMessage.mentions] : undefined,
        aiContent: answer?.content ?? '',
        aiAgent: answer?.agent,
        aiMetadata: answer?.metadata,
        aiMessageId: answer?.id,
        aiModel: answer?.model,
        aiModelName: answer?.modelName,
        createdAt: answer?.createdAt ?? userMessage.createdAt,
        subsequentMessages: subsequent.length ? subsequent : undefined,
        pending: undefined,
    };
    if (index < 0) return { versions: [snapshot], index: 0 };
    versions[index] = snapshot;
    return { versions, index };
}

/** Durable id of a version's reply: saved id, then the Agent run's public message id, then a stable fallback. */
export function versionReplyId(messageId: string, version: MessageVersion, index: number) {
    return version.aiMessageId ?? (version.aiAgent?.runId ? `agent:${version.aiAgent.runId}` : `${messageId}:v${index}`);
}

/** Show `versionIndex` of a user turn; null when the turn or index is unknown or a version is still running. */
export function switchToVersion(messages: ChatMessage[], messageId: string, versionIndex: number, sanitize: (mentions?: Mention[]) => Mention[]): ChatMessage[] | null {
    const messageIndex = messages.findIndex(m => m.id === messageId && m.role === 'user');
    if (messageIndex === -1) return null;
    const message = messages[messageIndex];
    if (!message.versions || !Number.isInteger(versionIndex) || versionIndex < 0 || versionIndex >= message.versions.length) return null;
    if (message.versions.some(version => version.pending)) return null;
    const { versions } = captureCurrentBranch(message, messages[messageIndex + 1], messages.slice(messageIndex + 2));
    const version = versions[versionIndex];
    const versionMentions = sanitize(version.mentions ?? message.mentions);
    const userMessage: ChatMessage = {
        ...message,
        content: version.userContent,
        attachments: Object.hasOwn(version, 'attachments') ? version.attachments : message.attachments,
        mentions: versionMentions.length ? [...versionMentions] : undefined,
        versions,
        currentVersionIndex: versionIndex,
    };
    const reply: ChatMessage = {
        id: versionReplyId(message.id, version, versionIndex),
        role: 'assistant',
        content: version.aiContent,
        createdAt: version.createdAt,
        agent: version.aiAgent,
        metadata: version.aiMetadata,
        model: version.aiModel,
        modelName: version.aiModelName,
    };
    return [...messages.slice(0, messageIndex), userMessage, reply, ...(version.subsequentMessages ?? [])];
}

/**
 * Optimistic slot for a reply that is being generated, so the switcher reads N+1 / N+1
 * at once. The server's version list replaces it when the run finishes and the
 * conversation reloads.
 */
export function withPendingVersion(captured: CapturedBranch, userContent: string, patch: Pick<MessageVersion, 'attachments' | 'mentions'> = {}): CapturedBranch {
    const versions = [...captured.versions, { userContent, ...patch, aiContent: '', createdAt: new Date().toISOString(), pending: true }];
    return { versions, index: versions.length - 1 };
}
