/** Composer wording that follows the conversation state, kept pure so each state's copy is tested. */
export interface ComposerNoteState {
    agentMode: boolean;
    /** Agent tasks cannot start here (no worker or capability configured). */
    agentUnavailable?: boolean;
    reconnecting?: boolean;
    /** A task of this conversation waits for answers. */
    awaiting?: boolean;
    /** A task of this conversation is queued or executing. */
    running?: boolean;
    /** Members of the running task's frozen collaboration, 0 when it runs alone. */
    collaborators?: number;
}

/** One-line note under the composer. */
export function composerNote(state: ComposerNoteState): string {
    if (!state.agentMode) return '';
    if (state.agentUnavailable) return '后台任务暂不可用，可切换到普通对话';
    if (state.reconnecting) return '正在重新连接任务 · 后台仍在执行';
    if (state.awaiting) return '也可以在对话里直接回答 · 等待期间不会超时，也不会再次扣费';
    // 运行中的「后台执行中」由标题栏状态承担，输入框下不再重复。
    if (state.running && state.collaborators) return '协作配置在任务创建时冻结 · 修改将用于下一项任务';
    return '';
}

/**
 * The note while a task runs restates the header's task status, so phones leave it out
 * (design board "手机 · 任务对话"); notices about an unavailable or reconnecting task stay.
 */
export function isRunningComposerNote(state: ComposerNoteState): boolean {
    return state.agentMode && !state.agentUnavailable && !state.reconnecting && !state.awaiting && !!state.running;
}
